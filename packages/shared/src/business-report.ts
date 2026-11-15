import { daysBetween, addDays, monthEnd } from "./dates";
import { fromCents, toCents, shareByWeight, weightsFor } from "./cost-sharing";
import { countsAsCost, expenseCost, withoutPayroll, EXPENSE_CATEGORY_LABELS } from "./expenses";
import { inventoryValuation } from "./analytics";
import { lineAmount } from "./documents";
import { ledgerIndex } from "./ledger";
import { dec, moneyString, roundMoney, sum, type Dec } from "./money";
import { billLedgerIndex, receivedValue } from "./operations/purchasing";
import { boxedStock } from "./stock";
import { salesCategoryLabel, salesLines, type SalesLine } from "./sales-lines";
import type {
  Bill,
  Employee,
  Expense,
  GoodsReceipt,
  Invoice,
  InvoiceAdjustment,
  Location,
  Payment,
  PayPeriod,
  PayPeriodLine,
  PoLine,
  Product,
  PurchaseOrder,
  ReceiptLine,
  Refund,
  Roll,
  SharedCostSettings,
  StockMovement,
  Supplier,
  SupplierPayment,
  User,
} from "./types";

/**
 * The invoice fields the report reads, with lines narrowed to what a sales report needs. The API
 * reads only these columns (ADR 0055 "One calculation"); the demo's full invoices fit too.
 */
export type BusinessInvoice = Pick<
  Invoice,
  | "id"
  | "number"
  | "salesRepId"
  | "locationId"
  | "soldAtLocationId"
  | "issuedAt"
  | "dueAt"
  | "voidedAt"
  | "isReturn"
  | "depositPct"
  | "subtotal"
  | "tax"
  | "total"
  | "cost"
> & { lines: readonly SalesLine[] };

/** The customer payment fields the report reads: cash received and balances (rules 11 and 12). */
export type BusinessPayment = Pick<
  Payment,
  "id" | "number" | "invoiceId" | "amount" | "date" | "method" | "status" | "kind"
>;

/** The credit and write-off fields the report reads: bad debts and balances (rules 8 and 12). */
export type BusinessAdjustment = Pick<InvoiceAdjustment, "invoiceId" | "kind" | "amount" | "at">;

/** The refund fields the report reads: cash paid out (rule 11). */
export type BusinessRefund = Pick<Refund, "amount" | "date" | "status">;

/** The expense fields the report reads: costs, cash, taxes and payroll months (rules 6, 7, 11 and 19). */
export type BusinessExpense = Pick<
  Expense,
  "id" | "number" | "date" | "supplierId" | "category" | "locationId" | "amount" | "tax" | "status" | "settlement"
>;

/** The supplier bill fields the report reads: what suppliers are owed and which receipts are billed (rules 12 and 18). */
export type BusinessBill = Pick<Bill, "id" | "issuedAt" | "dueAt" | "total" | "receiptIds">;

/** The supplier payment fields the report reads: cash paid out and what each bill still owes (rules 11 and 12). */
export type BusinessSupplierPayment = Pick<SupplierPayment, "amount" | "date" | "status"> & {
  allocations: readonly Pick<SupplierPayment["allocations"][number], "billId" | "amount">[];
};

/** The goods receipt fields the report reads: purchases received in the period (rule 18). */
export type BusinessReceipt = Pick<GoodsReceipt, "id" | "poId" | "receivedAt"> & {
  lines: readonly Pick<ReceiptLine, "poLineId" | "received">[];
};

/** The purchase order fields the report reads: the supplier and each line's order cost (rule 18). */
export type BusinessOrder = Pick<PurchaseOrder, "id" | "supplierId"> & {
  lines: readonly Pick<PoLine, "id" | "unitCost">[];
};

/** The employee fields the report reads: where their pay lands and the name on its drill record (rule 7). */
export type BusinessEmployee = Pick<Employee, "id" | "name" | "homeLocationId">;

/** The location fields the report reads: rows, names, warehouses and floor area for shared costs. */
export type BusinessLocation = Pick<Location, "id" | "name" | "kind" | "floorAreaSqFt">;

/** The roll fields Stock on hand reads: where it is and what is left at its own cost (rule 21). */
export type BusinessRoll = Pick<Roll, "locationId" | "widthFt" | "remainingLengthFt" | "costPerSqFt">;

/** The pay period fields the report reads: approved or exported pay, by the period's end (rule 7). */
export type BusinessPayPeriod = Pick<PayPeriod, "status" | "end"> & {
  lines: readonly Pick<PayPeriodLine, "employeeId" | "grossPay">[];
};

/**
 * Everything the report reads: the company's whole record, never a screen's filtered copy. The API
 * may leave out documents the report never looks at (`businessWindow`), but nothing else.
 */
export interface BusinessData {
  invoices: readonly BusinessInvoice[];
  payments: readonly BusinessPayment[];
  adjustments: readonly BusinessAdjustment[];
  refunds: readonly BusinessRefund[];
  expenses: readonly BusinessExpense[];
  bills: readonly BusinessBill[];
  supplierPayments: readonly BusinessSupplierPayment[];
  receipts: readonly BusinessReceipt[];
  purchaseOrders: readonly BusinessOrder[];
  suppliers: readonly Pick<Supplier, "id" | "name">[];
  users: readonly Pick<User, "id" | "name">[];
  employees: readonly BusinessEmployee[];
  /** Live locations only: shared costs are split across these. */
  locations: readonly BusinessLocation[];
  /** Every product a line may name, deleted ones included, so old lines keep their category (ADR 0055). */
  productCategories: readonly Pick<Product, "id" | "category">[];
  /** Live products at their average cost, for Stock on hand only. */
  products: readonly Pick<Product, "id" | "cost">[];
  rolls: readonly BusinessRoll[];
  stockMovements: readonly Pick<StockMovement, "productId" | "locationId" | "quantity">[];
  payPeriods: readonly BusinessPayPeriod[];
  settings: { sharedCosts: SharedCostSettings };
  today: string;
}

/** The period and filters (spec F2). */
export interface BusinessFilters {
  from: string;
  to: string;
  locationIds: string[];
  productCategory: string | null;
  expenseCategory: string | null;
  salesRepId: string | null;
  supplierId: string | null;
}

/** Which sections a person may see; hidden ones are left out, not shown as zero (ADR 0023). */
export interface BusinessVisibility {
  /** Cost of goods and everything worked out from it: gross, operating expenses, net, Profit by location, Margin columns. */
  margin: boolean;
  /**
   * Figures with pay inside: people costs in operating expenses, net profit and profit by location
   * (ADR 0041; ADR 0055 S3). Without it, payroll expenses and pay periods are never counted.
   */
  payroll: boolean;
  /** The People costs section, with a drill record per person. */
  people: boolean;
  /** Stock on hand, and Purchases by supplier at order cost (ADR 0055 S5). */
  stock: boolean;
}

/** One of the records behind a figure (spec F2 drill-down). */
export interface DrillRecord {
  date: string;
  label: string;
  amount: string;
  href: string | null;
}

/** A table column; a numeric one carries the number kind. */
export interface BusinessColumn {
  id: string;
  header: string;
  kind?: "money" | "percent";
}

/** A row and the records it adds up. */
export interface BusinessRow {
  id: string;
  label: string;
  values: Record<string, string>;
  records: DrillRecord[];
  /** Overrides the column's number kind, for a percent row in a money column. */
  kind?: "percent";
  /** How many records there are, set only when `records` was cut to the latest ones (ADR 0055 S8). */
  recordCount?: number;
}

/** One section of the report; the screen, CSV and PDF all print these same rows. */
export interface BusinessSection {
  key: string;
  title: string;
  note: string | null;
  columns: BusinessColumn[];
  rows: BusinessRow[];
  total: BusinessRow | null;
  /** The column drawn as bars when the section has a chart. */
  chartColumn: string | null;
}

/** The whole report. */
export interface BusinessReport {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  sections: BusinessSection[];
}

/**
 * Which documents the Business report reads for a period (ADR 0055 "One calculation"). Every date
 * a reader loads by comes from here, so the API's windowed reads give the same answer as the whole
 * record.
 */
export interface BusinessWindow {
  period: { from: string; to: string };
  /** The comparison period: as long as the period, ending the day before it (rule 3). */
  previous: { from: string; to: string };
  /** The day balances are read at: the period's end, or today when the period runs past it (rule 12). */
  asOf: string;
  /**
   * Invoice heads: every live head issued up to the end of `to`'s month. Balances and "still owed"
   * need history; the shared-cost weights take a whole month's revenue, so invoices after `to` in
   * the same month count. Heads named by write-offs dated in [previous.from, to] are read too,
   * whatever their issue date.
   */
  headsTo: string;
  /** Invoice lines, expenses (but sales tax payments), refunds and pay periods: dated in [datedFrom, datedTo]. */
  datedFrom: string;
  datedTo: string;
  /** Payments, adjustments, supplier payments and sales tax payments: dated up to `historyTo`. */
  historyTo: string;
  /** Goods receipts: received in the period only (rule 18). */
  receiptsFrom: string;
  receiptsTo: string;
}

/**
 * The one statement of which documents the Business report reads (ADR 0055): the comparison period
 * of rule 3, the as-of day of rule 12 and the date bounds of every reader. Bills are not windowed:
 * all live bills are read, because a receipt billed after the period still counts as billed (rule 18).
 */
export function businessWindow(filters: Pick<BusinessFilters, "from" | "to">, today: string): BusinessWindow {
  const { from, to } = filters;
  const length = daysBetween(from, to);
  const previous = { from: addDays(from, -length - 1), to: addDays(from, -1) };
  return {
    period: { from, to },
    previous,
    asOf: to < today ? to : today,
    headsTo: monthEnd(to.slice(0, 7)),
    datedFrom: previous.from,
    datedTo: to,
    historyTo: to,
    receiptsFrom: from,
    receiptsTo: to,
  };
}

/** What a figure that points at a location no longer in the company is called (ADR 0055, the gate guard). */
export const REMOVED_LOCATION = "Removed location";

const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
const monthsIn = (from: string, to: string) => {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const end = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) return out;
    out.push(key);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
};

/** Where an invoice's revenue belongs: where it was sold, else the warehouse it ships from (ADR 0023). */
export const soldAt = (invoice: Pick<Invoice, "soldAtLocationId" | "locationId">) =>
  invoice.soldAtLocationId ?? invoice.locationId;

const sign = (i: Pick<Invoice, "isReturn">) => (i.isReturn ? -1 : 1);
const money = (d: Dec) => moneyString(d);

/** The first item with each id; a map lookup gives what `find` gave, without a scan per record. */
function firstById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const item of items) if (!out.has(item.id)) out.set(item.id, item);
  return out;
}

/** Lookups built once per report, so no figure scans a whole list per record. The output is unchanged. */
interface Lookups {
  categories: Map<string, Pick<Product, "id" | "category">>;
  invoices: Map<string, BusinessInvoice>;
  orders: Map<string, BusinessOrder>;
  employees: Map<string, BusinessEmployee>;
  suppliers: Map<string, Pick<Supplier, "id" | "name">>;
  users: Map<string, Pick<User, "id" | "name">>;
  locations: Map<string, BusinessLocation>;
  billedReceipts: Set<string>;
}

function lookupsOf(data: BusinessData): Lookups {
  return {
    categories: firstById(data.productCategories),
    invoices: firstById(data.invoices),
    orders: firstById(data.purchaseOrders),
    employees: firstById(data.employees),
    suppliers: firstById(data.suppliers),
    users: firstById(data.users),
    locations: firstById(data.locations),
    billedReceipts: new Set(data.bills.flatMap((b) => b.receiptIds)),
  };
}

interface Figures {
  invoices: BusinessInvoice[];
  revenue: Dec;
  cost: Dec;
  direct: Map<string, Dec>;
  people: Map<string, Dec>;
  badDebts: Map<string, Dec>;
  shared: Map<string, Dec>;
  costExpenses: BusinessExpense[];
  payLines: { amount: Dec; month: string; locationId: string | null; name: string; href: string }[];
  writeOffs: BusinessAdjustment[];
  rulesUsed: Set<string>;
}

const add = (map: Map<string, Dec>, key: string, value: Dec) => map.set(key, (map.get(key) ?? dec(0)).plus(value));

/** A line's revenue and cost, signed for returns. */
function lineMoney(inv: Pick<Invoice, "isReturn">, line: SalesLine) {
  return {
    revenue: lineAmount(line).times(sign(inv)),
    cost: roundMoney(dec(line.quantity).times(line.unitCost)).times(sign(inv)),
  };
}

/** A line's category key: the product's (deleted products keep theirs), or the tax category for labor and services. */
function categoryOf(line: SalesLine, look: Lookups): string {
  return (line.productId === undefined ? undefined : look.categories.get(line.productId))?.category ?? line.category;
}

/** The people costs per month, one source per month: HR pay where it exists, else a payroll expense (ADR 0023). */
function peopleLines(data: BusinessData, look: Lookups, from: string, to: string): Figures["payLines"] {
  const hrMonths = new Set<string>();
  const lines: Figures["payLines"] = [];
  for (const period of data.payPeriods.filter((p) => p.status === "approved" || p.status === "exported")) {
    if (!inRange(period.end, from, to)) continue;
    const month = period.end.slice(0, 7);
    hrMonths.add(month);
    for (const line of period.lines) {
      const employee = look.employees.get(line.employeeId);
      lines.push({
        amount: dec(line.grossPay),
        month,
        locationId: employee?.homeLocationId ?? null,
        name: `Gross pay, ${employee?.name ?? ""}`,
        href: "/hr/pay-periods",
      });
    }
  }
  for (const e of data.expenses.filter(
    (x) => x.category === "payroll" && x.status === "confirmed" && inRange(x.date, from, to),
  )) {
    if (!hrMonths.has(e.date.slice(0, 7)))
      lines.push({
        amount: expenseCost(e),
        month: e.date.slice(0, 7),
        locationId: e.locationId,
        name: "Payroll",
        href: "/finance?view=expenses",
      });
  }
  return lines;
}

/** Works out the accrual figures for a period, including each location's share of company-wide costs. */
function figuresFor(data: BusinessData, look: Lookups, f: BusinessFilters, from: string, to: string): Figures {
  const { locations } = data;
  const allInvoices = data.invoices.filter((i) => !i.voidedAt);
  const wanted = (i: BusinessInvoice) => f.locationIds.length === 0 || f.locationIds.includes(soldAt(i));
  const invoices = allInvoices.filter(
    (i) => inRange(i.issuedAt, from, to) && wanted(i) && (!f.salesRepId || i.salesRepId === f.salesRepId),
  );
  let revenue = dec(0);
  let cost = dec(0);
  for (const inv of invoices) {
    for (const line of salesLines(inv)) {
      if (f.productCategory && categoryOf(line, look) !== f.productCategory) continue;
      const m = lineMoney(inv, line);
      revenue = revenue.plus(m.revenue);
      cost = cost.plus(m.cost);
    }
  }
  const costExpenses = data.expenses.filter(
    (e) =>
      countsAsCost(e) &&
      e.category !== "payroll" &&
      inRange(e.date, from, to) &&
      (!f.expenseCategory || e.category === f.expenseCategory) &&
      (!f.supplierId || e.supplierId === f.supplierId),
  );
  const direct = new Map<string, Dec>();
  const shared = new Map<string, Dec>();
  const people = new Map<string, Dec>();
  const badDebts = new Map<string, Dec>();
  const rulesUsed = new Set<string>();
  // The revenue weights of a month use every non-void invoice of that month, whatever the filters
  // (rule 6); each month is added up once.
  const monthRevenue = new Map<string, Map<string, bigint>>();
  const revenueInMonth = (month: string) => {
    const known = monthRevenue.get(month);
    if (known) return known;
    const totals = new Map<string, bigint>();
    for (const i of allInvoices)
      if (i.issuedAt.startsWith(month))
        totals.set(soldAt(i), (totals.get(soldAt(i)) ?? 0n) + toCents(dec(i.subtotal).times(sign(i))));
    monthRevenue.set(month, totals);
    return totals;
  };
  const spread = (amount: Dec, month: string) => {
    const { rule, weights } = weightsFor(locations, data.settings.sharedCosts, revenueInMonth(month));
    rulesUsed.add(rule);
    for (const [id, cents] of shareByWeight(toCents(amount), weights)) add(shared, id, fromCents(cents));
  };
  for (const e of costExpenses) {
    if (e.locationId) add(direct, e.locationId, expenseCost(e));
    else spread(expenseCost(e), e.date.slice(0, 7));
  }
  const payLines = peopleLines(data, look, from, to);
  for (const line of payLines) {
    if (line.locationId) add(people, line.locationId, line.amount);
    else spread(line.amount, line.month);
  }
  const writeOffs = data.adjustments.filter((a) => a.kind === "write_off" && inRange(a.at.slice(0, 10), from, to));
  for (const a of writeOffs) {
    const inv = look.invoices.get(a.invoiceId);
    if (inv) add(badDebts, soldAt(inv), dec(a.amount));
  }
  return { invoices, revenue, cost, direct, people, badDebts, shared, costExpenses, payLines, writeOffs, rulesUsed };
}

const totalOf = (map: Map<string, Dec>, keys?: readonly string[]) =>
  sum([...map.entries()].filter(([k]) => !keys || keys.length === 0 || keys.includes(k)).map(([, v]) => v));

/** Operating expenses and net profit for the locations in scope (all when none is picked). */
function bottomLine(f: Figures, locationIds: string[]) {
  const opex = totalOf(f.direct, locationIds)
    .plus(totalOf(f.people, locationIds))
    .plus(totalOf(f.badDebts, locationIds))
    .plus(totalOf(f.shared, locationIds));
  const gross = f.revenue.minus(f.cost);
  return { gross, opex, net: gross.minus(opex) };
}

function cashFigures(data: BusinessData, from: string, to: string) {
  const received = data.payments.filter((p) => p.status === "confirmed" && inRange(p.date, from, to));
  const supplierPaid = data.supplierPayments.filter((p) => p.status === "confirmed" && inRange(p.date, from, to));
  const expensesPaid = data.expenses.filter(
    (e) => e.status === "confirmed" && e.settlement === "paid" && e.category !== "payroll" && inRange(e.date, from, to),
  );
  const refunds = data.refunds.filter((r) => r.status === "completed" && inRange(r.date, from, to));
  const inTotal = sum(received.map((p) => p.amount));
  const outTotal = sum(supplierPaid.map((p) => p.amount))
    .plus(sum(expensesPaid.map(expenseCost)))
    .plus(sum(refunds.map((r) => r.amount)));
  return { received, supplierPaid, expensesPaid, refunds, inTotal, outTotal };
}

/** What customers and suppliers owe at a day, current and overdue (ADR 0023). */
function balancesAt(data: BusinessData, asOf: string) {
  const invoices = data.invoices.filter((i) => i.issuedAt <= asOf);
  const ledgers = ledgerIndex(
    invoices,
    {
      payments: data.payments.filter((p) => p.date <= asOf),
      adjustments: data.adjustments.filter((a) => a.at.slice(0, 10) <= asOf),
    },
    asOf,
  );
  const open = [...ledgers.values()].filter((l) => dec(l.balance).gt(0));
  const bills = data.bills.filter((b) => b.issuedAt <= asOf);
  const billLedgers = [
    ...billLedgerIndex(
      bills,
      data.supplierPayments.filter((p) => p.date <= asOf),
      asOf,
    ).values(),
  ].filter((l) => dec(l.balance).gt(0));
  return {
    customersCurrent: sum(open.filter((l) => !l.overdue).map((l) => l.balance)),
    customersOverdue: sum(open.filter((l) => l.overdue).map((l) => l.balance)),
    suppliersCurrent: sum(billLedgers.filter((l) => !l.overdue).map((l) => l.balance)),
    suppliersOverdue: sum(billLedgers.filter((l) => l.overdue).map((l) => l.balance)),
  };
}

const invoiceRecord = (i: BusinessInvoice): DrillRecord => ({
  date: i.issuedAt,
  label: i.number,
  amount: moneyString(dec(i.subtotal).times(sign(i))),
  href: `/sales/invoices/${i.id}`,
});
const expenseRecord = (e: BusinessExpense, vendor: string): DrillRecord => ({
  date: e.date,
  label: `${e.number}, ${vendor}`,
  amount: moneyString(expenseCost(e)),
  href: `/finance?view=expenses&expense=${e.id}`,
});
const row = (id: string, label: string, values: Record<string, string>, records: DrillRecord[] = []): BusinessRow => ({
  id,
  label,
  values,
  records,
});

/** Change from the previous period, or an empty string when there was nothing to compare with. */
function changeText(now: Dec, before: Dec): string {
  if (before.isZero()) return "";
  return now.minus(before).dividedBy(before.abs()).times(100).toDecimalPlaces(1).toString();
}

const SUMMARY_COLS: BusinessColumn[] = [
  { id: "now", header: "This period", kind: "money" },
  { id: "before", header: "Previous period", kind: "money" },
  { id: "change", header: "Change", kind: "percent" },
];
const compare = (label: string, id: string, now: Dec, before: Dec, records: DrillRecord[] = []): BusinessRow =>
  row(id, label, { now: money(now), before: money(before), change: changeText(now, before) }, records);

/** Said in the Summary when pay is left out of the figures (ADR 0055 S3). */
const PAY_LEFT_OUT = "People costs are left out, because your access doesn't include pay periods.";

/**
 * The business report (spec F2, ADR 0023): one calculation that feeds the screen, CSV and PDF, on the
 * API and in the demo (ADR 0055). Accrual sections use invoice and expense dates, cash sections use
 * payment dates, and balances are read at period end. Location profits add up exactly to company
 * profit, whatever the period. What `show` hides is never computed into the answer: hidden rows,
 * columns, values and drill records are absent, not zero (ADR 0055 S7).
 */
export function businessReport(
  input: BusinessData,
  filters: BusinessFilters,
  show: BusinessVisibility,
): BusinessReport {
  // Without pay sight, payroll expenses and pay periods leave before any figure is computed, so no
  // total, memo or drill list can give pay away (ADR 0041; ADR 0055 S3).
  const data: BusinessData = show.payroll
    ? input
    : { ...input, expenses: withoutPayroll(input.expenses), payPeriods: [] };
  const { from, to, locationIds } = filters;
  const { previous, asOf } = businessWindow(filters, data.today);
  const look = lookupsOf(data);
  const now = figuresFor(data, look, filters, from, to);
  const before = figuresFor(data, look, filters, previous.from, previous.to);
  const vendor = (id: string | null) => (id === null ? undefined : look.suppliers.get(id))?.name ?? "No vendor";
  const a = bottomLine(now, locationIds);
  const b = bottomLine(before, locationIds);
  const nowCash = cashFigures(data, from, to);
  const beforeCash = cashFigures(data, previous.from, previous.to);
  const owe = balancesAt(data, asOf);
  const oweBefore = balancesAt(data, previous.to);
  const expenseRecords = now.costExpenses.map((e) => expenseRecord(e, vendor(e.supplierId)));
  const repOnly = filters.salesRepId !== null;

  const summaryRows: BusinessRow[] = [
    compare("Revenue", "revenue", now.revenue, before.revenue, now.invoices.map(invoiceRecord)),
  ];
  if (show.margin) {
    summaryRows.push(
      compare(
        "Cost of goods",
        "cogs",
        now.cost,
        before.cost,
        now.invoices.map((i) => ({ ...invoiceRecord(i), amount: moneyString(dec(i.cost).times(sign(i))) })),
      ),
    );
    summaryRows.push(compare("Gross profit", "gross", a.gross, b.gross));
    summaryRows.push({
      ...row("gross_pct", "Gross profit %", {
        now: pct(a.gross, now.revenue),
        before: pct(b.gross, before.revenue),
        change: "",
      }),
      kind: "percent",
    });
    if (!repOnly) {
      // Without pay sight the figures leave people costs out, and the labels say so (ADR 0055 S3).
      const opexLabel = show.payroll ? "Operating expenses" : "Operating expenses, excluding people costs";
      const netLabel = show.payroll
        ? "Net profit, before income tax"
        : "Net profit, before people costs and income tax";
      summaryRows.push(compare(opexLabel, "opex", a.opex, b.opex, expenseRecords));
      summaryRows.push(compare(netLabel, "net", a.net, b.net));
      summaryRows.push({
        ...row("net_pct", "Net profit %", {
          now: pct(a.net, now.revenue),
          before: pct(b.net, before.revenue),
          change: "",
        }),
        kind: "percent",
      });
    }
  }
  if (!repOnly) {
    summaryRows.push(
      compare(
        "Cash received",
        "cash_in",
        nowCash.inTotal,
        beforeCash.inTotal,
        nowCash.received.map((p) => ({
          date: p.date,
          label: p.number,
          amount: p.amount,
          href: `/sales/invoices/${p.invoiceId}`,
        })),
      ),
    );
    summaryRows.push(compare("Cash paid out, excluding wages", "cash_out", nowCash.outTotal, beforeCash.outTotal));
    summaryRows.push(compare("Customers owe, current", "ar_current", owe.customersCurrent, oweBefore.customersCurrent));
    summaryRows.push(compare("Customers owe, overdue", "ar_overdue", owe.customersOverdue, oweBefore.customersOverdue));
    summaryRows.push(
      compare("You owe suppliers, current", "ap_current", owe.suppliersCurrent, oweBefore.suppliersCurrent),
    );
    summaryRows.push(
      compare("You owe suppliers, overdue", "ap_overdue", owe.suppliersOverdue, oweBefore.suppliersOverdue),
    );
  }
  // A comparison with a period the records barely reach would read as huge growth, so it is left out.
  const earliest = data.invoices.reduce((min, i) => (i.issuedAt < min ? i.issuedAt : min), data.today);
  const partial = previous.from < earliest;
  if (partial) for (const r of summaryRows) r.values.change = "";
  const sections: BusinessSection[] = [
    {
      key: "summary",
      title: "Summary",
      note:
        [
          repOnly ? "Filtered to one salesperson, so the summary stops at gross profit." : null,
          partial ? "The earlier period starts before the first records, so no change is shown." : null,
          show.margin && !show.payroll ? PAY_LEFT_OUT : null,
        ]
          .filter(Boolean)
          .join(" ") || null,
      columns: SUMMARY_COLS,
      rows: summaryRows,
      total: null,
      chartColumn: null,
    },
  ];

  if (show.margin && data.locations.length > 0 && !repOnly)
    sections.push(profitByLocation(data, now, locationIds, show.payroll));
  sections.push(...revenueSections(look, now, show));
  if (!repOnly) {
    sections.push(...expenseSections(look, now, vendor));
    sections.push(cashSection(nowCash));
    // Purchases are valued at order cost, which only product-cost holders see (ADR 0055 S5).
    if (show.stock) sections.push(purchasesSection(data, look, filters, vendor));
    sections.push(taxesSection(data, from, to, asOf));
    if (show.people && show.payroll) sections.push(peopleSection(now));
    if (show.stock) sections.push(stockSection(data));
  }
  return { period: { from, to }, previous, sections };
}

const pct = (part: Dec, whole: Dec) =>
  whole.isZero() ? "0" : part.dividedBy(whole).times(100).toDecimalPlaces(1).toString();

const moneyCol = (id: string, header: string): BusinessColumn => ({ id, header, kind: "money" });

function withTotal(rows: BusinessRow[], columns: BusinessColumn[]): BusinessRow {
  const values: Record<string, string> = {};
  for (const c of columns) if (c.kind === "money") values[c.id] = money(sum(rows.map((r) => r.values[c.id] ?? "0")));
  return row("total", "Total", values);
}

/**
 * Profit by location (rule 14). With no location picked, the rows are every live location plus any
 * location a figure still points at that is no longer live, as "Removed location", so the rows
 * always add up to the company's net profit (the week-18 gate; ADR 0055). Shared costs only ever go
 * to live locations, because `weightsFor` is given the live ones.
 */
function profitByLocation(data: BusinessData, f: Figures, locationIds: string[], payroll: boolean): BusinessSection {
  const live = data.locations
    .filter((l) => locationIds.length === 0 || locationIds.includes(l.id))
    .map((l) => ({ id: l.id, name: l.name }));
  const liveIds = new Set(data.locations.map((l) => l.id));
  const removed =
    locationIds.length > 0
      ? []
      : [...new Set([...f.invoices.map(soldAt), ...f.direct.keys(), ...f.people.keys(), ...f.badDebts.keys()])]
          .filter((id) => !liveIds.has(id))
          .sort()
          .map((id) => ({ id, name: REMOVED_LOCATION }));
  const columns = [
    moneyCol("revenue", "Revenue"),
    moneyCol("cogs", "Cost of goods"),
    moneyCol("direct", "Direct expenses"),
    moneyCol("shared", "Shared expenses"),
    moneyCol("net", "Net profit"),
  ];
  const rows = [...live, ...removed].map((l) => {
    const own = f.invoices.filter((i) => soldAt(i) === l.id);
    const revenue = sum(own.map((i) => dec(i.subtotal).times(sign(i))));
    const cost = sum(own.map((i) => dec(i.cost).times(sign(i))));
    const direct = (f.direct.get(l.id) ?? dec(0)).plus(f.people.get(l.id) ?? 0).plus(f.badDebts.get(l.id) ?? 0);
    const shared = f.shared.get(l.id) ?? dec(0);
    return row(
      l.id,
      l.name,
      {
        revenue: money(revenue),
        cogs: money(cost),
        direct: money(direct),
        shared: money(shared),
        net: money(revenue.minus(cost).minus(direct).minus(shared)),
      },
      own.map(invoiceRecord),
    );
  });
  const labels = {
    revenue: "revenue share",
    floor_area: "floor area",
    equal: "equal shares",
    fixed: "fixed percentages",
  } as const;
  const used = [...f.rulesUsed].map((r) => labels[r as keyof typeof labels]).join(", ");
  const note = [
    used ? `Shared expenses are split by ${used}.` : null,
    payroll ? null : "Direct expenses leave out people costs.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    key: "locations",
    title: "Profit by location",
    note: note || null,
    columns,
    rows,
    total: withTotal(rows, columns),
    chartColumn: "net",
  };
}

/**
 * Revenue and margin by product category and by salesperson (rule 15). Each row's values hold only
 * the visible columns: without `margin` there is no margin value at all (ADR 0055 S7).
 */
function revenueSections(look: Lookups, f: Figures, show: BusinessVisibility): BusinessSection[] {
  const columns = [moneyCol("revenue", "Revenue"), ...(show.margin ? [moneyCol("margin", "Margin")] : [])];
  const group = (key: (i: BusinessInvoice, line: SalesLine) => string, label: (k: string) => string): BusinessRow[] => {
    const totals = new Map<string, { revenue: Dec; cost: Dec; invoices: Set<BusinessInvoice> }>();
    for (const inv of f.invoices) {
      for (const line of salesLines(inv)) {
        const m = lineMoney(inv, line);
        const k = key(inv, line);
        const t = totals.get(k) ?? { revenue: dec(0), cost: dec(0), invoices: new Set<BusinessInvoice>() };
        t.invoices.add(inv);
        totals.set(k, { revenue: t.revenue.plus(m.revenue), cost: t.cost.plus(m.cost), invoices: t.invoices });
      }
    }
    return [...totals.entries()]
      .map(([k, t]) =>
        row(
          k,
          label(k),
          show.margin
            ? { revenue: money(t.revenue), margin: money(t.revenue.minus(t.cost)) }
            : { revenue: money(t.revenue) },
          [...t.invoices].map(invoiceRecord),
        ),
      )
      .sort((a, b) => dec(b.values.revenue!).comparedTo(a.values.revenue!));
  };
  const byCategory = group((_, line) => categoryOf(line, look), salesCategoryLabel);
  const byRep = group(
    (i) => i.salesRepId,
    (k) => look.users.get(k)?.name ?? "Former employee",
  );
  return [
    {
      key: "revenue_category",
      title: "Revenue and margin by product category",
      note: null,
      columns,
      rows: byCategory,
      total: withTotal(byCategory, columns),
      chartColumn: "revenue",
    },
    {
      key: "revenue_rep",
      title: "Revenue and margin by salesperson",
      note: null,
      columns,
      rows: byRep,
      total: withTotal(byRep, columns),
      chartColumn: "revenue",
    },
  ];
}

/**
 * Expenses by category, vendor and location (rule 16). The column id is `amount`, not the reserved
 * sensitive name `cost`, because an expense's cost is not a sensitive figure (ADR 0055 S7).
 */
function expenseSections(look: Lookups, f: Figures, vendor: (id: string | null) => string): BusinessSection[] {
  const columns = [moneyCol("amount", "Cost")];
  const group = (key: (e: BusinessExpense) => string, label: (k: string) => string) => {
    const by = new Map<string, BusinessExpense[]>();
    for (const e of f.costExpenses) by.set(key(e), [...(by.get(key(e)) ?? []), e]);
    return [...by.entries()]
      .map(([k, list]) =>
        row(
          k,
          label(k),
          { amount: money(sum(list.map(expenseCost))) },
          list.map((e) => expenseRecord(e, vendor(e.supplierId))),
        ),
      )
      .sort((a, b) => dec(b.values.amount!).comparedTo(a.values.amount!));
  };
  const section = (key: string, title: string, rows: BusinessRow[]): BusinessSection => ({
    key,
    title,
    note: null,
    columns,
    rows,
    total: withTotal(rows, columns),
    chartColumn: "amount",
  });
  return [
    section(
      "expense_category",
      "Expenses by category",
      group(
        (e) => e.category,
        (k) => EXPENSE_CATEGORY_LABELS[k as keyof typeof EXPENSE_CATEGORY_LABELS] ?? k,
      ),
    ),
    section(
      "expense_vendor",
      "Expenses by vendor",
      group(
        (e) => e.supplierId ?? "none",
        (k) => (k === "none" ? "No vendor" : vendor(k)),
      ),
    ),
    section(
      "expense_location",
      "Expenses by location",
      group(
        (e) => e.locationId ?? "shared",
        (k) => (k === "shared" ? "Company-wide" : (look.locations.get(k)?.name ?? REMOVED_LOCATION)),
      ),
    ),
  ];
}

function cashSection(c: ReturnType<typeof cashFigures>): BusinessSection {
  const columns = [moneyCol("amount", "Amount")];
  const methods = new Map<string, BusinessPayment[]>();
  for (const p of c.received) methods.set(p.method, [...(methods.get(p.method) ?? []), p]);
  const labels: Record<string, string> = { cash: "Cash", check: "Check", ach: "ACH", card: "Card", other: "Other" };
  const rows = [
    ...[...methods.entries()].map(([m, list]) =>
      row(
        `in-${m}`,
        `Received by ${labels[m] ?? m}`,
        { amount: money(sum(list.map((p) => p.amount))) },
        list.map((p) => ({ date: p.date, label: p.number, amount: p.amount, href: `/sales/invoices/${p.invoiceId}` })),
      ),
    ),
    row("out-suppliers", "Paid to suppliers", {
      amount: money(sum(c.supplierPaid.map((p) => dec(p.amount).negated()))),
    }),
    row("out-expenses", "Paid for expenses", {
      amount: money(sum(c.expensesPaid.map((e) => expenseCost(e).negated()))),
    }),
    row("out-refunds", "Refunds to customers", { amount: money(sum(c.refunds.map((r) => dec(r.amount).negated()))) }),
  ];
  return {
    key: "cash",
    title: "Cash",
    note: "Excludes wages, which your payroll provider pays.",
    columns,
    rows,
    total: row("total", "Net cash", { amount: money(c.inTotal.minus(c.outTotal)) }),
    chartColumn: null,
  };
}

function purchasesSection(
  data: BusinessData,
  look: Lookups,
  f: BusinessFilters,
  vendor: (id: string | null) => string,
): BusinessSection {
  const columns = [moneyCol("amount", "Received at order cost")];
  const by = new Map<string, Dec>();
  let notBilled = dec(0);
  for (const r of data.receipts.filter((x) => inRange(x.receivedAt.slice(0, 10), f.from, f.to))) {
    const po = look.orders.get(r.poId);
    if (!po || (f.supplierId && po.supplierId !== f.supplierId)) continue;
    const value = receivedValue(po, [r]);
    add(by, po.supplierId, value);
    if (!look.billedReceipts.has(r.id)) notBilled = notBilled.plus(value);
  }
  const rows = [...by.entries()]
    .map(([id, v]) => row(id, vendor(id), { amount: money(v) }))
    .sort((a, b) => dec(b.values.amount!).comparedTo(a.values.amount!));
  return {
    key: "purchases",
    title: "Purchases by supplier",
    note: `Received but not billed yet: $${money(notBilled)}.`,
    columns,
    rows,
    total: withTotal(rows, columns),
    chartColumn: "amount",
  };
}

function taxesSection(data: BusinessData, from: string, to: string, asOf: string): BusinessSection {
  const columns = [moneyCol("amount", "Amount")];
  const charged = (a: string, b: string) =>
    sum(data.invoices.filter((i) => !i.voidedAt && inRange(i.issuedAt, a, b)).map((i) => dec(i.tax).times(sign(i))));
  const payments = data.expenses.filter((e) => e.category === "sales_tax_payment" && e.status === "confirmed");
  const paid = (a: string, b: string) => sum(payments.filter((e) => inRange(e.date, a, b)).map((e) => e.amount));
  const confirmed = data.expenses.filter((e) => countsAsCost(e) && inRange(e.date, from, to));
  const rows = [
    row("charged", "Sales tax charged to customers", { amount: money(charged(from, to)) }),
    row(
      "paid",
      "Sales tax paid to the state",
      { amount: money(paid(from, to)) },
      payments
        .filter((e) => inRange(e.date, from, to))
        .map((e) => ({ date: e.date, label: e.number, amount: e.amount, href: "/finance?view=expenses" })),
    ),
    row("owed", "Still owed at period end", {
      amount: money(charged("0000-01-01", asOf).minus(paid("0000-01-01", asOf))),
    }),
    row("cost", "Taxes that are costs", {
      amount: money(sum(confirmed.filter((e) => e.category === "taxes_licenses").map(expenseCost))),
    }),
    row("memo", "Sales tax paid on purchases (memo, already in expenses)", {
      amount: money(sum(confirmed.map((e) => e.tax))),
    }),
  ];
  return { key: "taxes", title: "Taxes", note: null, columns, rows, total: null, chartColumn: null };
}

function peopleSection(f: Figures): BusinessSection {
  const columns = [moneyCol("amount", "Amount")];
  const records = f.payLines.map((l) => ({ date: l.month, label: l.name, amount: money(l.amount), href: l.href }));
  const rows = [
    row("pay", "Gross pay estimate and commissions", { amount: money(sum(f.payLines.map((l) => l.amount))) }, records),
  ];
  return {
    key: "people",
    title: "People costs",
    note: "Gross pay estimate. Taxes and net pay are calculated by your payroll provider.",
    columns,
    rows,
    total: null,
    chartColumn: null,
  };
}

function stockSection(data: BusinessData): BusinessSection {
  const columns = [moneyCol("amount", "Value on hand")];
  const rows = data.locations
    .filter((l) => l.kind === "warehouse")
    .map((l) =>
      row(l.id, l.name, {
        amount: inventoryValuation(
          data.rolls.filter((r) => r.locationId === l.id),
          data.products,
          boxedStock(data.stockMovements, l.id),
        ).total,
      }),
    );
  return {
    key: "stock",
    title: "Stock on hand",
    note: "Value today. The period does not change it.",
    columns,
    rows,
    total: withTotal(rows, columns),
    chartColumn: "amount",
  };
}

/** The months a period covers, for callers that need them. */
export const periodMonths = monthsIn;
