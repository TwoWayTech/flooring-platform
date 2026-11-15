import { randomBytes } from "node:crypto";
import { platformAuditLog, tenantDatabases, user } from "@workspace/db/control";
import {
  FEATURES,
  offeredKeys,
  PLATFORM_AUDIT_QUERY_MESSAGES,
  type PlatformAuditResult,
  type PlatformAuditView,
  type PlatformCompany,
  type PlatformCompanySummary,
} from "@workspace/shared";
import { count, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, SUMMIT_ID } from "./auth-harness";
import { AGENT, platformHelpers, type EnrolledAdmin } from "./support/platform-admins";

/** Text planted in stored rows that must never reach an answer. */
const MARKER = `MARKER-${randomBytes(4).toString("hex")}`;

/** One planted `platform_audit_log` row; `at` is a timestamptz literal when given. */
interface Planted {
  tenantId: string | null;
  action: string;
  at?: string;
  actorUserId?: string | null;
  targetType?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * GET /platform/audit (docs/specs/platform-admin.md, "GET /platform/audit"; ADR 0053) and the
 * companies' `database.errorCode`: who may read the log, paging, names, the per-action allow-list,
 * the support-reason rule, addresses for the owner role only, and that reading writes nothing.
 */
describe("platform audit log API (P11 part 3, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp, adminEmail, companyOn } = platformHelpers(harness);
  let owner: EnrolledAdmin;
  let support: EnrolledAdmin;
  let plain = "";

  /** Plants rows directly, in order, and returns their ids. */
  async function plant(rows: readonly Planted[]): Promise<string[]> {
    const ids: string[] = [];
    for (const row of rows) {
      const [inserted] = await harness.control.db
        .insert(platformAuditLog)
        .values({
          tenantId: row.tenantId,
          action: row.action,
          ...(row.at ? { at: sql`${row.at}::timestamptz` } : {}),
          actorUserId: row.actorUserId ?? null,
          targetType: row.targetType ?? "tenant_database",
          targetId: uuidv7(),
          before: row.before ?? null,
          after: row.after ?? null,
          ip: row.ip ?? null,
          userAgent: row.userAgent ?? null,
        })
        .returning({ id: platformAuditLog.id });
      ids.push(inserted.id);
    }
    return ids;
  }

  /** One page of the log as `who` reads it. */
  async function audit(who: EnrolledAdmin, query = ""): Promise<PlatformAuditResult> {
    return (await call("get", `/platform/audit${query}`, who.cookie).expect(200)).body as PlatformAuditResult;
  }

  /** Every entry `query` gives, page by page, with the page size used. */
  async function allPages(who: EnrolledAdmin, query: string, limit: number): Promise<PlatformAuditView[]> {
    const entries: PlatformAuditView[] = [];
    let before: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const cursor: string = before ? `&before=${before}` : "";
      const result = await audit(who, `?${query}&limit=${limit}${cursor}`);
      expect(result.entries.length).toBeLessThanOrEqual(limit);
      entries.push(...result.entries);
      if (!result.nextCursor) return entries;
      expect(result.nextCursor).toBe(result.entries.at(-1)?.id);
      before = result.nextCursor;
    }
    throw new Error("The audit log never reached its last page.");
  }

  function entryOf(result: PlatformAuditResult, id: string): PlatformAuditView {
    const entry = result.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`No entry ${id} in the page.`);
    return entry;
  }

  beforeAll(async () => {
    await harness.start();
    owner = await enrolled(await adminEmail("owner"));
    support = await enrolled(await adminEmail("support"));
    plain = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["sales"] }));
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("refuses anyone but a platform admin, hides the route while admin.access is off, and checks the query", async () => {
    expect((await call("get", "/platform/audit")).status).toBe(401);
    for (const query of ["", `?companyId=${SUMMIT_ID}`, "?limit=abc"]) {
      const refused = await call("get", `/platform/audit${query}`, plain);
      expect([refused.status, refused.body.code]).toEqual([403, "forbidden"]);
    }
    const feature = FEATURES["admin.access"] as { enabled: boolean };
    feature.enabled = false;
    try {
      expect((await call("get", "/platform/audit", owner.cookie)).status).toBe(404);
    } finally {
      feature.enabled = true;
    }
    const cases: [string, string | null][] = [
      ["companyId=x", "That company id is not valid."],
      ["action=company.deleted", PLATFORM_AUDIT_QUERY_MESSAGES.action],
      ["before=x", PLATFORM_AUDIT_QUERY_MESSAGES.before],
      [`before=${uuidv7()}`, PLATFORM_AUDIT_QUERY_MESSAGES.before],
      ["limit=0", PLATFORM_AUDIT_QUERY_MESSAGES.limit],
      ["limit=101", PLATFORM_AUDIT_QUERY_MESSAGES.limit],
      ["limit=1.5", PLATFORM_AUDIT_QUERY_MESSAGES.limit],
      ["limit=abc", PLATFORM_AUDIT_QUERY_MESSAGES.limit],
      ["extra=1", null],
      ["action=company.access_changed&action=support.requested", null],
      [`companyId=${SUMMIT_ID}&companyId=${SUMMIT_ID}`, null],
    ];
    for (const [query, message] of cases) {
      const response = await call("get", `/platform/audit?${query}`, support.cookie);
      expect({ query, status: response.status, code: response.body.code }).toEqual({
        query,
        status: 400,
        code: "invalid_request",
      });
      if (message) expect({ query, message: response.body.message }).toEqual({ query, message });
    }
    await call("get", "/platform/audit?limit=1", support.cookie).expect(200);
    await call("get", "/platform/audit?limit=100", support.cookie).expect(200);
  });

  it("pages newest first, every entry exactly once, same-millisecond entries and any filter included", async () => {
    const a = await companyOn("pagea");
    const b = await companyOn("pageb");
    const recovered = { maintenanceMode: false, version: "0006_foreign_key_indexes" };
    const planted: (Planted & { at: string })[] = [
      { tenantId: a, action: "company.migration_recovered", at: "2026-11-15 10:00:00.123456+00", after: recovered },
      { tenantId: a, action: "company.migration_failed", at: "2026-11-15 10:00:00.123457+00" },
      { tenantId: a, action: "company.migration_recovered", at: "2026-11-15 10:00:01.000000+00", after: recovered },
      { tenantId: a, action: "company.migration_failed", at: "2026-11-15 10:00:02.000000+00" },
      { tenantId: a, action: "company.migration_recovered", at: "2026-11-15 10:00:02.000000+00", after: recovered },
      { tenantId: b, action: "company.migration_failed", at: "2026-11-15 10:00:00.500000+00" },
      { tenantId: b, action: "company.migration_recovered", at: "2026-11-15 10:00:03.000000+00", after: recovered },
    ];
    const ids = await plant(planted);
    const rows = planted.map((row, index) => ({ ...row, id: ids[index] }));
    // Newest first by `at`, then by id (PostgreSQL orders UUIDs as their lowercase hex text).
    const newestFirst = (list: typeof rows) =>
      [...list]
        .sort((x, y) => (x.at === y.at ? y.id.localeCompare(x.id) : y.at.localeCompare(x.at)))
        .map((row) => row.id);
    const ofA = rows.filter((row) => row.tenantId === a);
    expect((await allPages(owner, `companyId=${a}`, 3)).map((entry) => entry.id)).toEqual(newestFirst(ofA));
    const firstPage = await audit(owner, `?companyId=${a}&limit=3`);
    expect(firstPage.nextCursor).toBe(firstPage.entries[2].id);
    const recoveredOfA = ofA.filter((row) => row.action === "company.migration_recovered");
    expect(
      (await allPages(support, `companyId=${a}&action=company.migration_recovered`, 2)).map((entry) => entry.id),
    ).toEqual(newestFirst(recoveredOfA));
    // A cursor taken under another filter: b's older entry, then a's entries before it.
    const cursor = rows.find((row) => row.tenantId === b && row.at.includes("00:00.5"));
    const crossed = await audit(owner, `?companyId=${a}&before=${cursor?.id}`);
    expect(crossed.entries.map((entry) => entry.id)).toEqual(
      newestFirst(ofA.filter((row) => row.at < (cursor?.at ?? ""))),
    );
    expect(crossed.nextCursor).toBeNull();
    const many = await companyOn("pagemany");
    const base = Date.parse("2026-11-14T08:00:00Z");
    await plant(
      Array.from({ length: 51 }, (_, index) => ({
        tenantId: many,
        action: "company.migration_failed",
        at: new Date(base + index * 1000).toISOString(),
      })),
    );
    const page = await audit(owner, `?companyId=${many}`);
    expect(page.entries).toHaveLength(50);
    expect(page.nextCursor).toBe(page.entries[49].id);
    const last = await audit(owner, `?companyId=${many}&before=${page.nextCursor}`);
    expect([last.entries.length, last.nextCursor]).toEqual([1, null]);
  });

  /** Summit's ceiling as the console may send it: only keys of offered, visible modules. */
  async function summitCeiling(): Promise<string[]> {
    const offered = new Set<string>(offeredKeys(["flooring"]));
    const detail = (await call("get", `/platform/companies/${SUMMIT_ID}`, owner.cookie).expect(200))
      .body as PlatformCompany;
    return detail.ceiling.filter((key) => offered.has(key));
  }

  it("names platform admins and companies, never a company's Owner, and shows the runner as the system", async () => {
    const ceiling = await summitCeiling();
    await stepUp(owner);
    await call("patch", `/platform/companies/${SUMMIT_ID}/access`, owner.cookie)
      .send({ ceiling: ceiling.filter((key) => key !== "customers.customer.view") })
      .expect(200);
    try {
      const [changed] = (await audit(owner, `?companyId=${SUMMIT_ID}&action=company.access_changed&limit=1`)).entries;
      expect(changed).toMatchObject({
        action: "company.access_changed",
        actor: { kind: "platform_admin", userId: owner.userId, name: "Test User" },
        company: { id: SUMMIT_ID, name: "Summit Floor Co." },
        targetType: "tenant",
        targetId: SUMMIT_ID,
        details: { kind: "access_changed", keysRemoved: ["customers.customer.view"] },
      });
    } finally {
      await call("patch", `/platform/companies/${SUMMIT_ID}/access`, owner.cookie).send({ ceiling }).expect(200);
    }
    const ownerEmail = await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] });
    const companyOwnerId = await harness.userIdOf(ownerEmail);
    const ownerName = `Owner ${MARKER}`;
    await harness.control.db.update(user).set({ name: ownerName }).where(eq(user.id, companyOwnerId));
    const [approved, failed] = await plant([
      {
        tenantId: SUMMIT_ID,
        action: "support.approved",
        actorUserId: companyOwnerId,
        targetType: "support_access_grant",
        ip: "203.0.113.9",
        userAgent: `owner-browser ${MARKER}`,
      },
      { tenantId: SUMMIT_ID, action: "company.migration_failed", after: { maintenanceMode: true, code: "42P01" } },
    ]);
    for (const who of [owner, support]) {
      const result = await audit(who, `?companyId=${SUMMIT_ID}`);
      expect(entryOf(result, approved)).toMatchObject({
        actor: { kind: "company_user" },
        details: { kind: "support_decided", decision: "approved" },
      });
      expect(entryOf(result, approved)).not.toHaveProperty("network");
      expect(entryOf(result, failed)).toMatchObject({
        actor: { kind: "system" },
        details: { kind: "migration_failed", code: "42P01" },
      });
      const text = JSON.stringify(result);
      for (const secret of [companyOwnerId, ownerName, "203.0.113.9", MARKER]) expect(text).not.toContain(secret);
    }
  });

  it("shows every migration failure as its code only and hides whatever doesn't fit its action, for both roles", async () => {
    const company = await companyOn("redact");
    const [a, b, c, d, e, f, g, h] = await plant([
      {
        tenantId: company,
        action: "company.migration_failed",
        after: { maintenanceMode: true, error: `key ${MARKER}` },
      },
      {
        tenantId: company,
        action: "company.migration_failed",
        after: { maintenanceMode: true, code: "42P01", error: MARKER },
      },
      { tenantId: company, action: "company.migration_failed", after: { code: MARKER } },
      { tenantId: company, action: "company.migration_failed", after: null },
      { tenantId: company, action: "company.migration_failed", before: { error: MARKER }, after: { code: "08006" } },
      { tenantId: company, action: "company.migration_recovered", after: { maintenanceMode: false, version: MARKER } },
      {
        tenantId: company,
        action: "company.access_changed",
        actorUserId: owner.userId,
        before: {},
        after: { keysRemoved: ["customers.customer.view"], secret: MARKER },
      },
      {
        tenantId: company,
        action: "company.secret_dump",
        actorUserId: owner.userId,
        targetType: `tenant; ${MARKER}`,
        after: { [MARKER]: MARKER },
        ip: MARKER,
        userAgent: MARKER,
      },
    ]);
    for (const who of [owner, support]) {
      const result = await audit(who, `?companyId=${company}`);
      expect(JSON.stringify(result)).not.toContain(MARKER);
      for (const id of [a, c, d]) expect(entryOf(result, id).details).toEqual({ kind: "migration_failed", code: null });
      expect(entryOf(result, b).details).toEqual({ kind: "migration_failed", code: "42P01" });
      expect(entryOf(result, e).details).toEqual({ kind: "migration_failed", code: "08006" });
      expect(entryOf(result, f).details).toEqual({ kind: "migration_recovered", version: null });
      expect(entryOf(result, g).details).toEqual({ kind: "hidden" });
      expect(entryOf(result, h)).toMatchObject({
        action: "company.secret_dump",
        targetType: "unknown",
        actor: { kind: "unknown" },
        details: { kind: "hidden" },
      });
      expect(entryOf(result, h)).not.toHaveProperty("network");
    }
  });

  it("hides other admins' support reasons from the support role, never its own, and shows the owner role all", async () => {
    const company = await companyOn("reasons");
    const ownerReason = `Owner admin checks the roles ${MARKER}`;
    const supportReason = "Support admin checks the branding settings";
    await stepUp(owner);
    await call("post", "/platform/support-grants", owner.cookie)
      .send({ companyId: company, reason: ownerReason, hours: 2 })
      .expect(201);
    await stepUp(support);
    await call("post", "/platform/support-grants", support.cookie)
      .send({ companyId: company, reason: supportReason, hours: 2 })
      .expect(201);
    for (const query of [`?companyId=${company}`, `?companyId=${company}&action=support.requested`]) {
      const seen = await audit(support, query);
      expect(JSON.stringify(seen)).not.toContain(MARKER);
      const mine = seen.entries.find(
        (entry) => entry.actor.kind === "platform_admin" && entry.actor.userId === support.userId,
      );
      expect(mine?.details).toMatchObject({ kind: "support_requested", reason: supportReason });
      const theirs = seen.entries.find(
        (entry) => entry.actor.kind === "platform_admin" && entry.actor.userId === owner.userId,
      );
      expect(theirs).toMatchObject({
        action: "support.requested",
        company: { id: company, name: expect.any(String) },
        details: { kind: "hidden" },
      });
      const all = await audit(owner, query);
      const reasons = all.entries.flatMap((entry) =>
        entry.details.kind === "support_requested" ? [entry.details.reason] : [],
      );
      expect(reasons.sort()).toEqual([ownerReason, supportReason].sort());
    }
  });

  it("gives the owner role the address and device of platform admins' entries only, and the support role none", async () => {
    const company = await companyOn("network");
    const [failed, approved] = await plant([
      { tenantId: company, action: "company.migration_failed", ip: "198.51.100.1", userAgent: "runner" },
      { tenantId: company, action: "support.approved", actorUserId: uuidv7(), ip: "198.51.100.2", userAgent: "owner" },
    ]);
    await stepUp(owner);
    await call("post", "/platform/support-grants", owner.cookie)
      .send({ companyId: company, reason: "Checking the address column", hours: 1 })
      .expect(201);
    const seen = await audit(owner, `?companyId=${company}`);
    const requested = seen.entries.find((entry) => entry.action === "support.requested");
    expect(requested?.network).toEqual({ ip: expect.any(String), userAgent: AGENT });
    expect(entryOf(seen, failed)).not.toHaveProperty("network");
    expect(entryOf(seen, approved)).not.toHaveProperty("network");
    expect(JSON.stringify(seen)).not.toContain("198.51.100");
    const plainly = await audit(support, `?companyId=${company}`);
    expect(plainly.entries.length).toBeGreaterThanOrEqual(3);
    expect(plainly.entries.every((entry) => !("network" in entry))).toBe(true);
    expect((await audit(support, "?limit=100")).entries.every((entry) => !("network" in entry))).toBe(true);
  });

  it("writes no audit row for a read", async () => {
    const rows = async () => (await harness.control.db.select({ n: count() }).from(platformAuditLog))[0].n;
    const before = await rows();
    await audit(owner);
    await audit(support, "?limit=5");
    await audit(owner, `?companyId=${SUMMIT_ID}&action=company.access_changed`);
    await call("get", "/platform/audit?limit=0", owner.cookie).expect(400);
    expect(await rows()).toBe(before);
  });

  it("shows a company database's newest failure code while its last_error is set, never the text", async () => {
    const company = await companyOn("errcode");
    await harness.control.db.insert(tenantDatabases).values({
      tenantId: company,
      provider: "noop",
      providerRef: "none",
      encryptedUrl: "not-a-connection-string",
      status: "failed",
      lastError: `duplicate key: Key (name)=(${MARKER}) already exists.`,
    });
    const failure = (at: string, after: unknown): Planted => ({
      tenantId: company,
      action: "company.migration_failed",
      at,
      after,
    });
    await plant([
      failure("2026-11-15 09:00:00+00", { maintenanceMode: true, code: "08006" }),
      failure("2026-11-15 09:00:01+00", { maintenanceMode: true, code: "42P01" }),
    ]);
    const database = async () => {
      const list = (await call("get", "/platform/companies", support.cookie).expect(200))
        .body as PlatformCompanySummary[];
      const detail = await call("get", `/platform/companies/${company}`, support.cookie).expect(200);
      expect(JSON.stringify(list)).not.toContain(MARKER);
      expect(JSON.stringify(detail.body)).not.toContain(MARKER);
      const fromList = list.find((row) => row.id === company)?.database;
      expect(fromList).toEqual((detail.body as PlatformCompany).database);
      return fromList;
    };
    expect(await database()).toEqual({ status: "failed", schemaVersion: null, hasError: true, errorCode: "42P01" });
    await plant([failure("2026-11-15 09:00:02+00", { maintenanceMode: true, error: MARKER })]);
    expect((await database())?.errorCode).toBeNull();
    await plant([failure("2026-11-15 09:00:03+00", { maintenanceMode: true, code: "42P01; x" })]);
    expect((await database())?.errorCode).toBeNull();
    await plant([failure("2026-11-15 09:00:04+00", { maintenanceMode: true, code: "57P01" })]);
    expect((await database())?.errorCode).toBe("57P01");
    await harness.control.db
      .update(tenantDatabases)
      .set({ status: "ready", lastError: null })
      .where(eq(tenantDatabases.tenantId, company));
    expect(await database()).toMatchObject({ status: "ready", hasError: false, errorCode: null });
  });
});
