import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bestSellers,
  customerCredit,
  customerStatement,
  dec,
  jobCosting,
  ledgerIndex,
  lineAmount,
  moneyString,
  slowMovers,
  sum,
  type CompanyFixtures,
} from "../src";

const summit = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "summit.json"), "utf8")) as CompanyFixtures;
const today = summit.anchorDate;

describe("best sellers and slow movers", () => {
  it("ranks material revenue highest first and matches the invoice lines", () => {
    const best = bestSellers(summit.invoices, "2026-08-01", 5);
    expect(best).toHaveLength(5);
    expect(best.map((b) => Number(b.revenue))).toEqual([...best.map((b) => Number(b.revenue))].sort((a, b) => b - a));
    const top = best[0]!;
    const manual = summit.invoices
      .filter((i) => i.issuedAt >= "2026-08-01" && !i.voidedAt)
      .flatMap((i) =>
        i.lines.filter((l) => l.productId === top.productId && l.category === "material").map((l) => ({ l, i })),
      )
      .reduce((s, { l, i }) => s.plus(lineAmount(l).times(i.isReturn ? -1 : 1)), dec(0));
    expect(top.revenue).toBe(manual.toFixed(2));
  });

  it("lists stocked products that sell least recently, without services", () => {
    const slow = slowMovers(
      summit.products,
      summit.rolls,
      summit.invoices,
      today,
      5,
      summit.stockMovements,
    );
    expect(slow).toHaveLength(5);
    expect(slow.every((s) => dec(s.onHand).gt(0))).toBe(true);
    expect(slow.map((s) => s.daysWithoutSale)).toEqual([...slow.map((s) => s.daysWithoutSale)].sort((a, b) => b - a));
    const services = new Set(summit.products.filter((p) => p.category === "service").map((p) => p.id));
    expect(slow.some((s) => services.has(s.productId))).toBe(false);
  });
});

describe("customer statement", () => {
  it("ends at the customer's open balance minus their credit, for every customer", () => {
    const docs = {
      invoices: summit.invoices,
      payments: summit.payments,
      adjustments: summit.invoiceAdjustments,
      refunds: summit.refunds,
    };
    const ledgers = ledgerIndex(summit.invoices, docs, "2026-11-04");
    for (const customer of summit.customers) {
      const lines = customerStatement(docs, customer.id);
      const open = sum(
        summit.invoices.filter((i) => i.customerId === customer.id).map((i) => ledgers.get(i.id)!.balance),
      );
      const credit = customerCredit(customer.id, summit.invoices, ledgers, summit.invoiceAdjustments, summit.refunds);
      expect(lines.at(-1)?.balance ?? "0.00", customer.name).toBe(moneyString(open.minus(credit)));
    }
  });

  it("shows only confirmed payments, credits, write-offs and refunds, with the running balance", () => {
    const invoice = { ...summit.invoices[0]!, id: "x1", number: "INV-X1", customerId: "cx", total: "100.00" };
    const credit = { ...invoice, id: "x2", number: "CR-X2", isReturn: true, refundedAt: null, total: "30.00" };
    const pay = (id: string, amount: string, status: "confirmed" | "pending" | "voided") => ({
      ...summit.payments[0]!,
      id,
      number: id,
      invoiceId: "x1",
      customerId: "cx",
      amount,
      status,
      date: "2026-11-02",
    });
    const lines = customerStatement(
      {
        invoices: [
          { ...invoice, issuedAt: "2026-11-01" },
          { ...credit, issuedAt: "2026-11-03" },
        ],
        payments: [
          pay("PAY-A", "40.00", "confirmed"),
          pay("PAY-B", "60.00", "pending"),
          pay("PAY-C", "9.00", "voided"),
        ],
        adjustments: [
          {
            id: "a1",
            invoiceId: "x1",
            customerId: "cx",
            kind: "write_off",
            amount: "1.00",
            reason: "",
            byName: "",
            at: "2026-11-04T10:00",
          },
        ],
        refunds: [],
      },
      "cx",
    );
    expect(lines.map((l) => [l.kind, l.amount, l.balance])).toEqual([
      ["invoice", "100.00", "100.00"],
      ["payment", "-40.00", "60.00"],
      ["credit", "-30.00", "30.00"],
      ["write_off", "-1.00", "29.00"],
    ]);
  });
});

describe("job costing", () => {
  it("adds materials and labor and takes them from revenue", () => {
    const costing = jobCosting({
      materials: [{ cost: "1200.50" }, { cost: "99.50" }] as never,
      laborCost: "640.00",
      revenue: "3100.00",
    });
    expect(costing).toMatchObject({ materials: "1300.00", cost: "1940.00", margin: "1160.00" });
    expect(Number(costing.marginPct)).toBeCloseTo(37.42, 2);
  });
});
