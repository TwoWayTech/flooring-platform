import {
  availability,
  dec,
  rollsAt,
  sqFtToSqYd,
  stockStatus,
  stockUnit,
  type Product,
  type Reservation,
  type Roll,
  type StockMovement,
} from "@workspace/shared";

/** Stock of one product: on hand, reserved for invoices and available (spec C2), and its status (C3). */
export interface StockLevel {
  onHand: string;
  reserved: string;
  available: string;
  unit: "cartons" | "each" | "ft";
  rolls: number;
  status: "out" | "low" | "ok";
}

/**
 * Stock at one warehouse, or across all when none is given (spec A1, C2, C3). Boxed goods come
 * from the stock ledger, broadloom from the rolls' remaining ft (CLAUDE.md rule 4); reserved is
 * what invoices hold, and the status reads Out of stock at zero available and Low stock at or
 * below the reorder point.
 */
export function stockLevel(
  product: Product,
  stock: { rolls: readonly Roll[]; movements: readonly StockMovement[]; reservations: readonly Reservation[] },
  locationId?: string | null,
): StockLevel {
  const unit = stockUnit(product) ?? "each";
  const level = availability(product, stock, locationId);
  const rolls = unit === "ft" ? rollsAt(stock.rolls, locationId).filter((r) => r.productId === product.id).length : 1;
  return {
    onHand: level.onHand.toString(),
    reserved: level.reserved.toString(),
    available: level.available.toString(),
    unit,
    rolls: unit === "ft" ? rolls : 0,
    status: stockStatus(product, level.available, rolls),
  };
}

/** Area left on a roll in sq yd, for the rolls list and roll page (width ft × remaining ft ÷ 9). */
export function rollSqYd(roll: Roll): string {
  return sqFtToSqYd(dec(roll.widthFt).times(roll.remainingLengthFt)).toString();
}
