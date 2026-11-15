import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { ExecutionContext, Type } from "@nestjs/common";
import { ModulesContainer, Reflector } from "@nestjs/core";
import { auditLog, roles as roleTable } from "@workspace/db/company";
import {
  planLimits,
  plans,
  platformAdmins,
  platformAuditLog,
  products,
  tenantDatabases,
  tenantModuleOverrides,
  tenantProducts,
  tenantSubscriptions,
  tenants,
} from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import {
  FEATURES,
  offeredKeys,
  offeredModules,
  PRODUCT_MODULES,
  PROTECTED_CEILING_KEYS,
  type PlatformCompany,
  type PlatformCompanySummary,
  type PlatformDirectory,
} from "@workspace/shared";
import { and, count, desc, eq, sql } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accessLevel } from "../src/core/tenancy/access";
import { PLATFORM_REFUSALS, PlatformAdminGuard } from "../src/modules/platform/platform-admin.guard";
import { AuthHarness, PASSWORD, sessionCookie, SUMMIT_ID, WEB_ORIGIN } from "./auth-harness";
import { listRoutes, type HttpMethod } from "./support/routes";

/** The browser the tests pretend to be, so the platform audit rows can be checked for it. */
const AGENT = "platform-console-test";

/** A TOTP code for the next 30-second step, so a code is never used twice in one step. */
function freshCode(secret: string): string {
  return totpCode(secret, new Date(Date.now() + 30_000));
}

/**
 * The platform console API, part 1 (docs/specs/platform-admin.md; ADR 0052): the platform guard,
 * companies and their access, the restricted directory and the support request, on the control
 * database only. Summit is the seeded company; other companies here have no database of their own.
 */
describe("platform console API (P11 part 1, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let owner = { email: "", cookie: "", secret: "", userId: "" };
  let support = { email: "", cookie: "", secret: "", userId: "" };
  let flooringProductId = "";

  /** A request as the web app's proxy sends it, from the test browser. */
  function call(method: HttpMethod, path: string, cookie?: string) {
    const pending = request(harness.app.getHttpServer())
      [method](path)
      .set("Origin", WEB_ORIGIN)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("User-Agent", AGENT);
    return cookie ? pending.set("Cookie", cookie) : pending;
  }

  /** Signs in a user whose roles need MFA, enrols an authenticator app, and returns the session. */
  async function enrolled(email: string) {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    expect(confirmed.status).toBe(200);
    return {
      email,
      cookie: sessionCookie(confirmed.headers["set-cookie"]),
      secret,
      userId: await harness.userIdOf(email),
    };
  }

  async function stepUp(who: { cookie: string; secret: string }) {
    await harness
      .post("/auth/step-up")
      .set("Cookie", who.cookie)
      .send({ code: freshCode(who.secret) })
      .expect(204);
  }

  /** A Summit sales user with a platform_admins row; `role` may be one the console does not accept. */
  async function adminEmail(role: string, row: { active?: boolean; deleted?: boolean } = {}): Promise<string> {
    const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["sales"] });
    const userId = await harness.userIdOf(email);
    await harness.control.db.insert(platformAdmins).values({
      userId,
      role: "support",
      active: row.active ?? true,
      deletedAt: row.deleted ? new Date() : null,
    });
    // The column is free text with no CHECK (review A4), so a test can store any value.
    await harness.control.db.execute(sql`update platform_admins set role = ${role} where user_id = ${userId}`);
    return email;
  }

  /** Every /platform route on the app, with Summit's id for `:id`. */
  function platformRoutes() {
    const routes = listRoutes(harness.app.getHttpAdapter().getInstance())
      .filter((route) => route.path.startsWith("/platform"))
      .map((route) => ({
        ...route,
        name: `${route.method} ${route.path}`,
        url: route.path.replace(/:[^/]+/g, SUMMIT_ID),
      }));
    expect(routes.length).toBeGreaterThanOrEqual(6);
    return routes;
  }

  async function company(id: string): Promise<PlatformCompany> {
    return (await call("get", `/platform/companies/${id}`, owner.cookie).expect(200)).body as PlatformCompany;
  }

  function patchAccess(id: string, body: object) {
    return call("patch", `/platform/companies/${id}/access`, owner.cookie).send(body);
  }

  async function auditRows(action: string) {
    return harness.control.db
      .select()
      .from(platformAuditLog)
      .where(eq(platformAuditLog.action, action))
      .orderBy(desc(platformAuditLog.at));
  }

  /** A company with no database of its own, on Flooring Suite, as provisioning would leave it. */
  async function flooringCompany(slug: string): Promise<string> {
    const id = await harness.addCompany(`${slug}${Date.now()}`);
    await harness.control.db.insert(tenantProducts).values({ tenantId: id, productId: flooringProductId });
    return id;
  }

  /** Summit's ceiling as the console may send it: only keys of offered, visible modules. */
  async function summitCeiling(): Promise<string[]> {
    const offered = new Set<string>(offeredKeys(["flooring"]));
    return (await company(SUMMIT_ID)).ceiling.filter((key) => offered.has(key));
  }

  beforeAll(async () => {
    await harness.start();
    const [flooring] = await harness.control.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.key, "flooring"));
    flooringProductId = flooring.id;
    owner = await enrolled(await adminEmail("owner"));
    support = await enrolled(await adminEmail("support"));
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("puts every /platform controller, in any module, behind @SessionOnly and the platform guard", () => {
    const reflector = new Reflector();
    const controllers = [...harness.app.get(ModulesContainer).values()]
      .flatMap((module) => [...module.controllers.values()])
      .map((wrapper) => wrapper.metatype as Type)
      .filter((controller) => {
        const paths: unknown = Reflect.getMetadata(PATH_METADATA, controller);
        return [paths].flat().some((path) => String(path).replace(/^\//, "").startsWith("platform"));
      });
    expect(controllers.length).toBeGreaterThanOrEqual(3);
    for (const controller of controllers) {
      expect({ controller: controller.name, guards: Reflect.getMetadata(GUARDS_METADATA, controller) }).toEqual({
        controller: controller.name,
        guards: expect.arrayContaining([PlatformAdminGuard]),
      });
      const prototype = controller.prototype as Record<string, unknown>;
      const handlers = Object.getOwnPropertyNames(prototype)
        .map((name) => prototype[name])
        .filter(
          (handler) => typeof handler === "function" && Reflect.getMetadata(METHOD_METADATA, handler) !== undefined,
        );
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        const context = { getHandler: () => handler, getClass: () => controller } as unknown as ExecutionContext;
        expect({ controller: controller.name, level: accessLevel(reflector, context) }).toEqual({
          controller: controller.name,
          level: "session",
        });
      }
    }
  });

  it("refuses every /platform route, whatever the body, to anyone who is not an active owner or support admin", async () => {
    const plain = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["sales"] }));
    const inactive = await harness.signIn(await adminEmail("owner", { active: false }));
    const deleted = await harness.signIn(await adminEmail("owner", { deleted: true }));
    // An active row with another role still needs MFA (MfaPolicy), so it enrols first.
    const billing = (await enrolled(await adminEmail("billing"))).cookie;
    for (const [who, cookie] of Object.entries({ plain, inactive, deleted, billing })) {
      for (const route of platformRoutes()) {
        const response = await call(route.verb, route.url, cookie).send({ companyId: SUMMIT_ID, ceiling: [] });
        expect({ who, route: route.name, status: response.status, code: response.body.code }).toEqual({
          who,
          route: route.name,
          status: 403,
          code: "forbidden",
        });
      }
    }
    for (const route of platformRoutes()) {
      expect({ route: route.name, status: (await call(route.verb, route.url)).status }).toEqual({
        route: route.name,
        status: 401,
      });
    }
  });

  it("makes a platform admin with no factor enrol MFA first", async () => {
    const unenrolled = await harness.signIn(await adminEmail("owner"));
    const response = await call("get", "/platform/me", unenrolled);
    expect([response.status, response.body.code]).toEqual([403, "mfa_enrolment_required"]);
  });

  it("answers 404 on every /platform route while admin.access is switched off", async () => {
    const feature = FEATURES["admin.access"] as { enabled: boolean };
    feature.enabled = false;
    try {
      for (const route of platformRoutes()) {
        expect({
          route: route.name,
          status: (await call(route.verb, route.url, owner.cookie).send({})).status,
        }).toEqual({
          route: route.name,
          status: 404,
        });
      }
    } finally {
      feature.enabled = true;
    }
  });

  it("says who is using the console", async () => {
    const me = await call("get", "/platform/me", support.cookie).expect(200);
    expect(me.body).toEqual({ userId: support.userId, name: "Test User", email: support.email, role: "support" });
  });

  it("lists companies and shows one in full, from the control database only", async () => {
    const list = (await call("get", "/platform/companies", support.cookie).expect(200))
      .body as PlatformCompanySummary[];
    const summit = list.find((row) => row.id === SUMMIT_ID);
    expect(summit).toMatchObject({
      products: ["flooring"],
      status: "active",
      phase: "full",
      maintenance: { on: false, reason: null },
      plan: "Flooring Pro",
      userLimit: 16,
      branchLimit: 3,
      database: { hasError: false },
    });
    expect(summit?.modules).toEqual(expect.arrayContaining(["platform", "core", "contracts"]));
    expect(summit?.members).toBeGreaterThan(0);
    const detail = await company(SUMMIT_ID);
    expect(detail.ceiling).toEqual(expect.arrayContaining([...PROTECTED_CEILING_KEYS]));
    expect(detail.subscriptions).toEqual([
      expect.objectContaining({ planName: "Flooring Pro", product: "flooring", status: "active", price: "0.00" }),
    ]);
    expect(JSON.stringify(detail)).not.toContain("lastError");
    await call("get", "/platform/companies/not-a-uuid", owner.cookie).expect(400);
    expect((await call("get", `/platform/companies/${uuidv7()}`, owner.cookie).expect(404)).body.code).toBe(
      "not_found",
    );
    const gone = await flooringCompany("gone");
    await harness.control.db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.id, gone));
    await call("get", `/platform/companies/${gone}`, owner.cookie).expect(404);
    await stepUp(owner);
    await patchAccess(gone, {}).expect(404);
  });

  it("gives a restricted directory: the default roles and branding, never users", async () => {
    const directory = (await call("get", `/platform/companies/${SUMMIT_ID}/directory`, support.cookie).expect(200))
      .body as PlatformDirectory;
    expect(directory.restricted).toBe(true);
    expect(directory.users).toEqual([]);
    expect(directory.roles.map((role) => role.key)).toEqual(expect.arrayContaining(["owner", "sales", "employee"]));
    expect(directory.branding).toMatchObject({ displayName: expect.any(String) });
  });

  it("lets only the owner role change access, after a step-up", async () => {
    const refused = await call("patch", `/platform/companies/${SUMMIT_ID}/access`, support.cookie).send({});
    expect([refused.status, refused.body.message]).toEqual([403, PLATFORM_REFUSALS.owner_only]);
    // A session that has not stepped up in the last 5 minutes.
    const fresh = await enrolled(await adminEmail("owner"));
    const noStepUp = await call("patch", `/platform/companies/${SUMMIT_ID}/access`, fresh.cookie).send({});
    expect([noStepUp.status, noStepUp.body.code]).toEqual([403, "step_up_required"]);
  });

  it("refuses a change the rules do not allow, with the spec's messages", async () => {
    await stepUp(owner);
    const ceiling = await summitCeiling();
    const cases: [object, string][] = [
      [{ modules: ["core"] }, "The Platform module can't be switched off."],
      [{ modules: ["platform", "installation"] }, "The Installation module isn't offered to this company."],
      [{ ceiling: [...ceiling, "nope.not.a_key"] }, "nope.not.a_key is not a permission."],
      [
        { ceiling: ceiling.filter((key) => key !== "settings.audit.view") },
        "A company always keeps the Users, Security roles and Audit log permissions, so it can manage its own people.",
      ],
      [{ userLimit: 0 }, "Enter a whole number from 1 to 100,000."],
      [{ branchLimit: 2.5 }, "Enter a whole number from 1 to 100,000."],
    ];
    for (const [body, message] of cases) {
      const response = await patchAccess(SUMMIT_ID, body);
      expect({ body, status: response.status, message: response.body.message }).toEqual({ body, status: 400, message });
    }
    expect((await patchAccess(SUMMIT_ID, { plan: "free" })).status).toBe(400);
  });

  it("refuses limits for a trial with no plan (422) and never creates a subscription row", async () => {
    const trial = await flooringCompany("trial");
    await stepUp(owner);
    const response = await patchAccess(trial, { userLimit: 5 });
    expect([response.status, response.body.code]).toEqual([422, "rule_broken"]);
    const rows = await harness.control.db
      .select({ n: count() })
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, trial));
    expect(rows[0].n).toBe(0);
    expect((await company(trial)).modules).toEqual([...PRODUCT_MODULES.flooring]);
  });

  it("applies a ceiling change to Summit's next request, audits it with the address and device, and restores it", async () => {
    const sales = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["sales"] }));
    await call("get", "/customers", sales).expect(200);
    const ceiling = await summitCeiling();
    const companyLog = async () => {
      const handle = await harness.companyDb(SUMMIT_ID);
      try {
        return (await handle.db.select({ n: count() }).from(auditLog))[0].n;
      } finally {
        await handle.close();
      }
    };
    const companyEntries = await companyLog();
    await stepUp(owner);
    await patchAccess(SUMMIT_ID, { ceiling: ceiling.filter((key) => key !== "customers.customer.view") }).expect(200);
    try {
      expect((await call("get", "/customers", sales)).status).toBe(403);
      const [row] = await auditRows("company.access_changed");
      expect(row).toMatchObject({
        actorUserId: owner.userId,
        tenantId: SUMMIT_ID,
        targetType: "tenant",
        targetId: SUMMIT_ID,
        userAgent: AGENT,
        after: { keysRemoved: ["customers.customer.view"] },
      });
      expect(row.ip).toEqual(expect.any(String));
      expect(await companyLog()).toBe(companyEntries);
    } finally {
      await patchAccess(SUMMIT_ID, { ceiling }).expect(200);
    }
    await call("get", "/customers", sales).expect(200);
  });

  it("writes nothing and no audit row for a save that changes nothing", async () => {
    await stepUp(owner);
    const before = (await auditRows("company.access_changed")).length;
    await patchAccess(SUMMIT_ID, {}).expect(200);
    await patchAccess(SUMMIT_ID, { ceiling: await summitCeiling(), userLimit: 16, branchLimit: 3 }).expect(200);
    expect((await auditRows("company.access_changed")).length).toBe(before);
  });

  it("switches a module off at once, and soft-deletes the override when it goes back to the plan", async () => {
    const sales = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["sales"] }));
    const offered = new Set<string>(offeredModules(["flooring"]));
    const modules = (await company(SUMMIT_ID)).modules.filter((module) => offered.has(module));
    expect(modules).toContain("contracts");
    await stepUp(owner);
    await patchAccess(SUMMIT_ID, { modules: modules.filter((module) => module !== "contracts") }).expect(200);
    try {
      expect((await call("get", "/contracts", sales)).body.code).toBe("module_not_enabled");
    } finally {
      await patchAccess(SUMMIT_ID, { modules }).expect(200);
    }
    expect((await call("get", "/contracts", sales)).body.code).not.toBe("module_not_enabled");
    const overrides = await harness.control.db
      .select({ deletedAt: tenantModuleOverrides.deletedAt })
      .from(tenantModuleOverrides)
      .where(and(eq(tenantModuleOverrides.tenantId, SUMMIT_ID), eq(tenantModuleOverrides.module, "contracts")));
    expect(overrides).toHaveLength(1);
    expect(overrides[0].deletedAt).not.toBeNull();
    const [row] = await auditRows("company.access_changed");
    expect(row.after).toMatchObject({
      modulesSwitchedOn: ["contracts"],
      overrideRows: [{ module: "contracts", action: "remove" }],
    });
  });

  it("refuses the next invitation once the user limit is lowered, and clears the override when it goes back", async () => {
    const summitOwner = await enrolled(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] }));
    const handle = await harness.companyDb(SUMMIT_ID);
    const salesRole = await handle.db.select({ id: roleTable.id }).from(roleTable).where(eq(roleTable.key, "sales"));
    await handle.close();
    await stepUp(owner);
    expect((await patchAccess(SUMMIT_ID, { userLimit: 1 }).expect(200)).body.userLimit).toBe(1);
    try {
      await stepUp(summitOwner);
      const refused = await call("post", "/users/invite", summitOwner.cookie).send({
        name: "No Seat",
        email: `noseat-${Date.now()}@example.test`,
        title: "",
        roleIds: [salesRole[0].id],
        branchId: "",
      });
      expect(refused.body.code).toBe("seat_limit");
    } finally {
      await patchAccess(SUMMIT_ID, { userLimit: 16 }).expect(200);
    }
    const [subscription] = await harness.control.db
      .select({ override: tenantSubscriptions.userLimitOverride })
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, SUMMIT_ID));
    expect(subscription.override).toBeNull();
  });

  it("makes a new user limit the effective one with an active row and a cancelled row on a bigger plan", async () => {
    const id = await flooringCompany("limits");
    const plan = async (key: string, maxUsers: number, maxBranches: number) => {
      const [row] = await harness.control.db
        .insert(plans)
        .values({
          key: `${key}-${id}`,
          name: key,
          productId: flooringProductId,
          monthlyPrice: "10",
          yearlyPrice: "100",
        })
        .returning({ id: plans.id });
      await harness.control.db.insert(planLimits).values({ planId: row.id, maxUsers, maxBranches });
      return row.id;
    };
    const period = { currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) };
    await harness.control.db.insert(tenantSubscriptions).values([
      {
        tenantId: id,
        planId: await plan("Small", 5, 2),
        interval: "monthly",
        price: "10",
        status: "active",
        ...period,
      },
      {
        tenantId: id,
        planId: await plan("Big", 50, 20),
        interval: "monthly",
        price: "90",
        status: "cancelled",
        ...period,
      },
    ]);
    expect(await company(id)).toMatchObject({ userLimit: 50, branchLimit: 20, plan: "Small, Big (cancelled)" });
    await stepUp(owner);
    const changed = (await patchAccess(id, { userLimit: 10 }).expect(200)).body as PlatformCompany;
    expect([changed.userLimit, changed.branchLimit]).toEqual([10, 20]);
    expect(changed.subscriptions.map((row) => row.userLimitOverride)).toEqual([10, 10]);
    const [row] = await auditRows("company.access_changed");
    expect(row).toMatchObject({ before: { userLimit: 50 }, after: { userLimit: 10 } });
  });

  it("answers and saves for a company whose database failed or is in maintenance, without the error text", async () => {
    const failed = await flooringCompany("failed");
    const maintenance = await flooringCompany("maintenance");
    await harness.control.db.insert(tenantDatabases).values([
      {
        tenantId: failed,
        provider: "noop",
        providerRef: "none",
        encryptedUrl: "not-a-connection-string",
        status: "failed",
        lastError: "duplicate key value violates unique constraint: Key (name)=(LEAKED-ROW-VALUE) already exists.",
      },
      {
        tenantId: maintenance,
        provider: "noop",
        providerRef: "none",
        encryptedUrl: "not-a-connection-string",
        status: "ready",
      },
    ]);
    await harness.control.db
      .update(tenants)
      .set({ maintenanceMode: true, maintenanceReason: "migration_failed" })
      .where(eq(tenants.id, maintenance));
    const list = await call("get", "/platform/companies", owner.cookie).expect(200);
    expect(JSON.stringify(list.body)).not.toContain("LEAKED");
    expect(await company(failed)).toMatchObject({ database: { status: "failed", hasError: true } });
    expect(await company(maintenance)).toMatchObject({
      maintenance: { on: true, reason: "migration_failed" },
      database: { status: "ready", hasError: false },
    });
    await stepUp(owner);
    for (const id of [failed, maintenance]) {
      const detail = await call("get", `/platform/companies/${id}`, owner.cookie).expect(200);
      expect(JSON.stringify(detail.body)).not.toContain("LEAKED");
      await call("get", `/platform/companies/${id}/directory`, owner.cookie).expect(200);
      const saved = await patchAccess(id, { ceiling: [...PROTECTED_CEILING_KEYS, "customers.customer.view"] }).expect(
        200,
      );
      expect((saved.body as PlatformCompany).ceiling).toEqual(expect.arrayContaining(["customers.customer.view"]));
    }
  });

  it("lets either admin role ask for support access after a step-up, and audits the address and device", async () => {
    const body = { companyId: SUMMIT_ID, reason: "Customer asked for help with roles", hours: 4 };
    const noStepUp = await call("post", "/platform/support-grants", support.cookie).send(body);
    expect([noStepUp.status, noStepUp.body.code]).toEqual([403, "step_up_required"]);
    await stepUp(support);
    const requested = await call("post", "/platform/support-grants", support.cookie).send(body).expect(201);
    const [row] = await auditRows("support.requested");
    expect(row).toMatchObject({
      actorUserId: support.userId,
      tenantId: SUMMIT_ID,
      targetId: requested.body.id,
      userAgent: AGENT,
    });
    expect(row.ip).toEqual(expect.any(String));
    await call("post", "/platform/support-grants", support.cookie)
      .send({ ...body, companyId: uuidv7() })
      .expect(404);
  });
});
