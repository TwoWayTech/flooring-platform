import type { CompanySettings, PermissionKey } from "@workspace/shared";
import type { CollectionName } from "../contract";

/**
 * Who may write each collection through the generic `save` (spec section 0.4: permission checks
 * in the save logic, not only in the UI). Any one listed key is enough. Collections written only
 * by domain actions or by the store itself list nothing a role can hold, so `save` refuses them.
 */
const SAVE_PERMISSIONS: Record<CollectionName, readonly PermissionKey[]> = {
  roles: ["settings.roles.manage"],
  users: ["settings.users.manage"],
  locations: ["settings.locations.manage"],
  products: ["inventory.product.create", "inventory.product.edit"],
  rolls: ["inventory.roll.edit"],
  stockMovements: [],
  transfers: [],
  customers: ["customers.customer.create", "customers.customer.edit"],
  quotes: ["sales.quote.create", "sales.quote.edit"],
  invoices: ["sales.invoice.create", "sales.invoice.edit"],
  payments: ["sales.payment.record"],
  suppliers: ["purchasing.supplier.create", "purchasing.supplier.edit"],
  purchaseOrders: ["purchasing.order.create"],
  bills: ["purchasing.bill.create"],
  billPayments: ["purchasing.payment.record"],
  expenses: [],
  crews: ["installation.crew.manage"],
  jobs: ["installation.job.create", "installation.job.edit", "installation.job.schedule", "installation.job.sign_off"],
  employees: ["hr.employee.create", "hr.employee.edit"],
  timesheets: ["hr.timesheet.edit", "hr.timesheet.approve"],
  ptoRequests: ["hr.pto.request", "hr.pto.approve"],
  commissions: [],
  meetings: ["meetings.meeting.create", "meetings.meeting.edit"],
  audit: [],
};

/** Permissions that allow a generic save to a collection; empty means no role may. */
export function savePermissions(collection: CollectionName): readonly PermissionKey[] {
  const keys = SAVE_PERMISSIONS[collection];
  return keys.length > 0 ? keys : NOBODY;
}

/** A key no role holds, so a collection with no writers refuses every generic save. */
const NOBODY: readonly PermissionKey[] = ["store.internal.manage"];

const SETTINGS_PERMISSIONS: Record<keyof CompanySettings, readonly PermissionKey[]> = {
  branding: ["settings.branding.manage"],
  localization: ["settings.localization.manage", "settings.tax.manage"],
  numbers: ["settings.numbers.manage"],
  profile: ["settings.company.manage"],
};

/** Permissions that allow changing one settings section. */
export function settingsPermissions(section: keyof CompanySettings): readonly PermissionKey[] {
  return SETTINGS_PERMISSIONS[section];
}
