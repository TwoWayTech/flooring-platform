import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, signInAs } from "./accounts";

/**
 * Purchasing, part 1 on the real API (ADR 0036): Summit's orders and supplier directory come from
 * its own database. The manager needs no MFA, so the test signs straight in.
 */
test.describe("purchasing (api mode)", () => {
  test("a manager sees Summit's purchase orders and suppliers from the API", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);
    await page.goto("/purchasing?view=orders");
    await expect(page.getByText("PO-3001").first()).toBeVisible();
    await page.goto("/purchasing?view=suppliers");
    await expect(page.getByText("Northline Mills").first()).toBeVisible();
  });
});
