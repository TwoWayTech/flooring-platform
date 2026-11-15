import { visibleModules } from "../features";
import { isPermissionKey, permissionsForModules, type PermissionKey } from "../permissions/catalog";
import type { ModuleOverride, PlanModules } from "../permissions/access-rules";
import { inModuleOrder, isModuleKey, moduleInfo, PRODUCT_MODULES, type ModuleKey, type ProductKey } from "../products";

/**
 * Keys every company keeps in its ceiling (docs/specs/platform-admin.md, "Validations"; review A5).
 * The ceiling binds the Owner too (`effectivePermissions` has no Owner exemption), so without them a
 * company could not disable a person who left, change a role or read its own audit log. All five
 * belong to the Platform module, which every product offers and which is never hidden.
 */
export const PROTECTED_CEILING_KEYS = [
  "settings.users.view",
  "settings.users.manage",
  "settings.roles.view",
  "settings.roles.manage",
  "settings.audit.view",
] as const satisfies readonly PermissionKey[];

/** The whole numbers a user or branch limit may take (spec "Validations"). */
export const ACCESS_LIMIT_RANGE = { min: 1, max: 100_000 } as const;

/** Why a limit is refused (spec "Validations"): the API's 400 and the console's field message say the same. */
export const ACCESS_LIMIT_MESSAGE = "Enter a whole number from 1 to 100,000.";

/** Whether a limit is a whole number in `ACCESS_LIMIT_RANGE` (spec "Validations"); the API and the console's field both check it. */
export function isAccessLimit(value: number): boolean {
  return Number.isInteger(value) && value >= ACCESS_LIMIT_RANGE.min && value <= ACCESS_LIMIT_RANGE.max;
}

/**
 * A change of company access as it arrives, before `accessPatchProblem` has checked its names. A
 * typed `PlatformAccessPatch` fits it too, so the API and the demo store run the same check.
 */
export interface AccessPatchInput {
  modules?: readonly string[];
  ceiling?: readonly string[];
  userLimit?: number;
  branchLimit?: number;
}

/** What the access check needs to know about the company. */
export interface AccessPatchFacts {
  products: readonly ProductKey[];
  /** Whether the company has a subscription row that is not deleted; limits live only on those rows. */
  hasSubscription: boolean;
}

/** Why a change of access is refused: 400 for a request that names what it may not, 422 for a broken rule. */
export interface AccessPatchProblem {
  status: 400 | 422;
  message: string;
}

/** One write to `tenant_module_overrides` that a save needs. */
export type ModuleOverrideChange =
  { module: ModuleKey; action: "write"; enabled: boolean } | { module: ModuleKey; action: "remove" };

/** One `tenant_permission_ceiling` row whose `allowed` value a save changes. */
export interface CeilingRow {
  key: PermissionKey;
  allowed: boolean;
}

/** A company's effective access, before or after a save, as the audit row compares it. */
export interface AccessState {
  modules: readonly ModuleKey[];
  ceiling: readonly PermissionKey[];
  userLimit: number | null;
  branchLimit: number | null;
}

/** The `before` and `after` of a `company.access_changed` audit row; each field only when it changed. */
export interface AccessDiff {
  before: { userLimit?: number | null; branchLimit?: number | null };
  after: {
    modulesSwitchedOn?: ModuleKey[];
    modulesSwitchedOff?: ModuleKey[];
    keysAdded?: PermissionKey[];
    keysRemoved?: PermissionKey[];
    userLimit?: number | null;
    branchLimit?: number | null;
  };
}

const PLATFORM_LOCKED = "The Platform module can't be switched off.";
const PROTECTED_MISSING =
  "A company always keeps the Users, Security roles and Audit log permissions, so it can manage its own people.";
const NO_PLAN = "This company is on a trial with no plan, so it has no limits to change.";

/** The keys of the modules the feature switches leave visible (product spec rule 18). */
function visibleModuleKeys(): ModuleKey[] {
  return visibleModules().map((m) => m.key);
}

function invalid(message: string): AccessPatchProblem {
  return { status: 400, message };
}

/**
 * The modules the console may change for a company, in display order: those its products offer
 * (`PRODUCT_MODULES`) that are also visible (rule 18 hides Installation while its switch is off).
 * `platform` is included; it is always on and its switch is disabled. Hidden modules and modules
 * outside the products are never sent and keep their stored rows (spec "What a save does").
 */
export function offeredModules(
  products: readonly ProductKey[],
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): ModuleKey[] {
  return inModuleOrder(products.flatMap((product) => PRODUCT_MODULES[product])).filter((key) => visible.includes(key));
}

/** The permission keys of `offeredModules`, in catalog order: the keys the console may tick or untick. */
export function offeredKeys(
  products: readonly ProductKey[],
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): PermissionKey[] {
  return permissionsForModules(offeredModules(products, visible));
}

/** Spec "Validations": the list must keep `platform` and name only offered, visible modules. */
function modulesProblem(
  products: readonly ProductKey[],
  modules: readonly string[] | undefined,
  visible: readonly ModuleKey[],
): AccessPatchProblem | null {
  if (modules === undefined) return null;
  if (!modules.includes("platform")) return invalid(PLATFORM_LOCKED);
  const offered = new Set<string>(offeredModules(products, visible));
  const foreign = modules.find((module) => !offered.has(module));
  if (foreign === undefined) return null;
  const label = isModuleKey(foreign) ? moduleInfo(foreign).label : foreign;
  return invalid(`The ${label} module isn't offered to this company.`);
}

/**
 * Spec "Validations": every key must be in the catalog and belong to an offered, visible module,
 * and the result must hold all of `PROTECTED_CEILING_KEYS`. The list is complete for those modules
 * and the protected keys are Platform keys, so "in the result" means "in the list" (review A5).
 */
function ceilingProblem(
  products: readonly ProductKey[],
  ceiling: readonly string[] | undefined,
  visible: readonly ModuleKey[],
): AccessPatchProblem | null {
  if (ceiling === undefined) return null;
  const unknown = ceiling.find((key) => !isPermissionKey(key));
  if (unknown !== undefined) return invalid(`${unknown} is not a permission.`);
  const offered = new Set<string>(offeredKeys(products, visible));
  const foreign = ceiling.find((key) => !offered.has(key));
  if (foreign !== undefined) return invalid(`${foreign} is outside this company's products.`);
  const held = new Set(ceiling);
  return PROTECTED_CEILING_KEYS.every((key) => held.has(key)) ? null : invalid(PROTECTED_MISSING);
}

/**
 * Spec "Validations": limits are whole numbers from 1 to 100,000, and they need a subscription row
 * that is not deleted. Limits live on those rows, and creating one would end a fresh trial for good
 * (`planModulesOf`; ADR 0033), so a trial with no plan is refused with 422 rather than given a row.
 */
function limitsProblem(facts: AccessPatchFacts, patch: AccessPatchInput): AccessPatchProblem | null {
  const limits = [patch.userLimit, patch.branchLimit].filter((limit) => limit !== undefined);
  if (limits.length === 0) return null;
  if (!limits.every(isAccessLimit)) return invalid(ACCESS_LIMIT_MESSAGE);
  return facts.hasSubscription ? null : { status: 422, message: NO_PLAN };
}

/**
 * Why a change of company access is refused, or null when it may be saved
 * (docs/specs/platform-admin.md, "Validations (PATCH access)"). The API and the demo store both call
 * it, so they refuse the same things; this closes the product spec's edge case "updateCompanyAccess
 * has no check in the store". Checks run in the spec's order: modules, ceiling, then limits, and
 * every 400 comes before the 422. Duplicates in a list are ignored. Shape checks (unknown fields,
 * wrong types, list lengths) are the API schema's job.
 */
export function accessPatchProblem(
  facts: AccessPatchFacts,
  patch: AccessPatchInput,
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): AccessPatchProblem | null {
  return (
    modulesProblem(facts.products, patch.modules, visible) ??
    ceilingProblem(facts.products, patch.ceiling, visible) ??
    limitsProblem(facts, patch)
  );
}

/**
 * The module override writes a save needs (spec "What a save does", Modules; blueprint p4 layer 2;
 * ADR 0031). For each offered, visible module other than `platform`:
 * - when the requested state is what the plan gives (on and in the plan, or off and not in it), no
 *   override is needed, and a stored one is removed (soft-deleted), so an old "off" never outlives
 *   a change back (review A3);
 * - otherwise the override is written with that state, unless the stored one already holds it.
 * A fresh trial's plan (`null`) gives every module. Hidden modules, modules outside the products
 * and `platform` are left exactly as stored. `stored` is the company's live override rows;
 * `requested` is checked by `accessPatchProblem` first.
 */
export function moduleOverridesFor(
  products: readonly ProductKey[],
  planModules: PlanModules,
  stored: readonly ModuleOverride[],
  requested: readonly ModuleKey[],
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): ModuleOverrideChange[] {
  const wanted = new Set(requested);
  const storedState = new Map(stored.map((override) => [override.module, override.enabled]));
  return offeredModules(products, visible)
    .filter((module) => module !== "platform")
    .flatMap((module): ModuleOverrideChange[] => {
      const on = wanted.has(module);
      const planGives = planModules === null || planModules.includes(module);
      const current = storedState.get(module);
      if (on === planGives) return current === undefined ? [] : [{ module, action: "remove" }];
      return current === on ? [] : [{ module, action: "write", enabled: on }];
    });
}

/**
 * The ceiling rows a save writes (spec "What a save does", Ceiling; blueprint role rule 3). For
 * each key of the offered, visible modules, `allowed` is whether `requested` holds it, and a row is
 * returned only when that differs from `stored` (the allowed keys; a missing row counts as not
 * allowed). Keys of hidden modules, keys outside the products and retired keys keep their rows.
 * Roles keep their ticks: an unticked key is inactive until it is ticked again.
 */
export function ceilingRowsFor(
  products: readonly ProductKey[],
  stored: readonly string[],
  requested: readonly PermissionKey[],
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): CeilingRow[] {
  const held = new Set(stored);
  const wanted = new Set(requested);
  return offeredKeys(products, visible).flatMap((key) => {
    const allowed = wanted.has(key);
    return allowed === held.has(key) ? [] : [{ key, allowed }];
  });
}

/**
 * The limit override for one subscription row (spec "What a save does", Limits). It is null when
 * the row's plan already gives that number, so an unchanged save pins nothing; a row whose plan has
 * no limit row (`planLimit` null) always gets the number. The effective limit is the largest of
 * `override ?? plan limit` over every subscription row that is not deleted, cancelled ones included
 * (`core/access/plan-limits.ts`), so the API writes this to every such row (review A2).
 */
export function limitOverrideFor(planLimit: number | null, requested: number): number | null {
  return planLimit === requested ? null : requested;
}

/** Items of `list` missing from `other`, without duplicates. */
function missingFrom<T>(list: readonly T[], other: readonly T[]): T[] {
  const present = new Set(other);
  return [...new Set(list)].filter((item) => !present.has(item));
}

/**
 * The `before` and `after` of a `company.access_changed` audit row (spec "Audit"), from the
 * company's effective access read before and after the save, or null when nothing changed, so a
 * save that changes nothing adds no audit row. Keys are sorted, modules are in display order.
 */
export function accessDiff(before: AccessState, after: AccessState): AccessDiff | null {
  const diff: AccessDiff = { before: {}, after: {} };
  const switchedOn = inModuleOrder(missingFrom(after.modules, before.modules));
  const switchedOff = inModuleOrder(missingFrom(before.modules, after.modules));
  const added = missingFrom(after.ceiling, before.ceiling).sort();
  const removed = missingFrom(before.ceiling, after.ceiling).sort();
  if (switchedOn.length > 0) diff.after.modulesSwitchedOn = switchedOn;
  if (switchedOff.length > 0) diff.after.modulesSwitchedOff = switchedOff;
  if (added.length > 0) diff.after.keysAdded = added;
  if (removed.length > 0) diff.after.keysRemoved = removed;
  if (before.userLimit !== after.userLimit) {
    diff.before.userLimit = before.userLimit;
    diff.after.userLimit = after.userLimit;
  }
  if (before.branchLimit !== after.branchLimit) {
    diff.before.branchLimit = before.branchLimit;
    diff.after.branchLimit = after.branchLimit;
  }
  return Object.keys(diff.after).length === 0 ? null : diff;
}
