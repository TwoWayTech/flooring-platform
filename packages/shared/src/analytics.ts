import { dec, marginPct, moneyString, roundMoney, sum, sumKnown, type Dec } from "./money";
import { salesLines, type SalesLine } from "./sales-lines";
import { daysBetween } from "./dates";
import { countsAsCost } from "./expenses";
import { lineAmount } from "./documents";
import { rollAreaSqFt } from "./units";
import { boxedStock } from "./stock";
import type { InvoiceLedger } from "./ledger";
import type { BillLedger } from "./operations/purchasing";
import type {
  Bill,
  Expense,
  Invoice,
  InvoiceAdjustment,
  Job,
  Payment,
  Product,
  Refund,
  Roll,
  StockMovement,
  ViewedInvoice,
} from "./types";

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
export function rollValue(roll: Pick<Roll, "widthFt" | "remainingLengthFt" | "costPerSqFt">): Dec {
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
  rolls: readonly Pick<Roll, "widthFt" | "remainingLengthFt" | "costPerSqFt">[],
  products: readonly Pick<Product, "id" | "cost">[],
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
  /**
   * null when an invoice of the month arrived without its cost: never zero or a partial sum
   * (CLAUDE.md rule 5; ADR 0037, 2026-11-17).
   */
  cogs: string | null;
  /**
   * null when an invoice of the month arrived without its cost: never zero or a partial sum
   * (CLAUDE.md rule 5; ADR 0037, 2026-11-17).
   */
  grossMargin: string | null;
  /**
   * null when an invoice of the month arrived without its cost: never zero or a partial sum
   * (CLAUDE.md rule 5; ADR 0037, 2026-11-17).
   */
  grossMarginPct: string | null;
  expenses: string;
  /**
   * null when an invoice of the month arrived without its cost: never zero or a partial sum
   * (CLAUDE.md rule 5; ADR 0037, 2026-11-17).
   */
  netIncome: string | null;
}

/** Signed revenue of an invoice: returns count against revenue. */
export function signedSubtotal(inv: Pick<ViewedInvoice, "isReturn" | "subtotal">): Dec {
  return inv.isReturn ? dec(inv.subtotal).negated() : dec(inv.subtotal);
}

/**
 * Signed cost of an invoice as received: returns count against; null when the cost was withheld
 * (CLAUDE.md rule 5; sales.md rule 13), never zero.
 */
export function signedCost(inv: Pick<ViewedInvoice, "isReturn" | "cost">): Dec | null {
  const cost = inv.cost ?? null;
  if (cost === null) return null;
  return inv.isReturn ? dec(cost).negated() : dec(cost);
}

/**
 * Monthly P&L for the given months (YYYY-MM), from invoices as received and expenses. A month with
 * an invoice whose cost was withheld has an unknown cost of goods, and so an unknown gross margin,
 * margin percent and net income (rule 5; reports.md "Profit and loss"); a month with no invoices has
 * a known zero. Revenue and expenses never depend on cost.
 */
export function monthlyPnl(
  months: readonly string[],
  invoices: readonly Pick<ViewedInvoice, "voidedAt" | "issuedAt" | "subtotal" | "cost" | "isReturn">[],
  expenses: readonly Pick<Expense, "status" | "category" | "date" | "amount">[],
): PnlMonth[] {
  return months.map((month) => {
    const inMonth = invoices.filter((i) => !i.voidedAt && i.issuedAt.startsWith(month));
    const revenue = sum(inMonth.map(signedSubtotal));
    const cogs = sumKnown(inMonth.map(signedCost));
    const opex = sum(expenses.filter((e) => countsAsCost(e) && e.date.startsWith(month)).map((e) => e.amount));
    const gross = cogs === null ? null : revenue.minus(cogs);
    return {
      month,
      revenue: moneyString(revenue),
      cogs: cogs === null ? null : moneyString(cogs),
      grossMargin: gross === null ? null : moneyString(gross),
      grossMarginPct: cogs === null ? null : marginPct(revenue, cogs).toString(),
      expenses: moneyString(opex),
      netIncome: gross === null ? null : moneyString(gross.minus(opex)),
    };
  });
}

/** A P&L month whose every figure is known. */
export type KnownPnlMonth = { [K in keyof PnlMonth]: NonNullable<PnlMonth[K]> };

/**
 * The P&L months with every figure, or null when any month's cost of goods is unknown: margin is
 * shown for all of them or none (ADR 0037, 2026-11-17).
 */
export function knownPnl(months: readonly PnlMonth[]): KnownPnlMonth[] | null {
  const known: KnownPnlMonth[] = [];
  for (const m of months) {
    if (m.cogs === null || m.grossMargin === null || m.grossMarginPct === null || m.netIncome === null) return null;
    known.push({
      ...m,
      cogs: m.cogs,
      grossMargin: m.grossMargin,
      grossMarginPct: m.grossMarginPct,
      netIncome: m.netIncome,
    });
  }
  return known;
}

/** The 12-month panel's totals (spec E1): revenue always, margin only when every month's cost is known. */
export interface PnlTotals {
  revenue: string;
  /** null when any month's cost of goods is unknown; never worked out over the known months only. */
  margin: { grossMargin: string; marginPct: string; months: KnownPnlMonth[] } | null;
}

/**
 * The 12-month panel's totals (spec E1): margin for every month or none, never over the known
 * months only, since that would understate cost (CLAUDE.md rule 5; ADR 0037, 2026-11-17).
 */
export function pnlTotals(months: readonly PnlMonth[]): PnlTotals {
  const revenue = sum(months.map((m) => m.revenue));
  const known = knownPnl(months);
  if (known === null) return { revenue: moneyString(revenue), margin: null };
  const cogs = sum(known.map((m) => m.cogs));
  return {
    revenue: moneyString(revenue),
    margin: {
      grossMargin: moneyString(revenue.minus(cogs)),
      marginPct: marginPct(revenue, cogs).toString(),
      months: known,
    },
  };
}

/**
 * The P&L of stored invoices, every figure known. Stored invoices always carry cost
 * (`invoices.cost NOT NULL`; DemoStore's rows), so an unknown cost here means a browser's invoices
 * reached a stored report: it fails rather than print a partial cost of goods (rule 5; ADR 0037,
 * 2026-11-17), as `storedCost` does for documents.
 */
export function storedPnl(months: readonly PnlMonth[]): KnownPnlMonth[] {
  const known = knownPnl(months);
  if (known === null) throw new Error("An invoice has no cost, so the profit and loss can't be worked out.");
  return known;
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
  /** The product's newest stock receipt (a roll received, or a boxed receipt), or null when never received. */
  receivedAt: string | null;
  /** Days since the last sale; when it never sold, days in stock since its newest receipt (else since it was added). */
  daysWithoutSale: number;
  /** Stock on hand in the product's stock unit: sq ft or each for boxed goods, ft for rolls. */
  onHand: string;
  onHandUnit: "sq_ft" | "each" | "ft";
}

/** The movements slow movers read: boxed quantities on hand and when stock was received. */
export type SlowMoverMovement = Pick<StockMovement, "productId" | "locationId" | "quantity" | "kind" | "at">;

/**
 * Each product's newest stock receipt, "YYYY-MM-DD...": a roll's `receivedAt` or a boxed
 * `receipt` movement, whichever is later. A product never received has none.
 */
export function newestReceipts(
  rolls: readonly Pick<Roll, "productId" | "receivedAt">[],
  movements: readonly SlowMoverMovement[],
): Map<string, string> {
  const newest = new Map<string, string>();
  const note = (productId: string, at: string) => {
    if ((newest.get(productId) ?? "") < at) newest.set(productId, at);
  };
  for (const roll of rolls) note(roll.productId, roll.receivedAt);
  for (const m of movements) if (m.kind === "receipt") note(m.productId, m.at);
  return newest;
}

/**
 * Slow movers (spec "Dashboard", feature batch 02 "Slow movers"; owner decision 2026-11-21 on
 * click-through #4): stocked products ranked by days since their last sale. One that never sold
 * counts its days in stock from its newest stock receipt, and from when it was added only if it
 * was never received, so a product restocked last month never reads as years old. Quantities
 * only, so no cost is exposed.
 */
export function slowMovers(
  products: readonly Product[],
  rolls: readonly Roll[],
  invoices: readonly Invoice[],
  today: string,
  limit: number,
  movements: readonly SlowMoverMovement[],
): SlowMover[] {
  const boxed: BoxedStock = boxedStock(movements);
  const received = newestReceipts(rolls, movements);
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
      const receivedAt = received.get(p.id) ?? null;
      return {
        productId: p.id,
        lastSoldAt: sold,
        receivedAt,
        daysWithoutSale: daysBetween((sold ?? receivedAt ?? p.createdAt).slice(0, 10), today),
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
export function salesByCategory(
  invoices: readonly (Pick<Invoice, "voidedAt" | "isReturn" | "subtotal" | "cost"> & { lines: readonly SalesLine[] })[],
  products: readonly Pick<Product, "id" | "category">[],
): CategorySales[] {
  const groups = new Map<string, { revenue: Dec; cost: Dec }>();
  for (const inv of invoices) {
    if (inv.voidedAt) continue;
    const sign = inv.isReturn ? -1 : 1;
    for (const line of salesLines(inv)) {
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
    .sort((a, b) => dec(b.revenue).comparedTo(a.revenue));
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
