import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BusinessData, BusinessFilters, BusinessReport, BusinessRow, CompanyFixtures } from "../src";

/** A seeded company from packages/shared/fixtures. */
export const loadFixtures = (name: "summit" | "keystone") =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), "utf8"),
  ) as CompanyFixtures;

/** Everything the Business report reads, from a seeded company's whole record (as DemoStore passes it). */
export const businessDataOf = (f: CompanyFixtures): BusinessData => ({
  invoices: f.invoices,
  payments: f.payments,
  adjustments: f.invoiceAdjustments,
  refunds: f.refunds,
  expenses: f.expenses,
  bills: f.bills,
  supplierPayments: f.supplierPayments,
  receipts: f.receipts,
  purchaseOrders: f.purchaseOrders,
  suppliers: f.suppliers,
  users: f.users,
  employees: f.employees,
  locations: f.locations,
  productCategories: f.products,
  products: f.products,
  rolls: f.rolls,
  stockMovements: f.stockMovements,
  payPeriods: f.payPeriods,
  settings: f.settings,
  today: f.anchorDate,
});

/** No filter but the period. */
export const NO_FILTERS: Omit<BusinessFilters, "from" | "to"> = {
  locationIds: [],
  productCategory: null,
  expenseCategory: null,
  salesRepId: null,
  supplierId: null,
};

/** Every row of a report, totals included, with the key of the section it is in. */
export const rowsOf = (report: BusinessReport): { section: string; row: BusinessRow }[] =>
  report.sections.flatMap((s) => [...s.rows, ...(s.total ? [s.total] : [])].map((row) => ({ section: s.key, row })));

/** A section by key; the test fails when it is missing. */
export const sectionOf = (report: BusinessReport, key: string) => {
  const section = report.sections.find((s) => s.key === key);
  if (!section) throw new Error(`No section ${key}`);
  return section;
};

/** A Summary row's This period value. */
export const summaryValue = (report: BusinessReport, id: string) =>
  sectionOf(report, "summary").rows.find((r) => r.id === id)?.values.now;
