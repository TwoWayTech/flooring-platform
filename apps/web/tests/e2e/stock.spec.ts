import { expect, test } from "@playwright/test";
import { signInAs, skipIfFeatureOff, SUMMIT_OWNER, type Persona } from "./helpers";

const SUMMIT_WAREHOUSE: Persona = { companyId: "summit", userId: "sm-usr-04", roleKey: "warehouse" };
const PDF = { name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo\n") };

test.describe("inventory linked to invoices (spec C1, C2, C3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("a roll is reserved by its invoice and cut only after the deposit, leaving a remnant", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory/rolls/sm-roll-0004");
    await page.getByRole("button", { name: "Cut roll" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "New invoice" }).click();
    await dialog.getByLabel("Customer", { exact: true }).click();
    await page.getByRole("option").first().click();
    await dialog.getByLabel("Length to sell").fill("85");
    await expect(dialog.getByText(/which becomes a remnant/)).toBeVisible();
    await dialog.getByRole("button", { name: "Create invoice" }).click();
    await expect(page).toHaveURL(/\/sales\/invoices\//);

    const stock = page.getByRole("region", { name: "Stock" });
    await expect(stock.getByText("Reserved", { exact: true })).toBeVisible();
    await expect(stock.getByRole("button", { name: "Cut", exact: true })).toHaveCount(0);
    await expect(stock.getByText(/once a deposit or payment is confirmed/)).toBeVisible();

    await page.getByRole("button", { name: "Record payment" }).click();
    const sheet = page.getByRole("dialog", { name: /Record (payment|deposit)/ });
    await sheet.getByLabel("Amount").fill("900");
    await sheet.getByLabel("Reference or transaction ID").fill("ACH-STOCK-1");
    await sheet.locator("input[type=file]").setInputFiles(PDF);
    await sheet.getByRole("button", { name: "Save payment" }).click();
    await stock.getByRole("button", { name: "Cut", exact: true }).click();
    await expect(stock.getByText("Cut", { exact: true })).toBeVisible();

    await page.goto("/inventory/rolls/sm-roll-0004");
    const remnants = page.getByRole("region", { name: "Remnants from this roll" });
    await expect(remnants.getByText("8.00 ft")).toBeVisible();
    await expect(page.getByRole("link", { name: /^INV-\d+$/ })).toBeVisible();
  });

  test("the Owner corrects a stock count with a reason; Warehouse cannot (plan A-1)", async ({ page }) => {
    skipIfFeatureOff("inventory.stock-correction");
    await signInAs(page, SUMMIT_WAREHOUSE, "/inventory/rolls/sm-roll-0004");
    await expect(page.getByRole("button", { name: "Cut roll" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Correct stock count" })).toHaveCount(0);
    await signInAs(page, SUMMIT_OWNER, "/inventory/rolls/sm-roll-0004");
    await page.getByRole("button", { name: "Correct stock count" }).click();
    const dialog = page.getByRole("dialog", { name: "Correct stock count" });
    await dialog.getByLabel("Counted (ft)").fill("50");
    await dialog.getByRole("button", { name: "Correct stock count" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Say why");
    await dialog.getByLabel("Reason").fill("Measured during the yearly count");
    await dialog.getByRole("button", { name: "Correct stock count" }).click();
    await expect(page.getByText(/Stock count corrected/)).toBeVisible();
    await expect(page.getByText("50.00 ft").first()).toBeVisible();
    await page.goto("/settings/audit");
    await expect(page.getByRole("cell", { name: "Corrected stock count" })).toBeVisible();
  });

  test("Warehouse sees what invoices hold, and cuts paid work from Ready to cut (audit U-03, U-22)", async ({
    page,
  }) => {
    skipIfFeatureOff("inventory.ready-to-cut");
    await signInAs(page, SUMMIT_WAREHOUSE, "/inventory?view=ready");
    const row = page.getByRole("row", { name: /INV-/ }).first();
    await expect(row).toBeVisible();
    const number = (await row.getByRole("cell").first().innerText()).trim();
    await row.getByRole("button", { name: /^(Cut|Issue)$/ }).click();
    await expect(page.getByText(new RegExp(`(Cut|Issued) for ${number}`))).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(number) })).toHaveCount(0);
  });

  test("an adjustment above the limit waits for an Owner, who approves it from Needs attention", async ({ page }) => {
    skipIfFeatureOff("inventory.adjustments");
    await signInAs(page, SUMMIT_WAREHOUSE, "/inventory?view=products");
    await page.getByPlaceholder("Search products").fill("Terrace Tile Driftwood");
    await page
      .getByRole("row", { name: /Terrace Tile Driftwood/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Adjust stock" }).click();
    const dialog = page.getByRole("dialog", { name: "Adjust stock" });
    await dialog.getByLabel("Change").fill("60");
    await dialog.getByRole("button", { name: "Record adjustment" }).click();
    const toast = page.getByText(/ADJ-\d{4} waits for approval/);
    await expect(toast).toBeVisible();
    const number = /ADJ-\d{4}/.exec(await toast.innerText())![0];

    await signInAs(page, SUMMIT_OWNER, "/");
    await page
      .getByRole("link", { name: /stock adjustments? to approve/ })
      .first()
      .click();
    await expect(page).toHaveURL(/view=adjustments/);
    await page.getByRole("button", { name: `Approve ${number}` }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(number) }).getByText("Applied", { exact: true }),
    ).toBeVisible();
  });

  test("products show On hand, Reserved and Available with stock badges in words", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory?view=products");
    for (const name of ["On hand", "Reserved", "Available"]) {
      await expect(page.getByRole("button", { name: `${name}, column options` })).toBeVisible();
    }
    await expect(page.getByText(/^(Out of stock|Low stock)$/).first()).toBeVisible();
  });
});
