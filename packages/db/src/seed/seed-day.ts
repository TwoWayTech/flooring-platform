import { addDays, dateShift, dayInZone, daysBetween, shiftDates } from "@workspace/shared";
import { eq } from "drizzle-orm";
import type { ControlDb } from "../client";
import { tenants } from "../control";
import type { DemoCompany } from "./fixtures";

/**
 * The day the fixtures' anchor moves to for a seed on `day`: the last day on or before it with the
 * anchor's weekday, so the shift is a whole number of weeks and never lands in the future. With
 * whole weeks, dated records keep their weekdays and stay inside the pay periods, timesheet weeks
 * and meeting series they belong to (those move by whole weeks; `shiftDates`); the newest activity
 * lands 0 to 6 days before the seed day.
 */
export function anchorDayFor(anchor: string, day: string): string {
  return addDays(anchor, Math.floor(daysBetween(anchor, day) / 7) * 7);
}

/**
 * The demo company with its fixture dates moved for a seed on `day`, with DemoStore's own shift
 * (`dateShift` and `shiftDates` from packages/shared; blueprint-delta 2026-11-20, "today()") onto
 * `anchorDayFor(anchor, day)`. Dates and instants move by the same number of days, months by whole
 * months, and holidays stay on their own dates. The company's platform record is not moved: the
 * seed reads no date from it.
 */
export function demoOnDay(demo: DemoCompany, day: string): DemoCompany {
  const { anchorDate } = demo.fixtures;
  return {
    company: demo.company,
    fixtures: shiftDates(demo.fixtures, dateShift(anchorDate, anchorDayFor(anchorDate, day))),
  };
}

/**
 * The day a seeded company's data is moved for: the day its control record was first written, in
 * the company's own time zone. The tenant row is created once and kept by every later seed, so a
 * re-seed on a later day computes the first seed's shift again; the rows it finds are kept anyway,
 * and any row it adds lines up with them (never shifted twice).
 */
export async function firstSeedDay(control: ControlDb, tenantId: string): Promise<string> {
  const [tenant] = await control
    .select({ createdAt: tenants.createdAt, timeZone: tenants.timeZone })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant) throw new Error("The seeded company has no control record.");
  return dayInZone(tenant.createdAt, tenant.timeZone);
}
