import { dec, sum } from "../money";
import type { Location, StockMovement } from "../types";
import type { RecordStep, StoredOverlay, StoredRecords, UpgradeContext } from "./overlay";

/** Branch ids renamed when warehouses were added (plan K-4). */
const RENAMED_BRANCHES: Readonly<Record<string, string>> = { "sm-br-lakewood": "sm-br-springs" };

type Row = Record<string, unknown>;

/** Applies a change to every saved (non-deleted) record of one collection. */
function mapRecords(records: StoredOverlay["records"], name: string, change: (row: Row) => Row) {
  const saved = records[name];
  if (!saved) return records;
  const next: StoredRecords = {};
  for (const [id, row] of Object.entries(saved)) next[id] = row === null ? null : change(row as Row);
  return { ...records, [name]: next };
}

const branchOf = (row: Row) => {
  const branchId = String(row.branchId ?? "");
  return RENAMED_BRANCHES[branchId] ?? branchId;
};

/** The warehouse of a branch, or the company default (spec A1). */
function warehouseFor(locations: readonly Location[], branchId: string): string {
  const warehouses = locations.filter((l) => l.kind === "warehouse");
  return (
    (warehouses.find((l) => l.branchId === branchId) ?? warehouses.find((l) => l.isDefault) ?? warehouses[0])?.id ?? ""
  );
}

/**
 * Saved product stock counts become ledger lines (plan section 2.1). The fresh fixtures' opening
 * count equals the old generated count, so any difference came from receiving in the old demo
 * and is kept as a receipt into the default warehouse.
 */
function stockFromCounts(records: StoredOverlay["records"], ctx: UpgradeContext): StoredOverlay["records"] {
  const products = records.products;
  if (!products) return records;
  const target = warehouseFor(ctx.base.locations, "");
  const movements: StoredRecords = { ...(records.stockMovements ?? {}) };
  const cleaned: StoredRecords = {};
  for (const [id, row] of Object.entries(products)) {
    if (row === null) {
      cleaned[id] = null;
      continue;
    }
    const { cartonsOnHand, ...product } = row as Row & { cartonsOnHand?: number };
    cleaned[id] = product;
    if (cartonsOnHand === undefined) continue;
    const opening = sum(
      ctx.base.stockMovements.filter((m) => m.productId === id && m.kind === "opening").map((m) => m.quantity),
    );
    const delta = dec(cartonsOnHand).minus(opening);
    if (delta.isZero()) continue;
    const movement: StockMovement = {
      id: `${id}-mov-upgrade`,
      at: `${ctx.base.anchorDate}T00:00`,
      productId: id,
      locationId: target,
      quantity: delta.toString(),
      kind: delta.gt(0) ? "receipt" : "adjustment",
      source: { kind: "count", id: "upgrade", number: "Saved stock from an earlier demo" },
      byUserId: null,
    };
    movements[movement.id] = movement;
  }
  return { ...records, products: cleaned, stockMovements: movements };
}

/** Rolls, documents and users gain their warehouse (spec A1); renamed branches follow. */
function upgradeLocations(records: StoredOverlay["records"], ctx: UpgradeContext): StoredOverlay["records"] {
  const { locations } = ctx.base;
  const warehouses = locations.filter((l) => l.kind === "warehouse");
  let next = mapRecords(records, "rolls", ({ warehouse, ...roll }) => ({
    ...roll,
    locationId: (warehouse === "Annex" ? warehouses[1] : warehouses[0])?.id ?? "",
    transferId: null,
  }));
  for (const name of ["quotes", "invoices"]) {
    next = mapRecords(next, name, (doc) => ({
      ...doc,
      branchId: branchOf(doc),
      locationId: doc.locationId ?? warehouseFor(locations, branchOf(doc)),
    }));
  }
  next = mapRecords(next, "purchaseOrders", (po) => ({
    ...po,
    locationId: po.locationId ?? warehouseFor(locations, ""),
  }));
  return mapRecords(next, "users", (user) => ({
    ...user,
    branchId: branchOf(user),
    defaultLocationId: user.defaultLocationId ?? null,
  }));
}

/**
 * Upgrade steps for saved records, one per model change of feature batch 2, run in order after
 * the role upgrade. Each step reads version 1 shapes and writes version 2 shapes.
 */
export const V2_RECORD_STEPS: RecordStep[] = [stockFromCounts, upgradeLocations];
