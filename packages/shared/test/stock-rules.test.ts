import { describe, expect, it } from "vitest";
import {
  adjustmentNeedsApproval,
  inventorySettingsProblem,
  QUANTITY_TEXT_MAX,
  STOCK_RULES_MESSAGES,
  stockRulesLoosened,
  type InventorySettings,
} from "../src";

const qty = (adjustmentApprovalQty: string): InventorySettings => ({ adjustmentApprovalQty });
const loosened = (next: string, current: string) => stockRulesLoosened(qty(next), qty(current));

describe("Stock rules (ADR 0059, the Stock rules part)", () => {
  it("SR1 the approval quantity is empty or a plain quantity of up to 3 decimals", () => {
    for (const ok of ["", "0", "50", "1000", "12.5", "12.125", "9999999999.999"])
      expect(inventorySettingsProblem(qty(ok)), ok).toBeNull();
    expect("9999999999.999").toHaveLength(QUANTITY_TEXT_MAX);
    for (const bad of [
      ".",
      "12.",
      ".5",
      "-1",
      "+1",
      "1e3",
      " 50",
      "50 ",
      "1,000",
      "12.1234",
      "1.2.3",
      "Infinity",
      "NaN",
      "12345678901",
    ])
      expect(inventorySettingsProblem(qty(bad)), bad).toBe(STOCK_RULES_MESSAGES.adjustmentApprovalQty);
    // Not a string at all (a body the API's Zod refuses first; the demo's rule must not throw).
    expect(inventorySettingsProblem({ adjustmentApprovalQty: 50 as unknown as string })).toBe(
      STOCK_RULES_MESSAGES.adjustmentApprovalQty,
    );
    for (const shape of [null, undefined, {}, "50", 50])
      expect(inventorySettingsProblem(shape as unknown as InventorySettings), String(shape)).toBe(
        STOCK_RULES_MESSAGES.adjustmentApprovalQty,
      );
  });

  it("SR2 raising the quantity or clearing it loosens: larger changes, or every change, go through alone", () => {
    expect(loosened("1000.001", "1000")).toBe(true);
    expect(loosened("5000", "1000")).toBe(true);
    expect(loosened("", "1000")).toBe(true);
    expect(loosened("", "0")).toBe(true);
    expect(loosened("1", "0")).toBe(true);
  });

  it("SR3 keeping, lowering, or setting one where there was none tightens or keeps", () => {
    expect(loosened("1000", "1000")).toBe(false);
    expect(loosened("1000.000", "1000")).toBe(false);
    expect(loosened("999.999", "1000")).toBe(false);
    expect(loosened("0", "1000")).toBe(false);
    expect(loosened("50", "")).toBe(false);
    expect(loosened("", "")).toBe(false);
  });

  it("SR4 a stored quantity the rule refuses can't be compared: any change counts as loosening", () => {
    expect(loosened("0", "abc")).toBe(true);
    expect(loosened("", "1.2.3")).toBe(true);
    expect(loosened("abc", "abc")).toBe(false);
    // A stored row of another shape (jsonb holds anything): judged, never thrown on (security review round 1).
    for (const stored of [null, {}, 5, "1000", { adjustmentApprovalQty: 5 }, { adjustmentApprovalQty: null }])
      expect(stockRulesLoosened(qty("0"), stored as unknown as InventorySettings), JSON.stringify(stored)).toBe(true);
  });

  it("SR5 the rule agrees with what adjustments read: empty never waits, otherwise above the quantity waits", () => {
    expect(adjustmentNeedsApproval("5000", "")).toBe(false);
    expect(adjustmentNeedsApproval("1", "0")).toBe(true);
    expect(adjustmentNeedsApproval("-50.5", "50")).toBe(true);
    expect(adjustmentNeedsApproval("50", "50")).toBe(false);
  });
});
