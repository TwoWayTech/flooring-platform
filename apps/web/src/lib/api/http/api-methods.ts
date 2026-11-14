import type {
  Bill,
  ChangeOrder,
  Contract,
  ContractBilling,
  ContractLine,
  Customer,
  Expense,
  GoodsReceipt,
  InsuranceCertificate,
  Invoice,
  InvoiceAdjustment,
  LienWaiver,
  Location,
  Payment,
  Refund,
  Reservation,
  Product,
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
  Transfer,
  User,
} from "@workspace/shared";
import { HttpApiError } from "./transport";
import type { CollectionName, Collections, ContractInput, ItemOf, StockHold } from "../contract";
import type { HttpRoutes } from "./router";

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
  // Files the API stored have UUIDs (payments, refunds, expenses, bills, contracts); employee files are still the demo's.
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
  // Contracts part 1 (ADR 0044): the register, change orders, waivers and insurance. Billing writes are part 2.
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
      seen(http.request<ChangeOrder[]>("GET", "/change-orders")),
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
};

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
