import { describe, expect, it } from "vitest";
import {
  averageCost,
  billPosting,
  costOfGoodsPosting,
  postingProblem,
  receiptPosting,
  stockAdjustmentPosting,
  supplierPaymentPosting,
} from "../src";

const sides = (lines: { account: string; debit: string; credit: string }[]) =>
  lines.map((entry) => [entry.account, entry.debit, entry.credit]);

/** Stock and payables postings (P12 part 3; ADR 0042). */
describe("stock and payables postings", () => {
  it("receives goods into inventory per warehouse against goods received not billed", () => {
    const draft = receiptPosting({ id: "gr-1", number: "GR-0007", date: "2026-11-10", orderNumber: "PO-3001" }, [
      { locationId: "wh-a", value: "300.00" },
      { locationId: "wh-b", value: "120.50" },
    ]);
    expect(sides(draft.lines)).toEqual([
      ["inventory", "300.00", "0.00"],
      ["inventory", "120.50", "0.00"],
      ["received_not_billed", "0.00", "420.50"],
    ]);
    expect(draft.lines[1]!.locationId).toBe("wh-b");
    expect(postingProblem(draft.lines)).toBeNull();
  });

  it("moves a bill from goods received to payables, with any price difference in inventory", () => {
    const bill = { id: "b-1", number: "NM-1", issuedAt: "2026-11-11", supplierName: "Mill" };
    expect(sides(billPosting({ ...bill, total: "420.50" }, "420.50").lines)).toEqual([
      ["received_not_billed", "420.50", "0.00"],
      ["accounts_payable", "0.00", "420.50"],
    ]);
    const over = billPosting({ ...bill, total: "430.00" }, "420.50");
    expect(sides(over.lines)).toContainEqual(["inventory", "9.50", "0.00"]);
    const under = billPosting({ ...bill, total: "400.00" }, "420.50");
    expect(sides(under.lines)).toContainEqual(["inventory", "0.00", "20.50"]);
    for (const draft of [over, under]) expect(postingProblem(draft.lines)).toBeNull();
  });

  it("pays a supplier from the method's bank", () => {
    const draft = supplierPaymentPosting(
      { id: "sp-1", number: "SP-0003", date: "2026-11-12", amount: "200.00", supplierName: "Mill" },
      "bank:0193a1b2-0000-7000-8000-000000000001",
    );
    expect(sides(draft.lines)).toEqual([
      ["accounts_payable", "200.00", "0.00"],
      ["bank:0193a1b2-0000-7000-8000-000000000001", "0.00", "200.00"],
    ]);
  });

  it("posts a count above the books as a gain and below as a loss", () => {
    const base = { id: "adj-1", number: "ADJ-0001", date: "2026-11-12", locationId: "wh-a", productName: "Slate" };
    expect(sides(stockAdjustmentPosting(base, "42.00").lines)).toEqual([
      ["inventory", "42.00", "0.00"],
      ["inventory_adjustments", "0.00", "42.00"],
    ]);
    expect(sides(stockAdjustmentPosting(base, "-42.00").lines)).toEqual([
      ["inventory_adjustments", "42.00", "0.00"],
      ["inventory", "0.00", "42.00"],
    ]);
  });

  it("issues goods to cost of goods sold at the selling location", () => {
    const draft = costOfGoodsPosting(
      { id: "c-1", number: "INV-1001", date: "2026-11-12", warehouseId: "wh-a", soldAtId: "loc-denver", memo: "Cut" },
      "88.10",
    );
    expect(draft.lines.map((entry) => [entry.account, entry.locationId])).toEqual([
      ["cost_of_goods_sold", "loc-denver"],
      ["inventory", "wh-a"],
    ]);
  });

  it("keeps a moving average cost, and takes the received cost when nothing is on hand", () => {
    expect(averageCost("100", "2.0000", "100", "3.0000")).toBe("2.5000");
    expect(averageCost("0", "2.0000", "40", "3.1250")).toBe("3.1250");
    expect(averageCost("-5", "2.0000", "40", "3.1250")).toBe("3.1250");
    expect(averageCost("30", "1.0000", "70", "2.0000")).toBe("1.7000");
  });
});
