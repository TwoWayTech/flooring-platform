import type { Location, Product, Role, Roll, StockAdjustment, StockMovement, Transfer, User } from "@workspace/shared";
import { HttpApiError } from "./transport";
import type { CollectionName, Collections, ItemOf } from "../contract";
import type { HttpRoutes } from "./router";

/**
 * Collections the real API lists through `list`, with their endpoints (docs/api-contract.md).
 * Users and roles are not here: many screens read them for names and pickers next to demo
 * records, so Settings reads them through its own methods instead (ADR 0034).
 */
const SERVED_LISTS: Partial<Record<CollectionName, string>> = {
  audit: "/audit",
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
      return path ? http.request<Collections[K]>("GET", path) : demo.list(collection);
    },
  get:
    (http, demo) =>
    async <K extends CollectionName>(collection: K, id: string) => {
      const path = SERVED_LISTS[collection];
      if (!path) return demo.get(collection, id);
      const all = await http.request<ItemOf<K>[]>("GET", path);
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
    const [products, rolls, stockMovements, locations, transfers] = await Promise.all([
      seen(http.request<Product[]>("GET", "/products")),
      seen(http.request<Roll[]>("GET", "/rolls")),
      seen(http.request<StockMovement[]>("GET", "/stock-movements")),
      seen(http.request<Location[]>("GET", "/locations")),
      seen(http.request<Transfer[]>("GET", "/transfers")),
    ]);
    // Reservations and adjustments come from invoices, which move with sales (ADR 0035).
    return { products, rolls, stockMovements, locations, transfers, reservations: [], stockAdjustments: [] };
  },
  moveRoll: (http) => (rollId, bin) => http.request<Roll>("PATCH", `/rolls/${rollId}`, { bin }),
  createTransfer: (http) => (input) => http.request<Transfer>("POST", "/transfers", input),
  receiveTransfer: (http) => (transferId) => http.request<Transfer>("POST", `/transfers/${transferId}/receive`),
  correctStockCount: (http) => (input) => http.request<StockAdjustment>("POST", "/stock/corrections", input),
  // Holds are made by invoices, which move with sales; until then the real API has none.
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

/** A role id the API made (a UUID); a draft role from the screen has a temporary id. */
function isSaved(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
