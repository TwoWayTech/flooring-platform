import { describe, expect, it } from "vitest";
import { dateShift, mondayOf, shiftDates } from "../src";

describe("shiftDates", () => {
  const anchor = "2026-11-04";

  it("moves dates and date-times by whole days, leaving other strings alone", () => {
    const shift = dateShift(anchor, "2026-11-07");
    const out = shiftDates(
      { issuedAt: "2026-11-04", at: "2026-10-30T08:15", name: "2026 plan", total: "12.50" },
      shift,
    );
    expect(out).toEqual({ issuedAt: "2026-11-07", at: "2026-11-02T08:15", name: "2026 plan", total: "12.50" });
  });

  it("keeps timesheet weeks on Mondays and lines this week up with today's week", () => {
    for (const today of ["2026-11-07", "2026-11-08", "2026-11-09", "2027-01-20"]) {
      const shift = dateShift(anchor, today);
      const { weekStart } = shiftDates({ weekStart: mondayOf(anchor) }, shift);
      expect(weekStart).toBe(mondayOf(today));
    }
  });

  it("moves month keys with the dates around them", () => {
    const shift = dateShift(anchor, "2026-12-20");
    expect(shiftDates({ month: "2026-11" }, shift)).toEqual({ month: "2026-12" });
  });

  it("returns the input untouched when there is no shift", () => {
    const data = { issuedAt: anchor };
    expect(shiftDates(data, dateShift(anchor, anchor))).toBe(data);
  });
});
