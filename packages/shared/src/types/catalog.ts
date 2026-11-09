import type { SellUnit } from "../units";

/** Product categories in the catalog (spec section 4). */
export type ProductCategory =
  | "carpet"
  | "carpet_tile"
  | "lvp"
  | "laminate"
  | "engineered_hardwood"
  | "solid_hardwood"
  | "porcelain_tile"
  | "pad"
  | "adhesive_trim"
  | "service";

/** A catalog product. Price and cost are per selling unit. */
export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  collection: string;
  colorName: string;
  /** Swatch color for the chip beside the name. */
  swatch: string;
  category: ProductCategory;
  unit: SellUnit;
  price: string;
  cost: string;
  /** Boxed goods: sq ft per carton and reorder point. Stock on hand comes from the stock ledger. */
  sqFtPerCarton?: string;
  reorderPoint?: number;
  /** Broadloom: roll width in ft. */
  widthFt?: number;
  attributes: Record<string, string>;
  supplierId: string;
  createdAt: string;
}

/** One cut taken from a roll. */
export interface RollCut {
  id: string;
  at: string;
  lengthFt: string;
  reference: string;
  byUserId: string;
  /** The invoice or stock adjustment behind the cut (spec C1); older cuts carry only a reference. */
  source?: { kind: "invoice" | "adjustment"; id: string; number: string };
}

/** A carpet roll or remnant. Lengths in ft, cost per sq ft (CLAUDE.md rule 4). */
export interface Roll {
  id: string;
  rollNumber: string;
  productId: string;
  dyeLot: string;
  widthFt: number;
  originalLengthFt: string;
  remainingLengthFt: string;
  costPerSqFt: string;
  /** The warehouse holding the roll; it stays the sender's while the roll is in transit. */
  locationId: string;
  bin: string;
  /** Set while the roll travels on a transfer; it cannot be cut or reserved until received. */
  transferId: string | null;
  isRemnant: boolean;
  parentRollId: string | null;
  receivedAt: string;
  cuts: RollCut[];
}
