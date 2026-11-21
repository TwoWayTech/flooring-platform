import { expect, test, type Page } from "@playwright/test";
import { totpCode } from "@workspace/db/testing";

/** Summit's owner, seeded with SEED_USER_PASSWORD by `pnpm db:seed`. The Owner role requires MFA. */
export const OWNER_EMAIL = "dana.whitfield@summitfloor.example";

/** Summit's store manager: can see Settings → Users but not change it; the role needs no MFA. */
export const MANAGER_EMAIL = "luis.ortega@summitfloor.example";

/** Summit's sales rep: holds meetings create and edit at own scope; the role needs no MFA. */
export const SALES_EMAIL = "priya.natarajan@summitfloor.example";

/** Summit's bookkeeper: confirms and voids payments, enters bills and expenses, reads the ledger; the role needs MFA. */
export const ACCOUNTANT_EMAIL = "grace.liu@summitfloor.example";

/** Summit's HR manager: decides timesheets and time off and reviews pay periods; the role needs MFA. */
export const HR_EMAIL = "tamara.reyes@summitfloor.example";

/** Summit's hourly office assistant: her own timesheet and time off at own scope; the role needs no MFA. */
export const EMPLOYEE_EMAIL = "bri.alvarez@summitfloor.example";

/** Summit's warehouse lead (branch Colorado Springs): cuts rolls for stock holds; the role needs no MFA. */
export const WAREHOUSE_EMAIL = "cole.brennan@summitfloor.example";

/** Summit's purchasing coordinator: suppliers, purchase orders and receipts; the role needs no MFA. */
export const PURCHASING_EMAIL = "renata.kowalski@summitfloor.example";

/**
 * Summit's installer: his own jobs and My portal; the role needs no MFA. Not in SEEDED_EMAILS: only
 * the whole-product check's page-gate matrix signs him in, and it resets his sign-in state itself.
 */
export const INSTALLER_EMAIL = "marcus.bell@summitfloor.example";

/**
 * Summit's sales rep Victor Sims, seeded disabled: he signs in and holds nothing, so `GET /company`
 * refuses him (ADR 0051, "GET /company"). Not in SEEDED_EMAILS: no test changes him, and only
 * company.spec.ts signs him in, resetting his sign-in state around itself.
 */
export const DISABLED_EMAIL = "victor.sims@summitfloor.example";

/**
 * Harbor Staffing Co.'s Owner, Elena Brooks: the HR Suite company `pnpm db:seed` writes for local testing
 * only (ADR 0065). The Owner role requires MFA. She signs in on the HR host (`/login?product=hr` on localhost).
 */
export const HARBOR_OWNER_EMAIL = "elena.brooks@harborstaffing.example";

/** The seeded accounts these tests sign in with, reset before each run (global-setup.ts). */
export const SEEDED_EMAILS = [
  OWNER_EMAIL,
  MANAGER_EMAIL,
  SALES_EMAIL,
  ACCOUNTANT_EMAIL,
  HR_EMAIL,
  EMPLOYEE_EMAIL,
  WAREHOUSE_EMAIL,
  PURCHASING_EMAIL,
  HARBOR_OWNER_EMAIL,
] as const;

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
  return signInAndEnrol(page, OWNER_EMAIL);
}

/**
 * Signs a seeded user whose role requires MFA (Owner, Accountant, HR manager) in through the real
 * login page and enrols an authenticator app, as the API asks at their first sign-in. Returns the
 * app's setup key, so a later step-up can compute the next code. Run it on a user without an
 * authenticator: global-setup.ts or the spec's own reset clears it.
 */
export async function signInAndEnrol(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
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
