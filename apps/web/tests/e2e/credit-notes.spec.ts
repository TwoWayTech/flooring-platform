import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { addDays, dec, moneyString, type CompanyFixtures, type Payment } from "@workspace/shared";
import { signInAs, SUMMIT_OWNER, type Persona } from "./helpers";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../packages/shared/fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;

const PRIYA: Persona = { companyId: "summit", userId: "sm-usr-03", roleKey: "sales" };
const confirmedOn = (p: Payment) => (p.reviewedAt ?? p.recordedAt).slice(0, 10);
const confirmed = (invoiceId: string) =>
  summit.payments.filter((p) => p.invoiceId === invoiceId && p.status === "confirmed");
const alreadyCredited = new Set(summit.invoices.map((i) => i.creditForInvoiceId));
const live = summit.invoices.filter(
  (i) =>
    i.salesRepId === PRIYA.userId && !i.isReturn && !i.voidedAt && !i.commissionSplit && !alreadyCredited.has(i.id),
);

/** Paid in full recently, so a credit note falls inside the 90-day clawback window. */
const paidInFull = live.find((i) => {
  const payments = confirmed(i.id);
  const paid = payments.reduce((total, p) => total.plus(p.amount), dec(0));
  return (
    payments.length > 0 &&
    paid.gte(i.total) &&
    dec(i.subtotal).gt(200) &&
    payments.every((p) => confirmedOn(p) >= addDays(summit.anchorDate, -45))
  );
})!;
const unpaid = live.find((i) => summit.payments.every((p) => p.invoiceId !== i.id))!;

const thisMonth = () => new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

async function openAction(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Update status" }).click();
  await page.getByRole("menuitem", { name }).click();
}

test.describe("Credit notes (plan K-11) and commission splits (spec C1)", () => {
  test("a credit note on a paid invoice reverses commission inside the window", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, `/sales/invoices/${paidInFull.id}`);
    await openAction(page, "Issue credit note");
    await page.getByLabel("Amount before tax").fill("100");
    await page.getByLabel("Reason").fill("Two damaged cartons");
    await page.getByRole("button", { name: "Issue credit note" }).click();
    await expect(page.getByText(/^Credit note CR-\d+ issued$/)).toBeVisible();
    await page.goto("/hr/commissions");
    await page.getByLabel("Month").click();
    await page.getByRole("option", { name: thisMonth() }).click();
    await page.getByRole("row", { name: "Open Priya Natarajan's statement" }).click();
    await expect(page.getByRole("dialog").getByRole("cell", { name: "Reversal" })).toBeVisible();
  });

  test("refuses a credit note above the invoice and one with no reason", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, `/sales/invoices/${paidInFull.id}`);
    await openAction(page, "Issue credit note");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount before tax").fill("100");
    await dialog.getByRole("button", { name: "Issue credit note" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Give a reason; it stays on the credit note.");
    await dialog.getByLabel("Reason").fill("Over the limit");
    await dialog.getByLabel("Amount before tax").fill(moneyString(dec(paidInFull.subtotal).plus(1)));
    await dialog.getByRole("button", { name: "Issue credit note" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Enter an amount up to what is left on this invoice before tax.",
    );
  });

  test("shares an unpaid invoice's commission and keeps the split", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, `/sales/invoices/${unpaid.id}`);
    await openAction(page, "Commission split");
    await page.getByLabel("Share with").click();
    await page.getByRole("option", { name: "Evan Shaw" }).click();
    await page.getByLabel("Priya Natarajan's share %").fill("70");
    await page.getByRole("button", { name: "Save split" }).click();
    await expect(page.getByText("Commission split saved")).toBeVisible();
    await page.reload();
    await openAction(page, "Commission split");
    await expect(page.getByLabel("Share with")).toContainText("Evan Shaw");
    await expect(page.getByLabel("Priya Natarajan's share %")).toHaveValue("70");
  });

  test("offers no split once a payment is confirmed", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, `/sales/invoices/${paidInFull.id}`);
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByRole("menuitem", { name: "Issue credit note" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Commission split" })).toHaveCount(0);
  });

  test("Sales gets neither action", async ({ page }) => {
    await signInAs(page, PRIYA, `/sales/invoices/${unpaid.id}`);
    await expect(page.getByRole("heading", { name: new RegExp(unpaid.number) })).toBeVisible();
    const menu = page.getByRole("button", { name: "Update status" });
    if (await menu.isVisible()) await menu.click();
    await expect(page.getByRole("menuitem", { name: "Issue credit note" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Commission split" })).toHaveCount(0);
  });
});
