import { describe, expect, it } from "vitest";
import {
  computeTotals,
  dec,
  EXAMPLE_TAX_RULES,
  invoiceFromQuote,
  nextNumber,
  remeasureLines,
  taxContextFor,
  type Customer,
  type DocLine,
  type LocalizationSettings,
  type Product,
  type Quote,
} from "../src";

const tax = {
  pricesInclude: "exclusive",
  rounding: "invoice",
  rules: [...EXAMPLE_TAX_RULES],
  jurisdictions: [],
  companyDefault: null,
  filing: [],
  certificateTypes: [],
} as LocalizationSettings["tax"];
const localization = { tax, region: { statesOfOperation: ["NJ", "CO"] } } as Pick<
  LocalizationSettings,
  "tax" | "region"
>;
const lvp = { id: "lvp", unit: "carton", sqFtPerCarton: "23.64", category: "lvp" } as Product;
const rooms = [
  { id: "living", name: "Living room", x: 0, y: 0, widthFt: 14, lengthFt: 18 },
  { id: "hall", name: "Hall", x: 16, y: 0, widthFt: 4, lengthFt: 12 },
];
const lines: DocLine[] = [
  {
    id: "m",
    productId: "lvp",
    description: "LVP",
    category: "material",
    unit: "carton",
    quantity: "1",
    unitPrice: "80.00",
    unitCost: "48.00",
    wastePct: "8",
    roomIds: ["living", "hall"],
  },
  {
    id: "l",
    description: "Install",
    category: "labor",
    unit: "sq_ft",
    quantity: "1",
    unitPrice: "2.75",
    unitCost: "1.55",
    roomIds: ["living", "hall"],
  },
  {
    id: "s",
    description: "Moving",
    category: "service",
    unit: "each",
    quantity: "2",
    unitPrice: "65.00",
    unitCost: "30.00",
  },
];
const customer = { id: "c1", terms: "net_30", taxExempt: false, certificate: null } as unknown as Customer;

describe("quote rules", () => {
  it("re-measures lines tied to rooms: cartons with waste for materials, net sq ft for labor", () => {
    const [material, labor, service] = remeasureLines(lines, rooms, [lvp]);
    // 252 + 48 = 300 sq ft; with 8 % waste 324 sq ft; 324 / 23.64 = 13.7 → 14 cartons.
    expect(material!.quantity).toBe("14");
    expect(labor!.quantity).toBe("300");
    expect(service!.quantity).toBe("2");
  });

  it("taxes installation labor in NJ but not in CO (job-site state)", () => {
    const measured = remeasureLines(lines, rooms, [lvp]);
    const nj = computeTotals(measured, taxContextFor(localization, { state: "NJ" }, customer, "2026-11-07", false));
    const co = computeTotals(measured, taxContextFor(localization, { state: "CO" }, customer, "2026-11-07", false));
    expect(nj.lines.find((l) => l.id === "l")!.taxable).toBe(true);
    expect(co.lines.find((l) => l.id === "l")!.taxable).toBe(false);
    expect(dec(nj.tax).gt(co.tax) || nj.ratePct !== co.ratePct).toBe(true);
  });

  it("collects nothing in a state without a rule", () => {
    expect(taxContextFor(localization, { state: "OR" }, customer, "2026-11-07", false).rule).toBeUndefined();
  });

  it("numbers the next document after the highest used", () => {
    expect(nextNumber("INV-", ["INV-1001", "INV-1227", "CR-5001"], 1001)).toBe("INV-1228");
    expect(nextNumber("Q-", [], 2001)).toBe("Q-2001");
  });

  it("converts a quote into an invoice with the same total and the rule version it used", () => {
    const measured = remeasureLines(lines, rooms, [lvp]);
    const quote = {
      id: "q1",
      salesRepId: "u1",
      branchId: "b1",
      jobSite: { street: "", city: "Trenton", state: "NJ", zip: "08601" },
      lines: measured,
      lumpSum: false,
      taxOverride: null,
    } as Quote;
    const invoice = invoiceFromQuote(quote, customer, localization, {
      id: "i1",
      number: "INV-1228",
      issuedAt: "2026-11-07",
    });
    const expected = computeTotals(
      measured,
      taxContextFor(localization, { state: "NJ" }, customer, "2026-11-07", false),
    );
    expect(invoice.total).toBe(expected.total);
    expect(invoice.dueAt).toBe("2026-12-07");
    expect(invoice.taxRule).toMatchObject({ state: "NJ", version: 1 });
    expect(invoice.paid).toBe("0.00");
  });
});
