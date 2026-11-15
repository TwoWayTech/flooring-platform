import {
  businessReport,
  capDrillRecords,
  EMPTY_REPORT_OPTIONS,
  featureOn,
  paymentsReport,
  pnlReport,
  REPORT_CATALOG,
  REPORT_CUSTOMER_SEARCH_MAX,
  REPORT_QUERY_MESSAGES as M,
  REPORT_WHOLE_COMPANY,
  reportAccess,
  reportDayProblem,
  reportPeriodProblem,
  reportVisibility,
  salesByCategoryReport,
  scopeAllows,
  type Access,
  type BusinessFilters,
  type BusinessReport,
  type Customer,
  type Invoice,
  type PaymentsReportQuery,
  type PnlQuery,
  type Report,
  type ReportKey,
  type ReportOptions,
  type ReportVisibility,
  type SalesByCategoryQuery,
  type ScopeViewer,
} from "@workspace/shared";
import { DemoRuleError } from "./admin-rules";
import type { CompanyDb } from "./company-db";
import type { ScopeSubject } from "./scope";

/** Who asks for a report in the demo: their effective access, whose records count as theirs, and today. */
export interface ReportViewer {
  access: Access;
  subject: ScopeSubject;
  today: string;
}

/** What the demo says where the API answers 404 for a switched-off report or hub (ADR 0055 "Switches"). */
const SWITCHED_OFF = "This report is switched off.";
/** Who a rep no longer among the company's users reads as (spec rule 15), as on the API. */
const FORMER_EMPLOYEE = "Former employee";

/** Names sorted as the API sorts them: by name in English, then by id, so ties never shuffle. */
const byName = (a: { id: string; name: string }, b: { id: string; name: string }) =>
  a.name.localeCompare(b.name, "en") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * What the viewer may see inside reports, by the API's rule (ADR 0055 "Visibility"): effective
 * permissions plus one fact of the data, whether a live invoice has a contract (S4).
 */
function visibility(db: CompanyDb, viewer: ReportViewer): ReportVisibility {
  return reportVisibility(viewer.access, { hasContractInvoices: db.list("invoices").some((i) => !!i.contractId) });
}

/**
 * Refuses a report the API would not open, in the API's order after the permission check: its
 * switches (the API's 404), then data scope `all` where the report covers the whole company (S1).
 */
function assertOpens(viewer: ReportViewer, key: ReportKey): void {
  if (!featureOn("reports.hub") || !featureOn(REPORT_CATALOG[key].feature)) throw new DemoRuleError(SWITCHED_OFF);
  if (REPORT_CATALOG[key].wholeCompany && viewer.access.dataScope !== "all") {
    throw new DemoRuleError(REPORT_WHOLE_COMPANY);
  }
}

/** The viewer as the shared scope rule reads them; no branch never widens what they see. */
function scopeViewer(viewer: ReportViewer): ScopeViewer {
  return { userId: viewer.subject.user.id, branchId: viewer.subject.user.branchId || null };
}

/**
 * Whether the viewer's data scope covers an invoice, by the rule of GET /invoices (`seesDocument`;
 * ADR 0055 S2): own by the rep, or branch by the invoice's branch (own or branch, `scopeAllows`).
 */
function seesInvoice(viewer: ReportViewer, invoice: Pick<Invoice, "salesRepId" | "branchId">): boolean {
  return scopeAllows(viewer.subject.scope, scopeViewer(viewer), {
    ownerUserId: invoice.salesRepId,
    branchId: invoice.branchId,
  });
}

/** Whether the viewer's data scope covers a customer, by the API's `seesCustomer`: own by rep, branch by the rep's branch. */
function seesCustomer(db: CompanyDb, viewer: ReportViewer, customer: Pick<Customer, "salesRepId">): boolean {
  return scopeAllows(viewer.subject.scope, scopeViewer(viewer), {
    ownerUserId: customer.salesRepId || null,
    branchId: db.get("users", customer.salesRepId)?.branchId || null,
  });
}

/** A hub report's warehouse must be a live warehouse, where invoices ship from (rule 24; S10). */
function assertWarehouse(db: CompanyDb, locationId: string | null): void {
  if (locationId !== null && !db.list("locations").some((l) => l.id === locationId && l.kind === "warehouse")) {
    throw new DemoRuleError(M.warehouse);
  }
}

/**
 * What the reports page may offer the viewer, as GET /reports/options answers it (ADR 0055 S1, S15).
 * With the hub off or neither view key held it gives EMPTY_REPORT_OPTIONS instead of refusing, as the
 * HTTP client reads the API's 404 and 403 (C14). The salesperson and vendor pickers are filled only
 * when the viewer may open the Business report.
 */
export function demoReportOptions(db: CompanyDb, viewer: ReportViewer): ReportOptions {
  const holdsKey =
    viewer.access.permissions.has("reports.sales.view") || viewer.access.permissions.has("reports.financial.view");
  if (!featureOn("reports.hub") || !holdsKey) return EMPTY_REPORT_OPTIONS;
  const { reports, exports } = reportAccess(viewer.access, featureOn);
  const pickers = reports.includes("business");
  const repIds = pickers ? [...new Set(db.list("invoices").map((i) => i.salesRepId))] : [];
  return {
    reports,
    exports,
    locations: db.list("locations").map(({ id, name, kind }) => ({ id, name, kind })),
    salespeople: repIds.map((id) => ({ id, name: db.get("users", id)?.name ?? FORMER_EMPLOYEE })).sort(byName),
    vendors: pickers
      ? db
          .list("suppliers")
          .map(({ id, name }) => ({ id, name }))
          .sort(byName)
      : [],
  };
}

/**
 * The Business report (spec F2), by the API's rules (ADR 0055): switched on, data scope `all` (S1),
 * two real days at most 366 days apart (S8), live locations only (S10), then the shared calculation
 * with the viewer's visibility and the drill lists capped at 200 per row.
 */
export function demoBusinessReport(db: CompanyDb, viewer: ReportViewer, filters: BusinessFilters): BusinessReport {
  assertOpens(viewer, "business");
  const problem =
    reportDayProblem(filters.from) ?? reportDayProblem(filters.to) ?? reportPeriodProblem(filters.from, filters.to);
  if (problem) throw new DemoRuleError(problem);
  const live = new Set(db.list("locations").map((l) => l.id));
  if (filters.locationIds.some((id) => !live.has(id))) throw new DemoRuleError(M.locations);
  const report = businessReport(
    {
      invoices: db.list("invoices"),
      payments: db.list("payments"),
      adjustments: db.list("invoiceAdjustments"),
      refunds: db.list("refunds"),
      expenses: db.list("expenses"),
      bills: db.list("bills"),
      supplierPayments: db.list("supplierPayments"),
      receipts: db.list("receipts"),
      purchaseOrders: db.list("purchaseOrders"),
      suppliers: db.list("suppliers"),
      users: db.list("users"),
      employees: db.list("employees"),
      locations: db.list("locations"),
      productCategories: db.list("products"),
      products: db.list("products"),
      rolls: db.list("rolls"),
      stockMovements: db.list("stockMovements"),
      payPeriods: db.list("payPeriods"),
      settings: db.settings,
      today: viewer.today,
    },
    filters,
    visibility(db, viewer),
  );
  return capDrillRecords(report);
}

/** Profit and loss by month (spec rule 24), by the API's rules: data scope `all` (S1), a live warehouse, the viewer's visibility (S18). */
export function demoPnlReport(db: CompanyDb, viewer: ReportViewer, query: PnlQuery): Report {
  assertOpens(viewer, "pnl");
  assertWarehouse(db, query.locationId);
  const data = { today: viewer.today, invoices: db.list("invoices"), expenses: db.list("expenses") };
  return pnlReport(query, data, visibility(db, viewer));
}

/** Sales by category (spec rule 24) over the invoices in the viewer's data scope, by the API's rules (S2, S6). */
export function demoSalesByCategoryReport(db: CompanyDb, viewer: ReportViewer, query: SalesByCategoryQuery): Report {
  assertOpens(viewer, "sales");
  assertWarehouse(db, query.locationId);
  const invoices = db.list("invoices").filter((i) => seesInvoice(viewer, i));
  return salesByCategoryReport(
    query,
    { today: viewer.today, invoices, products: db.list("products") },
    visibility(db, viewer),
  );
}

/**
 * Payments received (spec rule 24), by the API's rules (S2): payments on invoices in the viewer's
 * data scope, and customer names only for customers in it; any other customer reads with no name.
 */
export function demoPaymentsReport(db: CompanyDb, viewer: ReportViewer, query: PaymentsReportQuery): Report {
  assertOpens(viewer, "payments");
  // The query is read before the warehouse, as on the API (its parser, then its service).
  if (query.customer.trim().length > REPORT_CUSTOMER_SEARCH_MAX) throw new DemoRuleError(M.customer);
  assertWarehouse(db, query.locationId);
  const invoices = db.list("invoices").filter((i) => seesInvoice(viewer, i));
  const seen = new Set(invoices.map((i) => i.id));
  return paymentsReport(query, {
    today: viewer.today,
    invoices,
    payments: db.list("payments").filter((p) => seen.has(p.invoiceId)),
    customers: db.list("customers").filter((c) => seesCustomer(db, viewer, c)),
  });
}
