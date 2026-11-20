import { dec } from "./money";

/**
 * A percent as a write takes it (sales.md rules 8 and 12; contracts.md retainage): up to three
 * digits and four decimals by value. Percents live in numeric(18,8) columns and the API answers
 * them at that scale ("50.00000000"), so a client that sends back what it received must be taken:
 * up to eight decimals may be written, but the places after the fourth may only be zeros, so no
 * value gets in that four decimals refused (STATUS B6). The caller checks the upper bound.
 */
export const PERCENT_TEXT = /^\d{1,3}(\.\d{1,4}0{0,4})?$/;

/**
 * A commission share as a write takes it (sales.md rule 39): up to three digits and two decimals
 * by value, written with up to eight, as `invoice_commission_splits.pct` (numeric(18,8)) is
 * answered (STATUS B6).
 */
export const SHARE_PERCENT_TEXT = /^\d{1,3}(\.\d{1,2}0{0,6})?$/;

/**
 * Plain unsigned money as a settings amount takes it (ADR 0059): up to twelve digits and at most
 * two decimals, the same as the purchasing and invoices controllers' `MONEY`, whose copies move here
 * in a sweep. No bare point ("12.", ".5"), sign, exponent, separator or space.
 */
export const MONEY_TEXT = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Plain decimal text: digits with an optional fraction. No sign, exponent, radix prefix ("0x0a"),
 * bare point ("10.", ".5") or space, all of which decimal.js would otherwise read as a number.
 */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/** Whether an optional decimal string is blank: absent, null or "". */
function isBlank(value: string | null | undefined): value is null | undefined | "" {
  return value === undefined || value === null || value === "";
}

/**
 * Whether two optional decimal strings hold the same number. A column comes back at its scale
 * ("10.00000000") while people type "10", so a check that asks "did this change?" compares values,
 * never text (api-contract "Bodies"; STATUS B6). Blank matches only blank. Anything but plain
 * unsigned decimal text matches nothing, so a permission check built on it fails closed.
 */
export function sameOptionalDecimal(a: string | null | undefined, b: string | null | undefined): boolean {
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
  return PLAIN_DECIMAL.test(a) && PLAIN_DECIMAL.test(b) && dec(a).eq(dec(b));
}
