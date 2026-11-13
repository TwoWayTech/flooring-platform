import { productPermissions } from "@workspace/db";
import { auditLog, userProfiles, userRoles } from "@workspace/db/company";
import {
  planModules,
  plans,
  products,
  tenantModuleOverrides,
  tenants,
  tenantSubscriptions,
} from "@workspace/db/control";
import {
  enabledModules,
  permissionsForModules,
  PRODUCT_ROLES,
  roleTemplate,
  type PermissionKey,
  type ProductKey,
} from "@workspace/shared";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthSession } from "../src/core/auth/session.service";
import { AccessService } from "../src/core/access/access.service";
import { TenantContext } from "../src/core/tenancy/tenant-context";
import { AuthHarness } from "./auth-harness";
import { PermissionProbeModule } from "./support/permission-probe";
import { listRoutes } from "./support/routes";

const PROBE = "/permission-probe";

/**
 * Permissions in the API (blueprint P10, CLAUDE.md rules 3 to 5 and 10), against companies with
 * databases of their own: the role-by-permission matrix, deny by default, modules, sensitive fields
 * and the audit log.
 */
describe("permissions, sensitive fields and audit (P10, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const companies: Record<ProductKey, { id: string; slug: string }> = {
    flooring: { id: "", slug: "" },
    hr: { id: "", slug: "" },
  };

  beforeAll(async () => {
    await harness.start([PermissionProbeModule]);
    companies.flooring = await harness.provisionCompany("floorco");
    companies.hr = await harness.provisionCompany("peopleco", ["hr"]);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** A request as the web app's proxy sends it. */
  function call(method: "get" | "post", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  /** Signs in a new user who holds these roles in the company. */
  async function member(product: ProductKey, roles: string[]): Promise<string> {
    return harness.signIn(await harness.addUser({ companyIds: [companies[product].id], roles }));
  }

  /**
   * The permissions a default role should hold in a fresh company of one product: its template,
   * inside the ceiling (every permission of the product's modules) and the enabled modules (all of
   * them while there is no subscription).
   */
  function expectedPermissions(product: ProductKey, key: (typeof PRODUCT_ROLES)[ProductKey][number]): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key)
      .permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission))
      .sort();
  }

  describe("the role-by-permission matrix: every default role of each product", () => {
    for (const product of ["flooring", "hr"] as const) {
      for (const key of PRODUCT_ROLES[product]) {
        it(`${product}: ${key} holds exactly its template's permissions inside the product`, async () => {
          const email = await harness.addUser({ companyIds: [companies[product].id], roles: [key] });
          const userId = await harness.userIdOf(email);
          // Built here, as TenantGuard would, so roles that must enrol MFA first are checked too.
          const session = {
            user: { id: userId, name: "Test", email },
            sessionId: "matrix",
            sessionCreatedAt: new Date(),
            companyId: companies[product].id,
          };
          const tenant = TenantContext.fromVerifiedSession(session as AuthSession, {
            id: companies[product].id,
            status: "trial",
            products: [product],
            maintenanceMode: false,
            phase: "full",
            databaseStatus: "ready",
          });
          const access = await harness.app.get(AccessService).resolve(tenant);
          expect([...access.permissions].sort()).toEqual(expectedPermissions(product, key));
          expect(access.dataScope).toBe(roleTemplate(key).dataScope);
          expect(access.isOwner).toBe(roleTemplate(key).owner);
        });
      }
    }
  });

  it("reports the same access over HTTP to the person it belongs to", async () => {
    const response = await call("get", `${PROBE}/me`, await member("flooring", ["sales"])).expect(200);
    expect(response.body.permissions).toEqual(expectedPermissions("flooring", "sales"));
  });

  it("refuses a route without the permission and allows it with any one of the keys", async () => {
    const employee = await member("flooring", ["employee"]);
    const refused = await call("get", `${PROBE}/products`, employee);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("forbidden");
    const warehouse = await member("flooring", ["warehouse"]);
    await call("get", `${PROBE}/products`, warehouse).expect(200);
  });

  it("refuses a route that declares no permission, whoever asks (deny by default)", async () => {
    const manager = await member("flooring", ["manager"]);
    const response = await call("get", `${PROBE}/undeclared`, manager);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("permission_undeclared");
    expect(response.body.leaked).toBeUndefined();
  });

  it("refuses a module the company does not have, and one switched off for it", async () => {
    const hrEmployee = await member("hr", ["employee"]);
    const notOffered = await call("get", `${PROBE}/contracts`, hrEmployee);
    expect(notOffered.body.code).toBe("module_not_enabled");
    const manager = await member("flooring", ["manager"]);
    await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: companies.flooring.id, module: "contracts", enabled: false });
    try {
      const switchedOff = await call("get", `${PROBE}/contracts`, manager);
      expect(switchedOff.body.code).toBe("module_not_enabled");
    } finally {
      await harness.control.db
        .delete(tenantModuleOverrides)
        .where(eq(tenantModuleOverrides.tenantId, companies.flooring.id));
    }
  });

  it("strips cost and credit limit for a role without the sensitive keys, and keeps them for one with them", async () => {
    const warehouse = await member("flooring", ["warehouse"]);
    const hidden = await call("get", `${PROBE}/products`, warehouse).expect(200);
    expect(hidden.body).toEqual([{ id: "p1", name: "Oak plank", supplier: { name: "Northwind Mills" } }]);
    const manager = await member("flooring", ["manager"]);
    const shown = await call("get", `${PROBE}/products`, manager).expect(200);
    expect(shown.body[0].cost).toBe("2.5000");
    expect(shown.body[0].supplier.creditLimit).toBe("5000.00");
  });

  it("refuses a person whose profile in the company is disabled", async () => {
    const email = await harness.addUser({ companyIds: [companies.flooring.id], roles: ["manager"] });
    const cookie = await harness.signIn(email);
    const context = await call("get", "/auth/context", cookie).expect(200);
    const handle = await harness.companyDb(companies.flooring.id);
    try {
      await handle.db
        .update(userProfiles)
        .set({ status: "disabled" })
        .where(eq(userProfiles.userId, context.body.user.id as string));
    } finally {
      await handle.close();
    }
    const response = await call("get", `${PROBE}/me`, cookie);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("forbidden");
  });

  it("writes an audit entry for every company write, naming who and what", async () => {
    const manager = await member("flooring", ["manager"]);
    const created = await call("post", `${PROBE}/branches`, manager).send({ name: "Audited branch" }).expect(201);
    const handle = await harness.companyDb(companies.flooring.id);
    try {
      const entries = await handle.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.targetId, created.body.id as string));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        category: "data",
        action: `POST ${PROBE}/branches`,
        actorRole: "Manager",
      });
      expect(entries[0].after).toBeNull();
    } finally {
      await handle.close();
    }
  });

  it("finds a declared permission on every company route but the probe's undeclared one (route inventory)", async () => {
    const manager = await member("flooring", ["manager"]);
    const routes = listRoutes(harness.app.getHttpAdapter().getInstance()).filter(
      (route) => !route.path.startsWith("/docs") && !route.path.startsWith("/api/auth/"),
    );
    expect(routes.length).toBeGreaterThan(0);
    const undeclared: string[] = [];
    for (const route of routes) {
      const path = route.path.replace(/:[^/]+/g, "00000000-0000-7000-8000-000000000000");
      const response = await request(harness.app.getHttpServer())
        [route.verb](path)
        .set("X-Forwarded-Host", "localhost:3000")
        .set("Cookie", manager)
        .send({});
      if ((response.body as { code?: string }).code === "permission_undeclared")
        undeclared.push(`${route.method} ${route.path}`);
    }
    expect(undeclared).toEqual([`GET ${PROBE}/undeclared`]);
  });

  it("limits modules to the plan, and never turns a cancelled plan into a trial (PR #7 review)", async () => {
    const manager = await member("flooring", ["manager"]);
    const contracts = async () => (await call("get", `${PROBE}/contracts`, manager)).body.code as string | undefined;
    expect(await contracts()).not.toBe("module_not_enabled");
    const [flooring] = await harness.control.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.key, "flooring"));
    const [plan] = await harness.control.db
      .insert(plans)
      .values({
        key: `narrow-${companies.flooring.slug}`,
        name: "Narrow",
        productId: flooring.id,
        monthlyPrice: "0",
        yearlyPrice: "0",
      })
      .returning();
    await harness.control.db.insert(planModules).values({ planId: plan.id, module: "core" });
    const [subscription] = await harness.control.db
      .insert(tenantSubscriptions)
      .values({
        tenantId: companies.flooring.id,
        planId: plan.id,
        interval: "monthly",
        price: "0",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        status: "active",
      })
      .returning();
    try {
      expect(await contracts()).toBe("module_not_enabled");
      await harness.control.db
        .update(tenantSubscriptions)
        .set({ status: "cancelled" })
        .where(eq(tenantSubscriptions.id, subscription.id));
      expect(await contracts()).toBe("module_not_enabled");
    } finally {
      await harness.control.db.delete(tenantSubscriptions).where(eq(tenantSubscriptions.id, subscription.id));
      await harness.control.db.delete(planModules).where(eq(planModules.planId, plan.id));
      await harness.control.db.delete(plans).where(eq(plans.id, plan.id));
    }
  });

  it("ignores a role link that was removed (soft-deleted)", async () => {
    const email = await harness.addUser({ companyIds: [companies.flooring.id], roles: ["manager"] });
    const cookie = await harness.signIn(email);
    await call("get", `${PROBE}/products`, cookie).expect(200);
    const handle = await harness.companyDb(companies.flooring.id);
    try {
      await handle.db
        .update(userRoles)
        .set({ deletedAt: new Date() })
        .where(eq(userRoles.userId, await harness.userIdOf(email)));
    } finally {
      await handle.close();
    }
    expect((await call("get", `${PROBE}/products`, cookie)).body.code).toBe("forbidden");
  });

  it("audits writes in a controller marked @Audited() at class level, and a write whose response failed after it committed", async () => {
    const manager = await member("flooring", ["manager"]);
    // Other tests (the route inventory) also call these routes, so entries are counted around this call.
    const failedAction = `POST ${PROBE}/audited/unserialisable`;
    const countFailed = async () => {
      const handle = await harness.companyDb(companies.flooring.id);
      try {
        return (await handle.db.select().from(auditLog).where(eq(auditLog.action, failedAction))).length;
      } finally {
        await handle.close();
      }
    };
    const before = await countFailed();
    const created = await call("post", `${PROBE}/audited/branches`, manager).expect(201);
    const failed = await call("post", `${PROBE}/audited/unserialisable`, manager);
    expect(failed.status).toBe(500);
    expect(await countFailed()).toBe(before + 1);
    const handle = await harness.companyDb(companies.flooring.id);
    try {
      const entries = await handle.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, `POST ${PROBE}/audited/branches`));
      expect(entries.map((entry) => entry.targetId)).toContain(created.body.id);
    } finally {
      await handle.close();
    }
  });

  it("gives a company that is no longer a trial and has no subscription only platform (PR #8 review)", async () => {
    const manager = await member("flooring", ["manager"]);
    await harness.control.db.update(tenants).set({ status: "active" }).where(eq(tenants.id, companies.flooring.id));
    try {
      expect((await call("get", `${PROBE}/contracts`, manager)).body.code).toBe("module_not_enabled");
      expect((await call("get", `${PROBE}/products`, manager)).body.code).toBe("forbidden");
    } finally {
      await harness.control.db.update(tenants).set({ status: "trial" }).where(eq(tenants.id, companies.flooring.id));
    }
  });

  it("does not make a trial company fresh again when its subscriptions are deleted (PR #8 review)", async () => {
    const manager = await member("flooring", ["manager"]);
    const [flooring] = await harness.control.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.key, "flooring"));
    const [plan] = await harness.control.db
      .insert(plans)
      .values({
        key: `deleted-${companies.flooring.slug}`,
        name: "Core",
        productId: flooring.id,
        monthlyPrice: "0",
        yearlyPrice: "0",
      })
      .returning();
    await harness.control.db.insert(planModules).values({ planId: plan.id, module: "core" });
    const [subscription] = await harness.control.db
      .insert(tenantSubscriptions)
      .values({
        tenantId: companies.flooring.id,
        planId: plan.id,
        interval: "monthly",
        price: "0",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        status: "trial",
        deletedAt: new Date(),
      })
      .returning();
    try {
      expect((await call("get", `${PROBE}/contracts`, manager)).body.code).toBe("module_not_enabled");
    } finally {
      await harness.control.db.delete(tenantSubscriptions).where(eq(tenantSubscriptions.id, subscription.id));
      await harness.control.db.delete(planModules).where(eq(planModules.planId, plan.id));
      await harness.control.db.delete(plans).where(eq(plans.id, plan.id));
    }
  });
});
