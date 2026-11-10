import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bestSellersIn,
  changePct,
  dec,
  isYear,
  periodRange,
  sparkSeries,
  teamStats,
  type CompanyFixtures,
} from "../src";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;
const today = summit.anchorDate;

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
  it("reads commission from the HR lines and shows nothing for someone with none", () => {
    const inputs = { users: summit.users, invoices: summit.invoices, payments: summit.payments, quotes: summit.quotes };
    const commission = new Map([[sales.id, { earned: "120.00", paid: "100.00", pending: "20.00" }]]);
    const row = teamStats({ ...inputs, commission }, { from: "2026-01-01", to: today, today }).find(
      (r) => r.userId === sales.id,
    )!;
    expect(dec(row.paidRevenue).gt(0)).toBe(true);
    expect(row).toMatchObject({ earned: "120.00", paid: "100.00", pending: "20.00" });
    const none = teamStats({ ...inputs, commission: new Map() }, { from: "2026-01-01", to: today, today });
    expect(none.find((r) => r.userId === sales.id)!.earned).toBe("0.00");
  });
});
