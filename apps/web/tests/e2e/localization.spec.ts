import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("settings: localization and tax", () => {
  test("sales tax rules feed the quote builder", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/localization?tab=tax");
    await page.getByRole("switch", { name: "Installation labor taxable in Colorado" }).click();
    await page.getByRole("button", { name: "Save sales tax" }).click();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Sales tax saved")).toBeVisible();

    await page.goto("/sales/quotes/new");
    await page.getByRole("button", { name: "Add room" }).click();
    await page.getByRole("button", { name: "Add labor or service" }).click();
    await page.getByPlaceholder("Search by name, color or brand").fill("Hard surface installation");
    await page.getByRole("option").first().click();
    await expect(page.getByText(/Installation labor is taxed in Colorado/)).toBeVisible();
  });

  test("changes the date format used across the app", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/localization?tab=region");
    await page.getByLabel("Date format").click();
    await page.getByRole("option", { name: /^\d{4}-\d{2}-\d{2}$/ }).click();
    await page.getByRole("button", { name: "Save region" }).click();
    await page.goto("/inventory/rolls/sm-roll-0004");
    await expect(page.getByRole("cell", { name: /^\d{4}-\d{2}-\d{2}, / }).first()).toBeVisible();
  });
});
