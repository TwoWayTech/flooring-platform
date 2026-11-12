import type { CommissionPlan } from "@workspace/shared";
import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, business, day, money, rate, userRef } from "../columns";
import { payPeriods } from "./hr";
import { invoices } from "./sales";

/**
 * A commission plan version (ADR 0025): editing an active plan makes a new version. Commission
 * lines are never stored; they are computed from confirmed payments by commissionLines in
 * packages/shared, and the server must run the same function inside the payment transaction.
 */
export const commissionPlans = pgTable(
  "commission_plans",
  {
    ...business(),
    name: text().notNull(),
    version: integer().notNull(),
    status: text().$type<CommissionPlan["status"]>().notNull(),
    effectiveFrom: day().notNull(),
    effectiveTo: day(),
    basis: text().$type<CommissionPlan["basis"]>().notNull(),
    baseRatePct: rate().notNull(),
    monthlyTarget: money().notNull(),
    tierMode: text().$type<CommissionPlan["tierMode"]>().notNull(),
    tiers: jsonb().$type<CommissionPlan["tiers"]>().notNull().default([]),
    overridePct: rate().notNull().default("0"),
    draw: jsonb().$type<CommissionPlan["draw"]>().notNull(),
    clawbackDays: integer().notNull(),
  },
  (table) => [uniqueIndex("commission_plans_version_uidx").on(table.name, table.version)],
);

/** Who is on a plan, and their signed acknowledgement (ADR 0025). */
export const commissionAssignments = pgTable("commission_assignments", {
  ...business(),
  userId: userRef().notNull(),
  planId: uuid()
    .notNull()
    .references(() => commissionPlans.id),
  effectiveFrom: day().notNull(),
  effectiveTo: day(),
  monthlyTargetOverride: money(),
  acknowledgedName: text(),
  acknowledgedAt: at(),
});

/** A person's statement for one month; approved means frozen, figures are derived (ADR 0025). */
export const commissionStatements = pgTable(
  "commission_statements",
  {
    ...business(),
    userId: userRef().notNull(),
    /** The month as YYYY-MM. */
    month: text().notNull(),
    status: text().$type<"draft" | "approved" | "paid">().notNull(),
    approvedById: userRef(),
    approvedAt: at(),
    payPeriodId: uuid().references(() => payPeriods.id),
  },
  (table) => [uniqueIndex("commission_statements_uidx").on(table.userId, table.month)],
);

/**
 * A manual change to a statement, always with a reason; a deduction must name the sale behind it
 * (ADR 0025). decides records HR's call on a reversal outside its window.
 */
export const commissionAdjustments = pgTable("commission_adjustments", {
  ...business(),
  userId: userRef().notNull(),
  month: text().notNull(),
  amount: money().notNull(),
  invoiceId: uuid().references(() => invoices.id),
  reason: text().notNull(),
  byUserId: userRef().notNull(),
  at: at().notNull(),
  decides: jsonb().$type<{ lineId: string; outcome: "applied" | "waived" }>(),
});
