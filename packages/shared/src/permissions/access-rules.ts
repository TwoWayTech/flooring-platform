import { PRODUCT_MODULES, type ModuleKey, type ProductKey } from "../products";
import { SENSITIVE, type PermissionKey } from "./catalog";
import type { DataScope } from "./roles";

/** A plan's module list, or null while the company has no subscription (a trial). */
export type PlanModules = readonly ModuleKey[] | null;

/** A platform admin's switch for one module of one company (tenant_module_overrides). */
export interface ModuleOverride {
  module: ModuleKey;
  enabled: boolean;
}

/**
 * The modules switched on for a company (blueprint "Four layers of control", layer 2). It starts
 * with the modules of its products. With a subscription, they are limited to the plan's modules;
 * without one (a trial), all of the product's modules are on. Overrides then switch single modules
 * on or off, but never outside the products. `platform` (users, roles, settings and audit) is
 * always on.
 */
export function enabledModules(
  products: readonly ProductKey[],
  planModules: PlanModules,
  overrides: readonly ModuleOverride[],
): ModuleKey[] {
  const offered = new Set(products.flatMap((product) => PRODUCT_MODULES[product]));
  const enabled = new Set([...offered].filter((module) => planModules === null || planModules.includes(module)));
  for (const override of overrides) {
    if (!offered.has(override.module)) continue;
    if (override.enabled) enabled.add(override.module);
    else enabled.delete(override.module);
  }
  enabled.add("platform");
  return [...enabled];
}

/**
 * Response fields that only some roles may see (CLAUDE.md rule 5; spec rule 9), by JSON property
 * name, with the key that reveals each. The API strips them from every company response for
 * anyone without the key. These names are reserved: a module must not use them for anything that
 * is not sensitive, or it would be hidden too.
 */
export const SENSITIVE_FIELDS: Readonly<Record<string, PermissionKey>> = {
  cost: SENSITIVE.productCost,
  unitCost: SENSITIVE.productCost,
  averageCost: SENSITIVE.productCost,
  landedCost: SENSITIVE.productCost,
  margin: SENSITIVE.margin,
  marginPct: SENSITIVE.margin,
  grossMargin: SENSITIVE.margin,
  jobMargin: SENSITIVE.jobMargin,
  payRate: SENSITIVE.payRate,
  hourlyRate: SENSITIVE.payRate,
  salary: SENSITIVE.payRate,
  creditLimit: SENSITIVE.creditLimit,
  estimatedCost: "contracts.contract.view_sensitive",
};

/** Who is looking, as data scope needs it. */
export interface ScopeViewer {
  userId: string;
  branchId: string | null;
}

/** The owner and branch of a record, as data scope needs them. */
export interface ScopedRow {
  ownerUserId: string | null;
  branchId: string | null;
}

/**
 * Whether a viewer with this data scope may see a record (spec rule 4): `all` sees everything,
 * `branch` sees records of their own branch (and their own), `own` sees only records they own. A
 * viewer with no branch sees no branch records, so a missing branch never widens access.
 */
export function scopeAllows(scope: DataScope, viewer: ScopeViewer, row: ScopedRow): boolean {
  if (scope === "all") return true;
  const owns = row.ownerUserId !== null && row.ownerUserId === viewer.userId;
  if (scope === "own") return owns;
  return owns || (viewer.branchId !== null && row.branchId === viewer.branchId);
}

/** Why an approval was refused, or null when another person may approve. */
export type DutyConflict = "same_person" | null;

/**
 * Separation of duties (blueprint "Security"; spec: payments wait for a second person): the person
 * who recorded something may not also approve, confirm or verify it. Returns `same_person` when
 * they are the same, and null when another person acts.
 */
export function separateDuties(recordedBy: string | null, actor: string): DutyConflict {
  return recordedBy !== null && recordedBy === actor ? "same_person" : null;
}
