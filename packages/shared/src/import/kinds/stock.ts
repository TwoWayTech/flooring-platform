import { dec, roundUnitCost } from "../../money";
import { boxedOnHand, stockUnit } from "../../stock";
import type { Location, Product, Roll, StockMovement } from "../../types";
import { findLocation, patched, text } from "../lookup";
import type { KindHandler, ParsedRow, PlanContext, RowOutcome } from "../plan";

/** The product and warehouse a row names, or the problem with them. */
function placeOf(
  row: ParsedRow,
  ctx: PlanContext,
): { product: Product; warehouse: Location } | { problems: { field: string; message: string }[] } {
  const sku = text(row, "sku");
  const product = ctx.world.products.find((p) => p.sku.toLowerCase() === sku.toLowerCase());
  if (!product)
    return { problems: [{ field: "sku", message: `No product with SKU “${sku}”. Import products first.` }] };
  const name = text(row, "warehouse");
  const warehouse = findLocation(ctx.world.locations, name);
  if (!warehouse) return { problems: [{ field: "warehouse", message: `No warehouse named “${name}”.` }] };
  if (warehouse.kind !== "warehouse") {
    return {
      problems: [{ field: "warehouse", message: `${warehouse.name} is a showroom; showrooms hold no sellable stock.` }],
    };
  }
  return { product, warehouse };
}

/**
 * A carpet roll (spec G1 "rolls and stock with warehouse", C1): a new roll number adds the roll
 * at its full length. An existing roll keeps its length and warehouse, which change only
 * through cuts, adjustments and transfers; its bin and dye lot can be corrected.
 */
function resolveRoll(row: ParsedRow, ctx: PlanContext, product: Product, warehouse: Location): RowOutcome {
  const number = text(row, "roll_number");
  if (!number)
    return {
      problems: [{ field: "roll_number", message: `${product.sku} is sold off the roll; give the roll number.` }],
    };
  const label = `Roll ${number}`;
  const existing = ctx.world.rolls.find((r) => r.rollNumber.toLowerCase() === number.toLowerCase());
  if (existing) {
    if (existing.productId !== product.id)
      return { problems: [{ field: "roll_number", message: `Roll ${number} is another product's roll.` }] };
    const next = patched(existing, { bin: row.bin as string | null, dyeLot: row.dye_lot as string | null });
    const note = "Length and warehouse change through cuts, adjustments and transfers.";
    if (!next) return { action: "skip", label, writes: [], note: "Already in stock." };
    return { action: "update", label, writes: [{ collection: "rolls", record: next }], note };
  }
  const length = text(row, "length_ft");
  if (!length || dec(length).isZero())
    return { problems: [{ field: "length_ft", message: "Give the roll's length in ft." }] };
  const roll: Roll = {
    id: ctx.newId("roll"),
    rollNumber: number,
    productId: product.id,
    dyeLot: text(row, "dye_lot"),
    widthFt: row.width_ft ? Number(row.width_ft) : (product.widthFt ?? 12),
    originalLengthFt: length,
    remainingLengthFt: length,
    // The product's cost is per sq yd; a roll keeps it per sq ft (CLAUDE.md rule 4).
    costPerSqFt: text(row, "cost_per_sq_ft") || roundUnitCost(dec(product.cost)).toString(),
    locationId: warehouse.id,
    bin: text(row, "bin"),
    transferId: null,
    isRemnant: false,
    parentRollId: null,
    receivedAt: ctx.today,
    cuts: [],
  };
  return { action: "create", label, writes: [{ collection: "rolls", record: roll }] };
}

/**
 * Boxed stock (spec G1, A1): the row is the sq ft or items on hand at the
 * warehouse. The import writes one stock movement for the difference, sourced to the import, so
 * on hand stays the sum of movements and a second import of the same count changes nothing.
 */
function resolveBoxed(row: ParsedRow, ctx: PlanContext, product: Product, warehouse: Location): RowOutcome {
  const label = `${product.sku} at ${warehouse.name}`;
  const counted = text(row, "quantity");
  if (!counted)
    return {
      problems: [
        { field: "quantity", message: `Give the ${stockUnit(product) === "sq_ft" ? "sq ft" : "items"} on hand.` },
      ],
    };
  const before = boxedOnHand(ctx.world.stockMovements, product.id, warehouse.id);
  const change = dec(counted).minus(before);
  if (change.isZero()) return { action: "skip", label, writes: [], note: `Already ${counted} on hand.` };
  const movement: StockMovement = {
    id: ctx.newId("mov"),
    at: ctx.now,
    productId: product.id,
    locationId: warehouse.id,
    quantity: change.toString(),
    kind: before.isZero() ? "opening" : "adjustment",
    source: { kind: "count", id: ctx.batch.id, number: ctx.batch.number },
    byUserId: ctx.actorId,
  };
  const note = before.isZero() ? null : `Counted ${counted}, was ${before.toString()}.`;
  return {
    action: before.isZero() ? "create" : "update",
    label,
    writes: [{ collection: "stockMovements", record: movement }],
    ...(note ? { note } : {}),
  };
}

/** Rolls go by roll number, boxed goods by count; services and pad are not stocked. */
function resolveStock(row: ParsedRow, ctx: PlanContext): RowOutcome {
  const place = placeOf(row, ctx);
  if ("problems" in place) return place;
  const unit = stockUnit(place.product);
  if (unit === null) return { problems: [{ field: "sku", message: `${place.product.sku} is not a stocked product.` }] };
  return unit === "ft"
    ? resolveRoll(row, ctx, place.product, place.warehouse)
    : resolveBoxed(row, ctx, place.product, place.warehouse);
}

/** The rolls and stock kind. */
export const STOCK: KindHandler = {
  labelField: "sku",
  duplicateKey: (row) =>
    text(row, "roll_number")
      ? `roll:${text(row, "roll_number").toLowerCase()}`
      : `${text(row, "sku").toLowerCase()}@${text(row, "warehouse").toLowerCase()}`,
  resolve: resolveStock,
  def: {
    kind: "stock",
    label: "Rolls and stock",
    description: "Carpet rolls by roll number, and sq ft or items on hand, per warehouse.",
    module: "core",
    matchOn: "roll number, or SKU and warehouse",
    fields: [
      {
        key: "sku",
        label: "SKU",
        type: "text",
        required: true,
        aliases: ["item", "product code"],
        examples: ["RW-5001", "BL-3100"],
      },
      {
        key: "warehouse",
        label: "Warehouse",
        type: "text",
        required: true,
        aliases: ["location", "site"],
        examples: ["Denver Central", "Denver Central"],
      },
      {
        key: "quantity",
        label: "On hand",
        type: "integer",
        aliases: ["quantity", "qty", "count", "on hand"],
        examples: ["120", ""],
      },
      {
        key: "roll_number",
        label: "Roll number",
        type: "text",
        aliases: ["roll", "roll no", "roll id"],
        examples: ["", "R-20418"],
      },
      {
        key: "length_ft",
        label: "Length (ft)",
        type: "number",
        unit: "ft",
        aliases: ["length", "roll length"],
        examples: ["", "120 ft"],
      },
      { key: "width_ft", label: "Width (ft)", type: "number", unit: "ft", aliases: ["width"], examples: ["", "12"] },
      { key: "dye_lot", label: "Dye lot", type: "text", aliases: ["lot", "dye lot number"], examples: ["", "14B"] },
      { key: "bin", label: "Bin", type: "text", aliases: ["bin location", "rack"], examples: ["A-12", "R-03"] },
      {
        key: "cost_per_sq_ft",
        label: "Cost per sq ft",
        type: "number",
        aliases: ["roll cost", "cost"],
        examples: ["", "2.05"],
      },
    ],
  },
};
