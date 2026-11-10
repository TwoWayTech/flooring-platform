/** Where a reservation stands: holding stock, given back, or cut / issued for the invoice. */
export type ReservationStatus = "active" | "released" | "issued";

/**
 * Stock held for one invoice line (spec C2): a length of one roll, or sq ft or items of a boxed
 * product at the invoice's warehouse. Available = on hand − active reservations. When stock is
 * short the invoice still issues and the line shows what could not be held (plan C-1).
 */
export interface Reservation {
  id: string;
  invoiceId: string;
  lineId: string;
  productId: string;
  /** The roll a broadloom line is cut from; null for boxed goods. */
  rollId: string | null;
  locationId: string;
  /** In the product's stock unit: ft of the roll, sq ft of boxed goods, or items. */
  quantity: string;
  /** What the line needed beyond what could be held; "0" when fully reserved. */
  shortBy: string;
  status: ReservationStatus;
  createdAt: string;
  closedAt: string | null;
  /** Set when stock was issued before the invoice was paid, by someone allowed to override. */
  overrideReason: string | null;
}

/** Why stock changed outside a sale, a receipt or a transfer (spec C1). */
export type AdjustmentReason = "damage" | "count" | "samples" | "other";

/**
 * A stock change with no sales or purchase document behind it (spec C1): a reason is required,
 * and above the company's quantity it waits for an Owner or Manager. Approved adjustments write
 * a stock movement, or change the roll's length.
 */
export interface StockAdjustment {
  id: string;
  /** ADJ-0001. */
  number: string;
  productId: string;
  rollId: string | null;
  locationId: string;
  /** Signed, in the product's stock unit: negative takes stock out. */
  quantity: string;
  reason: AdjustmentReason;
  note: string;
  status: "pending" | "approved" | "rejected";
  requestedById: string;
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}
