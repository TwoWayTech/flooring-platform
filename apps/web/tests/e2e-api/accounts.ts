import { totpCode } from "@workspace/db/testing";

/** Summit's owner, seeded with SEED_USER_PASSWORD by `pnpm db:seed`. The Owner role requires MFA. */
export const OWNER_EMAIL = "dana.whitfield@summitfloor.example";

/** Summit's store manager: can see Settings → Users but not change it; the role needs no MFA. */
export const MANAGER_EMAIL = "luis.ortega@summitfloor.example";

/** The seeded accounts these tests sign in with, reset before each run (global-setup.ts). */
export const SEEDED_EMAILS = [OWNER_EMAIL, MANAGER_EMAIL] as const;

/** The password `pnpm db:seed` gave the seeded users. */
export function seedPassword(): string {
  const password = process.env.E2E_USER_PASSWORD ?? process.env.SEED_USER_PASSWORD;
  if (!password) throw new Error("Set SEED_USER_PASSWORD (the password `pnpm db:seed` gave the seeded users).");
  return password;
}

/**
 * The authenticator code for the next 30-second step. Within the allowed clock drift, and never the
 * code just used, so a code is not refused as a repeat.
 */
export function nextCode(secret: string): string {
  return totpCode(secret, new Date(Date.now() + 30_000));
}

export { totpCode };
