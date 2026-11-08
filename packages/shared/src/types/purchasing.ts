import type { SellUnit } from "../units";
import type { ProductCategory } from "./catalog";
import type { Address } from "./company";
import type { PaymentTerms } from "./sales";

/** A supplier. */
export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  terms: PaymentTerms;
  categories: ProductCategory[];
  address: Address;
}

/** One line of a purchase order. */
export interface PoLine {
  id: string;
  productId: string;
  description: string;
  quantity: string;
  unit: SellUnit;
  unitCost: string;
}

/** Purchase order lifecycle: order, receive, bill. */
export type PoStatus = "draft" | "sent" | "received" | "billed";

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
  receivedAt: string | null;
  lines: PoLine[];
  total: string;
}

/** A supplier bill. */
export interface Bill {
  id: string;
  number: string;
  supplierId: string;
  poId: string | null;
  issuedAt: string;
  dueAt: string;
  total: string;
  paid: string;
}

/** A payment to a supplier. */
export interface BillPayment {
  id: string;
  billId: string;
  supplierId: string;
  at: string;
  amount: string;
}

/** An operating expense (rent, payroll, vehicles); feeds the P&L. */
export interface Expense {
  id: string;
  at: string;
  category: "payroll" | "rent" | "utilities" | "vehicles" | "marketing" | "insurance" | "software";
  description: string;
  amount: string;
}
