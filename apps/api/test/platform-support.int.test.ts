import { openControlDb, type ControlDb } from "@workspace/db";
import { platformAdmins, platformAuditLog, supportAccessGrants, user } from "@workspace/db/control";
import {
  FEATURES,
  FORMER_ADMIN_NAME,
  SUPPORT_HOURS_MESSAGE,
  SUPPORT_LIMIT_MESSAGE,
  SUPPORT_OPEN_MESSAGE,
  SUPPORT_REASON_MESSAGE,
  type PlatformSupportGrant,
} from "@workspace/shared";
import { and, count, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLATFORM_REFUSALS } from "../src/modules/platform/platform-admin.guard";
import { AuthHarness, SUMMIT_ID } from "./auth-harness";
import { platformHelpers, type EnrolledAdmin } from "./support/platform-admins";

const HOUR = 3_600_000;

/**
 * Support requests from the platform side (docs/specs/platform-admin.md, "Support requests"; ADR
 * 0053): the list by role, derived statuses, the one-open-grant and 10-in-24-hours limits, and the
 * lock on the admin's own row that serialises parallel requests and re-checks the admin.
 */
describe("platform support requests API (P11 part 3, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp, adminEmail, companyOn } = platformHelpers(harness);
  let owner: EnrolledAdmin;
  let support: EnrolledAdmin;

  /** A fresh support-role admin, stepped up, so one test's grants never count toward another's limits. */
  async function freshAdmin(role: "owner" | "support" = "support"): Promise<EnrolledAdmin> {
    const admin = await enrolled(await adminEmail(role));
    await stepUp(admin);
    return admin;
  }

  function ask(who: EnrolledAdmin, companyId: string, reason = "Checking the roles the Owner asked about") {
    return call("post", "/platform/support-grants", who.cookie).send({ companyId, reason, hours: 2 });
  }

  async function list(who: EnrolledAdmin, query = ""): Promise<PlatformSupportGrant[]> {
    return (await call("get", `/platform/support-grants${query}`, who.cookie).expect(200))
      .body as PlatformSupportGrant[];
  }

  /** How many grants an admin asked for, deleted ones included, and their `support.requested` rows. */
  async function written(adminUserId: string) {
    const [grants] = await harness.control.db
      .select({ n: count() })
      .from(supportAccessGrants)
      .where(eq(supportAccessGrants.adminUserId, adminUserId));
    const [audits] = await harness.control.db
      .select({ n: count() })
      .from(platformAuditLog)
      .where(and(eq(platformAuditLog.actorUserId, adminUserId), eq(platformAuditLog.action, "support.requested")));
    return { grants: grants.n, audits: audits.n };
  }

  /** Plants grants directly, with no audit row; times are milliseconds before now. */
  async function plantGrants(
    adminUserId: string,
    tenantId: string,
    rows: readonly { createdAgo?: number; expiresIn?: number; revoked?: boolean; approved?: boolean }[],
  ): Promise<string[]> {
    if (rows.length === 0) return [];
    const now = Date.now();
    const inserted = await harness.control.db
      .insert(supportAccessGrants)
      .values(
        rows.map((row, index) => ({
          tenantId,
          adminUserId,
          reason: `Planted support request number ${index}`,
          createdAt: new Date(now - (row.createdAgo ?? 0) - index),
          expiresAt: new Date(now + (row.expiresIn ?? 2 * HOUR)),
          revokedAt: row.revoked ? new Date(now) : null,
          approvedAt: row.approved ? new Date(now) : null,
          createdBy: adminUserId,
        })),
      )
      .returning({ id: supportAccessGrants.id });
    return inserted.map((row) => row.id);
  }

  /** How many connections of the scratch control database are waiting for a lock. */
  async function lockWaiters(): Promise<number> {
    const rows = await harness.control.db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`,
    );
    return rows[0]?.n ?? 0;
  }

  /** Waits until at least `n` connections wait for a lock, polling every 50 ms, for at most 10 s. */
  async function waitForLockWaiters(n: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while ((await lockWaiters()) < n) {
      if (Date.now() > deadline) throw new Error(`Fewer than ${n} requests ever waited for the lock.`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Holds a lock on an admin's `platform_admins` row from a connection of its own, as a parallel
   * request would, until `release()`; `whileHeld` runs in the same transaction just before it commits.
   */
  async function holdAdminRow(userId: string, whileHeld?: (tx: ControlDb) => Promise<void>) {
    const lock = openControlDb(harness.controlUrl, { max: 1 });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const done = lock.db.transaction(async (tx) => {
      await tx.select().from(platformAdmins).where(eq(platformAdmins.userId, userId)).for("update");
      locked();
      await released;
      await whileHeld?.(tx);
    });
    // A transaction that fails before it locks rejects here instead of hanging the test.
    await Promise.race([isLocked, done]);
    return {
      release,
      finish: async () => {
        release();
        try {
          await done;
        } finally {
          await lock.close();
        }
      },
    };
  }

  /** Starts a request at once and resolves to its status and body. */
  function started(pending: ReturnType<typeof ask>) {
    return pending.then((response) => ({ status: response.status, body: response.body as { code?: string } }));
  }

  beforeAll(async () => {
    await harness.start();
    owner = await enrolled(await adminEmail("owner"));
    support = await enrolled(await adminEmail("support"));
    await harness.control.db.update(user).set({ name: "Olive Platform" }).where(eq(user.id, owner.userId));
    await harness.control.db.update(user).set({ name: "Sam Support" }).where(eq(user.id, support.userId));
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("refuses anyone but a platform admin, hides the routes while admin.access is off, and checks the query and body", async () => {
    const plain = await harness.signIn(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["sales"] }));
    expect((await call("get", "/platform/support-grants")).status).toBe(401);
    const refused = await call("get", "/platform/support-grants", plain);
    expect([refused.status, refused.body.code]).toEqual([403, "forbidden"]);
    const feature = FEATURES["admin.access"] as { enabled: boolean };
    feature.enabled = false;
    try {
      expect((await call("get", "/platform/support-grants", owner.cookie)).status).toBe(404);
      expect((await call("post", "/platform/support-grants", owner.cookie).send({})).status).toBe(404);
    } finally {
      feature.enabled = true;
    }
    for (const query of ["?companyId=x", "?extra=1", `?companyId=${SUMMIT_ID}&companyId=${SUMMIT_ID}`]) {
      const response = await call("get", `/platform/support-grants${query}`, support.cookie);
      expect({ query, status: response.status, code: response.body.code }).toEqual({
        query,
        status: 400,
        code: "invalid_request",
      });
    }
    expect((await call("get", "/platform/support-grants?companyId=x", support.cookie)).body.message).toBe(
      "That company id is not valid.",
    );
    await stepUp(support);
    const company = await companyOn("bodies");
    const cases: [object, string][] = [
      [{ companyId: "x", reason: "A reason long enough", hours: 2 }, "That company id is not valid."],
      [{ companyId: company, reason: "  too short  ", hours: 2 }, SUPPORT_REASON_MESSAGE],
      [{ companyId: company, reason: "x".repeat(501), hours: 2 }, SUPPORT_REASON_MESSAGE],
      [{ companyId: company, reason: "A reason long enough", hours: 73 }, SUPPORT_HOURS_MESSAGE],
      [{ companyId: company, reason: "A reason long enough", hours: 1.5 }, SUPPORT_HOURS_MESSAGE],
      [{ companyId: company, reason: "A reason long enough", hours: "2" }, SUPPORT_HOURS_MESSAGE],
    ];
    for (const [body, message] of cases) {
      const response = await call("post", "/platform/support-grants", support.cookie).send(body);
      expect({ body, status: response.status, message: response.body.message }).toEqual({ body, status: 400, message });
    }
    // A body valid in every field but one unknown key: only `.strict()` can refuse it.
    const unknownField = await call("post", "/platform/support-grants", support.cookie).send({
      companyId: company,
      reason: "A reason long enough",
      hours: 2,
      extra: 1,
    });
    expect([unknownField.status, unknownField.body.code]).toEqual([400, "invalid_request"]);
    expect(await written(support.userId)).toEqual({ grants: 0, audits: 0 });
    await ask(support, company).expect(201);
  });

  it("lists every admin's requests for the owner role and only its own for the support role, newest first, with no approver", async () => {
    const company = await companyOn("listed");
    await stepUp(support);
    const first = (await ask(support, company, "Support admin asked first for the roles").expect(201)).body
      .id as string;
    await stepUp(owner);
    const second = (await ask(owner, company, "Owner admin asked second for the branding").expect(201)).body
      .id as string;
    const approver = uuidv7();
    await harness.control.db
      .update(supportAccessGrants)
      .set({ approvedBy: approver, approvedAt: new Date() })
      .where(eq(supportAccessGrants.id, first));
    const all = await list(owner, `?companyId=${company}`);
    expect(all.map((grant) => grant.id)).toEqual([second, first]);
    expect(all[0]).toMatchObject({
      company: { id: company, name: expect.any(String) },
      admin: { userId: owner.userId, name: "Olive Platform" },
      mine: true,
      reason: "Owner admin asked second for the branding",
      status: "pending",
      approvedAt: null,
      revokedAt: null,
    });
    expect(all[1]).toMatchObject({
      admin: { userId: support.userId, name: "Sam Support" },
      mine: false,
      status: "approved",
      approvedAt: expect.any(String),
    });
    for (const view of [await list(support, `?companyId=${company}`), await list(support)]) {
      expect(view.length).toBeGreaterThan(0);
      expect(view.every((grant) => grant.mine && grant.admin.userId === support.userId)).toBe(true);
      expect(view.map((grant) => grant.id)).toContain(first);
      expect(view.map((grant) => grant.id)).not.toContain(second);
    }
    for (const view of [all, await list(support), await list(owner)]) {
      const text = JSON.stringify(view);
      expect(text).not.toMatch(/approvedBy|approved_by/);
      expect(text).not.toContain(approver);
    }
    expect(await list(owner, `?companyId=${uuidv7()}`)).toEqual([]);
  });

  it("derives each status, revoked first, and leaves deleted grants out", async () => {
    const company = await companyOn("statuses");
    const gone = uuidv7();
    const [pending, approved, revoked, expired, both, deleted] = await plantGrants(gone, company, [
      {},
      { approved: true },
      { revoked: true },
      { expiresIn: -HOUR },
      { revoked: true, expiresIn: -HOUR },
      {},
    ]);
    await harness.control.db
      .update(supportAccessGrants)
      .set({ deletedAt: new Date() })
      .where(eq(supportAccessGrants.id, deleted));
    const statuses = new Map((await list(owner, `?companyId=${company}`)).map((grant) => [grant.id, grant]));
    expect([...statuses.keys()].sort()).toEqual([pending, approved, revoked, expired, both].sort());
    expect(statuses.get(pending)?.status).toBe("pending");
    expect(statuses.get(approved)?.status).toBe("approved");
    expect(statuses.get(revoked)?.status).toBe("revoked");
    expect(statuses.get(expired)?.status).toBe("expired");
    expect(statuses.get(both)?.status).toBe("revoked");
    expect(statuses.get(pending)?.admin).toEqual({ userId: gone, name: FORMER_ADMIN_NAME });
  });

  it("answers at most 100 requests", async () => {
    const company = await companyOn("capped");
    await plantGrants(
      uuidv7(),
      company,
      Array.from({ length: 101 }, () => ({ createdAgo: 30 * HOUR })),
    );
    expect(await list(owner, `?companyId=${company}`)).toHaveLength(100);
  });

  it("refuses a second open request by the same admin for the same company (409), writing nothing", async () => {
    const opener = await freshAdmin();
    const company = await companyOn("open");
    const first = (await ask(opener, company).expect(201)).body.id as string;
    const before = await written(opener.userId);
    const again = await ask(opener, company);
    expect([again.status, again.body.code, again.body.message]).toEqual([409, "grant_open", SUPPORT_OPEN_MESSAGE]);
    expect(await written(opener.userId)).toEqual(before);
    await harness.control.db
      .update(supportAccessGrants)
      .set({ revokedAt: new Date() })
      .where(eq(supportAccessGrants.id, first));
    const second = (await ask(opener, company).expect(201)).body.id as string;
    await harness.control.db
      .update(supportAccessGrants)
      .set({ approvedAt: new Date() })
      .where(eq(supportAccessGrants.id, second));
    expect((await ask(opener, company)).body.code).toBe("grant_open");
    await harness.control.db
      .update(supportAccessGrants)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(supportAccessGrants.id, second));
    await ask(opener, company).expect(201);
    await stepUp(owner);
    await ask(owner, company).expect(201);
  });

  it("refuses an 11th request by one admin within 24 hours (429), counting revoked and deleted ones, writing nothing", async () => {
    const busy = await freshAdmin();
    const planted = await companyOn("busyold");
    const ids = await plantGrants(busy.userId, planted, [
      ...Array.from({ length: 8 }, () => ({ createdAgo: HOUR, revoked: true })),
      { createdAgo: HOUR, revoked: true },
      { createdAgo: 24 * HOUR + 60_000, revoked: true },
    ]);
    await harness.control.db
      .update(supportAccessGrants)
      .set({ deletedAt: new Date() })
      .where(eq(supportAccessGrants.id, ids[8]));
    const tenth = await companyOn("busyten");
    const eleventh = await companyOn("busyeleven");
    await ask(busy, tenth).expect(201);
    const before = await written(busy.userId);
    const refused = await ask(busy, eleventh);
    expect([refused.status, refused.body.code, refused.body.message]).toEqual([
      429,
      "rate_limited",
      SUPPORT_LIMIT_MESSAGE,
    ]);
    expect(await written(busy.userId)).toEqual(before);
    expect(await list(owner, `?companyId=${eleventh}`)).toEqual([]);
    const other = await freshAdmin();
    await ask(other, eleventh).expect(201);
    await harness.control.db
      .update(supportAccessGrants)
      .set({ createdAt: new Date(Date.now() - 25 * HOUR) })
      .where(and(eq(supportAccessGrants.adminUserId, busy.userId), eq(supportAccessGrants.tenantId, planted)));
    await ask(busy, eleventh).expect(201);
  });

  it("answers 404 for an unknown company before 409 and 429, and 409 before 429, writing nothing", async () => {
    const full = await freshAdmin();
    const company = await companyOn("order");
    const other = await companyOn("orderother");
    await plantGrants(full.userId, company, [{ createdAgo: HOUR }]);
    await plantGrants(
      full.userId,
      other,
      Array.from({ length: 9 }, () => ({ createdAgo: HOUR, revoked: true })),
    );
    const before = await written(full.userId);
    expect((await ask(full, uuidv7())).status).toBe(404);
    expect((await ask(full, company)).body.code).toBe("grant_open");
    expect((await ask(full, await companyOn("orderthird"))).body.code).toBe("rate_limited");
    expect(await written(full.userId)).toEqual(before);
  });

  it("serialises parallel requests by one admin on the admin's row: one 201 and one 409", async () => {
    const racer = await freshAdmin();
    const company = await companyOn("race");
    const held = await holdAdminRow(racer.userId);
    try {
      const pending = [started(ask(racer, company)), started(ask(racer, company))];
      await waitForLockWaiters(2);
      held.release();
      const results = await Promise.all(pending);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(results.find((result) => result.status === 409)?.body.code).toBe("grant_open");
    } finally {
      await held.finish();
    }
    expect(await written(racer.userId)).toEqual({ grants: 1, audits: 1 });
  });

  it("serialises parallel requests for three companies at the window's edge: one 201 and two 429", async () => {
    const racer = await freshAdmin();
    await plantGrants(
      racer.userId,
      await companyOn("edgeold"),
      Array.from({ length: 9 }, () => ({ createdAgo: HOUR, revoked: true })),
    );
    const companies = [await companyOn("edgea"), await companyOn("edgeb"), await companyOn("edgec")];
    const held = await holdAdminRow(racer.userId);
    try {
      const pending = companies.map((company) => started(ask(racer, company)));
      await waitForLockWaiters(3);
      held.release();
      const results = await Promise.all(pending);
      expect(results.map((result) => result.status).sort()).toEqual([201, 429, 429]);
    } finally {
      await held.finish();
    }
    expect(await written(racer.userId)).toEqual({ grants: 10, audits: 1 });
  });

  it("re-checks the admin under the lock: deactivated or given an unknown role while waiting gets 403", async () => {
    const changes: [string, (tx: ControlDb, userId: string) => Promise<void>][] = [
      [
        "deactivated",
        async (tx, userId) => {
          await tx.update(platformAdmins).set({ active: false }).where(eq(platformAdmins.userId, userId));
        },
      ],
      [
        "billing",
        async (tx, userId) => {
          await tx.execute(sql`update platform_admins set role = 'billing' where user_id = ${userId}`);
        },
      ],
    ];
    for (const [label, change] of changes) {
      const racer = await freshAdmin();
      const company = await companyOn(`recheck${label}`);
      const held = await holdAdminRow(racer.userId, (tx) => change(tx, racer.userId));
      try {
        const pending = started(ask(racer, company));
        await waitForLockWaiters(1);
        held.release();
        const result = await pending;
        expect({ label, status: result.status, body: result.body }).toEqual({
          label,
          status: 403,
          body: { code: "forbidden", message: PLATFORM_REFUSALS.not_admin },
        });
      } finally {
        await held.finish();
      }
      expect(await written(racer.userId)).toEqual({ grants: 0, audits: 0 });
    }
  });
});
