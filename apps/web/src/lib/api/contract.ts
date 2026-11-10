import type {
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
  listStockHolds(): Promise<StockHold[]>;
  issueReservation(reservationId: string, overrideReason?: string): Promise<Reservation>;
  /** Records a stock adjustment with a reason; above the company's quantity it waits for approval. Audited. */
  recordAdjustment(input: AdjustmentInput): Promise<StockAdjustment>;
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
  /** Sends a draft purchase order to the supplier. Audited. */
  markOrdered(poId: string): Promise<PurchaseOrder>;
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
