import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bestSellers, dec, lineAmount, slowMovers, type CompanyFixtures } from "../src";

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
    const slow = slowMovers(summit.products, summit.rolls, summit.invoices, today, 5);
    expect(slow).toHaveLength(5);
    expect(slow.every((s) => dec(s.onHand).gt(0))).toBe(true);
    expect(slow.map((s) => s.daysWithoutSale)).toEqual([...slow.map((s) => s.daysWithoutSale)].sort((a, b) => b - a));
    const services = new Set(summit.products.filter((p) => p.category === "service").map((p) => p.id));
    expect(slow.some((s) => services.has(s.productId))).toBe(false);
  });
});
