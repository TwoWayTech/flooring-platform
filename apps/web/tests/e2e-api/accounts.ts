import { expect, test, type Page } from "@playwright/test";
import { totpCode } from "@workspace/db/testing";

/** Summit's owner, seeded with SEED_USER_PASSWORD by `pnpm db:seed`. The Owner role requires MFA. */
export const OWNER_EMAIL = "dana.whitfield@summitfloor.example";

/** Summit's store manager: can see Settings → Users but not change it; the role needs no MFA. */
export const MANAGER_EMAIL = "luis.ortega@summitfloor.example";

/** Summit's sales rep: holds meetings create and edit at own scope; the role needs no MFA. */
export const SALES_EMAIL = "priya.natarajan@summitfloor.example";

/** The seeded accounts these tests sign in with, reset before each run (global-setup.ts). */
export const SEEDED_EMAILS = [OWNER_EMAIL, MANAGER_EMAIL, SALES_EMAIL] as const;

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

/**
 * Signs a seeded user without MFA in through the real login page and waits for the app shell. The
 * API allows 10 sign-ins a minute from one address (ADR 0029), and the whole suite signs in from
 * one, so a refusal for that reason waits out the minute once and tries again.
 */
export async function signInAs(page: Page, email: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(seedPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const shell = page.getByRole("navigation", { name: "Main" });
    const limited = page.getByText("Too many attempts from this network.");
    await expect(shell.or(limited)).toBeVisible();
    if (await shell.isVisible()) return;
    // The wait is longer than a test may run by default, so the test gets that much more time.
    test.info().setTimeout(test.info().timeout + 70_000);
    await page.waitForTimeout(61_000);
  }
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/**
 * Signs the seeded owner in and enrols an authenticator app, which the platform guard requires.
 * Returns the app's setup key, so a later step-up can compute the next code.
 */
export async function signInAndEnrolOwner(page: Page): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(seedPassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Confirm your password").fill(seedPassword());
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = (await page.getByTestId("mfa-setup-key").getAttribute("data-key")) ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.getByLabel("Code from the app").fill(totpCode(secret));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await page.getByLabel("I have saved my backup codes").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  return secret;
}
