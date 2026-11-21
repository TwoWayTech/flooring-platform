import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { dec, type CompanyFixtures } from "@workspace/shared";
import { PHONE, signInAs, SUMMIT_OWNER } from "./helpers";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../packages/shared/fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;

const credited = new Set(summit.invoices.map((i) => i.creditForInvoiceId));
/** A live invoice with no payment and no credit note yet, large enough for a $100 credit. */
const unpaid = summit.invoices.find(
  (i) =>
    !i.isReturn &&
    !i.voidedAt &&
    !credited.has(i.id) &&
    dec(i.subtotal).gt(200) &&
    summit.payments.every((p) => p.invoiceId !== i.id),
)!;
/** The invoice with the largest total: its figures are the widest the summary shows. */
const largest = summit.invoices
  .filter((i) => !i.isReturn && !i.voidedAt)
  .reduce((a, b) => (dec(b.total).gt(a.total) ? b : a));

/** One figure of the invoice summary: its label and amount. */
const figure = (page: Page, label: string) =>
  page.locator("main dt", { hasText: new RegExp(`^${label}$`) }).locator("..");

async function openAction(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name: "Update status" }).click();
  await page.getByRole("menuitem", { name }).click();
}

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("invoice click-through fixes (docs/click-through-notes.md)", () => {
  test("a credit note shows linked on the invoice, and applied credit shows in the summary (#16)", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, `/sales/invoices/${unpaid.id}`);
    await expect(figure(page, "Credits")).toHaveCount(0);
    await openAction(page, "Issue credit note");
    await page.getByLabel("Amount before tax").fill("100");
    await page.getByLabel("Reason").fill("Two damaged cartons");
    await page.getByRole("button", { name: "Issue credit note" }).click();
    const issued = page.getByText(/^Credit note CR-\d+ issued$/);
    await expect(issued).toBeVisible();
    const number = (await issued.innerText()).match(/CR-\d+/)![0];
    await expect(figure(page, "Credit note").getByRole("link", { name: number, exact: true })).toHaveAttribute(
      "href",
      /^\/sales\/invoices\//,
    );

    await openAction(page, /^Apply .+ credit$/);
    await expect(page.getByText(`Credit applied to ${unpaid.number}`)).toBeVisible();
    await expect(figure(page, "Credits")).toBeVisible();
    await expect(figure(page, "Credits")).toContainText("$");
    await expect(figure(page, "Remaining")).toBeVisible();
  });

  test.describe("at phone width (#27)", () => {
    test.use(PHONE);

    test("the invoice with the largest figures does not scroll sideways at 375 px", async ({ page }) => {
      await signInAs(page, SUMMIT_OWNER, `/sales/invoices/${largest.id}`);
      await expect(figure(page, "Remaining")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
  });
});
