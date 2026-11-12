import { expect, test, type Page } from "@playwright/test";
import { PHONE } from "../e2e/helpers";

/** Summit's owner, seeded with SEED_USER_PASSWORD by `pnpm db:seed`. */
const OWNER_EMAIL = "dana.whitfield@summitfloor.example";

function seedPassword(): string {
  const password = process.env.E2E_USER_PASSWORD ?? process.env.SEED_USER_PASSWORD;
  if (!password) throw new Error("Set SEED_USER_PASSWORD (the password `pnpm db:seed` gave the seeded users).");
  return password;
}

async function signIn(page: Page, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test.describe("real sign-in (api mode)", () => {
  test("the owner signs in with email and password and lands on the dashboard", async ({ page, context }) => {
    await signIn(page, seedPassword());
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name.endsWith("better-auth.session_token"));
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
  });

  test("a wrong password is refused with a plain message", async ({ page }) => {
    await signIn(page, `${seedPassword()}-wrong`);
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveText(
      "That email and password do not match. Check them and try again.",
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signing out ends the session, and the app sends you back to sign in", async ({ page }) => {
    await signIn(page, seedPassword());
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await page.getByRole("button", { name: "Account: Dana Whitfield" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/");
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
