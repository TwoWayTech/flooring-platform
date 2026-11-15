import { featureOn, FEATURES, type FeatureRegister } from "../features";
import type { PermissionKey } from "../permissions/catalog";
import type { ModuleKey } from "../products";

/** What the guest readers need of a person's access: their enabled modules and effective keys. */
export interface GuestReaderAccess {
  modules: readonly ModuleKey[];
  permissions: ReadonlySet<PermissionKey>;
}

/**
 * Whether a person may read customers and the people at them as meeting guests: the `core` module,
 * `customers.customer.view` and the `sales.customers` switch (sales.md "Who uses it"; CLAUDE.md rule
 * 13). Each customer is then checked against their data scope. `register` is for tests.
 */
export function readsCustomerGuests(access: GuestReaderAccess, register: FeatureRegister = FEATURES): boolean {
  return (
    access.modules.includes("core") &&
    access.permissions.has("customers.customer.view") &&
    featureOn("sales.customers", register)
  );
}

/**
 * Whether a person may read suppliers and the people at them as meeting guests: the `core` module,
 * `purchasing.supplier.view` and the `purchasing.suppliers` switch (purchasing.md). `register` is for tests.
 */
export function readsSupplierGuests(access: GuestReaderAccess, register: FeatureRegister = FEATURES): boolean {
  return (
    access.modules.includes("core") &&
    access.permissions.has("purchasing.supplier.view") &&
    featureOn("purchasing.suppliers", register)
  );
}
