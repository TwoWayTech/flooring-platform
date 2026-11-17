import { DemoRuleError } from "./admin-rules";
import {
  defaultWastePct,
  sameOptionalDecimal,
  savedQuoteLine,
  type CompanySettings,
  type PermissionKey,
  type Product,
  type Quote,
  type Roll,
  type WasteCategory,
} from "@workspace/shared";
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
  // Reservations and adjustments change only through their own store calls (spec C1, C2).
  reservations: [],
  stockAdjustments: [],
  customers: ["customers.customer.create", "customers.customer.edit"],
  quotes: ["sales.quote.create", "sales.quote.edit"],
  invoices: ["sales.invoice.create", "sales.invoice.edit"],
  // Payments, credits, write-offs and refunds change only through their own store calls (spec Appendix A).
  payments: [],
  invoiceAdjustments: [],
  refunds: [],
  suppliers: ["purchasing.supplier.create", "purchasing.supplier.edit"],
  // Contacts change only through their own store calls (spec B1).
  supplierContacts: [],
  purchaseOrders: [],
  bills: [],
  // Receipts, bills and supplier payments change only through their own store calls (spec D2, D3).
  receipts: [],
  supplierPayments: [],
  // Expenses change only through their own store calls (spec F1).
  expenses: [],
  recurringExpenses: [],
  // Contract records change only through their own store calls (spec D2).
  contracts: [],
  contractLines: [],
  changeOrders: [],
  contractBillings: [],
  lienWaivers: [],
  insuranceCertificates: [],
  crews: ["installation.crew.manage"],
  jobs: ["installation.job.create", "installation.job.edit", "installation.job.schedule", "installation.job.sign_off"],
  // HR records change only through their own store calls (spec C1, C2).
  employees: [],
  timesheets: [],
  ptoRequests: [],
  timeOffPolicies: [],
  timeOffEntries: [],
  clockEntries: [],
  payPeriods: [],
  bonuses: ["hr.payroll.approve"],
  contractorPayments: [],
  commissionPlans: [],
  commissionAssignments: [],
  commissionStatements: [],
  commissionAdjustments: [],
  // Meetings change only through their own store calls, which send the invites (spec E).
  meetings: [],
  meetingResponses: [],
  customerContacts: [],
  audit: [],
  // Imports and saved mappings change only through the import calls (spec G1).
  importBatches: [],
  importMappings: [],
  // Notifications change only through their own store calls (spec A4).
  notificationRules: [],
  outboxMessages: [],
  inAppNotifications: [],
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
  payments: ["settings.payments.manage"],
  inventory: ["settings.locations.manage"],
  expenses: ["settings.expenses.manage"],
  sharedCosts: ["settings.expenses.manage"],
  hr: ["settings.hr.manage"],
  meetings: ["settings.meetings.manage"],
  email: ["settings.notifications.manage"],
};

/** Permissions that allow changing one settings section. */
export function settingsPermissions(section: keyof CompanySettings): readonly PermissionKey[] {
  return SETTINGS_PERMISSIONS[section];
}

/**
 * Whether a line's waste differs from what it had (sales.md rule 8). DemoStore keeps waste as
 * typed, and the inputs only drop characters other than digits and points, so it can hold "12."
 * or ".5": the same text is never a change. Other text is compared by value, plain decimal text
 * only, so odd text still reads as a change (`sameOptionalDecimal`; STATUS B6, review round 2).
 */
function wasteDiffers(had: string, sent: string): boolean {
  return had !== sent && !sameOptionalDecimal(had, sent);
}

/**
 * Whether a save changes waste % (spec B3: only with sales.waste.view): a line that was saved
 * keeps its waste unless the person may see it; a new line must carry the company default. A saved
 * line is the same line only with the same id and product (`savedQuoteLine`); waste is compared by
 * value, as in the API's `assertWaste` (`wasteDiffers`; STATUS B6).
 */
export function wasteChanged(
  quote: Pick<Quote, "lines">,
  before: Pick<Quote, "lines"> | undefined,
  products: readonly Product[],
  defaults: Record<WasteCategory, string>,
): boolean {
  return quote.lines.some((line) => {
    if (line.wastePct === undefined) return false;
    const saved = savedQuoteLine(before?.lines, line);
    if (saved) return wasteDiffers(saved.wastePct ?? "0", line.wastePct);
    const product = products.find((p) => p.id === line.productId);
    return !!product && wasteDiffers(defaultWastePct(product, defaults) ?? "0", line.wastePct);
  });
}

/**
 * Rolls are edited only for their bin and labels (spec C1: no free editing of stock): length,
 * cuts and warehouse change only through invoices, adjustments and transfers.
 */
export function assertRollEditOnly(before: Roll | undefined, after: Roll) {
  if (!before) throw new DemoRuleError("New rolls arrive through a purchase receipt.");
  const changed =
    before.remainingLengthFt !== after.remainingLengthFt ||
    before.locationId !== after.locationId ||
    before.cuts.length !== after.cuts.length;
  if (changed)
    throw new DemoRuleError("Stock changes through an invoice, a receipt, a transfer or a stock adjustment.");
}
