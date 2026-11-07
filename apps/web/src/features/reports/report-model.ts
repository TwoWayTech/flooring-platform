import { format, parseISO } from "date-fns";
import {
  inventoryByCategory,
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
import { CATEGORY_LABELS } from "@/lib/labels";

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

/** The documents a report reads, already filtered by date and branch. */
export interface ReportInput {
  months: string[];
  invoices: Invoice[];
  expenses: Expense[];
  products: Product[];
  rolls: Roll[];
  category: string | null;
  showCost: boolean;
}

/** A category key as people say it: product categories and, for services, the tax category. */
export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key as keyof typeof CATEGORY_LABELS] ?? TAX_CATEGORY_LABELS[key as TaxCategory] ?? key;
}

const total = (rows: Record<string, string>[], id: string) => sum(rows.map((r) => r[id] ?? "0")).toString();

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
export function inventoryReport({ products, rolls, category }: ReportInput): Report {
  const rows = inventoryByCategory(products, rolls)
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
