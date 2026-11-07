import { dec, sqFtToSqYd, type Product, type Roll } from "@workspace/shared";

/** Stock of one product: cartons or items for boxed goods, ft across rolls for broadloom. */
export interface StockLevel {
  value: string;
  unit: "cartons" | "each" | "ft";
  rolls: number;
  low: boolean;
}

/**
 * Stock on hand. Boxed goods are low at or below their reorder point; broadloom stock is the
 * sum of remaining ft on its rolls and remnants (CLAUDE.md rule 4: lengths in ft).
 */
export function stockLevel(product: Product, rolls: readonly Roll[]): StockLevel {
  if (product.unit === "sq_yd" && product.category === "carpet") {
    const own = rolls.filter((r) => r.productId === product.id && dec(r.remainingLengthFt).gt(0));
    const feet = own.reduce((s, r) => s.plus(r.remainingLengthFt), dec(0));
    return { value: feet.toString(), unit: "ft", rolls: own.length, low: own.length === 0 };
  }
  const onHand = product.cartonsOnHand ?? 0;
  return {
    value: String(onHand),
    unit: product.unit === "each" ? "each" : "cartons",
    rolls: 0,
    low: product.reorderPoint !== undefined && onHand <= product.reorderPoint,
  };
}

/** Area left on a roll in sq yd, for the rolls list and roll page (width ft × remaining ft ÷ 9). */
export function rollSqYd(roll: Roll): string {
  return sqFtToSqYd(dec(roll.widthFt).times(roll.remainingLengthFt)).toString();
}
