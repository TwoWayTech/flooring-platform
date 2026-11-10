import { dec, maxDec, minDec, sum, type Dec } from "../money";
import type { PtoRequest, TimeOffEntry, TimeOffPolicy } from "../types";

/** A person's balance under a policy: the sum of its ledger lines (ADR 0024). */
export function timeOffBalance(entries: readonly TimeOffEntry[], employeeId: string, policyId: string): Dec {
  return sum(entries.filter((e) => e.employeeId === employeeId && e.policyId === policyId).map((e) => e.hours));
}

/** All of a person's balances, one per policy that accrues or holds hours. */
export function timeOffBalances(
  entries: readonly TimeOffEntry[],
  employeeId: string,
  policies: readonly TimeOffPolicy[],
): { policy: TimeOffPolicy; hours: Dec }[] {
  return policies.map((policy) => ({ policy, hours: timeOffBalance(entries, employeeId, policy.id) }));
}

/** Hours of waiting requests, not yet posted to the ledger, so they are not promised twice. */
export function pendingHours(requests: readonly PtoRequest[], employeeId: string, policyId: string): Dec {
  return sum(
    requests
      .filter((r) => r.employeeId === employeeId && r.policyId === policyId && r.status === "pending")
      .map((r) => r.hours),
  );
}

/** Why a time-off request cannot be made, or null. Unpaid leave has no balance to run out of. */
export function timeOffProblem(input: {
  start: string;
  end: string;
  hours: string;
  policy: TimeOffPolicy;
  balance: Dec;
  pending: Dec;
}): string | null {
  if (input.end < input.start) return "The last day must be on or after the first day.";
  if (dec(input.hours).lte(0)) return "Enter how many hours you need.";
  if (input.policy.kind === "unpaid" || input.policy.allowNegative) return null;
  const left = input.balance.minus(input.pending);
  if (dec(input.hours).gt(left)) return `You have ${maxDec(left, 0).toString()} hours left of ${input.policy.name}.`;
  return null;
}

/**
 * Hours to accrue for one policy, capped so the balance never passes the cap (ADR 0024): accrual
 * pauses at the cap rather than taking hours back. Per pay period and per hour worked only.
 */
export function accrualFor(policy: TimeOffPolicy, balance: Dec, hoursWorked: string): Dec {
  const earned =
    policy.accrualMethod === "per_pay_period"
      ? dec(policy.accrualRate)
      : policy.accrualMethod === "per_hour_worked"
        ? dec(policy.accrualRate).times(hoursWorked)
        : dec(0);
  if (!policy.capHours) return earned;
  return minDec(earned, maxDec(dec(policy.capHours).minus(balance), 0));
}

/** Why a policy cannot be saved for a California worker (ADR 0024): vested vacation is never forfeited. */
export function californiaPolicyProblem(policy: Pick<TimeOffPolicy, "kind" | "carryoverHours">): string | null {
  if ((policy.kind === "vacation" || policy.kind === "personal") && policy.carryoverHours !== "") {
    return "California does not allow a carryover limit on vacation; use a cap, which pauses accrual instead.";
  }
  return null;
}
