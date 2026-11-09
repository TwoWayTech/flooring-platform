import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("inventory", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  // Spec C1: a cut always has a source. Cutting for an invoice is in stock.spec.ts; here, an adjustment.
  test("a cut without an invoice is a stock adjustment with a reason", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory/rolls/sm-roll-0004");
    await expect(page.getByText("93.00 ft").first()).toBeVisible();
    await page.getByRole("button", { name: "Cut roll" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Adjustment" }).click();
    await dialog.getByLabel("Length to remove").fill("20");
    await expect(dialog.getByText("Leaves 73.00 ft on the roll.")).toBeVisible();
    await dialog.getByRole("button", { name: "Record adjustment" }).click();
    await expect(page.getByText("73.00 ft").first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /^ADJ-\d{4}$/ })).toBeVisible();
  });

  test("refuses a cut longer than the roll", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory/rolls/sm-roll-0004");
    await page.getByRole("button", { name: "Cut roll" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Adjustment" }).click();
    await dialog.getByLabel("Length to remove").fill("500");
    await expect(dialog.getByText("Only 93 ft is left on this roll.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Record adjustment" })).toBeDisabled();
  });

  test("lists rolls under 20 ft from the attention link", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory?view=rolls&inventory-rolls.f.type=Low");
    await expect(page.getByText("3 of 60")).toBeVisible();
  });

  test("hides costs when viewing as Sales", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory");
    await expect(page.getByRole("button", { name: "Cost, column options" })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Sales");
    await page.getByRole("option", { name: "View as Sales" }).click();
    await expect(page.getByRole("button", { name: "Price, column options" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cost, column options" })).toHaveCount(0);
  });
});
