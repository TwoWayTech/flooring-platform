import { describe, expect, it } from "vitest";
import { invoiceLedger, type Invoice } from "@workspace/shared";
import { buildInvoiceModel } from "@/features/invoices/invoice-model";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";

const summit = await loadCompanyFixtures("summit");

describe("a contract billing's tax line (click-through #32, contracts.md rule 13)", () => {
  const base = summit.invoices.find((i) => !i.taxExempt && i.taxRule && !i.contractId)!;
  const customer = summit.customers.find((c) => c.id === base.customerId)!;
  const label = (patch: Partial<Invoice>) => {
    const invoice = { ...base, ...patch };
    const ledger = invoiceLedger(invoice, { payments: [], adjustments: [] }, invoice.issuedAt);
    return buildInvoiceModel(invoice, ledger, customer, undefined, [], summit.settings).taxLabel;
  };

  it("says no tax was charged on a contract billing that carried none", () => {
    expect(label({ contractId: "ctr-1", tax: "0.00" })).toBe("Sales tax, not charged (contract billing)");
  });

  it("keeps the exemption wording, and the rate when tax was charged", () => {
    expect(label({ contractId: "ctr-1", tax: "0.00", taxExempt: true })).toBe(
      "Sales tax, exempt (resale certificate on file)",
    );
    expect(label({ contractId: "ctr-1", tax: "10.00" })).toMatch(/^Sales tax, .+%$/);
    expect(label({ tax: "0.00" })).not.toContain("contract billing");
  });
});
