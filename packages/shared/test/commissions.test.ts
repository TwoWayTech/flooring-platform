import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bestSellersIn,
  changePct,
  dec,
  isYear,
  ledgerIndex,
  periodRange,
  rateFor,
  ruleFor,
  sparkSeries,
  teamStats,
  type CommissionRule,
  type CompanyFixtures,
} from "../src";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;
const today = summit.anchorDate;
const rules = summit.settings.commissions.rules;

describe("dashboard periods (spec E1)", () => {
  it("covers the period and the same length before it", () => {
    expect(periodRange("month", "2026-11-04")).toEqual({
      from: "2026-11-01",
      to: "2026-11-04",
      prevFrom: "2026-10-28",
      prevTo: "2026-10-31",
    });
    expect(periodRange("quarter", "2026-11-04").from).toBe("2026-10-01");
    expect(periodRange("ytd", "2026-11-04").from).toBe("2026-01-01");
    expect(periodRange("30d", "2026-11-04").from).toBe("2026-10-06");
    expect(isYear(periodRange("ytd", "2026-11-04"))).toBe(true);
    expect(isYear(periodRange("month", "2026-11-04"))).toBe(false);
  });

  it("reports the change vs the previous period, and buckets a sparkline", () => {
    expect(changePct("110", "100")).toBe("10");
    expect(changePct("5", "0")).toBeNull();
    const series = sparkSeries(
      [
        { at: "2026-11-01", v: 2 },
        { at: "2026-11-30", v: 3 },
      ],
      (d) => d.at,
      (d) => dec(d.v),
      "2026-11-01",
      "2026-11-30",
    );
    expect(series).toHaveLength(12);
    expect(series[0]).toBe(2);
    expect(series.at(-1)).toBe(3);
  });

  it("ranks best sellers by the chosen measure", () => {
    const range = { from: "2026-01-01", to: today, limit: 5 };
    const byRevenue = bestSellersIn(summit.invoices, summit.products, { ...range, metric: "revenue" });
    const byQuantity = bestSellersIn(summit.invoices, summit.products, { ...range, metric: "quantity" });
    expect(dec(byRevenue[0]!.revenue).gte(byRevenue[1]!.revenue)).toBe(true);
    expect(dec(byQuantity[0]!.quantity).gte(byQuantity[1]!.quantity)).toBe(true);
  });
});

describe("commissions (spec E2)", () => {
  const sales = summit.users.find((u) => u.roleIds.some((r) => r.endsWith("-role-sales")))!;
  const own: CommissionRule = {
    id: "x",
    appliesTo: { kind: "user", userId: sales.id },
    basis: "gross_margin",
    ratePct: "10",
    tiers: [],
  };

  it("uses a person's own rule before their role's, and the highest tier reached", () => {
    expect(ruleFor(sales, summit.roles, rules)?.id).toBe("com-rule-sales");
    expect(ruleFor(sales, summit.roles, [...rules, own])?.id).toBe("x");
    expect(rateFor(rules[0]!, dec("49999.99"))).toBe("5");
    expect(rateFor(rules[0]!, dec("50000"))).toBe("6");
  });

  it("earns on confirmed payments only, and what was earned this month is still pending", () => {
    const ledgers = ledgerIndex(summit.invoices, { payments: summit.payments, adjustments: [] }, today);
    const inputs = {
      users: summit.users,
      roles: summit.roles,
      rules,
      invoices: summit.invoices,
      ledgers,
      payments: summit.payments,
      quotes: summit.quotes,
    };
    const year = teamStats(inputs, { from: "2026-01-01", to: today, today });
    const row = year.find((r) => r.userId === sales.id)!;
    expect(dec(row.paidRevenue).gt(0)).toBe(true);
    const rate = rateFor(rules[0]!, dec(row.paidRevenue));
    expect(row.earned).toBe(dec(row.paidRevenue).times(rate).div(100).toDecimalPlaces(2).toFixed(2));
    expect(dec(row.paid).plus(row.pending).toFixed(2)).toBe(row.earned);
    const unpaid = teamStats({ ...inputs, payments: [] }, { from: "2026-01-01", to: today, today });
    expect(unpaid.find((r) => r.userId === sales.id)!.earned).toBe("0.00");
  });
});
