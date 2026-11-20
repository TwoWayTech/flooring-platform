import { describe, expect, it } from "vitest";
import { invoiceLedger } from "@workspace/shared";
import { buildInvoiceModel } from "@/features/invoices/invoice-model";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";

const summit = await loadCompanyFixtures("summit");

describe("the invoice's tax note (owner's answer of 2026-11-20, sales.md rule 18)", () => {
  const quote = summit.quotes.find((q) => summit.invoices.some((i) => i.quoteId === q.id))!;
  const invoice = summit.invoices.find((i) => i.quoteId === quote.id)!;
  const customer = summit.customers.find((c) => c.id === invoice.customerId)!;
  const ledger = invoiceLedger(invoice, { payments: [], adjustments: [] }, invoice.issuedAt);
  const model = (acceptedTotal: string) =>
    buildInvoiceModel(invoice, ledger, customer, { ...quote, total: acceptedTotal }, [], summit.settings);

  it("TN1 names the accepted total and the quote when the invoice's total differs", () => {
    const note = model("1.00").taxNote;
    expect(note).toContain(quote.number);
    expect(note).toContain("1.00");
    expect(note).toMatch(/^Sales tax follows the rate in force on /);
  });

  it("TN2 says nothing when the totals agree, or without the quote", () => {
    expect(model(invoice.total).taxNote).toBeNull();
    expect(buildInvoiceModel(invoice, ledger, customer, undefined, [], summit.settings).taxNote).toBeNull();
  });
});
