import type { DocLine } from "../documents";
import type { TaxRule } from "../us-pack/tax";
import type { TaxOverride, TaxSource } from "../us-pack/tax-defaults";
import type { Address } from "./company";

/** Customer segments. */
export type CustomerType = "homeowner" | "dealer" | "contractor";

/** Payment terms on customer and supplier accounts. */
export type PaymentTerms = "due_on_receipt" | "net_15" | "net_30" | "net_45";

/** A resale or exemption certificate on file. */
export interface Certificate {
  number: string;
  state: string;
  expiresAt: string;
}

/** What a customer address is for (spec A6). */
export type CustomerAddressLabel = "home" | "billing" | "job_site" | "delivery";

/** One of a customer's addresses. */
export interface CustomerAddress extends Address {
  id: string;
  label: CustomerAddressLabel;
}

/** A customer account. Credit limit is sensitive (customers.customer.view_sensitive). */
export interface Customer {
  id: string;
  type: CustomerType;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  /** Every address of the customer (spec A6); may be empty for one added quickly from a picker. */
  addresses: CustomerAddress[];
  defaultBillingId: string | null;
  defaultJobSiteId: string | null;
  terms: PaymentTerms;
  creditLimit: string;
  taxExempt: boolean;
  certificate: Certificate | null;
  salesRepId: string;
  createdAt: string;
}

/** A room rectangle drawn on the quote canvas; dimensions in ft. */
export interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  widthFt: number;
  lengthFt: number;
}

/**
 * Quote lifecycle (spec B1): Draft (saved, not sent) → Pending (sent, waiting for the customer) →
 * Accepted → Converted, or Declined. Expired is derived from `expiresAt` (operations/quote-status).
 */
export type QuoteStatus = "draft" | "pending" | "accepted" | "converted" | "declined";

/** A quote. Totals are recomputed from lines; the stored ones are a snapshot for lists. */
export interface Quote {
  id: string;
  number: string;
  customerId: string;
  salesRepId: string;
  branchId: string;
  status: QuoteStatus;
  createdAt: string;
  /** When the quote was first sent (marked pending); null while a draft. */
  sentAt: string | null;
  /** Optional expiry date; a pending quote past it reads Expired. */
  expiresAt: string | null;
  /** Fulfilled from: the warehouse the goods ship from (spec A1). */
  locationId: string;
  jobSite: Address;
  rooms: Room[];
  lines: DocLine[];
  depositPct: string;
  lumpSum: boolean;
  /** A rate changed on this quote by someone with sales.tax.override, with the reason (spec A5). */
  taxOverride: TaxOverride | null;
  invoiceId: string | null;
  total: string;
  notes: string;
}

/**
 * An invoice; stores the tax rule version it used so history never changes. Its status, paid
 * amount and balance are never stored: they come from its payments, credits and write-offs
 * (ledger.ts, spec Appendix A "Core rule"). It keeps only lifecycle facts.
 */
export interface Invoice {
  id: string;
  number: string;
  quoteId: string | null;
  customerId: string;
  salesRepId: string;
  branchId: string;
  issuedAt: string;
  dueAt: string;
  /** Who made the invoice (a user id), for the lifecycle timeline (spec B2). */
  createdBy: string;
  /** When and by whom it was marked as sent to the customer; null until then. */
  sentAt: string | null;
  sentBy: string | null;
  /** Set when the invoice was voided (only while nothing is confirmed), with the reason. */
  voidedAt: string | null;
  voidReason: string | null;
  /** The deposit the quote asked for, as a percent of the total; "0" for none. */
  depositPct: string;
  isReturn: boolean;
  /** Credit notes (returns): the invoice they credit, and when the credit was refunded on the spot (else it is customer credit). */
  creditForInvoiceId: string | null;
  refundedAt: string | null;
  /** Fulfilled from: the warehouse the goods ship from (spec A1). */
  locationId: string;
  jobSite: Address;
  lines: DocLine[];
  taxRule: Pick<TaxRule, "state" | "jurisdiction" | "ratePct" | "version"> | null;
  /** Where the rate came from when the invoice was made (spec A5). */
  taxSource: TaxSource;
  taxOverride: TaxOverride | null;
  taxExempt: boolean;
  subtotal: string;
  tax: string;
  total: string;
  cost: string;
}

/** How a customer paid (spec Appendix A "Record payment"). */
export type PaymentMethod = "cash" | "check" | "ach" | "card" | "other";

/** Where a payment stands: only confirmed payments reduce the balance (spec Appendix A "Approval"). */
export type PaymentStatus = "pending" | "confirmed" | "rejected" | "voided";

/**
 * A file attached to a record (proof of payment, a supplier's invoice). The bytes live in the
 * file store (IndexedDB in the demo, object storage later); the record keeps only this.
 */
export interface FileMeta {
  id: string;
  name: string;
  /** The real type, read from the file's first bytes, e.g. application/pdf. */
  type: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

/**
 * A customer payment against one invoice (spec Appendix A). Never edited or deleted after it is
 * confirmed: corrections void it and record a new one. Card payments keep the last 4 digits only.
 */
export interface Payment {
  id: string;
  /** PAY-0001, with the company's payment prefix. */
  number: string;
  invoiceId: string;
  customerId: string;
  kind: "payment" | "deposit";
  amount: string;
  /** The day the customer paid. */
  date: string;
  method: PaymentMethod;
  checkNumber: string;
  cardLast4: string;
  /** Reference or transaction ID; may be empty only for cash. */
  reference: string;
  note: string;
  files: FileMeta[];
  status: PaymentStatus;
  /** Who recorded it: the reviewer must be someone else (two-person check). */
  recordedById: string;
  recordedBy: string;
  recordedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

/** A write-off of a small leftover, or customer credit applied to an invoice (spec Appendix A "Corrections"). */
export interface InvoiceAdjustment {
  id: string;
  invoiceId: string;
  customerId: string;
  kind: "write_off" | "credit_applied";
  amount: string;
  reason: string;
  byName: string;
  at: string;
}

/** Customer credit paid back to the customer, with mandatory proof (spec Appendix A "Refund"). */
export interface Refund {
  id: string;
  number: string;
  customerId: string;
  amount: string;
  date: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  files: FileMeta[];
  status: "completed" | "voided";
  byName: string;
  at: string;
}
