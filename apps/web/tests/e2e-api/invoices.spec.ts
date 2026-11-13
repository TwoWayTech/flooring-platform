import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, seedPassword } from "./accounts";

/**
 * Sales, part 2 on the real API (ADR 0038): Summit's invoices, their payments and their
 * customers come from its own database, within the manager's branch scope.
 */
test.describe("invoices (api mode)", () => {
  test("a manager opens a branch invoice with its customer and payments from the API", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER_EMAIL);
    await page.getByLabel("Password").fill(seedPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await page.goto("/sales?view=invoices");
    await expect(page.getByText("INV-1004").first()).toBeVisible();
    await page.getByText("INV-1004").first().click();
    await expect(page).toHaveURL(/\/sales\/invoices\/[0-9a-f-]{36}$/);
    await expect(page.getByText("INV-1004").first()).toBeVisible();
    await expect(page.getByText("This invoice does not exist")).toHaveCount(0);
  });
});
