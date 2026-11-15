import { auditLog } from "@workspace/db/company";
import {
  member,
  platformAdmins,
  platformAuditLog,
  tenantDatabases,
  tenantModuleOverrides,
  tenantPermissionCeiling,
  tenantProducts,
  tenants,
  tenantSubscriptions,
} from "@workspace/db/control";
import { backdateStatusChange } from "@workspace/db/testing";
import { companyDatabaseName } from "@workspace/providers";
import {
  ADMIN_REASON_MESSAGE,
  FEATURES,
  STATUS_ACTION_MESSAGES as S,
  type CompanyBilling,
  type CompanyStandingState,
  type CompanyStatusAction,
  type PlatformCompany,
  type PlatformCompanyStatus,
} from "@workspace/shared";
import { and, asc, count, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantConnectionService } from "../src/core/tenancy/tenant-connection.service";
import { TenantDirectory } from "../src/core/tenancy/tenant-directory";
import { PLATFORM_REFUSALS } from "../src/modules/platform/platform-admin.guard";
import { AuthHarness, SUMMIT_ID } from "./auth-harness";
import { adminLocks } from "./support/admin-locks";
import { companyFacts, daysAfter, daysFromNow, type PlantedSubscription } from "./support/company-facts";
import { IsolationProbeModule } from "./support/isolation-probe";
import { AGENT, platformHelpers, type EnrolledAdmin } from "./support/platform-admins";

const REASON = "Checking the company's status for the owner";
const PROBE = "/isolation-probe/branches";
const STATUS_AUDIT_ACTIONS = ["company.suspended", "company.reinstated", "company.cancelled"];

/** The four status routes, with a placeholder for `:id`. */
const STATUS_ROUTES = [
  ["get", "/platform/companies/:id/status"],
  ["post", "/platform/companies/:id/suspend"],
  ["post", "/platform/companies/:id/reinstate"],
  ["post", "/platform/companies/:id/cancel"],
] as const;

/** A paid plan row whose period ends in `endInDays` days. */
function paidRow(endInDays: number): PlantedSubscription {
  return { status: "active", price: "99", interval: "monthly", endInDays };
}

/** A trial row, never paid, whose period ends in `endInDays` days. */
function trialRow(endInDays: number): PlantedSubscription {
  return { status: "trial", price: "0", interval: "monthly", endInDays };
}

/**
 * A company's status on the API, platform admin part 2 (docs/specs/platform-admin.md, "Part 2:
 * plans and company status", "Company status"; ADR 0056): the `admin.billing` switch, who may call
 * what, the bodies, the preview, suspend, reinstate and cancel with what each result reads as for
 * the company's own people (TenantGuard on the isolation probe, standing, the Owner's notice), the
 * refusals in order, the stale status and the actor re-check under the locks, and that no action
 * reaches a company database or deletes anything. The company here has a database of its own.
 */
describe("platform company status API (platform admin part 2, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp, adminEmail, companyOn } = platformHelpers(harness);
  const facts = companyFacts(harness);
  const { waitForLockWaiters, holdAdminRow } = adminLocks(harness);
  let company = { id: "", slug: "" };
  let companyName = "";
  let owner: EnrolledAdmin;
  let support: EnrolledAdmin;
  let companyOwner: EnrolledAdmin;
  let sales = "";
  let plain = "";
  /** When the running test started, by the database's clock: audit rows before it belong to other tests. */
  let testStart = new Date(0);

  /** A fresh owner-role admin, stepped up. */
  async function freshOwner(): Promise<EnrolledAdmin> {
    const admin = await enrolled(await adminEmail("owner"));
    await stepUp(admin);
    return admin;
  }

  /** The status preview as `who` reads it, never cached. */
  async function preview(id = company.id, who: EnrolledAdmin = owner): Promise<PlatformCompanyStatus> {
    const response = await call("get", `/platform/companies/${id}/status`, who.cookie).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    return response.body as PlatformCompanyStatus;
  }

  /** A status action with the body as given. */
  function post(action: CompanyStatusAction, body: object, id = company.id, who: EnrolledAdmin = owner) {
    return call("post", `/platform/companies/${id}/${action}`, who.cookie).send(body);
  }

  /**
   * A status action sent as the console sends it: the reason, the status the preview shows as
   * `expectedStatus` and, for cancel, the company's name; `extra` replaces fields.
   */
  async function act(
    action: CompanyStatusAction,
    extra: Record<string, unknown> = {},
    id = company.id,
    who: EnrolledAdmin = owner,
  ) {
    const seen = await preview(id, who);
    const name = id === company.id ? companyName : (await detail(id)).name;
    const body = { reason: REASON, expectedStatus: seen.status, ...(action === "cancel" ? { confirmName: name } : {}) };
    return post(action, { ...body, ...extra }, id, who);
  }

  /** A status action that must answer 200 with the company read again. */
  async function acted(
    action: CompanyStatusAction,
    extra: Record<string, unknown> = {},
    id = company.id,
  ): Promise<PlatformCompany> {
    const response = await act(action, extra, id);
    expect({ action, status: response.status, body: response.status === 200 ? "ok" : response.body }).toEqual({
      action,
      status: 200,
      body: "ok",
    });
    return response.body as PlatformCompany;
  }

  async function detail(id = company.id): Promise<PlatformCompany> {
    return (await call("get", `/platform/companies/${id}`, owner.cookie).expect(200)).body as PlatformCompany;
  }

  /** A response's status, code and message. */
  function refusal(response: { status: number; body: { code?: string; message?: string } }) {
    return { status: response.status, code: response.body.code, message: response.body.message };
  }

  /** The company's status row as stored. */
  async function tenantRow(id = company.id) {
    const [row] = await harness.control.db
      .select({ status: tenants.status, statusChangedAt: tenants.statusChangedAt, updatedAt: tenants.updatedAt })
      .from(tenants)
      .where(eq(tenants.id, id));
    return row;
  }

  /** The company's status audit rows written since the test started, oldest first. */
  async function statusAudits(id = company.id) {
    return harness.control.db
      .select()
      .from(platformAuditLog)
      .where(
        and(
          eq(platformAuditLog.tenantId, id),
          inArray(platformAuditLog.action, STATUS_AUDIT_ACTIONS),
          gte(platformAuditLog.at, testStart),
        ),
      )
      .orderBy(asc(platformAuditLog.at), asc(platformAuditLog.id));
  }

  /** The status row and the whole platform audit log's size, to prove a refusal wrote nothing. */
  async function written(id = company.id) {
    const [audits] = await harness.control.db.select({ n: count() }).from(platformAuditLog);
    return { tenant: await tenantRow(id), audits: audits.n };
  }

  /** The database's clock now, in whole milliseconds, to bound the status stamp. */
  async function databaseClock(): Promise<Date> {
    const [row] = await harness.control.db.execute<{ ms: string }>(
      sql`select floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text as ms`,
    );
    return new Date(Number(row?.ms));
  }

  /** The standing word for the Owner and the sales member, which must be equal. */
  async function standing(): Promise<CompanyStandingState> {
    const words: CompanyStandingState[] = [];
    for (const cookie of [companyOwner.cookie, sales]) {
      words.push(
        ((await call("get", "/company/standing", cookie).expect(200)).body as { state: CompanyStandingState }).state,
      );
    }
    expect(words[0]).toBe(words[1]);
    return words[0];
  }

  async function billing(): Promise<CompanyBilling> {
    return (await call("get", "/billing", companyOwner.cookie).expect(200)).body as CompanyBilling;
  }

  /** What TenantGuard does to the isolation probe's company route, for a read and for a write. */
  async function probe() {
    const read = await call("get", PROBE, sales);
    const write = await call("post", PROBE, sales).send({ name: "Status probe" });
    return { read: refusal(read), write: refusal(write) };
  }

  const readOnlyProbe = {
    read: { status: 200, code: undefined, message: undefined },
    write: { status: 403, code: "company_read_only", message: expect.any(String) },
  };

  /** Summit's own audit log size, read from its database (the test may; the API never does). */
  async function summitAuditEntries(): Promise<number> {
    const handle = await harness.companyDb(SUMMIT_ID);
    try {
      return (await handle.db.select({ n: count() }).from(auditLog))[0].n;
    } finally {
      await handle.close();
    }
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

  /** Makes the company `active` with one paid row ending in `endInDays` days; answers the row. */
  async function paidActive(endInDays: number) {
    const row = await facts.addSubscription(company.id, paidRow(endInDays));
    await facts.setTenant(company.id, { status: "active" });
    return row;
  }

  /** The company's control rows a status action must never touch. */
  async function keptRows() {
    const db = harness.control.db;
    const [database] = await db.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, company.id));
    const { encryptedUrl, ...databaseRow } = database;
    return {
      subscriptions: await db
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, company.id))
        .orderBy(asc(tenantSubscriptions.id)),
      overrides: await db
        .select()
        .from(tenantModuleOverrides)
        .where(eq(tenantModuleOverrides.tenantId, company.id))
        .orderBy(asc(tenantModuleOverrides.id)),
      ceiling: await db
        .select()
        .from(tenantPermissionCeiling)
        .where(eq(tenantPermissionCeiling.tenantId, company.id))
        .orderBy(asc(tenantPermissionCeiling.id)),
      products: await db
        .select()
        .from(tenantProducts)
        .where(eq(tenantProducts.tenantId, company.id))
        .orderBy(asc(tenantProducts.id)),
      members: await db.select().from(member).where(eq(member.organizationId, company.id)).orderBy(asc(member.id)),
      database: databaseRow,
      encryptedUrl,
    };
  }

  beforeAll(async () => {
    await harness.start([IsolationProbeModule]);
    company = await harness.provisionCompany("status");
    owner = await enrolled(await adminEmail("owner"));
    support = await enrolled(await adminEmail("support"));
    companyOwner = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    sales = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    plain = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["sales"] }));
    companyName = (await detail()).name;
  }, 120_000);

  beforeEach(async () => {
    await stepUp(owner);
    testStart = await databaseClock();
  });

  afterEach(async () => {
    await facts.reset(company.id);
  });

  afterAll(async () => {
    await harness.stop();
  });

  it("C-1: answers 404 on the four status routes to everyone while admin.billing is off; the rest of the console works", async () => {
    await paidActive(20);
    const before = await written();
    await withBillingOff(async () => {
      for (const [who, cookie] of Object.entries({ owner: owner.cookie, support: support.cookie, plain })) {
        for (const [verb, path] of STATUS_ROUTES) {
          const response = await call(verb, path.replace(":id", company.id), cookie).send({
            reason: REASON,
            expectedStatus: "active",
            ...(path.endsWith("cancel") ? { confirmName: companyName } : {}),
          });
          expect({ who, route: `${verb} ${path}`, status: response.status }).toEqual({
            who,
            route: `${verb} ${path}`,
            status: 404,
          });
        }
      }
      await call("get", `/platform/companies/${company.id}`, owner.cookie).expect(200);
    });
    expect(await written()).toEqual(before);
    await preview();
  });

  it("C-2: lets the support role read the preview but not act, and the owner role act only after a step-up", async () => {
    await paidActive(20);
    const before = await written();
    expect((await preview(company.id, support)).status).toBe("active");
    await stepUp(support);
    for (const action of ["suspend", "reinstate", "cancel"] as const) {
      const response = await act(action, {}, company.id, support);
      expect({ action, ...refusal(response) }).toEqual({
        action,
        status: 403,
        code: "forbidden",
        message: PLATFORM_REFUSALS.owner_only,
      });
    }
    const unstepped = await enrolled(await adminEmail("owner"));
    for (const action of ["suspend", "cancel"] as const) {
      expect({ action, code: refusal(await act(action, {}, company.id, unstepped)).code }).toEqual({
        action,
        code: "step_up_required",
      });
    }
    expect(await written()).toEqual(before);
  });

  it("C-3: checks the body before the company is read, then the typed name, each with its message, and writes nothing", async () => {
    await paidActive(20);
    const before = await written();
    const reason = (length: number) => "r".repeat(length);
    const cases: [CompanyStatusAction, Record<string, unknown>, string | null][] = [
      ["suspend", { expectedStatus: "active" }, ADMIN_REASON_MESSAGE],
      ["suspend", { expectedStatus: "active", reason: reason(9) }, ADMIN_REASON_MESSAGE],
      ["suspend", { expectedStatus: "active", reason: reason(501) }, ADMIN_REASON_MESSAGE],
      ["suspend", { expectedStatus: "active", reason: reason(2001) }, ADMIN_REASON_MESSAGE],
      ["suspend", { expectedStatus: "active", reason: " ".repeat(20) }, ADMIN_REASON_MESSAGE],
      ["suspend", { expectedStatus: "active", reason: 42 }, ADMIN_REASON_MESSAGE],
      ["suspend", { reason: REASON }, S.expectedStatus],
      ["suspend", { reason: REASON, expectedStatus: "" }, S.expectedStatus],
      ["suspend", { reason: REASON, expectedStatus: "a".repeat(41) }, S.expectedStatus],
      ["suspend", { reason: REASON, expectedStatus: 5 }, S.expectedStatus],
      ["reinstate", { reason: reason(3), expectedStatus: "" }, S.expectedStatus],
      ["suspend", { reason: REASON, expectedStatus: "active", extra: 1 }, null],
      ["suspend", { reason: REASON, expectedStatus: "active", confirmName: companyName }, null],
      ["reinstate", { reason: REASON, expectedStatus: "active", confirmName: companyName }, null],
      ["cancel", { reason: REASON, expectedStatus: "active" }, S.confirmName],
      ["cancel", { reason: REASON, expectedStatus: "active", confirmName: 7 }, S.confirmName],
      ["cancel", { reason: REASON, expectedStatus: "active", confirmName: "Another company" }, S.confirmName],
      ["cancel", { reason: REASON, expectedStatus: "active", confirmName: companyName.toUpperCase() }, S.confirmName],
      ["cancel", { reason: REASON, expectedStatus: "active", confirmName: "" }, S.confirmName],
    ];
    for (const [action, body, message] of cases) {
      const response = await post(action, body);
      const got = { action, body, status: response.status, code: response.body.code };
      expect(got).toEqual({ action, body, status: 400, code: "invalid_request" });
      if (message) expect({ action, body, message: response.body.message }).toEqual({ action, body, message });
    }
    expect(await written()).toEqual(before);
  });

  it("C-4: answers 400 for an id that is not a UUID and 404 for an unknown or deleted company", async () => {
    await paidActive(20);
    const body = { reason: REASON, expectedStatus: "active" };
    expect(refusal(await call("get", "/platform/companies/not-a-uuid/status", owner.cookie)).status).toBe(400);
    expect(refusal(await post("suspend", body, "not-a-uuid")).code).toBe("invalid_request");
    expect((await call("get", `/platform/companies/${company.id}/status?extra=1`, owner.cookie)).status).toBe(400);
    const notFound = { status: 404, code: "not_found", message: "That company does not exist." };
    const unknown = uuidv7();
    expect(refusal(await call("get", `/platform/companies/${unknown}/status`, owner.cookie))).toEqual(notFound);
    expect(refusal(await post("suspend", body, unknown))).toEqual(notFound);
    await facts.setTenant(company.id, { deletedAt: new Date() });
    const before = await written();
    expect(refusal(await call("get", `/platform/companies/${company.id}/status`, owner.cookie))).toEqual(notFound);
    expect(refusal(await post("suspend", body))).toEqual(notFound);
    expect(refusal(await post("cancel", { ...body, confirmName: companyName }))).toEqual(notFound);
    expect(await written()).toEqual(before);
  });

  it("C-5: suspends a company that paid: read only at once, with its rows' lock date, and one exact audit row", async () => {
    const row = await paidActive(20);
    const stampBefore = (await tenantRow()).statusChangedAt;
    const from = await databaseClock();
    const answer = await acted("suspend", { reason: `  ${REASON}  ` });
    const to = await databaseClock();
    expect(answer).toMatchObject({ id: company.id, status: "suspended", phase: "read_only" });
    const stored = await tenantRow();
    expect(stored.status).toBe("suspended");
    expect(stored.statusChangedAt.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(stored.statusChangedAt.getTime()).toBeLessThanOrEqual(to.getTime());
    expect(answer.statusChangedAt).toBe(stored.statusChangedAt.toISOString());
    const audits = await statusAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "company.suspended",
      tenantId: company.id,
      targetType: "tenant",
      targetId: company.id,
      actorUserId: owner.userId,
      createdBy: owner.userId,
      before: { status: "active", statusChangedAt: stampBefore.toISOString() },
      after: { status: "suspended", statusChangedAt: stored.statusChangedAt.toISOString(), reason: REASON },
      ip: expect.any(String),
      userAgent: AGENT,
    });
    expect(await probe()).toEqual(readOnlyProbe);
    expect(await standing()).toBe("read_only");
    const owned = await billing();
    expect({ phase: owned.phase, notice: owned.notice }).toEqual({
      phase: "read_only",
      notice: { kind: "read_only", reason: "suspended", since: null, lockedFrom: daysAfter(row.end, 44).toISOString() },
    });
  });

  it("C-6: suspends a company that never paid: read only, locked 30 days after the change, and sign-in still works", async () => {
    await facts.addSubscription(company.id, trialRow(10));
    const answer = await acted("suspend");
    expect({ status: answer.status, phase: answer.phase }).toEqual({ status: "suspended", phase: "read_only" });
    const seen = await preview();
    const lockedFrom = daysAfter(new Date(seen.statusChangedAt), 30).toISOString();
    expect({ phase: seen.phase, readOnlyFrom: seen.readOnlyFrom, lockedFrom: seen.lockedFrom }).toEqual({
      phase: "read_only",
      readOnlyFrom: null,
      lockedFrom,
    });
    expect((await billing()).notice).toEqual({ kind: "read_only", reason: "suspended", since: null, lockedFrom });
    await backdateStatusChange(harness.control.db, company.id, daysFromNow(-31));
    expect((await probe()).read).toEqual({
      status: 403,
      code: "company_suspended",
      message: expect.any(String),
    });
    expect(await standing()).toBe("locked");
    await call("get", "/auth/context", sales).expect(200);
  });

  it("C-7: reinstates to active when the company ever paid and to trial otherwise, never past_due", async () => {
    await paidActive(20);
    await acted("suspend");
    const back = await acted("reinstate");
    expect({ status: back.status, phase: back.phase }).toEqual({ status: "active", phase: "full" });
    expect((await probe()).write.status).toBe(201);
    expect(await standing()).toBe("full");
    expect((await billing()).notice).toBeNull();
    expect((await statusAudits()).map((row) => row.action)).toEqual(["company.suspended", "company.reinstated"]);
    await facts.reset(company.id);

    await facts.addSubscription(company.id, trialRow(10));
    await acted("suspend");
    const trial = await acted("reinstate");
    expect({ status: trial.status, phase: trial.phase }).toEqual({ status: "trial", phase: "full" });
    await facts.reset(company.id);

    await facts.addSubscription(company.id, paidRow(20));
    await facts.setTenant(company.id, { status: "past_due" });
    const overdue = await billing();
    expect({ phase: overdue.phase, notice: overdue.notice?.kind }).toEqual({
      phase: "full",
      notice: "payment_overdue",
    });
    await acted("suspend");
    const current = await acted("reinstate");
    expect({ status: current.status, phase: current.phase }).toEqual({ status: "active", phase: "full" });
    const after = await billing();
    expect({ status: after.status, phase: after.phase, notice: after.notice }).toEqual({
      status: "active",
      phase: "full",
      notice: null,
    });
    const reinstated = (await statusAudits()).filter((row) => row.action === "company.reinstated");
    expect(reinstated.map((row) => (row.after as { status: string }).status)).toEqual(["active", "trial", "active"]);
  });

  it("C-8: cancels with the typed name: locks 90 days after (paid), or its rows' lock if sooner, or 30 days (never paid)", async () => {
    await paidActive(60);
    const cancelled = await acted("cancel", { confirmName: `  ${companyName}  ` });
    expect({ status: cancelled.status, phase: cancelled.phase }).toEqual({ status: "cancelled", phase: "read_only" });
    const paid = await preview();
    expect(paid.lockedFrom).toBe(daysAfter(new Date(paid.statusChangedAt), 90).toISOString());
    expect((await billing()).notice).toEqual({
      kind: "read_only",
      reason: "cancelled",
      since: null,
      lockedFrom: paid.lockedFrom,
    });
    await facts.reset(company.id);

    const row = await paidActive(20);
    await acted("cancel");
    expect((await preview()).lockedFrom).toBe(daysAfter(row.end, 44).toISOString());
    await facts.reset(company.id);

    await facts.addSubscription(company.id, trialRow(10));
    await acted("cancel");
    const unpaid = await preview();
    expect({ status: unpaid.status, lockedFrom: unpaid.lockedFrom }).toEqual({
      status: "cancelled",
      lockedFrom: daysAfter(new Date(unpaid.statusChangedAt), 30).toISOString(),
    });
  });

  it("C-9: cancel deletes nothing: every control row, the database and its rows stay, and reinstate restores writes", async () => {
    await paidActive(60);
    const [override] = await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: company.id, module: "contracts", enabled: false })
      .returning({ id: tenantModuleOverrides.id });
    try {
      await call("post", PROBE, sales).send({ name: "Kept branch" }).expect(201);
      const before = await keptRows();
      const branchesBefore = (await call("get", PROBE, sales).expect(200)).body as unknown;
      await acted("cancel");
      const after = await keptRows();
      const { encryptedUrl: urlBefore, ...restBefore } = before;
      const { encryptedUrl: urlAfter, ...restAfter } = after;
      expect(restAfter).toEqual(restBefore);
      // Compared by equality only, so the connection string is never printed.
      expect(urlAfter === urlBefore).toBe(true);
      expect(restBefore.overrides).toHaveLength(1);
      expect(restBefore.subscriptions).toHaveLength(1);
      const [database] = await harness.control.db.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_database where datname = ${companyDatabaseName(company.slug)}`,
      );
      expect(database?.n).toBe(1);
      expect((await call("get", PROBE, sales).expect(200)).body).toEqual(branchesBefore);
      expect((await probe()).write.code).toBe("company_read_only");
      await acted("reinstate");
      expect((await probe()).write.status).toBe(201);
    } finally {
      await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.id, override.id));
    }
  });

  it("C-10: refuses every transition the table refuses with 409 and its message, and writes nothing", async () => {
    await facts.addSubscription(company.id, paidRow(20));
    const cases: [string, CompanyStatusAction, string][] = [
      ["trial", "reinstate", S.notStopped],
      ["active", "reinstate", S.notStopped],
      ["past_due", "reinstate", S.notStopped],
      ["suspended", "suspend", S.alreadySuspended],
      ["cancelled", "suspend", S.suspendCancelled],
      ["cancelled", "cancel", S.alreadyCancelled],
    ];
    for (const [stored, action, message] of cases) {
      await harness.control.db.execute(sql`update tenants set status = ${stored} where id = ${company.id}`);
      const before = await written();
      const response = await act(action);
      expect({ stored, action, ...refusal(response) }).toEqual({
        stored,
        action,
        status: 409,
        code: "conflict",
        message,
      });
      expect(await written()).toEqual(before);
    }
    expect(await statusAudits()).toEqual([]);
  });

  it("C-11: refuses a company that never had a plan with 422, keeping its status and modules; one with only deleted rows passes", async () => {
    const modules = (await detail()).modules;
    expect(modules.length).toBeGreaterThan(1);
    const before = await written();
    for (const action of ["suspend", "cancel"] as const) {
      expect({ action, ...refusal(await act(action)) }).toEqual({
        action,
        status: 422,
        code: "rule_broken",
        message: S.noPlan,
      });
    }
    expect(S.noPlan).toContain("Access page");
    expect(await written()).toEqual(before);
    expect((await detail()).modules).toEqual(modules);
    await facts.setTenant(company.id, { status: "suspended" });
    const suspended = await written();
    expect(refusal(await act("reinstate"))).toEqual({ status: 422, code: "rule_broken", message: S.noPlanReinstate });
    expect(await written()).toEqual(suspended);
    await facts.setTenant(company.id, { status: "trial" });
    await facts.addSubscription(company.id, { ...paidRow(20), deleted: true });
    expect((await acted("suspend")).status).toBe("suspended");
  });

  it("C-12: refuses to cancel a never-paid suspension when it would restart its read-only days; allows it otherwise", async () => {
    await facts.addSubscription(company.id, trialRow(10));
    await facts.setStatusSince(company.id, "suspended", daysFromNow(-20));
    const before = await written();
    expect(refusal(await act("cancel"))).toEqual({ status: 422, code: "rule_broken", message: S.widens });
    expect(await written()).toEqual(before);
    await facts.reset(company.id);

    await facts.addSubscription(company.id, trialRow(-25));
    await facts.setStatusSince(company.id, "suspended", daysFromNow(-20));
    expect((await acted("cancel")).status).toBe("cancelled");
    await facts.reset(company.id);

    await facts.addSubscription(company.id, paidRow(20));
    await facts.setStatusSince(company.id, "suspended", daysFromNow(-5));
    expect((await acted("cancel")).status).toBe("cancelled");
  });

  it("C-13: runs two parallel suspends one after the other: one 200, one 409, one audit row", async () => {
    await paidActive(20);
    const second = await freshOwner();
    const body = { reason: REASON, expectedStatus: "active" };
    const results = await Promise.all([post("suspend", body), post("suspend", body, company.id, second)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    const conflict = results.find((response) => response.status === 409);
    expect(conflict && refusal(conflict)).toEqual({ status: 409, code: "conflict", message: S.changedMeanwhile });
    expect(await statusAudits()).toHaveLength(1);
    expect((await tenantRow()).status).toBe("suspended");
  });

  it("C-13b: refuses an action on a status another admin changed since the preview", async () => {
    await facts.addSubscription(company.id, paidRow(20));
    await facts.setStatusSince(company.id, "suspended", daysFromNow(-2));
    const seenByA = await preview();
    expect(seenByA.status).toBe("suspended");
    const adminB = await freshOwner();
    await act("reinstate", {}, company.id, adminB).then((response) => expect(response.status).toBe(200));
    const afterB = await tenantRow();
    const response = await post("cancel", { reason: REASON, expectedStatus: seenByA.status, confirmName: companyName });
    expect(refusal(response)).toEqual({ status: 409, code: "conflict", message: S.changedMeanwhile });
    expect(await tenantRow()).toEqual(afterB);
    expect(afterB.status).toBe("active");
    const audits = await statusAudits();
    expect(audits.map((row) => [row.action, row.actorUserId])).toEqual([["company.reinstated", adminB.userId]]);
    expect((audits[0].after as { statusChangedAt: string }).statusChangedAt).toBe(afterB.statusChangedAt.toISOString());
  });

  it("C-14: previews each action exactly, at the database's time, and writes nothing", async () => {
    const row = await paidActive(60);
    const stamp = (await tenantRow()).statusChangedAt;
    const before = await written();
    const from = await databaseClock();
    const paid = await preview();
    const to = await databaseClock();
    expect(paid).toEqual({
      companyId: company.id,
      status: "active",
      statusChangedAt: stamp.toISOString(),
      phase: "full",
      readOnlyFrom: daysAfter(row.end, 14).toISOString(),
      lockedFrom: daysAfter(row.end, 44).toISOString(),
      actions: [
        {
          action: "suspend",
          refusal: null,
          next: {
            status: "suspended",
            phase: "read_only",
            readOnlyFrom: null,
            lockedFrom: daysAfter(row.end, 44).toISOString(),
          },
        },
        { action: "reinstate", refusal: { code: "conflict", message: S.notStopped }, next: null },
        {
          action: "cancel",
          refusal: null,
          next: { status: "cancelled", phase: "read_only", readOnlyFrom: null, lockedFrom: expect.any(String) },
        },
      ],
    });
    // Cancelling locks 90 days after the change, which is the database's time of the preview.
    const cancelLock = new Date(paid.actions[2]?.next?.lockedFrom ?? "").getTime();
    expect(cancelLock).toBeGreaterThanOrEqual(daysAfter(from, 90).getTime());
    expect(cancelLock).toBeLessThanOrEqual(daysAfter(to, 90).getTime());
    await facts.reset(company.id);

    const trial = await facts.addSubscription(company.id, trialRow(10));
    const since = daysFromNow(-5);
    await facts.setStatusSince(company.id, "suspended", since);
    expect(await preview()).toEqual({
      companyId: company.id,
      status: "suspended",
      statusChangedAt: since.toISOString(),
      phase: "read_only",
      readOnlyFrom: null,
      lockedFrom: daysAfter(since, 30).toISOString(),
      actions: [
        { action: "suspend", refusal: { code: "conflict", message: S.alreadySuspended }, next: null },
        {
          action: "reinstate",
          refusal: null,
          next: {
            status: "trial",
            phase: "full",
            readOnlyFrom: trial.end.toISOString(),
            lockedFrom: daysAfter(trial.end, 30).toISOString(),
          },
        },
        { action: "cancel", refusal: { code: "rule_broken", message: S.widens }, next: null },
      ],
    });
    expect((await written()).audits).toBe(before.audits);
  });

  it("C-15: answers for a failed database and in maintenance, opens no company pool and writes no company audit log", async () => {
    const service = harness.app.get(TenantConnectionService);
    const pools = service.openPools;
    const entries = await summitAuditEntries();
    await paidActive(20);
    await facts.setDatabase(company.id, "failed");
    expect((await preview()).status).toBe("active");
    await acted("suspend");
    await acted("reinstate");
    await facts.setDatabase(company.id, "ready");
    await facts.setTenant(company.id, { maintenanceMode: true, maintenanceReason: "move" });
    expect((await preview()).status).toBe("active");
    await acted("suspend");
    await acted("reinstate");
    const other = await companyOn("statusnopool");
    await facts.addSubscription(other, paidRow(20));
    await facts.setTenant(other, { status: "active" });
    expect((await preview(other)).status).toBe("active");
    expect((await acted("suspend", {}, other)).status).toBe("suspended");
    expect((await acted("reinstate", {}, other)).status).toBe("active");
    expect(service.openPools).toBe(pools);
    expect(await summitAuditEntries()).toBe(entries);
  });

  it("C-16: answers each action with the phase TenantDirectory now gives", async () => {
    await paidActive(20);
    const directory = harness.app.get(TenantDirectory);
    for (const action of ["suspend", "reinstate", "cancel", "reinstate"] as const) {
      const answer = await acted(action);
      expect({ action, phase: answer.phase }).toEqual({ action, phase: (await directory.access(company.id))?.phase });
    }
  });

  it("C-17: refuses all three actions for a stored status the console doesn't know, and previews the refusals", async () => {
    await facts.addSubscription(company.id, paidRow(20));
    await harness.control.db.execute(sql`update tenants set status = 'frozen' where id = ${company.id}`);
    const unknown = { code: "rule_broken", message: S.unknownStatus };
    expect(await preview()).toMatchObject({
      status: "frozen",
      actions: [
        { action: "suspend", refusal: unknown, next: null },
        { action: "reinstate", refusal: unknown, next: null },
        { action: "cancel", refusal: unknown, next: null },
      ],
    });
    const before = await written();
    for (const action of ["suspend", "reinstate", "cancel"] as const) {
      expect({ action, ...refusal(await act(action, { expectedStatus: "frozen" })) }).toEqual({
        action,
        status: 422,
        ...unknown,
      });
    }
    expect(await written()).toEqual(before);
  });

  it("C-18: re-checks the admin under the lock on their own row: deactivated or moved to support while waiting gets 403", async () => {
    await paidActive(20);
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
      const before = await written();
      const held = await holdAdminRow(racer.userId, async (tx) => {
        await tx.execute(statement(racer.userId));
      });
      try {
        const pending = post("suspend", { reason: REASON, expectedStatus: "active" }, company.id, racer).then(
          (response) => refusal(response),
        );
        await waitForLockWaiters(1);
        held.release();
        expect({ label, ...(await pending) }).toEqual({ label, status: 403, code: "forbidden", message });
      } finally {
        await held.finish();
      }
      expect(await written()).toEqual(before);
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
