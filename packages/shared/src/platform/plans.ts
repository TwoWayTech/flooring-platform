import Decimal from "decimal.js";
import {
  inModuleOrder,
  isModuleKey,
  moduleInfo,
  PRODUCT_LABELS,
  PRODUCT_MODULES,
  type ModuleKey,
  type ProductKey,
} from "../products";
import type { PlatformPlan, PlatformPlanInput, PlatformPlanPatch } from "../types/platform";
import { ACCESS_LIMIT_MESSAGE, isAccessLimit, offeredModules, visibleModuleKeys } from "./access-patch";
import { adminReasonProblem } from "./admin-reason";

/*
 * Plans as data in the console (docs/specs/platform-admin.md, part 2, "Plans" and "The plan rules";
 * ADR 0056). One copy for the API, the web before the step-up, and the demo. Prices are data, not
 * code (owner, 2026-11-13): nothing is charged from them, and no price, module or limit is ever
 * filled in for the admin ("never invent a price"). A plan in use keeps its modules and limits.
 */

/** A plan key: 2 to 40 lowercase letters, digits and dashes, starting with a letter; exact, never trimmed. */
export const PLAN_KEY = /^[a-z][a-z0-9-]{1,39}$/;

/** A plan name's length, after trimming. Names need not be unique; the key tells two plans apart. */
export const PLAN_NAME = { min: 1, max: 80 } as const;

/**
 * A plan price, after trimming: digits with up to two decimals, inside numeric(14,2). No sign,
 * exponent, comma or leading dot, and never a JSON number (CLAUDE.md rule 6).
 */
export const PLAN_PRICE = /^\d{1,11}(\.\d{1,2})?$/;

/**
 * Every message of the plan routes (spec "Validations and messages (part 2)"): the API's 400, 404,
 * 409 and 422, the plan dialog and the demo say the same. Two take the offending module.
 */
export const PLAN_MESSAGES = {
  key: "Enter a key of 2 to 40 lowercase letters, digits and dashes that starts with a letter, such as flooring-pro.",
  keyTaken: "A plan with this key already exists. A key can't be reused, even after its plan is retired.",
  name: `Enter a name of ${PLAN_NAME.min} to ${PLAN_NAME.max} characters.`,
  product: "Choose Flooring Suite or HR Suite.",
  monthlyPrice: "Enter a monthly price such as 49.00: digits with up to two decimals.",
  yearlyPrice: "Enter a yearly price such as 490.00: digits with up to two decimals.",
  modules: "Choose the plan's modules.",
  modulesEmpty: "Choose at least one module besides Platform.",
  moduleUnknown: (key: string) => `${key} is not a module.`,
  moduleNotOffered: (module: ModuleKey, product: ProductKey) =>
    `The ${moduleInfo(module).label} module isn't offered with ${PRODUCT_LABELS[product]}.`,
  patchFields: "Only a plan's name, prices, modules and limits can change.",
  inUse:
    "This plan is in use, so its modules and limits can't change. Change one company's access on its Access page instead.",
  inUseEffect:
    "Renaming shows the new name on the billing page of every company on this plan. Changing a price here doesn't change what any company on this plan pays: each company's price is kept on its own subscription.",
  notFound: "That plan does not exist.",
  alreadyRetired: "This plan is already retired.",
  notRetired: "This plan isn't retired.",
} as const;

/** Why a plan write is refused: 400 for a field that breaks its rule, 422 for a plan in use. */
export interface PlanProblem {
  status: 400 | 422;
  message: string;
}

/** A new plan's fields as they arrive, before they are checked. A typed `PlatformPlanInput` fits it. */
export interface PlanFields {
  key?: unknown;
  name?: unknown;
  product?: unknown;
  monthlyPrice?: unknown;
  yearlyPrice?: unknown;
  modules?: unknown;
  maxUsers?: unknown;
  maxBranches?: unknown;
  reason?: unknown;
}

/** A plan change's fields as they arrive. Any other key, `key` and `product` included, is refused. */
export type PlanPatchFields = Omit<PlanFields, "key" | "product">;

/** What the plan rules read about a stored plan; a `PlatformPlan` fits it. */
export type PlanState = Pick<
  PlatformPlan,
  "name" | "product" | "monthlyPrice" | "yearlyPrice" | "modules" | "maxUsers" | "maxBranches"
>;

/** The fields a plan change may set, in the order an audit entry lists them. */
export const PLAN_CHANGE_FIELDS = [
  "name",
  "monthlyPrice",
  "yearlyPrice",
  "modules",
  "maxUsers",
  "maxBranches",
] as const;

/** One field a plan change may set. */
export type PlanChangeField = (typeof PLAN_CHANGE_FIELDS)[number];

const PATCH_KEYS: readonly string[] = [...PLAN_CHANGE_FIELDS, "reason"];

/** A plan's changeable values as stored: prices with two decimals, modules in catalog order without Platform. */
export interface PlanValues {
  name: string;
  monthlyPrice: string;
  yearlyPrice: string;
  modules: ModuleKey[];
  maxUsers: number | null;
  maxBranches: number | null;
}

/** A new plan's values as stored and audited (spec "POST /platform/plans", step 5). */
export interface NewPlanValues {
  key: string;
  name: string;
  product: ProductKey;
  monthlyPrice: string;
  yearlyPrice: string;
  modules: ModuleKey[];
  maxUsers: number;
  maxBranches: number;
}

/** What a plan change changes: the old and new value of each field that differs, and nothing else. */
export interface PlanChanges {
  before: Partial<PlanValues>;
  after: Partial<PlanValues>;
}

/** Whether a value names one of the two products. */
export function isPlanProduct(value: unknown): value is ProductKey {
  return typeof value === "string" && Object.hasOwn(PRODUCT_MODULES, value);
}

/** A list whose every item, holes included, is a string. */
function isStringList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) if (typeof value[index] !== "string") return false;
  return true;
}

function keyProblem(value: unknown): string | null {
  return typeof value === "string" && PLAN_KEY.test(value) ? null : PLAN_MESSAGES.key;
}

function nameProblem(value: unknown): string | null {
  if (typeof value !== "string") return PLAN_MESSAGES.name;
  const length = value.trim().length;
  return length >= PLAN_NAME.min && length <= PLAN_NAME.max ? null : PLAN_MESSAGES.name;
}

function priceProblem(value: unknown, message: string): string | null {
  return typeof value === "string" && PLAN_PRICE.test(value.trim()) ? null : message;
}

/**
 * Spec "The plan rules", Modules: a list of strings among the product's visible modules
 * (`offeredModules([product])`, so a hidden module is refused, rule 18). `platform` is accepted and
 * never stored; at least one other module is needed. Checked in the list's order.
 */
function modulesProblem(value: unknown, product: ProductKey, visible: readonly ModuleKey[]): string | null {
  if (!isStringList(value)) return PLAN_MESSAGES.modules;
  const offered = offeredModules([product], visible);
  for (const module of value) {
    if (module === "platform") continue;
    if (!isModuleKey(module)) return PLAN_MESSAGES.moduleUnknown(module);
    if (!offered.includes(module)) return PLAN_MESSAGES.moduleNotOffered(module, product);
  }
  return value.some((module) => module !== "platform") ? null : PLAN_MESSAGES.modulesEmpty;
}

/** Spec "The plan rules", Limits: whole numbers from 1 to 100,000; "unlimited" can't be created. */
function limitProblem(value: unknown): string | null {
  return typeof value === "number" && isAccessLimit(value) ? null : ACCESS_LIMIT_MESSAGE;
}

function badRequest(message: string | null): { status: 400; message: string } | null {
  return message === null ? null : { status: 400, message };
}

/**
 * Why a new plan is refused, or null (spec "The plan rules", `planProblem`). Every field is
 * required, checked in this order: key, name, product, monthly price, yearly price, modules, max
 * users, max branches, reason. The first problem answers 400 with its message. Unknown fields are
 * the API schema's job (strict).
 */
export function planProblem(
  input: PlanFields,
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): { status: 400; message: string } | null {
  const named = keyProblem(input.key) ?? nameProblem(input.name);
  if (named) return badRequest(named);
  if (!isPlanProduct(input.product)) return badRequest(PLAN_MESSAGES.product);
  return badRequest(
    priceProblem(input.monthlyPrice, PLAN_MESSAGES.monthlyPrice) ??
      priceProblem(input.yearlyPrice, PLAN_MESSAGES.yearlyPrice) ??
      modulesProblem(input.modules, input.product, visible) ??
      limitProblem(input.maxUsers) ??
      limitProblem(input.maxBranches) ??
      adminReasonProblem(input.reason),
  );
}

/** Platform left out; hidden or foreign stored modules stay. */
function withoutPlatform(modules: readonly ModuleKey[]): ModuleKey[] {
  return modules.filter((module) => module !== "platform");
}

function sameModules(left: readonly ModuleKey[], right: readonly ModuleKey[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((module) => b.has(module));
}

/**
 * A plan's modules after a change (spec "The plan rules", `planModulesAfter`): the requested modules
 * the console offers for its product (visible ones, rule 18) plus every stored module it doesn't
 * offer, such as `installation` on Flooring Pro while hidden, in catalog order and without
 * Platform. A module the console can't show is kept as part 1 keeps hidden overrides.
 */
export function planModulesAfter(
  product: ProductKey,
  stored: readonly ModuleKey[],
  requested: readonly ModuleKey[],
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): ModuleKey[] {
  const offered = new Set(offeredModules([product], visible));
  const kept = stored.filter((module) => !offered.has(module));
  const wanted = requested.filter((module) => offered.has(module));
  return withoutPlatform(inModuleOrder([...wanted, ...kept]));
}

/**
 * Whether a change of a plan in use would change its modules or a limit (spec `planPatchProblem`),
 * for a patch whose sent fields already passed their rules.
 */
function changesAccess(plan: PlanState, patch: PlanPatchFields, visible: readonly ModuleKey[]): boolean {
  const requested = isStringList(patch.modules) ? patch.modules.filter(isModuleKey) : null;
  const modulesChange =
    requested !== null &&
    !sameModules(planModulesAfter(plan.product, plan.modules, requested, visible), withoutPlatform(plan.modules));
  const usersChange = patch.maxUsers !== undefined && patch.maxUsers !== plan.maxUsers;
  const branchesChange = patch.maxBranches !== undefined && patch.maxBranches !== plan.maxBranches;
  return modulesChange || usersChange || branchesChange;
}

/** The field's problem when it was sent, else null. */
function sentProblem(value: unknown, check: (value: unknown) => string | null): string | null {
  return value === undefined ? null : check(value);
}

/**
 * Why a plan change is refused, or null (spec "The plan rules", `planPatchProblem`; "PATCH
 * /platform/plans/:id", step 4):
 * - any field but name, prices, modules, limits and reason (`key` and `product` included): 400
 *   `patchFields`, as the API's strict schema says;
 * - each field sent, by its rule on create (modules among the plan's product), then the reason: 400;
 * - a plan in use (any subscription row names it, deleted ones included) whose modules, compared as
 *   sets, or either limit would really change: 422 `inUse`. A plan in use keeps every company's
 *   access and ladder as they are (owner question 38).
 */
export function planPatchProblem(
  plan: PlanState,
  patch: PlanPatchFields,
  inUse: boolean,
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): PlanProblem | null {
  if (Object.keys(patch).some((key) => !PATCH_KEYS.includes(key))) return badRequest(PLAN_MESSAGES.patchFields);
  const fieldProblem =
    sentProblem(patch.name, nameProblem) ??
    sentProblem(patch.monthlyPrice, (value) => priceProblem(value, PLAN_MESSAGES.monthlyPrice)) ??
    sentProblem(patch.yearlyPrice, (value) => priceProblem(value, PLAN_MESSAGES.yearlyPrice)) ??
    sentProblem(patch.modules, (value) => modulesProblem(value, plan.product, visible)) ??
    sentProblem(patch.maxUsers, limitProblem) ??
    sentProblem(patch.maxBranches, limitProblem) ??
    adminReasonProblem(patch.reason);
  if (fieldProblem) return badRequest(fieldProblem);
  if (inUse && changesAccess(plan, patch, visible)) {
    return { status: 422, message: PLAN_MESSAGES.inUse };
  }
  return null;
}

/**
 * A price as stored and audited: trimmed and written with two decimals by decimal.js, so `"49"` and
 * `"49.00"` are one price (rule 6: never a float). Only for a price `PLAN_PRICE` accepts.
 */
export function storedPlanPrice(value: string): string {
  return new Decimal(value.trim()).toFixed(2);
}

/**
 * A new plan's values as the API stores them and the audit entry records them (spec "POST
 * /platform/plans", step 5): the name and prices trimmed, prices with two decimals, the modules
 * deduplicated in catalog order without Platform. Only for an input `planProblem` accepts.
 */
export function newPlanValues(
  input: PlatformPlanInput,
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): NewPlanValues {
  return {
    key: input.key,
    name: input.name.trim(),
    product: input.product,
    monthlyPrice: storedPlanPrice(input.monthlyPrice),
    yearlyPrice: storedPlanPrice(input.yearlyPrice),
    modules: planModulesAfter(input.product, [], input.modules, visible),
    maxUsers: input.maxUsers,
    maxBranches: input.maxBranches,
  };
}

/**
 * What a plan change changes, or null when nothing differs, so the save writes nothing, not even an
 * audit row (spec "The plan rules", `planChanges`). Only fields that were sent and differ count:
 * prices are compared with decimal.js (`"49"` equals `"49.00"`), modules as sets after
 * `planModulesAfter`, the name after trimming. Only for a patch `planPatchProblem` accepts.
 */
export function planChanges(
  plan: PlanState,
  patch: PlatformPlanPatch,
  visible: readonly ModuleKey[] = visibleModuleKeys(),
): PlanChanges | null {
  const changes: PlanChanges = { before: {}, after: {} };
  const name = patch.name?.trim();
  if (name !== undefined && name !== plan.name) {
    changes.before.name = plan.name;
    changes.after.name = name;
  }
  for (const field of ["monthlyPrice", "yearlyPrice"] as const) {
    const sent = patch[field];
    if (sent !== undefined && !new Decimal(sent.trim()).equals(plan[field])) {
      changes.before[field] = storedPlanPrice(plan[field]);
      changes.after[field] = storedPlanPrice(sent);
    }
  }
  if (patch.modules !== undefined) {
    const stored = withoutPlatform(inModuleOrder(plan.modules));
    const modules = planModulesAfter(plan.product, plan.modules, patch.modules, visible);
    if (!sameModules(modules, stored)) {
      changes.before.modules = stored;
      changes.after.modules = modules;
    }
  }
  for (const field of ["maxUsers", "maxBranches"] as const) {
    const sent = patch[field];
    if (sent !== undefined && sent !== plan[field]) {
      changes.before[field] = plan[field];
      changes.after[field] = sent;
    }
  }
  return Object.keys(changes.after).length === 0 ? null : changes;
}

/** A plan audit entry before its shape is written (spec "Audit (part 2)"). */
export type PlanAuditEntry =
  | { action: "plan.created"; plan: NewPlanValues; reason: string }
  | { action: "plan.changed"; changes: PlanChanges; reason: string }
  | { action: "plan.retired" | "plan.restored"; reason: string };

/** The `before` and `after` a plan audit row stores. */
export interface PlanAuditBody {
  before: Readonly<Record<string, unknown>> | null;
  after: Readonly<Record<string, unknown>>;
}

/**
 * The `before` and `after` of a plan audit row (spec "Audit (part 2)"), one copy for the API and the
 * demo, so `platformAuditDetails` reads both the same way. The reason is trimmed:
 * - `plan.created`: no `before`; `after` the plan's fields and the reason;
 * - `plan.changed`: the changed fields' old values; their new values and the reason;
 * - `plan.retired` and `plan.restored`: `{ active }` before; `{ active, reason }` after.
 */
export function planAuditBody(entry: PlanAuditEntry): PlanAuditBody {
  const reason = entry.reason.trim();
  switch (entry.action) {
    case "plan.created":
      return { before: null, after: { ...entry.plan, modules: [...entry.plan.modules], reason } };
    case "plan.changed":
      return { before: { ...entry.changes.before }, after: { ...entry.changes.after, reason } };
    case "plan.retired":
      return { before: { active: true }, after: { active: false, reason } };
    case "plan.restored":
      return { before: { active: false }, after: { active: true, reason } };
  }
}
