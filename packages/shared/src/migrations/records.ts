import { dec, sum } from "../money";
import type { Location, StockMovement } from "../types";
import { stateName } from "../us-pack/states";
import { mapRecords, type Row } from "./map-records";
import type { RecordStep, StoredOverlay, StoredRecords, UpgradeContext } from "./overlay";

/** Branch ids renamed when warehouses were added (plan K-4). */
const RENAMED_BRANCHES: Readonly<Record<string, string>> = { "sm-br-lakewood": "sm-br-springs" };

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
 * Quotes gain an empty tax override and invoices the source of their rate (spec A5). An old
 * invoice either used its state rule or collected nothing.
 */
function upgradeTaxFields(records: StoredOverlay["records"]): StoredOverlay["records"] {
  const next = mapRecords(records, "quotes", (quote) => ({ ...quote, taxOverride: quote.taxOverride ?? null }));
  return mapRecords(next, "invoices", (invoice) => {
    const rule = invoice.taxRule as { state: string } | null;
    const state = rule?.state ?? String((invoice.jobSite as { state?: string } | undefined)?.state ?? "");
    return {
      ...invoice,
      taxOverride: invoice.taxOverride ?? null,
      taxSource:
        invoice.taxSource ??
        (rule
          ? { kind: "state", label: `Default rate for ${stateName(state)} (example)` }
          : { kind: "none", label: `Not collected in ${stateName(state)}` }),
    };
  });
}

/** A saved customer's one address becomes a Home or Billing address, default for both uses (spec A6). */
function upgradeCustomers(records: StoredOverlay["records"]): StoredOverlay["records"] {
  return mapRecords(records, "customers", (customer) => {
    if (Array.isArray(customer.addresses)) return customer;
    const { address, ...rest } = customer as Row & { address?: Record<string, unknown> };
    if (!address) return { ...rest, addresses: [], defaultBillingId: null, defaultJobSiteId: null };
    const id = `${String(customer.id)}-addr-1`;
    const label = customer.type === "homeowner" ? "home" : "billing";
    return { ...rest, addresses: [{ id, label, ...address }], defaultBillingId: id, defaultJobSiteId: id };
  });
}

/**
 * Upgrade steps for saved records, one per model change of feature batch 2, run in order after
 * the role upgrade. Each step reads version 1 shapes and writes version 2 shapes.
 */
export const V2_RECORD_STEPS: RecordStep[] = [stockFromCounts, upgradeLocations, upgradeTaxFields, upgradeCustomers];
