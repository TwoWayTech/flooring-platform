import {
  boxedOnHand,
  dec,
  rollsAt,
  sqFtToSqYd,
  stockUnit,
  type Product,
  type Roll,
  type StockMovement,
} from "@workspace/shared";

/** Stock of one product: cartons or items for boxed goods, ft across rolls for broadloom. */
export interface StockLevel {
  value: string;
  unit: "cartons" | "each" | "ft";
  rolls: number;
  low: boolean;
}

/**
 * Stock on hand at one warehouse, or across all when none is given (spec A1). Boxed goods come
 * from the stock ledger and are low at or below their reorder point; broadloom stock is the sum
 * of remaining ft on its rolls and remnants (CLAUDE.md rule 4: lengths in ft).
 */
export function stockLevel(
  product: Product,
  rolls: readonly Roll[],
  movements: readonly StockMovement[],
  locationId?: string | null,
): StockLevel {
  const unit = stockUnit(product) ?? "each";
  if (unit === "ft") {
    const own = rollsAt(rolls, locationId).filter((r) => r.productId === product.id);
    const feet = own.reduce((s, r) => s.plus(r.remainingLengthFt), dec(0));
    return { value: feet.toString(), unit, rolls: own.length, low: own.length === 0 };
  }
  const onHand = boxedOnHand(movements, product.id, locationId);
  return {
    value: onHand.toString(),
    unit,
    rolls: 0,
    low: product.reorderPoint !== undefined && onHand.lte(product.reorderPoint),
  };
}

/** Area left on a roll in sq yd, for the rolls list and roll page (width ft × remaining ft ÷ 9). */
export function rollSqYd(roll: Roll): string {
  return sqFtToSqYd(dec(roll.widthFt).times(roll.remainingLengthFt)).toString();
}
