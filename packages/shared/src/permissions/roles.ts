import type { ProductKey } from "../products";
import { ALL_PERMISSION_KEYS, type PermissionKey } from "./catalog";

/** Which records a role sees: its own, its branch, or everything (blueprint "Default roles"). */
export type DataScope = "own" | "branch" | "all";

/** Stable keys for the default roles. Copies made by admins get generated keys. */
export type DefaultRoleKey =
  "owner" | "manager" | "accountant" | "sales" | "purchasing" | "warehouse" | "installer" | "hr" | "employee";

/** A default role template, copied into each company at setup. */
export interface RoleTemplate {
  key: DefaultRoleKey;
  name: string;
  description: string;
  dataScope: DataScope;
  permissions: PermissionKey[];
  /** The Owner role holds everything inside the ceiling and cannot be edited or deleted. */
  owner: boolean;
}

/** Expands `prefix.*` patterns against the catalog; exact keys pass through. */
function expand(patterns: string[]): PermissionKey[] {
  return ALL_PERMISSION_KEYS.filter((key) =>
    patterns.some((p) => (p.endsWith(".*") ? key.startsWith(p.slice(0, -1)) : key === p)),
  );
}

const OWN_TIME = [
  "hr.timesheet.view",
  "hr.pto.view",
  "hr.pto.request",
  "meetings.meeting.view",
  "meetings.meeting.create",
];

const TEMPLATES: Record<DefaultRoleKey, RoleTemplate> = {
  owner: {
    key: "owner",
    name: "Owner",
    description: "Everything, including billing, branding and roles",
    dataScope: "all",
    permissions: [...ALL_PERMISSION_KEYS],
    owner: true,
  },
  manager: {
    key: "manager",
    name: "Manager",
    description: "Sales, purchasing, inventory, installation, reports and approvals",
    dataScope: "branch",
    permissions: expand([
      "dashboard.*",
      "sales.quote.*",
      "sales.invoice.*",
      "sales.payment.view",
      "sales.payment.record",
      "sales.waste.view",
      "sales.commission.view",
      "sales.margin.*",
      "customers.*",
      "inventory.*",
      "purchasing.*",
      "reports.sales.*",
      "reports.inventory.*",
      "reports.financial.view",
      "retail.*",
      "wholesale.*",
      "installation.*",
      "hr.overview.view",
      "hr.employee.view",
      "hr.timesheet.*",
      "hr.pto.*",
      "meetings.*",
      "settings.users.view",
      "settings.audit.view",
    ]).filter((key) => key !== "inventory.stock.correct"),
    owner: false,
  },
  accountant: {
    key: "accountant",
    name: "Accountant",
    description: "Invoices, bills, payments, tax and financial reports",
    dataScope: "all",
    permissions: expand([
      "dashboard.*",
      "sales.quote.view",
      "sales.invoice.*",
      "sales.payment.*",
      "sales.tax.override",
      "sales.waste.view",
      "sales.commission.view",
      "sales.margin.*",
      "customers.customer.view",
      "customers.customer.export",
      "customers.customer.view_sensitive",
      "inventory.product.view",
      "inventory.product.view_sensitive",
      "inventory.product.export",
      "inventory.roll.view",
      "purchasing.supplier.view",
      "purchasing.order.view",
      "purchasing.bill.*",
      "purchasing.payment.*",
      "reports.*",
      "wholesale.certificate.view",
      "hr.payroll.export",
      "settings.localization.manage",
      "settings.payments.manage",
      "settings.tax.manage",
      "settings.numbers.manage",
      "settings.audit.view",
      ...OWN_TIME,
    ]),
    owner: false,
  },
  sales: {
    key: "sales",
    name: "Sales",
    description: "Customers, quotes, orders and invoices; no cost or margin",
    dataScope: "own",
    permissions: expand([
      "dashboard.*",
      "sales.quote.view",
      "sales.quote.create",
      "sales.quote.edit",
      "sales.invoice.view",
      "sales.invoice.create",
      "sales.payment.view",
      "sales.commission.view",
      "customers.customer.view",
      "customers.customer.create",
      "customers.customer.edit",
      "inventory.product.view",
      "inventory.roll.view",
      "retail.*",
      "wholesale.price_list.view",
      "wholesale.certificate.view",
      "installation.job.view",
      "reports.sales.view",
      ...OWN_TIME,
      "meetings.meeting.edit",
    ]),
    owner: false,
  },
  purchasing: {
    key: "purchasing",
    name: "Purchasing",
    description: "Suppliers, purchase orders, receiving and supplier bills",
    dataScope: "all",
    permissions: expand([
      "dashboard.*",
      "purchasing.supplier.*",
      "purchasing.order.*",
      "purchasing.bill.*",
      "purchasing.payment.record",
      "inventory.product.view",
      "inventory.product.view_sensitive",
      "inventory.roll.view",
      "inventory.transfer.view",
      "reports.inventory.view",
      ...OWN_TIME,
    ]),
    owner: false,
  },
  warehouse: {
    key: "warehouse",
    name: "Warehouse",
    description: "Receiving, stock moves, roll cuts and counts",
    dataScope: "branch",
    permissions: expand([
      "dashboard.*",
      "inventory.product.view",
      "inventory.roll.*",
      "inventory.transfer.*",
      "sales.waste.view",
      "purchasing.supplier.view",
      "purchasing.order.view",
      "purchasing.order.receive",
      "installation.job.view",
      "reports.inventory.view",
      ...OWN_TIME,
    ]),
    owner: false,
  },
  installer: {
    key: "installer",
    name: "Installer",
    description: "Assigned jobs, job photos, sign-off and own timesheet",
    dataScope: "own",
    permissions: expand(["installation.job.view", "installation.job.sign_off", ...OWN_TIME]),
    owner: false,
  },
  hr: {
    key: "hr",
    name: "HR manager",
    description: "Employees, timesheets, PTO and payroll register",
    dataScope: "all",
    permissions: expand(["hr.*", "meetings.*", "settings.users.view", "settings.audit.view"]),
    owner: false,
  },
  employee: {
    key: "employee",
    name: "Employee",
    description: "Own timesheet, own meetings and own PTO requests",
    dataScope: "own",
    permissions: expand(OWN_TIME),
    owner: false,
  },
};

/** Default roles each product ships with, in display order. */
export const PRODUCT_ROLES: Record<ProductKey, readonly DefaultRoleKey[]> = {
  flooring: ["owner", "manager", "accountant", "sales", "purchasing", "warehouse", "installer", "hr", "employee"],
  hr: ["owner", "hr", "employee"],
};

/** Whether a role key names one of the shipped default roles, which can be reset to their template (spec A3). */
export function isDefaultRoleKey(key: string): key is DefaultRoleKey {
  return key in TEMPLATES;
}

/** Returns a fresh copy of a default role template. */
export function roleTemplate(key: DefaultRoleKey): RoleTemplate {
  const t = TEMPLATES[key];
  return { ...t, permissions: [...t.permissions] };
}

/** Width order of data scopes, used to pick the widest scope across several roles. */
export const SCOPE_RANK: Record<DataScope, number> = { own: 0, branch: 1, all: 2 };
