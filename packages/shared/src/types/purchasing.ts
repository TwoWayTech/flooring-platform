import type { SellUnit } from "../units";
import type { ProductCategory } from "./catalog";
import type { Address } from "./company";
import type { FileMeta, PaymentMethod, PaymentStatus } from "./sales";

/** How a supplier wants to be paid (spec D3). */
export type SupplierTerms = "pay_on_order" | "cod" | "net_30" | "net_60" | "net_90" | "net_180" | "monthly_statement";

/** A supplier. */
export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  terms: SupplierTerms;
  /** How much the company may owe this supplier at once (spec D3). */
  creditLimit: string;
  categories: ProductCategory[];
  address: Address;
}

/** One line of a purchase order. */
export interface PoLine {
  id: string;
  productId: string;
  description: string;
  /** In the product's selling unit: cartons for boxed area goods, sq yd for broadloom. */
  quantity: string;
  unit: SellUnit;
  unitCost: string;
  /** The area ordered, in sq ft, for goods ordered by area (spec D1); cartons are calculated from it. */
  areaSqFt?: string;
}

/**
 * What a purchase order stores (spec D1): Draft until it is ordered, or Cancelled. Partly received,
 * Received, Billed, Partly paid and Paid are derived from receipts, bills and supplier payments.
 */
export type PoStatus = "draft" | "ordered" | "cancelled";

/** A purchase order. */
export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  status: PoStatus;
  createdAt: string;
  /** Receive into: the warehouse the goods arrive at (spec A1). */
  locationId: string;
  expectedAt: string;
  orderedAt: string | null;
  cancelledAt: string | null;
  lines: PoLine[];
  total: string;
}

/** What arrived for one PO line (spec D2): good units into stock, damaged ones set aside, and the rolls. */
export interface ReceiptLine {
  poLineId: string;
  productId: string;
  /** Good quantity, in the line's unit; it goes into stock and can be billed. */
  received: string;
  damaged: string;
  /** Broadloom arrives as rolls with their own number, dye lot and length. */
  rolls: { rollNumber: string; dyeLot: string; lengthFt: string }[];
}

/** A goods receipt (spec D2): partial receipts are allowed; each one writes its stock movements. */
export interface GoodsReceipt {
  id: string;
  /** GR-0001. */
  number: string;
  poId: string;
  supplierId: string;
  locationId: string;
  receivedAt: string;
  receivedById: string;
  receivedBy: string;
  note: string;
  lines: ReceiptLine[];
}

/**
 * A supplier bill (spec D2): entered only against received goods, matched to its PO and receipts
 * with any differences flagged, with the supplier's invoice file. What is paid comes from supplier
 * payments, never stored here.
 */
export interface Bill {
  id: string;
  /** The supplier's own invoice number. */
  number: string;
  supplierId: string;
  poId: string | null;
  receiptIds: string[];
  issuedAt: string;
  dueAt: string;
  total: string;
  /** Differences found when matching to the PO and receipts, in words. */
  matchIssues: string[];
  files: FileMeta[];
}

/**
 * A payment to a supplier (spec D3), mirroring customer payments: method, reference, mandatory
 * proof, optional approval, void instead of delete, and one payment split over several bills.
 */
export interface SupplierPayment {
  id: string;
  /** SP-0001. */
  number: string;
  supplierId: string;
  date: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  files: FileMeta[];
  allocations: { billId: string; amount: string }[];
  amount: string;
  status: PaymentStatus;
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

/** An operating expense (rent, payroll, vehicles); feeds the P&L. */
export interface Expense {
  id: string;
  at: string;
  category: "payroll" | "rent" | "utilities" | "vehicles" | "marketing" | "insurance" | "software";
  description: string;
  amount: string;
}
