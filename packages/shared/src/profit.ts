import type {
  BusinessAdjustment,
  BusinessData,
  BusinessEmployee,
  BusinessExpense,
  BusinessFilters,
  BusinessInvoice,
} from "./business-report";
import { fromCents, shareByWeight, toCents, weightsFor } from "./cost-sharing";
import { lineAmount } from "./documents";
import { countsAsCost, expenseCost, withoutPayroll } from "./expenses";
import { dec, roundMoney, sum, type Dec } from "./money";
import { salesLines, type SalesLine } from "./sales-lines";
import type { Invoice, Product } from "./types";

/**
 * The one profit calculation (reports.md rules 5 to 9; ADR 0061 decision 2): revenue, cost of goods,
 * gross profit, operating expenses and net profit for a period and filters. The Business report's
 * Summary and Profit by location and every Profit and loss row are worked out here, so the two
 * reports cannot give different profits for the same period and filters.
 */

/** Whether a yyyy-MM-dd day (or a longer moment's first ten characters) lies in [from, to]. */
export const inRange = (date: string, from: string, to: string) => date >= from && date <= to;

/** Where an invoice's revenue belongs: where it was sold, else the warehouse it ships from (ADR 0023). */
export const soldAt = (invoice: Pick<Invoice, "soldAtLocationId" | "locationId">) =>
  invoice.soldAtLocationId ?? invoice.locationId;

/** A return subtracts: -1 for a return, 1 otherwise (rule 5). */
export const sign = (i: Pick<Invoice, "isReturn">) => (i.isReturn ? -1 : 1);

/** The first item with each id; a map lookup gives what `find` gave, without a scan per record. */
export function firstById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const item of items) if (!out.has(item.id)) out.set(item.id, item);
  return out;
}

/** Adds a value to a map entry, starting from zero. */
export const add = (map: Map<string, Dec>, key: string, value: Dec) =>
  map.set(key, (map.get(key) ?? dec(0)).plus(value));

/** What the profit calculation reads: the documents of rules 5 to 8 and the shared-cost settings. */
export type ProfitData = Pick<
  BusinessData,
  "invoices" | "expenses" | "adjustments" | "payPeriods" | "employees" | "locations" | "productCategories" | "settings"
>;

/** Where a company-wide cost sits when the company has no location to split it across (no location id is empty). */
export const NO_LOCATION = "";

/** The filters profit follows (spec rule 22); the period is passed on its own. */
export type ProfitFilters = Pick<
  BusinessFilters,
  "locationIds" | "productCategory" | "expenseCategory" | "salesRepId" | "supplierId"
>;

/** No filter: the whole company (Profit and loss with every warehouse). */
export const NO_PROFIT_FILTERS: ProfitFilters = {
  locationIds: [],
  productCategory: null,
  expenseCategory: null,
  salesRepId: null,
  supplierId: null,
};

/** The lookups the profit calculation needs, built once per report so no figure scans a list per record. */
export interface ProfitLookups {
  categories: Map<string, Pick<Product, "id" | "category">>;
  invoices: Map<string, BusinessInvoice>;
  employees: Map<string, BusinessEmployee>;
}

/** Builds the profit lookups from the data. */
export function profitLookups(data: ProfitData): ProfitLookups {
  return {
    categories: firstById(data.productCategories),
    invoices: firstById(data.invoices),
    employees: firstById(data.employees),
  };
}

/**
 * The data a person may see profit from (ADR 0041; ADR 0055 S3): without pay sight, payroll expenses
 * and pay periods leave before any figure is computed, so no total can give pay away.
 */
export function withPaySight<T extends Pick<ProfitData, "expenses" | "payPeriods">>(data: T, payroll: boolean): T {
  return payroll ? data : { ...data, expenses: withoutPayroll(data.expenses), payPeriods: [] };
}

/** One person's or one payroll expense's people cost (rule 7). */
export interface PayLine {
  amount: Dec;
  month: string;
  locationId: string | null;
  name: string;
  href: string;
}

/** The accrual figures of a period, each location's share of company-wide costs included (rules 5 to 8). */
export interface ProfitFigures {
  invoices: BusinessInvoice[];
  revenue: Dec;
  cost: Dec;
  direct: Map<string, Dec>;
  people: Map<string, Dec>;
  badDebts: Map<string, Dec>;
  shared: Map<string, Dec>;
  costExpenses: BusinessExpense[];
  payLines: PayLine[];
  writeOffs: BusinessAdjustment[];
  rulesUsed: Set<string>;
}

/** A line's revenue and cost, signed for returns (rule 5). */
export function lineMoney(inv: Pick<Invoice, "isReturn">, line: SalesLine) {
  return {
    revenue: lineAmount(line).times(sign(inv)),
    cost: roundMoney(dec(line.quantity).times(line.unitCost)).times(sign(inv)),
  };
}

/** A line's category key: the product's (deleted products keep theirs), or the tax category for labor and services. */
export function categoryOf(line: SalesLine, look: Pick<ProfitLookups, "categories">): string {
  return (line.productId === undefined ? undefined : look.categories.get(line.productId))?.category ?? line.category;
}

/**
 * The people costs per month, one source per month (rule 7; ADR 0023): approved or exported HR pay
 * where a pay period ends in that month, else the month's confirmed payroll expenses.
 */
function peopleLines(data: ProfitData, look: ProfitLookups, from: string, to: string): PayLine[] {
  const hrMonths = new Set<string>();
  const lines: PayLine[] = [];
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

/**
 * Works out the accrual figures for a period (rules 5 to 8): revenue and cost from invoice lines,
 * cost expenses but payroll (amount plus tax), people costs, bad debts, and the shares of costs with
 * no location split across the live locations by the month's revenue (rule 6).
 */
export function profitFigures(
  data: ProfitData,
  look: ProfitLookups,
  f: ProfitFilters,
  from: string,
  to: string,
): ProfitFigures {
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
    // A company with no locations has nothing to split across: the cost stays the company's, so
    // operating expenses still hold it (a location filter can't be on, since there are none to pick).
    if (locations.length === 0) {
      add(shared, NO_LOCATION, amount);
      return;
    }
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

/** The sum of a map's entries, of the given keys only when any are given. */
export const totalOf = (map: Map<string, Dec>, keys?: readonly string[]) =>
  sum([...map.entries()].filter(([k]) => !keys || keys.length === 0 || keys.includes(k)).map(([, v]) => v));

/** A period's profit, in the five figures both reports print (rule 9). */
export interface Profit {
  revenue: Dec;
  cost: Dec;
  gross: Dec;
  opex: Dec;
  net: Dec;
}

/**
 * The profit of the locations in scope, all when none is picked (rule 9):
 * opex = direct + people + bad debts + shared, gross = revenue - cost, net = gross - opex.
 */
export function profitOf(f: ProfitFigures, locationIds: readonly string[]): Profit {
  const opex = totalOf(f.direct, locationIds)
    .plus(totalOf(f.people, locationIds))
    .plus(totalOf(f.badDebts, locationIds))
    .plus(totalOf(f.shared, locationIds));
  const gross = f.revenue.minus(f.cost);
  return { revenue: f.revenue, cost: f.cost, gross, opex, net: gross.minus(opex) };
}

/**
 * A period's profit for a person (rules 5 to 9; ADR 0061 decision 2): what the Business report's
 * Summary shows for the same period, filters and pay sight, and what Profit and loss shows per month.
 */
export function periodProfit(
  data: ProfitData,
  filters: ProfitFilters,
  period: { from: string; to: string },
  show: { payroll: boolean },
): Profit {
  const seen = withPaySight(data, show.payroll);
  return profitOf(profitFigures(seen, profitLookups(seen), filters, period.from, period.to), filters.locationIds);
}
