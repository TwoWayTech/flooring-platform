import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("inventory", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("cutting a roll updates the remaining length and creates a remnant", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory/rolls/sm-roll-0004");
    await expect(page.getByText("93.00 ft").first()).toBeVisible();

    await page.getByRole("button", { name: "Cut roll" }).click();
    await page.getByLabel("Length to cut").fill("20");
    await expect(page.getByText("Leaves 73.00 ft on the roll.")).toBeVisible();
    await page.getByLabel("For").fill("INV-1042");
    await page.getByRole("dialog").getByRole("button", { name: "Cut roll" }).click();
    await expect(page.getByText("73.00 ft").first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "INV-1042" })).toBeVisible();

    await page.getByRole("button", { name: "Cut roll" }).click();
    await page.getByLabel("Length to cut").fill("65");
    await expect(page.getByText(/which becomes a remnant/)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cut roll" }).click();
    const remnants = page.getByRole("region", { name: "Remnants from this roll" });
    await expect(remnants.getByText("8.00 ft")).toBeVisible();
    await expect(page.getByText("0.00 ft").first()).toBeVisible();
  });

  test("refuses a cut longer than the roll", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory/rolls/sm-roll-0004");
    await page.getByRole("button", { name: "Cut roll" }).click();
    await page.getByLabel("Length to cut").fill("500");
    await expect(page.getByText("Only 93 ft is left on this roll.")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Cut roll" })).toBeDisabled();
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
