import type { Address } from "./company";

/**
 * A warehouse holds sellable stock and ships to customers; a showroom only displays samples and
 * never holds sellable stock (spec A1, plan A-1).
 */
export type LocationKind = "warehouse" | "showroom";

/**
 * A warehouse or showroom. Each belongs to a branch, and branches keep driving data scope and
 * the branch limit (plan K-4).
 */
export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
  branchId: string;
  address: Address;
  /** The company's default warehouse, used when a person has none of their own. */
  isDefault: boolean;
  /** Display samples on the floor; a simple count, never sellable stock (plan A-1). */
  displaySamples: number;
}

/** Why boxed stock changed. Every change has a source document (spec C1). */
export type MovementKind = "opening" | "receipt" | "issue" | "transfer_out" | "transfer_in" | "adjustment" | "return";

/** The document behind a stock movement. */
export interface MovementSource {
  kind: "count" | "receipt" | "invoice" | "transfer" | "adjustment" | "credit_note";
  id: string;
  number: string;
}

/**
 * One line of the stock ledger for boxed goods (cartons or items). On hand at a warehouse is the
 * sum of its movements, so no stored figure can drift (plan section 2.1).
 */
export interface StockMovement {
  id: string;
  at: string;
  productId: string;
  locationId: string;
  /** Signed quantity in the product's stock unit: positive in, negative out. */
  quantity: string;
  kind: MovementKind;
  source: MovementSource;
  byUserId: string | null;
}

/** A transfer leaves its source at once and reaches its destination when received. */
export type TransferStatus = "in_transit" | "received";

/** One item of a transfer: a whole roll, or a quantity of a boxed product. */
export interface TransferLine {
  id: string;
  productId: string;
  /** Set when the line moves a carpet roll; the roll moves whole. */
  rollId: string | null;
  /** Cartons or items for boxed goods; the roll's remaining ft for a roll. */
  quantity: string;
}

/** A transfer of stock between two warehouses (spec A1). */
export interface Transfer {
  id: string;
  number: string;
  fromId: string;
  toId: string;
  status: TransferStatus;
  lines: TransferLine[];
  createdAt: string;
  createdBy: string;
  receivedAt: string | null;
  receivedBy: string | null;
  note: string;
}
