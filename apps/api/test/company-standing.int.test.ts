import { RequestMethod, type ExecutionContext, type Type } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer, Reflector } from "@nestjs/core";
import { auditLog } from "@workspace/db/company";
import { member, platformAuditLog, tenantDatabases } from "@workspace/db/control";
import { PRODUCT_HEADER, STANDING_SCREENS, type CompanyStandingState } from "@workspace/shared";
import { and, count, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { accessLevel } from "../src/core/tenancy/access";
import { companyMaintenance, companyUnavailable } from "../src/core/tenancy/company-unavailable";
import { TenantConnectionService } from "../src/core/tenancy/tenant-connection.service";
import { TENANCY_REFUSALS } from "../src/core/tenancy/tenant.guard";
import { BillingController } from "../src/modules/billing/billing.controller";
import { CompanyStandingController } from "../src/modules/billing/company-standing.controller";
import { StandingMemberGuard } from "../src/modules/billing/company-standing.guard";
import { AuthHarness, SUMMIT_ID } from "./auth-harness";
import { companyFacts, daysFromNow } from "./support/company-facts";
import { IsolationProbeModule } from "./support/isolation-probe";
import { platformHelpers, type EnrolledAdmin } from "./support/platform-admins";

const STANDING = "/company/standing";
const PROBE = "/isolation-probe/branches";

/**
 * `GET /company/standing` (docs/specs/platform-admin.md, part 4; ADR 0054): the session-only route
 * behind StandingMemberGuard. Its refusals are TenantGuard's, its answer is one of five words, the
 * same for every member, and for every state the isolation probe's company route shows that
 * TenantGuard does what the word says. It opens no company database and writes no audit row.
 */
describe("company standing API (platform admin part 4, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, companyOn } = platformHelpers(harness);
  const facts = companyFacts(harness);
  let company = { id: "", slug: "" };
  let sales = "";
  let owner: EnrolledAdmin = { email: "", cookie: "", secret: "", userId: "" };

  beforeAll(async () => {
    await harness.start([IsolationProbeModule]);
    company = await harness.provisionCompany("standing");
    sales = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    owner = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
  }, 120_000);

  afterEach(async () => {
    await facts.reset(company.id);
  });

  afterAll(async () => {
    await harness.stop();
  });

  /** A refusal's status and code. */
  function refusal(response: { status: number; body: unknown }) {
    return { status: response.status, code: (response.body as { code?: string }).code };
  }

  /**
   * The Owner's and the sales member's answers, which must be equal, exactly `{ state }` and never
   * cached; returns the state.
   */
  async function standing(): Promise<CompanyStandingState> {
    const bodies: unknown[] = [];
    for (const cookie of [owner.cookie, sales]) {
      const response = await call("get", STANDING, cookie).expect(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(response.body as object)).toEqual(["state"]);
      bodies.push(response.body);
    }
    expect(bodies[0]).toEqual(bodies[1]);
    return (bodies[0] as { state: CompanyStandingState }).state;
  }

  /** What TenantGuard does to the isolation probe's company route, for a read and for a write. */
  async function probe() {
    const read = await call("get", PROBE, sales);
    const write = await call("post", PROBE, sales).send({ name: "Standing probe" });
    return { read: refusal(read), write: refusal(write) };
  }

  const passes = { read: { status: 200, code: undefined }, write: { status: 201, code: undefined } };
  const readOnly = { read: { status: 200, code: undefined }, write: { status: 403, code: "company_read_only" } };
  const locked = { status: 403, code: "company_suspended" };
  const maintenance = { status: 503, code: "company_maintenance" };
  const unavailable = { status: 503, code: "company_unavailable" };

  it("S-1: refuses a request without a session", async () => {
    expect((await call("get", STANDING)).status).toBe(401);
  });

  it("S-2: needs an open company: a member of two companies with none chosen gets company_required", async () => {
    const other = await companyOn("standingother");
    const both = await harness.signIn(await harness.addUser({ companyIds: [company.id, other] }));
    const response = await call("get", STANDING, both);
    expect(response.body).toEqual({ code: "company_required", message: TENANCY_REFUSALS.company_required });
    expect(response.status).toBe(403);
  });

  it("S-3: refuses a deleted company with company_required", async () => {
    await facts.setTenant(company.id, { deletedAt: new Date() });
    expect(refusal(await call("get", STANDING, sales))).toEqual({ status: 403, code: "company_required" });
  });

  it("S-4: refuses a session whose membership was removed with not_a_member", async () => {
    const email = await harness.addUser({ companyIds: [company.id] });
    const cookie = await harness.signIn(email);
    await call("get", STANDING, cookie).expect(200);
    await harness.control.db
      .delete(member)
      .where(and(eq(member.userId, await harness.userIdOf(email)), eq(member.organizationId, company.id)));
    const response = await call("get", STANDING, cookie);
    expect(response.body).toEqual({ code: "not_a_member", message: TENANCY_REFUSALS.not_a_member });
    expect(response.status).toBe(403);
  });

  it("S-5: refuses the HR host for a Flooring-only company, and answers with no header or its own", async () => {
    const hr = await call("get", STANDING, sales).set(PRODUCT_HEADER, "hr");
    expect(hr.body).toEqual({ code: "product_not_enabled", message: TENANCY_REFUSALS.product_not_enabled });
    expect(hr.status).toBe(403);
    await call("get", STANDING, sales).expect(200);
    await call("get", STANDING, sales).set(PRODUCT_HEADER, "flooring").expect(200);
  });

  it("S-6: refuses an Owner who has not set up MFA yet", async () => {
    const cookie = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    expect(refusal(await call("get", STANDING, cookie))).toEqual({ status: 403, code: "mfa_enrolment_required" });
  });

  it("S-7: a trial with no subscription rows is in full use", async () => {
    expect(await standing()).toBe("full");
    expect(await probe()).toEqual(passes);
  });

  it("S-8: a live trial, and a paid plan inside its 14-day grace, are in full use", async () => {
    await facts.addSubscription(company.id, { status: "trial", price: "0", interval: "monthly", endInDays: 10 });
    expect(await standing()).toBe("full");
    expect(await probe()).toEqual(passes);
    await facts.reset(company.id);
    await facts.addSubscription(company.id, { status: "active", price: "99", interval: "monthly", endInDays: -3 });
    expect(await standing()).toBe("full");
    expect(await probe()).toEqual(passes);
  });

  it("S-9: a paid plan lapsed 20 days ago is read only", async () => {
    await facts.addSubscription(company.id, { status: "active", price: "99", interval: "monthly", endInDays: -20 });
    expect(await standing()).toBe("read_only");
    expect(await probe()).toEqual(readOnly);
  });

  it("S-10: suspended after paying is read only; suspended before paying locks after 30 days; active again is full", async () => {
    await facts.addSubscription(company.id, { status: "active", price: "99", interval: "monthly", endInDays: 20 });
    await facts.setTenant(company.id, { status: "suspended" });
    expect(await standing()).toBe("read_only");
    expect(await probe()).toEqual(readOnly);
    await facts.reset(company.id);
    await facts.setStatusSince(company.id, "suspended", daysFromNow(-31));
    expect(await standing()).toBe("locked");
    expect((await probe()).read).toEqual(locked);
    await facts.setTenant(company.id, { status: "active" });
    expect(await standing()).toBe("full");
    expect(await probe()).toEqual(passes);
  });

  it("S-11: cancelled before paying is read only, then locked after 30 days", async () => {
    await facts.setTenant(company.id, { status: "cancelled" });
    expect(await standing()).toBe("read_only");
    expect(await probe()).toEqual(readOnly);
    await facts.setStatusSince(company.id, "cancelled", daysFromNow(-31));
    expect(await standing()).toBe("locked");
    expect((await probe()).read).toEqual(locked);
  });

  it("S-12: a read-only database makes the company read only", async () => {
    await facts.setDatabase(company.id, "read_only");
    expect(await standing()).toBe("read_only");
    expect(await probe()).toEqual(readOnly);
  });

  it("S-13: maintenance comes first, for a failed migration or a move, also while locked", async () => {
    for (const reason of ["migration_failed", "move"] as const) {
      await facts.setTenant(company.id, { maintenanceMode: true, maintenanceReason: reason });
      expect(await standing()).toBe("maintenance");
      expect(await probe()).toEqual({ read: maintenance, write: maintenance });
    }
    await facts.setStatusSince(company.id, "suspended", daysFromNow(-31));
    expect(await standing()).toBe("maintenance");
    expect((await probe()).read).toEqual(maintenance);
    await facts.setTenant(company.id, { maintenanceMode: false, maintenanceReason: null });
    expect(await standing()).toBe("locked");
  });

  it("S-14: a database that is migrating, provisioning or failed makes the company unavailable", async () => {
    for (const status of ["migrating", "provisioning", "failed"] as const) {
      await facts.setDatabase(company.id, status);
      expect(await standing()).toBe("unavailable");
      expect(await probe()).toEqual({ read: unavailable, write: unavailable });
    }
  });

  it("S-15: no database row reads unavailable; a ready row reads full from control rows even when it can't be reached", async () => {
    const bare = await companyOn("standingbare");
    const cookie = await harness.signIn(await harness.addUser({ companyIds: [bare] }));
    expect((await call("get", STANDING, cookie).expect(200)).body).toEqual({ state: "unavailable" });
    expect(refusal(await call("get", PROBE, cookie))).toEqual(unavailable);
    await harness.control.db.insert(tenantDatabases).values({
      tenantId: bare,
      provider: "postgres",
      providerRef: "unreachable",
      encryptedUrl: "not-an-encrypted-url",
      status: "ready",
    });
    expect((await call("get", STANDING, cookie).expect(200)).body).toEqual({ state: "full" });
    expect((await call("get", PROBE, cookie)).status).toBeGreaterThanOrEqual(400);
  });

  it("S-16: opens no company database, however often it is read", async () => {
    const fresh = await harness.provisionCompany("standingpools");
    const cookie = await harness.signIn(await harness.addUser({ companyIds: [fresh.id] }));
    const service = harness.app.get(TenantConnectionService);
    const before = service.openPools;
    for (let i = 0; i < 20; i += 1) await call("get", STANDING, cookie).expect(200);
    expect(service.openPools).toBe(before);
    // The count does move when a company route opens the database, so the check above means something.
    await call("get", PROBE, cookie).expect(200);
    expect(service.openPools).toBe(before + 1);
  });

  it("S-17: writes no audit row, for standing or billing reads, and sends no-store on both", async () => {
    const counts = async () => {
      const [platform] = await harness.control.db.select({ n: count() }).from(platformAuditLog);
      const handle = await harness.companyDb(company.id);
      try {
        const [own] = await handle.db.select({ n: count() }).from(auditLog);
        return { platform: platform.n, company: own.n };
      } finally {
        await handle.close();
      }
    };
    const before = await counts();
    for (let i = 0; i < 10; i += 1) {
      await call("get", STANDING, owner.cookie).expect(200);
      const billing = await call("get", "/billing", owner.cookie).expect(200);
      expect(billing.headers["cache-control"]).toBe("no-store");
    }
    expect(await counts()).toEqual(before);
  });

  it("S-18: leaves every other company route to TenantGuard, unchanged", async () => {
    await facts.setTenant(company.id, { maintenanceMode: true, maintenanceReason: "move" });
    for (const path of ["/users", "/support-grants"]) {
      expect(refusal(await call("get", path, owner.cookie))).toEqual(maintenance);
    }
    await facts.reset(company.id);
    await facts.setStatusSince(company.id, "suspended", daysFromNow(-31));
    for (const path of ["/users", "/support-grants"]) {
      expect(refusal(await call("get", path, owner.cookie))).toEqual(locked);
    }
    await facts.reset(company.id);
    await facts.addSubscription(company.id, { status: "active", price: "99", interval: "monthly", endInDays: -20 });
    expect(refusal(await call("post", `/support-grants/${uuidv7()}/revoke`, owner.cookie))).toEqual({
      status: 403,
      code: "company_read_only",
    });
  });

  it("S-19: answers for the session's company, whatever the query or a header names", async () => {
    await facts.setTenant(company.id, { maintenanceMode: true, maintenanceReason: "move" });
    const response = await call("get", `${STANDING}?companyId=${SUMMIT_ID}&tenantId=${SUMMIT_ID}`, sales)
      .set("X-Company-Id", SUMMIT_ID)
      .set("X-Tenant-Id", SUMMIT_ID)
      .expect(200);
    expect(response.body).toEqual({ state: "maintenance" });
  });

  it("S-20: the blocked screens say the API's own refusal texts, word for word", () => {
    expect(STANDING_SCREENS.maintenance.body).toBe((companyMaintenance().getResponse() as { message: string }).message);
    expect(STANDING_SCREENS.unavailable.body).toBe((companyUnavailable().getResponse() as { message: string }).message);
    expect(STANDING_SCREENS.locked.body).toBe(TENANCY_REFUSALS.company_suspended);
  });

  it("S-21: the session-only handlers are exactly /auth's two, every /platform route and GET /company/standing", () => {
    const reflector = new Reflector();
    const handlers = [...harness.app.get(ModulesContainer).values()]
      .flatMap((module) => [...module.controllers.values()])
      .map((wrapper) => wrapper.metatype as Type)
      .flatMap((controller) => {
        const prototype = controller.prototype as Record<string, unknown>;
        return Object.getOwnPropertyNames(prototype)
          .map((name) => ({ controller, handler: prototype[name] }))
          .filter(
            (entry): entry is { controller: Type; handler: (...args: unknown[]) => unknown } =>
              typeof entry.handler === "function" && Reflect.getMetadata(METHOD_METADATA, entry.handler) !== undefined,
          );
      })
      .map(({ controller, handler }) => {
        const context = { getHandler: () => handler, getClass: () => controller } as unknown as ExecutionContext;
        return { route: routeOf(controller, handler), level: accessLevel(reflector, context) };
      });
    expect(handlers.length).toBeGreaterThan(50);
    const session = handlers.filter((entry) => entry.level === "session").map((entry) => entry.route);
    const platform = session.filter((route) => route.split(" ")[1].startsWith("/platform"));
    expect(platform.length).toBeGreaterThanOrEqual(8);
    expect(session.filter((route) => !platform.includes(route)).sort()).toEqual([
      "GET /auth/context",
      "GET /company/standing",
      "POST /auth/step-up",
    ]);
    const everyPlatformRoute = handlers.filter((entry) => entry.route.split(" ")[1].startsWith("/platform"));
    expect(everyPlatformRoute.every((entry) => entry.level === "session")).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, CompanyStandingController)).toEqual([StandingMemberGuard]);
    const billing = handlers.find((entry) => entry.route === "GET /billing");
    expect(billing?.level).toBe("company");
    expect(Reflect.getMetadata(GUARDS_METADATA, BillingController)).toBeUndefined();
  });
});

/** A handler's method and full path, such as `GET /company/standing`, from Nest's own metadata. */
function routeOf(controller: Type, handler: (...args: unknown[]) => unknown): string {
  const parts = [
    [Reflect.getMetadata(PATH_METADATA, controller)].flat()[0],
    Reflect.getMetadata(PATH_METADATA, handler),
  ]
    .map((part: unknown) => String(part ?? "").replace(/^\/+|\/+$/g, ""))
    .filter((part) => part.length > 0);
  const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
  return `${method} /${parts.join("/")}`;
}
