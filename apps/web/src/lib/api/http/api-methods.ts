import type {
  Customer,
  GoodsReceipt,
  Invoice,
  InvoiceAdjustment,
  Location,
  Payment,
  Refund,
  Reservation,
  Product,
  PurchaseOrder,
  Quote,
  Role,
  Roll,
  StockAdjustment,
  StockMovement,
  Supplier,
  SupplierContact,
  Transfer,
  User,
} from "@workspace/shared";
import { HttpApiError } from "./transport";
import type { CollectionName, Collections, ItemOf } from "../contract";
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
  // Files the API stored have UUIDs; expense, contract and employee files are still the demo's.
  getFile: (http, demo) => (fileId) => (isSaved(fileId) ? http.blob(`/files/${fileId}`) : demo.getFile(fileId)),
  purchasingData: (http) => async () => {
    const [suppliers, contacts, purchaseOrders, receipts, products, locations] = await Promise.all([
      seen(http.request<Supplier[]>("GET", "/suppliers")),
      seen(http.request<SupplierContact[]>("GET", "/supplier-contacts")),
      seen(http.request<PurchaseOrder[]>("GET", "/purchase-orders")),
      seen(http.request<GoodsReceipt[]>("GET", "/receipts")),
      seen(http.request<Product[]>("GET", "/products")),
      seen(http.request<Location[]>("GET", "/locations")),
    ]);
    // Bills and supplier payments post to the ledger, so they move with P12 (ADR 0036).
    return { suppliers, contacts, purchaseOrders, receipts, products, locations, bills: [], supplierPayments: [] };
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
  // The Ready to cut list moves with cut and issue in inventory part 2 (ADR 0038).
  listStockHolds: () => async () => [],
};

/** A list the person may not see (403) comes back empty, as the demo hides what a role cannot open. */
async function seen<T>(list: Promise<T[]>): Promise<T[]> {
  try {
    return await list;
  } catch (failure) {
    if (failure instanceof HttpApiError && failure.status === 403) return [];
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
