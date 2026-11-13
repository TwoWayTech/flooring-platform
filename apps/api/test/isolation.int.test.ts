import { branches } from "@workspace/db/company";
import { member, tenantDatabases, tenants } from "@workspace/db/control";
import { PRODUCT_HEADER } from "@workspace/shared";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_BASE_PATH, OPENAPI_PATHS } from "../src/app";
import { TenantConnectionService } from "../src/core/tenancy/tenant-connection.service";
import { AuthHarness } from "./auth-harness";
import { IsolationProbeModule } from "./support/isolation-probe";
import { listRoutes, type HttpMethod } from "./support/routes";

const PROBE = "/isolation-probe/branches";

/**
 * Company isolation (blueprint P9, CLAUDE.md rule 2): two companies, each with a database of its
 * own on the local server. Signed in to company A, every endpoint pattern aimed at company B
 * fails, whatever the client sends, and B's rows never change.
 */
describe("company isolation (P9, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let a = { id: "", slug: "" };
  let b = { id: "", slug: "" };
  let bBranchId = "";
  let aUser = "";
  let aCookie = "";

  beforeAll(async () => {
    await harness.start([IsolationProbeModule]);
    a = await harness.provisionCompany("alpha");
    b = await harness.provisionCompany("bravo");
    for (const [company, name] of [
      [a, "Alpha Main"],
      [b, "Bravo Main"],
    ] as const) {
      const handle = await harness.companyDb(company.id);
      try {
        const [row] = await handle.db.insert(branches).values({ name, city: "Austin", state: "TX" }).returning();
        if (company === b) bBranchId = row.id;
      } finally {
        await handle.close();
      }
    }
    aUser = await harness.addUser({ companyIds: [a.id] });
    aCookie = await harness.signIn(aUser);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** A request to the API as the web app's proxy sends it: the browser's host, and the cookie if any. */
  function call(method: HttpMethod, path: string, cookie?: string) {
    const pending = request(harness.app.getHttpServer())[method](path).set("X-Forwarded-Host", "localhost:3000");
    return cookie ? pending.set("Cookie", cookie) : pending;
  }

  /** Company B's branch rows, read directly from B's own database. */
  async function bRows() {
    const handle = await harness.companyDb(b.id);
    try {
      return await handle.db.select().from(branches);
    } finally {
      await handle.close();
    }
  }

  it("lists only the signed-in company's rows", async () => {
    const response = await call("get", PROBE, aCookie).expect(200);
    expect(response.body.map((row: { name: string }) => row.name)).toEqual(["Alpha Main"]);
  });

  it("cannot read, change or delete company B's row by its id", async () => {
    await call("get", `${PROBE}/${bBranchId}`, aCookie).expect(404);
    await call("patch", `${PROBE}/${bBranchId}`, aCookie).send({ name: "Hacked" }).expect(404);
    await call("delete", `${PROBE}/${bBranchId}`, aCookie).expect(404);
    expect((await bRows()).map((row) => row.name)).toEqual(["Bravo Main"]);
  });

  it("ignores a company named in the query, the body or a header", async () => {
    const list = await call("get", `${PROBE}?companyId=${b.id}&tenantId=${b.id}`, aCookie)
      .set("X-Company-Id", b.id)
      .set("X-Tenant-Id", b.id)
      .expect(200);
    expect(list.body.map((row: { name: string }) => row.name)).not.toContain("Bravo Main");
    await call("post", `${PROBE}?companyId=${b.id}`, aCookie)
      .set("X-Company-Id", b.id)
      .send({ name: "Sent to B", companyId: b.id, tenantId: b.id })
      .expect(201);
    expect((await bRows()).map((row) => row.name)).toEqual(["Bravo Main"]);
    const aRows = await call("get", PROBE, aCookie).expect(200);
    expect(aRows.body.map((row: { name: string }) => row.name)).toContain("Sent to B");
  });

  it("cannot open company B without being its member", async () => {
    const switched = await harness
      .post("/api/auth/organization/set-active")
      .set("Cookie", aCookie)
      .send({ organizationId: b.id });
    expect(switched.status).toBe(403);
    expect(switched.body.code).toBe("not_a_member");
    const list = await call("get", PROBE, aCookie).expect(200);
    expect(list.body.map((row: { name: string }) => row.name)).not.toContain("Bravo Main");
  });

  it("follows the open company for a member of both, and needs one chosen first", async () => {
    const both = await harness.signIn(await harness.addUser({ companyIds: [a.id, b.id] }));
    const none = await call("get", PROBE, both).expect(403);
    expect(none.body.code).toBe("company_required");
    await harness
      .post("/api/auth/organization/set-active")
      .set("Cookie", both)
      .send({ organizationId: b.id })
      .expect(200);
    const inB = await call("get", PROBE, both).expect(200);
    expect(inB.body.map((row: { name: string }) => row.name)).toEqual(["Bravo Main"]);
  });

  it("refuses requests without a session", async () => {
    for (const method of ["get", "post"] as const) {
      expect((await call(method, PROBE)).status).toBe(401);
    }
    expect((await call("get", `${PROBE}/${bBranchId}`)).status).toBe(401);
  });

  it("refuses a company that does not have the host's product", async () => {
    const response = await call("get", PROBE, aCookie).set(PRODUCT_HEADER, "hr");
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("product_not_enabled");
  });

  it("lets a suspended company read but not write", async () => {
    const email = await harness.addUser({ companyIds: [b.id] });
    const cookie = await harness.signIn(email);
    await harness.control.db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, b.id));
    try {
      await call("get", PROBE, cookie).expect(200);
      const write = await call("post", PROBE, cookie).send({ name: "Blocked" });
      expect(write.status).toBe(403);
      expect(write.body.code).toBe("company_read_only");
    } finally {
      await harness.control.db.update(tenants).set({ status: "trial" }).where(eq(tenants.id, b.id));
    }
  });

  it("stops a session whose membership was removed", async () => {
    const cookie = await harness.signIn(await harness.addUser({ companyIds: [a.id] }));
    const context = await call("get", "/auth/context", cookie).expect(200);
    await harness.control.db
      .delete(member)
      .where(and(eq(member.userId, context.body.user.id as string), eq(member.organizationId, a.id)));
    const response = await call("get", PROBE, cookie);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("not_a_member");
  });

  it("keeps one pool per company and never more than the cache allows", async () => {
    const service = harness.app.get(TenantConnectionService);
    expect(service.openPools).toBeGreaterThanOrEqual(1);
    expect(service.openPools).toBeLessThanOrEqual(20);
  });

  it("refuses a deleted company, a database that is not ready, and writes in maintenance or after cancelling", async () => {
    const company = await harness.provisionCompany("charlie");
    const cookie = await harness.signIn(await harness.addUser({ companyIds: [company.id] }));
    const setTenant = (values: Partial<typeof tenants.$inferInsert>) =>
      harness.control.db.update(tenants).set(values).where(eq(tenants.id, company.id));
    const setDatabase = (status: "ready" | "migrating" | "read_only") =>
      harness.control.db.update(tenantDatabases).set({ status }).where(eq(tenantDatabases.tenantId, company.id));

    await setTenant({ maintenanceMode: true });
    await call("get", PROBE, cookie).expect(200);
    expect((await call("post", PROBE, cookie).send({})).body.code).toBe("company_read_only");
    await setTenant({ maintenanceMode: false, status: "cancelled" });
    expect((await call("delete", `${PROBE}/${uuidv7()}`, cookie)).body.code).toBe("company_read_only");
    await setTenant({ status: "trial" });

    await setDatabase("read_only");
    expect((await call("patch", `${PROBE}/${uuidv7()}`, cookie).send({})).body.code).toBe("company_read_only");
    await setDatabase("migrating");
    const migrating = await call("get", PROBE, cookie);
    expect(migrating.status).toBe(503);
    expect(migrating.body.code).toBe("company_unavailable");
    await setDatabase("ready");

    await setTenant({ deletedAt: new Date() });
    expect((await call("get", PROBE, cookie)).body.code).toBe("company_required");
  });

  /** Every Nest route the inventory checks: all but the public ones, the API docs and Better Auth's mount. */
  function checkedRoutes() {
    const routes = listRoutes(harness.app.getHttpAdapter().getInstance());
    const open = new Set(["GET /health", "GET /public/branding"]);
    // The OpenAPI document is public on purpose and describes no company data, and Better Auth's
    // mount has its own rules (proxy secret and sessions; see the auth and lockout tests).
    const checked = routes.filter(
      (route) =>
        !open.has(`${route.method} ${route.path}`) &&
        !route.path.startsWith(`/${OPENAPI_PATHS.ui}`) &&
        !route.path.startsWith(`${AUTH_BASE_PATH}/`),
    );
    expect(checked.length).toBeGreaterThan(0);
    return checked.map((route) => ({
      ...route,
      name: `${route.method} ${route.path}`,
      url: route.path.replace(/:[^/]+/g, uuidv7()),
    }));
  }

  it("refuses every route that is not public when there is no session (deny by default)", async () => {
    for (const route of checkedRoutes()) {
      const response = await call(route.verb, route.url);
      expect({ route: route.name, status: response.status }).toEqual({ route: route.name, status: 401 });
    }
  });

  it("needs an open company on every route except the session-only ones", async () => {
    const sessionOnly = new Set(["GET /auth/context"]);
    const noCompanyYet = await harness.signIn(await harness.addUser({ companyIds: [a.id, b.id] }));
    for (const route of checkedRoutes()) {
      const response = await call(route.verb, route.url, noCompanyYet).send({});
      // HEAD answers have no body, so the status is checked for every route and the code where there is one.
      const expected = sessionOnly.has(route.name)
        ? { route: route.name, status: 200 }
        : { route: route.name, status: 403, code: route.verb === "head" ? undefined : "company_required" };
      const actual = sessionOnly.has(route.name)
        ? { route: route.name, status: response.status }
        : { route: route.name, status: response.status, code: (response.body as { code?: string }).code };
      expect(actual).toEqual(expected);
    }
  });
});
