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

/** One of a company's subscriptions, with its plan's modules, as planModulesOf reads it. */
export interface SubscriptionModules {
  status: "trial" | "active" | "past_due" | "cancelled";
  currentPeriodEnd: Date;
  modules: readonly ModuleKey[];
}

/**
 * The plan modules that limit a company (input to enabledModules).
 * - A fresh trial (a company in `trial` status that has never had a subscription row, deleted ones
 *   included) gets null: all of its products' modules.
 * - Otherwise it is the union of the plans of its current subscriptions (one per product). A
 *   cancelled subscription, or a trial subscription past its period, is not current.
 * - With none current, it is the plan of the latest subscription, so a cancelled company keeps
 *   reading what it paid for (read-only, blueprint p29) and never gains more.
 * - A company that is not a trial and has no subscription rows at all gets no plan modules, so
 *   deleting subscription rows never turns it back into a trial (PR #7 reviews).
 */
export function planModulesOf(
  subscriptions: readonly SubscriptionModules[],
  freshTrial: boolean,
  now: Date = new Date(),
): PlanModules {
  const isCurrent = (subscription: SubscriptionModules) =>
    subscription.status !== "cancelled" && !(subscription.status === "trial" && subscription.currentPeriodEnd < now);
  if (subscriptions.length === 0) return freshTrial ? null : [];
  const current = subscriptions.filter(isCurrent);
  const counted =
    current.length > 0
      ? current
      : [
          subscriptions.reduce((latest, subscription) =>
            subscription.currentPeriodEnd > latest.currentPeriodEnd ? subscription : latest,
          ),
        ];
  return [...new Set(counted.flatMap((subscription) => subscription.modules))];
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
  costPerSqFt: SENSITIVE.productCost,
  productCost: SENSITIVE.productCost,
  margin: SENSITIVE.margin,
  marginPct: SENSITIVE.margin,
  grossMargin: SENSITIVE.margin,
  grossMarginPct: SENSITIVE.margin,
  jobMargin: SENSITIVE.jobMargin,
  jobMarginPct: SENSITIVE.jobMargin,
  jobCost: SENSITIVE.jobMargin,
  laborCost: SENSITIVE.jobMargin,
  payRate: SENSITIVE.payRate,
  hourlyRate: SENSITIVE.payRate,
  baseRate: SENSITIVE.payRate,
  regularRate: SENSITIVE.payRate,
  salary: SENSITIVE.payRate,
  salaryAmount: SENSITIVE.payRate,
  creditLimit: SENSITIVE.creditLimit,
  estimatedCost: "contracts.contract.view_sensitive",
};

/**
 * Whether a viewer may see a margin: on a quote, the dashboard, Best sellers and Sales → Team
 * (sales.md "Who uses it"; ADR 0037, 2026-11-16 and 2026-11-17), and in reports (ADR 0055 S17,
 * through `reportVisibility`). It needs the margin key and the product-cost key: margin is revenue
 * less cost, so it gives the cost away (CLAUDE.md rule 5). A screen also shows it only when every
 * cost under it is known; a contract invoice whose cost the viewer can't see arrives without it
 * (`contractCostShown`). No default role changes in a company with its modules on.
 */
export function seesMargin(has: (key: PermissionKey) => boolean): boolean {
  return has(SENSITIVE.margin) && has(SENSITIVE.productCost);
}

/**
 * Fields of invoices and quotes, and of their lines, that give the margin away: the cost of what
 * was sold (`unitCost` on a line, `cost` on the document). Price less cost is the margin, so the
 * API strips them on sales documents from anyone who may not see the margin (`seesMargin`), on top
 * of the product-cost rule in SENSITIVE_FIELDS (CLAUDE.md rule 5; click-through #68). A company
 * ceiling without the margin key then hides them even from the Owner. Purchasing keeps its own
 * line costs, which its buyers need without margin sight.
 */
export const MARGIN_REVEALING_FIELDS: readonly string[] = ["unitCost", "cost"];

/** A snake_case column name as the camelCase property name it stands for (`unit_cost` → `unitCost`). */
function camelCase(field: string): string {
  return field.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * The key that reveals a response field, or undefined when the field is not sensitive. Raw SQL rows
 * arrive in snake_case, so `unit_cost` is matched as `unitCost` (PR #7 review). Only the map's own
 * names match, never inherited ones such as `toString` (finding F-l).
 */
export function sensitiveKeyFor(field: string): PermissionKey | undefined {
  return ownKey(field) ?? ownKey(camelCase(field));
}

/** The map's own entry only: a name such as `constructor` must not match Object.prototype (finding F-l). */
function ownKey(field: string): PermissionKey | undefined {
  return Object.hasOwn(SENSITIVE_FIELDS, field) ? SENSITIVE_FIELDS[field] : undefined;
}

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
