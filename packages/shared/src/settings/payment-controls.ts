import { dec } from "../money";
import type { PaymentSettings } from "../types/settings";

/** What anyone but an Owner is told when a Payments save would loosen a control (ADR 0059, "2026-11-20"). */
export const PAYMENT_CONTROLS_OWNER_ONLY =
  "Only an Owner can switch off payment approval, raise the approval amount or raise the write-off limit.";

/**
 * Whether a Payments save loosens a fraud control, which only an Owner may do (owner's answer to
 * PR #51 Q10, ADR 0059 "2026-11-20"): the person who records and approves payments must not be able
 * to switch off the check they work under. Loosening is:
 * - the two-person check going from on to off;
 * - the approval amount going up: payments at or below it skip the check, and empty means every
 *   payment waits, so an amount appearing where there was none is looser too;
 * - the write-off limit going up, or going empty, which means no limit.
 * Both amounts are plain money (`paymentSettingsProblem` runs first) and are compared by value.
 * `current` is the stored section, or the never-saved answer (the strictest).
 */
export function paymentControlsLoosened(next: PaymentSettings, current: PaymentSettings): boolean {
  if (current.approvalRequired && !next.approvalRequired) return true;
  if (higherAmount(next.approvalThreshold, current.approvalThreshold, "every payment waits")) return true;
  return higherAmount(next.writeOffMax, current.writeOffMax, "no limit");
}

/** Whether an amount rose, where `empty` says what an empty amount means: the strictest or no limit. */
function higherAmount(next: string, current: string, empty: "every payment waits" | "no limit"): boolean {
  if (next === current) return false;
  if (empty === "no limit") {
    if (next === "") return true;
    if (current === "") return false;
  } else {
    if (current === "") return next !== "";
    if (next === "") return false;
  }
  return dec(next).greaterThan(dec(current));
}
