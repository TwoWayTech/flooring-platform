import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { CompanyFixtures } from "@workspace/shared";
import { SUMMIT_OWNER, signInAs, skipIfFeatureOff } from "./helpers";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../packages/shared/fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;
const boxed = summit.products.find((p) => p.sqFtPerCarton === "23.64")!;

test.describe("square feet everywhere (spec A1)", () => {
  test.beforeEach(() => skipIfFeatureOff("units.square-feet"));

  test("typing cartons converts to sq ft, rounded up, with the hint beside it", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await page.getByRole("button", { name: "Add product" }).click();
    await page.keyboard.type(boxed.sku);
    await page.getByRole("option").first().click();
    const quantity = page.getByLabel(`${boxed.brand} ${boxed.name} quantity`);
    await quantity.fill("22c");
    await quantity.blur();
    await expect(quantity).toHaveValue("520.08");
    await expect(page.getByText("≈ 22 cartons (23.64 sq ft each)")).toBeVisible();
    await quantity.fill("500");
    await quantity.blur();
    await expect(quantity).toHaveValue("520.08");
  });

  test("inventory reads in sq ft with cartons beside it, and rolls lead with area", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory");
    await expect(page.getByRole("cell", { name: /per sq ft/ }).first()).toBeVisible();
    await expect(page.getByText(/≈ [\d,]+ cartons/).first()).toBeVisible();
    await page.getByRole("tab", { name: "Rolls and remnants" }).click();
    await expect(page.getByRole("button", { name: "Area" })).toBeVisible();
    await expect(page.getByText(/sq yd/)).toHaveCount(0);
  });

  test("the area unit can no longer be changed", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/localization");
    await expect(page.getByText("Default area unit")).toHaveCount(0);
  });
});
