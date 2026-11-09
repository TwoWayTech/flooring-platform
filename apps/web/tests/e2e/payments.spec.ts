import { expect, test, type Page } from "@playwright/test";
import { signInAs, SUMMIT_OWNER, type Persona } from "./helpers";

const SUMMIT_ACCOUNTANT: Persona = { companyId: "summit", userId: "sm-usr-06", roleKey: "accountant" };
const SUMMIT_SALES: Persona = { companyId: "summit", userId: "sm-usr-03", roleKey: "sales" };
const KEYSTONE_OWNER: Persona = { companyId: "keystone", userId: "ks-usr-01", roleKey: "owner" };

/** A tiny file that starts like a real PDF, so the file-type check accepts it. */
const PDF = { name: "bank-confirmation.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo\n") };
/** A file named .pdf that is not one: the real-type check refuses it. */
const FAKE = { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") };

const sheet = (page: Page) => page.getByRole("dialog", { name: /Record (payment|deposit)/ });
const statusPills = (page: Page) =>
  page.locator("main").getByText(/^(Open|Partly paid|Paid|Pending verification|Overdue|Deposit paid)$/);

async function fillPayment(page: Page, amount: string, reference: string) {
  await page.getByRole("button", { name: "Record payment" }).click();
  await sheet(page).getByLabel("Amount").fill(amount);
  await sheet(page).getByLabel("Reference or transaction ID").fill(reference);
}

test.describe("customer payments (spec Appendix A)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("proof is mandatory and checked by its real type; a large payment waits for someone else", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/invoices/sm-inv-0198");
    await fillPayment(page, "5000", "ACH-E2E-0001");
    const save = sheet(page).getByRole("button", { name: "Save payment" });
    await expect(save).toBeDisabled();
    await expect(
      sheet(page).getByText("Attach the receipt, bank confirmation or check photo to continue.").first(),
    ).toBeVisible();

    await sheet(page).locator("input[type=file]").setInputFiles(FAKE);
    await save.click();
    await expect(page.getByText("fake.pdf is not a PDF, JPG, PNG, WebP or HEIC file.")).toBeVisible();
    await sheet(page).getByRole("button", { name: "Remove fake.pdf" }).click();
    await sheet(page).locator("input[type=file]").setInputFiles(PDF);
    await expect(sheet(page).getByRole("region", { name: "Payment summary" })).toContainText("$6,876.28");
    await save.click();
    await expect(page.getByText(/waits for verification/)).toBeVisible();
    await expect(statusPills(page).first()).toHaveText("Pending verification");
    await expect(page.getByText("Someone else verifies it")).toBeVisible();

    await signInAs(page, SUMMIT_ACCOUNTANT, "/sales/invoices/sm-inv-0198");
    const row = page.getByRole("row", { name: /ACH-E2E-0001/ });
    await row.getByRole("button", { name: "bank-confirmation.pdf" }).click();
    await expect(page.getByRole("dialog", { name: "bank-confirmation.pdf" })).toBeVisible();
    await page.keyboard.press("Escape");
    await row.getByRole("button", { name: /^Confirm PAY-/ }).click();
    await expect(row.getByText("Confirmed")).toBeVisible();
    await expect(statusPills(page).first()).toHaveText("Partly paid");
    await expect(page.getByRole("article").getByText("Balance due").locator("..")).toContainText("$6,876.28");
  });

  test("without approval a payment counts at once; a reused reference needs confirming", async ({ page }) => {
    await signInAs(page, KEYSTONE_OWNER, "/sales/invoices/ks-inv-0151");
    await page.getByRole("button", { name: "Record payment" }).click();
    await sheet(page).getByRole("button", { name: "Full balance" }).click();
    await sheet(page).getByLabel("Method").click();
    await page.getByRole("option", { name: "Card" }).click();
    await sheet(page).getByLabel("Card, last 4 digits").fill("4242");
    await sheet(page).getByLabel("Reference or transaction ID").fill("AUTH-E2E-77");
    await sheet(page).locator("input[type=file]").setInputFiles(PDF);
    await sheet(page).getByRole("button", { name: "Save payment" }).click();
    await expect(statusPills(page).first()).toHaveText("Paid");
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);

    await page.goto("/sales/invoices/ks-inv-0159");
    await fillPayment(page, "100", "AUTH-E2E-77");
    await sheet(page).locator("input[type=file]").setInputFiles(PDF);
    await expect(sheet(page).getByText(/already uses this reference/)).toBeVisible();
    await sheet(page).getByRole("button", { name: "Save payment" }).click();
    await expect(sheet(page).getByLabel("The reference is right; record it anyway")).toBeFocused();
    await sheet(page).getByLabel("The reference is right; record it anyway").check();
    await sheet(page).getByRole("button", { name: "Save payment" }).click();
    await expect(statusPills(page).first()).toHaveText("Partly paid");
  });

  test("Sales can see payments but not record them by default", async ({ page }) => {
    await signInAs(page, SUMMIT_SALES, "/sales/invoices/sm-inv-0198");
    await expect(page.getByRole("region", { name: "Payments" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  });
});
