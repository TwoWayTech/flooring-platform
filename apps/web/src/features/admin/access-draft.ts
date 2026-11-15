import {
  ACCESS_LIMIT_MESSAGE,
  accessPatchProblem,
  isAccessLimit,
  offeredKeys,
  offeredModules,
  PROTECTED_CEILING_KEYS,
  type ModuleKey,
  type PermissionKey,
  type PlatformAccessPatch,
  type PlatformCompany,
} from "@workspace/shared";
import type { CellLock } from "@/features/settings/roles/permission-matrix";

/**
 * What the access editor holds while the platform admin changes a company. Modules and keys are
 * only the offered, visible ones (the screen shows nothing else); limits are the typed text.
 */
export interface AccessDraft {
  modules: ModuleKey[];
  ceiling: PermissionKey[];
  userLimit: string;
  branchLimit: string;
}

/** The limit fields of a draft. */
export type LimitField = "userLimit" | "branchLimit";

/**
 * Whether the company has a plan to hold its limits. Limits live on its subscription rows, so a
 * company with no subscription row that is not deleted has none, and the API refuses to set them
 * rather than create a row, which would end a fresh trial for good (docs/specs/platform-admin.md,
 * "Validations"; ADR 0033).
 */
export function hasPlan(company: PlatformCompany): boolean {
  return company.subscriptions.length > 0;
}

/** The draft a company's access page starts from: its offered, visible modules and keys, and its limits. */
export function draftOf(company: PlatformCompany): AccessDraft {
  const modules = new Set(company.modules);
  const ceiling = new Set(company.ceiling);
  return {
    modules: offeredModules(company.products).filter((key) => modules.has(key)),
    ceiling: offeredKeys(company.products).filter((key) => ceiling.has(key)),
    userLimit: company.userLimit === null ? "" : String(company.userLimit),
    branchLimit: company.branchLimit === null ? "" : String(company.branchLimit),
  };
}

/** The typed limit as a number, null when the field is empty. */
function limitOf(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

/**
 * Why a typed limit can't be saved, or null (spec "Validations": a whole number from 1 to
 * 100,000), with the shared check and message the API's 400 uses. An empty field is fine while
 * the company has no limit, since nothing is then sent.
 */
export function limitProblem(text: string, current: number | null): string | null {
  const value = limitOf(text);
  if (value === null) return current === null ? null : ACCESS_LIMIT_MESSAGE;
  return isAccessLimit(value) ? null : ACCESS_LIMIT_MESSAGE;
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
}

/**
 * The change a save sends (spec "PlatformAccessPatch"): only the parts that differ from the company
 * as read, so a part left out stays as stored. Lists are complete for the offered, visible modules
 * and keys, in display order; hidden modules (rule 18) are never sent and keep their rows. Null
 * when nothing changed. Limits are sent only when they differ and are valid (`limitProblem`).
 */
export function accessChanges(company: PlatformCompany, draft: AccessDraft): PlatformAccessPatch | null {
  const start = draftOf(company);
  const patch: PlatformAccessPatch = {};
  if (!sameSet(start.modules, draft.modules)) {
    const wanted = new Set(draft.modules);
    patch.modules = offeredModules(company.products).filter((key) => wanted.has(key));
  }
  if (!sameSet(start.ceiling, draft.ceiling)) {
    const wanted = new Set(draft.ceiling);
    patch.ceiling = offeredKeys(company.products).filter((key) => wanted.has(key));
  }
  for (const field of ["userLimit", "branchLimit"] as const) {
    const value = limitOf(draft[field]);
    if (value !== null && value !== company[field] && limitProblem(draft[field], company[field]) === null) {
      patch[field] = value;
    }
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * Why a ceiling box is locked on the console's access page, or null when it can be changed
 * (docs/specs/platform-admin.md, part 3, "Screens"):
 * - `read_only` for a role that may not change access, on every box;
 * - `protected` for a protected key that is ticked (spec "Validations": every company keeps the
 *   users, roles and audit keys). Only unticking is locked: a company whose ceiling lacks one can
 *   still tick it back, so no company is trapped by the lock.
 */
export function ceilingLock(key: PermissionKey, draftCeiling: readonly PermissionKey[], readOnly: boolean): CellLock {
  if (readOnly) return "read_only";
  const protectedKey = (PROTECTED_CEILING_KEYS as readonly string[]).includes(key);
  return protectedKey && draftCeiling.includes(key) ? "protected" : null;
}

/**
 * Why a save would be refused, with the API's shared check and message, or null (spec part 3,
 * "Company access for the owner role": checked before the step-up, so a refused change never costs
 * an authenticator code).
 */
export function saveProblem(company: PlatformCompany, patch: PlatformAccessPatch): string | null {
  return accessPatchProblem({ products: company.products, hasSubscription: hasPlan(company) }, patch)?.message ?? null;
}
