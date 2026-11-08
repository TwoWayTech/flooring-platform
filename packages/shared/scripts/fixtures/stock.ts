import { addDays } from "../../src/dates";
import type { Location, Product, Roll, StockMovement, Transfer, User } from "../../src/types";
import type { GeneratedProduct } from "./catalog";
import type { GenContext } from "./context";

/** The share of each boxed product's counted stock kept at the default warehouse; the rest is at the second. */
const DEFAULT_SHARE = 0.6;

/** What the stock builder hands back: products without their counts, and the ledger that replaces them. */
export interface StockFixtures {
  products: Product[];
  rolls: Roll[];
  stockMovements: StockMovement[];
  transfers: Transfer[];
}

/**
 * Opening stock: each boxed product's counted cartons split between the two warehouses, dated
 * 30 days back so later documents follow it (plan section 2.1: on hand is the ledger's sum).
 */
function openingMovements(
  ctx: GenContext,
  products: readonly GeneratedProduct[],
  warehouses: readonly Location[],
): StockMovement[] {
  const at = `${addDays(ctx.anchor, -30)}T07:00`;
  const source = { kind: "count" as const, id: `${ctx.company.idPrefix}-count-opening`, number: "Stock count" };
  return products.flatMap((p) => {
    if (p.cartonsOnHand === undefined) return [];
    const first = warehouses.length > 1 ? Math.ceil(p.cartonsOnHand * DEFAULT_SHARE) : p.cartonsOnHand;
    const split = [first, p.cartonsOnHand - first];
    return warehouses
      .map((w, i) => ({ w, quantity: split[i] ?? 0 }))
      .filter(({ quantity }) => quantity > 0)
      .map(({ w, quantity }) => ({
        id: ctx.id("mov"),
        at,
        productId: p.id,
        locationId: w.id,
        quantity: String(quantity),
        kind: "opening" as const,
        source,
        byUserId: null,
      }));
  });
}

/** A transfer of a few cartons of one product, with its ledger lines when it was sent and received. */
function boxedTransfer(
  ctx: GenContext,
  product: Product,
  quantity: number,
  route: { from: Location; to: Location },
  dates: { sent: string; received: string | null },
  byUserId: string,
): { transfer: Transfer; movements: StockMovement[] } {
  const id = ctx.id("trf");
  const number = `TR-${1000 + Number(id.slice(-4))}`;
  const line = { id: ctx.id("trl"), productId: product.id, rollId: null, quantity: String(quantity) };
  const source = { kind: "transfer" as const, id, number };
  const move = (locationId: string, signed: number, at: string, kind: "transfer_out" | "transfer_in") => ({
    id: ctx.id("mov"),
    at,
    productId: product.id,
    locationId,
    quantity: String(signed),
    kind,
    source,
    byUserId,
  });
  const movements = [move(route.from.id, -quantity, dates.sent, "transfer_out")];
  if (dates.received) movements.push(move(route.to.id, quantity, dates.received, "transfer_in"));
  return {
    transfer: {
      id,
      number,
      fromId: route.from.id,
      toId: route.to.id,
      status: dates.received ? "received" : "in_transit",
      lines: [line],
      createdAt: dates.sent,
      createdBy: byUserId,
      receivedAt: dates.received,
      receivedBy: dates.received ? byUserId : null,
      note: "",
    },
    movements,
  };
}

/**
 * The stock ledger and transfers (spec A1, C1): opening counts per warehouse, two received
 * transfers and one still in transit that also carries a roll, so the Transfers tab has a
 * transfer to receive. Choices are deterministic so the earlier builders' records stay as they were.
 */
export function buildStock(
  ctx: GenContext,
  generated: readonly GeneratedProduct[],
  rolls: readonly Roll[],
  locations: readonly Location[],
  users: readonly User[],
): StockFixtures {
  const products = generated.map((p) => {
    const product: GeneratedProduct = { ...p };
    delete product.cartonsOnHand;
    return product as Product;
  });
  const warehouses = locations.filter((l) => l.kind === "warehouse");
  if (warehouses.length < 2) return { products, rolls: [...rolls], stockMovements: [], transfers: [] };
  const stockMovements = openingMovements(ctx, generated, warehouses);
  const mover = users.find((u) => u.roleIds.some((r) => r.endsWith("-role-warehouse")))!;
  const [main, second] = warehouses as [Location, Location];
  const stocked = generated.filter((p) => (p.cartonsOnHand ?? 0) >= 60);
  const plan = [
    { product: stocked[0]!, quantity: 12, route: { from: main, to: second }, sent: -21, received: -19 },
    { product: stocked[1]!, quantity: 8, route: { from: second, to: main }, sent: -9, received: -8 },
    { product: stocked[2]!, quantity: 10, route: { from: main, to: second }, sent: -1, received: null },
  ];
  const transfers: Transfer[] = [];
  for (const step of plan) {
    const at = (offset: number) => `${addDays(ctx.anchor, offset)}T10:30`;
    const dates = { sent: at(step.sent), received: step.received === null ? null : at(step.received) };
    const { transfer, movements } = boxedTransfer(ctx, step.product, step.quantity, step.route, dates, mover.id);
    transfers.push(transfer);
    stockMovements.push(...movements);
  }
  const travelling = transfers.at(-1)!;
  // The last eligible roll, so the rolls the presenter guide and tests open stay at their warehouse.
  const roll = rolls
    .filter((r) => !r.isRemnant && r.locationId === main.id && Number(r.remainingLengthFt) > 40)
    .at(-1)!;
  travelling.lines.push({
    id: ctx.id("trl"),
    productId: roll.productId,
    rollId: roll.id,
    quantity: roll.remainingLengthFt,
  });
  return {
    products,
    rolls: rolls.map((r) => (r.id === roll.id ? { ...r, transferId: travelling.id } : r)),
    stockMovements,
    transfers,
  };
}
