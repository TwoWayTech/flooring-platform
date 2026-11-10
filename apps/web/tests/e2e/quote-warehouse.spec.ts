import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { availableToSell, type CompanyFixtures } from "@workspace/shared";
import { SUMMIT_OWNER, signInAs, skipIfFeatureOff } from "./helpers";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../packages/shared/fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;
const stock = { rolls: summit.rolls, movements: summit.stockMovements, reservations: summit.reservations };
const home = summit.locations.find((l) => l.isDefault)!;
const product = summit.products.find((p) => {
  const free = availableToSell(p, stock, home.id);
  return p.sqFtPerCarton && free && free.gt(0) && free.lt(4000);
})!;

test.describe("warehouse on new quotes (spec A2)", () => {
  test.beforeEach(() => skipIfFeatureOff("sales.quote-availability"));

  test("starts from Fulfilled from, shows availability, warns when short and offers another warehouse", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    const labels = page.locator("main label");
    await expect(labels.first()).toHaveText("Fulfilled from");
    await page.getByRole("button", { name: "Add product" }).click();
    await page.keyboard.type(product.sku);
    const option = page.getByRole("option").first();
    await expect(option).toContainText(product.sku);
    await expect(option).toContainText("free");
    await option.click();
    await expect(page.getByText(/Available at /)).toBeVisible();
    const quantity = page.getByLabel(`${product.brand} ${product.name} quantity`);
    await quantity.fill("99000");
    await quantity.blur();
    await expect(page.getByText(/free at /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create a transfer" })).toBeVisible();
    await page.getByRole("combobox", { name: `Warehouse for ${product.brand} ${product.name}` }).click();
    await page.getByRole("option", { name: /Ship from Colorado Springs/ }).click();
    await expect(page.getByText(/free at Colorado Springs/)).toBeVisible();
  });

  test("Create a transfer opens prefilled with the short line", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await page.getByRole("button", { name: "Add product" }).click();
    await page.keyboard.type(product.sku);
    await page.getByRole("option").first().click();
    const quantity = page.getByLabel(`${product.brand} ${product.name} quantity`);
    await quantity.fill("99000");
    await quantity.blur();
    await page.getByRole("button", { name: "Create a transfer" }).click();
    const dialog = page.getByRole("dialog", { name: "New transfer" });
    await expect(dialog.getByRole("combobox", { name: "To" })).toContainText(home.name);
    await expect(dialog.getByLabel(`${product.name} quantity`)).toBeVisible();
  });
});
