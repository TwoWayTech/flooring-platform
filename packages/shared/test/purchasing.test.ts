import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allocate,
  billFromReceipts,
  billLedger,
  cartonsFor,
  poState,
  poTotal,
  receiptProblem,
  receiptStock,
  supplierBalance,
  supplierDueDate,
  partCartonProblem,
  type Bill,
  type CompanyFixtures,
  type GoodsReceipt,
  type Product,
  type PurchaseOrder,
  type Supplier,
  type SupplierPayment,
} from "../src";

const carpet = { id: "c", sku: "CP-1", unit: "sq_ft", widthFt: 12, category: "carpet" } as Product;
const lvp = { id: "l", sku: "LV-1", unit: "sq_ft", sqFtPerCarton: "20.00", category: "lvp" } as Product;
const lines = [
  { id: "1", productId: "c", description: "Carpet", quantity: "200", unit: "sq_ft" as const, unitCost: "18.00" },
  { id: "2", productId: "l", description: "LVP", quantity: "40", unit: "sq_ft" as const, unitCost: "36.50" },
];
const po: PurchaseOrder = {
  id: "po",
  number: "PO-3101",
  supplierId: "s",
  status: "ordered",
  createdAt: "2026-11-01",
  locationId: "w2",
  expectedAt: "2026-11-08",
  orderedAt: "2026-11-01",
  cancelledAt: null,
  lines,
  total: poTotal(lines),
  contactId: null,
  contactSnapshot: null,
  supplierRef: "",
  buyerId: "u",
  placedVia: null,
};
const supplier = { id: "s", terms: "net_30", creditLimit: "10000.00" } as Supplier;
const receipt = (id: string, carpetQty: string, lvpQty: string, damaged = "0"): GoodsReceipt => ({
  id,
  number: `GR-${id}`,
  poId: "po",
  supplierId: "s",
  locationId: "w2",
  receivedAt: "2026-11-08T10:00",
  receivedById: "u",
  receivedBy: "Sam",
  note: "",
  lines: [
    { poLineId: "1", productId: "c", received: carpetQty, damaged: "0", rolls: [] },
    { poLineId: "2", productId: "l", received: lvpQty, damaged, rolls: [] },
  ],
});
const fmt = (v: string) => `$${v}`;
const pay = (billId: string, amount: string, status: SupplierPayment["status"] = "confirmed") =>
  ({ id: `p-${amount}`, status, allocations: [{ billId, amount }] }) as SupplierPayment;

describe("purchasing (spec D1 to D3)", () => {
  it("orders area goods by area: cartons are calculated and rounded up", () => {
    expect(cartonsFor("500", "23.64")).toMatchObject({ exact: expect.anything() });
    const { exact, cartons } = cartonsFor("500", "23.64");
    expect([exact.toString(), cartons.toString()]).toEqual(["21.2", "22"]);
  });

  it("dates bills by the supplier's terms", () => {
    expect(supplierDueDate("2026-11-08", "net_60")).toBe("2027-01-07");
    expect(supplierDueDate("2026-11-08", "cod")).toBe("2026-11-08");
    expect(supplierDueDate("2026-11-08", "monthly_statement")).toBe("2026-12-31");
  });

  it("allows partial receipts but never more than is still due, and stocks only good units", () => {
    const first = receipt("a", "100", "30", "2");
    expect(receiptProblem(po, first.lines, [])).toBeNull();
    // Damaged units are still owed by the supplier, so they stay to come.
    expect(receiptProblem(po, receipt("b", "100", "11").lines, [first])).toMatch(/only 10 is still to come/);
    expect(receiptProblem({ ...po, status: "draft" }, first.lines, [])).toMatch(/draft/);
    // A line listed twice, or rolls covering more than arrived, are refused (PR #13 review).
    expect(receiptProblem(po, [...first.lines, ...first.lines], [])).toMatch(/appear once/);
    const carpetLine = { ...first.lines.find((l) => l.productId === "c")!, received: "12" };
    const tooLong = { ...carpetLine, rolls: [{ rollNumber: "R1", dyeLot: "A", lengthFt: "50" }] };
    expect(receiptProblem(po, [tooLong], [], [carpet, lvp])).toMatch(/more than the 12 received/);
    const fits = { ...carpetLine, rolls: [{ rollNumber: "R1", dyeLot: "A", lengthFt: "1" }] };
    expect(receiptProblem(po, [fits], [], [carpet, lvp])).toBeNull();
    let n = 0;
    const { movements, rolls } = receiptStock(po, first, [carpet, lvp], {
      movementId: () => `m${++n}`,
      rollId: () => `r${++n}`,
    });
    expect(movements).toEqual([expect.objectContaining({ productId: "l", quantity: "30", kind: "receipt" })]);
    expect(rolls).toEqual([expect.objectContaining({ productId: "c", remainingLengthFt: "8.3", locationId: "w2" })]);
  });

  it("receives boxed goods in whole cartons of the order line's pack (F-m, ADR 0027)", () => {
    const boxed = { ...po, lines: po.lines.map((l) => (l.id === "2" ? { ...l, sqFtPerCarton: "20.000" } : l)) };
    expect(receiptProblem(boxed, receipt("a", "0", "40").lines, [])).toBeNull();
    expect(receiptProblem(boxed, receipt("a", "0", "30").lines, [])).toBe(
      "LVP: receive whole cartons, multiples of 20 sq ft.",
    );
    expect(receiptProblem(boxed, receipt("a", "0", "20", "5").lines, [])).toBe(
      "LVP: receive whole cartons, multiples of 20 sq ft.",
    );
  });

  it("seeds whole cartons on every order and receipt line, so a partly received order can still be finished (F-m)", () => {
    for (const company of ["summit", "keystone"]) {
      const fixtures = JSON.parse(
        readFileSync(fileURLToPath(new URL(`../fixtures/${company}.json`, import.meta.url)), "utf8"),
      ) as CompanyFixtures;
      const orders = fixtures.purchaseOrders;
      expect(orders.length, company).toBeGreaterThan(0);
      for (const order of orders) expect(partCartonProblem(order.lines, "order"), order.number).toBeNull();
      const lineOf = new Map(orders.flatMap((order) => order.lines.map((line) => [line.id, line] as const)));
      for (const receipt of fixtures.receipts) {
        const quantities = receipt.lines.flatMap((line) => {
          const ordered = lineOf.get(line.poLineId)!;
          return [line.received, line.damaged].map((quantity) => ({ ...ordered, quantity }));
        });
        expect(partCartonProblem(quantities, "receive"), receipt.number).toBeNull();
      }
    }
  });

  it("derives the order status from receipts, bills and supplier payments", () => {
    const today = "2026-11-20";
    expect(poState(po, [], [], [], today)).toBe("ordered");
    const part = receipt("a", "100", "40");
    expect(poState(po, [part], [], [], today)).toBe("partly_received");
    const all = [part, receipt("b", "100", "0")];
    expect(poState(po, all, [], [], today)).toBe("received");
    const bill = billFromReceipts(po, supplier, all, {
      id: "b1",
      number: "S-1",
      issuedAt: "2026-11-09",
      total: po.total,
      formatMoney: fmt,
    });
    expect(bill.matchIssues).toEqual([]);
    expect(poState(po, all, [bill], [], today)).toBe("billed");
    expect(poState(po, all, [bill], [pay("b1", "100.00")], today)).toBe("partly_paid");
    expect(poState(po, all, [bill], [pay("b1", po.total)], today)).toBe("paid");
    expect(poState({ ...po, status: "cancelled" }, [], [], [], today)).toBe("cancelled");
  });

  it("flags a bill that differs from what was received", () => {
    const bill = billFromReceipts(po, supplier, [receipt("a", "100", "40")], {
      id: "b",
      number: "S-2",
      issuedAt: "2026-11-09",
      total: "4000.00",
      formatMoney: fmt,
    });
    expect(bill.matchIssues[0]).toMatch(/received goods worth \$3260.00/);
  });

  it("pays bills from confirmed payments only, oldest first when one payment covers several", () => {
    const b = (id: string, dueAt: string, total: string) => ({ id, dueAt, total, supplierId: "s" }) as Bill;
    expect(
      billLedger(b("x", "2026-11-01", "100.00"), [pay("x", "40.00"), pay("x", "60.00", "pending")], "2026-11-09"),
    ).toMatchObject({
      paid: "40.00",
      balance: "60.00",
      state: "partial",
      overdue: true,
    });
    expect(
      allocate("150.00", [
        { ...b("late", "2026-12-01", "100.00"), balance: "100.00" },
        { ...b("early", "2026-11-01", "100.00"), balance: "100.00" },
      ]),
    ).toEqual([
      { billId: "early", amount: "100.00" },
      { billId: "late", amount: "50.00" },
    ]);
    const bills = [b("x", "2026-12-01", "2500.00")];
    const ledgers = new Map([["x", billLedger(bills[0]!, [], "2026-11-09")]]);
    expect(supplierBalance(supplier, bills, ledgers)).toMatchObject({
      owed: "2500.00",
      creditUsedPct: "25",
      nextDueAt: "2026-12-01",
    });
  });
});
