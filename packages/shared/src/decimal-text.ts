import { dec } from "./money";

/**
 * A percent as a write takes it (sales.md rules 8 and 12; contracts.md retainage): up to three
 * digits and four decimals by value. Percents live in numeric(18,8) columns and the API answers
 * them at that scale ("50.00000000"), so a client that sends back what it received must be taken:
 * up to eight decimals may be written, but the places after the fourth may only be zeros, so no
 * value gets in that four decimals refused (STATUS B6). The caller checks the upper bound.
 */
export const PERCENT_TEXT = /^\d{1,3}(\.\d{1,4}0{0,4})?$/;

/** The longest text `PERCENT_TEXT` takes ("100.00000000"), where a percent input stops typing. */
export const PERCENT_TEXT_MAX = 12;

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
 * An exchange rate as a write takes it (blueprint p20 Currency; CLAUDE.md rule 8, rates are
 * numeric(18,8)): up to ten digits and eight decimals. No bare point, sign, exponent or space. The
 * caller checks it is above 0 (ADR 0059, part 2b).
 */
export const FX_RATE_TEXT = /^\d{1,10}(\.\d{1,8})?$/;

/** The longest text `FX_RATE_TEXT` takes ("9999999999.99999999"), where a rate input stops typing. */
export const FX_RATE_TEXT_MAX = 19;

/**
 * A sales tax rate in percent as a write takes it (ADR 0059, part 3a; STATUS B6): up to two digits
 * and four decimals by value, so below 100. Rule and county rates live in numeric(18,8) columns and
 * the API answers them at that scale ("8.81000000"), so up to eight decimals may be written, but the
 * places after the fourth may only be zeros, as PERCENT_TEXT. No bare point, sign, exponent or space.
 */
export const TAX_RATE_TEXT = /^\d{1,2}(\.\d{1,4}0{0,4})?$/;

/** The longest text `TAX_RATE_TEXT` takes ("99.99990000"), where a tax rate input stops typing. */
export const TAX_RATE_TEXT_MAX = 11;

/**
 * A quantity as a write takes it (CLAUDE.md rules 6 and 8: quantities are numeric(14,3)): up to ten
 * digits and three decimals, as such a column is answered ("18000.000"), so a client that sends back
 * what it read is taken. Transfer and count quantities (the inventory controller's `QUANTITY`) and a
 * location's floor area in sq ft (ADR 0059, part 4a, D11, D23). No bare point, sign, exponent or
 * space. Blank is the caller's to decide.
 */
export const QUANTITY_TEXT = /^\d{1,10}(\.\d{1,3})?$/;

/** The longest text `QUANTITY_TEXT` takes ("9999999999.999"), where a quantity input stops typing. */
export const QUANTITY_TEXT_MAX = 14;

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
