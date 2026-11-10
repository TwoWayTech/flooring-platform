import { dec, moneyString, pctOf, roundMoney, sum, type Dec } from "../money";
import type { BillingLine, ChangeOrder, Contract, ContractBilling, ContractLine } from "../types";

const posted = (billings: readonly ContractBilling[]) => billings.filter((b) => b.status === "posted");

/** A line's latest cumulative figures, or zero before its first billing. */
export function lineToDate(lineId: string, billings: readonly ContractBilling[]): { completed: Dec; stored: Dec } {
  const last = posted(billings)
    .filter((b) => b.kind === "progress")
    .sort((a, b) => a.number - b.number)
    .flatMap((b) => b.lines.filter((l) => l.lineId === lineId))
    .at(-1);
  return { completed: dec(last?.completedToDate ?? 0), stored: dec(last?.storedBalance ?? 0) };
}

/** The rates in force on a line: its own override, otherwise the contract's (ADR 0026). */
export function lineRates(line: ContractLine, contract: Contract) {
  return {
    retainagePct: line.retainagePct ?? contract.retainagePct,
    storedRetainagePct: line.storedRetainagePct ?? contract.storedRetainagePct,
  };
}

const heldOn = (rate: string, amount: Dec) => roundMoney(pctOf(amount, rate));

/** What one line adds in a billing: gross and retainage (ADR 0026 formulas). */
export function billingLineDelta(input: BillingLine, before: { completed: Dec; stored: Dec }) {
  const completed = dec(input.completedToDate);
  const stored = dec(input.storedBalance);
  const gross = completed.plus(stored).minus(before.completed).minus(before.stored);
  const withheld = heldOn(input.retainagePct, completed)
    .minus(heldOn(input.retainagePct, before.completed))
    .plus(heldOn(input.storedRetainagePct, stored))
    .minus(heldOn(input.storedRetainagePct, before.stored));
  return { gross, withheld };
}

/** A billing's per-line amounts and totals. */
export function billingFigures(inputs: readonly BillingLine[], billings: readonly ContractBilling[]) {
  const lines = inputs.map((input) => ({
    lineId: input.lineId,
    ...billingLineDelta(input, lineToDate(input.lineId, billings)),
  }));
  return { lines, gross: sum(lines.map((l) => l.gross)), withheld: sum(lines.map((l) => l.withheld)) };
}

/** Why a billing cannot be posted, or null: cumulative figures stay between zero and the line's value. */
export function billingProblem(
  inputs: readonly BillingLine[],
  lines: readonly ContractLine[],
  billings: readonly ContractBilling[],
): string | null {
  for (const input of inputs) {
    const line = lines.find((l) => l.id === input.lineId);
    if (!line) return "A line on this billing no longer exists.";
    const total = dec(input.completedToDate).plus(input.storedBalance);
    if (dec(input.completedToDate).lt(0) || dec(input.storedBalance).lt(0))
      return `${line.code}: amounts can't be negative.`;
    if (total.gt(line.scheduledValue)) return `${line.code}: work and stored materials can't pass the line's value.`;
  }
  return billingFigures(inputs, billings).lines.every((l) => l.gross.isZero())
    ? "Nothing has changed since the last billing."
    : null;
}

/** Retainage held on each line: withheld over all billings, less releases. */
export function heldByLine(billings: readonly ContractBilling[], lines: readonly ContractLine[]): Map<string, Dec> {
  const done = posted(billings).sort((a, b) => a.number - b.number);
  const held = new Map(lines.map((l) => [l.id, dec(0)]));
  const seen: ContractBilling[] = [];
  for (const billing of done) {
    if (billing.kind === "progress") {
      for (const input of billing.lines) {
        const { withheld } = billingLineDelta(input, lineToDate(input.lineId, seen));
        held.set(input.lineId, (held.get(input.lineId) ?? dec(0)).plus(withheld));
      }
    }
    for (const r of billing.releases) held.set(r.lineId, (held.get(r.lineId) ?? dec(0)).minus(r.amount));
    seen.push(billing);
  }
  return held;
}

/**
 * Shares a release over the lines by what each holds, the last line taking the remainder so the
 * parts add up exactly (ADR 0026: X_L = round2(X × H_L ÷ H)).
 */
export function allocateRelease(amount: string, held: ReadonlyMap<string, Dec>): { lineId: string; amount: string }[] {
  const lines = [...held.entries()].filter(([, h]) => h.gt(0));
  const total = sum(lines.map(([, h]) => h));
  let left = dec(amount);
  return lines.map(([lineId, h], i) => {
    const part = i === lines.length - 1 ? left : roundMoney(dec(amount).times(h).dividedBy(total));
    left = left.minus(part);
    return { lineId, amount: moneyString(part) };
  });
}

/** A contract's money, derived (ADR 0026). Invoiced is billed, Retained is held, Remaining is what is left to bill. */
export interface ContractFigures {
  originalValue: string;
  /** Revised contract value: the sum of the lines. */
  value: string;
  billed: string;
  withheld: string;
  released: string;
  held: string;
  remaining: string;
  pendingChanges: string;
}

/** Derives a contract's figures from its lines, billings and change orders. */
export function contractFigures(
  contract: Contract,
  lines: readonly ContractLine[],
  billings: readonly ContractBilling[],
  changeOrders: readonly ChangeOrder[],
): ContractFigures {
  const own = lines.filter((l) => l.contractId === contract.id);
  const done = posted(billings.filter((b) => b.contractId === contract.id));
  const value = sum(own.map((l) => l.scheduledValue));
  const billed = sum(done.map((b) => b.gross));
  const withheld = sum(done.map((b) => b.withheld));
  const released = sum(done.map((b) => b.released));
  const pending = changeOrders
    .filter((c) => c.contractId === contract.id && c.status === "pending")
    .flatMap((c) => c.lines.map((l) => l.amountDelta));
  return {
    originalValue: contract.originalValue,
    value: moneyString(value),
    billed: moneyString(billed),
    withheld: moneyString(withheld),
    released: moneyString(released),
    held: moneyString(withheld.minus(released)),
    remaining: moneyString(value.minus(billed)),
    pendingChanges: moneyString(sum(pending)),
  };
}

/** Why a change order cannot be approved, or null: a deduction may not take a line below what is billed (ADR 0026). */
export function changeOrderProblem(
  order: ChangeOrder,
  lines: readonly ContractLine[],
  billings: readonly ContractBilling[],
): string | null {
  if (order.lines.length === 0) return "Add at least one line to the change order.";
  for (const change of order.lines) {
    if (!change.lineId) continue;
    const line = lines.find((l) => l.id === change.lineId);
    if (!line) return "A line on this change order no longer exists.";
    const { completed, stored } = lineToDate(line.id, billings);
    if (dec(line.scheduledValue).plus(change.amountDelta).lt(completed.plus(stored))) {
      return `${line.code}: the change would take it below what is already billed.`;
    }
  }
  return null;
}
