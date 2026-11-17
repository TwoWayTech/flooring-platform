import { productPermissions } from "@workspace/db";
import { auditLog, branches, userProfiles } from "@workspace/db/company";
import { tenantModuleOverrides, tenantPermissionCeiling } from "@workspace/db/control";
import {
  CEILING_VIEW_KEYS,
  enabledModules,
  permissionsForModules,
  PRODUCT_HEADER,
  PRODUCT_ROLES,
  roleTemplate,
  rolesRequireMfa,
  SENSITIVE_FIELDS,
  type CompanyAnswer,
  type PermissionKey,
  type ProductKey,
  type Role,
  type User,
} from "@workspace/shared";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccessService } from "../src/core/access/access.service";
import { PERMISSION_REFUSALS } from "../src/core/access/permission.guard";
import type { AuthSession } from "../src/core/auth/session.service";
import { TenantContext } from "../src/core/tenancy/tenant-context";
import { AuthHarness } from "./auth-harness";
import { platformHelpers } from "./support/platform-admins";

const COMPANY = "/company";

/** One company of the test: its tenant id and slug, and its product. */
interface TestCompany {
  id: string;
  slug: string;
  product: ProductKey;
}

/**
 * `GET /company` (ADR 0051, "GET /company"; spec settings-and-permissions.md, Real build, "The shell
 * on the API"): the open company's facts, the caller's own profile and held roles, the guard's own
 * access and a names directory, against companies with databases of their own. Every case names
 * its id first, for the mutation runs.
 */
describe("GET /company (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled } = platformHelpers(harness);
  const floorco: TestCompany = { id: "", slug: "", product: "flooring" };
  const peopleco: TestCompany = { id: "", slug: "", product: "hr" };
  const otherco: TestCompany = { id: "", slug: "", product: "flooring" };
  const owners: Record<ProductKey, string> = { flooring: "", hr: "" };
  /** The people added to floorco for C3 and C4, by what they are. */
  const added = { active: "", disabled: "", invited: "", deleted: "" };
  const addedEmails: string[] = [];

  beforeAll(async () => {
    await harness.start();
    Object.assign(floorco, await harness.provisionCompany("floorco"));
    Object.assign(peopleco, await harness.provisionCompany("peopleco", ["hr"]));
    Object.assign(otherco, await harness.provisionCompany("otherco"));
    await withCompanyDb(floorco, async (db) => {
      await db.insert(branches).values([
        { name: "Denver", city: "Denver", state: "CO" },
        { name: "Boulder", city: "Boulder", state: "CO" },
        { name: "Old Town", city: "Fort Collins", state: "CO", deletedAt: new Date() },
      ]);
    });
    await withCompanyDb(otherco, async (db) => {
      await db.insert(branches).values({ name: "Austin", city: "Austin", state: "TX" });
    });
    owners.flooring = (await enrolled(await harness.addUser({ companyIds: [floorco.id], roles: ["owner"] }))).cookie;
    owners.hr = (await enrolled(await harness.addUser({ companyIds: [peopleco.id], roles: ["owner"] }))).cookie;
    for (const kind of ["active", "disabled", "invited", "deleted"] as const) {
      const email = await harness.addUser({ companyIds: [floorco.id], roles: ["sales"] });
      addedEmails.push(email);
      added[kind] = await harness.userIdOf(email);
    }
    await withCompanyDb(floorco, async (db) => {
      await db.update(userProfiles).set({ status: "disabled" }).where(eq(userProfiles.userId, added.disabled));
      await db.update(userProfiles).set({ status: "invited" }).where(eq(userProfiles.userId, added.invited));
      await db.update(userProfiles).set({ deletedAt: new Date() }).where(eq(userProfiles.userId, added.deleted));
    });
  }, 240_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** Runs `work` on a company's own database, behind the API's back. */
  async function withCompanyDb<T>(
    company: TestCompany,
    work: (db: Awaited<ReturnType<AuthHarness["companyDb"]>>["db"]) => Promise<T>,
  ): Promise<T> {
    const handle = await harness.companyDb(company.id);
    try {
      return await work(handle.db);
    } finally {
      await handle.close();
    }
  }

  /** A signed-in member holding `roles` in `company`, enrolled in MFA when the roles need it. */
  async function member(company: TestCompany, roles: string[]): Promise<{ cookie: string; email: string }> {
    const email = await harness.addUser({ companyIds: [company.id], roles });
    const cookie = rolesRequireMfa(roles) ? (await enrolled(email)).cookie : await harness.signIn(email);
    return { cookie, email };
  }

  /** `GET /company` as `cookie`, which must answer 200. */
  async function answerOf(cookie: string): Promise<CompanyAnswer> {
    const response = await call("get", COMPANY, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as CompanyAnswer;
  }

  /**
   * The permissions a default role should hold in a fresh company of one product: its template,
   * inside the ceiling (every permission of the product's modules) and the enabled modules (as
   * permissions.int.test.ts works them out).
   */
  function expectedPermissions(product: ProductKey, key: (typeof PRODUCT_ROLES)[ProductKey][number]): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key)
      .permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission))
      .sort();
  }

  /** The access AccessService resolves for `email` in `company`, built as TenantGuard would build the tenant. */
  async function resolvedAccess(company: TestCompany, email: string) {
    const userId = await harness.userIdOf(email);
    const session = {
      user: { id: userId, name: "Test User", email },
      sessionId: "company-answer",
      sessionCreatedAt: new Date(),
      companyId: company.id,
    };
    const tenant = TenantContext.fromVerifiedSession(session as AuthSession, {
      id: company.id,
      status: "trial",
      products: [company.product],
      maintenanceMode: false,
      phase: "full",
      databaseStatus: "ready",
    });
    return harness.app.get(AccessService).resolve(tenant);
  }

  /** Every property name anywhere in a JSON value. */
  function keysOf(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(keysOf);
    if (value && typeof value === "object")
      return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
    return [];
  }

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`C1 ${company.product} ${key}: the guard's own access, the held role, the person as GET /users shows them`, async () => {
        const { cookie, email } = await member(company, [key]);
        const body = await answerOf(cookie);
        const expected = expectedPermissions(company.product, key);
        const resolved = await resolvedAccess(company, email);

        expect(body.access.permissions).toEqual(expected);
        expect(body.access.permissions).toEqual([...resolved.permissions].sort());
        expect(body.access.dataScope).toBe(roleTemplate(key).dataScope);
        expect(body.access.isOwner).toBe(roleTemplate(key).owner);

        const ownerRoles = (await call("get", "/roles", owners[company.product]).expect(200)).body as Role[];
        const held = ownerRoles.find((role) => role.key === key)!;
        expect(body.roles).toEqual([held]);

        const ownerUsers = (await call("get", "/users", owners[company.product]).expect(200)).body as User[];
        expect(body.me).toEqual(ownerUsers.find((user) => user.id === resolved.userId));

        const seesCeiling = expected.some((permission) =>
          (CEILING_VIEW_KEYS as readonly string[]).includes(permission),
        );
        if (seesCeiling)
          expect([...(body.company.ceiling ?? [])].sort()).toEqual(productPermissions([company.product]).sort());
        else expect(body.company.ceiling).toBeNull();
        expect([...body.company.modules].sort()).toEqual([...enabledModules([company.product], null, [])].sort());
        expect(body.company).toMatchObject({ id: company.id, slug: company.slug, timeZone: "America/Chicago" });
        expect(body.company.name).toBe(company === floorco ? "floorco" : "peopleco");
      });
    }
  }

  it("C2 branches: the live ones by name, each exactly id, name, city and state", async () => {
    const body = await answerOf(owners.flooring);
    expect(body.company.branches.map((branch) => branch.name)).toEqual(["Boulder", "Denver"]);
    for (const branch of body.company.branches)
      expect(Object.keys(branch).sort()).toEqual(["city", "id", "name", "state"]);
    expect(body.company.branches[0]).toMatchObject({ city: "Boulder", state: "CO" });
  });

  it("C3 people: active and disabled with their status, never invited or deleted, each exactly id, name and status", async () => {
    const { cookie } = await member(floorco, ["warehouse"]);
    const body = await answerOf(cookie);
    const byId = new Map(body.people.map((person) => [person.id, person]));
    expect(byId.get(added.active)?.status).toBe("active");
    expect(byId.get(added.disabled)?.status).toBe("disabled");
    expect(byId.has(added.invited)).toBe(false);
    expect(byId.has(added.deleted)).toBe(false);
    for (const person of body.people) expect(Object.keys(person).sort()).toEqual(["id", "name", "status"]);
    expect(body.people.every((person) => person.status === "active" || person.status === "disabled")).toBe(true);
  });

  it("C4 nothing beyond the caller's own: no other member's email, no sensitive field name", async () => {
    const body = await answerOf(owners.flooring);
    const text = JSON.stringify(body);
    for (const email of addedEmails) expect(text.includes(email), email).toBe(false);
    const sensitive = keysOf(body).filter((key) => key in SENSITIVE_FIELDS);
    expect(sensitive).toEqual([]);
  });

  it("C5 another company's user gets their own company, whatever the request names", async () => {
    const other = await member(otherco, ["manager"]);
    const body = await answerOf(other.cookie);
    expect(body.company).toMatchObject({ id: otherco.id, name: "otherco" });
    expect(body.company.branches.map((branch) => branch.name)).toEqual(["Austin"]);
    expect(body.people.map((person) => person.id)).not.toContain(added.active);

    const both = await harness.signIn(
      await harness.addUser({ companyIds: [floorco.id, otherco.id], roles: ["manager"] }),
    );
    await harness
      .post("/api/auth/organization/set-active")
      .set("Cookie", both)
      .send({ organizationId: floorco.id })
      .expect(200);
    expect((await answerOf(both)).company.id).toBe(floorco.id);
    const named = await call("get", `${COMPANY}?companyId=${otherco.id}&tenantId=${otherco.id}`, both)
      .set("X-Company-Id", otherco.id)
      .set("X-Tenant-Id", otherco.id)
      .expect(200);
    expect((named.body as CompanyAnswer).company.id).toBe(floorco.id);
    expect((named.body as CompanyAnswer).company.branches.map((branch) => branch.name)).toEqual(["Boulder", "Denver"]);
  });

  it("C6 a module switched off: gone from the modules and the access, as the guarded routes agree", async () => {
    const { cookie } = await member(floorco, ["manager"]);
    await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: floorco.id, module: "contracts", enabled: false });
    try {
      const body = await answerOf(cookie);
      expect(body.company.modules).not.toContain("contracts");
      expect(body.access.permissions.filter((key) => key.startsWith("contracts."))).toEqual([]);
      expect(body.roles[0].permissions.some((key) => key.startsWith("contracts."))).toBe(true);
      const refused = await call("get", "/contracts", cookie);
      expect([refused.status, refused.body.code]).toEqual([403, "module_not_enabled"]);
    } finally {
      await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.tenantId, floorco.id));
    }
    const back = await answerOf(cookie);
    expect(back.company.modules).toContain("contracts");
    expect(back.access.permissions).toContain("contracts.contract.view");
  });

  it("C7 a ceiling below the role: the key leaves the access, as the guarded routes agree", async () => {
    const sales = await member(floorco, ["sales"]);
    const manager = await member(floorco, ["manager"]);
    const row = and(
      eq(tenantPermissionCeiling.tenantId, floorco.id),
      eq(tenantPermissionCeiling.permissionKey, "sales.quote.view"),
    );
    await harness.control.db.update(tenantPermissionCeiling).set({ allowed: false }).where(row);
    try {
      const body = await answerOf(sales.cookie);
      expect(body.access.permissions).not.toContain("sales.quote.view");
      expect(body.roles[0].permissions).toContain("sales.quote.view");
      expect(body.company.ceiling).toBeNull();
      expect((await answerOf(manager.cookie)).company.ceiling).not.toContain("sales.quote.view");
      const refused = await call("get", "/quotes", sales.cookie);
      expect([refused.status, refused.body.code]).toEqual([403, "forbidden"]);
    } finally {
      await harness.control.db.update(tenantPermissionCeiling).set({ allowed: true }).where(row);
    }
    expect((await answerOf(sales.cookie)).access.permissions).toContain("sales.quote.view");
    await call("get", "/quotes", sales.cookie).expect(200);
  });

  it("C8 refusals: no session, no company, a disabled profile, an Owner without a factor, the wrong product", async () => {
    expect((await call("get", COMPANY)).status).toBe(401);

    const both = await harness.signIn(await harness.addUser({ companyIds: [floorco.id, otherco.id] }));
    const none = await call("get", COMPANY, both);
    expect([none.status, none.body.code]).toEqual([403, "company_required"]);

    const disabled = await member(floorco, ["manager"]);
    const userId = await harness.userIdOf(disabled.email);
    await withCompanyDb(floorco, (db) =>
      db.update(userProfiles).set({ status: "disabled" }).where(eq(userProfiles.userId, userId)),
    );
    const refused = await call("get", COMPANY, disabled.cookie);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ code: "forbidden", message: PERMISSION_REFUSALS.forbidden });

    const owner = await harness.signIn(await harness.addUser({ companyIds: [floorco.id], roles: ["owner"] }));
    const noFactor = await call("get", COMPANY, owner);
    expect([noFactor.status, noFactor.body.code]).toEqual([403, "mfa_enrolment_required"]);

    const wrongHost = await call("get", COMPANY, owners.flooring).set(PRODUCT_HEADER, "hr");
    expect([wrongHost.status, wrongHost.body.code]).toEqual([403, "product_not_enabled"]);
  });

  it("C9 never cached, and not audited", async () => {
    const audited = () => withCompanyDb(floorco, async (db) => (await db.select({ n: count() }).from(auditLog))[0].n);
    const before = await audited();
    const response = await call("get", COMPANY, owners.flooring).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(await audited()).toBe(before);
  });

  it("C10 the standing route still answers beside it", async () => {
    const response = await call("get", "/company/standing", owners.flooring).expect(200);
    expect(response.body).toEqual({ state: "full" });
  });
});
