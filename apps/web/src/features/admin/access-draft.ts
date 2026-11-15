import {
  ACCESS_LIMIT_RANGE,
  offeredKeys,
  offeredModules,
  type ModuleKey,
  type PermissionKey,
  type PlatformAccessPatch,
  type PlatformCompany,
} from "@workspace/shared";

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

const LIMIT_RANGE = "Enter a whole number from 1 to 100,000.";

/**
 * Whether the company has a plan to hold its limits. Limits live on its subscription rows, so a
 * trial with no plan has none, and the API refuses to set them rather than create a row, which
 * would end the trial for good (docs/specs/platform-admin.md, "Validations"; ADR 0033).
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
 * 100,000). An empty field is fine while the company has no limit, since nothing is then sent.
 */
export function limitProblem(text: string, current: number | null): string | null {
  const value = limitOf(text);
  if (value === null) return current === null ? null : LIMIT_RANGE;
  const whole = Number.isInteger(value) && value >= ACCESS_LIMIT_RANGE.min && value <= ACCESS_LIMIT_RANGE.max;
  return whole ? null : LIMIT_RANGE;
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
