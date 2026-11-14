import type {
  BusinessFilters,
  Product,
  Roll,
  StockMovement,
  BusinessReport,
  Expense,
  RecurringExpense,
  Attendee,
  MeetingProposal,
  BillingLine,
  ChangeOrder,
  Contract,
  ContractBilling,
  ContractLine,
  InsuranceCertificate,
  LienWaiver,
  CommissionAssignment,
  CommissionPlan,
  CommissionStatement,
  ContractorPayment,
  Employee,
  ImportCounts,
  ImportTable,
  PayPeriod,
  PayPeriodLine,
  PtoRequest,
  StatementFigures,
  TeamCommission,
  TimeOffEntry,
  TimeOffPolicy,
  Timesheet,
  AuditEntry,
  Branding,
  Company,
  CompanyFixtures,
  CompanyId,
  Bill,
  PoLine,
  PurchaseOrder,
  Invoice,
  Quote,
  CompanySettings,
  Transfer,
  TransferInput,
  Location,
  Customer,
  ModuleKey,
  PermissionKey,
  Role,
  User,
  QuoteAction,
  Payment,
  RecordPaymentInput,
  InvoiceAdjustment,
  Refund,
  RefundInput,
  Job,
  AdjustmentReason,
  GoodsReceipt,
  PaymentMethod,
  ReceiptLine,
  InAppNotification,
  NotificationEventKey,
  NotificationRule,
  OutboxMessage,
  Supplier,
  SupplierContact,
  SupplierPayment,
  Reservation,
  StockAdjustment,
  Conflict,
  Meeting,
  MoveScope,
  ColumnMapping,
  ImportBatch,
  ImportKind,
  ImportMapping,
  ImportPlan,
  ImportRequest,
  PlannedRow,
} from "@workspace/shared";

/** Record collections a company holds; each maps to a resource endpoint in docs/api-contract.md. */
export type Collections = Omit<CompanyFixtures, "companyId" | "anchorDate" | "settings">;
/** Name of a record collection, e.g. "invoices". */
export type CollectionName = keyof Collections;
/** One record of a collection. */
export type ItemOf<K extends CollectionName> = Collections[K][number];

/** The fields of a person's HR record (spec C1 People). */
export type EmployeeInput = Omit<
  Employee,
  "id" | "companyId" | "documents" | "onboarding" | "offboarding" | "birthDate" | "externalId"
> & { id?: string };

/** What someone may change on their own record (spec C2 My profile). */
export type MyProfilePatch = Pick<Employee, "phone" | "emergencyContact">;

/** A manager's decision on submitted timesheets. */
export type TimesheetDecision = { action: "approve" } | { action: "reject"; reason: string };

/** A week of hours to save. */
export interface TimesheetInput {
  employeeId: string;
  weekStart: string;
  days: number[];
}

/** What a template upload would do, or did: each row, with its errors. */
export interface TimesheetUploadResult {
  rows: PlannedRow[];
  counts: ImportCounts;
}

/** Whether the person is clocked in now. */
export interface MyClock {
  clockedInAt: string | null;
}

/** A time-off request to make. */
export interface TimeOffInput {
  employeeId: string;
  policyId: string;
  start: string;
  end: string;
  hours: string;
  note: string;
}

/** A decision on a time-off request; a decline needs a reason. */
export type TimeOffDecision = { action: "approve" } | { action: "deny"; reason: string };

/** A manual change to a balance. */
export interface TimeOffAdjustment {
  employeeId: string;
  policyId: string;
  hours: string;
  note: string;
}

/** A workweek holding up a pay period. */
export interface PayBlocker {
  employeeId: string;
  employeeName: string;
  weekStart: string;
  status: Timesheet["status"] | "missing";
}

/** One person's line in a pay period, with whether they are left out of the run. */
export interface PayReviewRow {
  line: PayPeriodLine;
  employee: Employee;
  excludedReason: string | null;
}

/** One pay period to review (spec C1). */
export interface PayPeriodReview {
  period: PayPeriod;
  rows: PayReviewRow[];
  blockers: PayBlocker[];
  contractors: ContractorPayment[];
  contractorNames: Record<string, string>;
}

/** A person's month of commission with its status (ADR 0025). */
export interface CommissionStatementRow extends StatementFigures {
  statementId: string | null;
  name: string;
  status: CommissionStatement["status"];
  approvedBy: string | null;
  approvedAt: string | null;
  payPeriodId: string | null;
  monthEnded: boolean;
  planName: string | null;
}

/** A manual change to a statement. */
export interface CommissionAdjustmentInput {
  userId: string;
  month: string;
  amount: string;
  invoiceId: string | null;
  reason: string;
}

/** Putting someone on a plan. */
export interface PlanAssignmentInput {
  userId: string;
  planId: string;
  effectiveFrom: string;
  monthlyTargetOverride: string;
}

/** A credit note for part of an invoice (plan K-11). */
export interface CreditNoteInput {
  subtotal: string;
  reason: string;
}

/** What the portal shows this person; a hidden item is not offered at all (spec C2). */
export interface MyVisibility {
  pay: boolean;
  commission: boolean;
  rates: boolean;
  teamCalendar: boolean;
  clock: boolean;
}

/** One pay period on My pay. */
export interface MyPayRow {
  period: PayPeriod;
  line: PayPeriodLine;
}

/** Everything the portal shows, for the signed-in person only (spec C2). */
export interface MyPortal {
  employee: Employee | null;
  visible: MyVisibility;
  weekStart: string;
  weekStartDay: number;
  timesheets: Timesheet[];
  usesTimesheet: boolean;
  clock: MyClock;
  balances: { policy: TimeOffPolicy; hours: string; pending: string }[];
  requests: PtoRequest[];
  pay: MyPayRow[];
  earnedThisYear: string;
  statements: CommissionStatementRow[];
  assignment: CommissionAssignment | null;
  plan: CommissionPlan | null;
  contractorPayments: ContractorPayment[];
  /** Colleagues' approved time off, never its kind; empty unless the company shows it. */
  teamOut: PtoRequest[];
  teamNames: { id: string; name: string }[];
}

/** The fields of an expense (spec F1); `asDraft` saves it without a receipt. */
export type ExpenseInput = Pick<
  Expense,
  | "date"
  | "supplierId"
  | "category"
  | "locationId"
  | "amount"
  | "tax"
  | "paymentMethod"
  | "reference"
  | "note"
  | "settlement"
  | "dueAt"
> & { id?: string; asDraft: boolean };

/** A decision on an expense waiting for approval. */
export type ExpenseDecision = { action: "approve" } | { action: "reject"; reason: string };

/** A recurring expense to save. */
export type RecurringExpenseInput = Omit<RecurringExpense, "id"> & { id?: string };

/** Someone added to a meeting by email (spec E). */
export interface NewGuest {
  email: string;
  name: string;
  /** Who to save them under, when new guests become customer contacts. */
  customerId: string | null;
}

/** A meeting to schedule (spec E). */
export interface MeetingInput {
  title: string;
  start: string;
  durationMin: number;
  location: string;
  guests: Attendee[];
  newGuests: NewGuest[];
  recurrence: Meeting["recurrence"];
  reminderMin: number;
  notes: string;
  private: boolean;
  hideGuestList: boolean;
  allowProposals: boolean;
}

/** A guest's answer, with a proposed time when there is one. */
export interface ReplyInput {
  partStat: Attendee["partStat"];
  note: string;
  proposal: Omit<MeetingProposal, "status"> | null;
}

/** Asking someone to meet (spec E). */
export interface MeetingRequestInput {
  withUserId: string;
  title: string;
  start: string;
  durationMin: number;
  location: string;
  note: string;
  private: boolean;
}

/** The fields of a contract and its schedule (spec D1). */
export type ContractInput = Pick<
  Contract,
  | "direction"
  | "kind"
  | "customerId"
  | "supplierId"
  | "title"
  | "scope"
  | "branchId"
  | "locationId"
  | "jobSite"
  | "salesRepId"
  | "startsAt"
  | "endsAt"
  | "renewal"
  | "retainagePct"
  | "storedRetainagePct"
  | "bondInLieu"
  | "taxTreatment"
  | "notes"
> & { id?: string; lines: Omit<ContractLine, "id" | "contractId" | "changeOrderId">[] };

/** A simulated signature: typed name and role (spec D2). */
export interface SignatureInput {
  signerName: string;
  signerRole: string;
}

/** A pay application's cumulative figures (ADR 0026). */
export interface BillingInput {
  periodEnd: string;
  lines: BillingLine[];
}

/** How much retainage to release. */
export interface ReleaseInput {
  amount: string;
}

/** A change order to submit. */
export interface ChangeOrderInput {
  reason: string;
  lines: ChangeOrder["lines"];
}

/** A lien waiver to record. */
export type WaiverInput = Pick<
  LienWaiver,
  "type" | "paymentId" | "supplierPaymentId" | "amount" | "throughDate" | "statutoryForm"
>;

/** A subcontractor's certificate of insurance. */
export type CertificateInput = Pick<InsuranceCertificate, "producer" | "holder" | "coverages" | "additionalInsured">;

/**
 * Who the API answers for. With `viewAsRoleId` set, data scope follows that role's first active
 * user, so "View as Sales" shows what a Sales user would see (spec "App shell").
 */
export interface Viewer {
  userId: string;
  viewAsRoleId: string | null;
}

/** A super-admin change to a company's access (spec "Super-admin"). */
export interface CompanyAccessPatch {
  modules?: ModuleKey[];
  ceiling?: PermissionKey[];
  userLimit?: number;
  branchLimit?: number;
}

/** A company as seen from outside it: who can sign in, and how it looks. */
export interface CompanyDirectory {
  roles: Role[];
  users: User[];
  branding: Branding;
}

/** Fields for inviting a user (spec "Settings: Users"). */
export interface InviteUserInput {
  name: string;
  email: string;
  title: string;
  roleIds: string[];
  branchId: string;
}

/** A customer added from a picker with what the caller knows so far (spec A6: name required). */
/** What a stock adjustment records (spec C1): signed quantity in the stock unit and a reason. */
export interface AdjustmentInput {
  productId: string;
  /** For a roll; null for boxed goods at `locationId`. */
  rollId: string | null;
  locationId: string;
  quantity: string;
  reason: AdjustmentReason;
  note: string;
}

/** An Owner's or Manager's decision on an adjustment that waits. */
export type AdjustmentDecision = { action: "approve" } | { action: "reject"; reason: string };

/** A quick invoice for a length of one roll (spec C1). */
export interface RollInvoiceInput {
  rollId: string;
  customerId: string;
  lengthFt: string;
}

/** A new purchase order (spec D1): lines in their selling unit, with the area for area goods. */
export interface NewPurchaseOrderInput {
  supplierId: string;
  /** The supplier's sales rep the order goes to (spec B2). */
  contactId: string | null;
  supplierRef: string;
  /** How the order reaches the supplier; null for a draft. */
  placedVia: "email" | "phone" | null;
  expectedAt: string;
  locationId: string;
  lines: PoLine[];
  /** Save as draft instead of ordering at once. */
  asDraft: boolean;
}

/** What arrived (spec D2). */
export interface ReceiptInput {
  locationId: string;
  lines: ReceiptLine[];
  note: string;
}

/** The supplier's bill as it arrived (spec D2). */
export interface BillInput {
  number: string;
  issuedAt: string;
  total: string;
}

/** A payment to a supplier (spec D3); without bill ids it covers the oldest open bills first. */
/**
 * One open reservation with just enough of its invoice to cut against it (audit U-03): warehouse
 * staff do not see sales records, but they do need the invoice number, the customer and whether
 * money has come in.
 */
export interface StockHold {
  reservationId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  /** Confirmed money has come in, so the stock may be cut or issued (spec C2). */
  mayIssue: boolean;
  productId: string;
  rollId: string | null;
  locationId: string;
  /** In the product's stock unit. */
  quantity: string;
  shortBy: string;
}

/** What a supplier form sends (spec B1): only the name is required. */
export interface SupplierInput {
  id?: string;
  name: string;
  type?: Supplier["type"];
  accountNumber?: string;
  email?: string;
  phone?: string;
  terms?: Supplier["terms"];
  creditLimit?: string;
  address?: Supplier["address"];
  track1099?: boolean;
  taxForm?: Supplier["taxForm"];
  notes?: string;
  /** Where it was added, for the audit entry. */
  from?: "order";
}

/** What a contact form sends (spec B1). */
export type SupplierContactInput = Omit<SupplierContact, "id" | "status"> & { id?: string };

/** A physical count that disagrees with the books (plan A-1). */
/** The records the Sales and quote pages read together (ApiClient `salesData`). */
export interface SalesData {
  quotes: Quote[];
  customers: Customer[];
  locations: Location[];
}

/** The records the Expenses tab reads together (ApiClient `expensesData`). */
export interface ExpensesData {
  expenses: Expense[];
  recurring: RecurringExpense[];
  suppliers: Supplier[];
  locations: Location[];
}

/** The records the HR screens read together (ApiClient `hrData`). */
export interface HrData {
  employees: Employee[];
  timesheets: Timesheet[];
  ptoRequests: PtoRequest[];
  timeOffPolicies: TimeOffPolicy[];
  timeOffEntries: TimeOffEntry[];
  locations: Location[];
}

/** The records the contract screens and widget read together (ApiClient `contractsData`). */
export interface ContractsData {
  contracts: Contract[];
  lines: ContractLine[];
  changeOrders: ChangeOrder[];
  billings: ContractBilling[];
  waivers: LienWaiver[];
  certificates: InsuranceCertificate[];
  customers: Customer[];
  suppliers: Supplier[];
  locations: Location[];
  bills: Bill[];
  supplierPayments: SupplierPayment[];
}

/** The records the Purchasing page reads together (ApiClient `purchasingData`). */
export interface PurchasingData {
  suppliers: Supplier[];
  contacts: SupplierContact[];
  purchaseOrders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  products: Product[];
  locations: Location[];
  bills: Bill[];
  supplierPayments: SupplierPayment[];
}

/** The stock records the Inventory and roll pages read together (ApiClient `inventoryData`). */
export interface InventoryData {
  products: Product[];
  rolls: Roll[];
  stockMovements: StockMovement[];
  locations: Location[];
  transfers: Transfer[];
  reservations: Reservation[];
  stockAdjustments: StockAdjustment[];
}

export interface StockCorrectionInput {
  productId: string;
  rollId: string | null;
  locationId: string;
  /** What was counted, in the product's stock unit. */
  counted: string;
  reason: string;
}

export interface SupplierPaymentInput {
  supplierId: string;
  amount: string;
  date: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  billIds?: string[];
}

/** A drag, a resize or the reschedule form on one occurrence (spec F). */
export interface MeetingMove {
  meetingId: string;
  /** The date-time the series planned the occurrence for. */
  planned: string;
  start: string;
  durationMin: number;
  scope: MoveScope;
}

/** What Undo needs to put a meeting back after a move. */
export interface MeetingUndo {
  previous: Meeting;
  createdIds: string[];
}

/** The import wizard's starting point (spec G1): the kinds this company can import, saved mappings and history, newest first. */
export interface ImportOverview {
  kinds: ImportKind[];
  mappings: ImportMapping[];
  batches: ImportBatch[];
}

/** The dry run of a file: what each row would do (spec G1 steps 5 and 6). */
export type ImportPreview = Pick<ImportPlan, "rows" | "counts">;

/** An import done: the batch kept for Undo, and every row for the result report and error file. */
export interface ImportResult {
  batch: ImportBatch;
  rows: PlannedRow[];
}

/** Database engines the full product can read from (spec G2). */
export type DatabaseEngine = "sqlserver" | "mysql" | "postgres";

/** What a connection test needs. The password is not part of it: it never leaves the form in the demo. */
export interface DatabaseTestInput {
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
}

/** One table the test found, with a few sample rows and the import kind it most likely holds. */
export interface SampleTable {
  key: string;
  name: string;
  rows: number;
  columns: string[];
  sample: string[][];
  suggested: ImportKind | null;
}

/** The answer of a (simulated) connection test: the server and its tables. */
export interface DatabaseSample {
  server: string;
  tables: SampleTable[];
}

/** What scheduling an invoice's installation needs (feature batch 2, H flow 1). */
export interface ScheduleJobInput {
  invoiceId: string;
  crewId: string;
  date: string;
  startHour: number;
}

/** A reviewer's decision on a payment waiting for verification (spec Appendix A "Approval"). */
export type PaymentDecision = { action: "confirm" } | { action: "reject"; reason: string };

/** A status change on a quote (spec B1); sending may set an expiry date. */
export interface QuoteStatusChange {
  action: QuoteAction;
  /** Send only: the date the quote stops being valid, or null for no expiry. */
  expiresAt?: string | null;
}

export interface NewCustomerInput {
  name: string;
  phone?: string;
  email?: string;
  type?: Customer["type"];
}

/** What a person may change on their own profile (spec A1: default warehouse). */
export type ProfilePatch = Partial<Pick<User, "defaultLocationId">>;

/** Fields an admin may change on a user. Users are disabled, never deleted. */
export type UserPatch = Partial<Pick<User, "roleIds" | "status" | "mfaEnrolled" | "branchId" | "title">>;

/** What changed, for the audit log (blueprint "Audit log": who, when, before and after). */
export interface AuditInput {
  category: AuditEntry["category"];
  action: string;
  target: string;
  before: string | null;
  after: string | null;
}

/**
 * The interface every screen uses for data (CLAUDE.md rule 1). The demo implementation is
 * DemoStore; a real HTTP client can replace it without touching screens. The tenant comes
 * from the session, as it would on a real server.
 */
export interface ApiClient {
  /** Opens a company's data for the signed-in viewer; company-scoped calls read from it. */
  openCompany(companyId: CompanyId, viewer: Viewer): Promise<void>;
  /** Changes the viewer, e.g. when "View as role" is switched. */
  setViewer(viewer: Viewer): void;
  /** Subscribes to data changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Today's date (YYYY-MM-DD) as the data sees it. */
  today(): string;
  /** Restores every company to the generated fixtures. */
  resetDemo(): Promise<void>;
  /**
   * Messages the data layer has for the person once, such as saved demo changes from an older
   * version that had to be reset (docs/specs/feature-batch-02-plan.md, 2.3). Reading clears them.
   */
  takeNotices(): string[];

  /** All companies on the platform (super-admin). */
  listCompanies(): Promise<Company[]>;
  /** Changes a company's products, modules, ceiling or limits; audited in both logs. */
  updateCompanyAccess(companyId: CompanyId, patch: CompanyAccessPatch): Promise<Company>;
  /** Roles, users and branding of any company, read-only (login personas, super-admin "Company access"). */
  listCompanyDirectory(companyId: CompanyId): Promise<CompanyDirectory>;
  /** Closes the company the store has open: the platform admin's pages act as the platform, not a company user. */
  closeCompany(): void;

  /**
   * Data import (spec G1) for a company: from Settings by a user with settings.import.manage in the
   * open company, or from Platform admin → Company by the platform admin. Kinds follow its modules.
   */
  importOverview(companyId: CompanyId): Promise<ImportOverview>;
  /** Checks a file and returns the dry run; writes nothing. */
  previewImport(companyId: CompanyId, request: ImportRequest): Promise<ImportPreview>;
  /** Imports the valid rows, keeps the batch for history and Undo. Audited. */
  runImport(companyId: CompanyId, request: ImportRequest): Promise<ImportResult>;
  /** Undoes an import unless its records changed or are used since. Audited. */
  undoImport(companyId: CompanyId, batchId: string): Promise<ImportBatch>;
  /** Saves the column mapping for the next file of a kind. */
  saveImportMapping(companyId: CompanyId, kind: ImportKind, columns: ColumnMapping): Promise<ImportMapping>;
  /**
   * Tests a database connection (spec G2). Simulated in the demo: it answers with a sample
   * dataset and stores nothing. Same access as data import.
   */
  testDatabaseConnection(companyId: CompanyId, input: DatabaseTestInput): Promise<DatabaseSample>;

  /** The open company's record (modules, ceiling, limits). */
  getCompany(): Promise<Company>;
  /** The open company's settings. */
  getSettings(): Promise<CompanySettings>;
  /** Replaces one settings section and audits the change. */
  updateSettings<K extends keyof CompanySettings>(section: K, value: CompanySettings[K]): Promise<CompanySettings>;

  /** The company's original settings, for Reset to default on settings pages (spec A4). */
  getDefaultSettings(): Promise<CompanySettings>;
  /** Restores one settings section to the company's original values and audits it. */
  resetSettings(section: keyof CompanySettings): Promise<CompanySettings>;

  /** Records of a collection, limited to the viewer's data scope. */
  list<K extends CollectionName>(collection: K): Promise<Collections[K]>;
  /** One record by id, or undefined when it does not exist or is outside the viewer's scope. */
  get<K extends CollectionName>(collection: K, id: string): Promise<ItemOf<K> | undefined>;
  /** Creates or replaces a record. Screens call domain methods; this backs them. */
  save<K extends CollectionName>(collection: K, item: ItemOf<K>, audit?: AuditInput): Promise<ItemOf<K>>;

  /**
   * Settings → Users' list of people, with their roles and MFA state. Other screens keep using
   * `list("users")` for names and pickers until their modules move to the API (ADR 0034).
   */
  listSettingsUsers(): Promise<User[]>;
  /** Settings → Users and Security roles' list of roles with their permissions. */
  listSettingsRoles(): Promise<Role[]>;
  /** Invites a user; fails when the seat limit is reached (spec "Settings: Users"). */
  inviteUser(input: InviteUserInput): Promise<User>;
  /** Changes a user's roles, status, MFA or branch and audits it. */
  updateUser(userId: string, patch: UserPatch): Promise<User>;
  /** Creates or updates a role and audits the before and after permissions. */
  saveRole(role: Role): Promise<Role>;
  /**
   * Puts a default role back to its shipped permissions, scope and description (spec A3). The
   * Owner role is locked, and the granter must hold every permission the reset adds. Audited.
   */
  resetRole(roleId: string): Promise<Role>;
  /** Deletes a non-system role that no user holds. */
  deleteRole(roleId: string): Promise<void>;
  /**
   * Cuts or issues stock reserved for an invoice (spec C1, C2): only once the invoice has a
   * confirmed payment, unless an override reason is given by someone with
   * inventory.reservation.override. A roll cut keeps the remnant rule and links the invoice.
   * Needs inventory.roll.cut. Audited.
   */
  /** Open reservations with their invoice number, customer and payment state. Needs inventory.roll.view or inventory.product.view. */
  /** The signed-in user's id. */
  whoAmI(): Promise<string>;
  /**
   * Confirms it is the signed-in person with a code from their authenticator app before a
   * high-impact change (spec rule 23). The real API checks the code and remembers the step-up for
   * 5 minutes; the demo accepts any 6 digits.
   */
  verifyStepUp(code: string): Promise<void>;
  /** Saves a draft expense or records one with its receipt (spec F1). */
  saveExpense(input: ExpenseInput, files: File[]): Promise<Expense>;
  /** Approves or rejects an expense. */
  reviewExpense(id: string, decision: ExpenseDecision): Promise<Expense>;
  /** Voids an expense with a reason. */
  voidExpense(id: string, reason: string): Promise<Expense>;
  /** Adds or edits a recurring expense. */
  saveRecurringExpense(input: RecurringExpenseInput): Promise<RecurringExpense>;
  /** The business report (spec F2), computed from the company's whole record. */
  businessReport(filters: BusinessFilters): Promise<BusinessReport>;
  /** Schedules a meeting and invites its guests (spec E). */
  createMeeting(input: MeetingInput): Promise<Meeting>;
  /** Edits a meeting; a significant change asks every guest again. */
  updateMeeting(
    id: string,
    patch: Partial<Pick<Meeting, "title" | "notes" | "location" | "start" | "durationMin" | "reminderMin">>,
  ): Promise<Meeting>;
  /** Cancels a meeting and tells its guests. */
  cancelMeeting(id: string): Promise<Meeting>;
  /** Takes one guest off a meeting and sends them a cancellation. */
  removeGuest(meetingId: string, attendeeId: string): Promise<Meeting>;
  /** The signed-in person answers an invitation or request. */
  respondToMeeting(meetingId: string, reply: ReplyInput): Promise<Meeting>;
  /** Stands in for a guest's reply, from the Outbox. */
  simulateReply(outboxId: string, reply: ReplyInput): Promise<Meeting>;
  /** The organiser accepts or declines a proposed time. */
  decideProposal(meetingId: string, attendeeId: string, accept: boolean): Promise<Meeting>;
  /** Any user asks someone to meet. */
  requestMeeting(input: MeetingRequestInput): Promise<Meeting>;
  /** The calendar file for Add to my calendar. */
  meetingCalendarFile(meetingId: string): Promise<{ fileName: string; text: string }>;
  /** Adds or edits a contract and its schedule (spec D1). */
  saveContract(input: ContractInput): Promise<Contract>;
  /** Sends a draft for signature. */
  sendContract(id: string): Promise<Contract>;
  /** Takes a contract back to draft. */
  recallContract(id: string): Promise<Contract>;
  /** Records a simulated signature. */
  signContract(id: string, input: SignatureInput): Promise<Contract>;
  /** Marks substantial completion. */
  completeContract(id: string): Promise<Contract>;
  /** Closes a contract, with a reason when overriding a check. */
  closeContract(id: string, overrideReason: string | null): Promise<Contract>;
  /** Ends a contract with a reason. */
  terminateContract(id: string, reason: string): Promise<Contract>;
  /** Starts the next term as a new draft. */
  renewContract(id: string): Promise<Contract>;
  /** Posts a pay application and raises its invoice or bill. */
  postBilling(contractId: string, input: BillingInput): Promise<ContractBilling>;
  /** Releases held retainage on its own invoice or bill. */
  releaseRetainage(contractId: string, input: ReleaseInput): Promise<ContractBilling>;
  /** Voids the latest billing. */
  voidBilling(billingId: string, reason: string): Promise<ContractBilling>;
  /** Submits a change order for approval. */
  saveChangeOrder(contractId: string, input: ChangeOrderInput): Promise<ChangeOrder>;
  /** Approves or rejects a change order. */
  decideChangeOrder(id: string, decision: { approve: boolean; reason: string }): Promise<ChangeOrder>;
  /** Records a lien waiver. */
  recordWaiver(contractId: string, input: WaiverInput): Promise<LienWaiver>;
  /** Saves a certificate of insurance. */
  saveCertificate(contractId: string, input: CertificateInput): Promise<InsuranceCertificate>;
  /** Adds attachments to a contract. */
  addContractFiles(contractId: string, files: File[]): Promise<void>;
  /** Adds or edits a person (spec C1). */
  saveEmployee(input: EmployeeInput): Promise<Employee>;
  /** Ticks or unticks an onboarding or offboarding step. */
  setChecklistItem(
    employeeId: string,
    list: "onboarding" | "offboarding",
    itemId: string,
    done: boolean,
  ): Promise<void>;
  /** Starts offboarding someone. */
  startOffboarding(employeeId: string): Promise<Employee>;
  /** Adds files to a person's documents. */
  addEmployeeDocuments(employeeId: string, files: File[]): Promise<void>;
  /** Changes the signed-in person's phone and emergency contact. */
  updateMyEmployeeProfile(patch: MyProfilePatch): Promise<Employee>;
  /** Saves a week of hours. */
  saveTimesheet(input: TimesheetInput): Promise<Timesheet>;
  /** Sends a timesheet for approval. */
  submitTimesheet(id: string): Promise<Timesheet>;
  /** Approves or rejects submitted timesheets. */
  decideTimesheets(ids: readonly string[], decision: TimesheetDecision): Promise<void>;
  /** Reopens an approved timesheet with a reason. */
  reopenTimesheet(id: string, reason: string): Promise<Timesheet>;
  /** Bulk hours from the template; a dry run unless apply is true. */
  uploadTimesheets(input: {
    table: ImportTable;
    fileName: string;
    apply: boolean;
    own: boolean;
  }): Promise<TimesheetUploadResult>;
  /** Clocks the signed-in person in. */
  clockIn(): Promise<void>;
  /** Clocks the signed-in person out and fills the draft timesheet. */
  clockOut(): Promise<void>;
  /** Asks for time off. */
  requestTimeOff(input: TimeOffInput): Promise<PtoRequest>;
  /** Approves or declines a time-off request. */
  decideTimeOff(id: string, decision: TimeOffDecision): Promise<PtoRequest>;
  /** Cancels a time-off request. */
  cancelTimeOff(id: string): Promise<PtoRequest>;
  /** Adds or takes hours from a balance. */
  adjustTimeOff(input: TimeOffAdjustment): Promise<void>;
  /** Adds or edits a time-off policy. */
  saveTimeOffPolicy(policy: TimeOffPolicy): Promise<TimeOffPolicy>;
  /** Everyone's monthly commission statements, computed live. */
  listCommissionStatements(): Promise<CommissionStatementRow[]>;
  /** Commission per person for a period, for Sales → Team. */
  teamCommission(range: { from: string; to: string }): Promise<[string, TeamCommission][]>;
  /** Approves a month's statement. */
  approveStatement(userId: string, month: string): Promise<CommissionStatement>;
  /** Adds a manual change to an open statement. */
  addCommissionAdjustment(input: CommissionAdjustmentInput): Promise<void>;
  /** Accepts or waives a reversal outside its window. */
  decideReversal(input: {
    userId: string;
    month: string;
    lineId: string;
    outcome: "applied" | "waived";
    reason: string;
  }): Promise<void>;
  /** Saves a plan; one already in use becomes a new version. */
  saveCommissionPlan(plan: CommissionPlan): Promise<CommissionPlan>;
  /** Puts someone on a plan. */
  assignPlan(input: PlanAssignmentInput): Promise<CommissionAssignment>;
  /** The rep signs their plan by typing their name. */
  acknowledgePlan(assignmentId: string, signedName: string): Promise<void>;
  /** Shares an invoice between up to two reps. */
  setCommissionSplit(invoiceId: string, split: { userId: string; pct: string }[]): Promise<void>;
  /** Issues a credit note for part of an invoice. */
  issueCreditNote(invoiceId: string, input: CreditNoteInput): Promise<Invoice>;
  /** The company's pay periods, making sure the current one exists. */
  listPayPeriods(): Promise<PayPeriod[]>;
  /** One pay period with live gross pay and what still blocks it. */
  reviewPayPeriod(id: string): Promise<PayPeriodReview>;
  /** Leaves someone out of a run with a reason, or brings them back. */
  setPayExclusion(id: string, employeeId: string, reason: string | null): Promise<void>;
  /** Approves a pay period and freezes its lines. */
  approvePayPeriod(id: string): Promise<PayPeriod>;
  /** Returns an approved period to review. */
  reopenPayPeriod(id: string): Promise<PayPeriod>;
  /** Marks a period exported and locks it. */
  exportPayPeriod(id: string): Promise<PayPeriod>;
  /** Everything the employee portal shows the signed-in person. */
  myPortal(): Promise<MyPortal>;
  listStockHolds(): Promise<StockHold[]>;
  /** Saves one event's switch, channels and template (spec A4). Needs settings.notifications.manage. Audited. */
  saveNotificationRule(rule: Omit<NotificationRule, "updatedAt" | "updatedBy">): Promise<NotificationRule>;
  /** Puts one event back to its defaults. Needs settings.notifications.manage. Audited. */
  resetNotificationRule(key: NotificationEventKey): Promise<void>;
  /** The Outbox: own rows, or all with settings.outbox.view; restricted rows redacted (spec A4). */
  listOutbox(all: boolean): Promise<OutboxMessage[]>;
  /** Sends a failed message again. */
  retryOutbox(id: string): Promise<OutboxMessage>;
  /** Cancels a scheduled message. */
  cancelOutbox(id: string): Promise<OutboxMessage>;
  /** Presenter tool: marks a sent message as bounced. Needs settings.outbox.view. */
  simulateBounce(id: string): Promise<OutboxMessage>;
  /** The signed-in person's stored notifications, newest first. */
  listMyNotifications(): Promise<InAppNotification[]>;
  /** Marks the person's own notifications read. */
  markNotificationsRead(ids: readonly string[]): Promise<void>;
  issueReservation(reservationId: string, overrideReason?: string): Promise<Reservation>;
  /** Records a stock adjustment with a reason; above the company's quantity it waits for approval. Audited. */
  recordAdjustment(input: AdjustmentInput): Promise<StockAdjustment>;
  /**
   * What the Inventory and roll pages read: the catalog, rolls, the boxed-stock ledger, warehouses,
   * transfers, reservations and adjustments. With the real API (ADR 0035, ADR 0038) reservations
   * come from invoices; adjustments stay empty until inventory part 2, and a list the person may
   * not see comes back empty.
   */
  inventoryData(): Promise<InventoryData>;
  /**
   * What the Purchasing page reads: suppliers, contacts, orders, receipts, the catalog and
   * warehouses, bills and supplier payments. With the real API (purchasing, part 1; ADR 0036) bills
   * and supplier payments stay empty until they move with the ledger (P12).
   */
  purchasingData(): Promise<PurchasingData>;
  /**
   * What the Expenses tab reads: expenses within the person's data scope, recurring templates,
   * vendors and locations, from one source so their ids match (P12 part 2; ADR 0041).
   */
  expensesData(): Promise<ExpensesData>;
  /**
   * What the contract screens and the dashboard widget read: contracts within the person's data
   * scope with their lines, change orders, billings, waivers and certificates, and the customers,
   * suppliers, warehouses, bills and supplier payments they point at, from one source so their ids
   * match (contracts part 1; ADR 0044). A list the person may not see comes back empty.
   */
  contractsData(): Promise<ContractsData>;
  /**
   * What HR Home, People, Timesheets, Time off and Settings → HR read: people, timesheets and
   * time off within the person's data scope, the policies and the warehouses, from one source so
   * their ids match (HR part 1; ADR 0046). A list the person may not see comes back empty.
   */
  hrData(): Promise<HrData>;
  /**
   * What the Sales and quote pages read: quotes and customers within the person's data scope, and
   * warehouses. Invoices and what settles them are read through `list` (ADR 0038).
   */
  salesData(): Promise<SalesData>;
  /** Moves a roll to another bin; nothing else about a roll changes. Needs inventory.roll.edit. Audited. */
  moveRoll(rollId: string, bin: string): Promise<Roll>;
  /** Sets stock to what was counted, with a reason (plan A-1). Needs inventory.stock.correct. Audited. */
  correctStockCount(input: StockCorrectionInput): Promise<StockAdjustment>;
  /** Approves or rejects a waiting adjustment; needs inventory.stock.approve and someone else. Audited. */
  reviewAdjustment(adjustmentId: string, decision: AdjustmentDecision): Promise<StockAdjustment>;
  /** Creates an invoice for a length of a roll and reserves the roll for it (spec C1). Audited. */
  createRollInvoice(input: RollInvoiceInput): Promise<Invoice>;
  /**
   * Adds a customer at once from a picker (spec A6), with the company's default terms and no
   * addresses yet, so it reads as "New, profile incomplete". Needs customers.customer.create. Audited.
   */
  createCustomer(input: NewCustomerInput): Promise<Customer>;
  /** Saves a customer's profile and addresses. Needs customers.customer.edit. Audited. */
  saveCustomer(customer: Customer): Promise<Customer>;
  /**
   * Saves a quote's content (spec B1). A new quote is a Draft with the next number from the quote
   * prefix and needs only a customer; the status changes only through updateQuoteStatus. Audited.
   */
  saveQuote(quote: Quote): Promise<Quote>;
  /**
   * Moves a quote on (spec B1): send (Pending, after full validation, with an optional expiry
   * date), accept or decline, as quoteActions allows in its state. Needs sales.quote.edit. Audited.
   */
  updateQuoteStatus(quoteId: string, change: QuoteStatusChange): Promise<Quote>;
  /**
   * Converts an open quote into an invoice dated today (spec "Quote builder → invoice", B1) after
   * full validation: totals are recomputed under the job site's tax rule, and the quote is marked
   * Converted. Audited.
   */
  convertQuoteToInvoice(quoteId: string): Promise<Invoice>;
  /**
   * Records a customer payment with its proof files (spec Appendix A "Record payment"). Needs
   * sales.payment.record; the extra above the balance becomes credit only with
   * sales.payment.apply_credit. Files are checked by their real type and stored with the payment,
   * or not at all. With approval on, the payment waits for verification. Audited.
   */
  recordPayment(input: RecordPaymentInput, files: File[]): Promise<Payment>;
  /** Confirms or rejects a pending payment; needs sales.payment.approve and a different person. Audited. */
  reviewPayment(paymentId: string, decision: PaymentDecision): Promise<Payment>;
  /** Adds proof files to a payment that is not voided or rejected. Audited. */
  attachPaymentFiles(paymentId: string, files: File[]): Promise<Payment>;
  /** A stored file's bytes, for the viewer and downloads; seeded proofs are generated placeholders. */
  getFile(fileId: string): Promise<Blob>;
  /** Voids a confirmed or pending payment with a reason; the balance comes back. Needs sales.payment.void. Audited. */
  voidPayment(paymentId: string, reason: string): Promise<Payment>;
  /** Marks an invoice as sent to the customer. Needs sales.invoice.edit. Audited. */
  markInvoiceSent(invoiceId: string): Promise<Invoice>;
  /** Voids an invoice without confirmed payments, with a reason. Needs sales.invoice.void. Audited. */
  voidInvoice(invoiceId: string, reason: string): Promise<Invoice>;
  /** Writes off the remaining balance up to the company's maximum, with a reason. Needs sales.payment.write_off. Audited. */
  writeOffBalance(invoiceId: string, reason: string): Promise<InvoiceAdjustment>;
  /** Applies the customer's credit to an invoice, up to its balance. Needs sales.payment.apply_credit. Audited. */
  applyCredit(invoiceId: string): Promise<InvoiceAdjustment>;
  /** Refunds customer credit with mandatory proof. Needs sales.payment.refund. Audited. */
  refundCredit(input: RefundInput, files: File[]): Promise<Refund>;
  /**
   * Records a job's sign-off; its invoice's held balance becomes due and it is marked sent (spec B6).
   * Needs installation.job.sign_off. Audited.
   */
  signOffJob(jobId: string, signer: string): Promise<Job>;
  /** Creates and links the invoice of a job that has none, from its materials and labor. Audited. */
  createInvoiceFromJob(jobId: string): Promise<Invoice>;
  /** Schedules the installation of an invoice without a job, costed from it. Needs installation.job.create. Audited. */
  scheduleJob(input: ScheduleJobInput): Promise<Job>;
  /** Starts a scheduled job on or after its day. Needs installation.job.edit. Audited. */
  startJob(jobId: string): Promise<Job>;
  /**
   * Moves or resizes one occurrence, this and following, or all (spec F). Needs meetings.meeting.edit.
   * Returns the saved meetings, attendee conflicts at the new time and the Undo record. Audited.
   */
  rescheduleMeeting(move: MeetingMove): Promise<{ meetings: Meeting[]; conflicts: Conflict[]; undo: MeetingUndo }>;
  /** Undoes a move. Audited. */
  undoReschedule(undo: MeetingUndo): Promise<Meeting>;
  /** Creates a purchase order as a draft or ordered at once (spec D1). Needs purchasing.order.create. Audited. */
  createPurchaseOrder(input: NewPurchaseOrderInput): Promise<PurchaseOrder>;
  /** Sends a draft to the supplier, by email or noted as phoned in (spec B2). Audited. */
  markOrdered(poId: string, via?: "email" | "phone"): Promise<PurchaseOrder>;
  /** Adds or edits a supplier (spec B1). Needs purchasing.supplier.create or edit. Audited. */
  saveSupplier(input: SupplierInput): Promise<Supplier>;
  /** Deactivates or reactivates a supplier; never deleted. Audited. */
  setSupplierStatus(id: string, status: Supplier["status"]): Promise<Supplier>;
  /** Adds or edits a contact, keeping one primary per supplier (spec B1). Audited. */
  saveSupplierContact(input: SupplierContactInput): Promise<SupplierContact>;
  /** Deactivates or reactivates a contact; the primary passes on. Audited. */
  setContactStatus(id: string, status: SupplierContact["status"]): Promise<SupplierContact>;
  /** Cancels a purchase order nothing has arrived for, with a reason. Audited. */
  cancelOrder(poId: string, reason: string): Promise<PurchaseOrder>;
  /**
   * Records a goods receipt (spec D2): good and damaged units per line, rolls with numbers and dye
   * lots, the receiving warehouse. Writes stock movements and rolls. Needs purchasing.order.receive. Audited.
   */
  recordReceipt(poId: string, input: ReceiptInput): Promise<GoodsReceipt>;
  /** Enters the supplier's bill against unbilled receipts, flags differences, attaches the file. Audited. */
  enterBill(poId: string, input: BillInput, files: File[]): Promise<Bill>;
  /** Pays a supplier over its open bills with mandatory proof; approval as for customer payments. Audited. */
  recordSupplierPayment(input: SupplierPaymentInput, files: File[]): Promise<SupplierPayment>;
  /** Confirms or rejects a supplier payment that waits; needs purchasing.payment.approve. Audited. */
  reviewSupplierPayment(paymentId: string, decision: PaymentDecision): Promise<SupplierPayment>;
  /** Voids a supplier payment with a reason; needs purchasing.payment.void. Audited. */
  voidSupplierPayment(paymentId: string, reason: string): Promise<SupplierPayment>;
  /**
   * Starts a transfer between two warehouses (spec A1): boxed stock leaves the sender at once and
   * rolls are marked in transit. Needs inventory.transfer.create. Audited.
   */
  createTransfer(input: TransferInput): Promise<Transfer>;
  /** Receives a transfer at its destination. Needs inventory.transfer.receive. Audited. */
  receiveTransfer(transferId: string): Promise<Transfer>;
  /**
   * Creates or changes a warehouse or showroom (spec A1). Exactly one warehouse is the company
   * default, and a location holding stock cannot become a showroom. Needs settings.locations.manage. Audited.
   */
  saveLocation(location: Location): Promise<Location>;
  /** Changes the signed-in person's own profile, such as their default warehouse. Audited. */
  updateMyProfile(patch: ProfilePatch): Promise<User>;
  /** Appends an entry to the open company's audit log as the signed-in user. */
  recordAudit(entry: AuditInput): Promise<void>;
}
