import { addDays } from "../dates";
import { dec } from "../money";
import type { Bonus, Employee, PayPeriod, PayPeriodLine, Timesheet } from "../types";
import { needsTimesheet } from "./timesheets";

/** A workweek that stops a run's approval: its hours are not approved, or no sheet exists (hr.md "Pay periods"). */
export interface PayRunBlocker {
  employeeId: string;
  employeeName: string;
  weekStart: string;
  status: Timesheet["status"] | "missing";
}

/**
 * Who is in a run (hr.md rule 15): W-2 people who have not left and were hired by the period's
 * end. 1099 workers are never in a pay period; they are paid as contractor payments.
 */
export function payableEmployees(employees: readonly Employee[], period: Pick<PayPeriod, "end">): Employee[] {
  return employees.filter((e) => e.workerType === "w2" && e.status !== "terminated" && e.hiredAt <= period.end);
}

/** The last day of each workweek that ends inside the period, for the company's workweek start (hr.md rule 6). */
export function weekEndsIn(period: Pick<PayPeriod, "start" | "end">, workweekStartDay: number): string[] {
  const ends: string[] = [];
  for (let d = period.start; d <= period.end; d = addDays(d, 1)) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === (workweekStartDay + 6) % 7) ends.push(d);
  }
  return ends;
}

/**
 * The blockers of a run (hr.md "Pay periods", `blockersFor`): for each person in the run who uses
 * timesheets and is not left out, every workweek ending in the period whose sheet is not approved.
 * A missing sheet counts, unless the week ended before the hire date.
 */
export function payRunBlockers(
  period: Pick<PayPeriod, "start" | "end">,
  employees: readonly Employee[],
  sheets: readonly Pick<Timesheet, "employeeId" | "weekStart" | "status">[],
  excludedIds: ReadonlySet<string>,
  workweekStartDay: number,
): PayRunBlocker[] {
  const weekEnds = weekEndsIn(period, workweekStartDay);
  return employees
    .filter((e) => needsTimesheet(e) && !excludedIds.has(e.id))
    .flatMap((e) =>
      weekEnds.flatMap((end) => {
        const weekStart = addDays(end, -6);
        if (end < e.hiredAt) return [];
        const sheet = sheets.find((s) => s.employeeId === e.id && s.weekStart === weekStart);
        if (sheet?.status === "approved") return [];
        return [{ employeeId: e.id, employeeName: e.name, weekStart, status: sheet?.status ?? ("missing" as const) }];
      }),
    );
}

/** A person's bonuses that join this run: those whose own period ends inside it (hr.md "Bonus"). */
export function bonusesInRun(
  bonuses: readonly Bonus[],
  employeeId: string,
  period: Pick<PayPeriod, "start" | "end">,
): Bonus[] {
  return bonuses.filter((b) => b.employeeId === employeeId && b.periodEnd >= period.start && b.periodEnd <= period.end);
}

/**
 * The people in a run whose gross pay is below the commission it pays (ADR 0048, residual risk
 * "gross clamp"): gross never goes below zero, so an exempt full-day deduction larger than the
 * salary would swallow part of an approved statement and leave it in Accrued Payroll unpaid. The
 * run is refused until HR fixes the leave or leaves the person out, so commission is never lost.
 */
export function commissionShortfalls(
  lines: readonly Pick<PayPeriodLine, "employeeId" | "grossPay" | "commissionPay">[],
): string[] {
  return lines.filter((line) => dec(line.grossPay).lt(line.commissionPay)).map((line) => line.employeeId);
}
