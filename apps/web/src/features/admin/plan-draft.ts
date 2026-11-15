import {
  ACCESS_LIMIT_MESSAGE,
  ADMIN_REASON_MESSAGE,
  isAccessLimit,
  isPlanProduct,
  offeredModules,
  PLAN_MESSAGES,
  planChanges,
  planPatchProblem,
  planProblem,
  type ModuleKey,
  type PlatformPlan,
  type PlatformPlanInput,
  type PlatformPlanPatch,
  type ProductKey,
} from "@workspace/shared";

/*
 * What the plan dialog holds and checks (docs/specs/platform-admin.md, part 2, "The plan dialog").
 * Continue runs the shared `planProblem` or `planPatchProblem` before any code is asked for, so a
 * field the API would refuse is marked and focused instead. Prices stay the text typed: no
 * rounding, no `toFixed` (CLAUDE.md rule 6). No price, module or limit is ever filled in.
 */

/** What the plan dialog holds while the admin types: limits and prices as the text typed. */
export interface PlanDraft {
  key: string;
  name: string;
  /** Empty until the admin chooses a product: none is chosen for them. */
  product: ProductKey | "";
  monthlyPrice: string;
  yearlyPrice: string;
  /** The product's visible modules that are on; Platform is always on and never listed. */
  modules: ModuleKey[];
  maxUsers: string;
  maxBranches: string;
  reason: string;
}

/** A field of the plan dialog that a refusal can point at. */
export type PlanField = keyof PlanDraft;

/** What Continue found: the call to make, or the refusal to show (on a field when one is named). */
export type PlanStep<T> = { ok: true; value: T } | { ok: false; field: PlanField | null; message: string };

/** A new plan's draft: every field empty, nothing chosen for the admin ("never invent a price"). */
export function emptyPlanDraft(): PlanDraft {
  return {
    key: "",
    name: "",
    product: "",
    monthlyPrice: "",
    yearlyPrice: "",
    modules: [],
    maxUsers: "",
    maxBranches: "",
    reason: "",
  };
}

/** The modules the dialog offers for a product: its visible ones (rule 18), Platform left out. */
export function planModuleChoices(product: ProductKey | ""): ModuleKey[] {
  return product === "" ? [] : offeredModules([product]).filter((module) => module !== "platform");
}

/**
 * An existing plan's draft: its values as stored, and only the modules the dialog offers. A hidden
 * stored module, such as Installation on Flooring Pro, is not shown and the API keeps it.
 */
export function planDraftOf(plan: PlatformPlan): PlanDraft {
  const stored = new Set(plan.modules);
  return {
    key: plan.key,
    name: plan.name,
    product: plan.product,
    monthlyPrice: plan.monthlyPrice,
    yearlyPrice: plan.yearlyPrice,
    modules: planModuleChoices(plan.product).filter((module) => stored.has(module)),
    maxUsers: plan.maxUsers === null ? "" : String(plan.maxUsers),
    maxBranches: plan.maxBranches === null ? "" : String(plan.maxBranches),
    reason: "",
  };
}

/**
 * A typed limit as a number: whole digits only, so "1e3", "5.5" or an empty field never pass as a
 * limit. Anything else is NaN, which the shared rule refuses with its message.
 */
export function limitValue(text: string): number {
  const trimmed = text.trim();
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Which field a refusal of the plan rules points at, or null for one about the whole plan (422). */
export function planFieldOf(message: string, draft: PlanDraft): PlanField | null {
  const byMessage: Record<string, PlanField> = {
    [PLAN_MESSAGES.key]: "key",
    [PLAN_MESSAGES.keyTaken]: "key",
    [PLAN_MESSAGES.name]: "name",
    [PLAN_MESSAGES.product]: "product",
    [PLAN_MESSAGES.monthlyPrice]: "monthlyPrice",
    [PLAN_MESSAGES.yearlyPrice]: "yearlyPrice",
    [PLAN_MESSAGES.modules]: "modules",
    [PLAN_MESSAGES.modulesEmpty]: "modules",
    [ADMIN_REASON_MESSAGE]: "reason",
  };
  if (Object.hasOwn(byMessage, message)) return byMessage[message] ?? null;
  // The two limits share one message; the rules check the user limit first.
  if (message === ACCESS_LIMIT_MESSAGE) return isAccessLimit(limitValue(draft.maxUsers)) ? "maxBranches" : "maxUsers";
  const product = draft.product === "" ? null : draft.product;
  const aboutModule = draft.modules.some(
    (module) =>
      message === PLAN_MESSAGES.moduleUnknown(module) ||
      (product !== null && message === PLAN_MESSAGES.moduleNotOffered(module, product)),
  );
  return aboutModule ? "modules" : null;
}

function refused<T>(message: string, draft: PlanDraft): PlanStep<T> {
  return { ok: false, field: planFieldOf(message, draft), message };
}

/** A new plan from the draft, or the first refusal of the shared `planProblem`, before the step-up. */
export function newPlanStep(draft: PlanDraft): PlanStep<PlatformPlanInput> {
  if (!isPlanProduct(draft.product)) {
    // The key and name come first in the shared order, so a product problem waits for them.
    const earlier = planProblem({ key: draft.key, name: draft.name, product: draft.product });
    return refused(earlier?.message ?? PLAN_MESSAGES.product, draft);
  }
  const input: PlatformPlanInput = {
    key: draft.key,
    name: draft.name,
    product: draft.product,
    monthlyPrice: draft.monthlyPrice,
    yearlyPrice: draft.yearlyPrice,
    modules: [...draft.modules],
    maxUsers: limitValue(draft.maxUsers),
    maxBranches: limitValue(draft.maxBranches),
    reason: draft.reason.trim(),
  };
  const problem = planProblem(input);
  return problem ? refused(problem.message, draft) : { ok: true, value: input };
}

function sameModules(left: readonly ModuleKey[], right: readonly ModuleKey[]): boolean {
  return left.length === right.length && left.every((module) => right.includes(module));
}

/** A limit to send: its number when the text changed it, nothing when it says what is stored. */
function changedLimit(text: string, stored: number | null): number | undefined {
  if (stored === null && text.trim() === "") return undefined;
  const value = limitValue(text);
  return value === stored ? undefined : value;
}

/**
 * A plan change from the draft (spec "PATCH /platform/plans/:id"): only the fields the admin
 * changed, plus the reason, checked by the shared `planPatchProblem` with the plan's in-use rule.
 * `value` is null when nothing would change, so nothing is sent and no code is asked for.
 */
export function planPatchStep(plan: PlatformPlan, draft: PlanDraft): PlanStep<PlatformPlanPatch | null> {
  const patch: PlatformPlanPatch = { reason: draft.reason.trim() };
  if (draft.name !== plan.name) patch.name = draft.name;
  if (draft.monthlyPrice !== plan.monthlyPrice) patch.monthlyPrice = draft.monthlyPrice;
  if (draft.yearlyPrice !== plan.yearlyPrice) patch.yearlyPrice = draft.yearlyPrice;
  if (!sameModules(draft.modules, planDraftOf(plan).modules)) patch.modules = [...draft.modules];
  const maxUsers = changedLimit(draft.maxUsers, plan.maxUsers);
  if (maxUsers !== undefined) patch.maxUsers = maxUsers;
  const maxBranches = changedLimit(draft.maxBranches, plan.maxBranches);
  if (maxBranches !== undefined) patch.maxBranches = maxBranches;
  const problem = planPatchProblem(plan, patch, plan.companies > 0);
  if (problem) return refused(problem.message, draft);
  return { ok: true, value: planChanges(plan, patch) ? patch : null };
}
