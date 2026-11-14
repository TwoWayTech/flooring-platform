import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, signInAs } from "./accounts";

/**
 * Settings → Users on the real API, and the public password and invitation pages (P10 part 2;
 * draft spec docs/specs/settings-users-access.md). The owner's step-up flow is in login.spec.ts,
 * which enrols the owner's authenticator app.
 */
test.describe("users and account access (api mode)", () => {
  test("a manager sees the company's people from the API but cannot change them", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);
    await page.goto("/settings/users");
    await expect(page.getByRole("cell", { name: "Dana Whitfield" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite user" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
  });

  test("forgot password answers the same way for any address", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel("Email").fill("nobody@summitfloor.example");
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("status")).toContainText("If nobody@summitfloor.example has an account");
  });

  test("an invitation or reset link that does not work says so plainly", async ({ page }) => {
    // Next.js adds an empty route-announcer alert, so the message is found by its text.
    await page.goto("/accept-invite?token=this-token-was-never-issued-by-anyone-0123");
    await expect(page.getByText("This invitation link has expired or was already used")).toBeVisible();
    await page.goto("/reset-password");
    await expect(page.getByText("This reset link has expired or was already used")).toBeVisible();
  });
});
