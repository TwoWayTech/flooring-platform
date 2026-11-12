import type { ExpenseCategory, PaymentMethod } from "@workspace/shared";
import { boolean, integer, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { at, business, day, money, userRef } from "../columns";
import { locations } from "./organization";
import { supplierBills, suppliers } from "./purchasing";

/**
 * Money the company spends (ADR 0023). The cost is amount + tax, always derived. A null location
 * means company-wide, shared across locations by the shared-cost rule. Pay later links a bill.
 */
export const expenses = pgTable(
  "expenses",
  {
    ...business(),
    number: text().notNull(),
    date: day().notNull(),
    supplierId: uuid().references(() => suppliers.id),
    category: text().$type<ExpenseCategory>().notNull(),
    locationId: uuid().references(() => locations.id),
    amount: money().notNull(),
    tax: money().notNull().default("0"),
    paymentMethod: text().$type<PaymentMethod>().notNull(),
    reference: text().notNull().default(""),
    note: text().notNull().default(""),
    status: text().$type<"draft" | "pending" | "confirmed" | "rejected" | "voided">().notNull(),
    settlement: text().$type<"paid" | "on_account">().notNull(),
    dueAt: day(),
    billId: uuid().references(() => supplierBills.id),
    recurringId: uuid().references((): AnyPgColumn => recurringExpenses.id),
    /** The period a recurring draft is for, such as 2026-11. */
    period: text(),
    recordedById: userRef().notNull(),
    recordedAt: at().notNull(),
    reviewedById: userRef(),
    reviewedAt: at(),
    rejectReason: text(),
    voidedById: userRef(),
    voidedAt: at(),
    voidReason: text(),
  },
  (table) => [uniqueIndex("expenses_number_uidx").on(table.number)],
);

/** A cost that repeats; it makes one draft per period to confirm (spec F1). */
export const recurringExpenses = pgTable("recurring_expenses", {
  ...business(),
  supplierId: uuid()
    .notNull()
    .references(() => suppliers.id),
  category: text().$type<ExpenseCategory>().notNull(),
  locationId: uuid().references(() => locations.id),
  amount: money().notNull(),
  tax: money().notNull().default("0"),
  paymentMethod: text().$type<PaymentMethod>().notNull(),
  frequency: text().$type<"monthly" | "quarterly" | "yearly">().notNull(),
  dayOfMonth: integer().notNull(),
  startsOn: day().notNull(),
  endsOn: day(),
  active: boolean().notNull().default(true),
  note: text().notNull().default(""),
});
