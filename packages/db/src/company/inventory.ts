import type {
  AdjustmentReason,
  MovementKind,
  MovementSource,
  ReservationStatus,
  TransferStatus,
} from "@workspace/shared";
import { boolean, index, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { appendOnly, at, business, quantity, unitCost, userRef } from "../columns";
import { products } from "./catalog";
import { locations } from "./organization";
import { invoiceLines, invoices } from "./sales";

/**
 * A carpet roll or remnant. Its remaining length is stored on the roll, and cuts are rows of
 * roll_cuts; boxed goods use stock_movements instead (ADR 0006).
 */
export const rolls = pgTable(
  "rolls",
  {
    ...business(),
    rollNumber: text().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    dyeLot: text().notNull(),
    widthFt: quantity().notNull(),
    originalLengthFt: quantity().notNull(),
    remainingLengthFt: quantity().notNull(),
    costPerSqFt: unitCost().notNull(),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    bin: text().notNull().default(""),
    /** Set while the roll travels; it cannot be cut or reserved until received. */
    transferId: uuid().references((): AnyPgColumn => transfers.id),
    isRemnant: boolean().notNull().default(false),
    parentRollId: uuid().references((): AnyPgColumn => rolls.id),
    receivedAt: at().notNull(),
  },
  (table) => [uniqueIndex("rolls_number_uidx").on(table.rollNumber)],
);

/** One cut taken from a roll, with the invoice or adjustment behind it (spec C1). */
export const rollCuts = pgTable("roll_cuts", {
  ...appendOnly(),
  rollId: uuid()
    .notNull()
    .references(() => rolls.id),
  at: at().notNull(),
  lengthFt: quantity().notNull(),
  reference: text().notNull().default(""),
  byUserId: userRef(),
  sourceType: text().$type<"invoice" | "adjustment">(),
  sourceId: uuid(),
  sourceNumber: text(),
});

/**
 * The stock ledger for boxed goods: on hand is the sum of movements, never a stored figure
 * (blueprint p16, ADR 0006). Append-only; a mistake is corrected by another movement.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    ...appendOnly(),
    at: at().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    /** Signed, in the product's stock unit: positive in, negative out. */
    quantity: quantity().notNull(),
    kind: text().$type<MovementKind>().notNull(),
    sourceType: text().$type<MovementSource["kind"]>().notNull(),
    sourceId: uuid().notNull(),
    sourceNumber: text().notNull(),
    byUserId: userRef(),
  },
  (table) => [index("stock_movements_product_location_idx").on(table.productId, table.locationId)],
);

/** Stock moving between two warehouses (ADR 0006). */
export const transfers = pgTable("transfers", {
  ...business(),
  number: text().notNull(),
  fromId: uuid()
    .notNull()
    .references(() => locations.id),
  toId: uuid()
    .notNull()
    .references(() => locations.id),
  status: text().$type<TransferStatus>().notNull(),
  receivedAt: at(),
  receivedBy: userRef(),
  note: text().notNull().default(""),
});

/** A whole roll or a quantity of a boxed product on a transfer. */
export const transferLines = pgTable("transfer_lines", {
  ...business(),
  transferId: uuid()
    .notNull()
    .references(() => transfers.id),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  rollId: uuid().references(() => rolls.id),
  quantity: quantity().notNull(),
});

/** Stock held for one invoice line until it is cut or issued (ADR 0015). Locking around it is P11 work. */
export const reservations = pgTable("reservations", {
  ...business(),
  invoiceId: uuid()
    .notNull()
    .references(() => invoices.id),
  invoiceLineId: uuid()
    .notNull()
    .references(() => invoiceLines.id),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  rollId: uuid().references(() => rolls.id),
  locationId: uuid()
    .notNull()
    .references(() => locations.id),
  quantity: quantity().notNull(),
  shortBy: quantity().notNull().default("0"),
  status: text().$type<ReservationStatus>().notNull(),
  closedAt: at(),
  overrideReason: text(),
});

/** A stock change with no sales or purchase document behind it, with a reason (spec C1). */
export const stockAdjustments = pgTable("stock_adjustments", {
  ...business(),
  number: text().notNull(),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  rollId: uuid().references(() => rolls.id),
  locationId: uuid()
    .notNull()
    .references(() => locations.id),
  quantity: quantity().notNull(),
  reason: text().$type<AdjustmentReason>().notNull(),
  note: text().notNull().default(""),
  status: text().$type<"pending" | "approved" | "rejected">().notNull(),
  requestedById: userRef().notNull(),
  requestedAt: at().notNull(),
  reviewedById: userRef(),
  reviewedAt: at(),
  rejectReason: text(),
});
