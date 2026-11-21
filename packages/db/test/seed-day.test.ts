import { addDays, daysBetween, mondayOf } from "@workspace/shared";
import { describe, expect, it } from "vitest";
import { loadDemoCompany } from "../src/seed/fixtures";
import { anchorDayFor, demoOnDay } from "../src/seed/seed-day";

const fixed = loadDemoCompany("summit");
const anchor = fixed.fixtures.anchorDate;
/** 17 days after the anchor, as on 2026-11-21: the anchor lands 3 days before, after two whole weeks. */
const day = addDays(anchor, 17);
const landed = addDays(anchor, 14);
const moved = demoOnDay(fixed, day);

/** A fixture day as a weekday number (0 is Sunday). */
const weekday = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();

describe("anchorDayFor", () => {
  it("is the last day on or before the seed day with the anchor's weekday", () => {
    expect(anchorDayFor(anchor, anchor)).toBe(anchor);
    expect(anchorDayFor(anchor, addDays(anchor, 6))).toBe(anchor);
    expect(anchorDayFor(anchor, addDays(anchor, 7))).toBe(addDays(anchor, 7));
    expect(anchorDayFor(anchor, day)).toBe(landed);
  });
});

describe("demoOnDay (the seed's shift, DemoStore's shiftDates in whole weeks)", () => {
  it("lands the anchor on its weekday at most 6 days before the day, and moves every date by the same days", () => {
    expect(moved.fixtures.anchorDate).toBe(landed);
    fixed.fixtures.invoices.forEach((invoice, at) => {
      const after = moved.fixtures.invoices[at]!.issuedAt;
      expect(daysBetween(invoice.issuedAt.slice(0, 10), after.slice(0, 10))).toBe(14);
      expect(weekday(after)).toBe(weekday(invoice.issuedAt));
    });
  });

  it("moves an instant by the same days and keeps its time of day", () => {
    const paid = fixed.fixtures.payments.find((payment) => payment.recordedAt.length > 10)!;
    const after = moved.fixtures.payments.find((payment) => payment.id === paid.id)!.recordedAt;
    expect(after.slice(10)).toBe(paid.recordedAt.slice(10));
    expect(daysBetween(paid.recordedAt.slice(0, 10), after.slice(0, 10))).toBe(14);
  });

  it("keeps timesheet weeks on Mondays and pay periods lined up with their anchor", () => {
    for (const sheet of moved.fixtures.timesheets) expect(mondayOf(sheet.weekStart)).toBe(sheet.weekStart);
    expect(daysBetween(fixed.fixtures.payPeriods[0]!.start, moved.fixtures.payPeriods[0]!.start)).toBe(14);
    expect(daysBetween(fixed.fixtures.settings.hr.payPeriodAnchor, moved.fixtures.settings.hr.payPeriodAnchor)).toBe(
      14,
    );
  });

  it("keeps holidays on their own dates and leaves the loaded fixtures as they were", () => {
    expect(moved.fixtures.settings.hr.holidays).toEqual(fixed.fixtures.settings.hr.holidays);
    expect(fixed.fixtures.anchorDate).toBe(anchor);
  });

  it("moves nothing within the anchor's own week", () => {
    expect(demoOnDay(fixed, addDays(anchor, 3)).fixtures).toEqual(fixed.fixtures);
  });
});
