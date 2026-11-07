import { overtimeRuleFor, splitOvertime, type Employee, type OvertimeRule, type Timesheet } from "@workspace/shared";

/** A timesheet with its worker and the overtime split under that worker's rule. */
export interface WeekRow {
  sheet: Timesheet;
  employee: Employee;
  rule: OvertimeRule;
  total: number;
  split: ReturnType<typeof splitOvertime>;
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
      const total = sheet.days.reduce((a, b) => a + b, 0);
      return [{ sheet, employee, rule, total, split: splitOvertime(sheet.days, rule) }];
    })
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
}
