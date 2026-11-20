import { QUANTITY_TEXT } from "../decimal-text";
import { dec } from "../money";
import type { InventorySettings } from "../types/settings";

/** What Stock rules says about the approval quantity it refuses, the same words in both modes. */
export const STOCK_RULES_MESSAGES = {
  adjustmentApprovalQty: "Enter the approval quantity as a number such as 50, or leave it empty.",
} as const;

/** What anyone but an Owner is told when a Stock rules save would loosen the approval (ADR 0059, Stock rules part, D4). */
export const STOCK_RULES_OWNER_ONLY =
  "Only an Owner can raise or clear the quantity above which adjustments need approval.";

/**
 * The approval quantity of a section as read: a stored row may be anything jsonb holds (`null`, a
 * number, an object without the field), so it is read without trusting its shape (security review
 * round 1); anything but a string is malformed.
 */
function quantityOf(section: unknown): unknown {
  return typeof section === "object" && section !== null
    ? (section as Partial<InventorySettings>).adjustmentApprovalQty
    : undefined;
}

/**
 * Why Stock rules can't be saved, or null (inventory.md "InventorySettings"; ADR 0059, Stock rules
 * part, D3): the approval quantity is empty (no adjustment waits) or a plain quantity as a quantity
 * column takes it (`QUANTITY_TEXT`), so nothing malformed reaches decimal.js when adjustments
 * compare with it (`adjustmentNeedsApproval`; CLAUDE.md rule 6). Stored as sent. A value of any
 * other shape, `null` included, is refused with the same words and never throws.
 */
export function inventorySettingsProblem(inventory: InventorySettings): string | null {
  const quantity = quantityOf(inventory);
  if (typeof quantity !== "string" || (quantity !== "" && !QUANTITY_TEXT.test(quantity)))
    return STOCK_RULES_MESSAGES.adjustmentApprovalQty;
  return null;
}

/**
 * Whether a Stock rules save loosens the two-person check on stock adjustments, which only an Owner
 * may do, with a step-up (ADR 0059, Stock rules part, D4; the owner's answer to PR #51 Q10 for
 * payment controls, applied to stock): an adjustment larger than the quantity waits for a second
 * person, so a higher quantity lets larger changes through alone, and an empty one lets every change
 * through. A lower quantity, or one where there was none, tightens. `next` has passed
 * `inventorySettingsProblem`; `current` is the stored section or the never-saved answer (the
 * strictest). A stored section the rule would refuse (a malformed quantity, no quantity, `null`)
 * can't be compared, so any change to it counts as loosening (the safest reading).
 */
export function stockRulesLoosened(next: InventorySettings, current: InventorySettings): boolean {
  const to = next.adjustmentApprovalQty;
  const from = quantityOf(current);
  if (to === from) return false;
  if (typeof from !== "string" || inventorySettingsProblem(current) !== null) return true;
  if (from === "") return false;
  if (to === "") return true;
  return dec(to).greaterThan(dec(from));
}
