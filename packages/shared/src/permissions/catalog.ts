import type { ModuleKey } from "../products";

/** Actions a permission can grant; the columns of the security-roles matrix. */
export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "export"
  | "manage"
  | "cut"
  | "receive"
  | "pay"
  | "void"
  | "schedule"
  | "sign_off"
  | "request"
  | "measure"
  | "record"
  | "refund"
  | "write_off"
  | "apply_credit"
  | "override"
  | "adjust"
  | "correct"
  | "view_sensitive";

/**
 * A permission key written `module.resource.action` (blueprint "Four layers of control"),
 * for example `sales.invoice.create`.
 */
export type PermissionKey = `${string}.${string}.${PermissionAction}`;

/** One entry of the permission catalog. */
export interface PermissionDef {
  key: PermissionKey;
  /** The module that must be enabled for this permission to take effect. */
  module: ModuleKey;
  /** Resource label shown as a row group in the matrix. */
  resource: string;
  action: PermissionAction;
  label: string;
}

/** Shorthand rows: [area.resource, module, resource label, actions]. */
type Row = [string, ModuleKey, string, PermissionAction[]];

const ROWS: Row[] = [
  ["dashboard.overview", "core", "Dashboard", ["view"]],
  ["sales.quote", "core", "Quotes", ["view", "create", "edit", "delete", "approve"]],
  ["sales.invoice", "core", "Invoices", ["view", "create", "edit", "void", "export"]],
  [
    "sales.payment",
    "core",
    "Customer payments",
    ["view", "record", "approve", "void", "refund", "write_off", "apply_credit"],
  ],
  ["sales.tax", "core", "Document sales tax", ["override"]],
  ["sales.waste", "core", "Waste allowance", ["view"]],
  ["sales.commission", "core", "Commissions", ["view", "manage"]],
  ["sales.margin", "core", "Margins", ["view_sensitive"]],
  ["customers.customer", "core", "Customers", ["view", "create", "edit", "delete", "export", "view_sensitive"]],
  ["inventory.product", "core", "Products", ["view", "create", "edit", "delete", "export", "view_sensitive"]],
  ["inventory.roll", "core", "Rolls", ["view", "cut", "edit"]],
  ["inventory.stock", "core", "Stock adjustments", ["adjust", "approve"]],
  ["inventory.stock", "core", "Stock count", ["correct"]],
  ["inventory.transfer", "core", "Warehouse transfers", ["view", "create", "receive"]],
  ["inventory.reservation", "core", "Stock reservations", ["override"]],
  ["purchasing.supplier", "core", "Suppliers", ["view", "create", "edit"]],
  ["purchasing.order", "core", "Purchase orders", ["view", "create", "approve", "receive"]],
  ["purchasing.bill", "core", "Supplier bills", ["view", "create"]],
  ["purchasing.payment", "core", "Supplier payments", ["record", "approve", "void"]],
  ["finance.expense", "core", "Expenses", ["view", "create", "approve", "void", "export"]],
  ["reports.sales", "core", "Sales reports", ["view", "export"]],
  ["reports.financial", "core", "Financial reports", ["view", "export"]],
  ["reports.inventory", "core", "Inventory reports", ["view", "export"]],
  ["reports.tax", "core", "Sales tax reports", ["view", "export"]],
  ["retail.room", "retail", "Room measurements", ["measure"]],
  ["retail.sample", "retail", "Sample checkout", ["view", "create"]],
  ["wholesale.price_list", "wholesale", "Price lists", ["view", "manage"]],
  ["wholesale.certificate", "wholesale", "Resale certificates", ["view", "manage"]],
  ["wholesale.credit", "wholesale", "Credit limit overrides", ["approve"]],
  ["installation.job", "installation", "Jobs", ["view", "create", "schedule", "edit", "sign_off", "view_sensitive"]],
  ["installation.crew", "installation", "Crews and subcontractors", ["view", "manage"]],
  ["contracts.contract", "contracts", "Contracts", ["view", "create", "edit", "approve", "view_sensitive"]],
  ["contracts.billing", "contracts", "Progress billing", ["view", "create", "void"]],
  ["contracts.change_order", "contracts", "Change orders", ["create", "approve"]],
  ["contracts.compliance", "contracts", "Contract compliance", ["view", "manage"]],
  ["hr.overview", "hr", "HR dashboard", ["view"]],
  ["hr.employee", "hr", "Employees", ["view", "create", "edit", "view_sensitive"]],
  ["hr.timesheet", "hr", "Timesheets", ["view", "edit", "approve"]],
  ["hr.pto", "hr", "Time off", ["view", "request", "approve"]],
  ["hr.commission", "hr", "Commission plans", ["view", "manage", "approve", "adjust"]],
  ["hr.payroll", "hr", "Pay periods", ["view", "approve", "export"]],
  ["meetings.meeting", "meetings", "Meetings", ["view", "create", "edit", "delete"]],
  ["settings.users", "platform", "Users", ["view", "manage"]],
  ["settings.roles", "platform", "Security roles", ["view", "manage"]],
  ["settings.branding", "platform", "Branding", ["manage"]],
  ["settings.localization", "platform", "Localization", ["manage"]],
  ["settings.tax", "platform", "Sales tax", ["manage"]],
  ["settings.numbers", "platform", "Number format", ["manage"]],
  ["settings.company", "platform", "Company profile", ["manage"]],
  ["settings.payments", "platform", "Payment settings", ["manage"]],
  ["settings.locations", "core", "Warehouses and showrooms", ["manage"]],
  ["settings.expenses", "core", "Expense settings", ["manage"]],
  ["settings.notifications", "platform", "Email and notifications", ["manage"]],
  ["settings.outbox", "platform", "Outbox", ["view"]],
  ["settings.hr", "hr", "HR settings", ["manage"]],
  ["settings.meetings", "meetings", "Meeting settings", ["manage"]],
  ["settings.import", "platform", "Data import", ["manage"]],
  ["settings.audit", "platform", "Audit log", ["view"]],
];

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  export: "Export",
  manage: "Manage",
  cut: "Cut",
  receive: "Receive",
  pay: "Pay",
  void: "Void",
  schedule: "Schedule",
  sign_off: "Sign off",
  request: "Request",
  measure: "Measure",
  record: "Record",
  refund: "Refund",
  write_off: "Write off",
  apply_credit: "Apply credit",
  override: "Override",
  adjust: "Adjust",
  correct: "Correct",
  view_sensitive: "View sensitive",
};

/** The full permission catalog, generated from the rows above. */
export const PERMISSIONS: readonly PermissionDef[] = ROWS.flatMap(([base, module, resource, actions]) =>
  actions.map((action) => ({
    key: `${base}.${action}` as PermissionKey,
    module,
    resource,
    action,
    label: `${ACTION_LABELS[action]} ${resource.toLowerCase()}`,
  })),
);

/** Every permission key in catalog order. */
export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

/**
 * Keys retired in feature batch 2 and the key that replaced each one (docs/specs/feature-batch-02-plan.md,
 * K-2 and K-3). Saved roles and ceilings from an older demo are upgraded with this map.
 */
export const RENAMED_PERMISSIONS: Readonly<Record<string, PermissionKey>> = {
  "sales.payment.create": "sales.payment.record",
  "purchasing.bill.pay": "purchasing.payment.record",
};

const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

/** Looks up a permission definition; returns undefined for unknown keys. */
export function permissionDef(key: string): PermissionDef | undefined {
  return BY_KEY.get(key as PermissionKey);
}

/** Label for an action column. */
export function actionLabel(action: PermissionAction): string {
  return ACTION_LABELS[action];
}

/** Permissions belonging to the given modules, in catalog order. */
export function permissionsForModules(modules: readonly ModuleKey[]): PermissionKey[] {
  return PERMISSIONS.filter((p) => modules.includes(p.module)).map((p) => p.key);
}

/**
 * Sensitive fields and the permission that reveals each one (blueprint "Four layers of
 * control", layer 3). Without it, the field is hidden on every screen.
 */
export const SENSITIVE = {
  productCost: "inventory.product.view_sensitive",
  margin: "sales.margin.view_sensitive",
  jobMargin: "installation.job.view_sensitive",
  payRate: "hr.employee.view_sensitive",
  creditLimit: "customers.customer.view_sensitive",
} as const satisfies Record<string, PermissionKey>;
