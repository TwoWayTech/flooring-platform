import type { PermissionKey } from "./catalog";
import { holdsAny } from "./engine";

/**
 * The API's list reads the web makes, each with the permissions its route requires, any one of
 * them (`@RequirePermission` on apps/api's GET route; an empty list is `@AnyCompanyMember`). The
 * screens check a person's effective permissions against this before they ask, so normal
 * navigation sends no read the API would refuse (click-through finding #28). The API still decides:
 * this only saves the request. A test compares every entry with the API's route snapshot
 * (apps/api/test/__snapshots__/route-requirements.json), so the two never drift.
 */
export const LIST_READS = {
  "/audit": ["settings.audit.view"],
  "/bills": ["purchasing.bill.view"],
  "/bonuses": ["hr.payroll.view"],
  "/change-orders": ["contracts.contract.view"],
  "/contract-billings": ["contracts.billing.view"],
  "/contract-lines": ["contracts.contract.view"],
  "/contractor-payments": ["hr.payroll.view"],
  "/commissions": ["hr.commission.view"],
  "/contracts": ["contracts.contract.view"],
  "/customers": ["customers.customer.view"],
  "/employees": ["hr.employee.view", "hr.timesheet.view", "hr.pto.view", "settings.hr.manage"],
  "/expenses": ["finance.expense.view"],
  "/insurance-certificates": ["contracts.compliance.view"],
  "/invoice-adjustments": ["sales.invoice.view"],
  "/invoices": ["sales.invoice.view"],
  "/lien-waivers": ["contracts.compliance.view"],
  "/locations": [],
  "/meeting-guests": ["meetings.meeting.create"],
  "/pay-periods": ["hr.payroll.view"],
  "/payments": ["sales.payment.view", "sales.payment.approve"],
  "/products": ["inventory.product.view"],
  "/pto-requests": ["hr.pto.view"],
  "/purchase-orders": ["purchasing.order.view"],
  "/quotes": ["sales.quote.view"],
  "/receipts": ["purchasing.order.view"],
  "/recurring-expenses": ["finance.expense.view"],
  "/refunds": ["sales.payment.view", "sales.payment.refund"],
  "/reservations": ["inventory.product.view", "inventory.roll.view", "sales.invoice.view"],
  "/rolls": ["inventory.roll.view"],
  "/stock-holds": ["inventory.roll.view", "inventory.product.view"],
  "/stock-movements": ["inventory.product.view"],
  "/supplier-contacts": ["purchasing.supplier.view"],
  "/supplier-payments": ["purchasing.bill.view", "purchasing.payment.record", "purchasing.payment.approve"],
  "/suppliers": ["purchasing.supplier.view"],
  "/time-off-entries": ["hr.pto.view"],
  "/time-off-policies": ["hr.pto.view", "hr.employee.view", "settings.hr.manage"],
  "/timesheets": ["hr.timesheet.view"],
  "/transfers": ["inventory.transfer.view"],
} as const satisfies Record<string, readonly PermissionKey[]>;

/** A list read the web makes (a key of LIST_READS). */
export type ListReadPath = keyof typeof LIST_READS;

/**
 * Whether a person with these effective permissions may make a list read: any one of the route's
 * keys, as PermissionGuard decides (`holdsAny`); a read for every member is always allowed.
 */
export function mayReadList(path: ListReadPath, held: ReadonlySet<PermissionKey>): boolean {
  const keys: readonly PermissionKey[] = LIST_READS[path];
  return keys.length === 0 || holdsAny(held, keys);
}
