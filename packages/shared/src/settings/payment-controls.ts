import { dec } from "../money";
import type { PaymentSettings } from "../types/settings";

/** What anyone but an Owner is told when a Payments save would loosen a control (ADR 0059, "2026-11-20"). */
export const PAYMENT_CONTROLS_OWNER_ONLY =
  "Only an Owner can switch off payment approval, raise the approval amount or raise the write-off limit.";

/** A two-person check as Payments and Expense approval both store it (ADR 0023). */
export interface ApprovalCheck {
  approvalRequired: boolean;
  /** Plain money: at or below it skips the check, and empty means everything waits. */
  approvalThreshold: string;
}

/**
 * Whether a save loosens a two-person check (ADR 0059 "2026-11-20"; ADR 0063 applies it to
 * expenses): the check going from on to off, or its amount going up while the check is on.
 * Documents at or below the amount skip the check, and empty means everything waits, so an amount
 * appearing where there was none is looser too. While the check is off everything skips it, so its
 * amount loosens nothing, and switching it on with any amount tightens. Both amounts are plain money
 * (the section's content rule runs first) and are compared by value.
 */
export function approvalCheckLoosened(next: ApprovalCheck, current: ApprovalCheck): boolean {
  if (current.approvalRequired && !next.approvalRequired) return true;
  return (
    current.approvalRequired && higherAmount(next.approvalThreshold, current.approvalThreshold, "everything waits")
  );
}

/**
 * Whether a Payments save loosens a fraud control, which only an Owner may do (owner's answer to
 * PR #51 Q10, ADR 0059 "2026-11-20"): the person who records and approves payments must not be able
 * to switch off the check they work under. Loosening is the two-person check loosening
 * (`approvalCheckLoosened`), or the write-off limit going up, or going empty, which means no limit.
 * `current` is the stored section, or the never-saved answer (the strictest).
 */
export function paymentControlsLoosened(next: PaymentSettings, current: PaymentSettings): boolean {
  if (approvalCheckLoosened(next, current)) return true;
  return higherAmount(next.writeOffMax, current.writeOffMax, "no limit");
}

/** Whether an amount rose, where `empty` says what an empty amount means: the strictest or no limit. */
function higherAmount(next: string, current: string, empty: "everything waits" | "no limit"): boolean {
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
