import { session as sessionTable } from "@workspace/db/control";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { LOCKED_MESSAGE } from "./attempts";
import type { AuthDeps } from "./auth";
import { CLIENT_IP_HEADER } from "./client-ip";
import { hostCompanySlug } from "./company-pick";
import { SESSION_ENDED_MESSAGES, sessionExpiry } from "./session-timeouts";

/**
 * Organization endpoints the web app may call. Membership, invitations and roles are managed by
 * our own modules behind the permission engine (CLAUDE.md rule 3), so the plugin's other
 * endpoints are closed.
 */
const OPEN_ORGANIZATION_PATHS = new Set(["/organization/set-active", "/organization/list"]);

/**
 * Two-factor endpoints that stay closed: codes by email or SMS are not offered (TOTP, backup codes
 * and passkeys only, blueprint p27), and `/totp/generate` is a server helper.
 */
const CLOSED_PATHS = new Set(["/two-factor/send-otp", "/two-factor/verify-otp", "/totp/generate"]);

/** Endpoints that check a second factor at sign-in. */
const SECOND_FACTOR_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

/**
 * Auth endpoints that must work without a valid session, or with one a timeout has ended: signing
 * in again (password or passkey), signing out, and the email and password-reset links. Every
 * other endpoint gets the company's timeouts too, so no Better Auth call can use or revive an
 * ended session.
 */
const SESSIONLESS_PATHS = new Set([
  "/sign-in/email",
  "/sign-out",
  "/verify-email",
  "/send-verification-email",
  "/request-password-reset",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
  "/ok",
  "/error",
]);

/**
 * What a session that must enrol MFA first may still do: set up an authenticator app or a
 * passkey, read itself, choose a company and sign out (ADR 0029, part 2).
 */
const ENROLMENT_PATHS = new Set([
  "/two-factor/enable",
  "/two-factor/get-totp-uri",
  "/two-factor/verify-totp",
  "/verify-password",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/get-session",
  "/organization/set-active",
  "/organization/list",
]);

/** The two steps of adding a passkey. */
const PASSKEY_REGISTER_PATHS = new Set(["/passkey/generate-register-options", "/passkey/verify-registration"]);

/**
 * How long a confirmed password allows adding a passkey. Turning on the authenticator app needs
 * the password (blueprint p27), so adding a passkey, which signs in on its own, needs it too:
 * POST /verify-password first, then register within this time, on the same session.
 */
const PASSKEY_STEP_UP_MS = 5 * 60_000;

/** The verification row that records a password confirmed for adding a passkey on one session. */
function passkeyStepUpId(sessionId: string): string {
  return `passkey-step-up:${sessionId}`;
}

/**
 * When an authenticator app is confirmed, Better Auth swaps the session for a new one with a new
 * created time. The old created time is kept here between the before and after hooks, so the swap
 * cannot restart the company's absolute timeout (blueprint p28).
 */
const sessionStarts = new WeakMap<Request, Date>();

/** What each auth refusal tells the person, by code (docs/api-contract.md, Authentication). */
export const AUTH_REFUSALS = {
  no_company: "This account is not part of any company yet. Ask your company's owner to invite you.",
  company_id_required: "Choose a company to open.",
  wrong_host: "This address opens only its own company. Sign in on the other company's address.",
  not_a_member: "This account is not a member of this company. Sign in on your company's own address.",
  mfa_enrolment_required: "Set up two-step sign-in to continue.",
  mfa_required: "Two-step sign-in is required for your role, so it cannot be turned off.",
  passkey_required: "Your account uses a passkey for two-step sign-in. Sign in with your passkey.",
  trust_device_unsupported: "Every sign-in asks for a second step; devices cannot be remembered.",
  password_confirmation_required: "Confirm your password, then add the passkey within 5 minutes.",
  create_session_unsupported: "Adding a passkey keeps your current session; it does not start a new one.",
} as const;

/** Whether an auth endpoint is exempt from the company timeouts. */
function isSessionless(path: string): boolean {
  return SESSIONLESS_PATHS.has(path) || path.startsWith("/reset-password");
}

/** The web host a request came through; the web app's proxy forwards it (ADR 0029). */
export function requestHost(headers: Headers | undefined): string | undefined {
  return headers?.get("x-forwarded-host") ?? headers?.get("host") ?? undefined;
}

/** The client IP the rate limiter also uses (settled by client-ip.ts), for the attempt log. */
function requestIp(headers: Headers | undefined): string | null {
  return headers?.get(CLIENT_IP_HEADER) || null;
}

/** A request body's fields, whatever was sent. */
function fieldsOf(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

/** The email a sign-in names, or null when the body has none. */
function signInEmail(body: unknown): string | null {
  const email = fieldsOf(body).email;
  return typeof email === "string" && email !== "" ? email : null;
}

/**
 * Checks a set-active request before Better Auth runs it, so a refused switch leaves the open
 * company as it was (Better Auth's own refusal clears it on the way out). Only a company id is
 * accepted: a null id would leave the session with no company, and so under the default timeouts
 * instead of the company's (blueprint p28), and a slug would skip this check. On a host that names
 * a company, only that company can be opened (blueprint p16, "the subdomain picks the company").
 */
async function checkCompanySwitch(
  deps: AuthDeps,
  body: unknown,
  userId: string,
  host: string | undefined,
): Promise<void> {
  const fields = fieldsOf(body);
  const organizationId = fields.organizationId;
  if (typeof organizationId !== "string" || organizationId === "" || "organizationSlug" in fields) {
    throw new APIError("BAD_REQUEST", { code: "company_id_required", message: AUTH_REFUSALS.company_id_required });
  }
  const slug = hostCompanySlug(host);
  if (slug && (await deps.companies.idBySlug(slug)) !== organizationId) {
    throw new APIError("FORBIDDEN", { code: "wrong_host", message: AUTH_REFUSALS.wrong_host });
  }
  const memberships = await deps.companies.membershipsOf(userId);
  if (!memberships.some((company) => company.id === organizationId)) {
    throw new APIError("FORBIDDEN", { code: "not_a_member", message: AUTH_REFUSALS.not_a_member });
  }
}

/**
 * Blueprint p27: MFA cannot be weakened by someone who must have it. They cannot turn off the
 * authenticator app, which also guards their password sign-ins, and cannot remove their last
 * passkey when they have no authenticator app.
 */
async function checkNoDowngrade(deps: AuthDeps, path: string, userId: string): Promise<void> {
  if (path !== "/two-factor/disable" && path !== "/passkey/delete-passkey") return;
  const status = await deps.mfa.statusOf(userId);
  const refused = status.required && (path === "/two-factor/disable" || (!status.totp && status.passkeys <= 1));
  if (refused) throw new APIError("FORBIDDEN", { code: "mfa_required", message: AUTH_REFUSALS.mfa_required });
}

/** Tells the person a passkey was added, so one added by someone else does not go unnoticed. */
async function notifyPasskeyAdded(deps: AuthDeps, to: string): Promise<void> {
  await deps.email.send({
    from: deps.emailFrom,
    to: [to],
    subject: "A passkey was added to your account",
    text: "A passkey was just added to your account, and it can now be used to sign in.\n\nIf this was not you, sign in, remove the passkey, change your password and tell your company's owner.",
  });
}

/**
 * Runs before every Better Auth endpoint: closes endpoints we do not offer, refuses a locked
 * account, applies the company timeouts, keeps a session that must enrol MFA to the enrolment
 * endpoints, asks for the password before a passkey is added, and checks company switches.
 */
export function beforeAuthHook(deps: AuthDeps) {
  return createAuthMiddleware(async (ctx) => {
    const path = ctx.path;
    if ((path.startsWith("/organization/") && !OPEN_ORGANIZATION_PATHS.has(path)) || CLOSED_PATHS.has(path)) {
      throw new APIError("NOT_FOUND");
    }
    // A new session here would restart the absolute timeout (blueprint p28).
    if (path === "/passkey/verify-registration" && fieldsOf(ctx.body).createSession === true) {
      throw new APIError("BAD_REQUEST", {
        code: "create_session_unsupported",
        message: AUTH_REFUSALS.create_session_unsupported,
      });
    }
    if (SECOND_FACTOR_PATHS.has(path) && fieldsOf(ctx.body).trustDevice === true) {
      throw new APIError("BAD_REQUEST", {
        code: "trust_device_unsupported",
        message: AUTH_REFUSALS.trust_device_unsupported,
      });
    }
    // Direct server calls (SessionService.verify) apply their own checks.
    if (!ctx.request) return;
    if (path === "/sign-in/email") {
      const email = signInEmail(ctx.body);
      if (email && (await deps.attempts.reservePasswordAttempt(email, requestIp(ctx.request.headers)))) {
        throw new APIError("TOO_MANY_REQUESTS", { code: "account_locked", message: LOCKED_MESSAGE });
      }
    }
    if (isSessionless(path)) return;
    const current = await getSessionFromCtx(ctx);
    if (!current) return;
    // Blueprint p28: Better Auth's expiry is only a ceiling, so the company's idle and absolute
    // timeouts are checked here as well as in SessionService. Without this, an endpoint such as
    // set-active would accept an idle session and reset its activity time (updatedAt).
    const timeouts = await deps.companies.timeoutsOf(current.session.activeOrganizationId);
    const ended = sessionExpiry(current.session, timeouts, new Date());
    if (ended) {
      await ctx.context.internalAdapter.deleteSession(current.session.token);
      throw new APIError("UNAUTHORIZED", { code: "session_expired", message: SESSION_ENDED_MESSAGES[ended] });
    }
    if (!ENROLMENT_PATHS.has(path) && (await deps.mfa.statusOf(current.user.id)).state === "enrolment_required") {
      throw new APIError("FORBIDDEN", {
        code: "mfa_enrolment_required",
        message: AUTH_REFUSALS.mfa_enrolment_required,
      });
    }
    await checkNoDowngrade(deps, path, current.user.id);
    if (PASSKEY_REGISTER_PATHS.has(path)) {
      const proof = await ctx.context.internalAdapter.findVerificationValue(passkeyStepUpId(current.session.id));
      if (!proof || new Date(proof.expiresAt) <= new Date()) {
        throw new APIError("FORBIDDEN", {
          code: "password_confirmation_required",
          message: AUTH_REFUSALS.password_confirmation_required,
        });
      }
    }
    if (path === "/two-factor/verify-totp") sessionStarts.set(ctx.request, new Date(current.session.createdAt));
    if (path === "/organization/set-active") {
      await checkCompanySwitch(deps, ctx.body, current.user.id, requestHost(ctx.request.headers));
    }
  });
}

/**
 * Runs after every Better Auth endpoint. On a password sign-in, a correct password resets the
 * lockout count (a wrong one needs nothing: its reserved attempt already counts as a failure), and
 * a password-only sign-in by someone who must use MFA and has only a passkey is refused. It also
 * keeps the absolute timeout across the authenticator-app session swap, and records the password
 * step before a passkey is added.
 */
export function afterAuthHook(deps: AuthDeps) {
  return createAuthMiddleware(async (ctx) => {
    if (!ctx.request) return;
    const returned = ctx.context.returned;
    const succeeded = !(returned instanceof APIError);
    if (ctx.path === "/sign-in/email") {
      const email = signInEmail(ctx.body);
      // Better Auth reports an unconfirmed email only after checking the password.
      const passwordRight = succeeded || (returned instanceof APIError && returned.body?.code === "EMAIL_NOT_VERIFIED");
      if (email && passwordRight) await deps.attempts.record("password_ok", email, requestIp(ctx.request.headers));
      const created = ctx.context.newSession;
      // With an authenticator app enrolled, the two-factor plugin asks for the code next.
      if (!succeeded || !created || created.user.twoFactorEnabled === true) return;
      const status = await deps.mfa.statusOf(created.user.id);
      if (status.required && !status.totp && status.passkeys > 0) {
        await ctx.context.internalAdapter.deleteSession(created.session.token);
        deleteSessionCookie(ctx);
        ctx.context.setNewSession(null);
        throw new APIError("FORBIDDEN", { code: "passkey_required", message: AUTH_REFUSALS.passkey_required });
      }
      return;
    }
    if (!succeeded) return;
    if (ctx.path === "/two-factor/verify-totp") {
      const startedAt = sessionStarts.get(ctx.request);
      const created = ctx.context.newSession;
      if (startedAt && created) {
        await deps.db.update(sessionTable).set({ createdAt: startedAt }).where(eq(sessionTable.id, created.session.id));
      }
      return;
    }
    if (ctx.path !== "/verify-password" && ctx.path !== "/passkey/verify-registration") return;
    const current = await getSessionFromCtx(ctx);
    if (ctx.path === "/verify-password" && current) {
      const id = passkeyStepUpId(current.session.id);
      await ctx.context.internalAdapter.deleteVerificationByIdentifier(id);
      await ctx.context.internalAdapter.createVerificationValue({
        identifier: id,
        value: current.user.id,
        expiresAt: new Date(Date.now() + PASSKEY_STEP_UP_MS),
      });
    } else if (ctx.path === "/passkey/verify-registration" && current) {
      await ctx.context.internalAdapter.deleteVerificationByIdentifier(passkeyStepUpId(current.session.id));
      void notifyPasskeyAdded(deps, current.user.email).catch(() => deps.logError("Could not send a passkey notice."));
    }
  });
}
