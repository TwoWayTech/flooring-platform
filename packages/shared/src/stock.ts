import { dec, type Dec } from "./money";
import type { Location, Product, Roll, StockMovement, User } from "./types";

/** The unit a product's stock is counted in, or null for services and untracked goods. */
export type StockUnit = "ft" | "cartons" | "each";

/**
 * How stock of a product is counted (spec section 4): broadloom carpet by roll length in ft,
 * boxed goods in cartons, trims and adhesives as items. Services and pad are not stocked.
 */
export function stockUnit(product: Pick<Product, "category" | "unit" | "widthFt">): StockUnit | null {
  if (product.category === "carpet" && product.unit === "sq_yd" && product.widthFt) return "ft";
  if (product.unit === "carton") return "cartons";
  if (product.category === "adhesive_trim") return "each";
  return null;
}

/** Whether the product is boxed stock kept in the stock ledger (cartons or items). */
export function isBoxed(product: Pick<Product, "category" | "unit" | "widthFt">): boolean {
  const unit = stockUnit(product);
  return unit === "cartons" || unit === "each";
}

/**
 * Boxed stock on hand per product: the sum of its ledger movements (plan section 2.1), at one
 * warehouse or, without one, across all of them. Movements never touch showrooms (plan A-1).
 */
export function boxedStock(movements: readonly StockMovement[], locationId?: string | null): Map<string, Dec> {
  const totals = new Map<string, Dec>();
  for (const m of movements) {
    if (locationId && m.locationId !== locationId) continue;
    totals.set(m.productId, (totals.get(m.productId) ?? dec(0)).plus(m.quantity));
  }
  return totals;
}

/** Boxed stock of one product, at one warehouse or across all. */
export function boxedOnHand(movements: readonly StockMovement[], productId: string, locationId?: string | null): Dec {
  return (
    boxedStock(
      movements.filter((m) => m.productId === productId),
      locationId,
    ).get(productId) ?? dec(0)
  );
}

/** Rolls at a warehouse (or everywhere), excluding those used up. Rolls in transit stay with the sender. */
export function rollsAt(rolls: readonly Roll[], locationId?: string | null): Roll[] {
  return rolls.filter((r) => (!locationId || r.locationId === locationId) && dec(r.remainingLengthFt).gt(0));
}

/** The warehouses of a company, in their order; showrooms are left out. */
export function warehousesOf(locations: readonly Location[]): Location[] {
  return locations.filter((l) => l.kind === "warehouse");
}

/**
 * The warehouse new documents start from (spec A1): the person's own default warehouse, then
 * the company default, then the first warehouse.
 */
export function defaultWarehouse(
  locations: readonly Location[],
  user?: Pick<User, "defaultLocationId"> | null,
): Location | undefined {
  const warehouses = warehousesOf(locations);
  return (
    warehouses.find((l) => l.id === user?.defaultLocationId) ?? warehouses.find((l) => l.isDefault) ?? warehouses[0]
  );
}

/** The display name of a location, or an empty string when it is unknown. */
export function locationName(locations: readonly Location[], id: string | null | undefined): string {
  return locations.find((l) => l.id === id)?.name ?? "";
}
