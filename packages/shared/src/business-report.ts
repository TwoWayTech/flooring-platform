import { daysBetween, addDays } from "./dates";
import { fromCents, toCents, shareByWeight, weightsFor } from "./cost-sharing";
import { countsAsCost, expenseCost, EXPENSE_CATEGORY_LABELS } from "./expenses";
import { inventoryValuation } from "./analytics";
import { lineAmount } from "./documents";
import { ledgerIndex } from "./ledger";
import { dec, moneyString, roundMoney, sum, type Dec } from "./money";
import { billLedgerIndex, receivedValue } from "./operations/purchasing";
import { boxedStock } from "./stock";
import { salesCategoryLabel, salesLines, type SalesLine } from "./sales-lines";
import type {
  Bill,
  CompanySettings,
  Employee,
  Expense,
  GoodsReceipt,
  Invoice,
  InvoiceAdjustment,
  Location,
  Payment,
  PayPeriod,
  Product,
  PurchaseOrder,
  Refund,
  Roll,
  StockMovement,
  Supplier,
  SupplierPayment,
  User,
} from "./types";

/** Everything the report reads: the company's whole record, never a screen's filtered copy. */
export interface BusinessData {
  invoices: readonly Invoice[];
  payments: readonly Payment[];
  adjustments: readonly InvoiceAdjustment[];
  refunds: readonly Refund[];
  expenses: readonly Expense[];
  bills: readonly Bill[];
  supplierPayments: readonly SupplierPayment[];
  receipts: readonly GoodsReceipt[];
  purchaseOrders: readonly PurchaseOrder[];
  suppliers: readonly Supplier[];
  users: readonly User[];
  employees: readonly Employee[];
  locations: readonly Location[];
  products: readonly Product[];
  rolls: readonly Roll[];
  stockMovements: readonly StockMovement[];
  payPeriods: readonly PayPeriod[];
  settings: Pick<CompanySettings, "sharedCosts">;
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
  margin: boolean;
  people: boolean;
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

const sign = (i: Invoice) => (i.isReturn ? -1 : 1);
const money = (d: Dec) => moneyString(d);

interface Figures {
  invoices: Invoice[];
  revenue: Dec;
  cost: Dec;
  direct: Map<string, Dec>;
  people: Map<string, Dec>;
  badDebts: Map<string, Dec>;
  shared: Map<string, Dec>;
  costExpenses: Expense[];
  payLines: { amount: Dec; month: string; locationId: string | null; name: string; href: string }[];
  writeOffs: InvoiceAdjustment[];
  rulesUsed: Set<string>;
}

const add = (map: Map<string, Dec>, key: string, value: Dec) => map.set(key, (map.get(key) ?? dec(0)).plus(value));

/** A line's revenue and cost, signed for returns. */
function lineMoney(inv: Invoice, line: SalesLine) {
  return {
    revenue: lineAmount(line).times(sign(inv)),
    cost: roundMoney(dec(line.quantity).times(line.unitCost)).times(sign(inv)),
  };
}

/** A line's category key: the product's, or the tax category for labor and services. */
function categoryOf(line: SalesLine, products: readonly Product[]): string {
  return products.find((p) => p.id === line.productId)?.category ?? line.category;
}

/** The people costs per month, one source per month: HR pay where it exists, else a payroll expense (ADR 0023). */
function peopleLines(data: BusinessData, from: string, to: string): Figures["payLines"] {
  const hrMonths = new Set<string>();
  const lines: Figures["payLines"] = [];
  for (const period of data.payPeriods.filter((p) => p.status === "approved" || p.status === "exported")) {
    if (!inRange(period.end, from, to)) continue;
    const month = period.end.slice(0, 7);
    hrMonths.add(month);
    for (const line of period.lines) {
      const employee = data.employees.find((e) => e.id === line.employeeId);
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
function figuresFor(data: BusinessData, f: BusinessFilters, from: string, to: string): Figures {
  const { locations, products } = data;
  const allInvoices = data.invoices.filter((i) => !i.voidedAt);
  const wanted = (i: Invoice) => f.locationIds.length === 0 || f.locationIds.includes(soldAt(i));
  const invoices = allInvoices.filter(
    (i) => inRange(i.issuedAt, from, to) && wanted(i) && (!f.salesRepId || i.salesRepId === f.salesRepId),
  );
  let revenue = dec(0);
  let cost = dec(0);
  for (const inv of invoices) {
    for (const line of salesLines(inv)) {
      if (f.productCategory && categoryOf(line, products) !== f.productCategory) continue;
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
  const revenueInMonth = (month: string) => {
    const totals = new Map<string, bigint>();
    for (const i of allInvoices.filter((x) => x.issuedAt.startsWith(month)))
      totals.set(soldAt(i), (totals.get(soldAt(i)) ?? 0n) + toCents(dec(i.subtotal).times(sign(i))));
    return totals;
  };
  const spread = (cost: Dec, month: string) => {
    const { rule, weights } = weightsFor(locations, data.settings.sharedCosts, revenueInMonth(month));
    rulesUsed.add(rule);
    for (const [id, cents] of shareByWeight(toCents(cost), weights)) add(shared, id, fromCents(cents));
  };
  for (const e of costExpenses) {
    if (e.locationId) add(direct, e.locationId, expenseCost(e));
    else spread(expenseCost(e), e.date.slice(0, 7));
  }
  const payLines = peopleLines(data, from, to);
  for (const line of payLines) {
    if (line.locationId) add(people, line.locationId, line.amount);
    else spread(line.amount, line.month);
  }
  const writeOffs = data.adjustments.filter((a) => a.kind === "write_off" && inRange(a.at.slice(0, 10), from, to));
  for (const a of writeOffs) {
    const inv = data.invoices.find((i) => i.id === a.invoiceId);
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

const invoiceRecord = (i: Invoice): DrillRecord => ({
  date: i.issuedAt,
  label: i.number,
  amount: moneyString(dec(i.subtotal).times(sign(i))),
  href: `/sales/invoices/${i.id}`,
});
const expenseRecord = (e: Expense, vendor: string): DrillRecord => ({
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

/**
 * The business report (spec F2, ADR 0023): one calculation that feeds the screen, CSV and PDF. Accrual
 * sections use invoice and expense dates, cash sections use payment dates, and balances are read at
 * period end. Location profits add up exactly to company profit, whatever the period.
 */
export function businessReport(data: BusinessData, filters: BusinessFilters, show: BusinessVisibility): BusinessReport {
  const { from, to, locationIds } = filters;
  const length = daysBetween(from, to);
  const previous = { from: addDays(from, -length - 1), to: addDays(from, -1) };
  const now = figuresFor(data, filters, from, to);
  const before = figuresFor(data, filters, previous.from, previous.to);
  const vendor = (id: string | null) => data.suppliers.find((s) => s.id === id)?.name ?? "No vendor";
  const a = bottomLine(now, locationIds);
  const b = bottomLine(before, locationIds);
  const nowCash = cashFigures(data, from, to);
  const beforeCash = cashFigures(data, previous.from, previous.to);
  const asOf = to < data.today ? to : data.today;
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
      summaryRows.push(compare("Operating expenses", "opex", a.opex, b.opex, expenseRecords));
      summaryRows.push(compare("Net profit, before income tax", "net", a.net, b.net));
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
        ]
          .filter(Boolean)
          .join(" ") || null,
      columns: SUMMARY_COLS,
      rows: summaryRows,
      total: null,
      chartColumn: null,
    },
  ];

  if (show.margin && data.locations.length > 0 && !repOnly) sections.push(profitByLocation(data, now, locationIds));
  sections.push(...revenueSections(data, now, show));
  if (!repOnly) {
    sections.push(...expenseSections(data, now, vendor));
    sections.push(cashSection(nowCash));
    sections.push(purchasesSection(data, filters, vendor));
    sections.push(taxesSection(data, from, to, asOf));
    if (show.people) sections.push(peopleSection(now));
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

function profitByLocation(data: BusinessData, f: Figures, locationIds: string[]): BusinessSection {
  const scope = data.locations.filter((l) => locationIds.length === 0 || locationIds.includes(l.id));
  const columns = [
    moneyCol("revenue", "Revenue"),
    moneyCol("cogs", "Cost of goods"),
    moneyCol("direct", "Direct expenses"),
    moneyCol("shared", "Shared expenses"),
    moneyCol("net", "Net profit"),
  ];
  const rows = scope.map((l) => {
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
  return {
    key: "locations",
    title: "Profit by location",
    note: used ? `Shared expenses are split by ${used}.` : null,
    columns,
    rows,
    total: withTotal(rows, columns),
    chartColumn: "net",
  };
}

function revenueSections(data: BusinessData, f: Figures, show: BusinessVisibility): BusinessSection[] {
  const columns = [moneyCol("revenue", "Revenue"), ...(show.margin ? [moneyCol("margin", "Margin")] : [])];
  const group = (key: (i: Invoice, line: SalesLine) => string, label: (k: string) => string): BusinessRow[] => {
    const totals = new Map<string, { revenue: Dec; cost: Dec; invoices: Set<Invoice> }>();
    for (const inv of f.invoices) {
      for (const line of salesLines(inv)) {
        const m = lineMoney(inv, line);
        const k = key(inv, line);
        const t = totals.get(k) ?? { revenue: dec(0), cost: dec(0), invoices: new Set<Invoice>() };
        t.invoices.add(inv);
        totals.set(k, { revenue: t.revenue.plus(m.revenue), cost: t.cost.plus(m.cost), invoices: t.invoices });
      }
    }
    return [...totals.entries()]
      .map(([k, t]) =>
        row(
          k,
          label(k),
          { revenue: money(t.revenue), margin: money(t.revenue.minus(t.cost)) },
          [...t.invoices].map(invoiceRecord),
        ),
      )
      .sort((a, b) => dec(b.values.revenue!).comparedTo(a.values.revenue!));
  };
  const byCategory = group((_, line) => categoryOf(line, data.products), salesCategoryLabel);
  const byRep = group(
    (i) => i.salesRepId,
    (k) => data.users.find((u) => u.id === k)?.name ?? "Former employee",
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

function expenseSections(data: BusinessData, f: Figures, vendor: (id: string | null) => string): BusinessSection[] {
  const columns = [moneyCol("cost", "Cost")];
  const group = (key: (e: Expense) => string, label: (k: string) => string) => {
    const by = new Map<string, Expense[]>();
    for (const e of f.costExpenses) by.set(key(e), [...(by.get(key(e)) ?? []), e]);
    return [...by.entries()]
      .map(([k, list]) =>
        row(
          k,
          label(k),
          { cost: money(sum(list.map(expenseCost))) },
          list.map((e) => expenseRecord(e, vendor(e.supplierId))),
        ),
      )
      .sort((a, b) => dec(b.values.cost!).comparedTo(a.values.cost!));
  };
  const section = (key: string, title: string, rows: BusinessRow[]): BusinessSection => ({
    key,
    title,
    note: null,
    columns,
    rows,
    total: withTotal(rows, columns),
    chartColumn: "cost",
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
        (k) => (k === "shared" ? "Company-wide" : (data.locations.find((l) => l.id === k)?.name ?? k)),
      ),
    ),
  ];
}

function cashSection(c: ReturnType<typeof cashFigures>): BusinessSection {
  const columns = [moneyCol("amount", "Amount")];
  const methods = new Map<string, Payment[]>();
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
  f: BusinessFilters,
  vendor: (id: string | null) => string,
): BusinessSection {
  const columns = [moneyCol("amount", "Received at order cost")];
  const by = new Map<string, Dec>();
  let notBilled = dec(0);
  for (const r of data.receipts.filter((x) => inRange(x.receivedAt.slice(0, 10), f.from, f.to))) {
    const po = data.purchaseOrders.find((p) => p.id === r.poId);
    if (!po || (f.supplierId && po.supplierId !== f.supplierId)) continue;
    const value = receivedValue(po, [r]);
    add(by, po.supplierId, value);
    if (!data.bills.some((b) => b.receiptIds.includes(r.id))) notBilled = notBilled.plus(value);
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
