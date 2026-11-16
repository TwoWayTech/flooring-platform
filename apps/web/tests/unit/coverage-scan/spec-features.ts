import type { FeatureKey } from "@workspace/shared";
import { namesIn } from "./source";

/**
 * Which spec each feature of the register belongs to, for the coverage list's "by spec" view
 * (whole-product check, ADR 0058). Reviewed by hand from where each spec describes the feature.
 * The coverage test reads only the spec folders' file names, never their text: pull requests that
 * change only docs skip CI, so anything read from a doc's contents could go stale unseen (SH-15).
 */

/** The group for features no spec owns: the shell, the dashboard and demo tools. */
export const SHELL_GROUP = "Shell and platform";

/** The spec files the coverage list covers: every module spec, plus the two draft specs with routes. */
export function specFiles(): string[] {
  const modules = namesIn("docs/product-spec")
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/product-spec/${name}`);
  const drafts = ["docs/specs/platform-admin.md", "docs/specs/settings-users-access.md"].filter((path) =>
    namesIn("docs/specs").includes(path.slice("docs/specs/".length)),
  );
  return [...modules, ...drafts];
}

/** Features by spec file (repository path) or SHELL_GROUP. A removed feature may sit under its old spec. */
export const SPEC_FEATURES: Readonly<Record<string, readonly FeatureKey[]>> = {
  "docs/product-spec/commissions.md": ["hr.commissions", "sales.team"],
  "docs/product-spec/contracts.md": ["contracts.register", "contracts.billing", "contracts.compliance"],
  "docs/product-spec/employee-portal.md": ["hr.portal", "hr.clock"],
  "docs/product-spec/finance-expenses.md": ["finance.expenses", "finance.payments-queue"],
  "docs/product-spec/hr.md": [
    "hr.dashboard",
    "hr.employees",
    "hr.timesheets",
    "hr.time-off",
    "hr.pay-periods",
    "hr.payroll.california",
    "settings.hr",
  ],
  "docs/product-spec/import.md": ["settings.import", "settings.database"],
  "docs/product-spec/inventory.md": [
    "units.square-feet",
    "inventory.products",
    "inventory.rolls",
    "inventory.transfers",
    "inventory.adjustments",
    "inventory.reservations",
    "inventory.stock-correction",
    "inventory.ready-to-cut",
    "inventory.locations",
  ],
  "docs/product-spec/meetings.md": ["meetings.calendar", "meetings.invites", "meetings.requests", "settings.meetings"],
  "docs/product-spec/notifications.md": ["settings.notifications", "settings.outbox", "shell.notifications"],
  "docs/product-spec/purchasing.md": ["purchasing.orders", "purchasing.suppliers"],
  "docs/product-spec/reports.md": [
    "reports.hub",
    "reports.business",
    "reports.pnl",
    "reports.sales-category",
    "reports.payments",
    "reports.tax-jurisdiction",
    "reports.inventory-valuation",
    "reports.receivables-aging",
    "reports.payables-aging",
  ],
  "docs/product-spec/sales.md": [
    "sales.quotes",
    "sales.quote-availability",
    "sales.invoices",
    "sales.payments",
    "sales.customers",
    "installation.calendar",
  ],
  "docs/product-spec/settings-and-permissions.md": [
    "settings.branding",
    "settings.localization",
    "settings.number-format",
    "settings.company",
  ],
  "docs/specs/platform-admin.md": ["admin.access", "admin.billing", "settings.billing"],
  "docs/specs/settings-users-access.md": [
    "settings.users",
    "settings.roles",
    "settings.audit",
    "auth.mfa",
    "auth.step-up",
  ],
  [SHELL_GROUP]: [
    "dashboard.store",
    "shell.company-switcher",
    "shell.view-as",
    "shell.command-palette",
    "shell.tables",
    "shell.addresses",
    "shell.presenter-guide",
    "shell.network-simulation",
    "demo.reset",
  ],
};

/**
 * Pages no feature owns (CV-5), each with why: sign-in and its recovery pages, the design sheet,
 * the not-found page and the settings home, which lists the settings pages each feature owns.
 */
export const NO_FEATURE_PAGES: Readonly<Record<string, string>> = {
  "/[...missing]": "The not-found page inside the app shell.",
  "/accept-invite": "Accepting an invitation, before any company is open.",
  "/design": "The design sheet (docs/design-brief.md), not a product page.",
  "/forgot-password": "Password recovery, before sign-in.",
  "/login": "Sign-in.",
  "/reset-password": "Password recovery, before sign-in.",
  "/settings": "The settings home: it lists the settings pages, each owned by its feature.",
  "/settings/commissions": "Redirects to the commission plans on HR → Commissions (hr.commissions).",
};
