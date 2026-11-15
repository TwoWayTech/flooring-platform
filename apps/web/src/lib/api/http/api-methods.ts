import type {
  Bill,
  ChangeOrder,
  CommissionAssignment,
  CommissionPlan,
  CommissionStatement,
  TeamCommission,
  Conflict,
  Contract,
  ContractBilling,
  ContractLine,
  Customer,
  Employee,
  Expense,
  GoodsReceipt,
  GuestOption,
  InsuranceCertificate,
  Invoice,
  InvoiceAdjustment,
  LienWaiver,
  Location,
  Meeting,
  MeetingPatch,
  MyMeetings,
  PayPeriod,
  PlatformAccessPatch,
  PlatformAuditQuery,
  PlatformAuditResult,
  PlatformCompany,
  PlatformCompanySummary,
  PlatformDirectory,
  PlatformSupportGrant,
  SupportRequestInput,
  Payment,
  Refund,
  Reservation,
  Product,
  PtoRequest,
  PurchaseOrder,
  Quote,
  RecurringExpense,
  Role,
  Roll,
  StockAdjustment,
  StockMovement,
  Supplier,
  SupplierPayment,
  SupplierContact,
  TimeOffEntry,
  TimeOffPolicy,
  TimesheetWire,
  Transfer,
  User,
} from "@workspace/shared";
import { featureOn, hoursToWire, timesheetFromWire } from "@workspace/shared";
// Reports (ADR 0055) keep their own imports.
import { EMPTY_REPORT_OPTIONS, type BusinessReport, type Report, type ReportOptions } from "@workspace/shared";
import { businessReportPath, hubReportPath } from "./report-paths";
import type { SessionContext } from "@/lib/session/api-context";
import { HttpApiError } from "./transport";
import type {
  CollectionName,
  Collections,
  CommissionData,
  ContractInput,
  EmployeeInput,
  ItemOf,
  MeetingInput,
  MeetingUndo,
  MyPortal,
  PayPeriodReview,
  StockHold,
  TimesheetUploadResult,
} from "../contract";
import type { HttpRoutes } from "./router";
// Platform admin part 4 (ADR 0054) keeps its own imports, so the lists above stay as they are.
import {
  companyStandingFromWire,
  SUPPORT_CLOSED_MESSAGES,
  type CompanyBilling,
  type CompanySupportGrant,
  type SupportGrantStep,
} from "@workspace/shared";
import { ApiError } from "../errors";
import type { HttpTransport } from "./transport";

/**
 * Collections the real API lists through `list`, with their endpoints (docs/api-contract.md).
 * Users and roles are not here: many screens read them for names and pickers next to demo
 * records, so Settings reads them through its own methods instead (ADR 0034). Invoices and what
 * settles them move with sales, part 2 (ADR 0038), so every balance on every screen comes from
 * one place.
 */
const SERVED_LISTS: Partial<Record<CollectionName, string>> = {
  audit: "/audit",
  invoices: "/invoices",
  payments: "/payments",
  invoiceAdjustments: "/invoice-adjustments",
  refunds: "/refunds",
  reservations: "/reservations",
  // HR part 2 (ADR 0047): payroll records, for holders of hr.payroll.view.
  payPeriods: "/pay-periods",
  bonuses: "/bonuses",
  contractorPayments: "/contractor-payments",
};

/**
 * The ApiClient methods apps/api already serves when NEXT_PUBLIC_DATA_SOURCE=api. Each module's
 * pull request adds its methods here, with the endpoints from docs/api-contract.md, and its
 * Playwright tests run against the API. `list` and `get` go to the API only for the collections
 * in SERVED_LISTS; the rest stay on the demo client until their module moves.
 */
export const API_METHODS: HttpRoutes = {
  list:
    (http, demo) =>
    <K extends CollectionName>(collection: K) => {
      const path = SERVED_LISTS[collection];
      if (!path) return demo.list(collection);
      return seen(http.request<ItemOf<K>[]>("GET", path)) as Promise<Collections[K]>;
    },
  get:
    (http, demo) =>
    async <K extends CollectionName>(collection: K, id: string) => {
      const path = SERVED_LISTS[collection];
      if (!path) return demo.get(collection, id);
      const all = await seen(http.request<ItemOf<K>[]>("GET", path));
      return all.find((item) => (item as { id: string }).id === id);
    },
  listSettingsUsers: (http) => () => http.request<User[]>("GET", "/users"),
  listSettingsRoles: (http) => () => http.request<Role[]>("GET", "/roles"),
  inviteUser: (http) => (input) => http.request<User>("POST", "/users/invite", input),
  updateUser: (http) => (userId, patch) => http.request<User>("PATCH", `/users/${userId}`, patch),
  saveRole: (http) => (role) => {
    const body = {
      name: role.name,
      description: role.description,
      dataScope: role.dataScope,
      permissions: role.permissions,
    };
    return isSaved(role.id)
      ? http.request<Role>("PUT", `/roles/${role.id}`, body)
      : http.request<Role>("POST", "/roles", body);
  },
  resetRole: (http) => (roleId) => http.request<Role>("POST", `/roles/${roleId}/reset`),
  deleteRole: (http) => (roleId) => http.request<void>("DELETE", `/roles/${roleId}`),
  verifyStepUp: (http) => (code) => http.request<void>("POST", "/auth/step-up", { code }),
  // The platform console (docs/specs/platform-admin.md, part 1). PlatformAdminGuard decides who may
  // call these. The demo's switcher, palette and sign-in keep `listCompanies` on DemoStore.
  listPlatformCompanies: (http) => () => http.request<PlatformCompanySummary[]>("GET", "/platform/companies"),
  getPlatformCompany: (http) => async (companyId) => {
    // Company ids are UUIDs; any other id names no company, so it is not sent.
    if (!isSaved(companyId)) return null;
    try {
      return await http.request<PlatformCompany>("GET", `/platform/companies/${companyId}`);
    } catch (failure) {
      if (failure instanceof HttpApiError && failure.status === 404) return null;
      throw failure;
    }
  },
  updatePlatformCompanyAccess: (http) => (companyId, patch) =>
    http.request<PlatformCompany>(
      "PATCH",
      `/platform/companies/${encodeURIComponent(companyId)}/access`,
      accessPatchBody(patch),
    ),
  getPlatformDirectory: (http) => (companyId) =>
    http.request<PlatformDirectory>("GET", `/platform/companies/${encodeURIComponent(companyId)}/directory`),
  // Platform admin part 3 (docs/specs/platform-admin.md, "ApiClient (part 3)"). A company id or a
  // cursor that is not a UUID, such as a demo slug, names nothing on the API, so it is never sent.
  listPlatformAudit: (http) => async (query) => {
    const params = auditQueryParams(query);
    if (!params) return { entries: [], nextCursor: null };
    const search = params.toString();
    return http.request<PlatformAuditResult>("GET", search ? `/platform/audit?${search}` : "/platform/audit");
  },
  listPlatformSupportGrants: (http) => async (companyId) =>
    isSaved(companyId)
      ? http.request<PlatformSupportGrant[]>(
          "GET",
          `/platform/support-grants?companyId=${encodeURIComponent(companyId)}`,
        )
      : [],
  requestSupportAccess: (http) => (input) =>
    http.request<{ id: string }>("POST", "/platform/support-grants", supportRequestBody(input)),
  // Platform admin part 4 (docs/specs/platform-admin.md, "ApiClient (part 4)"). The company is the session's;
  // nothing names it. A grant id that is not a UUID names no grant, so it is never sent.
  getCompanyStanding: (http) => async () =>
    companyStandingFromWire(await http.request<unknown>("GET", "/company/standing")),
  getCompanyBilling: (http) => () => http.request<CompanyBilling>("GET", "/billing"),
  listSupportGrants: (http) => () => http.request<CompanySupportGrant[]>("GET", "/support-grants"),
  approveSupportGrant: (http) => (grantId) => supportGrantDecision(http, grantId, "approve"),
  revokeSupportGrant: (http) => (grantId) => supportGrantDecision(http, grantId, "revoke"),
  inventoryData: (http) => async () => {
    const [products, rolls, stockMovements, locations, transfers, reservations] = await Promise.all([
      seen(http.request<Product[]>("GET", "/products")),
      seen(http.request<Roll[]>("GET", "/rolls")),
      seen(http.request<StockMovement[]>("GET", "/stock-movements")),
      seen(http.request<Location[]>("GET", "/locations")),
      seen(http.request<Transfer[]>("GET", "/transfers")),
      seen(http.request<Reservation[]>("GET", "/reservations")),
    ]);
    // Stock adjustments with approval move with inventory part 2 (ADR 0038).
    return { products, rolls, stockMovements, locations, transfers, reservations, stockAdjustments: [] };
  },
  salesData: (http) => async () => {
    const [quotes, customers, locations] = await Promise.all([
      seen(http.request<Quote[]>("GET", "/quotes")),
      seen(http.request<Customer[]>("GET", "/customers")),
      seen(http.request<Location[]>("GET", "/locations")),
    ]);
    return { quotes, customers, locations };
  },
  createCustomer: (http) => (input) => http.request<Customer>("POST", "/customers", input),
  saveCustomer: (http) => (customer) => http.request<Customer>("PUT", `/customers/${customer.id}`, customer),
  // A quote the API has saved has a number; a draft from the screen does not yet.
  saveQuote: (http) => (quote) =>
    quote.number
      ? http.request<Quote>("PUT", `/quotes/${quote.id}`, quote)
      : http.request<Quote>("POST", "/quotes", quote),
  updateQuoteStatus: (http) => (quoteId, change) => http.request<Quote>("POST", `/quotes/${quoteId}/status`, change),
  convertQuoteToInvoice: (http) => (quoteId) => http.request<Invoice>("POST", `/quotes/${quoteId}/invoice`),
  markInvoiceSent: (http) => (invoiceId) => http.request<Invoice>("POST", `/invoices/${invoiceId}/sent`),
  voidInvoice: (http) => (invoiceId, reason) =>
    http.request<Invoice>("POST", `/invoices/${invoiceId}/void`, { reason }),
  issueCreditNote: (http) => (invoiceId, input) =>
    http.request<Invoice>("POST", `/invoices/${invoiceId}/credit-notes`, input),
  writeOffBalance: (http) => (invoiceId, reason) =>
    http.request<InvoiceAdjustment>("POST", `/invoices/${invoiceId}/write-off`, { reason }),
  applyCredit: (http) => (invoiceId) => http.request<InvoiceAdjustment>("POST", `/invoices/${invoiceId}/apply-credit`),
  recordPayment: (http) => async (input, files) =>
    http.request<Payment>("POST", "/payments", { ...input, files: await encodeFiles(files) }),
  reviewPayment: (http) => (paymentId, decision) =>
    http.request<Payment>("POST", `/payments/${paymentId}/review`, decision),
  voidPayment: (http) => (paymentId, reason) =>
    http.request<Payment>("POST", `/payments/${paymentId}/void`, { reason }),
  attachPaymentFiles: (http) => async (paymentId, files) =>
    http.request<Payment>("POST", `/payments/${paymentId}/files`, { files: await encodeFiles(files) }),
  refundCredit: (http) => async (input, files) =>
    http.request<Refund>("POST", "/refunds", { ...input, files: await encodeFiles(files) }),
  // Files the API stored have UUIDs (payments, refunds, expenses, bills, contracts, employee documents).
  getFile: (http, demo) => (fileId) => (isSaved(fileId) ? http.blob(`/files/${fileId}`) : demo.getFile(fileId)),
  expensesData: (http) => async () => {
    const [expenses, recurring, suppliers, locations] = await Promise.all([
      seen(http.request<Expense[]>("GET", "/expenses")),
      seen(http.request<RecurringExpense[]>("GET", "/recurring-expenses")),
      seen(http.request<Supplier[]>("GET", "/suppliers")),
      seen(http.request<Location[]>("GET", "/locations")),
    ]);
    return { expenses, recurring, suppliers, locations };
  },
  saveExpense: (http) => async (input, files) => {
    const { id, ...body } = input;
    // The form sends an empty vendor while none is chosen; the API reads that as none.
    const payload = { ...body, supplierId: body.supplierId || null, files: await encodeFiles(files) };
    return id && isSaved(id)
      ? http.request<Expense>("PUT", `/expenses/${id}`, payload)
      : http.request<Expense>("POST", "/expenses", payload);
  },
  reviewExpense: (http) => (id, decision) => http.request<Expense>("POST", `/expenses/${id}/review`, decision),
  voidExpense: (http) => (id, reason) => http.request<Expense>("POST", `/expenses/${id}/void`, { reason }),
  saveRecurringExpense: (http) => (input) => {
    const { id, ...body } = input;
    return id && isSaved(id)
      ? http.request<RecurringExpense>("PUT", `/recurring-expenses/${id}`, body)
      : http.request<RecurringExpense>("POST", "/recurring-expenses", body);
  },
  // Reports (ADR 0055). The server answers only what the person may see; a report they may not open
  // never shows, because reportOptions lists only what they may open.
  reportOptions: (http) => async () => {
    try {
      return await http.request<ReportOptions>("GET", "/reports/options");
    } catch (failure) {
      // No report key (403 forbidden) or the hub switched off (404): no reports, so the page says so.
      // Anything else (MFA, a suspended company, the wrong product) surfaces as it does elsewhere.
      if (
        failure instanceof HttpApiError &&
        ((failure.status === 403 && failure.code === "forbidden") || failure.status === 404)
      )
        return EMPTY_REPORT_OPTIONS;
      throw failure;
    }
  },
  businessReport: (http) => (filters) => http.request<BusinessReport>("GET", businessReportPath(filters)),
  pnlReport: (http) => (query) => http.request<Report>("GET", hubReportPath("/reports/pnl", query)),
  salesByCategoryReport: (http) => (query) =>
    http.request<Report>("GET", hubReportPath("/reports/sales-by-category", query)),
  paymentsReport: (http) => (query) => http.request<Report>("GET", hubReportPath("/reports/payments", query)),
  enterBill: (http) => async (poId, input, files) =>
    http.request<Bill>("POST", `/purchase-orders/${poId}/bills`, { ...input, files: await encodeFiles(files) }),
  recordSupplierPayment: (http) => async (input, files) =>
    http.request<SupplierPayment>("POST", "/supplier-payments", { ...input, files: await encodeFiles(files) }),
  reviewSupplierPayment: (http) => (paymentId, decision) =>
    http.request<SupplierPayment>("POST", `/supplier-payments/${paymentId}/review`, decision),
  voidSupplierPayment: (http) => (paymentId, reason) =>
    http.request<SupplierPayment>("POST", `/supplier-payments/${paymentId}/void`, { reason }),
  purchasingData: (http) => async () => {
    const [suppliers, contacts, purchaseOrders, receipts, products, locations, bills, supplierPayments] =
      await Promise.all([
        seen(http.request<Supplier[]>("GET", "/suppliers")),
        seen(http.request<SupplierContact[]>("GET", "/supplier-contacts")),
        seen(http.request<PurchaseOrder[]>("GET", "/purchase-orders")),
        seen(http.request<GoodsReceipt[]>("GET", "/receipts")),
        seen(http.request<Product[]>("GET", "/products")),
        seen(http.request<Location[]>("GET", "/locations")),
        // Bills and supplier payments post to the ledger, so they moved with P12 part 3 (ADR 0042).
        // With `purchasing.orders` off these answer 404; the queue and other screens read them as empty.
        seenOrOff(http.request<Bill[]>("GET", "/bills")),
        seenOrOff(http.request<SupplierPayment[]>("GET", "/supplier-payments")),
      ]);
    return { suppliers, contacts, purchaseOrders, receipts, products, locations, bills, supplierPayments };
  },
  saveSupplier:
    (http) =>
    ({ id, ...input }) =>
      id
        ? http.request<Supplier>("PUT", `/suppliers/${id}`, input)
        : http.request<Supplier>("POST", "/suppliers", input),
  setSupplierStatus: (http) => (id, status) => http.request<Supplier>("POST", `/suppliers/${id}/status`, { status }),
  saveSupplierContact:
    (http) =>
    ({ id, ...input }) =>
      id
        ? http.request<SupplierContact>("PUT", `/supplier-contacts/${id}`, input)
        : http.request<SupplierContact>("POST", "/supplier-contacts", input),
  setContactStatus: (http) => (id, status) =>
    http.request<SupplierContact>("POST", `/supplier-contacts/${id}/status`, { status }),
  // The screen's draft line ids are ignored by the API, which gives every line its own id.
  createPurchaseOrder: (http) => (input) => http.request<PurchaseOrder>("POST", "/purchase-orders", input),
  markOrdered: (http) => (poId, via) =>
    http.request<PurchaseOrder>("POST", `/purchase-orders/${poId}/order`, { via: via ?? "email" }),
  cancelOrder: (http) => (poId, reason) =>
    http.request<PurchaseOrder>("POST", `/purchase-orders/${poId}/cancel`, { reason }),
  recordReceipt: (http) => (poId, input) =>
    http.request<GoodsReceipt>("POST", `/purchase-orders/${poId}/receipts`, input),
  moveRoll: (http) => (rollId, bin) => http.request<Roll>("PATCH", `/rolls/${rollId}`, { bin }),
  createTransfer: (http) => (input) => http.request<Transfer>("POST", "/transfers", input),
  receiveTransfer: (http) => (transferId) => http.request<Transfer>("POST", `/transfers/${transferId}/receive`),
  correctStockCount: (http) => (input) => http.request<StockAdjustment>("POST", "/stock/corrections", input),
  // Ready to cut, issuing and cutting, the roll quick invoice and the split moved in inventory part 2 (ADR 0043).
  listStockHolds: (http) => () => seen(http.request<StockHold[]>("GET", "/stock-holds")),
  issueReservation: (http) => (reservationId, overrideReason) =>
    http.request<Reservation>("POST", `/reservations/${reservationId}/issue`, overrideReason ? { overrideReason } : {}),
  createRollInvoice:
    (http) =>
    ({ rollId, ...body }) =>
      http.request<Invoice>("POST", `/rolls/${rollId}/invoice`, body),
  setCommissionSplit: (http) => async (invoiceId, split) => {
    await http.request<{ ok: true }>("PUT", `/invoices/${invoiceId}/commission-split`, { split });
  },
  // Commissions (ADR 0048): statements, plans and assignments; paid through pay runs.
  commissionData: (http) => () => http.request<CommissionData>("GET", "/commissions"),
  // HR Home reads it beside other panels: a 403 (say a branch-scope role) is no statements, not a failed page.
  listCommissionStatements: (http) => () =>
    seen(http.request<CommissionData>("GET", "/commissions").then((data) => data.statements)),
  teamCommission: (http) => (range) =>
    http.request<[string, TeamCommission][]>(
      "GET",
      `/commission-totals?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    ),
  approveStatement: (http) => (userId, month) =>
    http.request<CommissionStatement>("POST", "/commission-statements/approve", { userId, month }),
  addCommissionAdjustment: (http) => async (input) => {
    await http.request<{ ok: true }>("POST", "/commission-adjustments", input);
  },
  decideReversal: (http) => async (input) => {
    await http.request<{ ok: true }>("POST", "/commission-reversals/decide", input);
  },
  saveCommissionPlan: (http) => (plan) => {
    // Version, status and dates are the server's (commissions.md rule 13); only the terms are sent.
    const body = {
      name: plan.name,
      basis: plan.basis,
      baseRatePct: plan.baseRatePct,
      monthlyTarget: plan.monthlyTarget,
      tierMode: plan.tierMode,
      tiers: plan.tiers,
      overridePct: plan.overridePct,
      draw: plan.draw,
      clawbackDays: plan.clawbackDays,
    };
    return isSaved(plan.id)
      ? http.request<CommissionPlan>("PUT", `/commission-plans/${plan.id}`, body)
      : http.request<CommissionPlan>("POST", "/commission-plans", body);
  },
  assignPlan: (http) => (input) =>
    http.request<CommissionAssignment>("POST", "/commission-assignments", {
      ...input,
      monthlyTargetOverride: input.monthlyTargetOverride || null,
    }),
  // Contracts (ADR 0044 and 0045): the register, change orders, billings, waivers and insurance.
  contractsData: (http) => async () => {
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
      seen(http.request<Contract[]>("GET", "/contracts")),
      seen(http.request<ContractLine[]>("GET", "/contract-lines")),
      seenOrOff(http.request<ChangeOrder[]>("GET", "/change-orders")),
      // Billings and compliance have their own switches; switched off they read as empty.
      seenOrOff(http.request<ContractBilling[]>("GET", "/contract-billings")),
      seenOrOff(http.request<LienWaiver[]>("GET", "/lien-waivers")),
      seenOrOff(http.request<InsuranceCertificate[]>("GET", "/insurance-certificates")),
      seen(http.request<Customer[]>("GET", "/customers")),
      seen(http.request<Supplier[]>("GET", "/suppliers")),
      seen(http.request<Location[]>("GET", "/locations")),
      seenOrOff(http.request<Bill[]>("GET", "/bills")),
      seenOrOff(http.request<SupplierPayment[]>("GET", "/supplier-payments")),
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
  },
  saveContract: (http) => (input) => {
    const body = contractBody(input);
    return input.id && isSaved(input.id)
      ? http.request<Contract>("PUT", `/contracts/${input.id}`, body)
      : http.request<Contract>("POST", "/contracts", body);
  },
  sendContract: (http) => (id) => http.request<Contract>("POST", `/contracts/${id}/send`),
  recallContract: (http) => (id) => http.request<Contract>("POST", `/contracts/${id}/recall`),
  signContract: (http) => (id, input) => http.request<Contract>("POST", `/contracts/${id}/sign`, input),
  completeContract: (http) => (id) => http.request<Contract>("POST", `/contracts/${id}/complete`),
  closeContract: (http) => (id, overrideReason) =>
    http.request<Contract>("POST", `/contracts/${id}/close`, { overrideReason }),
  terminateContract: (http) => (id, reason) => http.request<Contract>("POST", `/contracts/${id}/terminate`, { reason }),
  renewContract: (http) => (id) => http.request<Contract>("POST", `/contracts/${id}/renew`),
  addContractFiles: (http) => async (contractId, files) => {
    await http.request<Contract>("POST", `/contracts/${contractId}/files`, { files: await encodeFiles(files) });
  },
  saveChangeOrder: (http) => (contractId, input) =>
    http.request<ChangeOrder>("POST", `/contracts/${contractId}/change-orders`, {
      reason: input.reason,
      lines: input.lines.map((line) => ({
        contractLineId: line.lineId,
        description: line.description,
        category: line.category,
        amountDelta: line.amountDelta,
      })),
    }),
  // The server takes each line's retainage rates itself (spec rule 4), so only the figures go.
  postBilling: (http) => (contractId, input) =>
    http.request<ContractBilling>("POST", `/contracts/${contractId}/billings`, {
      periodEnd: input.periodEnd,
      lines: input.lines.map((line) => ({
        contractLineId: line.lineId,
        completedToDate: line.completedToDate || "0",
        storedBalance: line.storedBalance || "0",
      })),
    }),
  releaseRetainage: (http) => (contractId, input) =>
    http.request<ContractBilling>("POST", `/contracts/${contractId}/retainage-releases`, {
      amount: input.amount || "0",
    }),
  voidBilling: (http) => (billingId, reason) =>
    http.request<ContractBilling>("POST", `/contract-billings/${billingId}/void`, { reason }),
  decideChangeOrder: (http) => (id, decision) =>
    http.request<ChangeOrder>("POST", `/change-orders/${id}/decision`, {
      action: decision.approve ? "approve" : "reject",
      reason: decision.reason,
    }),
  recordWaiver: (http) => (contractId, input) =>
    http.request<LienWaiver>("POST", `/contracts/${contractId}/lien-waivers`, {
      type: input.type,
      paymentId: input.paymentId,
      supplierPaymentId: input.supplierPaymentId,
      amount: input.amount,
      throughDate: input.throughDate,
      statutoryForm: input.statutoryForm,
    }),
  saveCertificate: (http) => (contractId, input) =>
    http.request<InsuranceCertificate>("PUT", `/contracts/${contractId}/insurance-certificate`, {
      producer: input.producer,
      holder: input.holder,
      additionalInsured: input.additionalInsured,
      coverages: input.coverages,
    }),
  // HR part 1 (ADR 0046): people, timesheets and time off. Pay periods (ADR 0047) and the portal with the clock (ADR 0049) follow below.
  hrData: (http) => async () => {
    const [employees, timesheets, ptoRequests, timeOffPolicies, timeOffEntries, locations] = await Promise.all([
      seenOrOff(http.request<Employee[]>("GET", "/employees")),
      // Each HR screen has its own switch; switched off, its records read as empty.
      seenOrOff(http.request<TimesheetWire[]>("GET", "/timesheets")),
      seenOrOff(http.request<PtoRequest[]>("GET", "/pto-requests")),
      seenOrOff(http.request<TimeOffPolicy[]>("GET", "/time-off-policies")),
      seenOrOff(http.request<TimeOffEntry[]>("GET", "/time-off-entries")),
      // HR Suite companies have no warehouses module, so locations may answer 403 or 404.
      seenOrOff(http.request<Location[]>("GET", "/locations")),
    ]);
    // Hours travel as decimal strings; the screens' Timesheet reads numbers (ADR 0046).
    return {
      employees,
      timesheets: timesheets.map(timesheetFromWire),
      ptoRequests,
      timeOffPolicies,
      timeOffEntries,
      locations,
    };
  },
  saveEmployee: (http) => (input) => {
    const body = employeeBody(input);
    return input.id && isSaved(input.id)
      ? http.request<Employee>("PUT", `/employees/${input.id}`, body)
      : http.request<Employee>("POST", "/employees", body);
  },
  setChecklistItem: (http) => async (employeeId, list, itemId, done) => {
    await http.request<Employee>("POST", `/employees/${employeeId}/checklist/${itemId}`, { list, done });
  },
  startOffboarding: (http) => (employeeId) => http.request<Employee>("POST", `/employees/${employeeId}/offboarding`),
  addEmployeeDocuments: (http) => async (employeeId, files) => {
    await http.request<Employee>("POST", `/employees/${employeeId}/documents`, { files: await encodeFiles(files) });
  },
  saveTimesheet: (http) => async (input) =>
    timesheetFromWire(
      await http.request<TimesheetWire>("PUT", "/timesheets", {
        employeeId: input.employeeId,
        weekStart: input.weekStart,
        days: hoursToWire(input.days),
      }),
    ),
  submitTimesheet: (http) => async (id) =>
    timesheetFromWire(await http.request<TimesheetWire>("POST", `/timesheets/${id}/submit`)),
  decideTimesheets: (http) => async (ids, decision) => {
    await http.request<{ ok: true }>("POST", "/timesheets/decisions", { ...decision, ids });
  },
  reopenTimesheet: (http) => async (id, reason) =>
    timesheetFromWire(await http.request<TimesheetWire>("POST", `/timesheets/${id}/reopen`, { reason })),
  uploadTimesheets: (http) => (input) =>
    http.request<TimesheetUploadResult>("POST", "/timesheets/upload", {
      table: input.table,
      fileName: input.fileName,
      apply: input.apply,
      own: input.own,
    }),
  requestTimeOff: (http) => (input) =>
    http.request<PtoRequest>("POST", "/pto-requests", {
      employeeId: input.employeeId,
      policyId: input.policyId,
      start: input.start,
      end: input.end,
      hours: input.hours,
      note: input.note,
    }),
  decideTimeOff: (http) => (id, decision) => http.request<PtoRequest>("POST", `/pto-requests/${id}/decision`, decision),
  cancelTimeOff: (http) => (id) => http.request<PtoRequest>("POST", `/pto-requests/${id}/cancel`),
  adjustTimeOff: (http) => async (input) => {
    await http.request<TimeOffEntry>("POST", "/time-off-adjustments", {
      employeeId: input.employeeId,
      policyId: input.policyId,
      hours: input.hours,
      note: input.note,
    });
  },
  saveTimeOffPolicy:
    (http) =>
    ({ id, ...policy }) =>
      isSaved(id)
        ? http.request<TimeOffPolicy>("PUT", `/time-off-policies/${id}`, policy)
        : http.request<TimeOffPolicy>("POST", "/time-off-policies", policy),
  // HR part 2 (ADR 0047): pay periods. Bonuses and contractor payments have API routes but no screen yet.
  listPayPeriods: (http) => async () => {
    // Listing opens the period holding today, as the demo does (hr.md "Pay periods", Create). A
    // company that can't write (read-only, no pay schedule yet) still lists what it has.
    await http.request<PayPeriod>("POST", "/pay-periods", {}).catch((failure: unknown) => {
      if (!(failure instanceof HttpApiError) || failure.status < 400 || failure.status >= 500) throw failure;
    });
    return http.request<PayPeriod[]>("GET", "/pay-periods");
  },
  reviewPayPeriod: (http) => (id) => http.request<PayPeriodReview>("GET", `/pay-periods/${id}/review`),
  setPayExclusion: (http) => async (id, employeeId, reason) => {
    await http.request<PayPeriod>("POST", `/pay-periods/${id}/exclusions`, { employeeId, reason });
  },
  approvePayPeriod: (http) => (id) => http.request<PayPeriod>("POST", `/pay-periods/${id}/approve`),
  reopenPayPeriod: (http) => (id) => http.request<PayPeriod>("POST", `/pay-periods/${id}/reopen`),
  exportPayPeriod: (http) => (id) => http.request<PayPeriod>("POST", `/pay-periods/${id}/export`),
  // The employee portal (ADR 0049): the signed-in person's own data only, from the session. My
  // meetings is `myMeetings` in the meetings block below (ADR 0051 "Part 3").
  myPortal: (http) => async () => {
    const { ownPayRate, employee, ...portal } = await http.request<MyPortalWire>("GET", "/me/portal");
    // Hours travel as decimal strings; the screens' Timesheet reads numbers (ADR 0046). One's own
    // rate travels apart from the record, so the API's sensitive-field strip leaves it (ADR 0049).
    return {
      ...portal,
      employee: employee ? ({ ...employee, payRate: ownPayRate ?? "" } as Employee) : null,
      timesheets: portal.timesheets.map(timesheetFromWire),
    };
  },
  updateMyEmployeeProfile: (http) => (patch) =>
    http.request<Employee>("PATCH", "/me/employee", { phone: patch.phone, emergencyContact: patch.emergencyContact }),
  acknowledgePlan: (http) => async (assignmentId, signedName, plan) => {
    await http.request<{ ok: true }>("POST", `/commission-assignments/${assignmentId}/acknowledge`, {
      signedName,
      planId: plan.id,
      planVersion: plan.version,
      planUpdatedAt: plan.updatedAt,
    });
  },
  clockIn: (http) => async () => {
    await http.request<unknown>("POST", "/clock/in");
  },
  clockOut: (http) => async () => {
    await http.request<unknown>("POST", "/clock/out");
  },
  // Meetings (ADR 0051 part 3): the Meetings page, its drawer and dialogs, and My meetings. Every
  // write goes through `wrote`, so the screens read again. `simulateReply`, `list` and `get` of
  // "meetings" (Simulate reply reads the demo Outbox's rows) and `updateSettings("meetings")` (the
  // page is hidden in api mode until part 4) stay on DemoStore.
  meetingsData: (http) => async () => {
    // Colleagues come only when a request can be sent and answered, as GET /me/meetings gives them.
    const asks = featureOn("meetings.requests") && featureOn("meetings.invites");
    const [meetings, guests, mine] = await Promise.all([
      http.request<Meeting[]>("GET", "/meetings"),
      // Without meetings.meeting.create (403) or with meetings.invites off (404): nobody to invite.
      seenOrOff(http.request<GuestOption[]>("GET", "/meeting-guests")),
      asks ? orNone(http.request<MyMeetings>("GET", "/me/meetings")) : Promise.resolve(null),
    ]);
    // The reader's id is the server's, never the demo persona's (S15); asked for only when needed.
    const viewerUserId = mine?.viewerUserId ?? (await http.request<SessionContext>("GET", "/auth/context")).user.id;
    return { viewerUserId, meetings, guests, colleagues: mine?.colleagues ?? [], newGuestHandling: "none" };
  },
  // No portal key, the module off (403), or meetings.calendar or hr.portal off (404): nothing to show.
  myMeetings: (http) => async () =>
    (await orNone(http.request<MyMeetings>("GET", "/me/meetings"))) ?? {
      viewerUserId: "",
      meetings: [],
      colleagues: [],
    },
  createMeeting: (http, _demo, changed) => (input) =>
    wrote(changed, http.request<Meeting>("POST", "/meetings", meetingBody(input))),
  updateMeeting: (http, _demo, changed) => (id, patch) =>
    wrote(changed, http.request<Meeting>("PATCH", `/meetings/${encodeURIComponent(id)}`, patchBody(patch))),
  cancelMeeting: (http, _demo, changed) => (id) =>
    wrote(changed, http.request<Meeting>("POST", `/meetings/${encodeURIComponent(id)}/cancel`)),
  removeGuest: (http, _demo, changed) => (meetingId, attendeeId) =>
    wrote(
      changed,
      http.request<Meeting>(
        "DELETE",
        `/meetings/${encodeURIComponent(meetingId)}/attendees/${encodeURIComponent(attendeeId)}`,
      ),
    ),
  respondToMeeting: (http, _demo, changed) => (id, reply) =>
    wrote(
      changed,
      http.request<Meeting>("POST", `/meetings/${encodeURIComponent(id)}/response`, {
        partStat: reply.partStat,
        note: reply.note,
        proposal: reply.proposal
          ? { start: reply.proposal.start, durationMin: reply.proposal.durationMin, note: reply.proposal.note }
          : null,
      }),
    ),
  decideProposal: (http, _demo, changed) => (meetingId, attendeeId, accept) =>
    wrote(
      changed,
      http.request<Meeting>(
        "POST",
        `/meetings/${encodeURIComponent(meetingId)}/attendees/${encodeURIComponent(attendeeId)}/proposal`,
        { accept },
      ),
    ),
  // The server fixes a request's length and place (MEETING_REQUEST_DEFAULTS), so they are not sent.
  requestMeeting: (http, _demo, changed) => (input) =>
    wrote(
      changed,
      http.request<Meeting>("POST", "/meeting-requests", {
        withUserId: input.withUserId,
        title: input.title,
        start: input.start,
        note: input.note,
        private: input.private,
      }),
    ),
  meetingCalendarFile: (http) => (id) =>
    http.request<{ fileName: string; text: string }>("GET", `/meetings/${encodeURIComponent(id)}/calendar.ics`),
  rescheduleMeeting: (http, _demo, changed) => (move) =>
    wrote(
      changed,
      http.request<{ meetings: Meeting[]; conflicts: Conflict[]; undo: MeetingUndo }>(
        "POST",
        `/meetings/${encodeURIComponent(move.meetingId)}/reschedule`,
        {
          meetingId: move.meetingId,
          planned: move.planned,
          start: move.start,
          durationMin: move.durationMin,
          scope: move.scope,
        },
      ),
    ),
  // Only the SEQUENCE the screen saw: the API rebuilds the meeting from its own record (critic B3).
  undoReschedule: (http, _demo, changed) => (undo) =>
    wrote(
      changed,
      http.request<Meeting>("POST", `/meetings/${encodeURIComponent(undo.previous.id)}/reschedule/undo`, {
        sequence: undo.previous.sequence,
      }),
    ),
};

/**
 * A new meeting as the API takes it (ADR 0051 "Part 3"): only what the server reads. A picked guest
 * travels as its kind and id and a new guest as an address and a name, so no name, address, answer
 * or "save under customer" a screen holds is ever sent; the server resolves who each guest is and
 * adds the organiser itself.
 */
function meetingBody(input: MeetingInput) {
  return {
    title: input.title,
    start: input.start,
    durationMin: input.durationMin,
    location: input.location,
    notes: input.notes,
    recurrence: input.recurrence,
    reminderMin: input.reminderMin,
    private: input.private,
    hideGuestList: input.hideGuestList,
    guests: input.guests.map(({ kind, id }) => ({ kind, id })),
    newGuests: input.newGuests.map(({ email, name }) => ({ email, name })),
  };
}

/** An edit as the API takes it (meetings.md rule 6): only the patch's six fields, and only those the screen set. */
function patchBody(patch: MeetingPatch): MeetingPatch {
  const body: MeetingPatch = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.start !== undefined) body.start = patch.start;
  if (patch.durationMin !== undefined) body.durationMin = patch.durationMin;
  if (patch.reminderMin !== undefined) body.reminderMin = patch.reminderMin;
  return body;
}

/** Statuses that mean the server answered and the screen may be stale (S2): a refusal reads the meeting again. */
const ANSWERED_REFUSALS = new Set([400, 403, 404, 409]);

/**
 * A routed meetings write (ADR 0051 "Part 3"): the screens read again after it succeeds, and after
 * the server refuses it, since a refusal often means the screen showed something stale. A request
 * that never reached the server, a 401, a 429 or a server failure triggers no re-read.
 */
async function wrote<T>(changed: () => void, request: Promise<T>): Promise<T> {
  try {
    const saved = await request;
    changed();
    return saved;
  } catch (failure) {
    if (failure instanceof HttpApiError && ANSWERED_REFUSALS.has(failure.status)) changed();
    throw failure;
  }
}

/**
 * An answer the person may not have: 403 (no key, or the module off) or 404 (a switched-off
 * feature) is null, so the caller falls back. A network error or a server failure still throws.
 */
async function orNone<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (failure) {
    if (failure instanceof HttpApiError && (failure.status === 403 || failure.status === 404)) return null;
    throw failure;
  }
}

/**
 * The portal as the API sends it: timesheet hours as decimal strings, and the record without the
 * pay rate, which comes as `ownPayRate` when the company shows it (ADR 0049).
 */
type MyPortalWire = Omit<MyPortal, "timesheets" | "employee"> & {
  timesheets: TimesheetWire[];
  employee: Omit<Employee, "payRate"> | null;
  ownPayRate: string | null;
};

/**
 * A person as the API takes it: only the form's fields, since an edit starts from the whole stored
 * record. A pay rate the person can't see never arrived, so it is left out and the stored one is
 * kept (CLAUDE.md rule 5).
 */
function employeeBody(input: EmployeeInput) {
  return {
    name: input.name,
    title: input.title,
    department: input.department,
    workerType: input.workerType,
    payType: input.payType,
    ...(typeof input.payRate === "string" ? { payRate: input.payRate } : {}),
    state: input.state,
    email: input.email,
    phone: input.phone,
    hiredAt: input.hiredAt,
    status: input.status,
    managerId: input.managerId,
    flsaStatus: input.flsaStatus,
    exemptionBasis: input.exemptionBasis,
    salaryHoursPerWeek: input.salaryHoursPerWeek,
    commissionVisible: input.commissionVisible,
    homeLocationId: input.homeLocationId,
    emergencyContact: input.emergencyContact,
  };
}

/**
 * A contract as the API takes it: only the form's fields, since an edit starts from the whole
 * stored contract. The rep is always the creator on the server, and an estimated cost the person
 * can't see is left out so the stored one is kept (ADR 0044).
 */
function contractBody(input: ContractInput) {
  return {
    direction: input.direction,
    kind: input.kind,
    customerId: input.customerId || null,
    supplierId: input.supplierId || null,
    title: input.title,
    scope: input.scope,
    branchId: input.branchId || null,
    locationId: input.locationId,
    jobSite: input.jobSite,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    renewal: input.renewal,
    retainagePct: input.retainagePct,
    storedRetainagePct: input.storedRetainagePct,
    bondInLieu: input.bondInLieu,
    taxTreatment: input.taxTreatment,
    notes: input.notes,
    lines: input.lines.map((line) => ({
      code: line.code,
      description: line.description,
      category: line.category,
      billing: line.billing,
      scheduledValue: line.scheduledValue,
      retainagePct: line.retainagePct,
      storedRetainagePct: line.storedRetainagePct,
      milestoneDueAt: line.milestoneDueAt,
      ...(line.estimatedCost === undefined ? {} : { estimatedCost: line.estimatedCost }),
    })),
  };
}

/**
 * A change of company access as the API takes it (spec "PlatformAccessPatch"): only the four fields,
 * and only those the screen set, so nothing else on the object travels and a part left out stays
 * as it is. The API's schema is strict and refuses anything more.
 */
function accessPatchBody(patch: PlatformAccessPatch): PlatformAccessPatch {
  const body: PlatformAccessPatch = {};
  if (patch.modules !== undefined) body.modules = [...patch.modules];
  if (patch.ceiling !== undefined) body.ceiling = [...patch.ceiling];
  if (patch.userLimit !== undefined) body.userLimit = patch.userLimit;
  if (patch.branchLimit !== undefined) body.branchLimit = patch.branchLimit;
  return body;
}

/**
 * The audit log's query string (spec "ApiClient (part 3)"): only the fields that are set, in the
 * order companyId, action, before, limit. Null when the company or the cursor is not a UUID, since
 * such an id names no entry on the API and the page is then empty.
 */
function auditQueryParams(query: PlatformAuditQuery): URLSearchParams | null {
  if ([query.companyId, query.before].some((id) => id !== undefined && !isSaved(id))) return null;
  const params = new URLSearchParams();
  if (query.companyId !== undefined) params.set("companyId", query.companyId);
  if (query.action !== undefined) params.set("action", query.action);
  if (query.before !== undefined) params.set("before", query.before);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return params;
}

/**
 * A support request as the API takes it (spec "POST /platform/support-grants", Body): only the
 * three fields, rebuilt, so nothing else on the object travels. The API's schema is strict.
 */
function supportRequestBody(input: SupportRequestInput): SupportRequestInput {
  return { companyId: input.companyId, reason: input.reason, hours: input.hours };
}

/** A list the person may not see (403) comes back empty, as the demo hides what a role cannot open. */
async function seen<T>(list: Promise<T[]>): Promise<T[]> {
  try {
    return await list;
  } catch (failure) {
    if (failure instanceof HttpApiError && failure.status === 403) return [];
    throw failure;
  }
}

/** Like `seen`, and a switched-off feature's 404 is an empty list too (CLAUDE.md rule 13). */
async function seenOrOff<T>(list: Promise<T[]>): Promise<T[]> {
  try {
    return await seen(list);
  } catch (failure) {
    if (failure instanceof HttpApiError && failure.status === 404) return [];
    throw failure;
  }
}

/** Proof files as the API takes them: each name with its bytes in base64 (ADR 0038). */
async function encodeFiles(files: readonly File[]): Promise<{ name: string; data: string }[]> {
  return Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      }
      return { name: file.name, data: btoa(binary) };
    }),
  );
}

/** An id the API made (a UUID); a draft from the screen or a demo record has another kind of id. */
function isSaved(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * The Owner's decision on a support grant (spec part 4, "ApiClient (part 4)"). An id that isn't a
 * UUID names no grant on the API, so nothing is sent and the call fails with the API's own words
 * for a closed grant.
 */
async function supportGrantDecision(http: HttpTransport, grantId: string, step: SupportGrantStep): Promise<void> {
  if (!isSaved(grantId)) throw new ApiError(SUPPORT_CLOSED_MESSAGES[step]);
  await http.request<void>("POST", `/support-grants/${encodeURIComponent(grantId)}/${step}`);
}
