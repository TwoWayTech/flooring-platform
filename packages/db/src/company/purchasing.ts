import type {
  Address,
  ContactMethod,
  ContactRole,
  DirectoryStatus,
  PaymentMethod,
  PaymentStatus,
  PoStatus,
  ProductCategory,
  SellUnit,
  SupplierTaxForm,
  SupplierTerms,
  SupplierType,
} from "@workspace/shared";
import { boolean, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, business, day, money, quantity, unitCost, userRef } from "../columns";
import { products } from "./catalog";
import { contractBillings, contracts } from "./contracts";
import { locations } from "./organization";

/** A supplier of goods, services, utilities or a government office (ADR 0022). No tax ID is stored (plan K-9). */
export const suppliers = pgTable("suppliers", {
  ...business(),
  name: text().notNull(),
  type: text().$type<SupplierType>().notNull(),
  status: text().$type<DirectoryStatus>().notNull().default("active"),
  accountNumber: text().notNull().default(""),
  email: text().notNull().default(""),
  phone: text().notNull().default(""),
  terms: text().$type<SupplierTerms>().notNull(),
  /** Sensitive: shown only with view_sensitive. */
  creditLimit: money().notNull().default("0"),
  categories: text().$type<ProductCategory>().array().notNull().default([]),
  address: jsonb().$type<Address>().notNull(),
  track1099: boolean().notNull().default(false),
  taxForm: jsonb().$type<SupplierTaxForm>(),
  notes: text().notNull().default(""),
  externalId: text(),
});

/** A person at a supplier; one active primary each (ADR 0022). */
export const supplierContacts = pgTable("supplier_contacts", {
  ...business(),
  supplierId: uuid()
    .notNull()
    .references(() => suppliers.id),
  name: text().notNull(),
  role: text().$type<ContactRole>().notNull(),
  mobile: text().notNull().default(""),
  officePhone: text().notNull().default(""),
  email: text().notNull().default(""),
  whatsapp: boolean().notNull().default(false),
  preferredMethod: text().$type<ContactMethod>().notNull(),
  notes: text().notNull().default(""),
  isPrimary: boolean().notNull().default(false),
  status: text().$type<DirectoryStatus>().notNull().default("active"),
});

/**
 * A purchase order (ADR 0016). Only draft, ordered and cancelled are stored; received, billed
 * and paid are derived. The rep is snapshotted so history survives them leaving (ADR 0022).
 */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    ...business(),
    number: text().notNull(),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    status: text().$type<PoStatus>().notNull(),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    expectedAt: day().notNull(),
    orderedAt: at(),
    cancelledAt: at(),
    total: money().notNull(),
    contactId: uuid().references(() => supplierContacts.id),
    contactSnapshot: jsonb().$type<{ name: string; email: string; phone: string }>(),
    supplierRef: text().notNull().default(""),
    buyerId: userRef().notNull(),
    placedVia: text().$type<"email" | "phone">(),
  },
  (table) => [uniqueIndex("purchase_orders_number_uidx").on(table.number)],
);

/** A purchase order line, in the selling unit (sq ft for area goods, ADR 0027). */
export const poLines = pgTable("po_lines", {
  ...business(),
  poId: uuid()
    .notNull()
    .references(() => purchaseOrders.id),
  position: integer().notNull(),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  description: text().notNull(),
  quantity: quantity().notNull(),
  unit: text().$type<SellUnit>().notNull(),
  unitCost: unitCost().notNull(),
  sqFtPerCarton: quantity(),
  locationId: uuid().references(() => locations.id),
});

/** Goods arriving against a purchase order; partial receipts are allowed (ADR 0016). */
export const goodsReceipts = pgTable("goods_receipts", {
  ...business(),
  number: text().notNull(),
  poId: uuid()
    .notNull()
    .references(() => purchaseOrders.id),
  supplierId: uuid()
    .notNull()
    .references(() => suppliers.id),
  locationId: uuid()
    .notNull()
    .references(() => locations.id),
  receivedAt: at().notNull(),
  receivedById: userRef().notNull(),
  note: text().notNull().default(""),
});

/** What arrived for one PO line. The rolls received are a snapshot; each also becomes a rolls row. */
export const receiptLines = pgTable("receipt_lines", {
  ...business(),
  receiptId: uuid()
    .notNull()
    .references(() => goodsReceipts.id),
  poLineId: uuid()
    .notNull()
    .references(() => poLines.id),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  received: quantity().notNull(),
  damaged: quantity().notNull().default("0"),
  rolls: jsonb().$type<{ rollNumber: string; dyeLot: string; lengthFt: string }[]>().notNull().default([]),
  locationId: uuid().references(() => locations.id),
});

/**
 * A supplier bill (ADR 0016): entered against received goods, or from a subcontract billing or a
 * pay-later expense. It has a total and no lines; what is paid comes from payments_made.
 */
export const supplierBills = pgTable("supplier_bills", {
  ...business(),
  number: text().notNull(),
  supplierId: uuid()
    .notNull()
    .references(() => suppliers.id),
  poId: uuid().references(() => purchaseOrders.id),
  issuedAt: day().notNull(),
  dueAt: day().notNull(),
  total: money().notNull(),
  matchIssues: text().array().notNull().default([]),
  contractId: uuid().references(() => contracts.id),
  billingId: uuid().references(() => contractBillings.id),
  kind: text().$type<"progress" | "retainage_release">(),
  gross: money(),
  retainageWithheld: money(),
  retainageReleased: money(),
});

/** Which receipts a bill covers. */
export const billReceipts = pgTable(
  "bill_receipts",
  {
    ...business(),
    billId: uuid()
      .notNull()
      .references(() => supplierBills.id),
    receiptId: uuid()
      .notNull()
      .references(() => goodsReceipts.id),
  },
  (table) => [uniqueIndex("bill_receipts_uidx").on(table.billId, table.receiptId)],
);

/** A payment to a supplier, mirroring customer payments: proof, review, void (ADR 0016). */
export const paymentsMade = pgTable(
  "payments_made",
  {
    ...business(),
    number: text().notNull(),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    date: day().notNull(),
    method: text().$type<PaymentMethod>().notNull(),
    reference: text().notNull().default(""),
    note: text().notNull().default(""),
    amount: money().notNull(),
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
  (table) => [uniqueIndex("payments_made_number_uidx").on(table.number)],
);

/** How much of a supplier payment goes to each bill. */
export const paymentAllocations = pgTable("payment_allocations", {
  ...business(),
  paymentId: uuid()
    .notNull()
    .references(() => paymentsMade.id),
  billId: uuid()
    .notNull()
    .references(() => supplierBills.id),
  amount: money().notNull(),
});
