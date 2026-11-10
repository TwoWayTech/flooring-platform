import type { DocLine } from "./documents";
import type { InvoiceLedger } from "./ledger";
import { dec, maxDec, minDec, type Dec } from "./money";
import { boxedOnHand, stockUnit } from "./stock";
import type { AdjustmentReason, Invoice, Location, Product, Reservation, Roll, StockMovement } from "./types";

/** Words for adjustment reasons (spec C1). */
export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  damage: "Damage",
  count: "Count correction",
  samples: "Samples",
  other: "Other",
};

const active = (r: Reservation) => r.status === "active";

/**
 * How much stock an invoice line takes, in the product's stock unit (spec C2, A1): carpet takes ft
 * of roll length (sq ft ÷ roll width, to the nearest hundredth, so a length sold comes back as the
 * same length); boxed goods take their sq ft or items. Services and lines without stock take nothing.
 */
export function stockNeed(line: Pick<DocLine, "quantity" | "unit">, product: Product): Dec | null {
  const unit = stockUnit(product);
  if (!unit) return null;
  if (unit === "ft") {
    if (line.unit === "ft") return dec(line.quantity);
    if (line.unit === "sq_ft" && product.widthFt) return dec(line.quantity).div(product.widthFt).toDecimalPlaces(2);
    return null;
  }
  return line.unit === "sq_ft" || line.unit === "each" ? dec(line.quantity) : null;
}

/** Length of a roll held for invoices that have not been cut yet. */
export function reservedOnRoll(rollId: string, reservations: readonly Reservation[]): Dec {
  return reservations.filter((r) => active(r) && r.rollId === rollId).reduce((s, r) => s.plus(r.quantity), dec(0));
}

/** What can still be promised from a roll: remaining length less what is held (never below zero). */
export function rollAvailable(roll: Pick<Roll, "id" | "remainingLengthFt">, reservations: readonly Reservation[]): Dec {
  return maxDec(dec(roll.remainingLengthFt).minus(reservedOnRoll(roll.id, reservations)), 0);
}

/** Sq ft or items of a product held at a warehouse (or everywhere). */
export function reservedBoxed(
  productId: string,
  reservations: readonly Reservation[],
  locationId?: string | null,
): Dec {
  return reservations
    .filter((r) => active(r) && !r.rollId && r.productId === productId && (!locationId || r.locationId === locationId))
    .reduce((s, r) => s.plus(r.quantity), dec(0));
}

/** On hand, reserved and available for one product at a warehouse or across all (spec C2, C3). */
export interface Availability {
  onHand: Dec;
  reserved: Dec;
  available: Dec;
}

/** Availability of a product: rolls by remaining length, boxed goods from the stock ledger. */
export function availability(
  product: Product,
  stock: { rolls: readonly Roll[]; movements: readonly StockMovement[]; reservations: readonly Reservation[] },
  locationId?: string | null,
): Availability {
  if (stockUnit(product) === "ft") {
    const rolls = stock.rolls.filter(
      (r) => r.productId === product.id && !r.transferId && (!locationId || r.locationId === locationId),
    );
    const onHand = rolls.reduce((s, r) => s.plus(r.remainingLengthFt), dec(0));
    const reserved = rolls.reduce((s, r) => s.plus(reservedOnRoll(r.id, stock.reservations)), dec(0));
    return { onHand, reserved, available: maxDec(onHand.minus(reserved), 0) };
  }
  const onHand = boxedOnHand(stock.movements, product.id, locationId);
  const reserved = reservedBoxed(product.id, stock.reservations, locationId);
  return { onHand, reserved, available: maxDec(onHand.minus(reserved), 0) };
}

/** The stock a sale reads: rolls, the ledger and what invoices already hold. */
export type SaleStock = {
  rolls: readonly Roll[];
  movements: readonly StockMovement[];
  reservations: readonly Reservation[];
};

/** The warehouse a line ships from: its own when it was moved (spec A2), else the document's. */
export function lineWarehouse(line: Pick<DocLine, "locationId">, documentLocationId: string): string {
  return line.locationId ?? documentLocationId;
}

/**
 * What a warehouse can still promise of a product, in what its lines are sold in (spec A2): sq ft
 * for area goods, carpet being each roll's free length times its width, or items. Null for
 * products that are not stocked.
 */
export function availableToSell(product: Product, stock: SaleStock, locationId: string): Dec | null {
  const unit = stockUnit(product);
  if (!unit) return null;
  if (unit !== "ft") return availability(product, stock, locationId).available;
  return stock.rolls
    .filter((r) => r.productId === product.id && r.locationId === locationId && !r.transferId)
    .reduce((area, r) => area.plus(rollAvailable(r, stock.reservations).times(r.widthFt)), dec(0));
}

/** One warehouse and what it can still promise of a product. */
export interface WarehouseStock {
  location: Location;
  available: Dec;
}

/** Every warehouse and what it can promise of a product, the most first (spec A2 "another warehouse"). */
export function stockAcrossWarehouses(
  product: Product,
  stock: SaleStock,
  locations: readonly Location[],
): WarehouseStock[] {
  return locations
    .filter((l) => l.kind === "warehouse")
    .map((location) => ({ location, available: availableToSell(product, stock, location.id) ?? dec(0) }))
    .sort((a, b) => b.available.comparedTo(a.available));
}

/** Stock status for badges (spec C3): out at zero available, low at or below the reorder point. */
export function stockStatus(product: Product, available: Dec, rollCount = 1): "out" | "low" | "ok" {
  if (available.lte(0) || rollCount === 0) return "out";
  if (product.reorderPoint !== undefined && available.lte(product.reorderPoint)) return "low";
  return "ok";
}

/**
 * Rolls that can cover a length at a warehouse (spec C2 roll picker): not in transit, enough
 * available length, the chosen dye lot first, then the shortest that fits, so offcuts stay small.
 */
export function rollsForLength(
  rolls: readonly Roll[],
  reservations: readonly Reservation[],
  productId: string,
  locationId: string,
  lengthFt: Dec,
  dyeLot?: string,
): Roll[] {
  return rolls
    .filter((r) => r.productId === productId && r.locationId === locationId && !r.transferId)
    .filter((r) => rollAvailable(r, reservations).gte(lengthFt))
    .sort(
      (a, b) =>
        Number(b.dyeLot === dyeLot) - Number(a.dyeLot === dyeLot) ||
        rollAvailable(a, reservations).comparedTo(rollAvailable(b, reservations)),
    );
}

/** A reservation before it has an id and a date. */
export type ReservationDraft = Omit<Reservation, "id" | "createdAt">;

/**
 * Holds stock for every stock line of a newly issued invoice (spec C2): a line's chosen roll if it
 * still has the length, else the best single roll at the invoice's warehouse, else several rolls
 * (the same dye lot first); boxed goods up to what is available. What cannot be held is recorded
 * as short instead of blocking the sale (plan C-1).
 */
export function planReservations(
  invoice: Pick<Invoice, "id" | "locationId" | "lines">,
  products: readonly Product[],
  stock: { rolls: readonly Roll[]; movements: readonly StockMovement[]; reservations: readonly Reservation[] },
): ReservationDraft[] {
  const held: Reservation[] = [...stock.reservations];
  const drafts: ReservationDraft[] = [];
  for (const line of invoice.lines) {
    const product = products.find((p) => p.id === line.productId);
    const need = product ? stockNeed(line, product) : null;
    if (!product || !need || need.lte(0)) continue;
    const fromId = lineWarehouse(line, invoice.locationId);
    const base = {
      invoiceId: invoice.id,
      lineId: line.id,
      productId: product.id,
      status: "active" as const,
      closedAt: null,
      overrideReason: null,
    };
    const add = (draft: ReservationDraft) => {
      drafts.push(draft);
      held.push({ ...draft, id: `plan-${line.id}-${drafts.length}`, createdAt: "" });
    };
    if (stockUnit(product) !== "ft") {
      const free = availability(product, { ...stock, reservations: held }, fromId).available;
      const quantity = minDec(free, need);
      add({
        ...base,
        rollId: null,
        locationId: fromId,
        quantity: quantity.toString(),
        shortBy: need.minus(quantity).toString(),
      });
      continue;
    }
    // One roll when one is long enough (the chosen one first); else several, the chosen dye lot first.
    const chosen = stock.rolls.find((r) => r.id === line.rollId);
    const single =
      chosen && !chosen.transferId && rollAvailable(chosen, held).gte(need)
        ? chosen
        : rollsForLength(stock.rolls, held, product.id, fromId, need, chosen?.dyeLot)[0];
    if (single) {
      add({ ...base, rollId: single.id, locationId: single.locationId, quantity: need.toString(), shortBy: "0" });
      continue;
    }
    let left = need;
    const candidates = rollsForLength(stock.rolls, held, product.id, fromId, dec("0.01"), chosen?.dyeLot).reverse();
    for (const roll of candidates) {
      if (left.lte(0)) break;
      const take = minDec(rollAvailable(roll, held), left);
      left = left.minus(take);
      add({
        ...base,
        rollId: roll.id,
        locationId: roll.locationId,
        quantity: take.toString(),
        shortBy: left.gt(0) ? "pending" : "0",
      });
    }
    if (left.gt(0)) add({ ...base, rollId: null, locationId: fromId, quantity: "0", shortBy: left.toString() });
    for (const d of drafts) if (d.lineId === line.id && d.shortBy === "pending") d.shortBy = "0";
  }
  return drafts;
}

/**
 * Whether stock may be cut or issued for an invoice (spec C2, plan C-1): once confirmed money has
 * come in, as a deposit, a part or the whole. Otherwise only someone with
 * inventory.reservation.override may, with a reason.
 */
export function mayIssue(ledger: Pick<InvoiceLedger, "paid" | "state">): boolean {
  return dec(ledger.paid).gt(0) || ledger.state === "paid";
}

/** Whether an adjustment of this size waits for an Owner or Manager (spec C1). */
export function adjustmentNeedsApproval(quantity: string, threshold: string): boolean {
  const limit = threshold.trim();
  return limit !== "" && dec(quantity).abs().gt(limit);
}
