import type {
  FlsaStatus,
  PayPeriod,
  PayWeek,
  PtoRequest,
  TimeOffEntry,
  TimeOffPolicy,
  TimesheetEvent,
} from "@workspace/shared";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { appendOnly, at, business, day, money, quantity, rate, userRef } from "../columns";
import { locations } from "./organization";

/**
 * An employee, W-2 or 1099, optionally linked to a user (ADR 0024). Pay rate is sensitive. No
 * Social Security or bank numbers are stored; the payroll provider holds them (blueprint "Security").
 */
export const employees = pgTable("employees", {
  ...business(),
  name: text().notNull(),
  title: text().notNull().default(""),
  department: text().notNull().default(""),
  workerType: text().$type<"w2" | "1099">().notNull(),
  payType: text().$type<"hourly" | "salary" | "per_job">().notNull(),
  payRate: money().notNull(),
  state: text().notNull(),
  email: text().notNull().default(""),
  phone: text().notNull().default(""),
  hiredAt: day().notNull(),
  status: text().$type<"active" | "on_leave" | "terminated">().notNull(),
  managerId: uuid().references((): AnyPgColumn => employees.id),
  externalId: text(),
  flsaStatus: text().$type<FlsaStatus>().notNull(),
  exemptionBasis: text().$type<"executive" | "administrative" | "professional" | "outside_sales">(),
  salaryHoursPerWeek: integer().notNull().default(40),
  commissionVisible: boolean(),
  homeLocationId: uuid().references(() => locations.id),
  birthDate: day(),
  emergencyContact: jsonb().$type<{ name: string; phone: string; relation: string }>(),
});

/**
 * Each employee's manager over time, append-only (owner decision 2026-11-15; ADR 0048): a commission
 * override goes to the rep's manager on the line's confirmed day, not today's, read with `managerOn`
 * in packages/shared. Setting or changing a manager adds a row; rows are never changed or hidden. An
 * employee with no row reads `employees.manager_id`, which is what overrides used before this table.
 */
export const employeeManagerHistory = pgTable(
  "employee_manager_history",
  {
    ...appendOnly(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    /** The manager from `effective_from` on; null means no manager. */
    managerId: uuid().references(() => employees.id),
    /**
     * The first day this manager applies, on the company's calendar. Null means since records began:
     * only the backfill (company migration 0005) or a person's first recorded change writes it, for
     * the manager they had before that change.
     */
    effectiveFrom: day(),
  },
  (table) => [index("employee_manager_history_employee_idx").on(table.employeeId, table.effectiveFrom)],
);

/** One onboarding or offboarding step for an employee (spec C1). */
export const employeeChecklistItems = pgTable("employee_checklist_items", {
  ...business(),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id),
  list: text().$type<"onboarding" | "offboarding">().notNull(),
  position: integer().notNull(),
  label: text().notNull(),
  doneAt: at(),
});

/**
 * One week of hours for one employee, from the company's workweek day (ADR 0024). The hours per
 * day are rows of time_entries; the history of submits and decisions is a snapshot list.
 */
export const timesheets = pgTable(
  "timesheets",
  {
    ...business(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    weekStart: day().notNull(),
    status: text().$type<"draft" | "submitted" | "approved" | "rejected">().notNull(),
    submittedAt: at(),
    decidedById: userRef(),
    decidedAt: at(),
    rejectionReason: text(),
    source: text().$type<"form" | "upload" | "clock">().notNull(),
    history: jsonb().$type<TimesheetEvent[]>().notNull().default([]),
  },
  (table) => [uniqueIndex("timesheets_week_uidx").on(table.employeeId, table.weekStart)],
);

/** Hours worked on one day of a timesheet. */
export const timeEntries = pgTable(
  "time_entries",
  {
    ...business(),
    timesheetId: uuid()
      .notNull()
      .references(() => timesheets.id),
    date: day().notNull(),
    hours: quantity().notNull(),
  },
  (table) => [uniqueIndex("time_entries_day_uidx").on(table.timesheetId, table.date)],
);

/** A clock-in and clock-out; a day's punches fill the draft timesheet (spec C2). */
export const clockEntries = pgTable("clock_entries", {
  ...business(),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id),
  date: day().notNull(),
  inAt: at().notNull(),
  outAt: at(),
});

/** A time-off policy (ADR 0024). An empty cap or limit means none. */
export const timeOffPolicies = pgTable("time_off_policies", {
  ...business(),
  name: text().notNull(),
  kind: text().$type<TimeOffPolicy["kind"]>().notNull(),
  paid: boolean().notNull(),
  accrualMethod: text().$type<TimeOffPolicy["accrualMethod"]>().notNull(),
  accrualRate: rate().notNull(),
  capHours: quantity(),
  annualUseLimitHours: quantity(),
  carryoverHours: quantity(),
  waitingPeriodDays: integer().notNull().default(0),
  allowNegative: boolean().notNull().default(false),
});

/** A request for time off. */
export const ptoRequests = pgTable("pto_requests", {
  ...business(),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id),
  policyId: uuid()
    .notNull()
    .references(() => timeOffPolicies.id),
  start: day().notNull(),
  end: day().notNull(),
  hours: quantity().notNull(),
  kind: text().$type<PtoRequest["kind"]>().notNull(),
  status: text().$type<PtoRequest["status"]>().notNull(),
  note: text().notNull().default(""),
  decidedById: userRef(),
  decidedAt: at(),
  decisionReason: text(),
});

/** The time-off ledger, append-only: a balance is the sum of its rows (ADR 0024, replaces pto_balances). */
export const timeOffEntries = pgTable(
  "time_off_entries",
  {
    ...appendOnly(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    policyId: uuid()
      .notNull()
      .references(() => timeOffPolicies.id),
    date: day().notNull(),
    kind: text().$type<TimeOffEntry["kind"]>().notNull(),
    hours: quantity().notNull(),
    note: text().notNull().default(""),
    requestId: uuid().references(() => ptoRequests.id),
    payPeriodId: uuid().references((): AnyPgColumn => payPeriods.id),
  },
  (table) => [index("time_off_entries_employee_idx").on(table.employeeId, table.policyId)],
);

/** A pay period up to gross pay; exported periods are locked (ADR 0024, plan N-3). */
export const payPeriods = pgTable("pay_periods", {
  ...business(),
  frequency: text().$type<PayPeriod["frequency"]>().notNull(),
  start: day().notNull(),
  end: day().notNull(),
  payDate: day().notNull(),
  status: text().$type<PayPeriod["status"]>().notNull(),
  approvedById: userRef(),
  approvedAt: at(),
  exportedAt: at(),
});

/** An employee left out of one pay period, with the reason. */
export const payPeriodExclusions = pgTable("pay_period_exclusions", {
  ...business(),
  payPeriodId: uuid()
    .notNull()
    .references(() => payPeriods.id),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id),
  reason: text().notNull(),
});

/** One employee's gross pay for a period, frozen when the period is approved (ADR 0024). */
export const payPeriodLines = pgTable("pay_period_lines", {
  ...business(),
  payPeriodId: uuid()
    .notNull()
    .references(() => payPeriods.id),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id),
  hoursWorked: quantity().notNull(),
  overtimeHours: quantity().notNull(),
  doubleTimeHours: quantity().notNull(),
  paidLeaveHours: quantity().notNull(),
  unpaidLeaveHours: quantity().notNull(),
  baseRate: money().notNull(),
  straightTimePay: money().notNull(),
  overtimePremium: money().notNull(),
  paidLeavePay: money().notNull(),
  salaryAmount: money().notNull(),
  salaryDeduction: money().notNull(),
  commissionPay: money().notNull(),
  nondiscretionaryBonus: money().notNull(),
  discretionaryBonus: money().notNull(),
  overtimeTrueUp: money().notNull(),
  grossPay: money().notNull(),
  straddleNote: text(),
  /** The workweeks ending in the period, for the workweek CSV. */
  weeks: jsonb().$type<PayWeek[]>().notNull().default([]),
});

/** A bonus; its kind decides overtime treatment (ADR 0024). */
export const bonuses = pgTable("bonuses", {
  ...business(),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id),
  amount: money().notNull(),
  kind: text().$type<"production" | "flat_sum" | "discretionary">().notNull(),
  periodStart: day().notNull(),
  periodEnd: day().notNull(),
  approvedById: userRef().notNull(),
  reason: text().notNull(),
});

/** An amount paid to a 1099 contractor; never part of a pay period (ADR 0024). */
export const contractorPayments = pgTable("contractor_payments", {
  ...business(),
  employeeId: uuid()
    .notNull()
    .references(() => employees.id),
  date: day().notNull(),
  description: text().notNull(),
  amount: money().notNull(),
  status: text().$type<"approved" | "paid">().notNull(),
});
