import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { CompanyDb, ControlDb } from "@workspace/db";
import {
  bonuses,
  contractorPayments,
  payPeriodExclusions,
  payPeriodLines,
  payPeriods,
  settings,
} from "@workspace/db/company";
import {
  dec,
  moneyString,
  payLineFigure,
  type Bonus,
  type CompanySettings,
  type ContractorPayment,
  type Employee,
  type PayPeriod,
  type PayPeriodLine,
} from "@workspace/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { loadNames, minuteOf } from "../sales/invoice-records";
import { notFound } from "../sales/sales-common";
import { workFactsOnly } from "./hr-records";

/** A stored pay period row. */
export type PayPeriodRow = typeof payPeriods.$inferSelect;

/** A stored pay line row. */
export type PayLineRow = typeof payPeriodLines.$inferSelect;

/** The company's pay schedule, from Settings → HR (hr.md "HrSettings"; CLAUDE.md rule 12). */
export interface PaySchedule {
  frequency: PayPeriod["frequency"];
  anchor: string;
}

const FREQUENCIES: readonly PayPeriod["frequency"][] = ["weekly", "biweekly", "semimonthly", "monthly"];

/**
 * The pay frequency and anchor from Settings → HR. A company that never saved them has no pay
 * schedule, so no period can be opened: 409 `settings_missing`, as hours answer without a workweek.
 */
export async function loadPaySchedule(db: CompanyDb): Promise<PaySchedule> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.group, "hr"), isNull(settings.deletedAt)));
  const hr = row?.value as Partial<CompanySettings["hr"]> | undefined;
  const frequency = hr?.payFrequency;
  const anchor = hr?.payPeriodAnchor;
  if (
    !frequency ||
    !FREQUENCIES.includes(frequency) ||
    typeof anchor !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(anchor)
  ) {
    throw new ConflictException({
      code: "settings_missing",
      message: "Choose the pay frequency in Settings → HR first.",
    });
  }
  return { frequency, anchor };
}

/**
 * Payroll covers the whole company and can't be cut to a branch or a team (hr.md "Who uses it":
 * Owner, Accountant and HR manager, all company-wide), so it is for data scope `all` only, like the
 * books (`requireCompanyWide`, PR #16 review). Anyone else gets 403, whatever key they hold.
 */
export function requireCompanyWidePayroll(access: RequestAccess): void {
  if (access.dataScope !== "all") {
    throw new ForbiddenException({ code: "forbidden", message: "Payroll covers the whole company." });
  }
}

/** A stored pay line as the screens read it, hours and rate formatted as `grossPay` makes them live. */
export function lineView(row: PayLineRow): PayPeriodLine {
  return {
    employeeId: row.employeeId,
    hoursWorked: payLineFigure(row.hoursWorked),
    overtimeHours: payLineFigure(row.overtimeHours),
    doubleTimeHours: payLineFigure(row.doubleTimeHours),
    paidLeaveHours: payLineFigure(row.paidLeaveHours),
    unpaidLeaveHours: payLineFigure(row.unpaidLeaveHours),
    // Stored to the cent (numeric(14,2)), as the live line shows it.
    baseRate: payLineFigure(row.baseRate),
    straightTimePay: moneyString(row.straightTimePay),
    overtimePremium: moneyString(row.overtimePremium),
    paidLeavePay: moneyString(row.paidLeavePay),
    salaryAmount: moneyString(row.salaryAmount),
    salaryDeduction: moneyString(row.salaryDeduction),
    commissionPay: moneyString(row.commissionPay),
    nondiscretionaryBonus: moneyString(row.nondiscretionaryBonus),
    discretionaryBonus: moneyString(row.discretionaryBonus),
    overtimeTrueUp: moneyString(row.overtimeTrueUp),
    grossPay: moneyString(row.grossPay),
    straddleNote: row.straddleNote,
    weeks: row.weeks,
  };
}

/** A computed pay line as a row to freeze at approval (hr.md "To approved"). */
export function lineRow(payPeriodId: string, line: PayPeriodLine, by: string): typeof payPeriodLines.$inferInsert {
  return {
    payPeriodId,
    employeeId: line.employeeId,
    hoursWorked: line.hoursWorked,
    overtimeHours: line.overtimeHours,
    doubleTimeHours: line.doubleTimeHours,
    paidLeaveHours: line.paidLeaveHours,
    unpaidLeaveHours: line.unpaidLeaveHours,
    baseRate: dec(line.baseRate).toDecimalPlaces(2).toString(),
    straightTimePay: line.straightTimePay,
    overtimePremium: line.overtimePremium,
    paidLeavePay: line.paidLeavePay,
    salaryAmount: line.salaryAmount,
    salaryDeduction: line.salaryDeduction,
    commissionPay: line.commissionPay,
    nondiscretionaryBonus: line.nondiscretionaryBonus,
    discretionaryBonus: line.discretionaryBonus,
    overtimeTrueUp: line.overtimeTrueUp,
    grossPay: line.grossPay,
    straddleNote: line.straddleNote,
    weeks: line.weeks,
    createdBy: by,
  };
}

/** Pay periods with who is left out and the frozen lines, newest first; approvers by name. */
export async function loadPayPeriods(db: CompanyDb, control: ControlDb, ids?: readonly string[]): Promise<PayPeriod[]> {
  const rows = await db
    .select()
    .from(payPeriods)
    .where(and(isNull(payPeriods.deletedAt), ids ? inArray(payPeriods.id, [...ids]) : undefined))
    .orderBy(desc(payPeriods.start), asc(payPeriods.id));
  if (rows.length === 0) return [];
  const periodIds = rows.map((row) => row.id);
  const [excluded, lines, names] = await Promise.all([
    db
      .select()
      .from(payPeriodExclusions)
      .where(and(isNull(payPeriodExclusions.deletedAt), inArray(payPeriodExclusions.payPeriodId, periodIds)))
      .orderBy(asc(payPeriodExclusions.id)),
    db
      .select()
      .from(payPeriodLines)
      .where(and(isNull(payPeriodLines.deletedAt), inArray(payPeriodLines.payPeriodId, periodIds)))
      .orderBy(asc(payPeriodLines.id)),
    loadNames(
      control,
      rows.map((row) => row.approvedById),
    ),
  ]);
  return rows.map((row) => ({
    id: row.id,
    frequency: row.frequency,
    start: row.start,
    end: row.end,
    payDate: row.payDate,
    status: row.status,
    approvedBy: row.approvedById ? (names.get(row.approvedById) ?? "") : null,
    approvedAt: row.approvedAt ? minuteOf(row.approvedAt) : null,
    exportedAt: row.exportedAt ? minuteOf(row.exportedAt) : null,
    excluded: excluded
      .filter((x) => x.payPeriodId === row.id)
      .map((x) => ({ employeeId: x.employeeId, reason: x.reason })),
    lines: lines.filter((line) => line.payPeriodId === row.id).map(lineView),
  }));
}

/** One pay period, or 404. */
export async function loadPayPeriod(db: CompanyDb, control: ControlDb, id: string): Promise<PayPeriod> {
  const [period] = await loadPayPeriods(db, control, [id]);
  if (!period) throw notFound("pay period");
  return period;
}

/** Locks a pay period for a write; every payroll write takes it before any employee lock. */
export async function lockPayPeriod(tx: CompanyDb, id: string): Promise<PayPeriodRow> {
  const [row] = await tx.select().from(payPeriods).where(eq(payPeriods.id, id)).for("update");
  if (!row || row.deletedAt) throw notFound("pay period");
  return row;
}

/** Live bonuses, newest period first; approvers by name (hr.md "Bonus"). */
export async function loadBonuses(db: CompanyDb, control: ControlDb, ids?: readonly string[]): Promise<Bonus[]> {
  const rows = await db
    .select()
    .from(bonuses)
    .where(and(isNull(bonuses.deletedAt), ids ? inArray(bonuses.id, [...ids]) : undefined))
    .orderBy(desc(bonuses.periodEnd), asc(bonuses.id));
  const names = await loadNames(
    control,
    rows.map((row) => row.approvedById),
  );
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    amount: moneyString(row.amount),
    kind: row.kind,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    approvedBy: names.get(row.approvedById) ?? "",
    reason: row.reason,
  }));
}

/** Live contractor payments, newest first (hr.md "ContractorPayment"). */
export async function loadContractorPayments(db: CompanyDb, ids?: readonly string[]): Promise<ContractorPayment[]> {
  const rows = await db
    .select()
    .from(contractorPayments)
    .where(and(isNull(contractorPayments.deletedAt), ids ? inArray(contractorPayments.id, [...ids]) : undefined))
    .orderBy(desc(contractorPayments.date), asc(contractorPayments.id));
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    date: row.date,
    description: row.description,
    amount: moneyString(row.amount),
    status: row.status,
  }));
}

/**
 * A person as payroll shows them: the work facts and the email the payroll file carries (hr.md
 * "Reports", `employee_email`), never their phone, birthday, emergency contact, documents or
 * checklists. The pay rate is stripped by the interceptor without `hr.employee.view_sensitive`.
 */
export function payrollPerson(employee: Employee): Employee {
  return { ...workFactsOnly(employee), email: employee.email };
}
