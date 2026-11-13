import { expect, test, type Page } from "@playwright/test";
import { PHONE } from "../e2e/helpers";
import { nextCode, OWNER_EMAIL, seedPassword, totpCode } from "./accounts";

async function signIn(page: Page, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account: Dana Whitfield" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

// The tests share the owner's account: the first enrols the authenticator app the rest use.
test.describe.configure({ mode: "serial" });

test.describe("real sign-in with MFA (api mode)", () => {
  let secret = "";
  let backupCodes: string[] = [];

  test("the owner must set up two-step sign-in, then lands on the dashboard", async ({ page }) => {
    await signIn(page, seedPassword());
    await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();

    await page.getByLabel("Confirm your password").fill(seedPassword());
    await page.getByRole("button", { name: "Continue" }).click();
    secret = (await page.getByTestId("mfa-setup-key").getAttribute("data-key")) ?? "";
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    await page.getByLabel("Code from the app").fill(totpCode(secret));
    await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();

    const codes = page.getByRole("list", { name: "Backup codes" }).getByRole("listitem");
    await expect(codes).toHaveCount(10);
    backupCodes = await codes.allTextContents();
    const done = page.getByRole("button", { name: "Continue" });
    await expect(done).toBeDisabled();
    await page.getByLabel("I have saved my backup codes").check();
    await done.click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });

  test("signing in again asks for the code, refuses a wrong one, and sets a safe cookie", async ({ page, context }) => {
    await signIn(page, seedPassword());
    const code = page.getByLabel("Authenticator code");
    await expect(code).toBeVisible();
    await code.fill("000000");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveText(
      "That code did not work. Enter the current code from your authenticator app.",
    );
    await code.fill(nextCode(secret));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name.endsWith("better-auth.session_token"));
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
  });

  test("a backup code signs in when the phone is not at hand, and signing out ends the session", async ({ page }) => {
    await signIn(page, seedPassword());
    await page.getByRole("button", { name: "Use a backup code instead" }).click();
    await page.getByLabel("Backup code").fill(backupCodes[0]);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await signOut(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a wrong password is refused with a plain message", async ({ page }) => {
    await signIn(page, `${seedPassword()}-wrong`);
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveText(
      "That email and password do not match. Check them and try again.",
    );
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("real sign-in on a phone", () => {
  test.use(PHONE);

  test("lays out at 375 px with no sideways scroll", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
