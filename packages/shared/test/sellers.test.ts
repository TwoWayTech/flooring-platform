import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bestSellers,
  boxedStock,
  customerStatement,
  dec,
  jobCosting,
  lineAmount,
  slowMovers,
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
      .filter((i) => i.issuedAt >= "2026-08-01" && i.status !== "void")
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
      boxedStock(summit.stockMovements),
    );
    expect(slow).toHaveLength(5);
    expect(slow.every((s) => dec(s.onHand).gt(0))).toBe(true);
    expect(slow.map((s) => s.daysWithoutSale)).toEqual([...slow.map((s) => s.daysWithoutSale)].sort((a, b) => b - a));
    const services = new Set(summit.products.filter((p) => p.category === "service").map((p) => p.id));
    expect(slow.some((s) => services.has(s.productId))).toBe(false);
  });
});

describe("customer statement", () => {
  it("ends at the customer's open balance for every customer", () => {
    for (const customer of summit.customers) {
      const lines = customerStatement(summit.invoices, summit.payments, customer.id);
      const open = summit.invoices
        .filter((i) => i.customerId === customer.id && !i.isReturn && i.status !== "void")
        .reduce((s, i) => s.plus(i.total).minus(i.paid), dec(0));
      expect(lines.at(-1)?.balance ?? "0.00", customer.name).toBe(open.toFixed(2));
    }
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
