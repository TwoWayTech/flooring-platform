/**
 * The reviewed list of ApiClient calls screens make that stay on DemoStore in api mode (whole-product
 * check, coverage list, ADR 0058). Every call a screen reaches must be in API_METHODS, here or in
 * CLIENT_LOCAL (CV-1 and CV-2), and an entry that moved to the API or that no screen calls any more
 * fails as stale (CV-3). So a new demo-only call fails until someone decides why it stays, and the
 * list is always the true one. Each reason names the STATUS follow-up or ADR that tracks it, by its
 * words: STATUS is edited often, so line numbers would drift.
 */

/** Why a group of calls stays on DemoStore, and what tracks its move. */
export interface DemoReason {
  reason: string;
  status: string;
}

/** The reasons, by id. Each id names a gap in the whole-product check's report where there is one. */
export const DEMO_REASONS = {
  settings: {
    reason:
      "Reset to default still reads DemoStore's original settings (ADR 0059 D7): the API has no GET /settings/defaults, and a new company has no settings rows (G2).",
    status:
      'STATUS "Settings at provisioning" and the owner question "Reset to default on the API" (PR #51 Q4); ADR 0059 D7.',
  },
  workspace: {
    reason:
      "The api-mode shell takes the person, access and people from GET /company, but still reads the company record (workspace provider), the roles list (dashboard, Sales) and the company list (switcher, palette, sign-in directory) from DemoStore (the workspace bridge, G1).",
    status: 'ADR 0051 "GET /company"; whole-product check G1.',
  },
  locations: {
    reason:
      "A person's default location (the profile dialog) has no write route on the API; warehouses and showrooms moved (POST and PUT /locations, ADR 0059 part 4a).",
    status: "Whole-product check G3; ADR 0059 part 4a.",
  },
  outbox: {
    reason:
      "Notification rules, Simulate reply and Simulate bounce (with the meeting Simulate reply reads) stay on DemoStore in api mode; the bell, the Outbox and Settings → Email moved (PR #65).",
    status: 'ADR 0051 "Part 3"; docs/product-spec/notifications.md.',
  },
  mixed: {
    reason:
      "A screen on the API that still reads this from DemoStore (G5): the dashboard, Needs attention (and who is asking), Warehouse today and the pickers next to API data.",
    status: 'Proposed STATUS follow-up G5 (whole-product check session log, "For STATUS": mixed pages).',
  },
  installation: {
    reason: "Installation jobs and crews: the `installation.calendar` feature is removed, so these calls never run.",
    status: "docs/FEATURES.md, `installation.calendar` (removed); contracts took its place (ADR 0026).",
  },
  adjustments: {
    reason: "Stock adjustments: the `inventory.adjustments` feature is removed; stock corrections are on the API.",
    status: "docs/FEATURES.md, `inventory.adjustments` (removed, batch 3); `inventory.stock-correction` replaces it.",
  },
  simulated: {
    reason: "Connect a database is simulated and stores nothing, in both modes.",
    status: 'ADR 0057; docs/product-spec/import.md, "Connect a database is simulated".',
  },
  demoTools: {
    reason: "Demo tools: the persona directory and company switch, and Reset demo data.",
    status: 'STATUS "The persona picker shows in demo mode only"; `demo.reset`; whole-product check G1 for the switch.',
  },
} as const satisfies Record<string, DemoReason>;

/** A reason's id. */
export type DemoReasonId = keyof typeof DEMO_REASONS;

/**
 * Each demo-only call a screen makes, as the scan names it (a method, or `list:<collection>`,
 * `get:<collection>`, `save:<collection>`), with its reason's id. One line per call.
 */
export const DEMO_ONLY: Readonly<Record<string, DemoReasonId>> = {
  createInvoiceFromJob: "installation",
  "get:meetings": "outbox",
  getCompany: "workspace",
  getDefaultSettings: "settings",
  "list:bills": "mixed",
  "list:crews": "installation",
  "list:customers": "mixed",
  "list:expenses": "mixed",
  "list:jobs": "installation",
  "list:notificationRules": "outbox",
  "list:products": "mixed",
  "list:ptoRequests": "mixed",
  "list:purchaseOrders": "mixed",
  "list:quotes": "mixed",
  "list:receipts": "mixed",
  "list:roles": "workspace",
  "list:rolls": "mixed",
  "list:stockAdjustments": "adjustments",
  "list:stockMovements": "mixed",
  "list:supplierPayments": "mixed",
  "list:timesheets": "mixed",
  "list:transfers": "mixed",
  listCompanies: "workspace",
  listCompanyDirectory: "demoTools",
  recordAdjustment: "adjustments",
  resetDemo: "demoTools",
  resetNotificationRule: "outbox",
  reviewAdjustment: "adjustments",
  "save:jobs": "installation",
  saveNotificationRule: "outbox",
  scheduleJob: "installation",
  signOffJob: "installation",
  simulateBounce: "outbox",
  simulateReply: "outbox",
  startJob: "installation",
  testDatabaseConnection: "simulated",
  updateMyProfile: "locations",
};

/**
 * Client state, not data: these never reach a server in either mode, so they are neither on the API
 * nor demo-only. `today` is still the browser's day in api mode (STATUS "The company's day on the
 * web client").
 */
export const CLIENT_LOCAL: Readonly<Record<string, string>> = {
  closeCompany: "Closes the client's company view for the console and forgets the company's zone.",
  openCompany:
    "Opens the signed-in company in the client (the workspace provider) and forgets the last company's zone.",
  setViewer: "Sets who the client acts as for View as.",
  subscribe: "Lets a screen re-read after a change.",
  takeNotices: "Hands the shell the client's queued notices.",
  today:
    "The company's day in its own zone, from GET /company's time zone (ADR 0051, \"The company's day on the web\"); computed on the client.",
};
