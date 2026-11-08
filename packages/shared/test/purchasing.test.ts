import { describe, expect, it } from "vitest";
import {
  billFromPurchaseOrder,
  poTotal,
  receivePurchaseOrder,
  type Product,
  type PurchaseOrder,
  type Supplier,
} from "../src";

const carpet = { id: "c", unit: "sq_yd", widthFt: 12, category: "carpet" } as Product;
const lvp = { id: "l", unit: "carton", category: "lvp" } as Product;
const lines = [
  { id: "1", productId: "c", description: "Carpet", quantity: "200", unit: "sq_yd" as const, unitCost: "18.00" },
  { id: "2", productId: "l", description: "LVP", quantity: "40", unit: "carton" as const, unitCost: "36.50" },
];
const po: PurchaseOrder = {
  id: "po",
  number: "PO-3101",
  supplierId: "s",
  status: "sent",
  createdAt: "2026-11-01",
  locationId: "w2",
  expectedAt: "2026-11-08",
  receivedAt: null,
  lines,
  total: poTotal(lines),
};
const supplier = { id: "s", terms: "net_30" } as Supplier;

describe("purchasing", () => {
  it("totals lines in cents", () => {
    expect(po.total).toBe("5060.00");
  });

  it("receiving adds cartons to the ledger and turns broadloom into a roll measured in ft, at the receive-into warehouse", () => {
    const result = receivePurchaseOrder(po, [carpet, lvp], {
      at: "2026-11-07T09:00",
      byUserId: "u1",
      newRollId: () => "r",
      rollNumber: () => "NM-1",
      movementId: () => "m1",
    });
    expect(result.po.status).toBe("received");
    expect(result.movements).toEqual([
      expect.objectContaining({ productId: "l", locationId: "w2", quantity: "40", kind: "receipt" }),
    ]);
    expect(result.rolls[0]).toMatchObject({ locationId: "w2", bin: "Receiving", transferId: null });
    // 200 sq yd × 9 = 1,800 sq ft across 12 ft is 150 ft of roll; cost $18 per sq yd is $2 per sq ft.
    expect(result.rolls[0]).toMatchObject({
      originalLengthFt: "150",
      remainingLengthFt: "150",
      costPerSqFt: "2",
      widthFt: 12,
    });
  });

  it("bills only received orders, due under the supplier's terms", () => {
    expect(() => billFromPurchaseOrder(po, supplier, { id: "b", number: "NM-1", issuedAt: "2026-11-07" })).toThrow(
      /received/,
    );
    const received = { ...po, status: "received" as const };
    expect(
      billFromPurchaseOrder(received, supplier, { id: "b", number: "NM-1", issuedAt: "2026-11-07" }),
    ).toMatchObject({ total: "5060.00", dueAt: "2026-12-07", paid: "0.00" });
  });
});
