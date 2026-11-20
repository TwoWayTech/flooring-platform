import { featureOn, type FeatureKey } from "../features";
import type { PermissionKey } from "../permissions/catalog";
import type { DataScope } from "../permissions/roles";
import type { Location } from "../types";

/**
 * The reports the hub can open on the API (spec "Purpose"); the four removed ones have no key here
 * (ADR 0055 S14). The trial balance reads the journal, which only the API keeps (ADR 0055 "Trial balance").
 */
export type ReportKey = "business" | "pnl" | "sales" | "payments" | "trial-balance";

/** How one report is opened, exported and switched. */
export interface ReportEntry {
  label: string;
  feature: FeatureKey;
  view: PermissionKey;
  export: PermissionKey;
  /**
   * Whether the report covers the whole company, so only data scope `all` may open it (ADR 0055 S1):
   * shared costs, balances, cash and taxes have no branch version, and a branch's share of a
   * company-wide cost would give away the other branches' revenue.
   */
  wholeCompany: boolean;
  /**
   * Whether the report reads the company's journal (ADR 0039). The demo keeps no journal, and the
   * API lists it only for people who may see every figure in it (`seesTrialBalance`), so it is
   * offered only when the caller says the books may be shown (`reportAccess`'s `books`).
   */
  books: boolean;
}

/** How each report is opened, exported and switched (spec "Who uses it"; ADR 0055 S1). */
export const REPORT_CATALOG: Readonly<Record<ReportKey, ReportEntry>> = {
  business: {
    label: "Business report",
    feature: "reports.business",
    view: "reports.financial.view",
    export: "reports.financial.export",
    wholeCompany: true,
    books: false,
  },
  pnl: {
    label: "Profit and loss",
    feature: "reports.pnl",
    view: "reports.financial.view",
    export: "reports.financial.export",
    wholeCompany: true,
    books: false,
  },
  sales: {
    label: "Sales by category",
    feature: "reports.sales-category",
    view: "reports.sales.view",
    export: "reports.sales.export",
    wholeCompany: false,
    books: false,
  },
  payments: {
    label: "Payments received",
    feature: "reports.payments",
    view: "reports.financial.view",
    export: "reports.financial.export",
    wholeCompany: false,
    books: false,
  },
  // No switch of its own: it was never in the demo, so it rides on the hub's (ADR 0055 "Trial balance").
  "trial-balance": {
    label: "Trial balance",
    feature: "reports.hub",
    view: "reports.financial.view",
    export: "reports.financial.export",
    wholeCompany: true,
    books: true,
  },
};

/** The reports in the order the page lists them (spec rule 1: the Business report first). */
export const REPORT_ORDER: readonly ReportKey[] = ["business", "pnl", "sales", "payments", "trial-balance"];

/** Said when a branch- or own-scoped person asks for a company-wide report (ADR 0055 S1). */
export const REPORT_WHOLE_COMPANY = "This report covers the whole company.";

/**
 * Which reports a person may open and export (spec "Who uses it"; ADR 0055 S1 and S15): the report's
 * view key, its switch and `reports.hub`, and data scope `all` where the report is company-wide. A
 * report is exportable only when it can also be opened. `permissions` are the effective ones, so a
 * switched-off module's keys are already gone. `books` says whether the journal's reports may be
 * offered: only the API passes true, and only for someone `seesTrialBalance` lets see every figure
 * in the journal; the demo keeps no journal (ADR 0055 "Trial balance").
 */
export function reportAccess(
  viewer: { permissions: ReadonlySet<PermissionKey>; dataScope: DataScope },
  isOn: (key: FeatureKey) => boolean = featureOn,
  books = false,
): { reports: ReportKey[]; exports: ReportKey[] } {
  if (!isOn("reports.hub")) return { reports: [], exports: [] };
  const reports = REPORT_ORDER.filter((key) => {
    const entry = REPORT_CATALOG[key];
    return (
      isOn(entry.feature) &&
      viewer.permissions.has(entry.view) &&
      (!entry.wholeCompany || viewer.dataScope === "all") &&
      (!entry.books || books)
    );
  });
  return { reports, exports: reports.filter((key) => viewer.permissions.has(REPORT_CATALOG[key].export)) };
}

/** What GET /reports/options answers (and DemoStore.reportOptions): what the page may offer this person. */
export interface ReportOptions {
  reports: ReportKey[];
  exports: ReportKey[];
  locations: Pick<Location, "id" | "name" | "kind">[];
  /** Business report pickers; empty unless "business" is in `reports`. */
  salespeople: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
}

/** What a person with no report sees (HTTP 403 `forbidden` or 404; demo: no key or the hub off). */
export const EMPTY_REPORT_OPTIONS: Readonly<ReportOptions> = Object.freeze({
  reports: [],
  exports: [],
  locations: [],
  salespeople: [],
  vendors: [],
});
