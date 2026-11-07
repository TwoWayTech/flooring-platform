import { dec, type DecimalInput } from "./money";

/** Kinds of numbers with their own display decimals (blueprint "Number display and decimal places"). */
export type NumberKind = "money" | "unitCost" | "quantity" | "count" | "percent" | "taxRate" | "fxRate";

/** Defaults and allowed ranges per kind, straight from the blueprint table. */
export const NUMBER_KINDS: Record<
  NumberKind,
  { label: string; default: number; min: number; max: number; example: number }
> = {
  money: { label: "Money (prices, totals, balances)", default: 2, min: 0, max: 4, example: 12480.5 },
  unitCost: { label: "Unit cost", default: 4, min: 0, max: 4, example: 1.8725 },
  quantity: { label: "Quantity (area, length)", default: 2, min: 0, max: 3, example: 1250.75 },
  count: { label: "Count (rolls, cartons, items)", default: 0, min: 0, max: 3, example: 42 },
  percent: { label: "Percentage (margin, discount)", default: 1, min: 0, max: 4, example: 38.4 },
  taxRate: { label: "Tax rate", default: 3, min: 0, max: 4, example: 8.875 },
  fxRate: { label: "Exchange rate", default: 4, min: 0, max: 6, example: 1.0842 },
};

/** A company's number display settings. Display only: they never change a stored value or a total. */
export interface NumberSettings {
  decimals: Record<NumberKind, number>;
  negativeStyle: "minus" | "parens";
  compactDashboards: boolean;
  locale: string;
  currency: string;
}

/** The default settings for a US company. */
export function defaultNumberSettings(): NumberSettings {
  const decimals = Object.fromEntries(Object.entries(NUMBER_KINDS).map(([k, v]) => [k, v.default])) as Record<
    NumberKind,
    number
  >;
  return { decimals, negativeStyle: "minus", compactDashboards: true, locale: "en-US", currency: "USD" };
}

/** Per-call display options. */
export interface FormatOptions {
  /** Abbreviate large numbers (12.4K). */
  compact?: boolean;
  /** Per-column "More decimals / Fewer decimals" adjustment, added to the kind's setting. */
  decimalsDelta?: number;
  /** Override the decimals entirely (used for the full-value tooltip). */
  decimals?: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Decimals the kind should show after the user's per-column adjustment, kept inside the allowed range. */
export function displayDecimals(kind: NumberKind, settings: NumberSettings, delta = 0): number {
  const range = NUMBER_KINDS[kind];
  return clamp(settings.decimals[kind] + delta, range.min, range.max);
}

/**
 * Formats a number for display on Intl.NumberFormat. Values may be Decimal or numeric strings,
 * so full precision reaches the formatter (Intl accepts exact decimal strings).
 */
export function formatNumber(
  value: DecimalInput,
  kind: NumberKind,
  settings: NumberSettings,
  options: FormatOptions = {},
): string {
  const d = dec(value);
  const digits = options.decimals ?? displayDecimals(kind, settings, options.decimalsDelta);
  // A value that rounds to zero at the shown precision is displayed without a sign.
  const negative = d.isNegative() && !d.abs().toDecimalPlaces(digits).isZero();
  const abs = d.abs().toString();
  const fmt = new Intl.NumberFormat(settings.locale, {
    style: kind === "money" || kind === "unitCost" ? "currency" : "decimal",
    currency: settings.currency,
    minimumFractionDigits: options.compact ? 0 : digits,
    maximumFractionDigits: options.compact ? 1 : digits,
    notation: options.compact ? "compact" : "standard",
    roundingMode: "halfExpand",
  } as Intl.NumberFormatOptions);
  // Intl accepts exact decimal strings at runtime (ES2023); the lib typing lags behind.
  let text = fmt.format(abs as unknown as number);
  if (kind === "percent" || kind === "taxRate") text = `${text}%`;
  if (!negative) return text;
  return settings.negativeStyle === "parens" ? `(${text})` : `-${text}`;
}

/** The full stored value with every significant decimal, for the hover tooltip on rounded numbers. */
export function formatFull(value: DecimalInput, kind: NumberKind, settings: NumberSettings): string {
  const d = dec(value);
  const places = Math.max(d.decimalPlaces(), displayDecimals(kind, settings));
  return formatNumber(value, kind, settings, { decimals: Math.min(places, 20) });
}

/** Whether display rounding hides digits, so the UI knows to offer the full value on hover. */
export function isRounded(value: DecimalInput, kind: NumberKind, settings: NumberSettings, delta = 0): boolean {
  return dec(value).decimalPlaces() > displayDecimals(kind, settings, delta);
}
