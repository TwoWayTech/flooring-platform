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
  /** Boxed goods: sq ft per carton, cartons on hand, reorder point. */
  sqFtPerCarton?: string;
  cartonsOnHand?: number;
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
  warehouse: string;
  bin: string;
  isRemnant: boolean;
  parentRollId: string | null;
  receivedAt: string;
  cuts: RollCut[];
}
