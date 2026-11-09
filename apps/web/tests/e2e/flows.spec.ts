import { expect, test, type Page } from "@playwright/test";
import { FLOW_TAG, signInAs, SUMMIT_OWNER } from "./helpers";

const PDF = { name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo\n") };

const quoteStatus = (page: Page) =>
  page.locator("header").getByText(/^(Draft|Pending|Accepted|Converted|Declined|Expired)$/);
const invoiceStatus = (page: Page) =>
  page
    .getByRole("heading", { name: /^Invoice INV-/ })
    .locator("..")
    .getByText(/^(Open|Deposit paid|Partly paid|Paid|Void|Overdue)$/)
    .first();
const sheet = (page: Page) => page.getByRole("dialog", { name: /Record (payment|deposit)/ });

/** Saves the payment sheet with a reference and a proof file (spec Appendix A). */
async function savePayment(page: Page, reference: string) {
  await sheet(page).getByLabel("Reference or transaction ID").fill(reference);
  await sheet(page).locator("input[type=file]").setInputFiles(PDF);
  await sheet(page)
    .getByRole("button", { name: /^Save (payment|deposit)$/ })
    .click();
  await expect(sheet(page)).toBeHidden();
}

/**
 * The named end-to-end flows of feature batch 2, H. Flows 2 to 6 live with their features and
 * carry the same tag: purchasing.spec (2), customers-picker.spec (3), import.spec (4),
 * meetings.spec (5) and roles.spec (6). Run them all with `--grep @flow`.
 */
test.describe("flow 1 (spec H)", () => {
  test(
    "quote draft → pending → accepted → invoice → deposit with proof → cut from roll → job complete → final payment → Paid; void one payment → Partly paid",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
      await page.getByLabel("Customer", { exact: true }).click();
      await page.getByRole("option").first().click();
      await page.getByRole("button", { name: "Add product" }).click();
      await page.getByPlaceholder("Search by name, color or brand").fill("Fieldstone Sand Dune");
      await page.getByRole("option").first().click();
      // A 60 % deposit, so the 40 % left after voiding it reads Partly paid rather than Deposit paid.
      await page.getByLabel("Deposit percent").fill("60");
      await page.getByLabel("Deposit percent").blur();
      await page.getByRole("button", { name: "Save as draft" }).click();
      await expect(quoteStatus(page)).toHaveText("Draft");

      await page.getByRole("button", { name: "Send / mark pending" }).click();
      await page.getByRole("dialog", { name: "Send quote" }).getByRole("button", { name: "Mark as pending" }).click();
      await expect(quoteStatus(page)).toHaveText("Pending");
      await page.getByRole("button", { name: "Mark accepted" }).click();
      await expect(quoteStatus(page)).toHaveText("Accepted");
      await page.getByRole("button", { name: "Convert to invoice" }).click();
      await expect(page).toHaveURL(/\/sales\/invoices\//);
      await expect(invoiceStatus(page)).toHaveText("Open");

      const stock = page.getByRole("region", { name: "Stock" });
      await expect(stock.getByText("Reserved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Update status" }).click();
      await page.getByRole("menuitem", { name: "Record deposit" }).click();
      await savePayment(page, "ACH-FLOW-DEP");
      await expect(invoiceStatus(page)).toHaveText("Deposit paid");

      await stock.getByRole("button", { name: "Cut", exact: true }).click();
      await expect(stock.getByText("Cut", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Schedule installation" }).click();
      await page
        .getByRole("dialog", { name: "Schedule installation" })
        .getByRole("button", { name: "Schedule job" })
        .click();
      const jobLink = page.getByRole("link", { name: /^J-\d{4}, / });
      await expect(jobLink).toBeVisible();
      const jobNumber = (await jobLink.innerText()).split(",")[0]!;
      await jobLink.click();
      const card = page.getByRole("dialog", { name: new RegExp(`Job ${jobNumber}`) });
      await card.getByRole("button", { name: "Start job" }).click();
      await card.getByLabel("Customer signs as").fill("Pat Homeowner");
      await card.getByRole("button", { name: "Record sign-off" }).click();
      await expect(card.getByText(/Signed off by Pat Homeowner/)).toBeVisible();
      await card.getByRole("link", { name: "View invoice" }).click();
      await expect(page.getByRole("region", { name: "Timeline" }).getByText("Installed")).toBeVisible();

      await page.getByRole("button", { name: "Record payment" }).click();
      await savePayment(page, "ACH-FLOW-FINAL");
      await expect(invoiceStatus(page)).toHaveText("Paid");

      // Voiding the deposit leaves only the later 40 %, less than the deposit asked: Partly paid.
      await page
        .getByRole("row", { name: /Deposit/ })
        .getByRole("button", { name: /^Void PAY-/ })
        .click();
      await page.getByLabel("Reason").fill("Check bounced");
      await page.getByRole("button", { name: "Void payment" }).click();
      await expect(invoiceStatus(page)).toHaveText("Partly paid");
    },
  );
});
