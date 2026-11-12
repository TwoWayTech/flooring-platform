import type { ControlDb } from "@workspace/db";
import * as controlSchema from "@workspace/db/control";
import type { EmailProvider } from "@workspace/providers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { v7 as uuidv7 } from "uuid";
import type { CompanyDirectory } from "./company-directory";
import { hostCompanySlug, pickCompany } from "./company-pick";
import { SESSION_CEILING_SECONDS, SESSION_ENDED_MESSAGES, sessionExpiry } from "./session-timeouts";

/** What the Better Auth instance needs from the app. */
export interface AuthDeps {
  db: ControlDb;
  companies: CompanyDirectory;
  email: EmailProvider;
  emailFrom: string;
  secret: string;
  /** Web hosts that serve sign-in (AUTH_ALLOWED_HOSTS). */
  allowedHosts: string[];
  /** Extra origins allowed to call auth endpoints (CORS_ORIGINS). */
  trustedOrigins: string[];
  /** Secure cookies outside development and tests. */
  secureCookies: boolean;
  /** Where unexpected failures are reported, without tokens or passwords. */
  logError: (message: string) => void;
}

/** The shortest password allowed (blueprint p27). */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Organization endpoints the web app may call. Membership, invitations and roles are managed by
 * our own modules behind the permission engine (CLAUDE.md rule 3), so the plugin's other
 * endpoints are closed.
 */
const OPEN_ORGANIZATION_PATHS = new Set(["/organization/set-active", "/organization/list"]);

/**
 * Auth endpoints that must work without a valid session, or with one a timeout has ended: signing
 * in again, signing out, and the email and password-reset links. Every other endpoint gets the
 * company's timeouts too, so no Better Auth call can use or revive an ended session.
 */
const SESSIONLESS_PATHS = new Set([
  "/sign-in/email",
  "/sign-out",
  "/verify-email",
  "/send-verification-email",
  "/request-password-reset",
  "/ok",
  "/error",
]);

/** Whether an auth endpoint is exempt from the company timeouts. */
function isSessionless(path: string): boolean {
  return SESSIONLESS_PATHS.has(path) || path.startsWith("/reset-password");
}

const REFUSALS = {
  not_a_member: "This account is not a member of this company. Sign in on your company's own address.",
  no_company: "This account is not part of any company yet. Ask your company's owner to invite you.",
} as const;

/** The web host a request came through; the web app's proxy forwards it (ADR 0029). */
function requestHost(headers: Headers | undefined): string | undefined {
  return headers?.get("x-forwarded-host") ?? headers?.get("host") ?? undefined;
}

/**
 * Better Auth for the control database (blueprint p12, p27-28; ADR 0029): email and password with
 * verification and no public sign-up, the organization plugin with organization id = tenant id,
 * UUID v7 ids, and a session that opens the right company. Per-company idle and absolute timeouts
 * are enforced by SessionService, because Better Auth's expiry is global.
 */
export function createAuth(deps: AuthDeps) {
  return betterAuth({
    secret: deps.secret,
    baseURL: { allowedHosts: deps.allowedHosts },
    trustedOrigins: deps.trustedOrigins,
    database: drizzleAdapter(deps.db, { provider: "pg", schema: controlSchema }),
    emailAndPassword: {
      enabled: true,
      // Accounts are invite-only: owners are invited at provisioning, users by their admins.
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    emailVerification: {
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        // Not awaited, so the answer takes the same time whether or not an email goes out.
        void deps.email
          .send({
            from: deps.emailFrom,
            to: [user.email],
            subject: "Confirm your email address",
            text: `Confirm your email address to finish signing in:\n\n${url}\n\nIf you did not try to sign in, you can ignore this email.`,
          })
          .catch(() => deps.logError("Could not send a verification email."));
      },
    },
    session: {
      expiresIn: SESSION_CEILING_SECONDS,
      // Activity and expiry are recorded by SessionService on each guarded request instead.
      disableSessionRefresh: true,
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      useSecureCookies: deps.secureCookies,
      // The web app proxies /api/auth/* here, so the browser's host arrives as x-forwarded-host.
      trustedProxyHeaders: true,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            const slug = hostCompanySlug(requestHost(context?.request?.headers ?? context?.headers));
            const hostCompanyId = slug ? await deps.companies.idBySlug(slug) : null;
            const memberships = await deps.companies.membershipsOf(session.userId);
            const pick = pickCompany(
              hostCompanyId,
              memberships.map((company) => company.id),
            );
            if (pick.kind === "refuse") {
              throw new APIError("FORBIDDEN", { code: pick.reason, message: REFUSALS[pick.reason] });
            }
            return {
              data: { ...session, activeOrganizationId: pick.kind === "open" ? pick.companyId : null },
            };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path.startsWith("/organization/") && !OPEN_ORGANIZATION_PATHS.has(ctx.path)) {
          throw new APIError("NOT_FOUND");
        }
        // Direct server calls (SessionService.verify) apply the timeouts themselves.
        if (!ctx.request || isSessionless(ctx.path)) return;
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
        if (ctx.path === "/organization/set-active") {
          // Checked here so a refused switch leaves the open company as it was; Better Auth's own
          // check refuses too, but clears the session's active company on the way out.
          const organizationId: unknown = ctx.body?.organizationId;
          if (typeof organizationId !== "string") return;
          const memberships = await deps.companies.membershipsOf(current.user.id);
          if (!memberships.some((company) => company.id === organizationId)) {
            throw new APIError("FORBIDDEN", { code: "not_a_member", message: REFUSALS.not_a_member });
          }
        }
      }),
    },
    plugins: [organization({ allowUserToCreateOrganization: false })],
  });
}

/** The configured Better Auth instance. */
export type Auth = ReturnType<typeof createAuth>;
