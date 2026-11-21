import { describe, expect, it } from "vitest";
import { HUB_LOCATION_FILTERS, hubLocationProblem, hubLocationsOf, REPORT_QUERY_MESSAGES as M } from "../src";
import { loadFixtures } from "./report-fixtures";

describe("hub report place filters (rule 24; PR #82 open question)", () => {
  const live = loadFixtures("summit").locations;
  const showrooms = live.filter((l) => l.kind === "showroom");

  it("calls Profit and loss's filter Location and offers every location, as the Business report does", () => {
    expect(showrooms.length).toBeGreaterThan(0);
    expect(HUB_LOCATION_FILTERS.pnl).toMatchObject({ label: "Location", all: "All locations" });
    expect(hubLocationsOf("pnl", live).map((l) => l.id)).toEqual(live.map((l) => l.id));
  });

  it("keeps Warehouse, and warehouses only, on Sales by category and Payments received", () => {
    for (const report of ["sales", "payments"] as const) {
      expect(HUB_LOCATION_FILTERS[report]).toMatchObject({ label: "Warehouse", all: "All warehouses" });
      expect(hubLocationsOf(report, live).every((l) => l.kind === "warehouse")).toBe(true);
      expect(hubLocationsOf(report, live)).toHaveLength(live.length - showrooms.length);
    }
  });

  it("refuses only a place the filter does not offer, in that filter's words", () => {
    const showroom = showrooms[0]!.id;
    expect(hubLocationProblem("pnl", null, live)).toBeNull();
    expect(hubLocationProblem("pnl", showroom, live)).toBeNull();
    expect(hubLocationProblem("pnl", "sm-loc-nowhere", live)).toBe(M.location);
    expect(hubLocationProblem("sales", showroom, live)).toBe(M.warehouse);
    expect(hubLocationProblem("payments", showroom, live)).toBe(M.warehouse);
  });
});
