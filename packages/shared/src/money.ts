import Decimal from "decimal.js";

/**
 * Money math runs on decimal.js, never JS floats (CLAUDE.md rule 3). Precision is wide
 * enough for numeric(18,8) rates; rounding is half-up as on US invoices.
 */
export const D = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/** A value decimal.js accepts: a Decimal, a numeric string or a number. */
export type DecimalInput = Decimal.Value;

/** A Decimal instance from the configured clone. */
export type Dec = InstanceType<typeof D>;

/** Wraps any numeric input as a Decimal. */
export function dec(value: DecimalInput): Dec {
  return new D(value);
}

/** Rounds to cents (money stored as numeric(14,2), blueprint "Number display"). */
export function roundMoney(value: DecimalInput): Dec {
  return dec(value).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

/** Rounds a unit cost to 4 places (numeric(14,4)). */
export function roundUnitCost(value: DecimalInput): Dec {
  return dec(value).toDecimalPlaces(4, D.ROUND_HALF_UP);
}

/** Sums a list of decimal inputs exactly. */
export function sum(values: readonly DecimalInput[]): Dec {
  return values.reduce<Dec>((acc, v) => acc.plus(v), dec(0));
}

/** Money as the canonical string stored in fixtures and the store, e.g. "1250.50". */
export function moneyString(value: DecimalInput): string {
  return roundMoney(value).toFixed(2);
}

/**
 * A quantity (hours, sq ft, ft, items) as a fixed three-place string, e.g. "16.000", the scale it is
 * stored at (numeric(14,3), blueprint table rules), so the API sends the same text for the same amount.
 */
export function quantityString(value: DecimalInput): string {
  return dec(value).toDecimalPlaces(3, D.ROUND_HALF_UP).toFixed(3);
}

/** Applies a percentage: `pct(200, "8.875")` is 17.75. Percentages are written as 8.875, not 0.08875. */
export function pctOf(value: DecimalInput, percent: DecimalInput): Dec {
  return dec(value).times(percent).dividedBy(100);
}

/** Margin percent from revenue and cost; zero revenue gives zero. */
export function marginPct(revenue: DecimalInput, cost: DecimalInput): Dec {
  const r = dec(revenue);
  if (r.isZero()) return dec(0);
  return r.minus(cost).dividedBy(r).times(100);
}

/** The smaller of two amounts, e.g. credit applied up to the balance. */
export function minDec(a: DecimalInput, b: DecimalInput): Dec {
  return D.min(dec(a), dec(b));
}

/** The larger of two amounts, e.g. a balance that never goes below zero. */
export function maxDec(a: DecimalInput, b: DecimalInput): Dec {
  return D.max(dec(a), dec(b));
}
