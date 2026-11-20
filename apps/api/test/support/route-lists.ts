/**
 * The reviewed lists the route matrix (route-matrix.int.test.ts, whole-product check) checks the
 * catalog against. Each entry is a route's `VERB /path` and a one-line reason someone reviewed. A
 * new route that fits none of the rules fails the matrix until it is added here with a reason, and
 * an entry whose route no longer needs it fails as stale, so the lists never drift from the code.
 */
import {
  featureOn,
  PRODUCT_ROLES,
  scopeAllows,
  seesPersonRecords,
  type DataScope,
  type DefaultRoleKey,
  type PermissionKey,
} from "@workspace/shared";

/** A route's name (`VERB /path`) and why it is an exception. */
export type Reviewed = Readonly<Record<string, string>>;

/**
 * Whether the long default sweeps (tier B: PM-3 lite and PM-5 here) run in every `pnpm test:api`.
 * The whole-product check's CI gate may turn it off to keep verify inside its timeout; `WHOLE_CHECK=1`
 * runs them regardless (ADR 0058).
 */
export const TIER_B_DEFAULT = true;

/**
 * Company routes with no `@RequireModule`. Each declares only `platform` keys (always on) or lets
 * any member in, so turning a business module off never needs to refuse it.
 */
export const NO_MODULE_ROUTES: Reviewed = {
  "DELETE /roles/:id": "Settings → Security roles: settings.roles.manage, a platform key (always on).",
  "GET /audit": "Settings → Audit log: settings.audit.view, a platform key (always on).",
  "GET /imports":
    "Settings → Import: settings.import.manage (platform); ImportsService checks each kind's own module (ADR 0057).",
  "GET /roles": "Settings → Security roles and the users screen: settings.roles.* and settings.users.*, platform keys.",
  "GET /users": "Settings → Users: settings.users.*, platform keys (always on).",
  "PATCH /users/:id":
    "Settings → Users: settings.users.manage, a platform key; step-up and no escalation in UsersService.",
  "POST /imports":
    "Settings → Import: settings.import.manage (platform); each kind's module is checked in ImportsService (ADR 0057).",
  "POST /imports/:id/undo":
    "Settings → Import: settings.import.manage (platform); each kind's module is checked in ImportsService (ADR 0057).",
  "POST /imports/check":
    "Settings → Import: settings.import.manage (platform); each kind's module is checked in ImportsService (ADR 0057).",
  "POST /outbox/:id/cancel": "Outbox: settings.outbox.view, a platform key (the outbox has no other key).",
  "POST /outbox/:id/retry": "Outbox: settings.outbox.view, a platform key (the outbox has no other key).",
  "POST /roles": "Settings → Security roles: settings.roles.manage, a platform key.",
  "POST /roles/:id/reset": "Settings → Security roles: settings.roles.manage, a platform key.",
  "POST /users/invite": "Settings → Users: settings.users.manage, a platform key.",
  "PUT /imports/mappings/:kind":
    "Settings → Import: settings.import.manage (platform); the kind's module is checked in ImportsService.",
  "PUT /roles/:id": "Settings → Security roles: settings.roles.manage, a platform key.",
  "PUT /settings/branding":
    "Settings → Branding: settings.branding.manage, a platform key; reads settings.branding first (ADR 0059).",
  "PUT /settings/email":
    "Settings → Email and notifications: settings.notifications.manage, a platform key; reads settings.notifications first (ADR 0059).",
  "PUT /settings/localization/currency":
    "Localization → Currency: settings.localization.manage, a platform key; reads settings.localization first (ADR 0059).",
  "PUT /settings/localization/region":
    "Localization → Region: settings.localization.manage, a platform key; reads settings.localization first (ADR 0059).",
  "PUT /settings/localization/tax":
    "Localization → Sales tax: settings.tax.manage, a platform key; reads settings.localization first; rules are versioned (ADR 0059).",
  "PUT /settings/numbers":
    "Settings → Number format: settings.numbers.manage, a platform key; reads settings.number-format first (ADR 0059).",
  "PUT /settings/profile":
    "Settings → Company profile: settings.company.manage, a platform key; reads settings.company first (ADR 0059).",
};

/** Routes that declare a key from a module other than their own, `core` or `platform`. */
export const CROSS_MODULE_ROUTES: Reviewed = {
  "GET /files/:id":
    "Files of payments, expenses, bills, contracts and employee documents: the route asks only for platform so HR Suite companies reach their documents, and the service checks each owner type's module (ADR 0046).",
  "GET /me/meetings":
    "My portal's meetings: the portal's own key (hr.portal.view) on a meetings route, so an employee sees the meetings they are in.",
  "PUT /invoices/:id/commission-split":
    "Who shares an invoice's commission: the invoice's editor or HR's commission manager (hr.commission.manage), until the first confirmed payment.",
};

/** Writes that a `.view` key, or company membership alone, lets through. */
export const WRITE_WITH_VIEW_KEY: Reviewed = {
  "PATCH /me/employee":
    "The signed-in person's own phone and emergency contact in My portal (hr.portal.view); only their own record.",
  "POST /clock/in": "The signed-in person clocks themselves in from My portal (hr.portal.view).",
  "POST /clock/out": "The signed-in person clocks themselves out from My portal (hr.portal.view).",
  "POST /commission-assignments/:id/acknowledge":
    "The person signs their own commission plan in My portal (hr.portal.view; ADR 0049).",
  "POST /meetings/:id/response":
    "An invitee answers their own invitation (meetings.meeting.view); the organiser's changes need edit.",
  "POST /notifications/read": "Any member marks their own in-app notes read; nothing else changes.",
  "POST /outbox/:id/cancel":
    "The outbox has only settings.outbox.view; the Owner holds it by default. Finding: a manage key would separate seeing from acting.",
  "POST /outbox/:id/retry":
    "The outbox has only settings.outbox.view; the Owner holds it by default. Finding: a manage key would separate seeing from acting.",
  "POST /pay-periods":
    "Opens the period holding a day on the pay schedule, safe to repeat; company-wide payroll access is checked in the controller (requireCompanyWidePayroll).",
  "POST /support-grants/:id/approve":
    "Any member reaches it; SupportGrantsService allows only an Owner, after a step-up (blueprint role rule 6).",
  "POST /support-grants/:id/revoke":
    "Any member reaches it; SupportGrantsService allows only an Owner (blueprint role rule 6).",
};

/**
 * How a write on an existing record treats it (SH-10). Posted documents are never edited (rule 9):
 * - reversal: posts a reversing entry, or reverses the record's postings;
 * - state change only: changes the record's status; amounts and lines stay as they were;
 * - refused once posted: edits amounts or lines, only before the record posts or locks;
 * - adds a document: raises a new document or posting against the record, which is not edited;
 * - attachment: adds files;
 * - not a money document: the record carries no posted money.
 */
export type DocumentWriteKind =
  "reversal" | "state change only" | "refused once posted" | "adds a document" | "attachment" | "not a money document";

/**
 * Every company write on an existing record (any verb with a path parameter), and every PUT, PATCH
 * and DELETE, with what it does to the record. Immutability of posted documents is enforced by the
 * API only; the database triggers cover the journal tables.
 */
export const DOCUMENT_WRITES: Readonly<Record<string, readonly [DocumentWriteKind, string]>> = {
  "DELETE /meetings/:id/attendees/:attendeeId": ["not a money document", "Takes one guest off a meeting."],
  "DELETE /roles/:id": ["not a money document", "Deletes a custom role nobody holds (step-up)."],
  "PATCH /me/employee": ["not a money document", "The person's own phone and emergency contact."],
  "PATCH /meetings/:id": ["not a money document", "Edits a meeting's title, notes, place, start, length or reminder."],
  "PATCH /rolls/:id": ["not a money document", "Moves a roll to another bin; no stock, cost or posting changes."],
  "PATCH /users/:id": [
    "not a money document",
    "A person's roles, status, branch, title or MFA reset (step-up for roles and MFA).",
  ],
  "POST /bonuses/:id/void": [
    "refused once posted",
    "Voids a bonus only while its pay run is not approved, so nothing posted changes.",
  ],
  "POST /change-orders/:id/decision": [
    "state change only",
    "Approves or rejects a pending change order; nothing posts.",
  ],
  "POST /commission-assignments/:id/acknowledge": [
    "not a money document",
    "The person's signature on their commission plan.",
  ],
  "POST /contract-billings/:id/void": [
    "reversal",
    "Voids the contract's latest posted billing with a reversing entry.",
  ],
  "POST /contractor-payments/:id/pay": [
    "state change only",
    "Recorded to paid by a method today, posting the payment; not by whoever recorded it. Amounts are unchanged.",
  ],
  "POST /contractor-payments/:id/void": [
    "reversal",
    "Voids a contractor payment, reversing a paid one on the void day.",
  ],
  "POST /contracts/:id/billings": [
    "adds a document",
    "Posts a progress billing that raises its own invoice or bill; the contract is not edited.",
  ],
  "POST /contracts/:id/change-orders": [
    "adds a document",
    "Submits a change order for approval; the contract's lines are not edited.",
  ],
  "POST /contracts/:id/close": [
    "state change only",
    "Closes a contract; an override needs contracts.contract.approve and a reason.",
  ],
  "POST /contracts/:id/complete": ["state change only", "Marks substantial completion."],
  "POST /contracts/:id/files": ["attachment", "Adds documents to a contract."],
  "POST /contracts/:id/lien-waivers": ["adds a document", "Records a lien waiver against the contract."],
  "POST /contracts/:id/recall": ["state change only", "Takes a sent contract back to draft."],
  "POST /contracts/:id/renew": [
    "adds a document",
    "Starts the next term as a new draft; the old contract is not edited.",
  ],
  "POST /contracts/:id/retainage-releases": ["adds a document", "Releases held retainage on its own invoice or bill."],
  "POST /contracts/:id/send": ["state change only", "Sends a draft for signature."],
  "POST /contracts/:id/sign": ["state change only", "Records a simulated signature."],
  "POST /contracts/:id/terminate": ["state change only", "Ends an active or completed contract with a reason."],
  "POST /employees/:id/checklist/:itemId": [
    "not a money document",
    "Ticks or unticks an onboarding or offboarding step.",
  ],
  "POST /employees/:id/documents": ["attachment", "Adds files to the person's documents."],
  "POST /employees/:id/offboarding": [
    "not a money document",
    "Marks the person as left and adds the offboarding checklist.",
  ],
  "POST /expenses/:id/review": [
    "state change only",
    "Approves or rejects, never by the recorder; approval posts the expense, amounts unchanged.",
  ],
  "POST /expenses/:id/void": ["reversal", "Voids with a reason; a confirmed expense posts its reversal."],
  "POST /imports/:id/undo": [
    "not a money document",
    "Undoes one import batch after a step-up; imports post nothing (ADR 0057 §2).",
  ],
  "POST /invoices/:id/apply-credit": [
    "adds a document",
    "Applies the customer's credit to the invoice as a new allocation; the invoice is not edited.",
  ],
  "POST /invoices/:id/credit-notes": ["reversal", "Issues a credit note (a return invoice) for part of an invoice."],
  "POST /invoices/:id/sent": ["state change only", "Marks an invoice sent and emails it."],
  "POST /invoices/:id/void": ["reversal", "Voids an invoice with no confirmed payment, with a reversing entry."],
  "POST /invoices/:id/write-off": [
    "adds a document",
    "Writes off a small leftover balance with its own posting; the invoice is not edited.",
  ],
  "POST /meetings/:id/attendees/:attendeeId/proposal": [
    "not a money document",
    "The organiser accepts or declines a guest's proposed time.",
  ],
  "POST /meetings/:id/cancel": ["not a money document", "Cancels the meeting for everyone."],
  "POST /meetings/:id/reschedule": ["not a money document", "Moves or resizes a meeting or its occurrences."],
  "POST /meetings/:id/reschedule/undo": [
    "not a money document",
    "Undoes the person's own last move, rebuilt from its audit entry.",
  ],
  "POST /meetings/:id/response": ["not a money document", "The person answers their own invitation or request."],
  "POST /outbox/:id/cancel": ["not a money document", "Cancels a scheduled email."],
  "POST /outbox/:id/retry": ["not a money document", "Sends a failed email again."],
  "POST /pay-periods/:id/approve": ["state change only", "Freezes the lines and posts the payroll accrual."],
  "POST /pay-periods/:id/exclusions": [
    "refused once posted",
    "Leaves someone out, or brings them back, only before the period is approved.",
  ],
  "POST /pay-periods/:id/export": ["state change only", "Marks an approved run exported, which locks it."],
  "POST /pay-periods/:id/reopen": ["reversal", "Returns an approved run to review, reversing its postings."],
  "POST /payments/:id/files": ["attachment", "Adds proof files to a payment."],
  "POST /payments/:id/review": [
    "state change only",
    "Confirms or rejects a pending payment; confirmation posts it, amounts unchanged.",
  ],
  "POST /payments/:id/void": ["reversal", "Voids a payment with a reason and a reversing entry."],
  "POST /pto-requests/:id/cancel": [
    "not a money document",
    "Cancels a pending or approved request that has not started.",
  ],
  "POST /pto-requests/:id/decision": [
    "not a money document",
    "Approves or declines a time-off request, never one's own.",
  ],
  "POST /purchase-orders/:id/bills": [
    "adds a document",
    "The supplier's bill for the order's unbilled receipts; the order is not edited.",
  ],
  "POST /purchase-orders/:id/cancel": ["state change only", "Cancels an order before anything arrived."],
  "POST /purchase-orders/:id/order": ["state change only", "Sends a draft to the supplier."],
  "POST /purchase-orders/:id/receipts": [
    "adds a document",
    "Records what arrived and brings it into stock with its own posting.",
  ],
  "POST /quotes/:id/invoice": [
    "adds a document",
    "Converts an accepted quote into a new invoice and holds its stock; the quote only changes status.",
  ],
  "POST /quotes/:id/status": ["state change only", "Sends, accepts or declines a quote."],
  "POST /reservations/:id/issue": ["adds a document", "Cuts or issues one hold and posts its cost of goods."],
  "POST /roles/:id/reset": ["not a money document", "Puts a default role back to its shipped permissions (step-up)."],
  "POST /rolls/:id/invoice": ["adds a document", "A quick invoice for a length of one roll, with the roll reserved."],
  "POST /supplier-contacts/:id/status": ["not a money document", "Deactivates or reactivates a supplier contact."],
  "POST /supplier-payments/:id/review": [
    "state change only",
    "Confirms or rejects, never by the recorder; confirmation posts it, amounts unchanged.",
  ],
  "POST /supplier-payments/:id/void": ["reversal", "Voids with a reason; a confirmed payment posts its reversal."],
  "POST /suppliers/:id/status": ["not a money document", "Deactivates or reactivates a supplier."],
  "POST /support-grants/:id/approve": ["not a money document", "An Owner approves support access after a step-up."],
  "POST /support-grants/:id/revoke": ["not a money document", "An Owner ends support access."],
  "POST /timesheets/:id/reopen": [
    "refused once posted",
    "An approved sheet back to draft with a reason, refused once its week is in an approved or exported pay period.",
  ],
  "POST /timesheets/:id/submit": ["not a money document", "Sends a week's sheet for approval."],
  "POST /transfers/:id/receive": [
    "state change only",
    "Receives a transfer at its destination; stock moves between warehouses and nothing posts.",
  ],
  "PUT /commission-plans/:id": [
    "refused once posted",
    "Saves a plan; one already used becomes a new version from today, so used terms never change.",
  ],
  "PUT /contracts/:id": [
    "refused once posted",
    "Edits a draft contract; its lines are replaced only while it is a draft.",
  ],
  "PUT /contracts/:id/insurance-certificate": [
    "not a money document",
    "Saves the subcontract's one insurance certificate.",
  ],
  "PUT /customers/:id": ["not a money document", "Changes a customer and their addresses."],
  "PUT /employees/:id": [
    "not a money document",
    "Edits a person; the pay rate changes only with view_sensitive, and approved runs keep their frozen lines.",
  ],
  "PUT /expenses/:id": ["refused once posted", "Saves or finishes a draft expense; a recorded one is not edited."],
  "PUT /imports/mappings/:kind": ["not a money document", "Keeps the column choices for the next file of this kind."],
  "PUT /invoices/:id/commission-split": [
    "refused once posted",
    "Who shares the commission, only until the first confirmed payment.",
  ],
  "PUT /locations/:id": [
    "not a money document",
    "Changes a warehouse or showroom's details; stock and its postings are unchanged.",
  ],
  "PUT /quotes/:id": [
    "refused once posted",
    "Saves an open quote; once accepted or invoiced it is locked. Quotes never post.",
  ],
  "PUT /recurring-expenses/:id": ["not a money document", "Edits a template; drafts already raised keep their values."],
  "PUT /roles/:id": ["not a money document", "Changes a role (step-up, no escalation, Owner role locked)."],
  "PUT /settings/accounting": [
    "not a money document",
    "Costing method, tax basis and bank accounts; a bank account with postings cannot be retired (ADR 0040).",
  ],
  "PUT /settings/branding": ["not a money document", "The company's logo and colours; no posted money."],
  "PUT /settings/email": ["not a money document", "Email sender and notification choices; no posted money."],
  "PUT /settings/expenses": [
    "not a money document",
    "Expense approval (required, threshold) for expenses entered later; entered expenses keep their state.",
  ],
  "PUT /settings/hr": [
    "not a money document",
    "Workweek, pay frequency and anchor, holidays and what employees see; an approved run keeps its figures.",
  ],
  "PUT /settings/inventory": [
    "not a money document",
    "Stock rules: the adjustment quantity that needs approval; stock already moved keeps its postings.",
  ],
  "PUT /settings/localization/currency": [
    "not a money document",
    "The company's currency and rounding for documents to come; posted documents keep their amounts.",
  ],
  "PUT /settings/localization/documents": [
    "not a money document",
    "Quote expiry, balance-due days and document defaults for documents made later.",
  ],
  "PUT /settings/localization/payroll": [
    "not a money document",
    "Payroll rules for periods to come; an approved run keeps its figures.",
  ],
  "PUT /settings/localization/region": [
    "not a money document",
    "Region, fiscal year and dates; the time zone is read only (ADR 0059).",
  ],
  "PUT /settings/localization/tax": [
    "not a money document",
    "Sales tax rules, versioned (Settings part 3a); posted documents keep the tax they posted with.",
  ],
  "PUT /settings/numbers": ["not a money document", "How numbers are shown; nothing stored changes."],
  "PUT /settings/payments": [
    "not a money document",
    "Payment approval rules for payments recorded later; posted payments are unchanged.",
  ],
  "PUT /settings/profile": [
    "not a money document",
    "The company's name, address and EIN printed on documents to come.",
  ],
  "PUT /settings/sharedCosts": [
    "not a money document",
    "How company-wide costs are split across locations (spec F1); expenses and their postings are unchanged.",
  ],
  "PUT /supplier-contacts/:id": ["not a money document", "Edits a supplier contact."],
  "PUT /suppliers/:id": ["not a money document", "Edits a supplier."],
  "PUT /time-off-policies/:id": ["not a money document", "Edits a time-off policy (Settings → HR)."],
  "PUT /timesheets": ["refused once posted", "Saves a week's hours; an approved week is locked until it is reopened."],
};

/** Company routes that read no feature switch, with why none applies. */
export const NO_SWITCH_ROUTES: Reviewed = {
  "DELETE /roles/:id":
    "Reads no switch. Finding F-h: settings.roles exists, so rule 13 says this route should answer 404 when it is off.",
  "GET /audit":
    "Reads no switch. Finding F-h: settings.audit exists, so rule 13 says this route should answer 404 when it is off.",
  "GET /ledger/period-close": "The ledger has no switch in the register (ADR 0039); no screen calls it yet.",
  "GET /company":
    "The shell's own read (ADR 0051): every screen needs the company, the person's access and the names directory, so no switch may hide it.",
  "GET /locations":
    "Shared reference data every module picks from; inventory.locations owns only the settings page, so hiding pickers with it would break other features.",
  "GET /roles":
    "Reads no switch. Finding F-h: settings.roles exists, so rule 13 says this route should answer 404 when it is off.",
  "GET /settings":
    "Company reference data every screen reads (ADR 0059 D3); each section is cut inside by its own switch (readableSections), so no one switch hides the route.",
  "GET /settings/accounting":
    "Accounting settings have no switch in the register (ADR 0040); no screen calls them yet.",
  "GET /support-grants":
    "Reads no switch. Finding F-h: the support-access panel sits on Settings → Users (settings.users), which this route does not read.",
  "GET /users":
    "Reads no switch. Finding F-h: settings.users exists, so rule 13 says this route should answer 404 when it is off.",
  "PATCH /users/:id":
    "Reads no switch. Finding F-h: settings.users exists, so rule 13 says this route should answer 404 when it is off.",
  "POST /ledger/period-close": "The ledger has no switch in the register (ADR 0039); no screen calls it yet.",
  "POST /roles":
    "Reads no switch. Finding F-h: settings.roles exists, so rule 13 says this route should answer 404 when it is off.",
  "POST /roles/:id/reset":
    "Reads no switch. Finding F-h: settings.roles exists, so rule 13 says this route should answer 404 when it is off.",
  "POST /support-grants/:id/approve":
    "Reads no switch. Finding F-h: the support-access panel sits on Settings → Users (settings.users), which this route does not read.",
  "POST /support-grants/:id/revoke":
    "Reads no switch. Finding F-h: the support-access panel sits on Settings → Users (settings.users), which this route does not read.",
  "POST /users/invite":
    "Reads no switch. Finding F-h: settings.users exists, so rule 13 says this route should answer 404 when it is off.",
  "PUT /roles/:id":
    "Reads no switch. Finding F-h: settings.roles exists, so rule 13 says this route should answer 404 when it is off.",
  "PUT /settings/accounting":
    "Accounting settings have no switch in the register (ADR 0040); no screen calls them yet.",
};

/**
 * Company routes whose switch PM-5 cannot see hide them, so they are traced by hand: the switch is
 * read only after the record is found (in a service), or a record that does not exist answers the
 * same bare 404 as a switched-off feature.
 */
export const SWITCH_READ_IN_SERVICE: Reviewed = {
  "GET /files/:id":
    "Each owner type's switch (sales.payments, finance.expenses, purchasing.orders, contracts.register, hr.employees, hr.portal) is read in PaymentsService.file after the file is found, so a missing file answers 404 first; traced by hand.",
  "POST /outbox/:id/retry":
    "The controller reads settings.outbox first, but a missing message also answers the bare 404 (NotificationService.rowFor), so a flip cannot show it; traced by hand. Finding F-i.",
};

/** Writes that may answer 2xx to an empty body `{}`, with why that is safe. */
export const EMPTY_BODY_OK: Reviewed = {
  "POST /notifications/read": "With no ids it marks the person's own unread in-app notes read; nobody else's change.",
};

/**
 * Reads that need a query to answer at all, with a minimal valid one (SH-17). The window is
 * Summit's last fixture year (anchor 2026-11-04), within the 366-day report limit, so the reads
 * return data; a fresh company answers them with empty totals.
 */
export const QUERY_FOR: Readonly<Record<string, string>> = {
  "GET /commission-totals": "from=2025-11-05&to=2026-11-04",
  "GET /reports/business": "from=2025-11-05&to=2026-11-04",
};

/** Every default Flooring Suite role but the Owner, for the Owner-only reads below. */
const NOT_OWNER: readonly DefaultRoleKey[] = PRODUCT_ROLES.flooring.filter((role) => role !== "owner");

/**
 * Reads on Summit (PM-7) that the guards let through but the handler refuses with its own 403, by
 * `role GET /path`: rules inside handlers the guard matrix can't see (SH-4), pinned so a new one,
 * or one that stops refusing, is reviewed.
 */
export const READ_REFUSED_IN_HANDLER: Reviewed = {
  ...Object.fromEntries(
    NOT_OWNER.map((role) => [
      `${role} GET /billing`,
      "Any member reaches it; BillingService.of answers only an Owner; anyone else reads 403 forbidden (ADR 0054).",
    ]),
  ),
  ...Object.fromEntries(
    NOT_OWNER.map((role) => [
      `${role} GET /support-grants`,
      "Any member reaches it; the support-access list is for Owners only (blueprint role rule 6).",
    ]),
  ),
  "manager GET /ledger/period-close":
    "requireCompanyWide: the books cover the whole company, and the Manager's scope is branch.",
  "manager GET /ledger/trial-balance":
    "requireCompanyWide: the books cover the whole company, and the Manager's scope is branch.",
  "manager GET /reports/business": "requireWholeCompany: the Business report covers the whole company (ADR 0055 S1).",
  "manager GET /reports/pnl": "requireWholeCompany: Profit and loss covers the whole company (ADR 0055 S1).",
};

/** The person PM-6 reads as: who they are in Summit's own records, and what the shared engine gives them. */
export interface SweepViewer {
  userId: string;
  branchId: string | null;
  /** The employee linked to their sign-in (user_profiles.employee_id), or null. */
  employeeId: string | null;
  dataScope: DataScope;
  permissions: ReadonlySet<PermissionKey>;
}

/** What the Owner's answers and Summit's records say about the rows a person may see. */
export interface ScopeFacts {
  /** Each invoice's rep and branch, from the Owner's `GET /invoices`. */
  invoices: ReadonlyMap<string, { salesRepId: string | null; branchId: string | null }>;
  /** Each user's branch, from Summit's user profiles. */
  userBranches: ReadonlyMap<string, string | null>;
  /** Each location's branch, from the Owner's `GET /locations`. */
  locationBranches: ReadonlyMap<string, string | null>;
  /** Each employee's manager, from the Owner's `GET /employees`. */
  managers: ReadonlyMap<string, string | null>;
}

/** One row of a list as the API sends it. */
export type ListRow = Readonly<Record<string, unknown>>;

/** A data-scope rule as the spec writes it, and the judge built from it with packages/shared. */
export interface ScopeRule {
  /** The rule (docs/api-contract.md), and the service function it was confirmed in. */
  rule: string;
  /** Whether the viewer may see the row. */
  sees: (row: ListRow, viewer: SweepViewer, facts: ScopeFacts) => boolean;
}

/** A row's text field, or null when it is empty or not text. */
function text(row: ListRow, field: string): string | null {
  const value = row[field];
  return typeof value === "string" && value !== "" ? value : null;
}

/** The plain owner-and-branch rule (spec rule 4, `scopeAllows`): own by the owner, branch by the branch, or all. */
function ownerAndBranch(viewer: SweepViewer, ownerUserId: string | null, branchId: string | null): boolean {
  return scopeAllows(viewer.dataScope, viewer, { ownerUserId, branchId });
}

/** The HR person rule (`ownOrReports`, `seesPersonRecords`): one's own employee, direct reports at branch, all at all. */
function ownOrReports(viewer: SweepViewer, employeeId: string | null, facts: ScopeFacts): boolean {
  if (employeeId === null || !facts.managers.has(employeeId)) return false;
  return seesPersonRecords(viewer.dataScope, viewer.employeeId, {
    id: employeeId,
    managerId: facts.managers.get(employeeId) ?? null,
  });
}

/** The `byRep` rule of quotes, invoices and contracts: own by the rep, branch by the document's branch. */
const byRep: ScopeRule["sees"] = (row, viewer) =>
  ownerAndBranch(viewer, text(row, "salesRepId"), text(row, "branchId"));

/**
 * The data-scope rule of each list PM-6 samples on Summit, written from docs/api-contract.md and
 * confirmed in the module's service. Each judge is built from the shared `scopeAllows` and
 * `seesPersonRecords`, never from the API's own filters, so a person's rows can be checked both
 * ways: none outside the rule, and none of the Owner's rows the rule allows missing. Meetings
 * follow their own rules and are covered by meetings.int.test.ts.
 */
export const SCOPE_RULES: Readonly<Record<string, ScopeRule>> = {
  "GET /contracts": {
    rule: "byRep: own by the rep, branch by the contract's branch (contracts, 'Data scope'); ContractsService.list → seesContract.",
    sees: byRep,
  },
  "GET /customers": {
    rule: "Own by the rep, branch by the rep's branch (sales, 'Data scope'); SalesService.customers → seesCustomer.",
    sees: (row, viewer, facts) => {
      const rep = text(row, "salesRepId");
      return ownerAndBranch(viewer, rep, rep === null ? null : (facts.userBranches.get(rep) ?? null));
    },
  },
  "GET /employees": {
    rule: "Everyone for holders of hr.employee.view with hr.employees on (the People directory); otherwise ownOrReports, work facts only (hr, GET /employees); PeopleService.list.",
    sees: (row, viewer, facts) =>
      (viewer.permissions.has("hr.employee.view") && featureOn("hr.employees")) ||
      ownOrReports(viewer, text(row, "id"), facts),
  },
  "GET /expenses": {
    rule: "Own by the recorder, branch by the location's branch, company-wide ones only at all; payroll months only with hr.payroll.view (finance, GET /expenses); ExpensesService.list → seesExpense, seesPayroll.",
    sees: (row, viewer, facts) => {
      const location = text(row, "locationId");
      const branch = location === null ? null : (facts.locationBranches.get(location) ?? null);
      const payrollAllowed = row.category !== "payroll" || viewer.permissions.has("hr.payroll.view");
      return payrollAllowed && ownerAndBranch(viewer, text(row, "recordedById"), branch);
    },
  },
  "GET /invoices": {
    rule: "byRep: own by the rep, branch by the invoice's branch (sales, GET /invoices); InvoicesService.invoices → seesDocument.",
    sees: byRep,
  },
  "GET /payments": {
    rule: "Payments on invoices within scope (sales, GET /payments); InvoicesService.payments → visibleInvoiceIds.",
    sees: (row, viewer, facts) => {
      const invoice = facts.invoices.get(text(row, "invoiceId") ?? "");
      return invoice !== undefined && ownerAndBranch(viewer, invoice.salesRepId, invoice.branchId);
    },
  },
  "GET /pto-requests": {
    rule: "ownOrReports by the request's employee (hr, 'Data scope'); TimeOffService.listRequests → personScope.",
    sees: (row, viewer, facts) => ownOrReports(viewer, text(row, "employeeId"), facts),
  },
  "GET /quotes": {
    rule: "byRep: own by the rep, branch by the quote's branch (sales, GET /quotes); SalesService.quotes → seesDocument.",
    sees: byRep,
  },
  "GET /timesheets": {
    rule: "ownOrReports by the sheet's employee (hr, 'Data scope'); TimesheetsService.list → personScope.",
    sees: (row, viewer, facts) => ownOrReports(viewer, text(row, "employeeId"), facts),
  },
};

/**
 * Columns of money tables whose names look like a stored balance or status (E15), each with why
 * it is a recorded fact, not something the ledger derives (ADR 0013; CLAUDE.md rule 9). Balances
 * and invoice or bill states are never stored; workflow steps a person takes (confirm, void,
 * approve) and plain addresses are.
 */
export const STORED_STATE_COLUMNS: Reviewed = {
  "commission_plans.status": "A plan's draft, active or retired life cycle, which HR chooses.",
  "contract_billing_lines.stored_balance":
    "Materials stored on site, a figure the pay application states (AIA style), not a ledger balance.",
  "contract_billings.status": "Posted or void: voiding a billing is a person's act; what is owed is derived.",
  "contractor_payments.status": "Approved or paid: recording the payment is a person's act (ADR 0047).",
  "contracts.status": "A contract's life cycle (draft, sent, signed, …), chosen by people; billing state is derived.",
  "employees.flsa_status": "Exempt or non-exempt under the FLSA, a fact about the job.",
  "employees.state": "The employee's US state, part of the address.",
  "employees.status": "Active, on leave or terminated: an HR decision.",
  "expenses.status":
    "Draft, pending, confirmed, rejected or voided: the two-person check's decisions (finance-expenses rule 9).",
  "jobs.status": "An installation job's schedule state, chosen by people.",
  "lien_waivers.state": "The US state whose statutory form the waiver uses.",
  "lien_waivers.status": "Requested, received or superseded: whether the paper came back.",
  "pay_period_lines.paid_leave_hours": "Hours of paid leave in the period, an input to pay, not a payment state.",
  "pay_period_lines.paid_leave_pay": "Pay for those leave hours, a figure of the approved run.",
  "payments_made.status":
    "A supplier payment's pending, confirmed, rejected or voided: the two-person check (purchasing rule 25).",
  "payments_received.status":
    "A customer payment's pending, confirmed, rejected or voided: the two-person check (sales rule 28).",
  "purchase_orders.status": "Draft, ordered or cancelled only; received, billed and paid are derived (spec D1).",
  "quotes.status": "A quote's draft, sent, accepted or declined, chosen by people.",
  "refunds.status": "Completed or voided: a person's act.",
  "suppliers.status": "Active or inactive in the directory.",
};
