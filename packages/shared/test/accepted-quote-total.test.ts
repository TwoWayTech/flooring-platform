import { describe, expect, it } from "vitest";
import { acceptedTotalIfDifferent, keepsAcceptedTotal, type Quote } from "../src";

const invoice = { quoteId: "q1", total: "488.25", isReturn: false };

describe("an invoice says when its total differs from the accepted quote's (owner 2026-11-20, sales.md rule 18)", () => {
  it("AQ1 the accepted total when the invoice's tax made it differ", () => {
    expect(acceptedTotalIfDifferent(invoice, { id: "q1", total: "489.65" })).toBe("489.65");
  });

  it("AQ2 nothing when the totals are equal by value", () => {
    expect(acceptedTotalIfDifferent(invoice, { id: "q1", total: "488.250" })).toBeNull();
  });

  it("AQ3 nothing without the quote, for another quote, or on a credit note", () => {
    expect(acceptedTotalIfDifferent(invoice, undefined)).toBeNull();
    expect(acceptedTotalIfDifferent(invoice, { id: "q2", total: "1.00" })).toBeNull();
    expect(acceptedTotalIfDifferent({ ...invoice, isReturn: true }, { id: "q1", total: "1.00" })).toBeNull();
  });
});

describe("saving an accepted quote keeps its total unless the save reprices it (owner 2026-11-20)", () => {
  const line = {
    id: "l1",
    productId: "p1",
    description: "Slate Tile",
    category: "material" as const,
    unit: "sq_ft" as const,
    quantity: "100",
    unitPrice: "4.50",
    unitCost: "2.10",
  };
  const accepted = {
    id: "q1",
    status: "accepted",
    customerId: "c1",
    jobSite: { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" },
    taxOverride: null,
    lumpSum: false,
    lines: [line],
    total: "489.65",
  } as unknown as Quote;

  it("KA1 keeps it when only notes, ids or the street change, or numbers change spelling", () => {
    const same = {
      ...accepted,
      jobSite: { ...accepted.jobSite, street: "14 Pine Rd" },
      lines: [{ ...line, id: "draft-1", description: "Slate", quantity: "100.000", unitPrice: "4.5000" }],
    };
    expect(keepsAcceptedTotal(accepted, same)).toBe(true);
  });

  it("KA2 prices it again when a line, the county, the override or the customer changes", () => {
    expect(keepsAcceptedTotal(accepted, { ...accepted, lines: [{ ...line, quantity: "110" }] })).toBe(false);
    expect(keepsAcceptedTotal(accepted, { ...accepted, jobSite: { ...accepted.jobSite, county: "Denver" } })).toBe(
      false,
    );
    expect(
      keepsAcceptedTotal(accepted, {
        ...accepted,
        taxOverride: { ratePct: "5", reason: "Exempt part", byName: "Dana", at: "2026-11-20T00:00:00Z" },
      }),
    ).toBe(false);
    expect(keepsAcceptedTotal(accepted, { ...accepted, customerId: "c2" })).toBe(false);
    expect(keepsAcceptedTotal(accepted, { ...accepted, lumpSum: true })).toBe(false);
    expect(keepsAcceptedTotal(accepted, { ...accepted, lines: [{ ...line, productId: "p2" }] })).toBe(false);
    expect(keepsAcceptedTotal(accepted, { ...accepted, lines: [line, { ...line, id: "l2" }] })).toBe(false);
    expect(keepsAcceptedTotal(accepted, { ...accepted, lines: [] })).toBe(false);
  });

  it("KA3 only an accepted quote keeps its total", () => {
    expect(keepsAcceptedTotal({ ...accepted, status: "pending" }, accepted)).toBe(false);
    expect(keepsAcceptedTotal(undefined, accepted)).toBe(false);
  });
});
