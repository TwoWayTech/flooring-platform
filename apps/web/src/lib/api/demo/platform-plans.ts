import {
  inModuleOrder,
  isAccessLimit,
  isModuleKey,
  isPlanProduct,
  PLAN_KEY,
  PLAN_NAME,
  PLAN_PRICE,
  type Company,
  type ModuleKey,
  type PlatformPlan,
} from "@workspace/shared";

/*
 * Plans in the demo console (docs/specs/platform-admin.md, part 2, "Demo mode"). The fixture
 * companies' plans as the seed makes them, plus what the presenter created or changed in this
 * browser. A demo plan's id is its key: the HTTP client never sends it, because it is not a UUID.
 * A plan's modules and limits never change a demo company, which holds its own.
 */

/** Where the demo keeps created plans and plan edits in local storage (cleared by Reset demo). */
export const DEMO_PLANS_KEY = "platform-plans";

/** The fields of a demo plan that an edit, a retire or a restore changes. */
export type DemoPlanEdit = Partial<
  Pick<
    PlatformPlan,
    "name" | "monthlyPrice" | "yearlyPrice" | "modules" | "maxUsers" | "maxBranches" | "active" | "updatedAt"
  >
>;

/** What the demo keeps under `platform-plans`: the plans created here and the edits of any plan, by id. */
export interface DemoPlanStore {
  created: PlatformPlan[];
  edits: Record<string, DemoPlanEdit>;
}

/** The key the seed derives from a fixture company's plan name (`seedPlan` in packages/db). */
export function demoPlanKey(planName: string): string {
  return planName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** A date or ISO moment from a fixture as an ISO moment. */
function isoMoment(date: string): string {
  return new Date(date.length === 10 ? `${date}T00:00:00.000Z` : date).toISOString();
}

/**
 * The fixture companies' plans as the seed makes them (packages/db `seedPlan`): one per plan name,
 * the first company on it giving its modules (without Platform) and limits, prices "0.00" until the
 * owner sets them, active, and in use by every fixture company on it. Each fixture plan is in use,
 * so the API's in-use rule refuses the same changes here.
 */
export function demoFixturePlans(companies: readonly Company[]): PlatformPlan[] {
  const plans = new Map<string, PlatformPlan>();
  for (const company of companies) {
    const key = demoPlanKey(company.plan);
    const known = plans.get(key);
    if (known) {
      known.companies += 1;
      continue;
    }
    const created = isoMoment(company.createdAt);
    plans.set(key, {
      id: key,
      key,
      name: company.plan,
      product: company.product,
      monthlyPrice: "0.00",
      yearlyPrice: "0.00",
      modules: inModuleOrder(company.modules.filter((module) => module !== "platform")),
      maxUsers: company.userLimit,
      maxBranches: company.branchLimit,
      active: true,
      companies: 1,
      createdAt: created,
      updatedAt: created,
    });
  }
  return [...plans.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMoment(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= PLAN_NAME.min && value.trim().length <= PLAN_NAME.max;
}

function isPrice(value: unknown): value is string {
  return typeof value === "string" && PLAN_PRICE.test(value);
}

function isModules(value: unknown): value is ModuleKey[] {
  return Array.isArray(value) && value.every((module) => typeof module === "string" && isModuleKey(module));
}

function isLimit(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && isAccessLimit(value));
}

/**
 * Whether a stored value is a plan made in this browser. Local storage can be edited by hand, so a
 * plan that doesn't fit the plan rules is dropped. Created plans are never in use.
 */
function isCreatedPlan(value: unknown): value is PlatformPlan {
  if (!isRecord(value)) return false;
  const { id, key, name, product, monthlyPrice, yearlyPrice, modules, maxUsers, maxBranches } = value;
  return (
    typeof key === "string" &&
    PLAN_KEY.test(key) &&
    id === key &&
    isName(name) &&
    isPlanProduct(product) &&
    isPrice(monthlyPrice) &&
    isPrice(yearlyPrice) &&
    isModules(modules) &&
    isLimit(maxUsers) &&
    isLimit(maxBranches) &&
    typeof value.active === "boolean" &&
    value.companies === 0 &&
    isMoment(value.createdAt) &&
    isMoment(value.updatedAt)
  );
}

/** The fields of a stored edit that fit their rule; anything else in it is dropped. */
function editOf(value: unknown): DemoPlanEdit {
  if (!isRecord(value)) return {};
  const edit: DemoPlanEdit = {};
  if (isName(value.name)) edit.name = value.name;
  if (isPrice(value.monthlyPrice)) edit.monthlyPrice = value.monthlyPrice;
  if (isPrice(value.yearlyPrice)) edit.yearlyPrice = value.yearlyPrice;
  if (isModules(value.modules)) edit.modules = inModuleOrder(value.modules);
  if (isLimit(value.maxUsers)) edit.maxUsers = value.maxUsers;
  if (isLimit(value.maxBranches)) edit.maxBranches = value.maxBranches;
  if (typeof value.active === "boolean") edit.active = value.active;
  if (isMoment(value.updatedAt)) edit.updatedAt = value.updatedAt;
  return edit;
}

/** What is stored under `platform-plans`, read defensively: an unreadable entry is dropped. */
export function demoPlanStore(stored: unknown): DemoPlanStore {
  if (!isRecord(stored)) return { created: [], edits: {} };
  const created = Array.isArray(stored.created) ? stored.created.filter(isCreatedPlan) : [];
  const edits = isRecord(stored.edits)
    ? Object.fromEntries(Object.entries(stored.edits).map(([id, edit]) => [id, editOf(edit)]))
    : {};
  return { created, edits };
}

/** The API's order (`GET /platform/plans`): by product, then name, then key. */
function planOrder(a: PlatformPlan, b: PlatformPlan): number {
  return a.product.localeCompare(b.product) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
}

/**
 * Every demo plan: the fixture plans, then the plans created here whose key no fixture plan holds,
 * each with its stored edits applied, in the API's order.
 */
export function demoPlans(store: DemoPlanStore, fixturePlans: readonly PlatformPlan[]): PlatformPlan[] {
  const fixtureKeys = new Set(fixturePlans.map((plan) => plan.key));
  const created = store.created.filter((plan) => !fixtureKeys.has(plan.key));
  return [...fixturePlans, ...created]
    .map((plan) => ({ ...plan, ...(Object.hasOwn(store.edits, plan.id) ? store.edits[plan.id] : {}) }))
    .sort(planOrder);
}
