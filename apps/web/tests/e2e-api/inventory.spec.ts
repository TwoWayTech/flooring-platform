import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, signInAs } from "./accounts";

/**
 * Inventory, part 1 on the real API (ADR 0035): the seeded catalog and rolls come from Summit's own
 * database. The manager needs no MFA, so the test signs straight in.
 */
test.describe("inventory (api mode)", () => {
  test("a manager sees Summit's products, rolls and paid holds from the API", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);
    await page.goto("/inventory");
    await expect(page.getByText("Harbor Twist Pewter").first()).toBeVisible();
    await page.goto("/inventory?view=rolls");
    await expect(page.getByText("NM-7736").first()).toBeVisible();
    // Ready to cut lists the paid holds from the API (inventory part 2; ADR 0043).
    await page.goto("/inventory?view=ready");
    await expect(page.getByText("INV-1202").first()).toBeVisible();
  });
});
