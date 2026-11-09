import { format, parseISO } from "date-fns";
import {
  AGING_BUCKETS,
  agingSummary,
  dec,
  inventoryByCategory,
  openAmounts,
  openBillAmounts,
  PAYMENT_METHOD_LABELS,
  type BoxedStock,
  type Bill,
  type BillLedger,
  type Customer,
  type InvoiceLedger,
  type Supplier,
  type Payment,
  type PaymentMethod,
  monthlyPnl,
  salesByCategory,
  salesTaxByJurisdiction,
  sum,
  TAX_CATEGORY_LABELS,
  type Expense,
  type Invoice,
  type NumberKind,
  type Product,
  type Roll,
  type TaxCategory,
} from "@workspace/shared";
import { CATEGORY_LABELS } from "@workspace/shared";

/** A report column; numeric columns carry the number kind used to format them. */
export interface ReportColumn {
  id: string;
  header: string;
  kind?: NumberKind;
}

/** A report as data: what the table shows, the CSV holds and the PDF prints (spec "Reports hub"). */
export interface Report {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string>[];
  totals: Record<string, string> | null;
}

/** The documents a report reads, already filtered by date and warehouse. */
export interface ReportInput {
  months: string[];
  invoices: Invoice[];
  expenses: Expense[];
  products: Product[];
  rolls: Roll[];
  /** Boxed stock on hand at the chosen warehouse, or across all. */
  boxed: BoxedStock;
  category: string | null;
  showCost: boolean;
  /** Payments of the chosen dates and warehouse, with the customers they came from (Payments received). */
  payments: Payment[];
  customers: Customer[];
  method: PaymentMethod | null;
  /** Part of a customer's name; empty means every customer. */
  customerQuery: string;
  dateFormat: string;
  /** Every invoice's ledger, for balances (aging). */
  ledgers: ReadonlyMap<string, InvoiceLedger>;
  today: string;
  /** Supplier bills and their ledgers, for payables aging. */
  bills: Bill[];
  billLedgers: ReadonlyMap<string, BillLedger>;
  suppliers: Supplier[];
}

/** A category key as people say it: product categories and, for services, the tax category. */
export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key as keyof typeof CATEGORY_LABELS] ?? TAX_CATEGORY_LABELS[key as TaxCategory] ?? key;
}

const total = (rows: Record<string, string>[], id: string) => sum(rows.map((r) => r[id] ?? "0")).toString();

/**
 * Payments received (spec Appendix A "Reports"): confirmed payments by their payment date, with
 * method and customer filters. The CSV and PDF print these same rows, so they match the table.
 */
export function paymentsReport({
  payments,
  invoices,
  customers,
  method,
  customerQuery,
  dateFormat,
}: ReportInput): Report {
  const query = customerQuery.trim().toLowerCase();
  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? "";
  const rows = payments
    .filter((p) => p.status === "confirmed" && (!method || p.method === method))
    .filter((p) => !query || nameOf(p.customerId).toLowerCase().includes(query))
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
    .map((p) => ({
      date: format(parseISO(p.date), dateFormat),
      number: p.number,
      customer: nameOf(p.customerId),
      invoice: invoices.find((i) => i.id === p.invoiceId)?.number ?? "",
      method: PAYMENT_METHOD_LABELS[p.method],
      reference: p.reference,
      amount: p.amount,
    }));
  return {
    title: "Payments received",
    columns: [
      { id: "date", header: "Date" },
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

/**
 * Receivables aging (spec B5, moved here from the customers page): each customer's open balance
 * in the current, 1–30, 31–60, 61–90 and over-90-days buckets, adding up to their total and to
 * the company's open receivables.
 */
export function agingReport({ invoices, customers, ledgers, today }: ReportInput): Report {
  const keys = AGING_BUCKETS.map((b) => b.key);
  const rows = customers
    .map((customer) => {
      const own = invoices.filter((i) => i.customerId === customer.id);
      const aging = agingSummary(openAmounts(own, ledgers), today);
      return { customer: customer.name, ...aging };
    })
    .filter((r) => dec(r.total).gt(0))
    .sort((a, b) => dec(b.total).comparedTo(a.total));
  return {
    title: "Receivables aging",
    columns: [
      { id: "customer", header: "Customer" },
      ...AGING_BUCKETS.map((b) => ({ id: b.key, header: b.label, kind: "money" as const })),
      { id: "total", header: "Total", kind: "money" },
    ],
    rows,
    totals: Object.fromEntries([["customer", "Total"], ...[...keys, "total"].map((id) => [id, total(rows, id)])]),
  };
}

/** Payables aging by supplier (spec D3: detailed aging in Reports), as of today. */
export function payablesAgingReport({ bills, billLedgers, suppliers, today }: ReportInput): Report {
  const keys = AGING_BUCKETS.map((b) => b.key);
  const rows = suppliers
    .map((supplier) => {
      const own = bills.filter((b) => b.supplierId === supplier.id);
      return { supplier: supplier.name, ...agingSummary(openBillAmounts(own, billLedgers), today) };
    })
    .filter((r) => dec(r.total).gt(0))
    .sort((a, b) => dec(b.total).comparedTo(a.total));
  return {
    title: "Payables aging",
    columns: [
      { id: "supplier", header: "Supplier" },
      ...AGING_BUCKETS.map((b) => ({ id: b.key, header: b.label, kind: "money" as const })),
      { id: "total", header: "Total", kind: "money" },
    ],
    rows,
    totals: Object.fromEntries([["supplier", "Total"], ...[...keys, "total"].map((id) => [id, total(rows, id)])]),
  };
}

/** Profit and loss by month, computed from invoices and expenses, never typed by hand (spec section 4). */
export function pnlReport({ months, invoices, expenses }: ReportInput): Report {
  const rows = monthlyPnl(months, invoices, expenses).map(
    (m) => ({ ...m, month: format(parseISO(`${m.month}-01`), "MMM yyyy") }) as unknown as Record<string, string>,
  );
  const ids = ["revenue", "cogs", "grossMargin", "expenses", "netIncome"];
  return {
    title: "Profit and loss",
    columns: [
      { id: "month", header: "Month" },
      { id: "revenue", header: "Revenue", kind: "money" },
      { id: "cogs", header: "Cost of goods", kind: "money" },
      { id: "grossMargin", header: "Gross margin", kind: "money" },
      { id: "grossMarginPct", header: "Margin", kind: "percent" },
      { id: "expenses", header: "Expenses", kind: "money" },
      { id: "netIncome", header: "Net income", kind: "money" },
    ],
    rows,
    totals: Object.fromEntries([["month", "Total"], ...ids.map((id) => [id, total(rows, id)])]),
  };
}

/** Sales by category, with cost and margin only for people who may see costs. */
export function salesByCategoryReport({ invoices, products, category, showCost }: ReportInput): Report {
  const rows = salesByCategory(invoices, products)
    .filter((r) => !category || r.category === category)
    .map((r) => ({ ...r, category: categoryLabel(r.category) }));
  return {
    title: "Sales by category",
    columns: [
      { id: "category", header: "Category" },
      { id: "revenue", header: "Revenue", kind: "money" },
      ...(showCost
        ? [
            { id: "cost", header: "Cost", kind: "money" as const },
            { id: "margin", header: "Margin", kind: "money" as const },
          ]
        : []),
    ],
    rows,
    totals: {
      category: "Total",
      revenue: total(rows, "revenue"),
      cost: total(rows, "cost"),
      margin: total(rows, "margin"),
    },
  };
}

/** Sales tax collected by jurisdiction, from the rule each invoice stored (blueprint "Sales tax reports"). */
export function salesTaxReport({ invoices }: ReportInput): Report {
  const rows = salesTaxByJurisdiction(invoices).map((r) => ({ ...r }));
  return {
    title: "Sales tax by jurisdiction",
    columns: [
      { id: "state", header: "State" },
      { id: "jurisdiction", header: "Jurisdiction" },
      { id: "ratePct", header: "Rate", kind: "taxRate" },
      { id: "sales", header: "Sales", kind: "money" },
      { id: "exemptSales", header: "Exempt sales", kind: "money" },
      { id: "tax", header: "Tax collected", kind: "money" },
    ],
    rows,
    totals: {
      state: "Total",
      sales: total(rows, "sales"),
      exemptSales: total(rows, "exemptSales"),
      tax: total(rows, "tax"),
    },
  };
}

/** Inventory value by category: rolls at their own cost, boxed goods at average cost. */
export function inventoryReport({ products, rolls, boxed, category }: ReportInput): Report {
  const rows = inventoryByCategory(products, rolls, boxed)
    .filter((r) => !category || r.category === category)
    .map((r) => ({ category: categoryLabel(r.category), value: r.value }));
  return {
    title: "Inventory valuation",
    columns: [
      { id: "category", header: "Category" },
      { id: "value", header: "Value at cost", kind: "money" },
    ],
    rows,
    totals: { category: "Total", value: total(rows, "value") },
  };
}
