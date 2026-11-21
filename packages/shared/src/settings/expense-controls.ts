import type { ExpenseSettings } from "../types/settings";
import { approvalCheckLoosened } from "./payment-controls";
import { expenseSettingsProblem } from "./section-rules";

/** What anyone but an Owner is told when an Expense approval save would loosen it (ADR 0061 decision 6, ADR 0063). */
export const EXPENSE_APPROVAL_OWNER_ONLY =
  "Only an Owner can switch off expense approval or raise the expense approval amount.";

/**
 * Whether an Expense approval save loosens the two-person check on expenses, which only an Owner may
 * do, with a step-up (owner's decision 6 of 2026-11-21, ADR 0061; ADR 0063), by Payments' rule for
 * its check (`approvalCheckLoosened`): switching it off, or raising its amount while it is on (empty
 * means every expense waits, so an amount where there was none is looser). Keeping or tightening it
 * needs only the key. `next` has passed `expenseSettingsProblem`; `current` is the stored section or,
 * when never saved, approval off, which is how expenses read a missing row. A stored section the rule
 * would refuse (or `null`) can't be compared, so any change to it counts as loosening, the safest
 * reading, as Stock rules does.
 */
export function expenseApprovalLoosened(next: ExpenseSettings, current: ExpenseSettings | null): boolean {
  if (
    current !== null &&
    typeof current === "object" &&
    next.approvalRequired === current.approvalRequired &&
    next.approvalThreshold === current.approvalThreshold
  )
    return false;
  if (current === null || typeof current !== "object" || expenseSettingsProblem(current) !== null) return true;
  return approvalCheckLoosened(next, current);
}
