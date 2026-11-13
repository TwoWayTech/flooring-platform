import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, seedPassword } from "./accounts";

/**
 * Inventory, part 1 on the real API (ADR 0035): the seeded catalog and rolls come from Summit's own
 * database. The manager needs no MFA, so the test signs straight in.
 */
test.describe("inventory (api mode)", () => {
  test("a manager sees Summit's products and rolls from the API", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER_EMAIL);
    await page.getByLabel("Password").fill(seedPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await page.goto("/inventory");
    await expect(page.getByText("Harbor Twist Pewter").first()).toBeVisible();
    await page.goto("/inventory?view=rolls");
    await expect(page.getByText("NM-7736").first()).toBeVisible();
  });
});
