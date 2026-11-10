import { expect, test, type Page } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

async function invite(page: Page, name: string) {
  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Email").fill(`${name.toLowerCase().replace(/ /g, ".")}@summitfloor.example`);
  await dialog.getByLabel(/^Sales/).check();
  await dialog.getByRole("button", { name: "Send invitation" }).click();
}

test.describe("settings: users", () => {
  test("enforces the seat limit", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/users");
    await expect(page.getByText("14 of 16 seats used")).toBeVisible();
    await invite(page, "Avery Lane");
    await expect(page.getByText("15 of 16 seats used")).toBeVisible();
    await invite(page, "Blake Moreno");
    await expect(page.getByText("16 of 16 seats used")).toBeVisible();
    await invite(page, "Casey North");
    await expect(page.getByRole("alert")).toContainText("All 16 seats on your plan are in use");
  });

  test("refuses to disable the last active Owner", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/users");
    await page.getByRole("button", { name: "Actions for Dana Whitfield" }).click();
    await page.getByRole("menuitem", { name: "Disable user" }).click();
    await expect(page.getByText("This is the last active Owner. Make someone else an Owner first.")).toBeVisible();
  });

  test("resets MFA after a step-up code", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/users");
    await page.getByRole("button", { name: "Actions for Grace Liu" }).click();
    await page.getByRole("menuitem", { name: "Reset MFA" }).click();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("MFA reset for Grace Liu")).toBeVisible();
  });
});
