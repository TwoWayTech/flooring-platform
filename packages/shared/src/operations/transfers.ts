import { dec } from "../money";
import { boxedOnHand } from "../stock";
import type { Location, Product, Roll, StockMovement, Transfer, TransferLine } from "../types";

/** What a person fills in to start a transfer. */
export interface TransferInput {
  fromId: string;
  toId: string;
  lines: Omit<TransferLine, "id">[];
  note: string;
}

/**
 * Why a transfer cannot start, or null when it can (spec A1): both ends are different
 * warehouses (showrooms hold no sellable stock, plan A-1), every roll is at the sender and not
 * already travelling, and boxed quantities are whole cartons or items and no more than the sender holds.
 * Lines of one product are added up before they are compared with what the sender holds, a roll
 * line must name the roll's own product, and a roll may appear once (PR #12 security review).
 */
export function validateTransfer(
  input: TransferInput,
  locations: readonly Location[],
  rolls: readonly Roll[],
  movements: readonly StockMovement[],
  products: readonly Pick<Product, "id" | "sqFtPerCarton">[],
): string | null {
  const from = locations.find((l) => l.id === input.fromId);
  const to = locations.find((l) => l.id === input.toId);
  if (!from || !to) return "Choose the warehouse the stock leaves and the one it goes to.";
  if (from.kind !== "warehouse" || to.kind !== "warehouse") return "Showrooms hold no sellable stock.";
  if (from.id === to.id) return "Choose two different warehouses.";
  if (input.lines.length === 0) return "Add at least one item to the transfer.";
  const seenRolls = new Set<string>();
  const sending = new Map<string, ReturnType<typeof dec>>();
  for (const line of input.lines) {
    if (line.rollId) {
      const roll = rolls.find((r) => r.id === line.rollId);
      if (!roll || roll.locationId !== from.id) return `That roll is not at ${from.name}.`;
      if (roll.productId !== line.productId) return `Roll ${roll.rollNumber} is a different product.`;
      if (roll.transferId) return `Roll ${roll.rollNumber} is already on a transfer.`;
      if (seenRolls.has(roll.id)) return `Roll ${roll.rollNumber} is on the transfer twice.`;
      seenRolls.add(roll.id);
      continue;
    }
    const quantity = dec(line.quantity || "0");
    if (quantity.lte(0)) return "Enter a quantity above zero for every item.";
    const product = products.find((p) => p.id === line.productId);
    const pack = product?.sqFtPerCarton;
    if (pack ? !quantity.dividedBy(pack).isInteger() : !quantity.isInteger()) {
      return pack ? `Move whole cartons: multiples of ${pack} sq ft.` : "Move whole items.";
    }
    sending.set(line.productId, (sending.get(line.productId) ?? dec(0)).plus(quantity));
  }
  for (const [productId, total] of sending) {
    const held = boxedOnHand(movements, productId, from.id);
    if (total.gt(held)) return `Only ${held.toString()} on hand at ${from.name} for one of the items.`;
  }
  return null;
}

/** The ids a transfer needs when it is started or received. */
export interface TransferIds {
  movementId: () => string;
  at: string;
  byUserId: string;
}

/** Ledger lines for a transfer's boxed goods: out of the sender when it starts, into the receiver when it arrives. */
function movementsFor(transfer: Transfer, direction: "out" | "in", ids: TransferIds): StockMovement[] {
  return transfer.lines
    .filter((line) => !line.rollId)
    .map((line) => ({
      id: ids.movementId(),
      at: ids.at,
      productId: line.productId,
      locationId: direction === "out" ? transfer.fromId : transfer.toId,
      quantity: direction === "out" ? dec(line.quantity).negated().toString() : dec(line.quantity).toString(),
      kind: direction === "out" ? ("transfer_out" as const) : ("transfer_in" as const),
      source: { kind: "transfer" as const, id: transfer.id, number: transfer.number },
      byUserId: ids.byUserId,
    }));
}

/** Starts a transfer: boxed stock leaves the sender, and each roll is marked as travelling. */
export function startTransfer(
  transfer: Transfer,
  rolls: readonly Roll[],
  ids: TransferIds,
): { movements: StockMovement[]; rolls: Roll[] } {
  const moving = new Set(transfer.lines.map((l) => l.rollId).filter(Boolean));
  return {
    movements: movementsFor(transfer, "out", ids),
    rolls: rolls.filter((r) => moving.has(r.id)).map((r) => ({ ...r, transferId: transfer.id })),
  };
}

/** Receives a transfer: boxed stock arrives, and rolls move to the receiving warehouse's receiving bin. */
export function receiveTransfer(
  transfer: Transfer,
  rolls: readonly Roll[],
  ids: TransferIds,
): { transfer: Transfer; movements: StockMovement[]; rolls: Roll[] } {
  if (transfer.status !== "in_transit") throw new Error(`${transfer.number} was already received.`);
  return {
    transfer: { ...transfer, status: "received", receivedAt: ids.at, receivedBy: ids.byUserId },
    movements: movementsFor(transfer, "in", ids),
    rolls: rolls
      .filter((r) => r.transferId === transfer.id)
      .map((r) => ({ ...r, locationId: transfer.toId, bin: "Receiving", transferId: null })),
  };
}
