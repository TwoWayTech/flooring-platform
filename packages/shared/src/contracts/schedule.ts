import { D, dec, moneyString, type Dec } from "../money";
import type { ContractBilling, ContractLine } from "../types";
import { billingLineDelta, heldByLine, lineToDate } from "./billing";

/** One schedule-of-values line's money to date (contracts.md rule 11a): billed, still retained and left to bill. */
export interface ScheduleLine {
  lineId: string;
  contractId: string;
  /** Work to date plus stored materials on the latest posted billing: the sum of the line's gross. */
  billed: string;
  /** Retainage the line still holds (rule 9). */
  retained: string;
  /** Scheduled value less billed. */
  remaining: string;
}

/** What happened to one posted billing's retainage (contracts.md rule 10a). */
export interface BillingRetainage {
  billingId: string;
  contractId: string;
  /** On a progress billing, how much of the retainage it held has been released since; on a release, its amount. */
  released: string;
  /** On a release, how much it took from each progress billing's retainage, oldest first; empty on a progress billing. */
  paidFrom: { billingId: string; amount: string }[];
  /**
   * On a release, any part that found no retainage to pay out of: "0.00" whenever the billings
   * agree, because posting refuses a release above what is held (rule 10). Shown, never dropped.
   */
  unallocated: string;
}

/** The schedule of values and the release allocation of some contracts, derived from posted billings. */
export interface ContractSchedule {
  lines: ScheduleLine[];
  billings: BillingRetainage[];
}

const postedInOrder = (billings: readonly ContractBilling[]) =>
  billings.filter((b) => b.status === "posted").sort((a, b) => a.number - b.number);

/** Each line's billed, retained and remaining figures (rule 11a). Only posted billings count. */
export function scheduleLines(lines: readonly ContractLine[], billings: readonly ContractBilling[]): ScheduleLine[] {
  return lines.map((line) => {
    const own = billings.filter((b) => b.contractId === line.contractId);
    const { completed, stored } = lineToDate(line.id, own);
    const billed = completed.plus(stored);
    const held = heldByLine(own, [line]).get(line.id) ?? dec(0);
    return {
      lineId: line.id,
      contractId: line.contractId,
      billed: moneyString(billed),
      retained: moneyString(held),
      remaining: moneyString(dec(line.scheduledValue).minus(billed)),
    };
  });
}

/** Retainage still held per line, as a queue of the billings that withheld it, oldest first. */
type Held = Map<string, { billingId: string; left: Dec }[]>;

/** Adds a progress billing's withholding to the queue; a lowered line gives back its newest withholding first. */
function withhold(queue: Held, billing: ContractBilling, seen: readonly ContractBilling[]): void {
  for (const input of billing.lines) {
    const { withheld } = billingLineDelta(input, lineToDate(input.lineId, seen));
    const entries = queue.get(input.lineId) ?? [];
    queue.set(input.lineId, entries);
    if (withheld.gt(0)) entries.push({ billingId: billing.id, left: withheld });
    let back = withheld.negated();
    for (let i = entries.length - 1; i >= 0 && back.gt(0); i--) {
      const take = D.min(back, entries[i]!.left);
      entries[i]!.left = entries[i]!.left.minus(take);
      back = back.minus(take);
    }
  }
}

/** What one release paid out of each billing, and what found no retainage to pay out of. */
interface PaidOut {
  given: Map<string, Dec>;
  unallocated: Dec;
}

/** Pays a release out of each line's queue, oldest billing first. An excess is kept as `unallocated`, never dropped. */
function payOut(queue: Held, billing: ContractBilling): PaidOut {
  const given = new Map<string, Dec>();
  let unallocated = dec(0);
  for (const release of billing.releases) {
    let amount = dec(release.amount);
    for (const entry of queue.get(release.lineId) ?? []) {
      if (amount.lte(0)) break;
      const take = D.min(amount, entry.left);
      if (take.lte(0)) continue;
      entry.left = entry.left.minus(take);
      amount = amount.minus(take);
      given.set(entry.billingId, (given.get(entry.billingId) ?? dec(0)).plus(take));
    }
    unallocated = unallocated.plus(D.max(amount, 0));
  }
  return { given, unallocated };
}

/**
 * Allocates each posted release to the progress billings whose retainage it paid out (rule 10a):
 * per line, a release takes the oldest billing's retainage first. A billing that lowered a line
 * gives back the newest withholding first, so the allocation matches what each billing still holds.
 * A release's `paidFrom` amounts plus its `unallocated` add up exactly to its line shares.
 */
export function releaseAllocation(billings: readonly ContractBilling[]): BillingRetainage[] {
  const result: BillingRetainage[] = [];
  for (const contractId of new Set(billings.map((b) => b.contractId))) {
    const done = postedInOrder(billings.filter((b) => b.contractId === contractId));
    const queue: Held = new Map();
    const released = new Map<string, Dec>();
    const paid = new Map<string, PaidOut>();
    const seen: ContractBilling[] = [];
    for (const billing of done) {
      if (billing.kind === "progress") withhold(queue, billing, seen);
      const out = payOut(queue, billing);
      for (const [billingId, amount] of out.given) {
        released.set(billingId, (released.get(billingId) ?? dec(0)).plus(amount));
      }
      if (billing.kind === "release") paid.set(billing.id, out);
      seen.push(billing);
    }
    for (const billing of done) {
      const out = paid.get(billing.id);
      result.push({
        billingId: billing.id,
        contractId,
        released: moneyString(billing.kind === "release" ? billing.released : (released.get(billing.id) ?? 0)),
        paidFrom: out
          ? done
              .filter((b) => out.given.has(b.id))
              .map((b) => ({ billingId: b.id, amount: moneyString(out.given.get(b.id)!) }))
          : [],
        unallocated: moneyString(out?.unallocated ?? 0),
      });
    }
  }
  return result;
}

/** The schedule of values and release allocation of the given lines and billings (rules 10a and 11a). */
export function contractSchedule(
  lines: readonly ContractLine[],
  billings: readonly ContractBilling[],
): ContractSchedule {
  return { lines: scheduleLines(lines, billings), billings: releaseAllocation(billings) };
}
