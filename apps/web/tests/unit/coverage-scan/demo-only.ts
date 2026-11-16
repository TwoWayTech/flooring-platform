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
    reason: "Company settings are not on the API (G2): reads come from DemoStore and saves stay in the browser.",
    status:
      'STATUS "Settings at provisioning" (seed country-pack defaults with the Settings module); docs/real-build-plan.md, the Settings module.',
  },
  workspace: {
    reason:
      "The api-mode shell still reads the company, its roles and users and the company list from DemoStore (the workspace bridge, G1).",
    status:
      'STATUS "The api-mode company shell still reads modules and the ceiling from DemoStore until `GET /company` moves"; whole-product check G1.',
  },
  locations: {
    reason: "Locations and a person's default location have no write route on the API (G3).",
    status: 'STATUS "The branch limit is stored, not enforced, until Settings → Locations moves to the API."',
  },
  outbox: {
    reason: "The Outbox, the bell, Simulate reply and notification rules stay on DemoStore in api mode.",
    status: 'ADR 0051 "Part 3"; STATUS "Api mode\'s Outbox, bell and Simulate reply still show DemoStore\'s rows."',
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
    reason:
      "Demo tools: the persona directory and company switch, Reset demo data, and closing a company view for the console.",
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
  cancelOutbox: "outbox",
  closeCompany: "demoTools",
  createInvoiceFromJob: "installation",
  "get:meetings": "outbox",
  getCompany: "workspace",
  getDefaultSettings: "settings",
  getSettings: "settings",
  "list:bills": "mixed",
  "list:crews": "installation",
  "list:customers": "mixed",
  "list:expenses": "mixed",
  "list:jobs": "installation",
  "list:locations": "locations",
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
  "list:users": "workspace",
  listCompanies: "workspace",
  listCompanyDirectory: "demoTools",
  listMyNotifications: "outbox",
  listOutbox: "outbox",
  markNotificationsRead: "outbox",
  recordAdjustment: "adjustments",
  resetDemo: "demoTools",
  resetNotificationRule: "outbox",
  retryOutbox: "outbox",
  reviewAdjustment: "adjustments",
  "save:jobs": "installation",
  saveLocation: "locations",
  saveNotificationRule: "outbox",
  scheduleJob: "installation",
  signOffJob: "installation",
  simulateBounce: "outbox",
  simulateReply: "outbox",
  startJob: "installation",
  testDatabaseConnection: "simulated",
  updateMyProfile: "locations",
  updateSettings: "settings",
  whoAmI: "mixed",
};

/**
 * Client state, not data: these never reach a server in either mode, so they are neither on the API
 * nor demo-only. `today` is still the browser's day in api mode (STATUS "The company's day on the
 * web client").
 */
export const CLIENT_LOCAL: Readonly<Record<string, string>> = {
  openCompany: "Opens the signed-in company in the client (the workspace provider).",
  setViewer: "Sets who the client acts as for View as.",
  subscribe: "Lets a screen re-read after a change.",
  takeNotices: "Hands the shell the client's queued notices.",
  today: "The client's day; STATUS \"The company's day on the web client\".",
};
