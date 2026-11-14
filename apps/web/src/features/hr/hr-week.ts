import {
  dec,
  sum,
  overtimeRuleFor,
  splitOvertime,
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
