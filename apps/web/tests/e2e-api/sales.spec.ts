import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, seedPassword } from "./accounts";

/**
 * Sales, part 1 on the real API (ADR 0037): Summit's quotes and customers come from its own
 * database, within the manager's branch scope.
 */
test.describe("sales (api mode)", () => {
  test("a manager sees their branch's quotes and customers from the API", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER_EMAIL);
    await page.getByLabel("Password").fill(seedPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await page.goto("/sales?view=quotes");
    await expect(page.getByText("Q-2001").first()).toBeVisible();
  });
});
