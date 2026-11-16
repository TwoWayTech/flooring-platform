import { featureOn, type FeatureKey } from "../features";
import { ALL_PERMISSION_KEYS, SENSITIVE, type PermissionKey } from "../permissions/catalog";
import type { DataScope } from "../permissions/roles";
import type { ModuleKey } from "../products";
import { IMPORT_KIND_LIST, importKind } from "./kinds";
import type { ColumnMapping, ImportKind } from "./types";

/** What import access reads from a person: effective keys and widest data scope. Never null (deny by default). */
export interface ImportHolder {
  permissions: ReadonlySet<PermissionKey>;
  dataScope: DataScope;
}

/**
 * Everything, for DemoStore's platform admin only (spec "Who uses it": the platform admin imports
 * into any company). The API never builds it: part 1 has no platform-admin path (ADR 0057 S-1).
 */
export const FULL_IMPORT_HOLDER: ImportHolder = { permissions: new Set(ALL_PERMISSION_KEYS), dataScope: "all" };

/** A refusal the API sends as is and DemoStore throws with the same words. */
export interface ImportRefusal {
  status: 403 | 404;
  code: "forbidden" | "module_not_enabled" | "not_found";
  message: string;
}

/**
 * The keys a kind needs, all of them (ADR 0057 S-3): the view, create and edit keys of the
 * records' own module, plus any key a required column needs. Matching reads every record and a
 * row creates or changes one, and nobody grants more than they hold, so `settings.import.manage`
 * alone is never enough. Products look suppliers up by name and carry a required cost (S-4).
 */
export const IMPORT_KIND_KEYS: Record<ImportKind, readonly PermissionKey[]> = {
  customers: ["customers.customer.view", "customers.customer.create", "customers.customer.edit"],
  addresses: ["customers.customer.view", "customers.customer.edit"],
  suppliers: ["purchasing.supplier.view", "purchasing.supplier.create", "purchasing.supplier.edit"],
  products: [
    "inventory.product.view",
    "inventory.product.create",
    "inventory.product.edit",
    SENSITIVE.productCost,
    "purchasing.supplier.view",
  ],
  stock: ["inventory.product.view", "inventory.stock.correct"],
  invoices: ["customers.customer.view", "sales.invoice.create"],
  bills: ["purchasing.supplier.view", "purchasing.bill.create"],
  // Pay rate is a required column, so its key is a kind key.
  employees: ["hr.employee.view", "hr.employee.create", "hr.employee.edit", SENSITIVE.payRate],
  timesheets: ["hr.employee.view", "hr.timesheet.approve"],
};

/** The switch of the records each kind writes: when it is off, so is the kind (404, ADR 0057). */
export const IMPORT_KIND_FEATURES: Record<ImportKind, FeatureKey> = {
  customers: "sales.customers",
  addresses: "sales.customers",
  suppliers: "purchasing.suppliers",
  products: "inventory.products",
  stock: "inventory.products",
  invoices: "sales.invoices",
  bills: "purchasing.orders",
  employees: "hr.employees",
  timesheets: "hr.timesheets",
};

/** What a kind's records are called in a refusal: "customers", "customer addresses", … */
export const IMPORT_KIND_NOUNS = Object.fromEntries(
  IMPORT_KIND_LIST.map((kind) => [kind, importKind(kind).label.toLowerCase()]),
) as Record<ImportKind, string>;

/**
 * Sensitive columns by kind (CLAUDE.md rule 5; ADR 0057 S-4): mapping one needs a key from every
 * group. A supplier's credit limit needs the customer-credit key the response filter strips
 * `creditLimit` with, and one of the supplier-money keys the purchasing routes use.
 */
export const IMPORT_SENSITIVE_COLUMNS: Partial<
  Record<ImportKind, Record<string, readonly (readonly PermissionKey[])[]>>
> = {
  customers: { credit_limit: [[SENSITIVE.creditLimit]] },
  suppliers: {
    credit_limit: [[SENSITIVE.creditLimit], [SENSITIVE.productCost, "purchasing.bill.view"]],
  },
  products: { cost: [[SENSITIVE.productCost]] },
  stock: { cost_per_sq_ft: [[SENSITIVE.productCost]] },
  employees: { pay_rate: [[SENSITIVE.payRate]] },
};

const forbidden = (message: string): ImportRefusal => ({ status: 403, code: "forbidden", message });

/** Whether the holder has a key from every group. */
const holdsEvery = (groups: readonly (readonly PermissionKey[])[], holds: (key: PermissionKey) => boolean) =>
  groups.every((group) => group.some(holds));

/**
 * Why the holder may not import this kind, or null (ADR 0057 S-1 to S-3), checked in this order:
 * the company lacks the kind's module (403, the spec's words), the records' switch is off (404),
 * the person's data scope is narrower than the company (403: rows are matched against every
 * record, and a row may set another rep), or a kind key is missing (403).
 */
export function importKindRefusal(
  kind: ImportKind,
  modules: readonly ModuleKey[],
  holder: ImportHolder,
  isOn: (key: FeatureKey) => boolean = featureOn,
): ImportRefusal | null {
  if (!modules.includes(importKind(kind).module)) {
    return {
      status: 403,
      code: "module_not_enabled",
      message: "This company does not have the module for this import.",
    };
  }
  if (!isOn(IMPORT_KIND_FEATURES[kind])) {
    return { status: 404, code: "not_found", message: "This kind of import is not available." };
  }
  if (holder.dataScope !== "all") {
    return forbidden("Importing needs company-wide data scope, because rows are matched against every record.");
  }
  if (!IMPORT_KIND_KEYS[kind].every((key) => holder.permissions.has(key))) {
    return forbidden(`Your role can't see, add and change ${IMPORT_KIND_NOUNS[kind]}, so it can't import them.`);
  }
  return null;
}

/**
 * Why a mapping may not be used, or null (ADR 0057 S-4): a sensitive column is chosen and the
 * holder lacks a key that reveals it. An unchosen sensitive column is fine.
 */
export function sensitiveColumnRefusal(
  kind: ImportKind,
  mapping: ColumnMapping,
  holder: ImportHolder,
): ImportRefusal | null {
  const holds = (key: PermissionKey) => holder.permissions.has(key);
  for (const [key, groups] of Object.entries(IMPORT_SENSITIVE_COLUMNS[kind] ?? {})) {
    if (!Object.hasOwn(mapping, key) || !mapping[key] || holdsEvery(groups, holds)) continue;
    const label = importKind(kind).fields.find((f) => f.key === key)?.label ?? key;
    return forbidden(`Your role can't see ${label.toLowerCase()}, so leave the ${label} column out.`);
  }
  return null;
}

/** The kinds the holder may import, in wizard order (ADR 0057 S-1 to S-3). */
export function importKindsOpen(
  modules: readonly ModuleKey[],
  holder: ImportHolder,
  isOn: (key: FeatureKey) => boolean = featureOn,
): ImportKind[] {
  return IMPORT_KIND_LIST.filter((kind) => importKindRefusal(kind, modules, holder, isOn) === null);
}

/** The sensitive fields of a kind the holder can't use, so they are never auto-mapped (ADR 0057 S-20). */
export function hiddenSensitiveFields(kind: ImportKind, holds: (key: PermissionKey) => boolean): ReadonlySet<string> {
  return new Set(
    Object.entries(IMPORT_SENSITIVE_COLUMNS[kind] ?? {})
      .filter(([, groups]) => !holdsEvery(groups, holds))
      .map(([key]) => key),
  );
}
