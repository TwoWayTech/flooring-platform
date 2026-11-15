// Removed reports' builders, kept by rule 25; bringing one back needs an API route first (ADR 0055 S14).
// The page no longer lists them, and their switches are `removed`, so nothing calls these today.
import {
  AGING_BUCKETS,
  agingSummary,
  dec,
  inventoryByCategory,
  openAmounts,
  openBillAmounts,
  salesCategoryLabel,
  salesTaxByJurisdiction,
  sum,
  type Bill,
  type BillLedger,
  type BoxedStock,
  type Customer,
  type Invoice,
  type InvoiceLedger,
  type Product,
  type Report,
  type Roll,
  type Supplier,
} from "@workspace/shared";

/** The documents the removed reports read, already filtered by warehouse. */
export interface ReportInput {
  invoices: Invoice[];
  products: Product[];
  rolls: Roll[];
  /** Boxed stock on hand at the chosen warehouse, or across all. */
  boxed: BoxedStock;
  category: string | null;
  customers: Customer[];
  /** Every invoice's ledger, for balances (aging). */
  ledgers: ReadonlyMap<string, InvoiceLedger>;
  today: string;
  /** Supplier bills and their ledgers, for payables aging. */
  bills: Bill[];
  billLedgers: ReadonlyMap<string, BillLedger>;
  suppliers: Supplier[];
}

/** The sum of a column over the rows. */
const total = (rows: Record<string, string>[], id: string) => sum(rows.map((r) => r[id] ?? "0")).toString();

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
    .map((r) => ({ category: salesCategoryLabel(r.category), value: r.value }));
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
