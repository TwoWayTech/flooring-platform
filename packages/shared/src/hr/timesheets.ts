import { addDays } from "../dates";
import { dec } from "../money";
import type { Employee, PtoRequest, Timesheet } from "../types";

/** Weekday names by number, 0 = Sunday, for the workweek setting. */
export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** The first day of the fixed workweek that holds a date (ADR 0024: the workweek must be designated). */
export function workweekStartOf(date: string, startDay: number): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday - startDay + 7) % 7));
}

/** Short day headings for a week starting on a given day. */
export function weekdayHeadings(startDay: number): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_LABELS[(startDay + i) % 7]!.slice(0, 3));
}

/** Whether someone fills in timesheets: non-exempt W-2 staff, including salaried non-exempt (ADR 0024). */
export function needsTimesheet(e: Pick<Employee, "workerType" | "flsaStatus" | "status">): boolean {
  return e.workerType === "w2" && e.flsaStatus === "non_exempt" && e.status !== "terminated";
}

/** Why a sheet needs a person to look at it; flagged sheets are left out of bulk approve (ADR 0024). */
export function timesheetFlags(sheet: Timesheet, leave: readonly PtoRequest[]): string[] {
  const flags: string[] = [];
  if (sheet.days.every((h) => h === 0)) flags.push("No hours entered");
  if (sheet.days.every((h) => h > 0)) flags.push("Worked all seven days");
  if (sheet.days.some((h) => h > 16)) flags.push("A day over 16 hours");
  const away = leave.filter((r) => r.employeeId === sheet.employeeId && r.status === "approved");
  const clash = sheet.days.some((h, i) => {
    if (h === 0) return false;
    const day = addDays(sheet.weekStart, i);
    return away.some((r) => r.start <= day && r.end >= day && Number(r.hours) >= 8);
  });
  if (clash) flags.push("Hours on a day of approved leave");
  return flags;
}

/**
 * Why hours cannot be saved, or null: 0 to 24 a day with at most two decimals (ADR 0024). The API
 * takes hours as decimal strings (CLAUDE.md rule 6; ADR 0046), so the check reads them with decimal.js.
 */
export function hoursTextProblem(days: readonly string[]): string | null {
  for (const h of days) {
    if (!/^-?\d+(\.\d+)?$/.test(h)) return "Enter hours as a number, such as 8 or 7.5.";
    const hours = dec(h);
    if (hours.isNegative() || hours.gt(24)) return "Hours must be between 0 and 24 a day.";
    if (hours.decimalPlaces() > 2) return "Use at most two decimals.";
  }
  return null;
}

/** `hoursTextProblem` for the screens' numbers (the shared Timesheet type keeps `days` as numbers). */
export function hoursProblem(days: readonly number[]): string | null {
  if (days.some((h) => !Number.isFinite(h))) return "Hours must be between 0 and 24 a day.";
  return hoursTextProblem(days.map((h) => dec(h).toFixed()));
}

/** The columns of the timesheet template (ADR 0024), in order. */
export const TIMESHEET_TEMPLATE_HEADERS = [
  "employee_email",
  "employee_external_id",
  "employee_name",
  "work_date",
  "hours_worked",
  "note",
] as const;

/** A template with one row per employee per day of a week, ready to fill (spec C1, C2). */
export function timesheetTemplate(employees: readonly Employee[], weekStart: string): string[][] {
  const rows = employees.flatMap((e) =>
    Array.from({ length: 7 }, (_, i) => [e.email, e.externalId ?? "", e.name, addDays(weekStart, i), "", ""]),
  );
  return [[...TIMESHEET_TEMPLATE_HEADERS], ...rows];
}

/** Hours between a clock-in and a clock-out as a decimal string, to two decimals; never below zero (spec C2). */
export function clockedHoursText(inAt: string, outAt: string): string {
  const millis = Math.max(0, Date.parse(outAt) - Date.parse(inAt));
  return dec(millis).div(3_600_000).toDecimalPlaces(2).toString();
}

/** A week's days, as decimal strings, with clocked hours added to one day (ADR 0024). */
export function withClockedHoursText(days: readonly string[], index: number, hours: string): string[] {
  return days.map((h, i) => (i === index ? dec(h).plus(hours).toDecimalPlaces(2).toString() : h));
}

/** `clockedHoursText` as a number, for the screens' Timesheet type. */
export function clockedHours(inAt: string, outAt: string): number {
  return Number(clockedHoursText(inAt, outAt));
}

/** `withClockedHoursText` on the screens' numbers. */
export function withClockedHours(days: readonly number[], index: number, hours: number): number[] {
  const text = days.map((h) => dec(h).toFixed());
  return withClockedHoursText(text, index, dec(hours).toFixed()).map(Number);
}

/**
 * A timesheet as the API sends and takes it: each day's hours a decimal string such as "7.5"
 * (CLAUDE.md rule 6). The shared Timesheet keeps numbers for the screens and the demo, so the web
 * client converts at the boundary (ADR 0046, "Hours on the wire").
 */
export type TimesheetWire = Omit<Timesheet, "days"> & { days: string[] };

/** The screens' Timesheet from the API's, at the ApiClient boundary (ADR 0046). */
export function timesheetFromWire(sheet: TimesheetWire): Timesheet {
  return { ...sheet, days: sheet.days.map(Number) };
}

/** A week's hours as the API takes them: decimal strings without exponent form (ADR 0046). */
export function hoursToWire(days: readonly number[]): string[] {
  return days.map((h) => (Number.isFinite(h) ? dec(h).toFixed() : String(h)));
}
