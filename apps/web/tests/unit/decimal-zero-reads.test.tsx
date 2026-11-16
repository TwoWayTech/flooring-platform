import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { invoiceLedger, type CommissionPlan } from "@workspace/shared";
import { PlanTerms } from "@/features/hr/commissions/plan-terms";
import { buildInvoiceModel } from "@/features/invoices/invoice-model";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";

/**
 * The sweep after STATUS B3: decimals the API sends are read by value, never compared as text with
 * "0" or "0.00", because the API sends each at its column's scale and the demo keeps what was typed.
 */
const summit = await loadCompanyFixtures("summit");

/** The markup's text as it reads on screen: tags out, no space before a comma or a full stop. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([,.])/g, "$1")
    .trim();

describe("a commission plan's terms show a manager override only when the plan pays one (commissions.md)", () => {
  const plan: CommissionPlan = summit.commissionPlans.find((p) => p.status === "active")!;
  const terms = (overridePct: string) => text(renderToStaticMarkup(<PlanTerms plan={{ ...plan, overridePct }} />));

  it("leaves it out for no override, at any scale", () => {
    for (const zero of ["0", "0.0", "0.00000000"]) expect(terms(zero), zero).not.toContain("Manager override");
  });

  it("states one the plan pays", () => {
    expect(terms("2.5")).toContain("Manager override 2.5%.");
  });
});

describe("an invoice shows credit applied and amounts written off only when there are some (sales.md Appendix A)", () => {
  const invoice = summit.invoices.find((i) => !i.voidedAt && !i.isReturn)!;
  const customer = summit.customers.find((c) => c.id === invoice.customerId)!;
  const ledger = invoiceLedger(invoice, { payments: [], adjustments: [] }, invoice.issuedAt);
  const model = (credited: string, writtenOff: string) =>
    buildInvoiceModel(invoice, { ...ledger, credited, writtenOff }, customer, undefined, [], summit.settings);

  it("leaves both lines out at zero, at any scale", () => {
    for (const zero of ["0", "0.00", "0.000"]) {
      expect(model(zero, zero).credited, zero).toBeNull();
      expect(model(zero, zero).writtenOff, zero).toBeNull();
    }
  });

  it("shows each line that has an amount", () => {
    expect(model("12.50", "0.00").credited).toContain("12.50");
    expect(model("0.00", "3.10").writtenOff).toContain("3.10");
  });
});
