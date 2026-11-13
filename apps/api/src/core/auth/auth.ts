import { passkey } from "@better-auth/passkey";
import type { ControlDb } from "@workspace/db";
import * as controlSchema from "@workspace/db/control";
import type { EmailProvider } from "@workspace/providers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { organization, twoFactor } from "better-auth/plugins";
import { v7 as uuidv7 } from "uuid";
import { LOCKOUT, type AttemptLog } from "./attempts";
import { afterAuthHook, AUTH_REFUSALS, beforeAuthHook, requestHost } from "./auth-hooks";
import type { CompanyDirectory } from "./company-directory";
import { hostCompanySlug, pickCompany } from "./company-pick";
import type { MfaPolicy } from "./mfa-policy";
import { SESSION_CEILING_SECONDS } from "./session-timeouts";

/** What the Better Auth instance needs from the app. */
export interface AuthDeps {
  db: ControlDb;
  companies: CompanyDirectory;
  mfa: MfaPolicy;
  attempts: AttemptLog;
  email: EmailProvider;
  emailFrom: string;
  secret: string;
  /** Web hosts that serve sign-in (AUTH_ALLOWED_HOSTS). */
  allowedHosts: string[];
  /** Extra origins allowed to call auth endpoints (CORS_ORIGINS). */
  trustedOrigins: string[];
  /**
   * Secure cookies in production. With a per-request base URL, Better Auth has no protocol to detect
   * HTTPS from, so every deployment served over HTTPS must run with NODE_ENV=production.
   */
  secureCookies: boolean;
  /** Where unexpected failures are reported, without tokens or passwords. */
  logError: (message: string) => void;
}

/** The shortest password allowed (blueprint p27). */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * The product name shown by authenticator apps and passkey prompts. A placeholder until the brand
 * name is chosen (docs/real-build-plan.md, open questions).
 */
export const APP_NAME = "Flooring Platform";

/** Owner decision, 2026-11-13: sign-in and MFA checks allow 10 a minute from one IP address. */
const SIGN_IN_RATE = { window: 60, max: 10 } as const;

/**
 * Sends a verification email unless the address has had 3 in the last hour (owner decision,
 * 2026-11-13). Not awaited by the caller, so the answer takes the same time whether or not an
 * email goes out, and a skipped email is silent for the same reason.
 */
async function sendVerification(deps: AuthDeps, to: string, url: string): Promise<void> {
  if (!(await deps.attempts.emailAllowed(to))) return;
  await deps.attempts.record("verification_email", to, null);
  await deps.email.send({
    from: deps.emailFrom,
    to: [to],
    subject: "Confirm your email address",
    text: `Confirm your email address to finish signing in:\n\n${url}\n\nIf you did not try to sign in, you can ignore this email.`,
  });
}

/**
 * The company a new session opens. A session made to replace another (after an authenticator app
 * is confirmed) keeps the company that was open, when the host and memberships still allow it;
 * otherwise the host's company, the user's only company, or none until they choose (ADR 0029).
 */
async function companyForNewSession(
  deps: AuthDeps,
  userId: string,
  carried: string | null | undefined,
  host: string | undefined,
): Promise<string | null> {
  const slug = hostCompanySlug(host);
  const hostCompanyId = slug ? await deps.companies.idBySlug(slug) : null;
  const memberIds = (await deps.companies.membershipsOf(userId)).map((company) => company.id);
  if (carried && memberIds.includes(carried) && (!hostCompanyId || hostCompanyId === carried)) return carried;
  const pick = pickCompany(hostCompanyId, memberIds);
  if (pick.kind === "refuse") {
    throw new APIError("FORBIDDEN", { code: pick.reason, message: AUTH_REFUSALS[pick.reason] });
  }
  return pick.kind === "open" ? pick.companyId : null;
}

/**
 * Better Auth for the control database (blueprint p12, p27-28; ADR 0029): email and password with
 * verification and no public sign-up; TOTP with backup codes and passkeys as second factors; the
 * organization plugin with organization id = tenant id; UUID v7 ids; per-IP limits on sign-in and
 * MFA checks; and a session that opens the right company. Per-company timeouts, the password
 * lockout and mandatory MFA are applied by the hooks in auth-hooks.ts and by SessionService.
 */
export function createAuth(deps: AuthDeps) {
  return betterAuth({
    appName: APP_NAME,
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
        void sendVerification(deps, user.email, url).catch(() => deps.logError("Could not send a verification email."));
      },
    },
    session: {
      expiresIn: SESSION_CEILING_SECONDS,
      // Activity and expiry are recorded by SessionService on each guarded request instead.
      disableSessionRefresh: true,
    },
    // Kept in the database so the limits hold across API instances. Better Auth keys them by IP and
    // path; the IP comes from x-forwarded-for, which the web host sets (ADR 0029, part 2).
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/email": SIGN_IN_RATE,
        "/two-factor/verify-totp": SIGN_IN_RATE,
        "/two-factor/verify-backup-code": SIGN_IN_RATE,
        "/passkey/verify-authentication": SIGN_IN_RATE,
      },
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      useSecureCookies: deps.secureCookies,
      // The web app proxies /api/auth/* here, so the browser's host arrives as x-forwarded-host.
      trustedProxyHeaders: true,
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            const host = requestHost(context?.request?.headers ?? context?.headers);
            const activeOrganizationId = await companyForNewSession(
              deps,
              session.userId,
              session.activeOrganizationId as string | null | undefined,
              host,
            );
            return { data: { ...session, activeOrganizationId } };
          },
        },
      },
    },
    hooks: { before: beforeAuthHook(deps), after: afterAuthHook(deps) },
    plugins: [
      organization({ allowUserToCreateOrganization: false }),
      twoFactor({
        issuer: APP_NAME,
        // Turning the app on or off needs the password (blueprint p27).
        allowPasswordless: false,
        backupCodeOptions: { amount: 10 },
        // Same numbers as the password lockout. Better Auth counts consecutive failures.
        accountLockout: {
          enabled: true,
          maxFailedAttempts: LOCKOUT.failures,
          durationSeconds: LOCKOUT.lockMs / 1000,
        },
      }),
      // No rpID: each product host is its own relying party, taken from the allowed request host.
      passkey({ rpName: APP_NAME }),
    ],
  });
}

/** The configured Better Auth instance. */
export type Auth = ReturnType<typeof createAuth>;
