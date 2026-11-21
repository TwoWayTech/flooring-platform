import {
  dec,
  sum,
  overtimeRuleFor,
  splitOvertime,
  workweekStartOf,
  type Employee,
  type OvertimeRule,
  type Timesheet,
} from "@workspace/shared";

/** A timesheet with its worker and the overtime split under that worker's rule. */
export interface WeekRow {
  sheet: Timesheet;
  employee: Employee;
  rule: OvertimeRule;
  /** The week's hours, added with decimal.js, as a decimal string (CLAUDE.md rule 6). */
  total: string;
  split: ReturnType<typeof splitOvertime>;
  /** Overtime plus double time, as a decimal string (CLAUDE.md rule 6). */
  extraHours: string;
}

/** HR Home's people and hours figures (spec C1 HR Home). */
export interface HrHomeFigures {
  /** Active W-2 employees, the headcount; contractors have their own figure. */
  staff: Employee[];
  contractors: number;
  /** The current workweek's first day, the week the hours are for. */
  week: string;
  /** Hours on this week's timesheets, any status, as a decimal string (CLAUDE.md rule 6). */
  hours: string;
  overtime: string;
}

/**
 * HR Home's figures (click-through #65). Hours are the timesheets of the workweek holding today,
 * the same sheets the pay period lists, so a week with no timesheets reads 0 rather than an older
 * week's total. Headcount leaves 1099 contractors out; they are counted on their own.
 */
export function hrHomeFigures(
  employees: readonly Employee[],
  sheets: readonly Timesheet[],
  today: string,
  workweekStartDay: number,
  companyRule: OvertimeRule,
): HrHomeFigures {
  const active = employees.filter((e) => e.status !== "terminated");
  const week = workweekStartOf(today, workweekStartDay);
  const rows = weekRows(sheets, employees, week, companyRule);
  return {
    staff: active.filter((e) => e.workerType !== "1099"),
    contractors: active.filter((e) => e.workerType === "1099").length,
    week,
    hours: sum(rows.map((r) => r.total)).toString(),
    overtime: sum(rows.map((r) => r.extraHours)).toString(),
  };
}

/** Week starts that have timesheets, newest first. */
export function weeksOf(sheets: readonly Timesheet[]): string[] {
  return [...new Set(sheets.map((s) => s.weekStart))].sort().reverse();
}

/**
 * One week's timesheets with overtime computed per worker (US pack: federal 40-hour week; the
 * California daily rule for workers in California).
 */
export function weekRows(
  sheets: readonly Timesheet[],
  employees: readonly Employee[],
  week: string,
  companyRule: OvertimeRule,
): WeekRow[] {
  return sheets
    .filter((s) => s.weekStart === week)
    .flatMap((sheet) => {
      const employee = employees.find((e) => e.id === sheet.employeeId);
      if (!employee) return [];
      const rule = overtimeRuleFor(employee.state, companyRule);
      const total = sum(sheet.days).toString();
      // The shared split takes decimal strings; the demo sheet keeps numbers.
      const split = splitOvertime(
        sheet.days.map((h) => String(h)),
        rule,
      );
      const extraHours = dec(split.overtime).plus(split.doubleTime).toString();
      return [{ sheet, employee, rule, total, split, extraHours }];
    })
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
}
