import { userProfiles } from "@workspace/db/company";
import { platformAdmins, supportAccessGrants } from "@workspace/db/control";
import {
  BILLING_OWNER_ONLY_MESSAGE,
  FEATURES,
  SUPPORT_CLOSED_MESSAGES,
  SUPPORT_OWNER_ONLY_MESSAGE,
  type CompanyBilling,
  type CompanyPhase,
} from "@workspace/shared";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_REFUSALS } from "../src/core/access/permission.guard";
import { PlanLimits } from "../src/core/access/plan-limits";
import { TenantDirectory } from "../src/core/tenancy/tenant-directory";
import { AuthHarness, SUMMIT_ID } from "./auth-harness";
import { companyFacts, daysAfter, daysFromNow } from "./support/company-facts";
import { platformHelpers, type EnrolledAdmin } from "./support/platform-admins";

const HOUR_MS = 3_600_000;

/** Keys that must never appear anywhere in a billing answer (spec part 4, "Never returned"). */
const NEVER_RETURNED = ["id", "planKey", "price", "userLimitOverride", "branchLimitOverride", "planId", "tenantId"];

/** Every key at any depth of a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

/**
 * `GET /billing`, the Owner's read-only billing (docs/specs/platform-admin.md, part 4; ADR 0054):
 * TenantGuard and PermissionGuard unchanged, then the switch, then the Owner check. The answer
 * comes from control rows only, carries no price, id or override, explains the phase TenantDirectory
 * works out, and gives exact dates. The Owner's support-access routes keep today's behaviour.
 */
describe("owner billing API (platform admin part 4, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp, companyOn } = platformHelpers(harness);
  const facts = companyFacts(harness);
  let company = { id: "", slug: "" };
  let owner: EnrolledAdmin = { email: "", cookie: "", secret: "", userId: "" };
  let sales = "";
  let manager = "";

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("billing");
    owner = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    sales = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    manager = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["manager"] }));
  }, 120_000);

  afterEach(async () => {
    await facts.reset(company.id);
  });

  afterAll(async () => {
    await harness.stop();
  });

  /** A refusal's status and body. */
  function refusal(response: { status: number; body: unknown }) {
    return { status: response.status, body: response.body };
  }

  /**
   * The Owner's billing answer, never cached, whose phase equals TenantDirectory's for the same
   * company at the same moment (B-12: the page and the guards agree).
   */
  async function billing(): Promise<CompanyBilling> {
    const response = await call("get", "/billing", owner.cookie).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.body as CompanyBilling;
    const access = await harness.app.get(TenantDirectory).access(company.id);
    expect({ phase: body.phase }).toEqual({ phase: access?.phase });
    return body;
  }

  /** Billing's phase and notice. */
  async function notice(): Promise<{ phase: CompanyPhase; notice: CompanyBilling["notice"] }> {
    const { phase, notice: given } = await billing();
    return { phase, notice: given };
  }

  /** Runs `run` with `settings.billing` switched off, as `meetings-moves.int.test.ts` does. */
  async function withBillingOff(run: () => Promise<void>): Promise<void> {
    const feature = FEATURES["settings.billing"] as { enabled: boolean };
    feature.enabled = false;
    try {
      await run();
    } finally {
      feature.enabled = true;
    }
  }

  it("B-1: refuses a request without a session, and one with no company open", async () => {
    expect((await call("get", "/billing")).status).toBe(401);
    const other = await companyOn("billingother");
    const both = await harness.signIn(await harness.addUser({ companyIds: [company.id, other] }));
    const response = await call("get", "/billing", both);
    expect([response.status, response.body.code]).toEqual([403, "company_required"]);
  });

  it("B-2: shows a fresh trial exactly: no plan, no limits, no notice", async () => {
    const body = await billing();
    expect(body).toEqual({
      status: "trial",
      phase: "full",
      subscriptions: [],
      limits: { userLimit: null, branchLimit: null },
      notice: null,
    });
    expect(Object.keys(body)).toEqual(["status", "phase", "subscriptions", "limits", "notice"]);
  });

  it("B-3: shows a plan row and the limits PlanLimits works out: the override wins even when smaller, the largest row wins", async () => {
    const first = await facts.addSubscription(company.id, {
      status: "active",
      price: "99",
      interval: "monthly",
      endInDays: 20,
      planName: "Flooring Pro",
      limits: { maxUsers: 5, maxBranches: 2 },
      userLimitOverride: 3,
    });
    const limits = () => harness.app.get(PlanLimits).limitsOf(company.id);
    const one = await billing();
    expect(one.subscriptions).toEqual([
      {
        planName: "Flooring Pro",
        product: "flooring",
        interval: "monthly",
        currentPeriodStart: first.start.toISOString(),
        currentPeriodEnd: first.end.toISOString(),
        standing: "current",
      },
    ]);
    expect(one.limits).toEqual({ userLimit: 3, branchLimit: 2 });
    expect(one.limits).toEqual(await limits());
    expect(one.notice).toBeNull();
    const second = await facts.addSubscription(company.id, {
      status: "active",
      price: "990",
      interval: "yearly",
      endInDays: 200,
      planName: "Flooring Team",
      limits: { maxUsers: 8, maxBranches: 1 },
    });
    const two = await billing();
    expect(two.subscriptions.map((row) => [row.planName, row.interval, row.currentPeriodEnd])).toEqual([
      ["Flooring Pro", "monthly", first.end.toISOString()],
      ["Flooring Team", "yearly", second.end.toISOString()],
    ]);
    expect(two.limits).toEqual({ userLimit: 8, branchLimit: 2 });
    expect(two.limits).toEqual(await limits());
  });

  it("B-4: warns the Owner from the first overdue day, with exact dates, and shows a past-due row", async () => {
    const ended = await facts.addSubscription(company.id, {
      status: "active",
      price: "99",
      interval: "monthly",
      endInDays: -3,
    });
    const overdue = await billing();
    expect(overdue.phase).toBe("full");
    expect(overdue.subscriptions[0]?.standing).toBe("overdue");
    expect(overdue.notice).toEqual({
      kind: "payment_overdue",
      since: ended.end.toISOString(),
      readOnlyFrom: daysAfter(ended.end, 14).toISOString(),
    });
    await facts.reset(company.id);
    const pastDue = await facts.addSubscription(company.id, {
      status: "past_due",
      price: "99",
      interval: "monthly",
      endInDays: 10,
    });
    const due = await billing();
    expect(due.subscriptions[0]?.standing).toBe("past_due");
    expect(due.notice).toEqual({
      kind: "payment_overdue",
      since: null,
      readOnlyFrom: daysAfter(pastDue.end, 14).toISOString(),
    });
  });

  it("B-5a: a paid plan lapsed 20 days ago is read only until its end plus 44 days", async () => {
    await facts.setTenant(company.id, { status: "active" });
    const row = await facts.addSubscription(company.id, {
      status: "active",
      price: "99",
      interval: "monthly",
      endInDays: -20,
    });
    expect(await notice()).toEqual({
      phase: "read_only",
      notice: {
        kind: "read_only",
        reason: "payment_lapsed",
        since: row.end.toISOString(),
        lockedFrom: daysAfter(row.end, 44).toISOString(),
      },
    });
  });

  it("B-5b: a trial that ended 5 days ago is read only until its end plus 30 days", async () => {
    const row = await facts.addSubscription(company.id, {
      status: "trial",
      price: "0",
      interval: "monthly",
      endInDays: -5,
    });
    expect(await notice()).toEqual({
      phase: "read_only",
      notice: {
        kind: "read_only",
        reason: "trial_ended",
        since: row.end.toISOString(),
        lockedFrom: daysAfter(row.end, 30).toISOString(),
      },
    });
  });

  it("B-5c: suspended after paying, with a row ending in 20 days, locks on its end plus 44 days", async () => {
    const row = await facts.addSubscription(company.id, {
      status: "active",
      price: "99",
      interval: "monthly",
      endInDays: 20,
    });
    await facts.setStatusSince(company.id, "suspended", daysFromNow(-5));
    expect(await notice()).toEqual({
      phase: "read_only",
      notice: { kind: "read_only", reason: "suspended", since: null, lockedFrom: daysAfter(row.end, 44).toISOString() },
    });
  });

  it("B-5d: cancelled after paying, where the row's ladder binds, locks on its end plus 44 days", async () => {
    const row = await facts.addSubscription(company.id, {
      status: "active",
      price: "99",
      interval: "monthly",
      endInDays: 20,
    });
    await facts.setStatusSince(company.id, "cancelled", daysFromNow(-10));
    expect(await notice()).toEqual({
      phase: "read_only",
      notice: { kind: "read_only", reason: "cancelled", since: null, lockedFrom: daysAfter(row.end, 44).toISOString() },
    });
  });

  it("B-5e: cancelled after paying, where the status's ladder binds, locks 90 days after the change", async () => {
    await facts.addSubscription(company.id, { status: "active", price: "990", interval: "yearly", endInDays: 300 });
    const since = daysFromNow(-10);
    await facts.setStatusSince(company.id, "cancelled", since);
    expect(await notice()).toEqual({
      phase: "read_only",
      notice: { kind: "read_only", reason: "cancelled", since: null, lockedFrom: daysAfter(since, 90).toISOString() },
    });
  });

  it("B-5f: a read-only database in full use explains itself, with no dates", async () => {
    await facts.addSubscription(company.id, { status: "active", price: "99", interval: "monthly", endInDays: 20 });
    await facts.setDatabase(company.id, "read_only");
    expect(await notice()).toEqual({
      phase: "full",
      notice: { kind: "read_only", reason: "database", since: null, lockedFrom: null },
    });
  });

  it("B-5g: deleted rows only still run their ladder, and none is shown", async () => {
    const row = await facts.addSubscription(company.id, {
      status: "active",
      price: "99",
      interval: "monthly",
      endInDays: -20,
      deleted: true,
    });
    const body = await billing();
    expect(body.subscriptions).toEqual([]);
    expect(body.notice).toEqual({
      kind: "read_only",
      reason: "payment_lapsed",
      since: row.end.toISOString(),
      lockedFrom: daysAfter(row.end, 44).toISOString(),
    });
  });

  it("B-5h: a counted cancelled paid row is read only until its end plus 90 days", async () => {
    await facts.setTenant(company.id, { status: "active" });
    const row = await facts.addSubscription(company.id, {
      status: "cancelled",
      price: "10.00",
      interval: "monthly",
      endInDays: -5,
    });
    const body = await billing();
    expect(body.subscriptions[0]?.standing).toBe("cancelled");
    expect({ phase: body.phase, notice: body.notice }).toEqual({
      phase: "read_only",
      notice: { kind: "read_only", reason: "cancelled", since: null, lockedFrom: daysAfter(row.end, 90).toISOString() },
    });
  });

  it("B-6: never returns a price, an id, a plan key or a limit override, at any depth", async () => {
    await facts.addSubscription(company.id, {
      status: "active",
      price: "12345.67",
      interval: "monthly",
      endInDays: 20,
      limits: { maxUsers: 4, maxBranches: 1 },
      userLimitOverride: 6,
      branchLimitOverride: 2,
    });
    const response = await call("get", "/billing", owner.cookie).expect(200);
    expect(response.text).not.toContain("12345.67");
    expect(response.text).not.toContain(company.id);
    expect(keysOf(response.body).filter((key) => NEVER_RETURNED.includes(key))).toEqual([]);
    expect((response.body as CompanyBilling).limits).toEqual({ userLimit: 6, branchLimit: 2 });
  });

  it("B-7: refuses a sales member and a manager: only the Owner sees billing", async () => {
    for (const cookie of [sales, manager]) {
      expect(refusal(await call("get", "/billing", cookie))).toEqual({
        status: 403,
        body: { code: "forbidden", message: BILLING_OWNER_ONLY_MESSAGE },
      });
    }
  });

  it("B-8: refuses an Owner disabled in the company database (PermissionGuard), and answers again once enabled", async () => {
    const setStatus = async (status: "active" | "disabled") => {
      const handle = await harness.companyDb(company.id);
      try {
        await handle.db.update(userProfiles).set({ status }).where(eq(userProfiles.userId, owner.userId));
      } finally {
        await handle.close();
      }
    };
    await setStatus("disabled");
    try {
      expect(refusal(await call("get", "/billing", owner.cookie))).toEqual({
        status: 403,
        body: { code: "forbidden", message: PERMISSION_REFUSALS.forbidden },
      });
    } finally {
      await setStatus("active");
    }
    await call("get", "/billing", owner.cookie).expect(200);
  });

  it("B-9: answers 404 to everyone while settings.billing is off, and standing still answers", async () => {
    await withBillingOff(async () => {
      for (const cookie of [owner.cookie, sales, manager]) {
        expect(refusal(await call("get", "/billing", cookie))).toEqual({
          status: 404,
          body: { code: "not_found", message: "Not Found" },
        });
        await call("get", "/company/standing", cookie).expect(200);
      }
    });
    await call("get", "/billing", owner.cookie).expect(200);
  });

  it("B-10: is refused when locked or in maintenance, and answers while read only", async () => {
    await facts.setStatusSince(company.id, "suspended", daysFromNow(-31));
    const locked = await call("get", "/billing", owner.cookie);
    expect([locked.status, locked.body.code]).toEqual([403, "company_suspended"]);
    await facts.reset(company.id);
    await facts.setTenant(company.id, { maintenanceMode: true, maintenanceReason: "move" });
    const maintenance = await call("get", "/billing", owner.cookie);
    expect([maintenance.status, maintenance.body.code]).toEqual([503, "company_maintenance"]);
    await facts.reset(company.id);
    await facts.setTenant(company.id, { status: "cancelled" });
    expect((await billing()).phase).toBe("read_only");
  });

  it("B-11: standing keeps answering with the switch off, in maintenance too", async () => {
    await facts.setTenant(company.id, { maintenanceMode: true, maintenanceReason: "move" });
    await withBillingOff(async () => {
      const response = await call("get", "/company/standing", owner.cookie).expect(200);
      expect(response.body).toEqual({ state: "maintenance" });
    });
  });

  describe("B-13: the support-access routes keep today's behaviour", () => {
    let adminUserId = "";

    beforeAll(async () => {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID] });
      adminUserId = await harness.userIdOf(email);
      await harness.control.db.insert(platformAdmins).values({ userId: adminUserId, role: "support", active: true });
    });

    /** A pending grant for the company, asked for by the platform admin, with no audit row. */
    async function plantGrant(): Promise<string> {
      const [row] = await harness.control.db
        .insert(supportAccessGrants)
        .values({
          tenantId: company.id,
          adminUserId,
          reason: "Checking the roles the Owner asked about",
          expiresAt: new Date(Date.now() + 2 * HOUR_MS),
          createdBy: adminUserId,
        })
        .returning({ id: supportAccessGrants.id });
      return row.id;
    }

    function decide(grantId: string, step: "approve" | "revoke", cookie: string) {
      return call("post", `/support-grants/${grantId}/${step}`, cookie);
    }

    async function statusOf(grantId: string, cookie = owner.cookie): Promise<string | undefined> {
      const listed = (await call("get", "/support-grants", cookie).expect(200)).body as {
        id: string;
        status: string;
      }[];
      return listed.find((grant) => grant.id === grantId)?.status;
    }

    it("lists, approves with a step-up, revokes without one, and refuses closed grants and non-Owners", async () => {
      const grantId = await plantGrant();
      const listed = (await call("get", "/support-grants", owner.cookie).expect(200)).body as object[];
      expect(Object.keys(listed[0] ?? {})).toEqual(["id", "adminName", "reason", "requestedAt", "expiresAt", "status"]);
      expect(await statusOf(grantId)).toBe("pending");

      const unconfirmed = await decide(grantId, "approve", owner.cookie);
      expect([unconfirmed.status, unconfirmed.body.code]).toEqual([403, "step_up_required"]);
      await stepUp(owner);
      await decide(grantId, "approve", owner.cookie).expect(204);
      expect(await statusOf(grantId)).toBe("approved");
      expect(refusal(await decide(grantId, "approve", owner.cookie))).toEqual({
        status: 409,
        body: { code: "grant_closed", message: SUPPORT_CLOSED_MESSAGES.approve },
      });

      // A second Owner who never stepped up revokes: revoking needs no step-up.
      const second = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
      await decide(grantId, "revoke", second.cookie).expect(204);
      expect(await statusOf(grantId)).toBe("revoked");
      expect(refusal(await decide(grantId, "revoke", second.cookie))).toEqual({
        status: 409,
        body: { code: "grant_closed", message: SUPPORT_CLOSED_MESSAGES.revoke },
      });

      expect(refusal(await call("get", "/support-grants", sales))).toEqual({
        status: 403,
        body: { code: "forbidden", message: SUPPORT_OWNER_ONLY_MESSAGE },
      });
    });

    it("lists but refuses both decisions while the company is read only (TenantGuard, unchanged)", async () => {
      const grantId = await plantGrant();
      await facts.addSubscription(company.id, { status: "active", price: "99", interval: "monthly", endInDays: -20 });
      expect((await billing()).phase).toBe("read_only");
      expect(await statusOf(grantId)).toBe("pending");
      // TenantGuard refuses the write before the service's step-up check, so none is needed here.
      for (const step of ["approve", "revoke"] as const) {
        const refused = await decide(grantId, step, owner.cookie);
        expect([refused.status, refused.body.code]).toEqual([403, "company_read_only"]);
      }
      await facts.reset(company.id);
      expect(await statusOf(grantId)).toBe("pending");
    });
  });
});
