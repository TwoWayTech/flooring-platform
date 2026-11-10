import { expect, test, type Page } from "@playwright/test";
import { FLOW_TAG, PHONE, signInAs, SUMMIT_OWNER } from "./helpers";

const PDF = { name: "supplier-invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo\n") };
const LONG = "Weathered Pier Sand Dune Wide Plank Rigid Core with Attached Cork Pad";

/** Opens New purchase order for Tidewater Vinyl and adds the long-named plank. */
async function draftLongLine(page: Page) {
  await page.getByRole("button", { name: "New purchase order" }).click();
  const dialog = page.getByRole("dialog", { name: "New purchase order" });
  await dialog.getByRole("combobox", { name: "Supplier" }).click();
  await page.getByPlaceholder("Name, contact, phone or email").fill("Tidewater Vinyl");
  await page.getByRole("option", { name: /^Tidewater Vinyl/ }).click();
  await dialog.getByRole("button", { name: "Add product" }).click();
  await page.getByPlaceholder("Search by name, color or brand").fill("Attached Cork Pad");
  await page.getByRole("option").first().click();
  return dialog;
}

test.describe("purchasing (spec D1 to D3)", () => {
  // Spec D1 replaces "order, receive whole, bill, pay in full" with drafts, receipts, matched bills and supplier payments.
  test(
    "draft, order, partial receipt, bill with the supplier's file, and a supplier payment with proof (flow 2)",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
      const dialog = await draftLongLine(page);
      await dialog.getByLabel(/area in sq ft/).fill("500");
      await dialog.getByLabel(/area in sq ft/).blur();
      await expect(dialog.getByLabel(/area in sq ft/)).toHaveValue("513");
      await expect(dialog.getByText("≈ 18 cartons (28.50 sq ft each)")).toBeVisible();
      await dialog.getByRole("button", { name: "Save as draft" }).click();
      const saved = page.getByText(/^Draft PO-\d+ saved$/);
      await expect(saved).toBeVisible();
      const number = (await saved.innerText()).split(" ")[1]!;

      await page.getByPlaceholder("Search purchase orders").fill(number);
      await page.getByRole("row", { name: new RegExp(number) }).click();
      const drawer = page.getByRole("dialog", { name: new RegExp(number) });
      // The drawer is named by the order number and its status.
      const status = (label: string) => expect(page.getByRole("dialog", { name: `${number} ${label}` })).toBeVisible();
      await status("Draft");
      await drawer.getByRole("button", { name: "Place order" }).click();
      await status("Ordered");

      await drawer.getByRole("button", { name: "Receive" }).click();
      const receive = page.getByRole("dialog", { name: `Receive ${number}` });
      await receive.getByLabel(/Received in good condition/).fill("10");
      await receive.getByLabel(/Damaged/).fill("1");
      await receive.getByRole("button", { name: "Record receipt" }).click();
      await status("Partly received");

      await drawer.getByRole("button", { name: "Enter bill" }).click();
      const bill = page.getByRole("dialog", { name: `Enter bill for ${number}` });
      await bill.getByLabel("Supplier's bill number").fill("TV-E2E-1");
      await bill.locator("input[type=file]").setInputFiles(PDF);
      await bill.getByRole("button", { name: "Enter bill" }).click();
      await expect(page.getByText("Bill TV-E2E-1 entered")).toBeVisible();
      await page.keyboard.press("Escape");

      await page.goto("/purchasing?view=bills");
      await expect(page.getByRole("region", { name: "Payables" })).toContainText("Due in the next 7 days");
      await page.getByPlaceholder("Search bills").fill("TV-E2E-1");
      const row = page.getByRole("row", { name: /TV-E2E-1/ });
      await expect(row).toContainText("Matches");
      await row.getByRole("button", { name: "Pay" }).click();
      const pay = page.getByRole("dialog", { name: "Pay Tidewater Vinyl" });
      for (const box of await pay.getByRole("checkbox").all()) await box.uncheck();
      await pay.getByRole("checkbox", { name: /TV-E2E-1/ }).check();
      await pay.getByLabel("Amount").fill("100");
      await pay.getByLabel("Reference or transaction ID").fill("ACH-SUP-1");
      await expect(pay.getByRole("button", { name: "Save payment" })).toBeDisabled();
      await pay.locator("input[type=file]").setInputFiles({ ...PDF, name: "remittance.pdf" });
      await pay.getByRole("button", { name: "Save payment" }).click();
      await expect(page.getByText(/^SP-\d{4} recorded$/)).toBeVisible();
      await expect(row).toContainText("Partly paid");
    },
  );

  test("a long product name wraps and truncates without widening the page at 1440 px", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
    const dialog = await draftLongLine(page);
    await expect(dialog.getByText(LONG)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("purchasing on a phone (spec D1)", () => {
  test.use(PHONE);
  test("the order lines scroll inside their box; the page never overflows at 390 px", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
    const dialog = await draftLongLine(page);
    await expect(dialog.getByRole("region", { name: "Order lines" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
