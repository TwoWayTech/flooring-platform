import { describe, expect, it } from "vitest";
import { acceptedTotalIfDifferent } from "../src";

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
