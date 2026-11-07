import { dec, moneyString, sum, marginPct, type Dec } from "./money";
import { daysBetween } from "./dates";
import { rollAreaSqFt } from "./units";
import type { Bill, Expense, Invoice, Product, Roll } from "./types";

/** Open balance of an invoice or bill: total minus payments, never below zero for a sale. */
export function balance(doc: { total: string; paid: string }): Dec {
  return dec(doc.total).minus(doc.paid);
}

/** An invoice is overdue when it has a balance and its due date has passed (spec "Needs attention"). */
export function isOverdue(inv: Invoice, today: string): boolean {
  return inv.status !== "void" && !inv.isReturn && balance(inv).gt(0) && daysBetween(inv.dueAt, today) > 0;
}

/** Aging buckets by days past due (spec "Customers and receivables": current, 30, 60, 90+). */
export const AGING_BUCKETS = [
  { key: "current", label: "Current", min: -Infinity, max: 0 },
  { key: "d30", label: "1 to 30 days", min: 1, max: 30 },
  { key: "d60", label: "31 to 60 days", min: 31, max: 60 },
  { key: "d90", label: "61 to 90 days", min: 61, max: 90 },
  { key: "d90plus", label: "Over 90 days", min: 91, max: Infinity },
] as const;

/** Key of an aging bucket. */
export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

/** The bucket a due date falls in today. */
export function agingBucket(dueAt: string, today: string): AgingKey {
  const late = daysBetween(dueAt, today);
  return AGING_BUCKETS.find((b) => late >= b.min && late <= b.max)!.key;
}

/** Sums open balances per aging bucket. The buckets always add up to total open receivables. */
export function agingSummary(
  docs: readonly { dueAt: string; total: string; paid: string }[],
  today: string,
): Record<AgingKey, string> & { total: string } {
  const totals: Record<AgingKey, Dec> = { current: dec(0), d30: dec(0), d60: dec(0), d90: dec(0), d90plus: dec(0) };
  for (const doc of docs) {
    const open = balance(doc);
    if (open.lte(0)) continue;
    const key = agingBucket(doc.dueAt, today);
    totals[key] = totals[key].plus(open);
  }
  const out = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, moneyString(v)])) as Record<
    AgingKey,
    string
  >;
  return { ...out, total: moneyString(sum(Object.values(totals))) };
}

/** Open invoices: not void, not a return, with a balance. */
export function openInvoices(invoices: readonly Invoice[]): Invoice[] {
  return invoices.filter((i) => i.status !== "void" && !i.isReturn && balance(i).gt(0));
}

/** Open bills: balance above zero. */
export function openBills(bills: readonly Bill[]): Bill[] {
  return bills.filter((b) => balance(b).gt(0));
}

/** Value of one roll on hand: remaining area × its own cost (blueprint "Costing": each roll carries its own cost). */
export function rollValue(roll: Roll): Dec {
  return rollAreaSqFt(roll.widthFt, roll.remainingLengthFt).times(roll.costPerSqFt);
}

/**
 * Inventory valuation (spec section 4): rolls remaining × their cost plus cartons × average
 * cost. Boxed goods use weighted average cost, stored as the product cost.
 */
export function inventoryValuation(
  rolls: readonly Roll[],
  products: readonly Product[],
): { rolls: string; boxed: string; total: string } {
  const rollTotal = sum(rolls.map(rollValue));
  const boxedTotal = sum(
    products.filter((p) => p.cartonsOnHand !== undefined).map((p) => dec(p.cartonsOnHand ?? 0).times(p.cost)),
  );
  return {
    rolls: moneyString(rollTotal),
    boxed: moneyString(boxedTotal),
    total: moneyString(rollTotal.plus(boxedTotal)),
  };
}

/** One month of the P&L, computed from documents, never typed by hand (spec section 4). */
export interface PnlMonth {
  month: string;
  revenue: string;
  cogs: string;
  grossMargin: string;
  grossMarginPct: string;
  expenses: string;
  netIncome: string;
}

/** Signed revenue of an invoice: returns count against revenue. */
function signedSubtotal(inv: Invoice): Dec {
  return inv.isReturn ? dec(inv.subtotal).negated() : dec(inv.subtotal);
}

/** Signed cost of an invoice. */
function signedCost(inv: Invoice): Dec {
  return inv.isReturn ? dec(inv.cost).negated() : dec(inv.cost);
}

/** Monthly P&L for the given months (YYYY-MM), from invoices and expenses. */
export function monthlyPnl(
  months: readonly string[],
  invoices: readonly Invoice[],
  expenses: readonly Expense[],
): PnlMonth[] {
  return months.map((month) => {
    const inMonth = invoices.filter((i) => i.status !== "void" && i.issuedAt.startsWith(month));
    const revenue = sum(inMonth.map(signedSubtotal));
    const cogs = sum(inMonth.map(signedCost));
    const opex = sum(expenses.filter((e) => e.at.startsWith(month)).map((e) => e.amount));
    const gross = revenue.minus(cogs);
    return {
      month,
      revenue: moneyString(revenue),
      cogs: moneyString(cogs),
      grossMargin: moneyString(gross),
      grossMarginPct: marginPct(revenue, cogs).toString(),
      expenses: moneyString(opex),
      netIncome: moneyString(gross.minus(opex)),
    };
  });
}
