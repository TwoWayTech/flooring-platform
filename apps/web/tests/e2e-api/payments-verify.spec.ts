import { expect, type APIRequestContext } from "@playwright/test";
import {
  dec,
  invoiceLedger,
  type Invoice,
  type InvoiceAdjustment,
  type InvoiceLedger,
  type Payment,
} from "@workspace/shared";
import { ACCOUNTANT_EMAIL, OWNER_EMAIL } from "./accounts";
import { readAs, savePayment, type PaymentOutcome } from "./flows/checks";
import { companyToday, flowTest, resetAuthAround, runId, waitForAnswer } from "./flows/kit";

/** Above Summit's seeded $1,000 approval threshold, so it waits for a second person. */
const AMOUNT = "1001.00";

/** A payment above the threshold waits, whoever records it (spec rule 28). */
const WAITS: PaymentOutcome = {
  status: "pending",
  why: "a payment above Summit's $1,000 approval threshold waits for a second person",
};

/** Every invoice's derived ledger (ADR 0013), from what the API answers the person. */
async function ledgers(request: APIRequestContext): Promise<{ invoice: Invoice; ledger: InvoiceLedger }[]> {
  const [invoices, payments, adjustments] = await Promise.all([
    readAs<Invoice[]>(request, "/invoices"),
    readAs<Payment[]>(request, "/payments"),
    readAs<InvoiceAdjustment[]>(request, "/invoice-adjustments"),
  ]);
  const today = companyToday();
  return invoices.map((invoice) => ({ invoice, ledger: invoiceLedger(invoice, { payments, adjustments }, today) }));
}

/** One invoice's derived ledger now. */
async function ledgerOf(request: APIRequestContext, invoiceId: string): Promise<InvoiceLedger> {
  const found = (await ledgers(request)).find(({ invoice }) => invoice.id === invoiceId);
  if (!found) throw new Error(`GET /invoices no longer lists ${invoiceId}.`);
  return found.ledger;
}

/**
 * The two-person check on the real API (spec rule 28; ADR 0061 decision 3 moved recording from
 * Sales to the accountant, so flow F1's payments count at once): Grace records a payment above the
 * threshold on a seeded open invoice, it waits and the balance stays, then Dana confirms it from
 * Finance → Payments to verify and the balance drops. The payment is voided at the end, so the
 * invoice is left as it was; a run that stops midway is voided by the clean-up.
 */
flowTest.describe("payments to verify (api mode)", () => {
  resetAuthAround([ACCOUNTANT_EMAIL, OWNER_EMAIL]);

  flowTest("a payment above the threshold waits until another person confirms it", async ({ personas }) => {
    flowTest.setTimeout(120_000);
    const reference = `E2E-VERIFY-${runId()}`;
    const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
    const dana = await personas.open(OWNER_EMAIL, { mfa: true });

    // The seeded open invoice with the largest balance, with nothing already waiting on it.
    const open = (await ledgers(grace.request))
      .filter(
        ({ invoice, ledger }) =>
          !invoice.voidedAt &&
          !invoice.isReturn &&
          !ledger.pendingVerification &&
          !invoice.number.startsWith("E2E") &&
          dec(ledger.balance).gte(AMOUNT),
      )
      .sort((a, b) => dec(b.ledger.balance).comparedTo(a.ledger.balance))[0];
    expect(open, `a seeded open Summit invoice with a balance of at least ${AMOUNT}`).toBeDefined();
    const { invoice, ledger: before } = open!;

    const payment = await flowTest.step("Grace records it; it waits and the balance stays", async () => {
      const { page } = grace;
      await page.goto(`/sales/invoices/${invoice.id}`);
      await page.getByRole("button", { name: "Record payment", exact: true }).click();
      await page.getByRole("dialog", { name: "Record payment" }).getByLabel("Amount", { exact: true }).fill(AMOUNT);
      const recorded = await savePayment(page, invoice.number, reference, WAITS);
      personas.onCleanup(`void ${recorded.number}`, () =>
        grace.request.post(`/api-proxy/payments/${recorded.id}/void`, { data: { reason: "e2e clean-up" } }),
      );
      expect(recorded.amount).toBe(AMOUNT);
      await expect(page.getByText("Pending verification").first()).toBeVisible();
      const waiting = await ledgerOf(grace.request, invoice.id);
      expect(waiting.pendingVerification).toBe(true);
      expect(dec(waiting.balance).eq(before.balance), `balance stays ${before.balance}`).toBe(true);
      return recorded;
    });

    await flowTest.step("Dana confirms it on Payments to verify; the balance drops", async () => {
      const { page } = dana;
      await page.goto("/finance?view=payments");
      await page.getByPlaceholder("Search payments").fill(payment.number);
      const answer = waitForAnswer<Payment>(page, "POST", new RegExp(`^/api-proxy/payments/${payment.id}/review$`));
      await page.getByRole("button", { name: `Confirm ${payment.number}`, exact: true }).click();
      expect((await answer).status).toBe("confirmed");
      await expect(page.getByText(`${payment.number} confirmed`, { exact: true })).toBeVisible();
      const after = await ledgerOf(dana.request, invoice.id);
      expect(after.pendingVerification).toBe(false);
      expect(dec(after.balance).eq(dec(before.balance).minus(AMOUNT)), `balance ${before.balance} less ${AMOUNT}`).toBe(
        true,
      );
    });

    await flowTest.step("Grace voids it; the invoice is back as it was", async () => {
      const voided = await grace.request.post(`/api-proxy/payments/${payment.id}/void`, {
        data: { reason: "e2e: put the seeded invoice back" },
      });
      expect(voided.status(), await voided.text()).toBe(201);
      const restored = await ledgerOf(grace.request, invoice.id);
      expect(dec(restored.balance).eq(before.balance), `balance back to ${before.balance}`).toBe(true);
    });
  });
});
