import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";

/**
 * Schema-only Better Auth config, read by the `auth` CLI to regenerate src/control/auth.ts. It must
 * list the same plugins and id strategy as the runtime config in apps/api/src/core/auth/auth.ts, so
 * the tables match what the API writes. It never runs in the app and needs no database or secret.
 *
 * Regenerate with: pnpm --filter @workspace/db auth:generate
 */
export const auth = betterAuth({
  database: drizzleAdapter({}, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  // UUID ids so user ids fit the uuid user links in the control and company databases (ADR 0028).
  // The API makes them as UUID v7; this setting only gives the columns the uuid type.
  advanced: { database: { generateId: "uuid" } },
  // The API keeps its per-IP sign-in and MFA limits in the database, so they hold across instances.
  rateLimit: { enabled: true, storage: "database" },
  plugins: [organization(), twoFactor(), passkey()],
});
