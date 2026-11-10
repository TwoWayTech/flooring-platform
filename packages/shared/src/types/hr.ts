import type { CompanyId } from "./company";
import type { FileMeta } from "./sales";

/** How overtime law treats a worker (ADR 0024). */
export type FlsaStatus = "non_exempt" | "exempt" | "not_applicable";

/** One item of an onboarding or offboarding checklist (spec C1). */
export interface ChecklistItem {
  id: string;
  label: string;
  doneAt: string | null;
}

/** An employee. Pay rate is sensitive (hr.employee.view_sensitive). */
export interface Employee {
  id: string;
  companyId: CompanyId;
  name: string;
  title: string;
  department: string;
  workerType: "w2" | "1099";
  payType: "hourly" | "salary" | "per_job";
  payRate: string;
  state: string;
  email: string;
  phone: string;
  hiredAt: string;
  status: "active" | "on_leave" | "terminated";
  managerId: string | null;
  /** The id the employee had in the previous system, set by an import (spec G1). */
  externalId?: string;
  flsaStatus: FlsaStatus;
  exemptionBasis: "executive" | "administrative" | "professional" | "outside_sales" | null;
  /** The hours a non-exempt salary is meant to cover; 40 in California (ADR 0024). */
  salaryHoursPerWeek: number;
  /** Null follows the company setting (spec C1 "per-employee override"). */
  commissionVisible: boolean | null;
  /** The location whose profit this person's pay counts in (ADR 0023). */
  homeLocationId: string | null;
  birthDate: string | null;
  emergencyContact: { name: string; phone: string; relation: string } | null;
  documents: FileMeta[];
  onboarding: ChecklistItem[];
  offboarding: ChecklistItem[];
}

/** One step in a timesheet's history (ADR 0024). */
export interface TimesheetEvent {
  at: string;
  by: string;
  action: "submitted" | "approved" | "rejected" | "reopened" | "uploaded";
  reason: string | null;
}

/**
 * One week of hours for one employee, starting on the company's workweek day. Status is draft →
 * submitted → approved or rejected; a rejected sheet goes back to the employee to correct.
 */
export interface Timesheet {
  id: string;
  employeeId: string;
  weekStart: string;
  days: number[];
  status: "draft" | "submitted" | "approved" | "rejected";
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  source: "form" | "upload" | "clock";
  history: TimesheetEvent[];
}

/** A clock-in or -out; a day's punches fill the draft timesheet (spec C2, optional per company). */
export interface ClockEntry {
  id: string;
  employeeId: string;
  date: string;
  inAt: string;
  outAt: string | null;
}

/** A time-off policy (ADR 0024). */
export interface TimeOffPolicy {
  id: string;
  name: string;
  kind: "vacation" | "sick" | "personal" | "unpaid";
  paid: boolean;
  accrualMethod: "per_pay_period" | "per_hour_worked" | "annual_grant" | "none";
  /** Hours per pay period, hours per hour worked, or hours per year, by method. */
  accrualRate: string;
  /** Accrual pauses at this balance; empty means no cap. */
  capHours: string;
  annualUseLimitHours: string;
  carryoverHours: string;
  waitingPeriodDays: number;
  allowNegative: boolean;
}

/** A line of the time-off ledger; a balance is the sum of its lines (ADR 0024). */
export interface TimeOffEntry {
  id: string;
  employeeId: string;
  policyId: string;
  date: string;
  kind: "accrual" | "used" | "adjustment" | "carryover" | "forfeit" | "payout";
  /** Positive adds hours, negative takes them. */
  hours: string;
  note: string;
  requestId: string | null;
  /** Set on accrual posted by approving a pay period, so reopening it can take it back. */
  payPeriodId: string | null;
}

/** A time-off request. */
export interface PtoRequest {
  id: string;
  employeeId: string;
  policyId: string;
  start: string;
  end: string;
  hours: string;
  kind: "vacation" | "sick" | "personal" | "unpaid";
  status: "pending" | "approved" | "denied" | "cancelled";
  note: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

/** A pay period (spec C1): open, in review, approved, exported. An exported period is locked. */
export interface PayPeriod {
  id: string;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  start: string;
  end: string;
  payDate: string;
  status: "open" | "in_review" | "approved" | "exported";
  approvedBy: string | null;
  approvedAt: string | null;
  exportedAt: string | null;
  /** Employees left out for this period, each with a reason. */
  excluded: { employeeId: string; reason: string }[];
  /** The lines as approved; empty until then, because they are computed live. */
  lines: PayPeriodLine[];
}

/** One employee's gross pay for one period, as the export file carries it (ADR 0024). */
export interface PayPeriodLine {
  employeeId: string;
  hoursWorked: string;
  overtimeHours: string;
  doubleTimeHours: string;
  paidLeaveHours: string;
  unpaidLeaveHours: string;
  baseRate: string;
  straightTimePay: string;
  overtimePremium: string;
  paidLeavePay: string;
  salaryAmount: string;
  salaryDeduction: string;
  commissionPay: string;
  nondiscretionaryBonus: string;
  discretionaryBonus: string;
  overtimeTrueUp: string;
  grossPay: string;
  /** Overtime in a week that ends in the next period, settled there. */
  straddleNote: string | null;
  weeks: PayWeek[];
}

/** One workweek ending in the period, for the workweek CSV. */
export interface PayWeek {
  weekStart: string;
  weekEnd: string;
  hoursWorked: string;
  overtimeHours: string;
  doubleTimeHours: string;
  allocatedEarnings: string;
  regularRate: string;
  overtimePremium: string;
  straddlesPeriod: boolean;
}

/** An amount paid to a 1099 contractor; never in a pay period (ADR 0024). */
export interface ContractorPayment {
  id: string;
  employeeId: string;
  date: string;
  description: string;
  amount: string;
  status: "approved" | "paid";
}

/** A bonus, by kind, because the kind decides overtime treatment (ADR 0024). */
export interface Bonus {
  id: string;
  employeeId: string;
  amount: string;
  kind: "production" | "flat_sum" | "discretionary";
  periodStart: string;
  periodEnd: string;
  approvedBy: string;
  reason: string;
}

/** A commission plan version (ADR 0025); editing makes a new version. */
export interface CommissionPlan {
  id: string;
  name: string;
  version: number;
  status: "draft" | "active" | "retired";
  effectiveFrom: string;
  effectiveTo: string | null;
  basis: "paid_revenue" | "gross_margin";
  baseRatePct: string;
  monthlyTarget: string;
  tierMode: "marginal" | "retroactive";
  tiers: { fromPctOfTarget: string; ratePct: string }[];
  overridePct: string;
  draw: { kind: "none" | "recoverable" | "non_recoverable"; monthlyAmount: string };
  clawbackDays: number;
}

/** Who is on a plan, and the signed receipt (Labor Code 2751, ADR 0025). */
export interface CommissionAssignment {
  id: string;
  userId: string;
  planId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  monthlyTargetOverride: string | null;
  acknowledgement: { signedName: string; signedAt: string } | null;
}

/** A person's statement for one month (ADR 0025). Approved means frozen; figures are derived. */
export interface CommissionStatement {
  id: string;
  userId: string;
  month: string;
  status: "draft" | "approved" | "paid";
  approvedBy: string | null;
  approvedAt: string | null;
  payPeriodId: string | null;
}

/** A manual change to a statement; always has a reason (spec C1). */
export interface CommissionAdjustment {
  id: string;
  userId: string;
  month: string;
  amount: string;
  /** Required when the amount is negative: a deduction must point at an identified sale (ADR 0025). */
  invoiceId: string | null;
  reason: string;
  byName: string;
  at: string;
  /** Set when this entry records HR's decision on a reversal outside its window (ADR 0025). */
  decides: { lineId: string; outcome: "applied" | "waived" } | null;
}
