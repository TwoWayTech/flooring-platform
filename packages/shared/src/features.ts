import { MODULES, type ModuleInfo, type ModuleKey, type ProductKey } from "./products";

/**
 * Where a feature stands in docs/FEATURES.md: shown in the demo, confirmed for the real build,
 * deferred, or dropped. A removed feature is always switched off.
 */
export type FeatureStatus = "demo" | "build" | "later" | "removed";

/** The product a feature belongs to; "both" marks platform features every product has. */
export type FeatureProduct = ProductKey | "both";

/** One feature of the demo, switchable by its key (docs/FEATURES.md holds the full register). */
export interface Feature {
  title: string;
  product: FeatureProduct;
  module: ModuleKey;
  status: FeatureStatus;
  /** The switch. Off hides the feature's screens, menu items, tabs, buttons and actions. */
  enabled: boolean;
  /**
   * Routes the feature owns. "/path" matches that path with any query, "/path?view=x" matches
   * that view of it, and "/path/*" matches every page below it. Shell features own no route.
   */
  screens: readonly string[];
}

/**
 * The feature register. To switch a feature off, set `enabled: false`; every screen, menu item,
 * tab, button and command of that feature then disappears (.claude/commands/feature-change.md).
 */
export const FEATURES = {
  "dashboard.store": {
    title: "Store dashboard",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/"],
  },
  "units.square-feet": {
    title: "Square feet with carton hints",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "inventory.products": {
    title: "Product catalog",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/inventory?view=products"],
  },
  "inventory.rolls": {
    title: "Rolls, cuts and remnants",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/inventory?view=rolls", "/inventory/rolls/*"],
  },
  "inventory.transfers": {
    title: "Warehouse transfers",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/inventory?view=transfers"],
  },
  "inventory.adjustments": {
    title: "Stock adjustments and reservations",
    product: "flooring",
    module: "core",
    status: "removed",
    enabled: false,
    screens: ["/inventory?view=adjustments"],
  },
  "inventory.reservations": {
    title: "Reservations and cuts",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "inventory.stock-correction": {
    title: "Correct stock count",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "inventory.ready-to-cut": {
    title: "Ready to cut",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/inventory?view=ready"],
  },
  "inventory.locations": {
    title: "Warehouses and showrooms",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/settings/locations"],
  },
  "sales.quote-availability": {
    title: "Availability per warehouse on quotes",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "sales.quotes": {
    title: "Quotes and quote builder",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/sales?view=quotes", "/sales/quotes/*"],
  },
  "sales.invoices": {
    title: "Invoices and invoice PDF",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/sales?view=invoices", "/sales/invoices/*"],
  },
  "sales.payments": {
    title: "Customer payments",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/settings/payments"],
  },
  "sales.team": {
    title: "Sales team and commissions",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/sales?view=team"],
  },
  "sales.customers": {
    title: "Customers and receivables",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/sales?view=customers"],
  },
  "purchasing.suppliers": {
    title: "Suppliers directory",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/purchasing?view=suppliers"],
  },
  "finance.payments-queue": {
    title: "Payments to verify",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/finance?view=payments"],
  },
  "finance.expenses": {
    title: "Expenses",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/finance?view=expenses", "/settings/expenses"],
  },
  "purchasing.orders": {
    title: "Suppliers, purchase orders and payables",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/purchasing"],
  },
  "installation.calendar": {
    title: "Installation calendar and job cards",
    product: "flooring",
    module: "installation",
    status: "removed",
    enabled: false,
    screens: ["/installation"],
  },
  "reports.hub": {
    title: "Reports hub",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: ["/reports"],
  },
  "reports.business": {
    title: "Business report",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "reports.pnl": {
    title: "Profit and loss report",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "reports.sales-category": {
    title: "Sales by category report",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "reports.payments": {
    title: "Payments received report",
    product: "flooring",
    module: "core",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "reports.tax-jurisdiction": {
    title: "Sales tax by jurisdiction report",
    product: "flooring",
    module: "core",
    status: "removed",
    enabled: false,
    screens: [],
  },
  "reports.inventory-valuation": {
    title: "Inventory valuation report",
    product: "flooring",
    module: "core",
    status: "removed",
    enabled: false,
    screens: [],
  },
  "reports.receivables-aging": {
    title: "Receivables aging report",
    product: "flooring",
    module: "core",
    status: "removed",
    enabled: false,
    screens: [],
  },
  "reports.payables-aging": {
    title: "Payables aging report",
    product: "flooring",
    module: "core",
    status: "removed",
    enabled: false,
    screens: [],
  },
  "contracts.register": {
    title: "Contracts with customers and subcontractors",
    product: "flooring",
    module: "contracts",
    status: "demo",
    enabled: true,
    screens: ["/contracts", "/contracts/*"],
  },
  "contracts.billing": {
    title: "Progress billing, retainage and change orders",
    product: "flooring",
    module: "contracts",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "contracts.compliance": {
    title: "Insurance certificates and lien waivers",
    product: "flooring",
    module: "contracts",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "hr.commissions": {
    title: "Commission plans and statements",
    product: "flooring",
    module: "hr",
    status: "demo",
    enabled: true,
    screens: ["/hr/commissions"],
  },
  "hr.pay-periods": {
    title: "Pay periods and gross pay",
    product: "both",
    module: "hr",
    status: "demo",
    enabled: true,
    screens: ["/hr/pay-periods"],
  },
  /**
   * California overtime and pay rules (ADR 0024): daily and seventh-day overtime and double time,
   * the flat-sum bonus premium and the 40-hour California salary. Off until a qualified payroll
   * person reviews them (owner, 2026-11-14; ADR 0050): everyone is then paid on the federal
   * weekly rule. California's refusals (exempt salary floor, monthly pay, vacation carryover) stay
   * on whatever this switch says.
   */
  "hr.payroll.california": {
    title: "California overtime and pay rules",
    product: "both",
    module: "hr",
    status: "build",
    enabled: false,
    screens: [],
  },
  "hr.portal": {
    title: "Employee portal",
    product: "both",
    module: "hr",
    status: "demo",
    enabled: true,
    screens: ["/my", "/my/*"],
  },
  "hr.clock": {
    title: "Clock in and out",
    product: "both",
    module: "hr",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "settings.hr": {
    title: "HR settings",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/hr"],
  },
  "hr.dashboard": {
    title: "HR dashboard",
    product: "hr",
    module: "hr",
    status: "demo",
    enabled: true,
    screens: ["/", "/hr"],
  },
  "hr.employees": {
    title: "Employees",
    product: "hr",
    module: "hr",
    status: "demo",
    enabled: true,
    screens: ["/hr/employees"],
  },
  "hr.timesheets": {
    title: "Timesheets and overtime",
    product: "hr",
    module: "hr",
    status: "demo",
    enabled: true,
    screens: ["/hr/timesheets"],
  },
  "hr.time-off": {
    title: "Time off",
    product: "hr",
    module: "hr",
    status: "demo",
    enabled: true,
    screens: ["/hr/time-off"],
  },
  "meetings.invites": {
    title: "Guests, invites and replies",
    product: "both",
    module: "meetings",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "meetings.requests": {
    title: "Request a meeting",
    product: "both",
    module: "meetings",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "settings.meetings": {
    title: "Meeting settings",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/meetings"],
  },
  "meetings.calendar": {
    title: "Meetings calendar",
    product: "both",
    module: "meetings",
    status: "demo",
    enabled: true,
    screens: ["/meetings"],
  },
  "settings.users": {
    title: "Users and seats",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/users"],
  },
  "settings.roles": {
    title: "Security roles",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/roles"],
  },
  "settings.branding": {
    title: "Branding",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/branding"],
  },
  "settings.localization": {
    title: "Localization and sales tax",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/localization", "/settings/documents"],
  },
  "settings.number-format": {
    title: "Number format",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/number-format"],
  },
  "settings.company": {
    title: "Company profile",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/company"],
  },
  "settings.import": {
    title: "Data import wizard",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/import", "/admin/companies/*/import"],
  },
  "settings.database": {
    title: "Connect a database (simulated test)",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/database", "/admin/companies/*/database"],
  },
  "settings.audit": {
    title: "Audit log",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/audit"],
  },
  "admin.access": {
    title: "Platform admin: plans, modules and ceilings",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/admin", "/admin/*"],
  },
  "auth.mfa": {
    title: "Sign-in code step",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "auth.step-up": {
    title: "Code check before high-impact changes",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "settings.notifications": {
    title: "Email and notifications",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/settings/notifications"],
  },
  "settings.outbox": {
    title: "Outbox",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: ["/outbox", "/settings/outbox"],
  },
  "shell.company-switcher": {
    title: "Company switcher",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "shell.view-as": {
    title: "View as a role",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "shell.command-palette": {
    title: "Command palette",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "shell.tables": {
    title: "Table filters and saved views",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "shell.addresses": {
    title: "Address suggestions",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "shell.notifications": {
    title: "Notifications",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "shell.presenter-guide": {
    title: "Presenter guide",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "shell.network-simulation": {
    title: "Simulated slow or offline network",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
  "demo.reset": {
    title: "Reset demo data",
    product: "both",
    module: "platform",
    status: "demo",
    enabled: true,
    screens: [],
  },
} as const satisfies Record<string, Feature>;

/** A feature's key, the name used in code, docs/FEATURES.md and feature-change ADRs. */
export type FeatureKey = keyof typeof FEATURES;

/** Every feature key, in register order. */
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** The register as plain data; tests pass a modified copy to try a switch. */
export type FeatureRegister = Record<FeatureKey, Feature>;

/** True when the feature is switched on. A removed feature is off whatever its switch says. */
export function featureOn(key: FeatureKey, register: FeatureRegister = FEATURES): boolean {
  const feature = register[key];
  return feature.enabled && feature.status !== "removed";
}

/**
 * How closely a screen pattern matches a page: 0 for no match, higher for a more specific match.
 * Feature screens and page permissions (apps/web/src/products/pages.ts) use the same patterns.
 */
export function pagePatternScore(pattern: string, pathname: string, view: string | null): number {
  if (pattern.endsWith("/*")) return pathname.startsWith(pattern.slice(0, -1)) ? 3 : 0;
  const [path, query = ""] = pattern.split("?");
  if (path !== pathname) return 0;
  const patternView = new URLSearchParams(query).get("view");
  if (!patternView) return 1;
  return patternView === view ? 2 : 0;
}

/** Features of the product itself win over the other product's on a shared path such as "/". */
function productScore(feature: Feature, product: ProductKey): number {
  if (feature.product === product) return 2;
  return feature.product === "both" ? 1 : 0;
}

/**
 * The feature that owns a page or link (for example "/sales?view=invoices&status=overdue"), or
 * null for pages no feature owns, such as sign-in or a section that holds several features.
 */
export function featureForPath(
  product: ProductKey,
  href: string,
  register: FeatureRegister = FEATURES,
): FeatureKey | null {
  const [pathname = "", query = ""] = href.split("?");
  const view = new URLSearchParams(query).get("view");
  let best: { key: FeatureKey; rank: number } | null = null;
  for (const key of FEATURE_KEYS) {
    const feature = register[key];
    const score = Math.max(0, ...feature.screens.map((s) => pagePatternScore(s, pathname, view)));
    if (score === 0) continue;
    const rank = productScore(feature, product) * 10 + score;
    if (!best || rank > best.rank) best = { key, rank };
  }
  return best?.key ?? null;
}

/**
 * The modules that can be seen and offered: Installation goes with its feature switch, and the
 * Contracts module takes its place (spec A3).
 */
export function visibleModules(register: FeatureRegister = FEATURES): readonly ModuleInfo[] {
  return MODULES.filter((m) => m.key !== "installation" || featureOn("installation.calendar", register));
}

/** True when the page or link may be shown: no feature owns it, or the feature that does is on. */
export function pathOn(product: ProductKey, href: string, register: FeatureRegister = FEATURES): boolean {
  const key = featureForPath(product, href, register);
  return key === null || featureOn(key, register);
}
