import { featureOn, type FeatureKey } from "../features";
import type { PermissionKey } from "../permissions/catalog";
import type { DataScope } from "../permissions/roles";
import type { Location } from "../types";

/** The reports the hub can open on the API (spec "Purpose"); the four removed ones have no key here (ADR 0055 S14). */
export type ReportKey = "business" | "pnl" | "sales" | "payments";

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
}

/** How each report is opened, exported and switched (spec "Who uses it"; ADR 0055 S1). */
export const REPORT_CATALOG: Readonly<Record<ReportKey, ReportEntry>> = {
  business: {
    label: "Business report",
    feature: "reports.business",
    view: "reports.financial.view",
    export: "reports.financial.export",
    wholeCompany: true,
  },
  pnl: {
    label: "Profit and loss",
    feature: "reports.pnl",
    view: "reports.financial.view",
    export: "reports.financial.export",
    wholeCompany: true,
  },
  sales: {
    label: "Sales by category",
    feature: "reports.sales-category",
    view: "reports.sales.view",
    export: "reports.sales.export",
    wholeCompany: false,
  },
  payments: {
    label: "Payments received",
    feature: "reports.payments",
    view: "reports.financial.view",
    export: "reports.financial.export",
    wholeCompany: false,
  },
};

/** The reports in the order the page lists them (spec rule 1: the Business report first). */
export const REPORT_ORDER: readonly ReportKey[] = ["business", "pnl", "sales", "payments"];

/** Said when a branch- or own-scoped person asks for a company-wide report (ADR 0055 S1). */
export const REPORT_WHOLE_COMPANY = "This report covers the whole company.";

/**
 * Which reports a person may open and export (spec "Who uses it"; ADR 0055 S1 and S15): the report's
 * view key, its switch and `reports.hub`, and data scope `all` where the report is company-wide. A
 * report is exportable only when it can also be opened. `permissions` are the effective ones, so a
 * switched-off module's keys are already gone.
 */
export function reportAccess(
  viewer: { permissions: ReadonlySet<PermissionKey>; dataScope: DataScope },
  isOn: (key: FeatureKey) => boolean = featureOn,
): { reports: ReportKey[]; exports: ReportKey[] } {
  if (!isOn("reports.hub")) return { reports: [], exports: [] };
  const reports = REPORT_ORDER.filter((key) => {
    const entry = REPORT_CATALOG[key];
    return (
      isOn(entry.feature) && viewer.permissions.has(entry.view) && (!entry.wholeCompany || viewer.dataScope === "all")
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
