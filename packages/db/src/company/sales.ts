import type {
  Address,
  PaymentMethod,
  PaymentStatus,
  QuoteStatus,
  SellUnit,
  TaxCategory,
  TaxOverride,
  TaxRule,
  TaxSource,
} from "@workspace/shared";
import { boolean, doublePrecision, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, business, day, money, quantity, rate, unitCost, userRef } from "../columns";
import { products } from "./catalog";
import { contractBillings, contracts } from "./contracts";
import { customers } from "./customers";
import { rolls } from "./inventory";
import { branches, locations } from "./organization";

/** The tax rule version an invoice used, kept so history never changes (blueprint p21). */
type TaxRuleSnapshot = Pick<TaxRule, "state" | "jurisdiction" | "ratePct" | "version">;

/**
 * The columns quote and invoice lines share (packages/shared DocLine). Quantities are in the
 * selling unit, sq ft for area goods (ADR 0027); waste is internal and already in the quantity.
 */
const docLine = () => ({
  position: integer().notNull(),
  productId: uuid().references(() => products.id),
  description: text().notNull(),
  category: text().$type<TaxCategory>().notNull(),
  unit: text().$type<SellUnit>().notNull(),
  quantity: quantity().notNull(),
  unitPrice: unitCost().notNull(),
  unitCost: unitCost().notNull(),
  wastePct: rate(),
  rollId: uuid().references(() => rolls.id),
  sqFtPerCarton: quantity(),
  /** Set when the line ships from another warehouse than its document (spec A2). */
  locationId: uuid().references(() => locations.id),
});

/** A quote (spec B1). Expired is derived from expires_at; totals are a snapshot for lists. */
export const quotes = pgTable(
  "quotes",
  {
    ...business(),
    number: text().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    salesRepId: userRef().notNull(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    status: text().$type<QuoteStatus>().notNull(),
    sentAt: at(),
    expiresAt: day(),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    soldAtLocationId: uuid().references(() => locations.id),
    jobSite: jsonb().$type<Address>().notNull(),
    depositPct: rate().notNull().default("0"),
    lumpSum: boolean().notNull().default(false),
    taxOverride: jsonb().$type<TaxOverride>(),
    total: money().notNull(),
    notes: text().notNull().default(""),
  },
  (table) => [uniqueIndex("quotes_number_uidx").on(table.number)],
);

/** A room rectangle measured on a quote, in ft (blueprint "measurement_rooms"). */
export const measurementRooms = pgTable("measurement_rooms", {
  ...business(),
  quoteId: uuid()
    .notNull()
    .references(() => quotes.id),
  name: text().notNull(),
  x: doublePrecision().notNull(),
  y: doublePrecision().notNull(),
  widthFt: quantity().notNull(),
  lengthFt: quantity().notNull(),
});

/** A quote line; room_ids lists the rooms it was measured from. */
export const quoteLines = pgTable("quote_lines", {
  ...business(),
  quoteId: uuid()
    .notNull()
    .references(() => quotes.id),
  ...docLine(),
  roomIds: uuid().array().notNull().default([]),
});

/**
 * An invoice, or a credit note when is_return is set (ADR 0013, plan K-11). Status, paid and
 * balance are never stored: they come from payments, credits and write-offs. Retainage stays off
 * the total until released: total = subtotal + tax − withheld + released (ADR 0026).
 */
export const invoices = pgTable(
  "invoices",
  {
    ...business(),
    number: text().notNull(),
    quoteId: uuid().references(() => quotes.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    salesRepId: userRef().notNull(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    issuedAt: at().notNull(),
    dueAt: day(),
    sentAt: at(),
    sentBy: userRef(),
    voidedAt: at(),
    voidReason: text(),
    depositPct: rate().notNull().default("0"),
    isReturn: boolean().notNull().default(false),
    creditForInvoiceId: uuid(),
    refundedAt: at(),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    soldAtLocationId: uuid().references(() => locations.id),
    jobSite: jsonb().$type<Address>().notNull(),
    taxRule: jsonb().$type<TaxRuleSnapshot>(),
    taxSource: jsonb().$type<TaxSource>().notNull(),
    taxOverride: jsonb().$type<TaxOverride>(),
    taxExempt: boolean().notNull().default(false),
    subtotal: money().notNull(),
    tax: money().notNull(),
    total: money().notNull(),
    /** Sensitive: shown only with view_sensitive. */
    cost: money().notNull(),
    contractId: uuid().references(() => contracts.id),
    billingId: uuid().references(() => contractBillings.id),
    retainageWithheld: money(),
    retainageReleased: money(),
  },
  (table) => [uniqueIndex("invoices_number_uidx").on(table.number)],
);

/** An invoice line. */
export const invoiceLines = pgTable("invoice_lines", {
  ...business(),
  invoiceId: uuid()
    .notNull()
    .references(() => invoices.id),
  ...docLine(),
});

/** Who shares an invoice's commission (ADR 0025); none means the sales rep alone. */
export const invoiceCommissionSplits = pgTable("invoice_commission_splits", {
  ...business(),
  invoiceId: uuid()
    .notNull()
    .references(() => invoices.id),
  userId: userRef().notNull(),
  pct: rate().notNull(),
});

/**
 * A customer payment or deposit against one invoice (ADR 0013). Only confirmed payments reduce
 * the balance, and the reviewer must be someone other than the recorder. Never edited once
 * confirmed: corrections void it. Cards keep the last 4 digits only.
 */
export const paymentsReceived = pgTable(
  "payments_received",
  {
    ...business(),
    number: text().notNull(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    kind: text().$type<"payment" | "deposit">().notNull(),
    amount: money().notNull(),
    date: day().notNull(),
    method: text().$type<PaymentMethod>().notNull(),
    checkNumber: text().notNull().default(""),
    cardLast4: text().notNull().default(""),
    reference: text().notNull().default(""),
    note: text().notNull().default(""),
    status: text().$type<PaymentStatus>().notNull(),
    recordedById: userRef().notNull(),
    recordedAt: at().notNull(),
    reviewedById: userRef(),
    reviewedAt: at(),
    rejectReason: text(),
    voidedById: userRef(),
    voidedAt: at(),
    voidReason: text(),
  },
  (table) => [uniqueIndex("payments_received_number_uidx").on(table.number)],
);

/** A write-off or customer credit applied to an invoice (ADR 0013). */
export const invoiceAdjustments = pgTable("invoice_adjustments", {
  ...business(),
  invoiceId: uuid()
    .notNull()
    .references(() => invoices.id),
  customerId: uuid()
    .notNull()
    .references(() => customers.id),
  kind: text().$type<"write_off" | "credit_applied">().notNull(),
  amount: money().notNull(),
  reason: text().notNull(),
  byUserId: userRef().notNull(),
  at: at().notNull(),
});

/** Customer credit paid back, with proof (ADR 0013). */
export const refunds = pgTable("refunds", {
  ...business(),
  number: text().notNull(),
  customerId: uuid()
    .notNull()
    .references(() => customers.id),
  amount: money().notNull(),
  date: day().notNull(),
  method: text().$type<PaymentMethod>().notNull(),
  reference: text().notNull().default(""),
  note: text().notNull().default(""),
  status: text().$type<"completed" | "voided">().notNull(),
  byUserId: userRef().notNull(),
  at: at().notNull(),
});
