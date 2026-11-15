import type { FloorPattern } from "./types/company";

/** Products sold on the platform. Each company subscribes to exactly one in the demo. */
export type ProductKey = "flooring" | "hr";

/**
 * Modules a company can have switched on (spec section 1, blueprint "Four layers of control").
 * `platform` holds users, roles, settings and audit, and is always on for every company.
 */
export type ModuleKey = "platform" | "core" | "retail" | "wholesale" | "installation" | "contracts" | "hr" | "meetings";

/** Display metadata for a module. */
export interface ModuleInfo {
  key: ModuleKey;
  label: string;
  description: string;
}

/** Every module with its label, in the order the permission matrix shows them. */
export const MODULES: readonly ModuleInfo[] = [
  { key: "platform", label: "Platform", description: "Users, roles, settings and audit log" },
  { key: "core", label: "Core", description: "Sales, customers, inventory, purchasing and reports" },
  { key: "retail", label: "Retail", description: "Homeowner quotes with room measurements and samples" },
  { key: "wholesale", label: "Wholesale", description: "Dealer accounts, price lists, credit and resale certificates" },
  { key: "installation", label: "Installation", description: "Crews, subcontractors, job costing and sign-off" },
  {
    key: "contracts",
    label: "Contracts",
    description: "Customer and subcontractor contracts, progress billing and compliance",
  },
  { key: "hr", label: "HR", description: "Employees, timesheets, PTO and commissions" },
  { key: "meetings", label: "Meetings", description: "Meetings with staff, customers and suppliers" },
];

/**
 * Modules each product can offer. A company only ever sees permissions from its product's
 * modules, which is why Harbor Staffing (HR Suite) never sees flooring permissions.
 */
export const PRODUCT_MODULES: Record<ProductKey, readonly ModuleKey[]> = {
  flooring: ["platform", "core", "retail", "wholesale", "installation", "contracts", "hr", "meetings"],
  hr: ["platform", "hr", "meetings"],
};

/** Human label for a product. */
export const PRODUCT_LABELS: Record<ProductKey, string> = {
  flooring: "Flooring Suite",
  hr: "HR Suite",
};

/** Whether a string names a module, so input from a request can be checked before it is trusted. */
export function isModuleKey(value: string): value is ModuleKey {
  return MODULES.some((m) => m.key === value);
}

/**
 * The given modules in display order (the order of `MODULES`), without duplicates, so a list reads
 * the same however a database or a set returned it: the console's module column and the audit row
 * of an access change both use it.
 */
export function inModuleOrder(modules: Iterable<ModuleKey>): ModuleKey[] {
  const given = new Set(modules);
  return MODULES.map((m) => m.key).filter((key) => given.has(key));
}

/** Returns the module metadata for a key. */
export function moduleInfo(key: ModuleKey): ModuleInfo {
  const found = MODULES.find((m) => m.key === key);
  if (!found) throw new Error(`Unknown module ${key}`);
  return found;
}

/**
 * The branding a new company of each product starts with, until its owner uploads their own. The
 * login page uses it before a company is known, and provisioning writes it into tenant_branding.
 */
export const PRODUCT_DEFAULT_BRANDING: Record<ProductKey, { brandColor: string; pattern: FloorPattern }> = {
  flooring: { brandColor: "#2E8B7E", pattern: "herringbone" },
  hr: { brandColor: "#1F6FA8", pattern: "basketweave" },
};
