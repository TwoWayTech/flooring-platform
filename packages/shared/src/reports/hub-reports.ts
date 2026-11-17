import { monthlyPnl, salesByCategory, storedPnl } from "../analytics";
import { withoutPayroll } from "../expenses";
import { sum } from "../money";
import type { NumberKind } from "../numbers";
import { PAYMENT_METHOD_LABELS } from "../operations/payments";
import { salesCategoryLabel, type SalesLine } from "../sales-lines";
import type { Customer, Expense, Invoice, Payment, PaymentMethod, Product, ProductCategory } from "../types";
import { hubWindow, type HubWindow, type ReportRange } from "./periods";
import type { ReportVisibility } from "./visibility";

/** A report column; numeric ones carry the number kind, date and month ones say so for the screen to format. */
export interface ReportColumn {
  id: string;
  header: string;
  kind?: NumberKind;
  format?: "date" | "month";
}

/**
 * A hub report as data: what the table shows, the CSV holds and the PDF prints (spec rule 24). Values
 * are raw (decimal strings, yyyy-MM-dd days, yyyy-MM months); the screen formats them.
 */
export interface Report {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string>[];
  totals: Record<string, string> | null;
}

/** The Profit and loss query: a date preset and, optionally, the warehouse invoices ship from (rule 24). */
export interface PnlQuery {
  range: ReportRange;
  locationId: string | null;
}

/** The Sales by category query: the P&L's, plus one product category (rule 24). */
export interface SalesByCategoryQuery extends PnlQuery {
  category: ProductCategory | null;
}

/** The Payments received query: the P&L's, plus a payment method and part of a customer's name (rule 24). */
export interface PaymentsReportQuery extends PnlQuery {
  method: PaymentMethod | null;
  customer: string;
}

/** The invoice fields the hub reports read; the API reads only these columns (ADR 0055). */
export type HubInvoice = Pick<
  Invoice,
  "id" | "number" | "customerId" | "locationId" | "issuedAt" | "voidedAt" | "isReturn" | "subtotal" | "cost"
> & { lines: readonly SalesLine[] };

/** The documents the hub reads, already narrowed to the viewer's data scope by the caller (ADR 0055 S2). */
export interface HubReportData {
  today: string;
  invoices: readonly HubInvoice[];
  expenses: readonly Pick<Expense, "status" | "category" | "date" | "amount">[];
  /** Every product a line may name, deleted ones included, so old lines keep their category. */
  products: readonly Pick<Product, "id" | "category">[];
  payments: readonly Pick<
    Payment,
    "id" | "number" | "invoiceId" | "customerId" | "amount" | "date" | "method" | "reference" | "status"
  >[];
  /** The customers whose names the viewer may see; any other customer's name reads empty. */
  customers: readonly Pick<Customer, "id" | "name">[];
}

/** The sum of a column over the rows, as the demo printed it (`Dec.toString`, no padding). */
const total = (rows: readonly Record<string, string>[], id: string) => sum(rows.map((r) => r[id] ?? "0")).toString();

/** Invoices issued in the report's dates, in the chosen warehouse (where they ship from), per rule 24. */
function hubInvoices<T extends Pick<Invoice, "issuedAt" | "locationId">>(
  invoices: readonly T[],
  query: PnlQuery,
  w: HubWindow,
): T[] {
  return invoices.filter(
    (i) =>
      i.issuedAt >= w.from && i.issuedAt <= w.invoicesTo && (!query.locationId || i.locationId === query.locationId),
  );
}

/**
 * Profit and loss by month (spec rule 24), computed from invoices and expenses, never typed by hand.
 * Cost of goods, gross margin, margin and net income need the `margin` flag (ADR 0055 S18); without
 * pay sight, payroll expenses are left out before anything is added up and the headers say so (S3).
 * Rows and totals hold only the visible columns. It reads stored invoices only (the API's report
 * rows, DemoStore's records), so it refuses an unknown cost (`storedPnl`; ADR 0037, 2026-11-17).
 */
export function pnlReport(
  query: PnlQuery,
  data: Pick<HubReportData, "today" | "invoices" | "expenses">,
  show: Pick<ReportVisibility, "margin" | "payroll">,
): Report {
  const w = hubWindow(query.range, data.today);
  const expenses = (show.payroll ? data.expenses : withoutPayroll(data.expenses)).filter((e) => e.date >= w.from);
  const months = storedPnl(monthlyPnl(w.months, hubInvoices(data.invoices, query, w), expenses));
  const columns: ReportColumn[] = [
    { id: "month", header: "Month", format: "month" },
    { id: "revenue", header: "Revenue", kind: "money" },
    ...(show.margin
      ? [
          { id: "cogs", header: "Cost of goods", kind: "money" as const },
          { id: "grossMargin", header: "Gross margin", kind: "money" as const },
          { id: "grossMarginPct", header: "Margin", kind: "percent" as const },
        ]
      : []),
    { id: "expenses", header: show.payroll ? "Expenses" : "Expenses, excluding payroll", kind: "money" },
    ...(show.margin
      ? [
          {
            id: "netIncome",
            header: show.payroll ? "Net income" : "Net income, before payroll",
            kind: "money" as const,
          },
        ]
      : []),
  ];
  const rows = months.map((m) => {
    const all: Record<string, string> = { ...m };
    return Object.fromEntries(columns.map((c) => [c.id, all[c.id] ?? ""]));
  });
  const money = columns.filter((c) => c.kind === "money").map((c) => c.id);
  return {
    title: "Profit and loss",
    columns,
    rows,
    totals: Object.fromEntries([["month", "Total"], ...money.map((id) => [id, total(rows, id)])]),
  };
}

/**
 * Sales by category (spec rule 24): line amounts and costs grouped by product category, returns
 * subtracted. Cost and Margin need the full `margin` flag, because margin is revenue less cost, and
 * are left out of the rows and the totals without it (ADR 0055 S6).
 */
export function salesByCategoryReport(
  query: SalesByCategoryQuery,
  data: Pick<HubReportData, "today" | "invoices" | "products">,
  show: Pick<ReportVisibility, "margin">,
): Report {
  const w = hubWindow(query.range, data.today);
  const rows = salesByCategory(hubInvoices(data.invoices, query, w), data.products)
    .filter((r) => !query.category || r.category === query.category)
    .map((r): Record<string, string> => {
      const category = salesCategoryLabel(r.category);
      return show.margin
        ? { category, revenue: r.revenue, cost: r.cost, margin: r.margin }
        : { category, revenue: r.revenue };
    });
  return {
    title: "Sales by category",
    columns: [
      { id: "category", header: "Category" },
      { id: "revenue", header: "Revenue", kind: "money" },
      ...(show.margin
        ? [
            { id: "cost", header: "Cost", kind: "money" as const },
            { id: "margin", header: "Margin", kind: "money" as const },
          ]
        : []),
    ],
    rows,
    totals: show.margin
      ? {
          category: "Total",
          revenue: total(rows, "revenue"),
          cost: total(rows, "cost"),
          margin: total(rows, "margin"),
        }
      : { category: "Total", revenue: total(rows, "revenue") },
  };
}

/**
 * Payments received (spec rule 24, Appendix A "Reports"): confirmed payments by their payment date,
 * in the warehouse of their invoice, with method and customer filters. The invoice number is looked
 * up among every invoice given, so a payment on an invoice issued before the dates still names it.
 */
export function paymentsReport(
  query: PaymentsReportQuery,
  data: Pick<HubReportData, "today" | "invoices" | "payments" | "customers">,
): Report {
  const w = hubWindow(query.range, data.today);
  const invoices = new Map(data.invoices.map((i) => [i.id, i]));
  const names = new Map(data.customers.map((c) => [c.id, c.name]));
  const nameOf = (id: string) => names.get(id) ?? "";
  const find = query.customer.trim().toLowerCase();
  const rows = data.payments
    .filter((p) => p.date >= w.from && p.date <= w.paymentsTo)
    .filter((p) => !query.locationId || invoices.get(p.invoiceId)?.locationId === query.locationId)
    .filter((p) => p.status === "confirmed" && (!query.method || p.method === query.method))
    .filter((p) => !find || nameOf(p.customerId).toLowerCase().includes(find))
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
    .map((p) => ({
      date: p.date,
      number: p.number,
      customer: nameOf(p.customerId),
      invoice: invoices.get(p.invoiceId)?.number ?? "",
      method: PAYMENT_METHOD_LABELS[p.method],
      reference: p.reference,
      amount: p.amount,
    }));
  return {
    title: "Payments received",
    columns: [
      { id: "date", header: "Date", format: "date" },
      { id: "number", header: "Payment" },
      { id: "customer", header: "Customer" },
      { id: "invoice", header: "Invoice" },
      { id: "method", header: "Method" },
      { id: "reference", header: "Reference" },
      { id: "amount", header: "Amount", kind: "money" },
    ],
    rows,
    totals: { date: "Total", amount: total(rows, "amount") },
  };
}
