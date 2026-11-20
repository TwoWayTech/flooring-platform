import { describe, expect, it } from "vitest";
import { defaultNumberSettings, type BusinessFilters, type ImportRequest } from "@workspace/shared";
import type { ApiClient } from "@/lib/api/contract";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { fakeApi, type FakeAnswer } from "./fake-api";

/**
 * Every routed method, classified (ADR 0051, "Re-reading after every write", 2026-11-16): a write
 * makes the screens read again once the server has answered it, and a read never does, or a screen
 * that reads would read forever. `CASES` names every key of API_METHODS, so a method added without
 * a case, or a case left after its method went, doesn't compile.
 */

type RoutedMethod = keyof typeof API_METHODS;

interface Case {
  kind: "read" | "write";
  call: (client: ApiClient) => Promise<unknown>;
  /** The one POST this read sends through `requestAsRead`, if any; a read sends no other non-GET. */
  postRead?: string;
}

const read = (call: Case["call"], postRead?: string): Case => ({ kind: "read", call, postRead });
const write = (call: Case["call"]): Case => ({ kind: "write", call });

/** An argument whose content the factory only passes on: the right type for the call, with just the fields it reads. */
function stub<T>(fields: object = {}): T {
  return fields as T;
}

const ID = "0195f3a2-7b1c-7d4e-8f00-00000000aa01";
const ZEROS = [0, 0, 0, 0, 0, 0, 0];
const IMPORT: ImportRequest = {
  kind: "customers",
  fileName: "customers.csv",
  table: { headers: ["Customer Name"], rows: [["Maple Row Builders"]] },
  mapping: { name: "Customer Name" },
};
const FILTERS: BusinessFilters = {
  from: "2026-11-01",
  to: "2026-11-30",
  locationIds: [],
  productCategory: null,
  expenseCategory: null,
  salesRepId: null,
  supplierId: null,
};
const UPLOAD = { table: { headers: [], rows: [] }, fileName: "hours.csv", own: true };

const CASES = {
  list: read((c) => c.list("invoices")),
  get: read((c) => c.get("invoices", ID)),
  listSettingsUsers: read((c) => c.listSettingsUsers()),
  listSettingsRoles: read((c) => c.listSettingsRoles()),
  inviteUser: write((c) => c.inviteUser(stub())),
  updateUser: write((c) => c.updateUser(ID, stub())),
  saveRole: write((c) => c.saveRole(stub())),
  resetRole: write((c) => c.resetRole(ID)),
  deleteRole: write((c) => c.deleteRole(ID)),
  verifyStepUp: read((c) => c.verifyStepUp("123456"), "POST /auth/step-up"),
  listPlatformCompanies: read((c) => c.listPlatformCompanies()),
  getPlatformCompany: read((c) => c.getPlatformCompany(ID)),
  updatePlatformCompanyAccess: write((c) => c.updatePlatformCompanyAccess(ID, {})),
  getPlatformDirectory: read((c) => c.getPlatformDirectory(ID)),
  listPlatformAudit: read((c) => c.listPlatformAudit({})),
  listPlatformSupportGrants: read((c) => c.listPlatformSupportGrants(ID)),
  requestSupportAccess: write((c) => c.requestSupportAccess(stub())),
  getCompanyStanding: read((c) => c.getCompanyStanding()),
  getWorkspace: read((c) => c.getWorkspace()),
  whoAmI: read((c) => c.whoAmI()),
  getSettings: read((c) => c.getSettings()),
  updateSettings: write((c) => c.updateSettings("numbers", defaultNumberSettings())),
  listMyNotifications: read((c) => c.listMyNotifications()),
  markNotificationsRead: write((c) => c.markNotificationsRead([ID])),
  listOutbox: read((c) => c.listOutbox(true)),
  retryOutbox: write((c) => c.retryOutbox(ID)),
  cancelOutbox: write((c) => c.cancelOutbox(ID)),
  updateLocalization: write((c) => c.updateLocalization("payroll", { overtimeRule: "federal", holidayState: "CO" })),
  getCompanyBilling: read((c) => c.getCompanyBilling()),
  listSupportGrants: read((c) => c.listSupportGrants()),
  approveSupportGrant: write((c) => c.approveSupportGrant(ID)),
  revokeSupportGrant: write((c) => c.revokeSupportGrant(ID)),
  listPlatformPlans: read((c) => c.listPlatformPlans()),
  createPlatformPlan: write((c) => c.createPlatformPlan(stub({ modules: [] }))),
  updatePlatformPlan: write((c) => c.updatePlatformPlan(ID, stub({ reason: "A reason" }))),
  retirePlatformPlan: write((c) => c.retirePlatformPlan(ID, "A reason")),
  restorePlatformPlan: write((c) => c.restorePlatformPlan(ID, "A reason")),
  getPlatformCompanyStatus: read((c) => c.getPlatformCompanyStatus(ID)),
  changePlatformCompanyStatus: write((c) => c.changePlatformCompanyStatus(ID, stub({ action: "suspend" }))),
  inventoryData: read((c) => c.inventoryData()),
  salesData: read((c) => c.salesData()),
  createCustomer: write((c) => c.createCustomer(stub())),
  saveCustomer: write((c) => c.saveCustomer(stub({ id: ID }))),
  saveQuote: write((c) => c.saveQuote(stub())),
  updateQuoteStatus: write((c) => c.updateQuoteStatus(ID, stub())),
  convertQuoteToInvoice: write((c) => c.convertQuoteToInvoice(ID)),
  markInvoiceSent: write((c) => c.markInvoiceSent(ID)),
  voidInvoice: write((c) => c.voidInvoice(ID, "A reason")),
  issueCreditNote: write((c) => c.issueCreditNote(ID, stub())),
  writeOffBalance: write((c) => c.writeOffBalance(ID, "A reason")),
  applyCredit: write((c) => c.applyCredit(ID)),
  recordPayment: write((c) => c.recordPayment(stub(), [])),
  reviewPayment: write((c) => c.reviewPayment(ID, stub())),
  voidPayment: write((c) => c.voidPayment(ID, "A reason")),
  attachPaymentFiles: write((c) => c.attachPaymentFiles(ID, [])),
  refundCredit: write((c) => c.refundCredit(stub(), [])),
  getFile: read((c) => c.getFile(ID)),
  expensesData: read((c) => c.expensesData()),
  saveExpense: write((c) => c.saveExpense(stub(), [])),
  reviewExpense: write((c) => c.reviewExpense(ID, stub())),
  voidExpense: write((c) => c.voidExpense(ID, "A reason")),
  saveRecurringExpense: write((c) => c.saveRecurringExpense(stub())),
  reportOptions: read((c) => c.reportOptions()),
  businessReport: read((c) => c.businessReport(FILTERS)),
  pnlReport: read((c) => c.pnlReport(stub({ range: "month" }))),
  salesByCategoryReport: read((c) => c.salesByCategoryReport(stub({ range: "month" }))),
  paymentsReport: read((c) => c.paymentsReport(stub({ range: "month" }))),
  importOverview: read((c) => c.importOverview("summit")),
  previewImport: read((c) => c.previewImport("summit", IMPORT), "POST /imports/check"),
  runImport: write((c) => c.runImport("summit", { ...IMPORT, expected: "c" })),
  undoImport: write((c) => c.undoImport("summit", ID)),
  saveImportMapping: write((c) => c.saveImportMapping("summit", "customers", {})),
  enterBill: write((c) => c.enterBill(ID, stub(), [])),
  recordSupplierPayment: write((c) => c.recordSupplierPayment(stub(), [])),
  reviewSupplierPayment: write((c) => c.reviewSupplierPayment(ID, stub())),
  voidSupplierPayment: write((c) => c.voidSupplierPayment(ID, "A reason")),
  purchasingData: read((c) => c.purchasingData()),
  saveSupplier: write((c) => c.saveSupplier(stub())),
  setSupplierStatus: write((c) => c.setSupplierStatus(ID, "active")),
  saveSupplierContact: write((c) => c.saveSupplierContact(stub())),
  setContactStatus: write((c) => c.setContactStatus(ID, "active")),
  createPurchaseOrder: write((c) => c.createPurchaseOrder(stub())),
  markOrdered: write((c) => c.markOrdered(ID)),
  cancelOrder: write((c) => c.cancelOrder(ID, "A reason")),
  recordReceipt: write((c) => c.recordReceipt(ID, stub())),
  moveRoll: write((c) => c.moveRoll(ID, "A-1")),
  createTransfer: write((c) => c.createTransfer(stub())),
  receiveTransfer: write((c) => c.receiveTransfer(ID)),
  saveLocation: write((c) => c.saveLocation(stub({ id: ID }))),
  correctStockCount: write((c) => c.correctStockCount(stub())),
  listStockHolds: read((c) => c.listStockHolds()),
  issueReservation: write((c) => c.issueReservation(ID)),
  createRollInvoice: write((c) => c.createRollInvoice(stub({ rollId: ID }))),
  setCommissionSplit: write((c) => c.setCommissionSplit(ID, [])),
  commissionData: read((c) => c.commissionData()),
  listCommissionStatements: read((c) => c.listCommissionStatements()),
  teamCommission: read((c) => c.teamCommission({ from: "2026-11-01", to: "2026-11-30" })),
  approveStatement: write((c) => c.approveStatement(ID, "2026-11")),
  addCommissionAdjustment: write((c) => c.addCommissionAdjustment(stub())),
  decideReversal: write((c) => c.decideReversal(stub())),
  saveCommissionPlan: write((c) => c.saveCommissionPlan(stub())),
  assignPlan: write((c) => c.assignPlan(stub())),
  contractsData: read((c) => c.contractsData()),
  saveContract: write((c) => c.saveContract(stub({ lines: [] }))),
  sendContract: write((c) => c.sendContract(ID)),
  recallContract: write((c) => c.recallContract(ID)),
  signContract: write((c) => c.signContract(ID, stub())),
  completeContract: write((c) => c.completeContract(ID)),
  closeContract: write((c) => c.closeContract(ID, null)),
  terminateContract: write((c) => c.terminateContract(ID, "A reason")),
  renewContract: write((c) => c.renewContract(ID)),
  addContractFiles: write((c) => c.addContractFiles(ID, [])),
  saveChangeOrder: write((c) => c.saveChangeOrder(ID, stub({ lines: [] }))),
  postBilling: write((c) => c.postBilling(ID, stub({ lines: [] }))),
  releaseRetainage: write((c) => c.releaseRetainage(ID, stub())),
  voidBilling: write((c) => c.voidBilling(ID, "A reason")),
  decideChangeOrder: write((c) => c.decideChangeOrder(ID, { approve: true, reason: "" })),
  recordWaiver: write((c) => c.recordWaiver(ID, stub())),
  saveCertificate: write((c) => c.saveCertificate(ID, stub())),
  hrData: read((c) => c.hrData()),
  saveEmployee: write((c) => c.saveEmployee(stub())),
  setChecklistItem: write((c) => c.setChecklistItem(ID, "onboarding", ID, true)),
  startOffboarding: write((c) => c.startOffboarding(ID)),
  addEmployeeDocuments: write((c) => c.addEmployeeDocuments(ID, [])),
  saveTimesheet: write((c) =>
    c.saveTimesheet({ employeeId: ID, weekStart: "2026-11-16", days: ZEROS, expectedDays: ZEROS }),
  ),
  submitTimesheet: write((c) => c.submitTimesheet(ID)),
  decideTimesheets: write((c) => c.decideTimesheets([ID], { action: "approve" })),
  reopenTimesheet: write((c) => c.reopenTimesheet(ID, "A reason")),
  // The dry run only reads; saving the good rows writes.
  uploadTimesheets: [
    read((c) => c.uploadTimesheets({ ...UPLOAD, apply: false }), "POST /timesheets/upload"),
    write((c) => c.uploadTimesheets({ ...UPLOAD, apply: true })),
  ],
  requestTimeOff: write((c) => c.requestTimeOff(stub())),
  decideTimeOff: write((c) => c.decideTimeOff(ID, stub())),
  cancelTimeOff: write((c) => c.cancelTimeOff(ID)),
  adjustTimeOff: write((c) => c.adjustTimeOff(stub())),
  saveTimeOffPolicy: write((c) => c.saveTimeOffPolicy(stub())),
  // Runs inside a read (the pay periods page and HR Home), so it must never ask for one.
  listPayPeriods: read((c) => c.listPayPeriods(), "POST /pay-periods"),
  reviewPayPeriod: read((c) => c.reviewPayPeriod(ID)),
  setPayExclusion: write((c) => c.setPayExclusion(ID, ID, null)),
  approvePayPeriod: write((c) => c.approvePayPeriod(ID)),
  reopenPayPeriod: write((c) => c.reopenPayPeriod(ID)),
  exportPayPeriod: write((c) => c.exportPayPeriod(ID)),
  myPortal: read((c) => c.myPortal()),
  updateMyEmployeeProfile: write((c) => c.updateMyEmployeeProfile(stub())),
  acknowledgePlan: write((c) => c.acknowledgePlan(ID, "Bri Lawson", stub())),
  clockIn: write((c) => c.clockIn()),
  clockOut: write((c) => c.clockOut()),
  meetingsData: read((c) => c.meetingsData()),
  myMeetings: read((c) => c.myMeetings()),
  createMeeting: write((c) => c.createMeeting(stub({ guests: [], newGuests: [] }))),
  updateMeeting: write((c) => c.updateMeeting(ID, {})),
  cancelMeeting: write((c) => c.cancelMeeting(ID)),
  removeGuest: write((c) => c.removeGuest(ID, ID)),
  respondToMeeting: write((c) => c.respondToMeeting(ID, stub())),
  decideProposal: write((c) => c.decideProposal(ID, ID, true)),
  requestMeeting: write((c) => c.requestMeeting(stub())),
  meetingCalendarFile: read((c) => c.meetingCalendarFile(ID)),
  rescheduleMeeting: write((c) => c.rescheduleMeeting(stub({ meetingId: ID }))),
  undoReschedule: write((c) => c.undoReschedule(stub({ previous: { id: ID, sequence: 1 }, createdIds: [] }))),
} satisfies Record<RoutedMethod, Case | readonly [Case, Case]>;

/** Every case, with its method's name; the upload gives two. */
const ALL = Object.entries(CASES).flatMap(([name, entry]) =>
  ("kind" in entry ? [entry] : entry).map((c) => ({ name, ...c })),
);
const READS = ALL.filter((c) => c.kind === "read");
const WRITES = ALL.filter((c) => c.kind === "write");

const OK: FakeAnswer = { status: 200, body: {} };
const refused = (status: number): FakeAnswer => ({ status, body: { code: "refused", message: "Refused." } });

/** Runs one case with every GET answered 200 and every other request answered `nonGet`. */
async function run(c: Case, nonGet: FakeAnswer = OK) {
  const fake = fakeApi({}, (call) => (call.startsWith("GET ") ? OK : nonGet));
  // Some answers' transforms throw on `{}`; only what was sent and the re-reads matter here.
  await c.call(fake.client).catch(() => undefined);
  return { ...fake, nonGets: fake.sent.map((s) => s.call).filter((call) => !call.startsWith("GET ")) };
}

describe("re-reading after a routed write (ADR 0051, 2026-11-16)", () => {
  it("classifies every routed method, and nothing else", () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(API_METHODS).sort());
    expect(READS.length + WRITES.length).toBe(158);
    expect(WRITES).toHaveLength(113);
  });

  it("sends at least one request in every case, so no case passes without reaching the API", async () => {
    for (const c of ALL) {
      const { sent } = await run(c);
      expect(sent.length, `${c.name} (${c.kind})`).toBeGreaterThan(0);
    }
  });

  it("never re-reads after a read, even when the API refuses a read's POST", async () => {
    for (const c of READS) {
      for (const answer of [OK, refused(400), refused(409), refused(422)]) {
        const { changes } = await run(c, answer);
        expect(changes(), `${c.name} answered ${JSON.stringify(answer)}`).toBe(0);
      }
    }
  });

  it("sends no non-GET from a read except the POSTs that only read, through requestAsRead", async () => {
    for (const c of READS) {
      const { nonGets } = await run(c);
      expect(nonGets, c.name).toEqual(c.postRead ? [c.postRead] : []);
    }
  });

  it("re-reads exactly once after every write the API saved, from its one non-GET", async () => {
    for (const c of WRITES) {
      const { changes, nonGets } = await run(c);
      expect(nonGets, c.name).toHaveLength(1);
      expect(changes(), c.name).toBe(1);
    }
  });

  it("re-reads once after a write the API refused (400, 403, 404, 409, 422), since the screen may be stale", async () => {
    for (const c of WRITES) {
      for (const status of [400, 403, 404, 409, 422]) {
        const { changes } = await run(c, refused(status));
        expect(changes(), `${c.name} answered ${status}`).toBe(1);
      }
    }
  });

  it("doesn't re-read when the write never reached the API, or after a 401, a 429 or a server failure", async () => {
    for (const c of WRITES) {
      for (const answer of ["network", refused(401), refused(429), refused(500), refused(503)] as FakeAnswer[]) {
        const { changes } = await run(c, answer);
        expect(changes(), `${c.name} answered ${JSON.stringify(answer)}`).toBe(0);
      }
    }
  });
});
