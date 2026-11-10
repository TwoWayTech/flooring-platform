import { dec, marginPct, moneyString, roundMoney, sum, type Dec } from "./money";
import { daysBetween } from "./dates";
import { countsAsCost } from "./expenses";
import { lineAmount } from "./documents";
import { rollAreaSqFt } from "./units";
import type { InvoiceLedger } from "./ledger";
import type { BillLedger } from "./operations/purchasing";
import type { Bill, Expense, Invoice, InvoiceAdjustment, Job, Payment, Product, Refund, Roll } from "./types";

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

/** The bucket a due date falls in today; a balance held until installation is current. */
export function agingBucket(dueAt: string | null, today: string): AgingKey {
  if (!dueAt) return "current";
  const late = daysBetween(dueAt, today);
  return AGING_BUCKETS.find((b) => late >= b.min && late <= b.max)!.key;
}

/** A document that is owed: its due date and what is still open on it. */
export interface OpenAmount {
  /** Null while the balance waits for installation (spec B6). */
  dueAt: string | null;
  balance: string;
}

/** Sums open balances per aging bucket. The buckets always add up to total open receivables. */
export function agingSummary(docs: readonly OpenAmount[], today: string): Record<AgingKey, string> & { total: string } {
  const totals: Record<AgingKey, Dec> = { current: dec(0), d30: dec(0), d60: dec(0), d90: dec(0), d90plus: dec(0) };
  for (const doc of docs) {
    const open = dec(doc.balance);
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

/** Open invoices: a balance remains on their ledger (void invoices and returns owe nothing). */
export function openInvoices(invoices: readonly Invoice[], ledgers: ReadonlyMap<string, InvoiceLedger>): Invoice[] {
  return invoices.filter((i) => dec(ledgers.get(i.id)?.balance ?? "0").gt(0));
}

/** What each open invoice still owes and when it was due, for aging (spec B5, Reports). */
export function openAmounts(invoices: readonly Invoice[], ledgers: ReadonlyMap<string, InvoiceLedger>): OpenAmount[] {
  return openInvoices(invoices, ledgers).map((i) => ({ dueAt: i.dueAt, balance: ledgers.get(i.id)!.balance }));
}

/** What each open bill still owes and when it is due, for payables aging (spec D3). */
export function openBillAmounts(bills: readonly Bill[], ledgers: ReadonlyMap<string, BillLedger>): OpenAmount[] {
  return bills
    .filter((b) => dec(ledgers.get(b.id)?.balance ?? "0").gt(0))
    .map((b) => ({ dueAt: b.dueAt, balance: ledgers.get(b.id)!.balance }));
}

/** Value of one roll on hand: remaining area × its own cost (blueprint "Costing": each roll carries its own cost). */
export function rollValue(roll: Roll): Dec {
  return rollAreaSqFt(roll.widthFt, roll.remainingLengthFt).times(roll.costPerSqFt);
}

/** Boxed stock on hand per product id, from the stock ledger (stock.ts `boxedStock`). */
export type BoxedStock = ReadonlyMap<string, Dec>;

/**
 * Inventory valuation (spec section 4): rolls remaining × their cost plus boxed quantity × average
 * cost. Boxed goods use weighted average cost, stored as the product cost; their quantities come
 * from the stock ledger.
 */
export function inventoryValuation(
  rolls: readonly Roll[],
  products: readonly Product[],
  boxed: BoxedStock,
): { rolls: string; boxed: string; total: string } {
  const rollTotal = sum(rolls.map(rollValue));
  const boxedTotal = sum(products.map((p) => (boxed.get(p.id) ?? dec(0)).times(p.cost)));
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
    const inMonth = invoices.filter((i) => !i.voidedAt && i.issuedAt.startsWith(month));
    const revenue = sum(inMonth.map(signedSubtotal));
    const cogs = sum(inMonth.map(signedCost));
    const opex = sum(expenses.filter((e) => countsAsCost(e) && e.date.startsWith(month)).map((e) => e.amount));
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

/** A product's sales over a period, from invoice lines. */
export interface ProductSales {
  productId: string;
  revenue: string;
  quantity: string;
}

/**
 * Best sellers (spec "Dashboard"): material revenue per product from invoices issued on or after
 * `since`, returns subtracted, highest first. Services are left out; they are not stock.
 */
export function bestSellers(invoices: readonly Invoice[], since: string, limit: number): ProductSales[] {
  const totals = new Map<string, { revenue: Dec; quantity: Dec }>();
  for (const inv of invoices) {
    if (inv.voidedAt || inv.issuedAt < since) continue;
    const sign = inv.isReturn ? -1 : 1;
    for (const line of inv.lines) {
      if (line.category !== "material" || !line.productId) continue;
      const t = totals.get(line.productId) ?? { revenue: dec(0), quantity: dec(0) };
      const amount = lineAmount(line).times(sign);
      totals.set(line.productId, {
        revenue: t.revenue.plus(amount),
        quantity: t.quantity.plus(dec(line.quantity).times(sign)),
      });
    }
  }
  return [...totals.entries()]
    .sort(([, a], [, b]) => b.revenue.comparedTo(a.revenue))
    .slice(0, limit)
    .map(([productId, t]) => ({ productId, revenue: moneyString(t.revenue), quantity: t.quantity.toString() }));
}

/** A stocked product that has not sold for a while. */
export interface SlowMover {
  productId: string;
  lastSoldAt: string | null;
  daysWithoutSale: number;
  /** Stock on hand in the product's stock unit: sq ft or each for boxed goods, ft for rolls. */
  onHand: string;
  onHandUnit: "sq_ft" | "each" | "ft";
}

/**
 * Slow movers (spec "Dashboard"): stocked products ranked by days since their last sale, or
 * since they were added when they never sold. Quantities only, so no cost is exposed.
 */
export function slowMovers(
  products: readonly Product[],
  rolls: readonly Roll[],
  invoices: readonly Invoice[],
  today: string,
  limit: number,
  boxed: BoxedStock,
): SlowMover[] {
  const lastSale = new Map<string, string>();
  for (const inv of invoices) {
    if (inv.isReturn || inv.voidedAt) continue;
    for (const line of inv.lines) {
      if (line.productId && (lastSale.get(line.productId) ?? "") < inv.issuedAt)
        lastSale.set(line.productId, inv.issuedAt);
    }
  }
  const rollFeet = new Map<string, Dec>();
  for (const roll of rolls)
    rollFeet.set(roll.productId, (rollFeet.get(roll.productId) ?? dec(0)).plus(roll.remainingLengthFt));
  return products
    .filter((p) => p.category !== "service")
    .map((p) => {
      const feet = rollFeet.get(p.id);
      const onHand = feet ?? boxed.get(p.id) ?? dec(0);
      const sold = lastSale.get(p.id) ?? null;
      return {
        productId: p.id,
        lastSoldAt: sold,
        daysWithoutSale: daysBetween(sold ?? p.createdAt, today),
        onHand: onHand.toString(),
        onHandUnit: (feet ? "ft" : p.unit === "each" ? "each" : "sq_ft") as SlowMover["onHandUnit"],
      };
    })
    .filter((m) => dec(m.onHand).gt(0))
    .sort((a, b) => b.daysWithoutSale - a.daysWithoutSale)
    .slice(0, limit);
}

/** One line of a customer statement. Amounts are signed: invoices add, payments subtract. */
export interface StatementLine {
  date: string;
  kind: "invoice" | "credit" | "payment" | "write_off" | "refund";
  reference: string;
  amount: string;
  balance: string;
}

/** The records a customer statement reads. */
export interface StatementDocs {
  invoices: readonly Invoice[];
  payments: readonly Payment[];
  adjustments: readonly InvoiceAdjustment[];
  refunds: readonly Refund[];
}

/**
 * A customer statement (spec "Customers and receivables", Appendix A): invoices, confirmed
 * payments, write-offs, credit notes and refunds in date order with a running balance. It closes
 * at the customer's open balances minus their credit. Credit applied to an invoice only moves
 * credit the statement already shows, so it is not a line of its own; credit notes refunded on
 * the spot change nothing and are left out.
 */
export function customerStatement(docs: StatementDocs, customerId: string): StatementLine[] {
  const own = docs.invoices.filter((i) => i.customerId === customerId && !i.voidedAt);
  const numberOf = (invoiceId: string) => docs.invoices.find((i) => i.id === invoiceId)?.number ?? "";
  const events: { date: string; kind: StatementLine["kind"]; reference: string; amount: Dec }[] = [
    ...own
      .filter((i) => !i.isReturn)
      .map((i) => ({ date: i.issuedAt, kind: "invoice" as const, reference: i.number, amount: dec(i.total) })),
    ...own
      .filter((i) => i.isReturn && !i.refundedAt)
      .map((i) => ({ date: i.issuedAt, kind: "credit" as const, reference: i.number, amount: dec(i.total).negated() })),
    ...docs.payments
      .filter((p) => p.customerId === customerId && p.status === "confirmed")
      .map((p) => ({
        date: p.date,
        kind: "payment" as const,
        reference: `${p.number} for ${numberOf(p.invoiceId)}`,
        amount: dec(p.amount).negated(),
      })),
    ...docs.adjustments
      .filter((a) => a.customerId === customerId && a.kind === "write_off")
      .map((a) => ({
        date: a.at.slice(0, 10),
        kind: "write_off" as const,
        reference: numberOf(a.invoiceId),
        amount: dec(a.amount).negated(),
      })),
    ...docs.refunds
      .filter((r) => r.customerId === customerId && r.status === "completed")
      .map((r) => ({ date: r.date, kind: "refund" as const, reference: r.number, amount: dec(r.amount) })),
  ].sort((a, b) => a.date.localeCompare(b.date) || STATEMENT_ORDER[a.kind] - STATEMENT_ORDER[b.kind]);
  let running = dec(0);
  return events.map((e) => {
    running = running.plus(e.amount);
    return {
      date: e.date,
      kind: e.kind,
      reference: e.reference,
      amount: moneyString(e.amount),
      balance: moneyString(running),
    };
  });
}

/** On the same day, what was billed comes before what settled it. */
const STATEMENT_ORDER: Record<StatementLine["kind"], number> = {
  invoice: 0,
  credit: 1,
  payment: 2,
  write_off: 3,
  refund: 4,
};

/** What an installation job cost and earned. */
export interface JobCosting {
  materials: string;
  labor: string;
  cost: string;
  revenue: string;
  margin: string;
  marginPct: string;
}

/**
 * Job costing (spec "Installation": materials, labor, margin): materials at cost plus labor,
 * against the job's revenue. Margin is shown only with installation.job.view_sensitive.
 */
export function jobCosting(job: Pick<Job, "materials" | "laborCost" | "revenue">): JobCosting {
  const materials = sum(job.materials.map((m) => m.cost));
  const cost = materials.plus(job.laborCost);
  return {
    materials: moneyString(materials),
    labor: moneyString(job.laborCost),
    cost: moneyString(cost),
    revenue: moneyString(job.revenue),
    margin: moneyString(dec(job.revenue).minus(cost)),
    marginPct: marginPct(job.revenue, cost).toString(),
  };
}

/** Sales of one product category over a period. */
export interface CategorySales {
  category: string;
  revenue: string;
  cost: string;
  margin: string;
}

/**
 * Sales by category (spec "Reports hub"): line amounts and costs grouped by product category,
 * returns subtracted. Services group under their tax category (labor, freight, service).
 */
export function salesByCategory(invoices: readonly Invoice[], products: readonly Product[]): CategorySales[] {
  const groups = new Map<string, { revenue: Dec; cost: Dec }>();
  for (const inv of invoices) {
    if (inv.voidedAt) continue;
    const sign = inv.isReturn ? -1 : 1;
    for (const line of inv.lines) {
      const product = products.find((p) => p.id === line.productId);
      const key = product && product.category !== "service" ? product.category : line.category;
      const g = groups.get(key) ?? { revenue: dec(0), cost: dec(0) };
      groups.set(key, {
        revenue: g.revenue.plus(lineAmount(line).times(sign)),
        cost: g.cost.plus(roundMoney(dec(line.quantity).times(line.unitCost)).times(sign)),
      });
    }
  }
  return [...groups.entries()]
    .map(([category, g]) => ({
      category,
      revenue: moneyString(g.revenue),
      cost: moneyString(g.cost),
      margin: moneyString(g.revenue.minus(g.cost)),
    }))
    .sort((a, b) => Number(b.revenue) - Number(a.revenue));
}

/** Sales tax collected in one jurisdiction, with taxable and exempt sales (blueprint "Sales tax reports"). */
export interface TaxJurisdictionRow {
  state: string;
  jurisdiction: string;
  ratePct: string;
  sales: string;
  exemptSales: string;
  tax: string;
}

/**
 * Sales tax by jurisdiction: each invoice stores the rule it used, so the report reads the
 * stored jurisdiction and tax, never today's rules. Returns reduce what was collected.
 */
export function salesTaxByJurisdiction(invoices: readonly Invoice[]): TaxJurisdictionRow[] {
  const rows = new Map<
    string,
    { state: string; jurisdiction: string; ratePct: string; sales: Dec; exempt: Dec; tax: Dec }
  >();
  for (const inv of invoices) {
    if (inv.voidedAt) continue;
    const sign = inv.isReturn ? -1 : 1;
    const key = inv.taxRule ? `${inv.taxRule.state}|${inv.taxRule.jurisdiction}` : `${inv.jobSite.state}|Not collected`;
    const r = rows.get(key) ?? {
      state: inv.taxRule?.state ?? inv.jobSite.state,
      jurisdiction: inv.taxRule?.jurisdiction ?? "Not collected",
      ratePct: inv.taxRule?.ratePct ?? "0",
      sales: dec(0),
      exempt: dec(0),
      tax: dec(0),
    };
    const subtotal = dec(inv.subtotal).times(sign);
    rows.set(key, {
      ...r,
      sales: r.sales.plus(subtotal),
      exempt: inv.taxExempt ? r.exempt.plus(subtotal) : r.exempt,
      tax: r.tax.plus(dec(inv.tax).times(sign)),
    });
  }
  return [...rows.values()]
    .map((r) => ({
      state: r.state,
      jurisdiction: r.jurisdiction,
      ratePct: r.ratePct,
      sales: moneyString(r.sales),
      exemptSales: moneyString(r.exempt),
      tax: moneyString(r.tax),
    }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

/** Stock value of one category. */
export interface CategoryValuation {
  category: string;
  value: string;
}

/**
 * Inventory valuation by category (spec section 4): rolls at remaining area × their own cost,
 * boxed goods at quantity × average cost. The categories add up to inventoryValuation's total.
 */
export function inventoryByCategory(
  products: readonly Product[],
  rolls: readonly Roll[],
  boxed: BoxedStock,
): CategoryValuation[] {
  const totals = new Map<string, Dec>();
  const add = (category: string, value: Dec) => totals.set(category, (totals.get(category) ?? dec(0)).plus(value));
  for (const roll of rolls) {
    const product = products.find((p) => p.id === roll.productId);
    if (product) add(product.category, rollValue(roll));
  }
  for (const p of products) {
    const onHand = boxed.get(p.id);
    if (onHand) add(p.category, onHand.times(p.cost));
  }
  return [...totals.entries()]
    .map(([category, v]) => ({ category, value: moneyString(v) }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}
