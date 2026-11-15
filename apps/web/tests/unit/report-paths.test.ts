import { describe, expect, it } from "vitest";
import { businessReportPath, hubReportPath } from "@/lib/api/http/report-paths";

/** The query of a path as a plain object, and how many times each name appears. */
function queryOf(path: string): { route: string; params: Record<string, string>; names: string[] } {
  const url = new URL(path, "http://api.test");
  return { route: url.pathname, params: Object.fromEntries(url.searchParams), names: [...url.searchParams.keys()] };
}

const DENVER = "0195f3a2-7b1c-7d4e-8f00-00000000dd01";
const STUDIO = "0195f3a2-7b1c-7d4e-8f00-00000000dd02";
const REP = "0195f3a2-7b1c-7d4e-8f00-00000000ee01";
const VENDOR = "0195f3a2-7b1c-7d4e-8f00-00000000ff01";

describe("report paths (ADR 0055 S10: each parameter once, only when set, never a company)", () => {
  it("W-PRM-1 sends every Business report filter that is set, locations as one comma-separated list", () => {
    const { route, params, names } = queryOf(
      businessReportPath({
        from: "2026-10-01",
        to: "2026-10-31",
        locationIds: [DENVER, STUDIO],
        productCategory: "carpet",
        expenseCategory: "rent",
        salesRepId: REP,
        supplierId: VENDOR,
      }),
    );
    expect(route).toBe("/reports/business");
    expect(params).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      locationIds: `${DENVER},${STUDIO}`,
      productCategory: "carpet",
      expenseCategory: "rent",
      salesRepId: REP,
      supplierId: VENDOR,
    });
    expect(new Set(names).size).toBe(names.length);
  });

  it("W-PRM-1 sends only the period when no filter is set and no location is picked", () => {
    const path = businessReportPath({
      from: "2026-01-01",
      to: "2026-12-31",
      locationIds: [],
      productCategory: null,
      expenseCategory: null,
      salesRepId: null,
      supplierId: null,
    });
    expect(path).toBe("/reports/business?from=2026-01-01&to=2026-12-31");
    expect(path).not.toMatch(/company/i);
  });

  it("W-PRM-1 sends a hub report's range, warehouse, category, method and trimmed customer when set", () => {
    expect(queryOf(hubReportPath("/reports/pnl", { range: "3m", locationId: DENVER }))).toEqual({
      route: "/reports/pnl",
      params: { range: "3m", locationId: DENVER },
      names: ["range", "locationId"],
    });
    expect(
      queryOf(hubReportPath("/reports/sales-by-category", { range: "ytd", locationId: null, category: "lvp" })).params,
    ).toEqual({ range: "ytd", category: "lvp" });
    expect(
      queryOf(
        hubReportPath("/reports/payments", {
          range: "12m",
          locationId: DENVER,
          method: "check",
          customer: "  Aspen & Co  ",
        }),
      ).params,
    ).toEqual({ range: "12m", locationId: DENVER, method: "check", customer: "Aspen & Co" });
  });

  it("W-PRM-1 leaves out a null warehouse, category and method and an empty customer, and never adds a company", () => {
    const paths = [
      hubReportPath("/reports/pnl", { range: "1m", locationId: null }),
      hubReportPath("/reports/sales-by-category", { range: "1m", locationId: null, category: null }),
      hubReportPath("/reports/payments", { range: "1m", locationId: null, method: null, customer: "   " }),
    ];
    expect(paths).toEqual([
      "/reports/pnl?range=1m",
      "/reports/sales-by-category?range=1m",
      "/reports/payments?range=1m",
    ]);
    for (const path of paths) expect(path).not.toMatch(/company/i);
  });
});
