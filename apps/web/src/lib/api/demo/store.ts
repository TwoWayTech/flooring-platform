import { format } from "date-fns";
import {
  branchManageDenial,
  PAYMENT_CONTROLS_OWNER_ONLY,
  paymentControlsLoosened,
  branchPlacementDenial,
  canAssignRole,
  invoiceFromQuote,
  nextNumber,
  dateShift,
  isDefaultRoleKey,
  permissionsForModules,
  featureOn,
  PRODUCT_MODULES,
  roleTemplate,
  boxedStock,
  dec,
  locationName,
  receiveTransfer,
  startTransfer,
  validateTransfer,
  escalations,
  shiftDates,
  upgradeCompany,
  QUOTE_ACTION_STATUS,
  quoteActions,
  quoteDraftProblem,
  quoteIsOpen,
  quoteSendProblems,
  quoteState,
  quoteStateLabel,
  type AuditEntry,
  type Company,
  type CompanyId,
  type CompanySettings,
  type PermissionKey,
  seesDisabledPeople,
  SENSITIVE,
  type BusinessFilters,
  type PaymentsReportQuery,
  type PnlQuery,
  type SalesByCategoryQuery,
  type CommissionPlan,
  type Meeting,
  type MyMeetings,
  type ContractLine,
  type Employee,
  type ImportTable,
  type TimeOffPolicy,
  type PlatformFixtures,
  type NotificationEventKey,
  type NotificationRule,
  type Quote,
  type Supplier,
  type SupplierContact,
  type RecordPaymentInput,
  type RefundInput,
  type Role,
  type Customer,
  type Location,
  type Transfer,
  type TransferInput,
  type User,
  type ColumnMapping,
  type ImportKind,
  type ImportRequest,
  accessPatchProblem,
  supportGrantExpiresAt,
  supportRequestInputProblem,
  type PlatformAccessPatch,
  type PlatformAuditQuery,
  type SupportRequestInput,
  SETTINGS_SCOPE_MESSAGE,
  SETTINGS_SECTIONS,
  settingsSectionProblem,
  LOCALIZATION_TABS,
  localizationTabProblem,
  localizationTabStored,
  taxInForce,
  type LocalizationSettings,
  type SettingsSectionRule,
} from "@workspace/shared";
import { viewerAccess } from "../../access";
import type {
  Collections,
  ExpenseDecision,
  ExpenseInput,
  RecurringExpenseInput,
  MeetingInput,
  MeetingRequestInput,
  MeetingsData,
  ReplyInput,
  BillingInput,
  CertificateInput,
  ChangeOrderInput,
  ContractInput,
  ReleaseInput,
  SignatureInput,
  WaiverInput,
  ApiClient,
  AuditInput,
  CollectionName,
  DatabaseTestInput,
  ScheduleJobInput,
  InviteUserInput,
  ItemOf,
  CommissionAdjustmentInput,
  CreditNoteInput,
  EmployeeInput,
  MyProfilePatch,
  PlanAssignmentInput,
  TimeOffAdjustment,
  TimeOffDecision,
  TimeOffInput,
  TimesheetDecision,
  TimesheetInput,
  NewCustomerInput,
  AdjustmentDecision,
  AdjustmentInput,
  StockCorrectionInput,
  SupplierContactInput,
  SupplierInput,
  MeetingMove,
  MeetingUndo,
  BillInput,
  NewPurchaseOrderInput,
  ReceiptInput,
  SupplierPaymentInput,
  PaymentDecision,
  ProfilePatch,
  RollInvoiceInput,
  QuoteStatusChange,
  UserPatch,
  Viewer,
} from "../contract";
import { assertOwnerRemains, assertSeatAvailable, DemoRuleError, diffSummary, permissionDiff } from "./admin-rules";
import { demoAuditAsSeen } from "./audit-view";
import { demoAuditPage, type DemoPlatformAuditRow } from "./platform-audit";
import { demoAccessDiff, demoDetail, demoSummary, withAccess, type DemoCompanyFacts } from "./platform-console";
import { demoGrants, demoGrantViews, demoRequestRefusal, type DemoSupportGrant } from "./platform-support";
// Platform admin part 4 (ADR 0054) keeps its own imports, so the lists above stay as they are.
import {
  BILLING_OWNER_ONLY_MESSAGE,
  SUPPORT_CLOSED_MESSAGES,
  SUPPORT_OWNER_ONLY_MESSAGE,
  type SupportGrantStep,
} from "@workspace/shared";
import { demoBilling, demoStanding } from "./company-standing";
import { demoGrantDecision, demoOwnerGrantViews } from "./platform-support";
// Platform admin part 2 (ADR 0056) keeps its own imports, so the lists above stay as they are.
import {
  adminReasonProblem,
  COMPANY_STATUS_ACTIONS,
  COMPANY_STATUS_AUDIT_ACTIONS,
  companyStatusAuditBody,
  companyStatusView,
  confirmNameProblem,
  newPlanValues,
  PLAN_MESSAGES,
  planAuditBody,
  planChanges,
  planPatchProblem,
  planProblem,
  staleStatusRefusal,
  statusActionBodyProblem,
  statusAfter,
  type CompanyStatusInput,
  type PlanAuditBody,
  type PlatformPlan,
  type PlatformPlanInput,
  type PlatformPlanPatch,
} from "@workspace/shared";
import { DemoRefusal } from "./admin-rules";
import { DEMO_PLANS_KEY, demoFixturePlans, demoPlans, demoPlanStore, type DemoPlanEdit } from "./platform-plans";
import { DEMO_STATUS_KEY, demoConsoleStanding, demoStatusFacts, demoStatusStore } from "./platform-status";
// Data import, part 1 (ADR 0057) keeps its own imports, so the lists above stay as they are.
import { FULL_IMPORT_HOLDER, type ImportHolder } from "@workspace/shared";
// GET /company (ADR 0051, "GET /company") keeps its own imports, so the lists above stay as they are.
import { seesCeiling } from "@workspace/shared";
import type { WorkspaceFacts } from "../contract";
import { CompanyDb } from "./company-db";
import { loadCompanyFixtures, loadPlatformFixtures } from "./fixtures";
import { applyScope, scopeSubject } from "./scope";
import { saveSupplier, saveSupplierContact, setContactStatus, setSupplierStatus } from "./supplier-actions";
import {
  cancelOutbox,
  listOutbox,
  markNotificationsRead,
  myNotifications,
  notifyQuoteSent,
  releaseScheduled,
  resetNotificationRule,
  retryOutbox,
  saveNotificationRule,
  simulateBounce,
} from "./notification-actions";
import { assertRollEditOnly, savePermissions, wasteChanged } from "./permission-rules";
import { indexedDbFileStore, type FileStore } from "./file-store";
import { createInvoiceFromJob, scheduleJob, signOffJob, startJob } from "./job-actions";
import {
  cancelMeeting,
  createMeeting,
  meetingCalendarFile,
  meetingsData,
  myMeetings,
  removeGuest,
  requestMeeting,
  respondToMeeting,
  simulateReply,
  updateMeeting,
  type MeetingScope,
} from "./meeting-actions";
import { decideProposal, MeetingMoveMemo, rescheduleMeeting, undoReschedule } from "./meeting-moves";
import { meetingSightFor, visibleMeetings } from "./meeting-sight";
import {
  cancelOrder,
  createPurchaseOrder,
  enterBill,
  markOrdered,
  recordReceipt,
  recordSupplierPayment,
  reviewSupplierPayment,
  voidSupplierPayment,
} from "./purchasing-actions";
import {
  createRollInvoice,
  issueReservation,
  listStockHolds,
  correctStockCount,
  recordAdjustment,
  reserveFor,
  reservationSummary,
  reviewAdjustment,
} from "./inventory-actions";
import {
  applyCredit,
  markInvoiceSent,
  refundCredit,
  voidInvoice,
  voidPayment,
  writeOffBalance,
} from "./invoice-actions";
import {
  addEmployeeDocuments,
  saveEmployee,
  setChecklistItem,
  startOffboarding,
  updateMyProfile as updateMyEmployeeProfile,
} from "./people-actions";
import {
  clockIn,
  clockOut,
  decideTimesheets,
  reopenTimesheet,
  saveTimesheet,
  submitTimesheet,
  uploadTimesheets,
} from "./timesheet-actions";
import { adjustTimeOff, cancelTimeOff, decideTimeOff, requestTimeOff, saveTimeOffPolicy } from "./timeoff-actions";
import {
  acknowledgePlan,
  addCommissionAdjustment,
  approveStatement,
  assignPlan,
  decideReversal,
  issueCreditNote,
  saveCommissionPlan,
  setCommissionSplit,
  statementRows,
  teamCommission,
} from "./commission-actions";
import {
  approvePayPeriod,
  ensureCurrentPeriod,
  exportPayPeriod,
  reopenPayPeriod,
  reviewPayPeriod,
  setPayExclusion,
} from "./pay-actions";
import { myPortal } from "./portal-actions";
import {
  addContractFiles,
  closeContract,
  completeContract,
  decideChangeOrder,
  postBilling,
  raiseContractReminders,
  recallContract,
  recordWaiver,
  releaseRetainage,
  renewContract,
  saveCertificate,
  saveChangeOrder,
  saveContract,
  sendContract,
  signContract,
  terminateContract,
  voidBilling,
} from "./contract-actions";
import { raiseRecurringDrafts, reviewExpense, saveExpense, saveRecurringExpense, voidExpense } from "./expense-actions";
import {
  demoBusinessReport,
  demoPaymentsReport,
  demoPnlReport,
  demoReportOptions,
  demoSalesByCategoryReport,
  type ReportViewer,
} from "./report-actions";
import { sampleDatabase } from "./sample-database";
import {
  importOverview,
  previewImport,
  runImport,
  saveImportMapping,
  undoImport,
  type ImportScope,
} from "./import-actions";
import { attachPaymentFiles, readFile, recordPayment, reviewPayment, type ActionContext } from "./payment-actions";
import { clearStored, readLegacy, readStored, removeLegacy, writeStored } from "./storage";

const PLATFORM_KEY = "platform";
/** The demo's platform audit log and support requests (docs/specs/platform-admin.md, part 3, "Demo mode"). */
const PLATFORM_AUDIT_KEY = "platform-audit";
const PLATFORM_SUPPORT_KEY = "platform-support";

/** Collections that need a permission even to read: an API would answer 403 for the whole list. */
const PRIVATE_COLLECTIONS: Partial<Record<CollectionName, PermissionKey>> = {
  payPeriods: "hr.payroll.view",
  bonuses: "hr.payroll.view",
  contractorPayments: "hr.payroll.view",
  commissionPlans: "hr.commission.view",
  commissionAssignments: "hr.commission.view",
  commissionStatements: "hr.commission.view",
  commissionAdjustments: "hr.commission.view",
  contracts: "contracts.contract.view",
  contractLines: "contracts.contract.view",
  changeOrders: "contracts.contract.view",
  contractBillings: "contracts.billing.view",
  lienWaivers: "contracts.compliance.view",
  insuranceCertificates: "contracts.compliance.view",
};

const nowStamp = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");
const newId = (companyId: string, kind: string) => `${companyId}-${kind}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * The demo implementation of ApiClient (spec section 1): generated fixtures plus a per-company
 * localStorage overlay. It enforces the same rules a real API would (seat limit, last Owner,
 * no privilege escalation, data scope) so screens cannot bypass them.
 */
export class DemoStore implements ApiClient {
  private readonly listeners = new Set<() => void>();
  private readonly dbs = new Map<CompanyId, CompanyDb>();
  private platform: PlatformFixtures | null = null;
  private current: CompanyDb | null = null;
  private viewer: Viewer | null = null;
  private readonly todayIso = format(new Date(), "yyyy-MM-dd");
  private notices: string[] = [];
  /** Each meeting's last move, for Undo; in memory only (ADR 0051 "Part 3", B.6 item 6). */
  private readonly meetingMoves = new MeetingMoveMemo();

  /** Proof files live outside the overlay, behind the FileStore interface (spec Appendix A). */
  constructor(private readonly files: FileStore = indexedDbFileStore) {}

  async openCompany(companyId: CompanyId, viewer: Viewer) {
    this.current = await this.db(companyId);
    this.viewer = viewer;
    this.meetingMoves.clear();
    releaseScheduled(this.actionContext(this.current));
    raiseRecurringDrafts(this.actionContext(this.current));
    await raiseContractReminders(this.actionContext(this.current));
    if (this.current.upgradeNotice && !this.notices.includes(this.current.upgradeNotice)) {
      this.notices.push(this.current.upgradeNotice);
    }
    this.emit();
  }

  takeNotices() {
    const pending = this.notices;
    this.notices = [];
    return pending;
  }

  setViewer(viewer: Viewer) {
    this.viewer = viewer;
    this.emit();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  today() {
    return this.todayIso;
  }

  async resetDemo() {
    clearStored();
    // Reset demo data clears payment files too (spec Appendix A "Files and storage").
    await this.files.clear().catch(() => undefined);
    this.dbs.clear();
    this.platform = null;
    this.meetingMoves.clear();
    if (this.current) this.current = await this.db(this.current.companyId);
    this.emit();
  }

  async listCompanies() {
    const platform = await this.platformData();
    const changed = this.changedCompanies(platform.companies);
    return platform.companies.map((c) => changed[c.id] ?? c);
  }

  async listPlatformCompanies() {
    const companies = await this.listCompanies();
    return Promise.all(
      companies.map(async (c) => demoSummary(c, await this.consoleFacts(c.id), this.consoleStanding(c))),
    );
  }

  async getPlatformCompany(companyId: string) {
    const company = await this.platformCompany(companyId);
    return company ? this.consoleDetail(company) : null;
  }

  /**
   * The console's change of access (docs/specs/platform-admin.md, "Demo mode"): the same refusals as
   * the API (`accessPatchProblem`). A save that changes nothing writes nothing, as on the API (part
   * 3, "Demo mode"). Otherwise the merged company is saved, the company's own log gets "Changed
   * company access", as the demo always did, and the platform audit log gets a
   * `company.access_changed` row with the shared diff. Every demo company has a plan.
   */
  async updatePlatformCompanyAccess(companyId: string, patch: PlatformAccessPatch) {
    const before = await this.platformCompany(companyId);
    if (!before) throw new DemoRuleError("That company does not exist.");
    const problem = accessPatchProblem({ products: [before.product], hasSubscription: true }, patch);
    if (problem) throw new DemoRuleError(problem.message);
    const after = withAccess(before, patch);
    const diff = demoAccessDiff(before, after);
    if (!diff) return this.consoleDetail(before);
    writeStored(PLATFORM_KEY, { ...this.changedCompanies(), [before.id]: after });
    const db = await this.db(before.id);
    const { before: was, after: now } = diffSummary(before, after);
    this.appendAudit(
      db,
      { category: "ceiling", action: "Changed company access", target: before.name, before: was, after: now },
      {
        actorName: "Platform admin",
        actorRole: "Super-admin",
      },
    );
    this.appendPlatformAudit({
      tenantId: before.id,
      companyName: before.name,
      action: "company.access_changed",
      targetType: "tenant",
      targetId: before.id,
      before: diff.before,
      after: diff.after,
    });
    this.emit();
    return this.consoleDetail(after);
  }

  async listPlatformAudit(query: PlatformAuditQuery) {
    return demoAuditPage(this.storedList(PLATFORM_AUDIT_KEY), query);
  }

  async listPlatformSupportGrants(companyId: string) {
    return demoGrantViews(this.storedList(PLATFORM_SUPPORT_KEY), companyId, new Date());
  }

  /**
   * A support-access request in the demo (docs/specs/platform-admin.md, part 3, "Demo mode"): the
   * shared field check, then the company must exist, then the shared limits, in the API's order
   * ("Refusal order": the body's 400 before the 404, 409 and 429). The grant and its
   * `support.requested` row are kept in this browser. No step-up, like the demo's access save. The
   * company's Owner approves or revokes it in Settings → Users (part 4); otherwise it stays pending
   * until it expires.
   */
  async requestSupportAccess(input: SupportRequestInput) {
    const problem = supportRequestInputProblem(input);
    if (problem) throw new DemoRuleError(problem);
    const company = await this.platformCompany(input.companyId);
    if (!company) throw new DemoRuleError("That company does not exist.");
    const stored = this.storedList(PLATFORM_SUPPORT_KEY);
    const now = new Date();
    const refusal = demoRequestRefusal(stored, company.id, now);
    if (refusal) throw new DemoRuleError(refusal.message);
    const reason = input.reason.trim();
    const grant: DemoSupportGrant = {
      id: newId(company.id, "sup"),
      companyId: company.id,
      companyName: company.name,
      reason,
      createdAt: now.toISOString(),
      expiresAt: supportGrantExpiresAt(now, input.hours).toISOString(),
      approvedAt: null,
      revokedAt: null,
    };
    writeStored(PLATFORM_SUPPORT_KEY, [...demoGrants(stored), grant]);
    this.appendPlatformAudit({
      tenantId: company.id,
      companyName: company.name,
      action: "support.requested",
      targetType: "support_access_grant",
      targetId: grant.id,
      before: null,
      after: { reason, expiresAt: grant.expiresAt },
    });
    this.emit();
    return { id: grant.id };
  }

  // Platform admin part 4: company standing, billing and support access (docs/specs/platform-admin.md,
  // part 4, "Demo mode"). The same Owner rule and messages as the API; the demo has no life cycle.
  async getCompanyStanding() {
    return demoStanding();
  }

  /** The Owner's billing: the switch first, then the Owner, as on the API (spec part 4, "GET /billing"). */
  async getCompanyBilling() {
    if (!featureOn("settings.billing")) throw new DemoRuleError("This feature is switched off.");
    const db = this.open();
    if (!(await this.granter(db)).access.isOwner) throw new DemoRuleError(BILLING_OWNER_ONLY_MESSAGE);
    const company = await this.platformCompany(db.companyId);
    if (!company) throw new DemoRuleError("That company does not exist.");
    return demoBilling(company, this.todayIso);
  }

  /** The open company's support requests for its Owner (spec part 4, "GET /support-grants"). */
  async listSupportGrants() {
    const db = await this.supportOwner();
    return demoOwnerGrantViews(this.storedList(PLATFORM_SUPPORT_KEY), db.companyId, new Date());
  }

  async approveSupportGrant(grantId: string) {
    await this.decideSupportGrant(grantId, "approve");
  }

  async revokeSupportGrant(grantId: string) {
    await this.decideSupportGrant(grantId, "revoke");
  }

  /** The open company, once its viewer is checked to be its Owner, as the support routes check. */
  private async supportOwner(): Promise<CompanyDb> {
    const db = this.open();
    if (!(await this.granter(db)).access.isOwner) throw new DemoRuleError(SUPPORT_OWNER_ONLY_MESSAGE);
    return db;
  }

  /**
   * The Owner approves or revokes a support request (spec part 4, "Demo mode"): the shared decision
   * rule and closed-grant messages, then the API's two log rows, the company's security entry and the
   * console's `support.approved` or `support.revoked` row. The step-up dialog still asks for six
   * digits, which the demo doesn't check, like the console's save.
   */
  private async decideSupportGrant(grantId: string, step: SupportGrantStep) {
    const db = await this.supportOwner();
    const decision = demoGrantDecision(this.storedList(PLATFORM_SUPPORT_KEY), db.companyId, grantId, step, new Date());
    if ("refusal" in decision) throw new DemoRuleError(SUPPORT_CLOSED_MESSAGES[step]);
    writeStored(PLATFORM_SUPPORT_KEY, decision.grants);
    this.appendAudit(db, {
      category: "security",
      action: step === "approve" ? "Approved support access" : "Revoked support access",
      target: "Support access",
      before: null,
      after: null,
    });
    this.appendPlatformAudit({
      tenantId: db.companyId,
      companyName: decision.grant.companyName,
      action: step === "approve" ? "support.approved" : "support.revoked",
      targetType: "support_access_grant",
      targetId: decision.grant.id,
      before: null,
      after: null,
    });
    this.emit();
  }

  // Platform admin part 2 (docs/specs/platform-admin.md, part 2, "Demo mode"): the same shared rules
  // and messages as the API, in its refusal order; no step-up, like every demo console write. A
  // refusal the API answers with 409 or 422 is a `DemoRefusal` with the API's code.
  async listPlatformPlans() {
    this.assertBillingOn();
    return this.demoPlanList();
  }

  /** A new plan: the field rules (400), then a key no demo plan holds (409), as `POST /platform/plans`. */
  async createPlatformPlan(input: PlatformPlanInput) {
    this.assertBillingOn();
    const problem = planProblem(input);
    if (problem) throw new DemoRuleError(problem.message);
    if ((await this.demoPlanList()).some((plan) => plan.key === input.key)) {
      throw new DemoRefusal(PLAN_MESSAGES.keyTaken, "conflict");
    }
    const values = newPlanValues(input);
    const now = new Date().toISOString();
    const plan: PlatformPlan = {
      id: values.key,
      ...values,
      active: true,
      companies: 0,
      createdAt: now,
      updatedAt: now,
    };
    const store = this.planStore();
    writeStored(DEMO_PLANS_KEY, { ...store, created: [...store.created, plan] });
    this.appendPlanAudit(
      "plan.created",
      plan.id,
      planAuditBody({ action: "plan.created", plan: values, reason: input.reason }),
    );
    this.emit();
    return plan;
  }

  /**
   * A plan change (spec "PATCH /platform/plans/:id"): 404, the field rules (400), then a plan in use
   * keeps its modules and limits (422). A save that changes nothing writes nothing, not even a row.
   */
  async updatePlatformPlan(planId: string, patch: PlatformPlanPatch) {
    this.assertBillingOn();
    const plan = await this.demoPlan(planId);
    const problem = planPatchProblem(plan, patch, plan.companies > 0);
    if (problem?.status === 422) throw new DemoRefusal(problem.message, "rule_broken");
    if (problem) throw new DemoRuleError(problem.message);
    const changes = planChanges(plan, patch);
    if (!changes) return plan;
    const edit: DemoPlanEdit = { ...changes.after, updatedAt: new Date().toISOString() };
    this.editPlan(plan.id, edit);
    this.appendPlanAudit(
      "plan.changed",
      plan.id,
      planAuditBody({ action: "plan.changed", changes, reason: patch.reason }),
    );
    this.emit();
    return { ...plan, ...edit };
  }

  async retirePlatformPlan(planId: string, reason: string) {
    return this.setPlanActive(planId, reason, false);
  }

  async restorePlatformPlan(planId: string, reason: string) {
    return this.setPlanActive(planId, reason, true);
  }

  /** The status preview at this moment, or null for an unknown company (spec "GET /platform/companies/:id/status"). */
  async getPlatformCompanyStatus(companyId: string) {
    this.assertBillingOn();
    const company = await this.platformCompany(companyId);
    if (!company) return null;
    const facts = demoStatusFacts(company, this.statusStore(), this.todayIso);
    return companyStatusView(company.id, facts.status, {
      statusChangedAt: facts.statusChangedAt,
      subscriptions: facts.subscriptions,
      now: new Date(),
    });
  }

  /**
   * Suspend, reinstate or cancel in the demo console (spec part 2, "Refusal order"): the body (400),
   * the company (404), the typed name for cancel (400), the status the admin saw (409), then
   * `statusAfter` (409 or 422). Only the console's status changes, with one audit row in the API's
   * shape: the demo company's own side has no life cycle.
   */
  async changePlatformCompanyStatus(companyId: string, input: CompanyStatusInput) {
    this.assertBillingOn();
    if (!COMPANY_STATUS_ACTIONS.includes(input.action)) throw new DemoRuleError("That action does not exist.");
    const bodyProblem = statusActionBodyProblem(input.action, input);
    if (bodyProblem) throw new DemoRuleError(bodyProblem);
    const company = await this.platformCompany(companyId);
    if (!company) throw new DemoRuleError("That company does not exist.");
    const nameProblem = input.action === "cancel" ? confirmNameProblem(input, company.name) : null;
    if (nameProblem) throw new DemoRuleError(nameProblem);
    const stored = this.statusStore();
    const facts = demoStatusFacts(company, stored, this.todayIso);
    const now = new Date();
    const stale = staleStatusRefusal(input.expectedStatus, facts.status, facts.statusChangedAt, now);
    if (stale) throw new DemoRefusal(stale.message, stale.code);
    const result = statusAfter(input.action, facts.status, { ...facts, now });
    if (!result.ok) throw new DemoRefusal(result.refusal.message, result.refusal.code);
    writeStored(DEMO_STATUS_KEY, {
      ...stored,
      [company.id]: { status: result.status, statusChangedAt: now.toISOString() },
    });
    const body = companyStatusAuditBody(facts, { status: result.status, statusChangedAt: now }, input.reason);
    this.appendPlatformAudit({
      tenantId: company.id,
      companyName: company.name,
      action: COMPANY_STATUS_AUDIT_ACTIONS[input.action],
      targetType: "tenant",
      targetId: company.id,
      before: body.before,
      after: body.after,
    });
    this.emit();
    return this.consoleDetail(company);
  }

  /** Part 2 is behind `admin.billing`: switched off, every method refuses, as the API answers 404. */
  private assertBillingOn() {
    if (!featureOn("admin.billing")) throw new DemoRuleError("This feature is switched off.");
  }

  private planStore() {
    return demoPlanStore(readStored<unknown>(DEMO_PLANS_KEY));
  }

  private statusStore() {
    return demoStatusStore(readStored<unknown>(DEMO_STATUS_KEY));
  }

  /** Every demo plan: the fixture companies' plans as seeded, with what this browser created or changed. */
  private async demoPlanList(): Promise<PlatformPlan[]> {
    return demoPlans(this.planStore(), demoFixturePlans((await this.platformData()).companies));
  }

  private async demoPlan(planId: string): Promise<PlatformPlan> {
    const plan = (await this.demoPlanList()).find((p) => p.id === planId);
    if (!plan) throw new DemoRuleError(PLAN_MESSAGES.notFound);
    return plan;
  }

  private editPlan(planId: string, edit: DemoPlanEdit) {
    const store = this.planStore();
    writeStored(DEMO_PLANS_KEY, { ...store, edits: { ...store.edits, [planId]: { ...store.edits[planId], ...edit } } });
  }

  /** Retire or restore (spec "POST /platform/plans/:id/retire and /restore"): 404, the reason, then 409. */
  private async setPlanActive(planId: string, reason: string, active: boolean) {
    this.assertBillingOn();
    const plan = await this.demoPlan(planId);
    const reasonProblem = adminReasonProblem(reason);
    if (reasonProblem) throw new DemoRuleError(reasonProblem);
    if (plan.active === active) {
      throw new DemoRefusal(active ? PLAN_MESSAGES.notRetired : PLAN_MESSAGES.alreadyRetired, "conflict");
    }
    const edit: DemoPlanEdit = { active, updatedAt: new Date().toISOString() };
    this.editPlan(plan.id, edit);
    const action = active ? "plan.restored" : "plan.retired";
    this.appendPlanAudit(action, plan.id, planAuditBody({ action, reason }));
    this.emit();
    return { ...plan, ...edit };
  }

  /** A plan row of the platform audit log: it names no company (spec "Audit (part 2)"). */
  private appendPlanAudit(action: string, planId: string, body: PlanAuditBody) {
    this.appendPlatformAudit({
      tenantId: null,
      companyName: null,
      action,
      targetType: "plan",
      targetId: planId,
      before: body.before,
      after: body.after,
    });
  }

  /** Where a demo company stands in the console, with the status the console stored for it. */
  private consoleStanding(company: Company) {
    return demoConsoleStanding(company, this.statusStore(), this.todayIso, new Date());
  }

  /** A demo company in full for the console, with its console standing. */
  private async consoleDetail(company: Company) {
    return demoDetail(company, await this.consoleFacts(company.id), this.todayIso, this.consoleStanding(company));
  }

  async getPlatformDirectory(companyId: string) {
    const company = await this.platformCompany(companyId);
    if (!company) throw new DemoRuleError("That company does not exist.");
    return { ...(await this.listCompanyDirectory(company.id)), restricted: false as const };
  }

  async listCompanyDirectory(companyId: CompanyId) {
    const db = await this.db(companyId);
    return { roles: db.list("roles"), users: db.list("users"), branding: db.settings.branding };
  }

  closeCompany() {
    this.current = null;
    this.viewer = null;
  }

  async importOverview(companyId: CompanyId) {
    return importOverview(await this.importScope(companyId));
  }

  async previewImport(companyId: CompanyId, request: ImportRequest) {
    return previewImport(await this.importScope(companyId), request);
  }

  async runImport(companyId: CompanyId, request: ImportRequest) {
    const result = runImport(await this.importScope(companyId), request);
    this.emit();
    return result;
  }

  async undoImport(companyId: CompanyId, batchId: string) {
    const batch = undoImport(await this.importScope(companyId), batchId);
    this.emit();
    return batch;
  }

  async testDatabaseConnection(companyId: CompanyId, input: DatabaseTestInput) {
    await this.importScope(companyId);
    return sampleDatabase(input);
  }

  async saveImportMapping(companyId: CompanyId, kind: ImportKind, columns: ColumnMapping) {
    const mapping = saveImportMapping(await this.importScope(companyId), kind, columns);
    this.emit();
    return mapping;
  }

  async getCompany() {
    const db = this.open();
    return (await this.listCompanies()).find((c) => c.id === db.companyId)!;
  }

  /**
   * The shell's facts from exactly what the shell read before GET /company (ADR 0051, "GET /company"):
   * the company, every role (for View as) and the person's own access. View as is the shell's, so
   * it never changes this answer. The ceiling follows the API's rule (`seesCeiling`, D4).
   */
  async getWorkspace(): Promise<WorkspaceFacts> {
    const [company, roles, users] = await Promise.all([this.getCompany(), this.list("roles"), this.list("users")]);
    const user = users.find((candidate) => candidate.id === this.viewer!.userId);
    if (!user) throw new DemoRuleError("Your profile is not in this company.");
    const access = viewerAccess(company, roles, user, null);
    const { name, city, state, modules, ceiling, branches } = company;
    const shown = seesCeiling((key) => access.permissions.has(key)) ? ceiling : [];
    return { company: { name, city, state, modules, ceiling: shown, branches }, user, roles, access };
  }

  async getSettings() {
    return this.answered(this.open().settings);
  }

  /**
   * Settings as the API answers every read and write of them (ADR 0059, part 3a): the Sales tax tab
   * in force on today (`taxInForce`), as `GET /settings` answers it on the company's day. Rows that
   * ended before today or start later (saved demo data typed before part 3a) are neither shown nor
   * sent back, so the tab saves and they drop out of the stored copy on its next save (spec, known
   * limits). Pricing reads the stored copy, with every row, as before.
   */
  private answered(settings: CompanySettings): CompanySettings {
    const { localization } = settings;
    return { ...settings, localization: { ...localization, tax: taxInForce(localization.tax, this.todayIso) } };
  }

  /**
   * Replaces one settings section with the API's checks in the API's order (ADR 0059; spec rule 7):
   * module, keys, switch, scope (`assertSettingsSave`), then the shared content rules against the
   * stored section, then Payments' Owner-only loosening (`paymentControlsLoosened`). Screens save `localization` per tab through `updateLocalization`.
   */
  async updateSettings<K extends keyof CompanySettings>(section: K, value: CompanySettings[K]) {
    const db = this.open();
    const rule = SETTINGS_SECTIONS[section];
    const access = await this.assertSettingsSave(db, rule);
    const problem = settingsSectionProblem(section, value, db.settings[section]);
    if (problem) throw new DemoRuleError(problem);
    // Loosening a payment control is the Owner's alone (ADR 0059, "2026-11-20"), as on the API.
    const payments = { [section]: value } as Partial<CompanySettings>;
    if (payments.payments && !access.isOwner && paymentControlsLoosened(payments.payments, db.settings.payments)) {
      throw new DemoRuleError(PAYMENT_CONTROLS_OWNER_ONLY);
    }
    const before = db.settings[section];
    db.settings = { ...db.settings, [section]: value };
    const diff = diffSummary(before, value);
    this.appendAudit(db, {
      category: "settings",
      action: `Changed ${rule.label.toLowerCase()}`,
      target: rule.label,
      ...diff,
    });
    this.emit();
    return this.answered(db.settings);
  }

  /**
   * Replaces one tab of Localization and tax, or the Sales and documents page, with its own key
   * (ADR 0059, part 2a; `LOCALIZATION_TABS`), in the API's order, then the tab's shared rule against
   * the stored tab. Region refuses a zone, country or locale change and needs Sales tax's key for a
   * change of the states of operation (View as limits the keys, spec rule 22); Currency keeps its
   * base, lock and codes and dates a changed rate with today (ADR 0059, part 2b). The step-up is the
   * dialog alone, as everywhere in the demo. Only that tab changes, and the audit entry names it.
   */
  async updateLocalization<T extends keyof LocalizationSettings>(tab: T, value: LocalizationSettings[T]) {
    const db = this.open();
    const rule = LOCALIZATION_TABS[tab];
    const access = await this.assertSettingsSave(db, rule);
    const current = db.settings.localization[tab];
    const problem = localizationTabProblem(tab, value, current, (key) => access.permissions.has(key));
    if (problem) throw new DemoRuleError(problem);
    const stored = localizationTabStored(tab, value, current, this.todayIso);
    db.settings = { ...db.settings, localization: { ...db.settings.localization, [tab]: stored } };
    this.appendAudit(db, {
      category: "settings",
      action: `Changed ${SETTINGS_SECTIONS.localization.label.toLowerCase()}`,
      target: rule.label,
      ...diffSummary(current, stored),
    });
    this.emit();
    return this.answered(db.settings);
  }

  async getDefaultSettings() {
    return this.open().defaultSettings;
  }

  async resetSettings(section: keyof CompanySettings) {
    return this.updateSettings(section, this.open().defaultSettings[section]);
  }

  async list<K extends CollectionName>(collection: K) {
    const db = this.open();
    const can = this.actionContext(db).can;
    const needed = PRIVATE_COLLECTIONS[collection];
    if (needed && !(await can(needed))) return [] as unknown as Collections[K];
    // Meetings are read as GET /meetings reads them: seen and shaped for the reader (ADR 0051 "Part 3").
    if (collection === "meetings") {
      const meetings = featureOn("meetings.calendar") ? visibleMeetings(db, (await this.meetingScope(db)).sight) : [];
      return meetings as unknown as Collections[K];
    }
    const items = applyScope(db, collection, db.list(collection), this.subject(db));
    // Pay rate needs its own permission (CLAUDE.md rule 2), so the record never carries it without it.
    if (collection === "employees" && !(await can(SENSITIVE.payRate))) {
      return (items as Employee[]).map((e) => ({ ...e, payRate: "0.00" })) as unknown as Collections[K];
    }
    if (collection === "contractLines" && !(await can("contracts.contract.view_sensitive"))) {
      return (items as ContractLine[]).map((l) => ({ ...l, estimatedCost: "0.00" })) as unknown as Collections[K];
    }
    if (collection === "audit") return (await this.auditAsSeen(db, items as AuditEntry[])) as unknown as Collections[K];
    // Who has left is HR's business: disabled colleagues only for Settings → Users' readers, as
    // GET /company's directory (ADR 0051, "2026-11-20"). View as narrows it too.
    const { access } = await this.granter(db);
    if (collection === "users" && !seesDisabledPeople((key) => access.permissions.has(key))) {
      return (items as User[]).filter((u) => u.status !== "disabled") as unknown as Collections[K];
    }
    return items;
  }

  async get<K extends CollectionName>(collection: K, id: string) {
    const visible = (await this.list(collection)) as { id: string }[];
    return visible.find((item) => item.id === id) as ItemOf<K> | undefined;
  }

  async save<K extends CollectionName>(collection: K, item: ItemOf<K>, audit?: AuditInput) {
    const db = this.open();
    await this.assertCan(db, savePermissions(collection));
    if (collection === "rolls") assertRollEditOnly(db.get("rolls", item.id), item as ItemOf<"rolls">);
    db.put(collection, item);
    if (audit) this.appendAudit(db, audit);
    this.emit();
    return item;
  }

  async inviteUser(input: InviteUserInput) {
    const db = this.open();
    await this.assertCan(db, ["settings.users.manage"]);
    const company = await this.getCompany();
    await this.assertBranchInvite(db, input.branchId);
    assertSeatAvailable(db.list("users"), company.userLimit);
    const user: User = {
      id: newId(db.companyId, "usr"),
      companyId: db.companyId,
      ...input,
      status: "invited",
      mfaEnrolled: false,
      lastLoginAt: null,
      employeeId: null,
      defaultLocationId: null,
    };
    db.put("users", user);
    this.appendAudit(db, {
      category: "user",
      action: "Invited user",
      target: user.name,
      before: null,
      after: `${user.email}, ${this.roleNames(db, user.roleIds)}`,
    });
    this.emit();
    return user;
  }

  async updateUser(userId: string, patch: UserPatch) {
    const db = this.open();
    await this.assertCan(db, ["settings.users.manage"]);
    const before = db.get("users", userId)!;
    // The API's order: whom the admin may change, the roles, the last Owner, then the branch.
    await this.assertBranchManage(db, before);
    if (patch.roleIds)
      await this.assertCanAssign(
        db,
        patch.roleIds.filter((id) => !before.roleIds.includes(id)),
      );
    assertOwnerRemains(db.list("users"), db.list("roles"), userId, patch);
    if (patch.branchId !== undefined) await this.assertBranchMove(db, before, patch.branchId);
    const after = { ...before, ...patch };
    db.put("users", after);
    const describe = (u: User) => `${u.status}, ${this.roleNames(db, u.roleIds)}, MFA ${u.mfaEnrolled ? "on" : "off"}`;
    this.appendAudit(db, {
      category: patch.mfaEnrolled === false ? "security" : "user",
      action: "Changed user",
      target: before.name,
      before: describe(before),
      after: describe(after),
    });
    this.emit();
    return after;
  }

  async saveRole(role: Role) {
    const db = this.open();
    await this.assertCan(db, ["settings.roles.manage"]);
    const before = db.get("roles", role.id);
    if (before?.owner) throw new DemoRuleError("The Owner role is locked. It always holds everything in your plan.");
    await this.assertCanGrant(db, role.permissions, before?.permissions ?? []);
    db.put("roles", role);
    const diff = permissionDiff(before?.permissions ?? [], role.permissions);
    this.appendAudit(db, {
      category: "role",
      action: before ? "Changed role" : "Created role",
      target: `Role: ${role.name}`,
      ...diff,
    });
    this.emit();
    return role;
  }

  async resetRole(roleId: string) {
    const db = this.open();
    const role = db.get("roles", roleId);
    if (!role?.system || !isDefaultRoleKey(role.key)) throw new DemoRuleError("Only default roles can be reset.");
    const company = await this.getCompany();
    const offered = new Set(permissionsForModules(PRODUCT_MODULES[company.product]));
    const template = roleTemplate(role.key);
    return this.saveRole({
      ...role,
      name: template.name,
      description: template.description,
      dataScope: template.dataScope,
      permissions: template.permissions.filter((p) => offered.has(p)),
    });
  }

  async deleteRole(roleId: string) {
    const db = this.open();
    await this.assertCan(db, ["settings.roles.manage"]);
    const role = db.get("roles", roleId)!;
    if (role.system) throw new DemoRuleError("Default roles can be copied but not deleted.");
    if (db.list("users").some((u) => u.roleIds.includes(roleId))) {
      throw new DemoRuleError("Users still hold this role. Move them to another role first.");
    }
    db.remove("roles", roleId);
    this.appendAudit(db, {
      category: "role",
      action: "Deleted role",
      target: `Role: ${role.name}`,
      before: `${role.permissions.length} permissions`,
      after: null,
    });
    this.emit();
  }

  async createCustomer(input: NewCustomerInput) {
    const db = this.open();
    await this.assertCan(db, ["customers.customer.create"]);
    const name = input.name.trim();
    if (!name) throw new DemoRuleError("Enter the customer's name.");
    const customer: Customer = {
      id: newId(db.companyId, "cus"),
      type: input.type ?? "homeowner",
      name,
      contactName: name,
      email: input.email?.trim() ?? "",
      phone: input.phone?.trim() ?? "",
      addresses: [],
      defaultBillingId: null,
      defaultJobSiteId: null,
      terms: db.settings.localization.documents.defaultTerms,
      creditLimit: "0.00",
      taxExempt: false,
      certificate: null,
      salesRepId: this.subject(db).user.id,
      createdAt: this.todayIso,
    };
    db.put("customers", customer);
    this.appendAudit(db, {
      category: "data",
      action: "Added customer",
      target: customer.name,
      before: null,
      after: `${customer.type}, profile incomplete`,
    });
    this.emit();
    return customer;
  }

  async saveCustomer(customer: Customer) {
    const db = this.open();
    await this.assertCan(db, ["customers.customer.edit"]);
    const before = db.get("customers", customer.id);
    if (!before) throw new DemoRuleError("This customer no longer exists.");
    if (!customer.name.trim()) throw new DemoRuleError("Enter the customer's name.");
    const ids = new Set(customer.addresses.map((a) => a.id));
    const saved: Customer = {
      ...customer,
      name: customer.name.trim(),
      defaultBillingId:
        customer.defaultBillingId && ids.has(customer.defaultBillingId)
          ? customer.defaultBillingId
          : (customer.addresses[0]?.id ?? null),
      defaultJobSiteId:
        customer.defaultJobSiteId && ids.has(customer.defaultJobSiteId)
          ? customer.defaultJobSiteId
          : (customer.addresses[0]?.id ?? null),
    };
    db.put("customers", saved);
    this.appendAudit(db, {
      category: "data",
      action: "Changed customer",
      target: saved.name,
      before: `${before.addresses.length} addresses, ${before.email || "no email"}`,
      after: `${saved.addresses.length} addresses, ${saved.email || "no email"}`,
    });
    this.emit();
    return saved;
  }

  async saveQuote(input: Quote) {
    const db = this.open();
    const isNew = !input.number;
    await this.assertCan(db, [isNew ? "sales.quote.create" : "sales.quote.edit"]);
    const before = input.id ? db.get("quotes", input.id) : undefined;
    if (before && !quoteIsOpen(before))
      throw new DemoRuleError(`Quote ${before.number} is closed and can't be changed.`);
    const draftProblem = quoteDraftProblem(input);
    if (draftProblem) throw new DemoRuleError(draftProblem);
    // Status, sending and conversion change only through their own calls (spec B1).
    const quote: Quote = {
      ...input,
      status: before?.status ?? "draft",
      sentAt: before?.sentAt ?? null,
      expiresAt: before?.expiresAt ?? null,
      invoiceId: before?.invoiceId ?? null,
    };
    const taxChanged = JSON.stringify(before?.taxOverride ?? null) !== JSON.stringify(quote.taxOverride ?? null);
    if (wasteChanged(quote, before, db.list("products"), db.settings.localization.documents.defaultWastePct)) {
      await this.assertCan(db, ["sales.waste.view"]);
    }
    if (taxChanged) await this.assertCan(db, ["sales.tax.override"]);
    const prefix = db.settings.localization.documents.quotePrefix;
    const saved = isNew
      ? {
          ...quote,
          id: quote.id || newId(db.companyId, "quo"),
          number: nextNumber(
            prefix,
            db.list("quotes").map((q) => q.number),
            2001,
          ),
        }
      : quote;
    db.put("quotes", saved);
    this.appendAudit(db, {
      category: "data",
      action: isNew ? "Created quote" : "Saved quote",
      target: saved.number,
      before: null,
      after: `total ${saved.total}`,
    });
    if (taxChanged) {
      this.appendAudit(db, {
        category: "data",
        action: "Changed tax on a document",
        target: saved.number,
        before: before?.taxOverride ? `${before.taxOverride.ratePct}%` : "default rate",
        after: saved.taxOverride ? `${saved.taxOverride.ratePct}%: ${saved.taxOverride.reason}` : "default rate",
      });
    }
    this.emit();
    return saved;
  }

  async updateQuoteStatus(quoteId: string, change: QuoteStatusChange) {
    const db = this.open();
    await this.assertCan(db, ["sales.quote.edit"]);
    const quote = db.get("quotes", quoteId);
    if (!quote) throw new DemoRuleError("This quote no longer exists.");
    if (!quoteActions(quote, this.todayIso).includes(change.action)) {
      throw new DemoRuleError(`Quote ${quote.number} can't be changed that way in its current state.`);
    }
    const expiresAt = change.action === "send" ? (change.expiresAt ?? null) : quote.expiresAt;
    if (change.action === "send") {
      const problem = Object.values(quoteSendProblems(quote, expiresAt, this.todayIso))[0];
      if (problem) throw new DemoRuleError(problem);
    }
    const saved: Quote = {
      ...quote,
      status: QUOTE_ACTION_STATUS[change.action],
      sentAt: quote.sentAt ?? (change.action === "send" ? this.todayIso : null),
      expiresAt,
    };
    db.put("quotes", saved);
    this.appendAudit(db, {
      category: "data",
      action: `Marked quote ${quoteStateLabel(quoteState(saved, this.todayIso)).toLowerCase()}`,
      target: quote.number,
      before: quoteStateLabel(quoteState(quote, this.todayIso)),
      after: expiresAt && change.action === "send" ? `expires ${expiresAt}` : quoteStateLabel(saved.status),
    });
    if (change.action === "send") notifyQuoteSent(this.actionContext(db), saved);
    this.emit();
    return saved;
  }

  async convertQuoteToInvoice(quoteId: string) {
    const db = this.open();
    if (db.get("quotes", quoteId)?.status !== "accepted") {
      throw new DemoRuleError("Mark the quote accepted before converting it to an invoice.");
    }
    await this.assertCan(db, ["sales.invoice.create"]);
    const quote = db.get("quotes", quoteId);
    if (!quote) throw new DemoRuleError("This quote no longer exists.");
    if (quote.invoiceId) throw new DemoRuleError(`This quote is already invoiced.`);
    if (!quoteIsOpen(quote)) throw new DemoRuleError(`Quote ${quote.number} was declined; it can't be invoiced.`);
    const problem = Object.values(quoteSendProblems(quote, null, this.todayIso))[0];
    if (problem) throw new DemoRuleError(problem);
    const customer = db.get("customers", quote.customerId)!;
    const prefix = db.settings.localization.documents.invoicePrefix;
    const invoice = invoiceFromQuote(quote, customer, db.settings.localization, {
      id: newId(db.companyId, "inv"),
      number: nextNumber(
        prefix,
        db.list("invoices").map((i) => i.number),
        1001,
      ),
      issuedAt: this.todayIso,
      createdBy: this.viewer!.userId,
      holdUntilInstalled:
        featureOn("installation.calendar") && (await this.granter(db)).company.modules.includes("installation"),
      balanceDueDays: db.settings.localization.documents.balanceDueDays,
    });
    db.put("invoices", invoice);
    const held = reserveFor(this.actionContext(db), invoice);
    db.put("quotes", {
      ...quote,
      status: "converted",
      sentAt: quote.sentAt ?? this.todayIso,
      invoiceId: invoice.id,
    });
    this.appendAudit(db, {
      category: "data",
      action: "Converted quote to invoice",
      target: quote.number,
      before: quoteStateLabel(quoteState(quote, this.todayIso)),
      after: `${invoice.number}; ${reservationSummary(held)}`,
    });
    this.emit();
    return invoice;
  }

  async recordPayment(input: RecordPaymentInput, files: File[]) {
    return this.act((ctx) => recordPayment(ctx, input, files));
  }

  async reviewPayment(paymentId: string, decision: PaymentDecision) {
    return this.act((ctx) => reviewPayment(ctx, paymentId, decision));
  }

  async attachPaymentFiles(paymentId: string, files: File[]) {
    return this.act((ctx) => attachPaymentFiles(ctx, paymentId, files));
  }

  async voidPayment(paymentId: string, reason: string) {
    return this.act((ctx) => voidPayment(ctx, paymentId, reason));
  }

  async markInvoiceSent(invoiceId: string) {
    return this.act((ctx) => markInvoiceSent(ctx, invoiceId));
  }

  async voidInvoice(invoiceId: string, reason: string) {
    return this.act((ctx) => voidInvoice(ctx, invoiceId, reason));
  }

  async writeOffBalance(invoiceId: string, reason: string) {
    return this.act((ctx) => writeOffBalance(ctx, invoiceId, reason));
  }

  async applyCredit(invoiceId: string) {
    return this.act((ctx) => applyCredit(ctx, invoiceId));
  }

  async refundCredit(input: RefundInput, files: File[]) {
    return this.act((ctx) => refundCredit(ctx, input, files));
  }

  async saveNotificationRule(rule: Omit<NotificationRule, "updatedAt" | "updatedBy">) {
    return this.act((ctx) => saveNotificationRule(ctx, rule));
  }

  async resetNotificationRule(key: NotificationEventKey) {
    return this.act((ctx) => resetNotificationRule(ctx, key));
  }

  async listOutbox(all: boolean) {
    return listOutbox(this.actionContext(this.open()), all);
  }

  async retryOutbox(id: string) {
    return this.act((ctx) => retryOutbox(ctx, id));
  }

  async cancelOutbox(id: string) {
    return this.act((ctx) => cancelOutbox(ctx, id));
  }

  async simulateBounce(id: string) {
    return this.act((ctx) => simulateBounce(ctx, id));
  }

  async listMyNotifications() {
    return myNotifications(this.actionContext(this.open()));
  }

  async markNotificationsRead(ids: readonly string[]) {
    return this.act(async (ctx) => markNotificationsRead(ctx, ids));
  }

  async saveSupplier(input: SupplierInput) {
    return this.act((ctx) => saveSupplier(ctx, input));
  }

  async setSupplierStatus(id: string, status: Supplier["status"]) {
    return this.act((ctx) => setSupplierStatus(ctx, id, status));
  }

  async saveSupplierContact(input: SupplierContactInput) {
    return this.act((ctx) => saveSupplierContact(ctx, input));
  }

  async setContactStatus(id: string, status: SupplierContact["status"]) {
    return this.act((ctx) => setContactStatus(ctx, id, status));
  }

  async whoAmI() {
    return this.viewer!.userId;
  }

  async inventoryData() {
    const [products, rolls, stockMovements, locations, transfers, reservations, stockAdjustments] = await Promise.all([
      this.list("products"),
      this.list("rolls"),
      this.list("stockMovements"),
      this.list("locations"),
      this.list("transfers"),
      this.list("reservations"),
      this.list("stockAdjustments"),
    ]);
    return { products, rolls, stockMovements, locations, transfers, reservations, stockAdjustments };
  }

  async salesData() {
    const [quotes, customers, locations] = await Promise.all([
      this.list("quotes"),
      this.list("customers"),
      this.list("locations"),
    ]);
    return { quotes, customers, locations };
  }

  async expensesData() {
    const [expenses, recurring, suppliers, locations] = await Promise.all([
      this.list("expenses"),
      this.list("recurringExpenses"),
      this.list("suppliers"),
      this.list("locations"),
    ]);
    return { expenses, recurring, suppliers, locations };
  }

  async contractsData() {
    const [
      contracts,
      lines,
      changeOrders,
      billings,
      waivers,
      certificates,
      customers,
      suppliers,
      locations,
      bills,
      supplierPayments,
    ] = await Promise.all([
      this.list("contracts"),
      this.list("contractLines"),
      this.list("changeOrders"),
      this.list("contractBillings"),
      this.list("lienWaivers"),
      this.list("insuranceCertificates"),
      this.list("customers"),
      this.list("suppliers"),
      this.list("locations"),
      this.list("bills"),
      this.list("supplierPayments"),
    ]);
    return {
      contracts,
      lines,
      changeOrders,
      billings,
      waivers,
      certificates,
      customers,
      suppliers,
      locations,
      bills,
      supplierPayments,
    };
  }

  async hrData() {
    const [employees, timesheets, ptoRequests, timeOffPolicies, timeOffEntries, locations] = await Promise.all([
      this.list("employees"),
      this.list("timesheets"),
      this.list("ptoRequests"),
      this.list("timeOffPolicies"),
      this.list("timeOffEntries"),
      this.list("locations"),
    ]);
    return { employees, timesheets, ptoRequests, timeOffPolicies, timeOffEntries, locations };
  }

  async purchasingData() {
    const [suppliers, contacts, purchaseOrders, receipts, products, locations, bills, supplierPayments] =
      await Promise.all([
        this.list("suppliers"),
        this.list("supplierContacts"),
        this.list("purchaseOrders"),
        this.list("receipts"),
        this.list("products"),
        this.list("locations"),
        this.list("bills"),
        this.list("supplierPayments"),
      ]);
    return { suppliers, contacts, purchaseOrders, receipts, products, locations, bills, supplierPayments };
  }

  async moveRoll(rollId: string, bin: string) {
    const roll = await this.get("rolls", rollId);
    if (!roll) throw new DemoRuleError("This roll no longer exists.");
    const location = (await this.get("locations", roll.locationId))?.name ?? "";
    return this.save(
      "rolls",
      { ...roll, bin: bin.trim() },
      {
        category: "data",
        action: "Moved roll",
        target: `Roll ${roll.rollNumber}`,
        before: `${location}, bin ${roll.bin}`,
        after: `${location}, bin ${bin.trim()}`,
      },
    );
  }

  async listSettingsUsers() {
    return this.list("users");
  }

  async listSettingsRoles() {
    return this.list("roles");
  }

  async verifyStepUp(code: string) {
    if (!/^\d{6}$/.test(code)) throw new DemoRuleError("Enter the 6-digit code from your authenticator app.");
  }

  async saveExpense(input: ExpenseInput, files: File[]) {
    return this.act((ctx) => saveExpense(ctx, input, files));
  }

  async reviewExpense(id: string, decision: ExpenseDecision) {
    return this.act((ctx) => reviewExpense(ctx, id, decision));
  }

  async voidExpense(id: string, reason: string) {
    return this.act((ctx) => voidExpense(ctx, id, reason));
  }

  async saveRecurringExpense(input: RecurringExpenseInput) {
    return this.act((ctx) => saveRecurringExpense(ctx, input));
  }

  // Reports (ADR 0055): the same shared rules and refusals as the API.
  async businessReport(filters: BusinessFilters) {
    const db = this.open();
    await this.assertCan(db, ["reports.financial.view"]);
    return demoBusinessReport(db, await this.reportViewer(db), filters);
  }

  async reportOptions() {
    const db = this.open();
    return demoReportOptions(db, await this.reportViewer(db));
  }

  async pnlReport(query: PnlQuery) {
    const db = this.open();
    await this.assertCan(db, ["reports.financial.view"]);
    return demoPnlReport(db, await this.reportViewer(db), query);
  }

  async salesByCategoryReport(query: SalesByCategoryQuery) {
    const db = this.open();
    await this.assertCan(db, ["reports.sales.view"]);
    return demoSalesByCategoryReport(db, await this.reportViewer(db), query);
  }

  async paymentsReport(query: PaymentsReportQuery) {
    const db = this.open();
    await this.assertCan(db, ["reports.financial.view"]);
    return demoPaymentsReport(db, await this.reportViewer(db), query);
  }

  // Meetings follow the shared rules the API uses (ADR 0051 "Part 3"); what stays demo-only is in
  // meeting-actions.ts (Simulate reply, new-guest saving) and meeting-moves.ts (Undo's memory).
  async meetingsData(): Promise<MeetingsData> {
    const db = this.open();
    return meetingsData(this.actionContext(db), await this.meetingScope(db));
  }

  async myMeetings(): Promise<MyMeetings> {
    const db = this.open();
    return myMeetings(this.actionContext(db), await this.meetingScope(db));
  }

  async createMeeting(input: MeetingInput) {
    return this.actOnMeetings((ctx, scope) => createMeeting(ctx, scope, input));
  }

  async updateMeeting(
    id: string,
    patch: Partial<Pick<Meeting, "title" | "notes" | "location" | "start" | "durationMin" | "reminderMin">>,
  ) {
    return this.actOnMeetings((ctx, scope) => updateMeeting(ctx, scope, id, patch));
  }

  async cancelMeeting(id: string) {
    return this.actOnMeetings((ctx, scope) => cancelMeeting(ctx, scope, id));
  }

  async removeGuest(meetingId: string, attendeeId: string) {
    return this.actOnMeetings((ctx, scope) => removeGuest(ctx, scope, meetingId, attendeeId));
  }

  async respondToMeeting(meetingId: string, reply: ReplyInput) {
    return this.actOnMeetings((ctx, scope) => respondToMeeting(ctx, scope, meetingId, reply));
  }

  async simulateReply(outboxId: string, reply: ReplyInput) {
    return this.actOnMeetings((ctx, scope) => simulateReply(ctx, scope, outboxId, reply));
  }

  async decideProposal(meetingId: string, attendeeId: string, accept: boolean) {
    return this.actOnMeetings((ctx, scope) => decideProposal(ctx, scope, meetingId, attendeeId, accept));
  }

  async requestMeeting(input: MeetingRequestInput) {
    return this.actOnMeetings((ctx, scope) => requestMeeting(ctx, scope, input));
  }

  async meetingCalendarFile(meetingId: string) {
    const db = this.open();
    return meetingCalendarFile(this.actionContext(db), await this.meetingScope(db), meetingId);
  }

  async saveContract(input: ContractInput) {
    return this.act((ctx) => saveContract(ctx, input));
  }

  async sendContract(id: string) {
    return this.act((ctx) => sendContract(ctx, id));
  }

  async recallContract(id: string) {
    return this.act((ctx) => recallContract(ctx, id));
  }

  async signContract(id: string, input: SignatureInput) {
    return this.act((ctx) => signContract(ctx, id, input));
  }

  async completeContract(id: string) {
    return this.act((ctx) => completeContract(ctx, id));
  }

  async closeContract(id: string, overrideReason: string | null) {
    return this.act((ctx) => closeContract(ctx, id, overrideReason));
  }

  async terminateContract(id: string, reason: string) {
    return this.act((ctx) => terminateContract(ctx, id, reason));
  }

  async renewContract(id: string) {
    return this.act((ctx) => renewContract(ctx, id));
  }

  async postBilling(contractId: string, input: BillingInput) {
    return this.act((ctx) => postBilling(ctx, contractId, input));
  }

  async releaseRetainage(contractId: string, input: ReleaseInput) {
    return this.act((ctx) => releaseRetainage(ctx, contractId, input));
  }

  async voidBilling(billingId: string, reason: string) {
    return this.act((ctx) => voidBilling(ctx, billingId, reason));
  }

  async saveChangeOrder(contractId: string, input: ChangeOrderInput) {
    return this.act((ctx) => saveChangeOrder(ctx, contractId, input));
  }

  async decideChangeOrder(id: string, decision: { approve: boolean; reason: string }) {
    return this.act((ctx) => decideChangeOrder(ctx, id, decision));
  }

  async recordWaiver(contractId: string, input: WaiverInput) {
    return this.act((ctx) => recordWaiver(ctx, contractId, input));
  }

  async saveCertificate(contractId: string, input: CertificateInput) {
    return this.act((ctx) => saveCertificate(ctx, contractId, input));
  }

  async addContractFiles(contractId: string, files: File[]) {
    return this.act((ctx) => addContractFiles(ctx, contractId, files));
  }

  async saveEmployee(input: EmployeeInput) {
    return this.act((ctx) => saveEmployee(ctx, input));
  }

  async setChecklistItem(employeeId: string, list: "onboarding" | "offboarding", itemId: string, done: boolean) {
    return this.act((ctx) => setChecklistItem(ctx, employeeId, list, itemId, done));
  }

  async startOffboarding(employeeId: string) {
    return this.act((ctx) => startOffboarding(ctx, employeeId));
  }

  async addEmployeeDocuments(employeeId: string, files: File[]) {
    return this.act((ctx) => addEmployeeDocuments(ctx, employeeId, files));
  }

  async updateMyEmployeeProfile(patch: MyProfilePatch) {
    return this.act((ctx) => updateMyEmployeeProfile(ctx, patch));
  }

  async saveTimesheet(input: TimesheetInput) {
    return this.act((ctx) => saveTimesheet(ctx, input));
  }

  async submitTimesheet(id: string) {
    return this.act((ctx) => submitTimesheet(ctx, id));
  }

  async decideTimesheets(ids: readonly string[], decision: TimesheetDecision) {
    return this.act((ctx) => decideTimesheets(ctx, ids, decision));
  }

  async reopenTimesheet(id: string, reason: string) {
    return this.act((ctx) => reopenTimesheet(ctx, id, reason));
  }

  async uploadTimesheets(input: { table: ImportTable; fileName: string; apply: boolean; own: boolean }) {
    return this.act((ctx) => uploadTimesheets(ctx, input));
  }

  async clockIn() {
    return this.act((ctx) => clockIn(ctx));
  }

  async clockOut() {
    return this.act((ctx) => clockOut(ctx));
  }

  async requestTimeOff(input: TimeOffInput) {
    return this.act((ctx) => requestTimeOff(ctx, input));
  }

  async decideTimeOff(id: string, decision: TimeOffDecision) {
    return this.act((ctx) => decideTimeOff(ctx, id, decision));
  }

  async cancelTimeOff(id: string) {
    return this.act((ctx) => cancelTimeOff(ctx, id));
  }

  async adjustTimeOff(input: TimeOffAdjustment) {
    return this.act((ctx) => adjustTimeOff(ctx, input));
  }

  async saveTimeOffPolicy(policy: TimeOffPolicy) {
    return this.act((ctx) => saveTimeOffPolicy(ctx, policy));
  }

  async listCommissionStatements() {
    const db = this.open();
    await this.assertCan(db, ["hr.commission.view"]);
    return statementRows(this.actionContext(db));
  }

  async commissionData() {
    const db = this.open();
    await this.assertCan(db, ["hr.commission.view"]);
    return {
      statements: statementRows(this.actionContext(db)),
      plans: db.list("commissionPlans"),
      assignments: db.list("commissionAssignments"),
      people: db.list("users").map((u) => ({ id: u.id, name: u.name, active: u.status !== "disabled" })),
      invoices: db.list("invoices").map(({ id, number, salesRepId, isReturn, voidedAt }) => ({
        id,
        number,
        salesRepId,
        isReturn,
        voidedAt,
      })),
    };
  }

  async teamCommission(range: { from: string; to: string }) {
    const db = this.open();
    return teamCommission(this.actionContext(db), this.subject(db), range);
  }

  async approveStatement(userId: string, month: string) {
    return this.act((ctx) => approveStatement(ctx, userId, month));
  }

  async addCommissionAdjustment(input: CommissionAdjustmentInput) {
    return this.act((ctx) => addCommissionAdjustment(ctx, input));
  }

  async decideReversal(input: {
    userId: string;
    month: string;
    lineId: string;
    outcome: "applied" | "waived";
    reason: string;
  }) {
    return this.act((ctx) => decideReversal(ctx, input));
  }

  async saveCommissionPlan(plan: CommissionPlan) {
    return this.act((ctx) => saveCommissionPlan(ctx, plan));
  }

  async assignPlan(input: PlanAssignmentInput) {
    return this.act((ctx) => assignPlan(ctx, input));
  }

  async acknowledgePlan(assignmentId: string, signedName: string, plan: CommissionPlan) {
    return this.act((ctx) => acknowledgePlan(ctx, assignmentId, signedName, plan));
  }

  async setCommissionSplit(invoiceId: string, split: { userId: string; pct: string }[]) {
    return this.act((ctx) => setCommissionSplit(ctx, invoiceId, split));
  }

  async issueCreditNote(invoiceId: string, input: CreditNoteInput) {
    return this.act((ctx) => issueCreditNote(ctx, invoiceId, input));
  }

  async listPayPeriods() {
    const db = this.open();
    await this.assertCan(db, ["hr.payroll.view"]);
    return [...ensureCurrentPeriod(this.actionContext(db))].sort((a, b) => b.start.localeCompare(a.start));
  }

  async reviewPayPeriod(id: string) {
    return reviewPayPeriod(this.actionContext(this.open()), id);
  }

  async setPayExclusion(id: string, employeeId: string, reason: string | null) {
    return this.act((ctx) => setPayExclusion(ctx, id, employeeId, reason));
  }

  async approvePayPeriod(id: string) {
    return this.act((ctx) => approvePayPeriod(ctx, id));
  }

  async reopenPayPeriod(id: string) {
    return this.act((ctx) => reopenPayPeriod(ctx, id));
  }

  async exportPayPeriod(id: string) {
    return this.act((ctx) => exportPayPeriod(ctx, id));
  }

  async myPortal() {
    return myPortal(this.actionContext(this.open()));
  }

  async listStockHolds() {
    return listStockHolds(this.actionContext(this.open()));
  }

  async issueReservation(reservationId: string, overrideReason?: string) {
    return this.act((ctx) => issueReservation(ctx, reservationId, overrideReason));
  }

  async correctStockCount(input: StockCorrectionInput) {
    return this.act((ctx) => correctStockCount(ctx, input));
  }

  async recordAdjustment(input: AdjustmentInput) {
    return this.act((ctx) => recordAdjustment(ctx, input));
  }

  async reviewAdjustment(adjustmentId: string, decision: AdjustmentDecision) {
    return this.act((ctx) => reviewAdjustment(ctx, adjustmentId, decision));
  }

  async createRollInvoice(input: RollInvoiceInput) {
    return this.act((ctx) => createRollInvoice(ctx, input));
  }

  async rescheduleMeeting(move: MeetingMove) {
    return this.actOnMeetings((ctx, scope) => rescheduleMeeting(ctx, scope, move));
  }

  async undoReschedule(undo: MeetingUndo) {
    return this.actOnMeetings((ctx, scope) => undoReschedule(ctx, scope, undo));
  }

  async signOffJob(jobId: string, signer: string) {
    return this.act((ctx) => signOffJob(ctx, jobId, signer));
  }

  async createInvoiceFromJob(jobId: string) {
    return this.act((ctx) => createInvoiceFromJob(ctx, jobId));
  }

  async scheduleJob(input: ScheduleJobInput) {
    return this.act((ctx) => scheduleJob(ctx, input));
  }

  async startJob(jobId: string) {
    return this.act((ctx) => startJob(ctx, jobId));
  }

  async getFile(fileId: string) {
    const db = this.open();
    await this.assertCan(db, [
      "sales.payment.view",
      "hr.employee.view",
      "hr.portal.view",
      "contracts.contract.view",
      "finance.expense.view",
    ]);
    return readFile(this.actionContext(db), fileId);
  }

  async createPurchaseOrder(input: NewPurchaseOrderInput) {
    return this.act((ctx) => createPurchaseOrder(ctx, input));
  }

  async markOrdered(poId: string, via: "email" | "phone" = "email") {
    return this.act((ctx) => markOrdered(ctx, poId, via));
  }

  async cancelOrder(poId: string, reason: string) {
    return this.act((ctx) => cancelOrder(ctx, poId, reason));
  }

  async recordReceipt(poId: string, input: ReceiptInput) {
    return this.act((ctx) => recordReceipt(ctx, poId, input));
  }

  async enterBill(poId: string, input: BillInput, files: File[]) {
    return this.act((ctx) => enterBill(ctx, poId, input, files));
  }

  async recordSupplierPayment(input: SupplierPaymentInput, files: File[]) {
    return this.act((ctx) => recordSupplierPayment(ctx, input, files));
  }

  async reviewSupplierPayment(paymentId: string, decision: PaymentDecision) {
    return this.act((ctx) => reviewSupplierPayment(ctx, paymentId, decision));
  }

  async voidSupplierPayment(paymentId: string, reason: string) {
    return this.act((ctx) => voidSupplierPayment(ctx, paymentId, reason));
  }

  async createTransfer(input: TransferInput) {
    const db = this.open();
    await this.assertCan(db, ["inventory.transfer.create"]);
    const locations = db.list("locations");
    const problem = validateTransfer(
      input,
      locations,
      db.list("rolls"),
      db.list("stockMovements"),
      db.list("products"),
    );
    if (problem) throw new DemoRuleError(problem);
    const transfer: Transfer = {
      id: newId(db.companyId, "trf"),
      number: nextNumber(
        "TR-",
        db.list("transfers").map((t) => t.number),
        1001,
      ),
      fromId: input.fromId,
      toId: input.toId,
      status: "in_transit",
      lines: input.lines.map((l) => ({ ...l, id: newId(db.companyId, "trl") })),
      createdAt: nowStamp(),
      createdBy: this.viewer!.userId,
      receivedAt: null,
      receivedBy: null,
      note: input.note.trim(),
    };
    const ids = { movementId: () => newId(db.companyId, "mov"), at: transfer.createdAt, byUserId: transfer.createdBy };
    const sent = startTransfer(transfer, db.list("rolls"), ids);
    db.put("transfers", transfer);
    for (const m of sent.movements) db.put("stockMovements", m);
    for (const r of sent.rolls) db.put("rolls", r);
    this.appendAudit(db, {
      category: "data",
      action: "Started transfer",
      target: transfer.number,
      before: locationName(locations, transfer.fromId),
      after: `in transit to ${locationName(locations, transfer.toId)}, ${transfer.lines.length} items`,
    });
    this.emit();
    return transfer;
  }

  async receiveTransfer(transferId: string) {
    const db = this.open();
    await this.assertCan(db, ["inventory.transfer.receive"]);
    const transfer = db.get("transfers", transferId);
    if (!transfer) throw new DemoRuleError("This transfer no longer exists.");
    if (transfer.status !== "in_transit") throw new DemoRuleError(`${transfer.number} was already received.`);
    const ids = { movementId: () => newId(db.companyId, "mov"), at: nowStamp(), byUserId: this.viewer!.userId };
    const result = receiveTransfer(transfer, db.list("rolls"), ids);
    db.put("transfers", result.transfer);
    for (const m of result.movements) db.put("stockMovements", m);
    for (const r of result.rolls) db.put("rolls", r);
    this.appendAudit(db, {
      category: "data",
      action: "Received transfer",
      target: transfer.number,
      before: "in transit",
      after: `received at ${locationName(db.list("locations"), transfer.toId)}`,
    });
    this.emit();
    return result.transfer;
  }

  async saveLocation(location: Location) {
    const db = this.open();
    await this.assertCan(db, ["settings.locations.manage"]);
    const before = db.get("locations", location.id);
    const holdsStock =
      db.list("rolls").some((r) => r.locationId === location.id && dec(r.remainingLengthFt).gt(0)) ||
      [...boxedStock(db.list("stockMovements"), location.id).values()].some((q) => !q.isZero());
    if (location.kind === "showroom" && holdsStock) {
      throw new DemoRuleError(`${location.name} holds stock. Transfer it out before making it a showroom.`);
    }
    const others = db.list("locations").filter((l) => l.id !== location.id);
    if (location.kind === "showroom" && location.isDefault) {
      throw new DemoRuleError("The default must be a warehouse; showrooms hold no sellable stock.");
    }
    if (!location.isDefault && !others.some((l) => l.isDefault)) {
      throw new DemoRuleError("Keep one warehouse as the company default.");
    }
    const saved = { ...location, name: location.name.trim() };
    if (saved.isDefault)
      for (const l of others.filter((o) => o.isDefault)) db.put("locations", { ...l, isDefault: false });
    db.put("locations", saved);
    this.appendAudit(db, {
      category: "settings",
      action: before ? "Changed location" : "Added location",
      target: saved.name,
      before: before ? `${before.kind}${before.isDefault ? ", default" : ""}` : null,
      after: `${saved.kind}${saved.isDefault ? ", default" : ""}`,
    });
    this.emit();
    return saved;
  }

  async updateMyProfile(patch: ProfilePatch) {
    const db = this.open();
    const before = db.get("users", this.viewer!.userId)!;
    const locations = db.list("locations");
    if (patch.defaultLocationId && locations.find((l) => l.id === patch.defaultLocationId)?.kind !== "warehouse") {
      throw new DemoRuleError("Choose a warehouse; showrooms hold no sellable stock.");
    }
    const after = { ...before, ...patch };
    db.put("users", after);
    this.appendAudit(db, {
      category: "user",
      action: "Changed own profile",
      target: before.name,
      before: `default warehouse ${locationName(locations, before.defaultLocationId) || "company default"}`,
      after: `default warehouse ${locationName(locations, after.defaultLocationId) || "company default"}`,
    });
    this.emit();
    return after;
  }

  async recordAudit(entry: AuditInput) {
    this.appendAudit(this.open(), entry);
    this.emit();
  }

  private async platformData(): Promise<PlatformFixtures> {
    if (!this.platform) {
      const fixtures = await loadPlatformFixtures();
      this.platform = shiftDates(fixtures, dateShift(fixtures.anchorDate, this.todayIso));
    }
    return this.platform;
  }

  /** The demo company with this id, as the console names it by a plain string. */
  private async platformCompany(companyId: string): Promise<Company | undefined> {
    return (await this.listCompanies()).find((c) => c.id === companyId);
  }

  /** The profile and member count the console shows for a demo company. */
  private async consoleFacts(companyId: CompanyId): Promise<DemoCompanyFacts> {
    const db = await this.db(companyId);
    return {
      legalName: db.settings.profile.legalName,
      timeZone: db.settings.localization.region.timeZone,
      members: db.list("users").length,
    };
  }

  /** Companies the super-admin changed, upgrading what an older demo saved. */
  private changedCompanies(fresh: readonly Company[] = this.platform?.companies ?? []): Record<string, Company> {
    const current = readStored<Record<string, Company>>(PLATFORM_KEY);
    if (current) return current;
    const legacy = readLegacy<Record<string, Company>>(PLATFORM_KEY);
    if (!legacy) return {};
    const upgraded = Object.fromEntries(
      Object.entries(legacy).map(([id, c]) => [
        id,
        upgradeCompany(
          c,
          fresh.find((f) => f.id === id),
        ),
      ]),
    );
    writeStored(PLATFORM_KEY, upgraded);
    removeLegacy(PLATFORM_KEY);
    return upgraded;
  }

  private async db(companyId: CompanyId): Promise<CompanyDb> {
    let db = this.dbs.get(companyId);
    if (!db) {
      db = new CompanyDb(await loadCompanyFixtures(companyId), this.todayIso);
      if (db.droppedFileIds.length) await this.files.remove(db.droppedFileIds).catch(() => undefined);
      this.dbs.set(companyId, db);
    }
    return db;
  }

  /** What a domain action module needs from the store (payment-actions.ts and the like). */
  private actionContext(db: CompanyDb): ActionContext {
    return {
      db,
      today: this.todayIso,
      now: nowStamp(),
      actor: db.get("users", this.viewer!.userId)!,
      files: this.files,
      can: async (key) => (await this.granter(db)).access.permissions.has(key),
      assertCan: (anyOf) => this.assertCan(db, anyOf),
      audit: (entry) => this.appendAudit(db, { category: "payment", ...entry }),
      newId: (kind) => newId(db.companyId, kind),
    };
  }

  /**
   * Who imports into a company (spec G1): a user of the open company needs settings.import.manage
   * and may import only there, with their effective keys and data scope deciding the kinds and
   * columns (ADR 0057 S-2 to S-4, View as included); with no company open the caller is the
   * platform admin (the platform pages close it), who may import into any company.
   */
  private async importScope(companyId: CompanyId): Promise<ImportScope> {
    const company = (await this.listCompanies()).find((c) => c.id === companyId);
    if (!company) throw new DemoRuleError("This company does not exist.");
    const db = await this.db(companyId);
    let actor: ImportScope["actor"] = { userId: null, name: "Platform admin" };
    let holder: ImportHolder = FULL_IMPORT_HOLDER;
    if (this.viewer) {
      if (this.current?.companyId !== companyId) throw new DemoRuleError("You can import only into your own company.");
      await this.assertCan(db, ["settings.import.manage"]);
      const self = db.get("users", this.viewer.userId)!;
      actor = { userId: self.id, name: self.name };
      holder = (await this.granter(db)).access;
    }
    return {
      db,
      today: this.todayIso,
      now: nowStamp(),
      actor,
      modules: company.modules,
      holder,
      newId: (kind) => newId(companyId, kind),
      audit: (entry) => this.appendAudit(db, entry),
    };
  }

  /** Runs a domain action on the open company, then tells screens that data changed. */
  private async act<T>(action: (ctx: ActionContext) => Promise<T>): Promise<T> {
    const result = await action(this.actionContext(this.open()));
    this.emit();
    return result;
  }

  /** Runs a meetings action with the reader's sight and the undo memory (`MeetingScope`). */
  private async actOnMeetings<T>(action: (ctx: ActionContext, scope: MeetingScope) => Promise<T>): Promise<T> {
    const scope = await this.meetingScope(this.open());
    return this.act((ctx) => action(ctx, scope));
  }

  /**
   * What a meetings action needs: one subject under View as (S12), the signed-in person with the
   * viewed role's keys and scope (`meetingSightFor`), the undo memory and the company.
   */
  private async meetingScope(db: CompanyDb): Promise<MeetingScope> {
    const { access, company } = await this.granter(db);
    const actor = db.get("users", this.viewer!.userId)!;
    return { sight: meetingSightFor(db, access, company.modules, actor), memo: this.meetingMoves, company };
  }

  private open(): CompanyDb {
    if (!this.current || !this.viewer) throw new Error("No company is open. Sign in first.");
    return this.current;
  }

  private subject(db: CompanyDb) {
    return scopeSubject(db, this.viewer!);
  }

  /** Who asks for a report (ADR 0055): effective access, whose records count as theirs, and today. */
  private async reportViewer(db: CompanyDb): Promise<ReportViewer> {
    return { access: (await this.granter(db)).access, subject: this.subject(db), today: this.todayIso };
  }

  /** The signed-in viewer's effective access in the open company. */
  private async granter(db: CompanyDb) {
    const self = db.get("users", this.viewer!.userId)!;
    const company = await this.getCompany();
    return { access: viewerAccess(company, db.list("roles"), self, this.viewer!.viewAsRoleId), company };
  }

  /** The audit log as the viewer may read it (`demoAuditAsSeen`; ADR 0048 "Audit visibility"). */
  private async auditAsSeen(db: CompanyDb, entries: readonly AuditEntry[]): Promise<AuditEntry[]> {
    const { access } = await this.granter(db);
    const employeeId = db.get("users", this.viewer!.userId)?.employeeId ?? null;
    return demoAuditAsSeen({ ...access, employeeId }, entries);
  }

  /**
   * The checks every settings save makes before its content rules, in the API's order (ADR 0059):
   * the module first, as `permissionDecision` in apps/api's permission guard, then the keys, the
   * page's switch and data scope `all` (View as limits it too, spec rule 22). Gives the viewer's
   * access back for the checks that follow (Region's tax key, ADR 0059 part 2b).
   */
  private async assertSettingsSave(db: CompanyDb, rule: Pick<SettingsSectionRule, "keys" | "module" | "feature">) {
    const { access, company } = await this.granter(db);
    // The API's own words (`PERMISSION_REFUSALS.module_not_enabled` in apps/api's permission guard).
    if (!company.modules.includes(rule.module))
      throw new DemoRuleError("This part of the product is not switched on for your company.");
    await this.assertCan(db, rule.keys);
    if (!featureOn(rule.feature)) throw new DemoRuleError("This feature is switched off.");
    if (access.dataScope !== "all") throw new DemoRuleError(SETTINGS_SCOPE_MESSAGE);
    return access;
  }

  /**
   * The save logic's own permission check (CLAUDE.md rule 2, spec section 0.4): the screen hides
   * what a role cannot do, and the store refuses it anyway. Passes when any listed key is held.
   */
  private async assertCan(db: CompanyDb, anyOf: readonly PermissionKey[]) {
    if (anyOf.length === 0) return;
    const { access } = await this.granter(db);
    if (anyOf.some((key) => access.permissions.has(key))) return;
    throw new DemoRuleError("Your role does not allow this. Ask an Owner to change your security role.");
  }

  /** No privilege escalation (blueprint rule 2): every newly granted permission must be held by the granter. */
  private async assertCanGrant(db: CompanyDb, proposed: Role["permissions"], current: Role["permissions"]) {
    const { access } = await this.granter(db);
    const blocked = escalations(access, proposed, current);
    if (blocked.length > 0) {
      throw new DemoRuleError(`You can only grant permissions you hold. Not held: ${blocked.slice(0, 3).join(", ")}.`);
    }
  }

  /** Roles may be assigned only when their active permissions are all held, and only Owners make Owners. */
  private async assertCanAssign(db: CompanyDb, roleIds: readonly string[]) {
    const { access, company } = await this.granter(db);
    for (const id of roleIds) {
      const denial = canAssignRole(access, db.get("roles", id)!, company.ceiling, company.modules);
      if (denial === "owner_only") throw new DemoRuleError("Only an Owner can make someone an Owner.");
      if (denial === "not_held")
        throw new DemoRuleError("You can only assign roles whose permissions you hold yourself.");
    }
  }

  /** The API's invite-branch rule (ADR 0051, "2026-11-20"): a known branch, the admin's own below scope `all`. */
  private async assertBranchInvite(db: CompanyDb, to: string) {
    const actor = await this.branchActor(db, to);
    if (branchPlacementDenial(actor, branchOf(to)))
      throw new DemoRuleError("You can only invite people to your own branch.");
  }

  /**
   * The API's first change rule (ADR 0051, "2026-11-20"): below scope `all` an admin changes only
   * people in their own branch (`branchManageDenial`); changes to oneself follow the other rules.
   */
  private async assertBranchManage(db: CompanyDb, person: User) {
    if (person.id === this.viewer!.userId) return;
    if (branchManageDenial(await this.branchActor(db, ""), branchOf(person.branchId)))
      throw new DemoRuleError(BRANCH_CHANGE);
  }

  /** The API's move rule: a known branch, and below scope `all` from and to the admin's own (`branchPlacementDenial`). */
  private async assertBranchMove(db: CompanyDb, person: User, to: string) {
    const actor = await this.branchActor(db, to);
    if (branchPlacementDenial(actor, branchOf(to), branchOf(person.branchId))) throw new DemoRuleError(BRANCH_CHANGE);
  }

  /** The viewer's scope and branch for the branch rules, after refusing a branch that isn't the company's. */
  private async branchActor(db: CompanyDb, to: string) {
    const { access, company } = await this.granter(db);
    if (to !== "" && !company.branches.some((branch) => branch.id === to)) {
      throw new DemoRuleError("That branch is not one of your company's branches. Reload the page and pick another.");
    }
    return { dataScope: access.dataScope, branchId: branchOf(db.get("users", this.viewer!.userId)?.branchId ?? "") };
  }

  private roleNames(db: CompanyDb, roleIds: readonly string[]) {
    return roleIds.map((id) => db.get("roles", id)?.name ?? id).join(" + ");
  }

  private appendAudit(db: CompanyDb, entry: AuditInput, actor?: Pick<AuditEntry, "actorName" | "actorRole">) {
    const self =
      this.viewer && db.companyId === this.current?.companyId ? db.get("users", this.viewer.userId) : undefined;
    const by = actor ?? {
      actorName: self?.name ?? "Platform admin",
      actorRole: self ? this.roleNames(db, self.roleIds) : "Super-admin",
    };
    db.put("audit", { id: newId(db.companyId, "aud"), at: nowStamp(), ...by, ...entry });
  }

  /** A list kept in local storage, or empty when nothing (or something that isn't a list) is stored. */
  private storedList(key: string): unknown[] {
    const stored = readStored<unknown>(key);
    return Array.isArray(stored) ? stored : [];
  }

  /**
   * Appends one row to the demo's platform audit log (part 3, "Demo mode"). Rows are only added,
   * never changed, like `platform_audit_log`; every one is the demo admin's.
   */
  private appendPlatformAudit(entry: Omit<DemoPlatformAuditRow, "id" | "at">) {
    const row: DemoPlatformAuditRow = {
      id: newId(entry.tenantId ?? "platform", "pal"),
      at: new Date().toISOString(),
      ...entry,
    };
    writeStored(PLATFORM_AUDIT_KEY, [...this.storedList(PLATFORM_AUDIT_KEY), row]);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

/** A stored branch id as the shared branch rules take it: the demo's empty id is no branch. */
function branchOf(id: string): string | null {
  return id === "" ? null : id;
}

/** The API's words when a branch-scoped admin changes someone outside their branch, or moves them out. */
const BRANCH_CHANGE = "You can only change people in your own branch, and keep them in it.";
