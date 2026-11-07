import type { DocLine } from "../documents";
import type { TaxRule } from "../us-pack/tax";
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

/** A customer account. Credit limit is sensitive (customers.customer.view_sensitive). */
export interface Customer {
  id: string;
  type: CustomerType;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: Address;
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

/** Quote lifecycle. */
export type QuoteStatus = "draft" | "sent" | "accepted" | "invoiced" | "declined";

/** A quote. Totals are recomputed from lines; the stored ones are a snapshot for lists. */
export interface Quote {
  id: string;
  number: string;
  customerId: string;
  salesRepId: string;
  branchId: string;
  status: QuoteStatus;
  createdAt: string;
  jobSite: Address;
  rooms: Room[];
  lines: DocLine[];
  depositPct: string;
  lumpSum: boolean;
  invoiceId: string | null;
  total: string;
  notes: string;
}

/** Invoice lifecycle; overdue is derived from the due date and balance. */
export type InvoiceStatus = "open" | "partial" | "paid" | "void";

/** An invoice; stores the tax rule version it used so history never changes. */
export interface Invoice {
  id: string;
  number: string;
  quoteId: string | null;
  customerId: string;
  salesRepId: string;
  branchId: string;
  issuedAt: string;
  dueAt: string;
  status: InvoiceStatus;
  isReturn: boolean;
  jobSite: Address;
  lines: DocLine[];
  taxRule: Pick<TaxRule, "state" | "jurisdiction" | "ratePct" | "version"> | null;
  taxExempt: boolean;
  subtotal: string;
  tax: string;
  total: string;
  cost: string;
  paid: string;
}

/** A customer payment against one invoice. */
export interface Payment {
  id: string;
  invoiceId: string;
  customerId: string;
  at: string;
  amount: string;
  method: "card" | "check" | "ach" | "cash";
}
