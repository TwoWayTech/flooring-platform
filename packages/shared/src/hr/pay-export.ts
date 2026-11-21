import type { Employee, PayPeriod, ViewedPayLine } from "../types";

/** The label every gross-pay figure carries (spec C1, assumption C-1). */
export const GROSS_PAY_LABEL = "Gross pay estimate. Taxes and net pay are calculated by your payroll provider.";

/**
 * A pay line with its person, as the exports read it. The line may lack its rates and salary when
 * the viewer can't see them (CLAUDE.md rule 5): those cells are then left empty.
 */
export interface PayExportRow {
  line: ViewedPayLine;
  employee: Employee;
}

/** The summary file for the payroll provider: one row per employee (ADR 0024). */
export function paySummaryTable(period: PayPeriod, rows: readonly PayExportRow[]): string[][] {
  return [
    [
      "employee_external_id",
      "employee_name",
      "employee_email",
      "flsa_status",
      "work_state",
      "pay_period_start",
      "pay_period_end",
      "pay_date",
      "hours_worked",
      "overtime_premium_hours",
      "double_time_premium_hours",
      "paid_leave_hours",
      "unpaid_leave_hours",
      "base_rate",
      "salary_amount",
      "salary_deduction",
      "straight_time_pay",
      "overtime_premium",
      "paid_leave_pay",
      "commission_pay",
      "nondiscretionary_bonus",
      "discretionary_bonus",
      "overtime_true_up",
      "gross_pay_estimate",
    ],
    ...rows.map(({ line, employee }) => [
      employee.externalId ?? "",
      employee.name,
      employee.email,
      employee.flsaStatus,
      employee.state,
      period.start,
      period.end,
      period.payDate,
      line.hoursWorked,
      line.overtimeHours,
      line.doubleTimeHours,
      line.paidLeaveHours,
      line.unpaidLeaveHours,
      line.baseRate ?? "",
      line.salaryAmount ?? "",
      line.salaryDeduction,
      line.straightTimePay,
      line.overtimePremium,
      line.paidLeavePay,
      line.commissionPay,
      line.nondiscretionaryBonus,
      line.discretionaryBonus,
      line.overtimeTrueUp,
      line.grossPay,
    ]),
  ];
}

/** The workweek file: one row per employee per workweek ending in the period (ADR 0024). */
export function payWorkweekTable(rows: readonly PayExportRow[]): string[][] {
  return [
    [
      "employee_external_id",
      "workweek_start",
      "workweek_end",
      "hours_worked",
      "overtime_hours",
      "double_time_hours",
      "allocated_earnings",
      "regular_rate",
      "overtime_premium",
      "straddles_period",
    ],
    ...rows.flatMap(({ line, employee }) =>
      line.weeks.map((w) => [
        employee.externalId ?? employee.email,
        w.weekStart,
        w.weekEnd,
        w.hoursWorked,
        w.overtimeHours,
        w.doubleTimeHours,
        w.allocatedEarnings,
        w.regularRate ?? "",
        w.overtimePremium,
        w.straddlesPeriod ? "yes" : "no",
      ]),
    ),
  ];
}
