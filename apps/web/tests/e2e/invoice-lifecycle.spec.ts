import { expect, test, type Page } from "@playwright/test";
import { signInAs, type Persona } from "./helpers";

/** Keystone confirms payments at once, so the balance moves as soon as a payment is saved. */
const KEYSTONE_OWNER: Persona = { companyId: "keystone", userId: "ks-usr-01", roleKey: "owner" };
const PDF = { name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo\n") };

const sheet = (page: Page) => page.getByRole("dialog", { name: /Record (payment|deposit)/ });
const mainStatus = (page: Page) =>
  page
    .getByRole("heading", { name: /^Invoice INV-/ })
    .locator("..")
    .getByText(/^(Open|Partly paid|Paid|Void|Overdue)$/)
    .first();

/** Makes a one-line quote for the first customer and converts it; lands on the new invoice. */
async function newInvoice(page: Page) {
  await page.goto("/sales/quotes/new");
  await page.getByLabel("Customer", { exact: true }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Convert to invoice" }).click();
  await expect(page).toHaveURL(/\/sales\/invoices\//);
  await expect(mainStatus(page)).toHaveText("Open");
}

/** Records a payment with a proof file: the prefilled balance, or part of it (spec Appendix A). */
async function pay(page: Page, share: "all" | "half", reference: string) {
  await page.getByRole("button", { name: "Record payment" }).click();
  const amount = sheet(page).getByLabel("Amount");
  if (share === "half") await amount.fill(String(Math.round(Number(await amount.inputValue()) * 50) / 100));
  await sheet(page).getByLabel("Reference or transaction ID").fill(reference);
  await sheet(page).locator("input[type=file]").setInputFiles(PDF);
  await sheet(page).getByRole("button", { name: "Save payment" }).click();
  await expect(sheet(page)).toBeHidden();
}

test.describe("invoice lifecycle (spec Appendix A, B2)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInAs(page, KEYSTONE_OWNER, "/");
  });

  test("partial payment, the rest, Paid with a PAID mark; voiding one makes it Partly paid again", async ({ page }) => {
    await newInvoice(page);
    await pay(page, "half", "ACH-LIFE-1");
    await expect(mainStatus(page)).toHaveText("Partly paid");
    await pay(page, "all", "ACH-LIFE-2");
    await expect(mainStatus(page)).toHaveText("Paid");
    await expect(page.getByRole("article").getByText(/^PAID /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Timeline" }).getByText("Paid")).toBeVisible();

    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: /^Download receipt PAY-/ })
      .first()
      .click();
    expect((await download).suggestedFilename()).toMatch(/^PAY-\d{4}-receipt\.pdf$/);

    await page
      .getByRole("button", { name: /^Void PAY-/ })
      .first()
      .click();
    await page.getByLabel("Reason").fill("Check bounced");
    await page.getByRole("button", { name: "Void payment" }).click();
    await expect(mainStatus(page)).toHaveText("Partly paid");
    await expect(page.getByRole("region", { name: "Payments" }).getByText("Voided")).toBeVisible();
    await expect(page.getByRole("region", { name: "Payments" }).getByText("Check bounced")).toBeVisible();
  });

  test("a small leftover is written off, and an invoice with nothing confirmed can be voided", async ({ page }) => {
    await newInvoice(page);
    await page.getByRole("button", { name: "Record payment" }).click();
    const balance = Number(await sheet(page).getByLabel("Amount").inputValue());
    await sheet(page)
      .getByLabel("Amount")
      .fill(String(Math.round((balance - 3) * 100) / 100));
    await sheet(page).getByLabel("Reference or transaction ID").fill("ACH-LIFE-3");
    await sheet(page).locator("input[type=file]").setInputFiles(PDF);
    await sheet(page).getByRole("button", { name: "Save payment" }).click();
    await expect(mainStatus(page)).toHaveText("Partly paid");
    await page.getByRole("button", { name: "Update status" }).click();
    await page.getByRole("menuitem", { name: "Write off remaining balance" }).click();
    await page.getByLabel("Reason").fill("Rounding left by the customer");
    await page.getByRole("button", { name: "Write off" }).click();
    await expect(mainStatus(page)).toHaveText("Paid");
    await expect(page.getByRole("article").getByText("Written off")).toBeVisible();

    await newInvoice(page);
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByRole("menuitem", { name: "Write off remaining balance" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Void invoice" }).click();
    await page.getByLabel("Reason").fill("Entered twice");
    await page.getByRole("button", { name: "Void invoice" }).click();
    await expect(mainStatus(page)).toHaveText("Void");
    await expect(page.getByRole("article").getByText("VOID")).toBeVisible();
  });
});
