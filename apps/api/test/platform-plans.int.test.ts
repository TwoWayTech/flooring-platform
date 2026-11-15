import { auditLog } from "@workspace/db/company";
import {
  planLimits,
  planModules,
  plans,
  platformAdmins,
  platformAuditLog,
  tenantSubscriptions,
} from "@workspace/db/control";
import { loadDemoCompany } from "@workspace/db/seed";
import {
  ACCESS_LIMIT_MESSAGE,
  ADMIN_REASON_MESSAGE,
  FEATURES,
  inModuleOrder,
  isModuleKey,
  PLAN_MESSAGES,
  type CompanyBilling,
  type PlatformCompany,
  type PlatformPlan,
  type PlatformPlanInput,
} from "@workspace/shared";
import { and, asc, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantConnectionService } from "../src/core/tenancy/tenant-connection.service";
import { PLATFORM_REFUSALS } from "../src/modules/platform/platform-admin.guard";
import { AuthHarness, SUMMIT_ID } from "./auth-harness";
import { adminLocks } from "./support/admin-locks";
import { AGENT, platformHelpers, type EnrolledAdmin } from "./support/platform-admins";
import { listRoutes } from "./support/routes";

const REASON = "Setting up the plan the owner asked for";

/** The five plan routes, with a placeholder for `:id`. */
const PLAN_ROUTES = [
  ["get", "/platform/plans"],
  ["post", "/platform/plans"],
  ["patch", "/platform/plans/:id"],
  ["post", "/platform/plans/:id/retire"],
  ["post", "/platform/plans/:id/restore"],
] as const;

/** Keys that must never appear anywhere in a plan answer (spec "PlatformPlan": only a count leaves). */
const NEVER_RETURNED = ["tenantId", "subscriptionId", "companyName", "companyId"];

/** Every key at any depth of a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

let keyCounter = 0;

/** A plan key no other test uses. */
function freshKey(): string {
  keyCounter += 1;
  return `test-${Date.now().toString(36)}-${keyCounter}`;
}

/** A valid new Flooring plan; `overrides` replace fields as sent. */
function planInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const input: PlatformPlanInput = {
    key: freshKey(),
    name: "Flooring Starter",
    product: "flooring",
    monthlyPrice: "49.00",
    yearlyPrice: "490.00",
    modules: ["core", "retail"],
    maxUsers: 5,
    maxBranches: 1,
    reason: REASON,
  };
  return { ...input, ...overrides };
}

/**
 * Plans on the API, platform admin part 2 (docs/specs/platform-admin.md, "Part 2: plans and company
 * status", "Plans"; ADR 0056): the `admin.billing` switch, who may call what, list, create, edit,
 * retire and restore, the in-use rule, no delete, the audit rows, the actor re-check under the lock,
 * and that no write reaches a company database. Summit is the seeded company on Flooring Pro.
 */
describe("platform plans API (platform admin part 2, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp, adminEmail, companyOn } = platformHelpers(harness);
  const { waitForLockWaiters, holdAdminRow } = adminLocks(harness);
  let owner: EnrolledAdmin;
  let support: EnrolledAdmin;
  let summitOwner: EnrolledAdmin;

  /** A fresh owner-role admin, stepped up. */
  async function freshOwner(): Promise<EnrolledAdmin> {
    const admin = await enrolled(await adminEmail("owner"));
    await stepUp(admin);
    return admin;
  }

  async function list(who: EnrolledAdmin = owner): Promise<PlatformPlan[]> {
    return (await call("get", "/platform/plans", who.cookie).expect(200)).body as PlatformPlan[];
  }

  async function planByKey(key: string): Promise<PlatformPlan | undefined> {
    return (await list()).find((plan) => plan.key === key);
  }

  function create(body: object, who: EnrolledAdmin = owner) {
    return call("post", "/platform/plans", who.cookie).send(body);
  }

  function change(planId: string, body: object, who: EnrolledAdmin = owner) {
    return call("patch", `/platform/plans/${planId}`, who.cookie).send(body);
  }

  function retire(planId: string, reason = REASON, who: EnrolledAdmin = owner) {
    return call("post", `/platform/plans/${planId}/retire`, who.cookie).send({ reason });
  }

  function restore(planId: string, reason = REASON, who: EnrolledAdmin = owner) {
    return call("post", `/platform/plans/${planId}/restore`, who.cookie).send({ reason });
  }

  /** Creates a plan as the owner admin and answers it. */
  async function created(overrides: Record<string, unknown> = {}): Promise<PlatformPlan> {
    await stepUp(owner);
    return (await create(planInput(overrides)).expect(201)).body as PlatformPlan;
  }

  /** A response's status, code and message. */
  function refusal(response: { status: number; body: { code?: string; message?: string } }) {
    return { status: response.status, code: response.body.code, message: response.body.message };
  }

  /** The plan audit rows of one plan, oldest first. */
  async function planAudits(planId: string) {
    return harness.control.db
      .select()
      .from(platformAuditLog)
      .where(and(eq(platformAuditLog.targetType, "plan"), eq(platformAuditLog.targetId, planId)))
      .orderBy(asc(platformAuditLog.at), asc(platformAuditLog.id));
  }

  /** How many plans and platform audit rows exist, to prove a refusal wrote nothing. */
  async function writes(): Promise<{ plans: number; modules: number; limits: number; audits: number }> {
    const [plansCount] = await harness.control.db.select({ n: count() }).from(plans);
    const [modulesCount] = await harness.control.db.select({ n: count() }).from(planModules);
    const [limitsCount] = await harness.control.db.select({ n: count() }).from(planLimits);
    const [auditsCount] = await harness.control.db.select({ n: count() }).from(platformAuditLog);
    return { plans: plansCount.n, modules: modulesCount.n, limits: limitsCount.n, audits: auditsCount.n };
  }

  /** Summit's own audit log size, read from its database (the test may; the API never does). */
  async function summitAuditEntries(): Promise<number> {
    const handle = await harness.companyDb(SUMMIT_ID);
    try {
      return (await handle.db.select({ n: count() }).from(auditLog))[0].n;
    } finally {
      await handle.close();
    }
  }

  /** What a plan edit must never change for Summit: its access, limits, phase, standing and price. */
  async function summitFacts() {
    const detail = (await call("get", `/platform/companies/${SUMMIT_ID}`, owner.cookie).expect(200))
      .body as PlatformCompany;
    const standing = (await call("get", "/company/standing", summitOwner.cookie).expect(200)).body as unknown;
    return {
      modules: detail.modules,
      userLimit: detail.userLimit,
      branchLimit: detail.branchLimit,
      phase: detail.phase,
      status: detail.status,
      ceiling: detail.ceiling,
      prices: detail.subscriptions.map((subscription) => subscription.price),
      standing,
    };
  }

  async function summitBilling(): Promise<CompanyBilling> {
    return (await call("get", "/billing", summitOwner.cookie).expect(200)).body as CompanyBilling;
  }

  async function seededPlan(): Promise<PlatformPlan> {
    const plan = await planByKey("flooring-pro");
    if (!plan) throw new Error("The seeded Flooring Pro plan is missing.");
    return plan;
  }

  /** Runs `run` with `admin.billing` switched off, and puts it back. */
  async function withBillingOff(run: () => Promise<void>): Promise<void> {
    const feature = FEATURES["admin.billing"] as { enabled: boolean };
    feature.enabled = false;
    try {
      await run();
    } finally {
      feature.enabled = true;
    }
  }

  beforeAll(async () => {
    await harness.start();
    owner = await enrolled(await adminEmail("owner"));
    support = await enrolled(await adminEmail("support"));
    summitOwner = await enrolled(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] }));
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("P-1: answers 404 on the five plan routes to everyone while admin.billing is off; the rest of the console works", async () => {
    const plain = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["sales"] }));
    const plan = await seededPlan();
    await stepUp(owner);
    await withBillingOff(async () => {
      for (const [who, cookie] of Object.entries({ owner: owner.cookie, support: support.cookie, plain })) {
        for (const [verb, path] of PLAN_ROUTES) {
          const response = await call(verb, path.replace(":id", plan.id), cookie).send({ reason: REASON });
          expect({ who, route: `${verb} ${path}`, status: response.status }).toEqual({
            who,
            route: `${verb} ${path}`,
            status: 404,
          });
        }
      }
      await call("get", "/platform/companies", owner.cookie).expect(200);
    });
    expect((await planAudits(plan.id)).length).toBe(0);
    await call("get", "/platform/plans", owner.cookie).expect(200);
  });

  it("P-2: lets the support role list plans but not write them, and the owner role write only after a step-up", async () => {
    const plan = await seededPlan();
    await list(support);
    await stepUp(support);
    const writesBySupport = [
      create(planInput(), support),
      change(plan.id, { name: "Renamed", reason: REASON }, support),
      retire(plan.id, REASON, support),
      restore(plan.id, REASON, support),
    ];
    for (const response of await Promise.all(writesBySupport)) {
      expect(refusal(response)).toEqual({ status: 403, code: "forbidden", message: PLATFORM_REFUSALS.owner_only });
    }
    const fresh = await enrolled(await adminEmail("owner"));
    for (const response of [await create(planInput(), fresh), await retire(plan.id, REASON, fresh)]) {
      expect(refusal(response).code).toBe("step_up_required");
    }
    expect((await planAudits(plan.id)).length).toBe(0);
  });

  it("P-3: lists the seeded plan exactly, as data with only a company count, never cached and never audited", async () => {
    const before = await writes();
    const response = await call("get", "/platform/plans", support.cookie).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.body as PlatformPlan[];
    const summit = loadDemoCompany("summit").company;
    expect(body.find((plan) => plan.key === "flooring-pro")).toEqual({
      id: expect.any(String),
      key: "flooring-pro",
      name: "Flooring Pro",
      product: "flooring",
      monthlyPrice: "0.00",
      yearlyPrice: "0.00",
      modules: inModuleOrder(summit.modules.filter(isModuleKey).filter((module) => module !== "platform")),
      maxUsers: 16,
      maxBranches: 3,
      active: true,
      companies: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(body.find((plan) => plan.key === "flooring-pro")?.modules).not.toContain("platform");
    expect(keysOf(body).filter((key) => NEVER_RETURNED.includes(key))).toEqual([]);
    const products = body.map((plan) => plan.product);
    expect(products).toEqual([...products].sort());
    expect((await call("get", "/platform/plans?extra=1", owner.cookie)).status).toBe(400);
    expect(await writes()).toEqual(before);
  });

  it("P-4: creates a plan with every row stamped by the admin and one plan.created audit row", async () => {
    await stepUp(owner);
    const key = freshKey();
    const response = await create(
      planInput({
        key,
        name: "  Flooring Starter  ",
        monthlyPrice: " 49 ",
        yearlyPrice: "490.5",
        modules: ["retail", "platform", "core", "retail"],
        maxUsers: 5,
        maxBranches: 2,
        reason: `  ${REASON}  `,
      }),
    ).expect(201);
    const plan = response.body as PlatformPlan;
    expect(plan).toEqual({
      id: expect.any(String),
      key,
      name: "Flooring Starter",
      product: "flooring",
      monthlyPrice: "49.00",
      yearlyPrice: "490.50",
      modules: ["core", "retail"],
      maxUsers: 5,
      maxBranches: 2,
      active: true,
      companies: 0,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await planByKey(key)).toEqual(plan);
    const [row] = await harness.control.db.select().from(plans).where(eq(plans.id, plan.id));
    expect(row.createdBy).toBe(owner.userId);
    const moduleRows = await harness.control.db.select().from(planModules).where(eq(planModules.planId, plan.id));
    expect(moduleRows.map((module) => module.module).sort()).toEqual(["core", "retail"]);
    expect(moduleRows.every((module) => module.createdBy === owner.userId)).toBe(true);
    const limitRows = await harness.control.db.select().from(planLimits).where(eq(planLimits.planId, plan.id));
    expect(limitRows.map((limits) => [limits.maxUsers, limits.maxBranches, limits.createdBy])).toEqual([
      [5, 2, owner.userId],
    ]);
    const audits = await planAudits(plan.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "plan.created",
      actorUserId: owner.userId,
      createdBy: owner.userId,
      tenantId: null,
      targetType: "plan",
      targetId: plan.id,
      userAgent: AGENT,
      before: null,
      after: {
        key,
        name: "Flooring Starter",
        product: "flooring",
        monthlyPrice: "49.00",
        yearlyPrice: "490.50",
        modules: ["core", "retail"],
        maxUsers: 5,
        maxBranches: 2,
        reason: REASON,
      },
    });
    expect(Object.keys(audits[0].after as object).sort()).toEqual(
      ["key", "maxBranches", "maxUsers", "modules", "monthlyPrice", "name", "product", "reason", "yearlyPrice"].sort(),
    );
    expect(audits[0].ip).toEqual(expect.any(String));
  });

  it("P-5: refuses each bad field with its message and a taken key with 409, writing nothing", async () => {
    await stepUp(owner);
    const before = await writes();
    const cases: [Record<string, unknown>, string][] = [
      [{ key: undefined }, PLAN_MESSAGES.key],
      [{ key: "A" }, PLAN_MESSAGES.key],
      [{ key: `a${"b".repeat(40)}` }, PLAN_MESSAGES.key],
      [{ key: "flooring_pro" }, PLAN_MESSAGES.key],
      [{ name: "   " }, PLAN_MESSAGES.name],
      [{ name: "n".repeat(81) }, PLAN_MESSAGES.name],
      [{ name: 7 }, PLAN_MESSAGES.name],
      [{ product: "retail" }, PLAN_MESSAGES.product],
      [{ product: undefined }, PLAN_MESSAGES.product],
      [{ monthlyPrice: "1.234" }, PLAN_MESSAGES.monthlyPrice],
      [{ monthlyPrice: 49 }, PLAN_MESSAGES.monthlyPrice],
      [{ yearlyPrice: "-1" }, PLAN_MESSAGES.yearlyPrice],
      [{ yearlyPrice: "1e3" }, PLAN_MESSAGES.yearlyPrice],
      [{ modules: "core" }, PLAN_MESSAGES.modules],
      [{ modules: [] }, PLAN_MESSAGES.modulesEmpty],
      [{ modules: ["platform"] }, PLAN_MESSAGES.modulesEmpty],
      [{ modules: ["core", "nope"] }, PLAN_MESSAGES.moduleUnknown("nope")],
      [{ product: "hr", modules: ["hr", "core"] }, PLAN_MESSAGES.moduleNotOffered("core", "hr")],
      // Installation is hidden while its switch is off (rule 18).
      [{ modules: ["core", "installation"] }, PLAN_MESSAGES.moduleNotOffered("installation", "flooring")],
      [{ maxUsers: 0 }, ACCESS_LIMIT_MESSAGE],
      [{ maxUsers: 100_001 }, ACCESS_LIMIT_MESSAGE],
      [{ maxBranches: 1.5 }, ACCESS_LIMIT_MESSAGE],
      [{ maxBranches: "5" }, ACCESS_LIMIT_MESSAGE],
      [{ reason: "too short" }, ADMIN_REASON_MESSAGE],
      [{ reason: "   " + "x".repeat(501) }, ADMIN_REASON_MESSAGE],
      [{ reason: undefined }, ADMIN_REASON_MESSAGE],
    ];
    for (const [overrides, message] of cases) {
      const body = JSON.parse(JSON.stringify(planInput(overrides))) as object;
      const response = await create(body);
      expect({ overrides, ...refusal(response) }).toEqual({
        overrides,
        status: 400,
        code: "invalid_request",
        message,
      });
    }
    const unknownField = await create(planInput({ extra: 1 }));
    expect([unknownField.status, unknownField.body.code]).toEqual([400, "invalid_request"]);
    expect(refusal(await create(planInput({ key: "flooring-pro" })))).toEqual({
      status: 409,
      code: "conflict",
      message: PLAN_MESSAGES.keyTaken,
    });
    expect(await writes()).toEqual(before);
    const retired = await created();
    await retire(retired.id).expect(200);
    expect(refusal(await create(planInput({ key: retired.key })))).toEqual({
      status: 409,
      code: "conflict",
      message: PLAN_MESSAGES.keyTaken,
    });
    // Two parallel creates of one key, by two admins: one plan, one audit row.
    const second = await freshOwner();
    await stepUp(owner);
    const key = freshKey();
    const results = await Promise.all([create(planInput({ key })), create(planInput({ key }), second)]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    const rows = await harness.control.db.select({ id: plans.id }).from(plans).where(eq(plans.key, key));
    expect(rows).toHaveLength(1);
    expect((await planAudits(rows[0].id)).map((row) => row.action)).toEqual(["plan.created"]);
  });

  it("P-6: edits a plan no company uses, keeps a stored hidden module, and writes nothing for a save that changes nothing", async () => {
    const plan = await created({ modules: ["core", "retail"], maxUsers: 5, maxBranches: 1 });
    // A stored hidden module, as Flooring Pro holds Installation; the console can't send it.
    await harness.control.db.insert(planModules).values({ planId: plan.id, module: "installation" });
    await stepUp(owner);
    const edited = (
      await change(plan.id, {
        name: " Flooring Plus ",
        monthlyPrice: "59",
        yearlyPrice: "590.00",
        modules: ["contracts", "core"],
        maxUsers: 8,
        maxBranches: 2,
        reason: REASON,
      }).expect(200)
    ).body as PlatformPlan;
    expect(edited).toMatchObject({
      name: "Flooring Plus",
      monthlyPrice: "59.00",
      yearlyPrice: "590.00",
      modules: ["core", "installation", "contracts"],
      maxUsers: 8,
      maxBranches: 2,
      companies: 0,
    });
    const retailRow = async () =>
      (
        await harness.control.db
          .select()
          .from(planModules)
          .where(and(eq(planModules.planId, plan.id), eq(planModules.module, "retail")))
      )[0];
    const removed = await retailRow();
    expect(removed.deletedAt).not.toBeNull();
    const [changed] = (await planAudits(plan.id)).filter((row) => row.action === "plan.changed");
    expect(changed).toMatchObject({
      actorUserId: owner.userId,
      tenantId: null,
      before: {
        name: "Flooring Starter",
        monthlyPrice: "49.00",
        yearlyPrice: "490.00",
        modules: ["core", "retail", "installation"],
        maxUsers: 5,
        maxBranches: 1,
      },
      after: {
        name: "Flooring Plus",
        monthlyPrice: "59.00",
        yearlyPrice: "590.00",
        modules: ["core", "installation", "contracts"],
        maxUsers: 8,
        maxBranches: 2,
        reason: REASON,
      },
    });
    const readded = (await change(plan.id, { modules: ["core", "retail", "contracts"], reason: REASON }).expect(200))
      .body as PlatformPlan;
    expect(readded.modules).toEqual(["core", "retail", "installation", "contracts"]);
    const restoredRow = await retailRow();
    expect([restoredRow.id, restoredRow.deletedAt]).toEqual([removed.id, null]);
    const [installation] = await harness.control.db
      .select()
      .from(planModules)
      .where(and(eq(planModules.planId, plan.id), eq(planModules.module, "installation")));
    expect(installation.deletedAt).toBeNull();
    const audits = (await planAudits(plan.id)).length;
    await change(plan.id, {
      name: "Flooring Plus",
      monthlyPrice: "59.0",
      modules: ["contracts", "retail", "core"],
      maxUsers: 8,
      reason: REASON,
    }).expect(200);
    await change(plan.id, { reason: REASON }).expect(200);
    expect((await planAudits(plan.id)).length).toBe(audits);
    for (const body of [
      { key: "other-key", reason: REASON },
      { product: "hr", reason: REASON },
      { extra: 1, reason: REASON },
    ]) {
      expect({ body, ...refusal(await change(plan.id, body)) }).toEqual({
        body,
        status: 400,
        code: "invalid_request",
        message: PLAN_MESSAGES.patchFields,
      });
    }
    expect(refusal(await change(plan.id, { name: "x", reason: "short" }))).toEqual({
      status: 400,
      code: "invalid_request",
      message: ADMIN_REASON_MESSAGE,
    });
    expect((await planAudits(plan.id)).length).toBe(audits);
  });

  it("P-7: renames and reprices a plan in use without changing any company's access, and refuses a module or limit change (422)", async () => {
    const plan = await seededPlan();
    const facts = await summitFacts();
    const billing = await summitBilling();
    expect(billing.subscriptions.map((subscription) => subscription.planName)).toEqual(["Flooring Pro"]);
    await stepUp(owner);
    try {
      const renamed = (
        await change(plan.id, {
          name: "Flooring Pro Plus",
          monthlyPrice: "129.00",
          yearlyPrice: "1290",
          reason: REASON,
        }).expect(200)
      ).body as PlatformPlan;
      expect(renamed).toMatchObject({ name: "Flooring Pro Plus", monthlyPrice: "129.00", yearlyPrice: "1290.00" });
      expect((await summitBilling()).subscriptions.map((subscription) => subscription.planName)).toEqual([
        "Flooring Pro Plus",
      ]);
      expect(await summitFacts()).toEqual(facts);
      const visible = plan.modules.filter((module) => module !== "installation");
      for (const body of [
        { modules: visible.filter((module) => module !== "contracts"), reason: REASON },
        { modules: [...visible, "wholesale"], reason: REASON },
        { maxUsers: 17, reason: REASON },
        { maxBranches: 4, reason: REASON },
      ]) {
        expect({ body, ...refusal(await change(plan.id, body)) }).toEqual({
          body,
          status: 422,
          code: "rule_broken",
          message: PLAN_MESSAGES.inUse,
        });
      }
      const audits = (await planAudits(plan.id)).length;
      await change(plan.id, { modules: [...visible].reverse(), maxUsers: 16, reason: REASON }).expect(200);
      expect((await planAudits(plan.id)).length).toBe(audits);
      expect(await summitFacts()).toEqual(facts);
    } finally {
      await stepUp(owner);
      await change(plan.id, { name: "Flooring Pro", monthlyPrice: "0", yearlyPrice: "0", reason: REASON }).expect(200);
    }
    expect((await summitBilling()).subscriptions.map((subscription) => subscription.planName)).toEqual([
      "Flooring Pro",
    ]);
    // A plan named only by a deleted subscription row is in use too.
    const used = await created();
    const company = await companyOn("p7deleted");
    await harness.control.db.insert(tenantSubscriptions).values({
      tenantId: company,
      planId: used.id,
      interval: "monthly",
      price: "0",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      status: "cancelled",
      deletedAt: new Date(),
    });
    expect((await planByKey(used.key))?.companies).toBe(1);
    await stepUp(owner);
    expect(refusal(await change(used.id, { modules: ["core"], reason: REASON }))).toEqual({
      status: 422,
      code: "rule_broken",
      message: PLAN_MESSAGES.inUse,
    });
    await change(used.id, { name: "Renamed in use", reason: REASON }).expect(200);
  });

  it("P-8: retires and restores a plan, audited, 409 when it already is so, and changes no company", async () => {
    const plan = await created();
    await stepUp(owner);
    expect(refusal(await restore(plan.id))).toEqual({
      status: 409,
      code: "conflict",
      message: PLAN_MESSAGES.notRetired,
    });
    expect(refusal(await retire(plan.id, "short"))).toEqual({
      status: 400,
      code: "invalid_request",
      message: ADMIN_REASON_MESSAGE,
    });
    const extra = await call("post", `/platform/plans/${plan.id}/retire`, owner.cookie).send({
      reason: REASON,
      extra: 1,
    });
    expect([extra.status, extra.body.code]).toEqual([400, "invalid_request"]);
    expect(((await retire(plan.id).expect(200)).body as PlatformPlan).active).toBe(false);
    expect((await planByKey(plan.key))?.active).toBe(false);
    expect(refusal(await retire(plan.id))).toEqual({
      status: 409,
      code: "conflict",
      message: PLAN_MESSAGES.alreadyRetired,
    });
    expect(((await restore(plan.id).expect(200)).body as PlatformPlan).active).toBe(true);
    const audits = await planAudits(plan.id);
    expect(audits.map((row) => [row.action, row.before, row.after])).toEqual([
      ["plan.created", null, expect.any(Object)],
      ["plan.retired", { active: true }, { active: false, reason: REASON }],
      ["plan.restored", { active: false }, { active: true, reason: REASON }],
    ]);
    // Retiring the plan Summit is on changes nothing for Summit.
    const seeded = await seededPlan();
    const facts = await summitFacts();
    const label = (await call("get", `/platform/companies/${SUMMIT_ID}`, owner.cookie).expect(200)).body.plan;
    await retire(seeded.id).expect(200);
    try {
      expect(await summitFacts()).toEqual(facts);
      expect((await call("get", `/platform/companies/${SUMMIT_ID}`, owner.cookie).expect(200)).body.plan).toBe(label);
    } finally {
      await restore(seeded.id).expect(200);
    }
  });

  it("P-9: has no route that deletes a plan", async () => {
    const plan = await created();
    const routes = listRoutes(harness.app.getHttpAdapter().getInstance()).filter((route) =>
      route.path.startsWith("/platform"),
    );
    expect(routes.filter((route) => route.method === "DELETE")).toEqual([]);
    await stepUp(owner);
    expect((await call("delete", `/platform/plans/${plan.id}`, owner.cookie)).status).toBe(404);
    const [row] = await harness.control.db.select().from(plans).where(eq(plans.id, plan.id));
    expect(row.deletedAt).toBeNull();
  });

  it("P-10: answers 400 for an id that is not a UUID and 404 for an unknown or deleted plan", async () => {
    await stepUp(owner);
    for (const response of [
      await change("not-a-uuid", { reason: REASON }),
      await retire("not-a-uuid"),
      await restore("not-a-uuid"),
    ]) {
      expect([response.status, response.body.code]).toEqual([400, "invalid_request"]);
    }
    const gone = await created();
    await harness.control.db.update(plans).set({ deletedAt: new Date() }).where(eq(plans.id, gone.id));
    expect(await planByKey(gone.key)).toBeUndefined();
    for (const id of [uuidv7(), gone.id]) {
      for (const response of [
        await change(id, { name: "Gone", reason: REASON }),
        await retire(id),
        await restore(id),
      ]) {
        expect(refusal(response)).toEqual({ status: 404, code: "not_found", message: PLAN_MESSAGES.notFound });
      }
    }
    expect((await planAudits(gone.id)).map((row) => row.action)).toEqual(["plan.created"]);
  });

  it("P-11: opens no company database and writes nothing to a company's audit log", async () => {
    const service = harness.app.get(TenantConnectionService);
    const pools = service.openPools;
    const entries = await summitAuditEntries();
    const plan = await created();
    await stepUp(owner);
    await change(plan.id, { name: "Pool check", modules: ["core"], reason: REASON }).expect(200);
    await retire(plan.id).expect(200);
    await restore(plan.id).expect(200);
    await list();
    expect(service.openPools).toBe(pools);
    expect(await summitAuditEntries()).toBe(entries);
  });

  it("P-12: runs two parallel edits of one plan one after the other; both are audited and the later one is stored", async () => {
    const plan = await created();
    const second = await freshOwner();
    await stepUp(owner);
    const results = await Promise.all([
      change(plan.id, { name: "First name", reason: REASON }),
      change(plan.id, { name: "Second name", reason: REASON }, second),
    ]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    const changed = (await planAudits(plan.id)).filter((row) => row.action === "plan.changed");
    expect(changed).toHaveLength(2);
    const [later] = await harness.control.db
      .select({ after: platformAuditLog.after })
      .from(platformAuditLog)
      .where(and(eq(platformAuditLog.targetId, plan.id), eq(platformAuditLog.action, "plan.changed")))
      .orderBy(desc(platformAuditLog.at))
      .limit(1);
    const [stored] = await harness.control.db.select({ name: plans.name }).from(plans).where(eq(plans.id, plan.id));
    expect(stored.name).toBe((later.after as { name: string }).name);
  });

  it("P-13: re-checks the admin under the lock on their own row: deactivated or moved to support while waiting gets 403", async () => {
    const changes: [string, (userId: string) => SQL, string][] = [
      [
        "deactivated",
        (userId) => sql`update platform_admins set active = false where user_id = ${userId}`,
        PLATFORM_REFUSALS.not_admin,
      ],
      [
        "support",
        (userId) => sql`update platform_admins set role = 'support' where user_id = ${userId}`,
        PLATFORM_REFUSALS.owner_only,
      ],
    ];
    for (const [label, statement, message] of changes) {
      const racer = await freshOwner();
      const key = freshKey();
      const before = await writes();
      const held = await holdAdminRow(racer.userId, async (tx) => {
        await tx.execute(statement(racer.userId));
      });
      try {
        const pending = create(planInput({ key }), racer).then((response) => refusal(response));
        await waitForLockWaiters(1);
        held.release();
        expect({ label, ...(await pending) }).toEqual({ label, status: 403, code: "forbidden", message });
      } finally {
        await held.finish();
      }
      expect(await harness.control.db.select().from(plans).where(eq(plans.key, key))).toEqual([]);
      expect(await writes()).toEqual(before);
      const [row] = await harness.control.db
        .select({ active: platformAdmins.active, role: platformAdmins.role })
        .from(platformAdmins)
        .where(and(eq(platformAdmins.userId, racer.userId), isNull(platformAdmins.deletedAt)));
      expect(row).toEqual(
        label === "deactivated" ? { active: false, role: "owner" } : { active: true, role: "support" },
      );
    }
  });
});
