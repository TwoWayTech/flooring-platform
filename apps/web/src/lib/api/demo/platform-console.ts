import {
  accessDiff,
  offeredKeys,
  offeredModules,
  type AccessDiff,
  type Company,
  type CompanyPhase,
  type PlatformAccessPatch,
  type PlatformCompany,
  type PlatformCompanySummary,
  type PlatformSubscription,
} from "@workspace/shared";

/** What the demo knows about a company beyond its platform fixture: its profile and its people. */
export interface DemoCompanyFacts {
  legalName: string;
  timeZone: string;
  /** People with a sign-in to the company (its fixture users), the console's "Members". */
  members: number;
}

/**
 * The phase of every demo company. The demo runs no life-cycle ladder, maintenance switch or company
 * database, so every company is in full use (docs/specs/platform-admin.md, part 4, "Demo mode").
 */
export const DEMO_PHASE: CompanyPhase = "full";

/** The first day of `today`'s month and of the next one, as ISO moments. */
function monthOf(today: string): { start: string; end: string } {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01T00:00:00.000Z`;
  return { start: iso(year, month), end: iso(next.year, next.month) };
}

/**
 * The demo has no billing: one subscription row stands for each company's plan, so the console
 * treats it as a company with a plan and its limits stay editable, as before. The price is "0.00",
 * like the API's seed, because plan prices are still open (docs/blueprint-delta.md, 2026-11-13).
 */
export function demoSubscription(company: Company, today: string): PlatformSubscription {
  const period = monthOf(today);
  return {
    id: `${company.id}-plan`,
    planKey: company.plan.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    planName: company.plan,
    product: company.product,
    interval: "monthly",
    price: "0.00",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    status: company.status === "suspended" ? "active" : company.status,
    userLimitOverride: null,
    branchLimitOverride: null,
  };
}

/**
 * A demo company as the console's list shows it (docs/specs/platform-admin.md, "Fields"). The demo
 * runs no life-cycle ladder and has no company database or maintenance switch, so every company is
 * in full use, with no database row to show.
 */
export function demoSummary(company: Company, facts: DemoCompanyFacts): PlatformCompanySummary {
  return {
    id: company.id,
    slug: company.id,
    name: company.name,
    city: company.city,
    state: company.state,
    products: [company.product],
    status: company.status,
    statusChangedAt: company.createdAt,
    phase: DEMO_PHASE,
    maintenance: { on: false, reason: null },
    plan: company.plan,
    modules: company.modules,
    userLimit: company.userLimit,
    branchLimit: company.branchLimit,
    members: facts.members,
    database: { status: null, schemaVersion: null, hasError: false, errorCode: null },
  };
}

/** A demo company in full, as the console's access page reads it. */
export function demoDetail(company: Company, facts: DemoCompanyFacts, today: string): PlatformCompany {
  return {
    ...demoSummary(company, facts),
    legalName: facts.legalName,
    timeZone: facts.timeZone,
    region: "us",
    createdAt: company.createdAt,
    ceiling: company.ceiling,
    subscriptions: [demoSubscription(company, today)],
  };
}

/**
 * The company after a change of access (spec "What a save does"), once `accessPatchProblem` has
 * passed it. A list in the change covers the offered, visible modules and keys only; hidden
 * modules (rule 18, Installation) and their keys keep what is stored, so a save never switches
 * off what the screen does not show. Stored order is kept and new items go last.
 */
export function withAccess(company: Company, patch: PlatformAccessPatch): Company {
  const products = [company.product];
  const next = { ...company };
  if (patch.modules !== undefined) {
    const offered = new Set(offeredModules(products));
    const wanted = new Set(patch.modules);
    next.modules = [
      ...company.modules.filter((module) => !offered.has(module) || wanted.has(module)),
      ...[...wanted].filter((module) => !company.modules.includes(module)),
    ];
  }
  if (patch.ceiling !== undefined) {
    const offered = new Set(offeredKeys(products));
    const wanted = new Set(patch.ceiling);
    next.ceiling = [
      ...company.ceiling.filter((key) => !offered.has(key) || wanted.has(key)),
      ...[...wanted].filter((key) => !company.ceiling.includes(key)),
    ];
  }
  if (patch.userLimit !== undefined) next.userLimit = patch.userLimit;
  if (patch.branchLimit !== undefined) next.branchLimit = patch.branchLimit;
  return next;
}

/**
 * What a demo save changed, as the `company.access_changed` row records it (spec "Audit"), or null
 * when it changed nothing. The shared `accessDiff` over the whole company, so a save that changes
 * nothing writes nothing, as on the API (docs/specs/platform-admin.md, part 3, "Demo mode").
 */
export function demoAccessDiff(before: Company, after: Company): AccessDiff | null {
  const stateOf = (company: Company) => ({
    modules: company.modules,
    ceiling: company.ceiling,
    userLimit: company.userLimit,
    branchLimit: company.branchLimit,
  });
  return accessDiff(stateOf(before), stateOf(after));
}
