import { addDays, daysBetween } from "./dates";
import { lineAmount } from "./documents";
import { dec, marginPct, moneyString, roundMoney, sum, type Dec } from "./money";
import type { Invoice, Product } from "./types";

/** The dashboard's one period selector (spec E1). */
export type DashboardPeriod = "month" | "30d" | "quarter" | "ytd" | "custom";

/** Words for each period. */
export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  month: "This month",
  "30d": "Last 30 days",
  quarter: "This quarter",
  ytd: "Year to date",
  custom: "Custom",
};

/** A date range and the range of the same length just before it, for "change vs previous period". */
export interface PeriodRange {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

/** The dates a period covers on a day, inclusive, with the previous period of the same length. */
export function periodRange(
  period: DashboardPeriod,
  today: string,
  custom?: { from: string; to: string },
): PeriodRange {
  const [y, m] = today.split("-").map(Number) as [number, number];
  let from: string;
  let to = today;
  if (period === "month") from = `${today.slice(0, 7)}-01`;
  else if (period === "30d") from = addDays(today, -29);
  else if (period === "quarter") from = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  else if (period === "ytd") from = `${y}-01-01`;
  else {
    from = custom?.from ?? addDays(today, -29);
    to = custom?.to ?? today;
  }
  const days = daysBetween(from, to) + 1;
  return { from, to, prevFrom: addDays(from, -days), prevTo: addDays(from, -1) };
}

const inRange = (iso: string, from: string, to: string) => iso >= from && iso <= to;

/** Invoices issued in a range at a warehouse (or all), returns netted, voids left out. */
export function invoicesIn(invoices: readonly Invoice[], from: string, to: string, locationId?: string | null) {
  return invoices.filter(
    (i) => !i.voidedAt && inRange(i.issuedAt, from, to) && (!locationId || i.locationId === locationId),
  );
}

/** Revenue (before tax), cost and margin of invoices; returns count against. */
export function salesTotals(invoices: readonly Invoice[]) {
  const sign = (i: Invoice) => (i.isReturn ? -1 : 1);
  const revenue = sum(invoices.map((i) => dec(i.subtotal).times(sign(i))));
  const cost = sum(invoices.map((i) => dec(i.cost).times(sign(i))));
  return {
    revenue: moneyString(revenue),
    cost: moneyString(cost),
    margin: moneyString(revenue.minus(cost)),
    marginPct: marginPct(revenue, cost).toString(),
    count: invoices.filter((i) => !i.isReturn).length,
  };
}

/** Change from the previous period as a percent, or null when there is nothing to compare with. */
export function changePct(now: string, before: string): string | null {
  const prev = dec(before);
  if (prev.isZero()) return null;
  return dec(now).minus(prev).div(prev.abs()).times(100).toDecimalPlaces(1).toString();
}

/**
 * A short series for a card's sparkline (spec E1): the period split into up to 12 equal buckets,
 * each the sum of a value over the documents dated in it.
 */
export function sparkSeries<T>(
  docs: readonly T[],
  dateOf: (d: T) => string,
  valueOf: (d: T) => Dec,
  from: string,
  to: string,
): number[] {
  const days = daysBetween(from, to) + 1;
  const buckets = Math.min(12, days);
  const size = days / buckets;
  const out = Array.from({ length: buckets }, () => dec(0));
  for (const d of docs) {
    const at = dateOf(d);
    if (!inRange(at, from, to)) continue;
    const i = Math.min(buckets - 1, Math.floor(daysBetween(from, at) / size));
    out[i] = out[i]!.plus(valueOf(d));
  }
  return out.map((v) => v.toNumber());
}

/** What best sellers rank by (spec E1). */
export type SellerMetric = "revenue" | "quantity" | "margin";

/** One best seller with all three measures. */
export interface SellerRow {
  productId: string;
  revenue: string;
  quantity: string;
  margin: string;
}

/**
 * Best sellers over any range (spec E1): material lines by product, returns subtracted, ranked
 * by revenue, quantity or margin, optionally one category and one warehouse.
 */
export function bestSellersIn(
  invoices: readonly Invoice[],
  products: readonly Product[],
  options: {
    from: string;
    to: string;
    metric: SellerMetric;
    category?: string | null;
    locationId?: string | null;
    limit: number;
  },
): SellerRow[] {
  const totals = new Map<string, { revenue: Dec; quantity: Dec; margin: Dec }>();
  for (const inv of invoicesIn(invoices, options.from, options.to, options.locationId)) {
    const sign = inv.isReturn ? -1 : 1;
    for (const line of inv.lines) {
      if (line.category !== "material" || !line.productId) continue;
      const product = products.find((p) => p.id === line.productId);
      if (options.category && product?.category !== options.category) continue;
      const t = totals.get(line.productId) ?? { revenue: dec(0), quantity: dec(0), margin: dec(0) };
      const amount = lineAmount(line).times(sign);
      const cost = roundMoney(dec(line.quantity).times(line.unitCost)).times(sign);
      totals.set(line.productId, {
        revenue: t.revenue.plus(amount),
        quantity: t.quantity.plus(dec(line.quantity).times(sign)),
        margin: t.margin.plus(amount.minus(cost)),
      });
    }
  }
  return [...totals.entries()]
    .sort(([, a], [, b]) => b[options.metric].comparedTo(a[options.metric]))
    .slice(0, options.limit)
    .map(([productId, t]) => ({
      productId,
      revenue: moneyString(t.revenue),
      quantity: t.quantity.toString(),
      margin: moneyString(t.margin),
    }));
}
