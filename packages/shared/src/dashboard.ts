import { signedCost, signedSubtotal } from "./analytics";
import { addDays, daysBetween } from "./dates";
import { lineAmount } from "./documents";
import { dec, marginPct, moneyString, roundMoney, sum, sumKnown, type Dec } from "./money";
import type { Invoice, Product, ViewedInvoice } from "./types";

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
export function invoicesIn<T extends Pick<Invoice, "voidedAt" | "issuedAt" | "locationId">>(
  invoices: readonly T[],
  from: string,
  to: string,
  locationId?: string | null,
): T[] {
  return invoices.filter(
    (i) => !i.voidedAt && inRange(i.issuedAt, from, to) && (!locationId || i.locationId === locationId),
  );
}

/** Revenue (before tax), cost and margin of a set of invoices (spec E1 figure cards). */
export interface SalesTotals {
  revenue: string;
  /**
   * null when an invoice arrived without its cost: never zero or a partial sum (CLAUDE.md rule 5;
   * ADR 0037, 2026-11-17).
   */
  cost: string | null;
  /**
   * null when an invoice arrived without its cost: never zero or a partial sum (CLAUDE.md rule 5;
   * ADR 0037, 2026-11-17).
   */
  margin: string | null;
  /**
   * null when an invoice arrived without its cost: never zero or a partial sum (CLAUDE.md rule 5;
   * ADR 0037, 2026-11-17).
   */
  marginPct: string | null;
  /** Invoices, returns left out. */
  count: number;
}

/** Revenue (before tax), cost and margin of invoices as received; returns count against. */
export function salesTotals(invoices: readonly Pick<ViewedInvoice, "isReturn" | "subtotal" | "cost">[]): SalesTotals {
  const revenue = sum(invoices.map(signedSubtotal));
  const cost = sumKnown(invoices.map(signedCost));
  return {
    revenue: moneyString(revenue),
    cost: cost === null ? null : moneyString(cost),
    margin: cost === null ? null : moneyString(revenue.minus(cost)),
    marginPct: cost === null ? null : marginPct(revenue, cost).toString(),
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

/**
 * The Gross margin card's sparkline (spec E1): signed subtotal less cost per bucket, or null when
 * any invoice it is given arrived without its cost, so an unknown is never drawn as zero (CLAUDE.md
 * rule 5; ADR 0037, 2026-11-17).
 */
export function marginSeries(
  invoices: readonly Pick<ViewedInvoice, "issuedAt" | "isReturn" | "subtotal" | "cost">[],
  from: string,
  to: string,
): number[] | null {
  const points: { at: string; margin: Dec }[] = [];
  for (const invoice of invoices) {
    const cost = signedCost(invoice);
    if (cost === null) return null;
    points.push({ at: invoice.issuedAt, margin: signedSubtotal(invoice).minus(cost) });
  }
  return sparkSeries(
    points,
    (p) => p.at,
    (p) => p.margin,
    from,
    to,
  );
}

/** What best sellers rank by (spec E1). */
export type SellerMetric = "revenue" | "quantity" | "margin";

/** One best seller with all three measures. */
export interface SellerRow {
  productId: string;
  /**
   * The product's catalog name, or the line's own description when the catalog the viewer read
   * doesn't hold it, so a row always names what it sold (click-through #1, 2026-11-21).
   */
  name: string;
  revenue: string;
  quantity: string;
  /**
   * null for every row when a counted line arrived without its cost, since rows rank against each
   * other: never zero or a partial sum (CLAUDE.md rule 5; ADR 0037, 2026-11-17).
   */
  margin: string | null;
}

/** A product's running totals; margin turns unknown at its first line without cost. */
interface SellerTotals {
  name: string;
  revenue: Dec;
  quantity: Dec;
  margin: Dec | null;
}

/**
 * Best sellers over any range (spec E1): material lines by product, returns subtracted, ranked
 * by revenue, quantity or margin, optionally one category and one warehouse. Margin can't rank what
 * isn't known: when a counted line arrived without its cost, every row's margin is null and a margin
 * ranking falls back to revenue (rule 5; ADR 0037, 2026-11-17). A contract invoice's lines carry no
 * product, so they are never counted. Each row is named from the catalog, or from its first line's
 * description when the catalog doesn't hold the product.
 */
export function bestSellersIn(
  invoices: readonly ViewedInvoice[],
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
  const totals = new Map<string, SellerTotals>();
  for (const inv of invoicesIn(invoices, options.from, options.to, options.locationId)) {
    const sign = inv.isReturn ? -1 : 1;
    for (const line of inv.lines) {
      if (line.category !== "material" || !line.productId) continue;
      const product = products.find((p) => p.id === line.productId);
      if (options.category && product?.category !== options.category) continue;
      const t = totals.get(line.productId) ?? {
        name: product?.name ?? line.description,
        revenue: dec(0),
        quantity: dec(0),
        margin: dec(0),
      };
      const amount = lineAmount(line).times(sign);
      const unitCost = line.unitCost ?? null;
      const cost = unitCost === null ? null : roundMoney(dec(line.quantity).times(unitCost)).times(sign);
      totals.set(line.productId, {
        name: t.name,
        revenue: t.revenue.plus(amount),
        quantity: t.quantity.plus(dec(line.quantity).times(sign)),
        margin: t.margin === null || cost === null ? null : t.margin.plus(amount.minus(cost)),
      });
    }
  }
  // Rows rank against each other, so one unknown margin makes them all unknown (D1).
  const costKnown = [...totals.values()].every((t) => t.margin !== null);
  const rankBy: SellerMetric = options.metric === "margin" && !costKnown ? "revenue" : options.metric;
  // With every cost known a margin is never null; the check only narrows the type.
  const rankOf = (t: SellerTotals): Dec =>
    rankBy === "margin" && t.margin !== null ? t.margin : rankBy === "quantity" ? t.quantity : t.revenue;
  return [...totals.entries()]
    .sort(([, a], [, b]) => rankOf(b).comparedTo(rankOf(a)))
    .slice(0, options.limit)
    .map(([productId, t]) => ({
      productId,
      name: t.name,
      revenue: moneyString(t.revenue),
      quantity: t.quantity.toString(),
      margin: !costKnown || t.margin === null ? null : moneyString(t.margin),
    }));
}
