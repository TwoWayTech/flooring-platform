import { addDays } from "../dates";
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

/** Why hours cannot be saved, or null: 0 to 24 a day with at most two decimals (ADR 0024). */
export function hoursProblem(days: readonly number[]): string | null {
  for (const h of days) {
    if (!Number.isFinite(h) || h < 0 || h > 24) return "Hours must be between 0 and 24 a day.";
    if (Math.abs(Math.round(h * 100) - h * 100) > 1e-6) return "Use at most two decimals.";
  }
  return null;
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
