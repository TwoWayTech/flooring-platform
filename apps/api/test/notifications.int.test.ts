import { notifications, outboxMessages, rolePermissions, roles, userRoles } from "@workspace/db/company";
import { authAttempts, rateLimit, tenants } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JobsService } from "../src/core/jobs/jobs.service";
import {
  CLEANUP_QUEUE,
  NotificationService,
  SEND_QUEUE,
  type NotifyInput,
} from "../src/core/notifications/notification.service";
import { TenantContext } from "../src/core/tenancy/tenant-context";
import { AuthHarness } from "./auth-harness";

/** Waits until a check passes, for work the job worker does in the background. */
async function eventually<T>(check: () => Promise<T | undefined>, what: string, timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/**
 * The notifications core (spec docs/product-spec/notifications.md, ADR 0032) on a company with a
 * database of its own and pg-boss on the throwaway control database.
 */
describe("notifications core (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let tenant: TenantContext;

  beforeAll(async () => {
    process.env.JOBS_POLL_SECONDS = "0.5";
    await harness.start();
    company = await harness.provisionCompany("noteco");
    tenant = TenantContext.forJob({
      id: company.id,
      status: "trial",
      products: ["flooring"],
      maintenanceMode: false,
      phase: "full",
      databaseStatus: "ready",
    });
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  const service = () => harness.app.get(NotificationService);

  /** Provider calls for one address. The memory adapter returns one entry per idempotency key, so it cannot show a second send. */
  const callsTo = (spy: { mock: { calls: [{ to: string[] }][] } }, address: string) =>
    spy.mock.calls.filter(([message]) => message.to.includes(address)).length;

  /**
   * Makes the email provider refuse messages to one address until restored. Other tests' queued
   * messages may be sent meanwhile, so a one-off failure could hit the wrong message.
   */
  function failSendsTo(address: string) {
    const send = harness.outbox.send.bind(harness.outbox);
    return vi.spyOn(harness.outbox, "send").mockImplementation(async (message) => {
      if (message.to.includes(address)) throw new Error("provider down");
      return send(message);
    });
  }

  /** A request as the web app's proxy sends it. */
  function call(method: "get" | "post", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  async function rowsOf(sourceId: string) {
    const handle = await harness.companyDb(company.id);
    try {
      return await handle.db.select().from(outboxMessages).where(eq(outboxMessages.sourceId, sourceId));
    } finally {
      await handle.close();
    }
  }

  function quoteSent(sourceId: string, email: string, extra: Partial<NotifyInput> = {}): NotifyInput {
    return {
      event: "quote.sent",
      source: { type: "quote", id: sourceId },
      to: [{ kind: "customer", id: `customer-${sourceId}`, name: "Dana Rivera", email }],
      values: {
        "customer.name": "Dana Rivera",
        "quote.number": "Q-1001",
        "quote.total": "$1,200.00",
        "quote.expires": "Dec 10, 2026",
      },
      ...extra,
    };
  }

  it("writes one rendered row per recipient, sends it through the EmailProvider, and never twice", async () => {
    const sourceId = uuidv7();
    const sends = vi.spyOn(harness.outbox, "send");
    const actor = await harness.userIdOf(await harness.addUser({ companyIds: [company.id] }));
    const first = await service().notify(tenant, actor, quoteSent(sourceId, "dana@example.test"));
    expect(first.queued).toHaveLength(1);
    const again = await service().notify(tenant, actor, quoteSent(sourceId, "dana@example.test"));
    expect(again.queued).toHaveLength(0);
    const [sent] = await eventually(async () => {
      const rows = await rowsOf(sourceId);
      return rows[0]?.status === "sent" ? rows : undefined;
    }, "the send");
    expect(sent.subject).toContain("Q-1001");
    expect(sent.bodyText).toContain("Dana Rivera");
    expect(sent.providerMessageId).toMatch(/^memory-/);
    expect(callsTo(sends, "dana@example.test")).toBe(1);
    sends.mockRestore();
  });

  it("never emails the person who caused the event", async () => {
    const sourceId = uuidv7();
    const actor = await harness.userIdOf(await harness.addUser({ companyIds: [company.id] }));
    const result = await service().notify(tenant, actor, {
      ...quoteSent(sourceId, "x@example.test"),
      to: [{ kind: "user", id: actor, name: "Me", email: "me@example.test" }],
    });
    expect(result.queued).toHaveLength(0);
    expect(await rowsOf(sourceId)).toHaveLength(0);
  });

  it("marks a bad address failed, tells the actor in the app, and keeps it failed on retry", async () => {
    const sourceId = uuidv7();
    const email = await harness.addUser({ companyIds: [company.id] });
    const actor = await harness.userIdOf(email);
    const cookie = await harness.signIn(email);
    const result = await service().notify(tenant, actor, quoteSent(sourceId, "not-an-address"));
    expect(result.failed).toHaveLength(1);
    const [row] = await rowsOf(sourceId);
    expect(row).toMatchObject({ status: "failed", failureType: "invalid_email" });
    const notes = await call("get", "/notifications", cookie).expect(200);
    expect(notes.body[0].title).toContain("could not be delivered");
    await call("post", "/notifications/read", cookie).send({}).expect(201);
    const read = await call("get", "/notifications", cookie).expect(200);
    expect(read.body.every((note: { readAt: string | null }) => note.readAt !== null)).toBe(true);
  });

  it("records a provider failure as failed and sends it again on retry", async () => {
    const sourceId = uuidv7();
    const failing = failSendsTo("lee@example.test");
    await service().notify(tenant, null, quoteSent(sourceId, "lee@example.test"));
    const [failed] = await eventually(async () => {
      const rows = await rowsOf(sourceId);
      return rows[0]?.status === "failed" ? rows : undefined;
    }, "the failure");
    expect(failed.failureType).toBe("provider_error");
    failing.mockRestore();
    await service().retry(tenant, failed.id);
    await eventually(async () => {
      const rows = await rowsOf(sourceId);
      return rows[0]?.status === "sent" ? rows : undefined;
    }, "the retried send");
  });

  it("holds a scheduled row until its time and cancels it on request, refusing to cancel a sent one", async () => {
    const sourceId = uuidv7();
    await service().notify(
      tenant,
      null,
      quoteSent(sourceId, "kim@example.test", { scheduledFor: new Date(Date.now() + 3_600_000) }),
    );
    const [held] = await rowsOf(sourceId);
    expect(held.status).toBe("scheduled");
    await service().cancel(tenant, held.id);
    expect((await rowsOf(sourceId))[0].status).toBe("cancelled");
    await expect(service().cancel(tenant, held.id)).rejects.toThrow(/Only a scheduled message/);
  });

  it("lists only a person's own Outbox rows, all of them with settings.outbox.view, and redacts others' restricted rows", async () => {
    const sourceId = uuidv7();
    await service().notify(tenant, null, quoteSent(sourceId, "pat@example.test", { restricted: true }));
    const plain = await harness.signIn(await harness.addUser({ companyIds: [company.id] }));
    const mine = await call("get", "/outbox", plain).expect(200);
    expect(mine.body.some((row: { sourceId: string }) => row.sourceId === sourceId)).toBe(false);

    const viewerEmail = await harness.addUser({ companyIds: [company.id], roles: [] });
    const viewerId = await harness.userIdOf(viewerEmail);
    const handle = await harness.companyDb(company.id);
    try {
      const [role] = await handle.db
        .insert(roles)
        .values({ key: `outbox-${uuidv7().slice(-6)}`, name: "Outbox reader", dataScope: "all" })
        .returning();
      await handle.db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.outbox.view" });
      await handle.db.insert(userRoles).values({ userId: viewerId, roleId: role.id });
    } finally {
      await handle.close();
    }
    const viewer = await harness.signIn(viewerEmail);
    const all = await call("get", "/outbox", viewer).expect(200);
    const restricted = all.body.find((row: { sourceId: string }) => row.sourceId === sourceId);
    expect(restricted).toMatchObject({
      subject: "Restricted message",
      bodyText: "Only the people involved can read this.",
    });
    // Nothing that would undo the redaction comes back: no template values, dedupe key or provider id (PR #9 review).
    for (const row of all.body as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty("values");
      expect(row).not.toHaveProperty("dedupeKey");
      expect(row).not.toHaveProperty("providerMessageId");
    }
  });

  it("refuses retry and cancel without settings.outbox.view", async () => {
    const plain = await harness.signIn(await harness.addUser({ companyIds: [company.id] }));
    for (const action of ["retry", "cancel"]) {
      const response = await call("post", `/outbox/${uuidv7()}/${action}`, plain);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("forbidden");
    }
  });

  it("deletes sign-in security data older than 30 days in the daily cleanup (owner decision)", async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    const subject = `old-${uuidv7()}@example.test`;
    await harness.control.db.insert(authAttempts).values([
      { kind: "password_ok", subject, ip: null, createdAt: old },
      { kind: "password_ok", subject: `new-${subject}`, ip: null },
    ]);
    await harness.control.db
      .insert(rateLimit)
      .values({ key: `cleanup-${subject}`, count: 1, lastRequest: old.getTime() });
    await harness.app.get(JobsService).send(CLEANUP_QUEUE, {});
    await eventually(async () => {
      const left = await harness.control.db.select().from(authAttempts).where(eq(authAttempts.subject, subject));
      return left.length === 0 ? true : undefined;
    }, "the cleanup");
    expect(
      await harness.control.db
        .select()
        .from(authAttempts)
        .where(eq(authAttempts.subject, `new-${subject}`)),
    ).toHaveLength(1);
    expect(
      await harness.control.db
        .select()
        .from(rateLimit)
        .where(eq(rateLimit.key, `cleanup-${subject}`)),
    ).toHaveLength(0);
  });

  it("stores in-app notes for the people named, not the actor", async () => {
    const actor = await harness.userIdOf(await harness.addUser({ companyIds: [company.id] }));
    const other = await harness.userIdOf(await harness.addUser({ companyIds: [company.id] }));
    const result = await service().notify(tenant, actor, {
      event: "timeoff.requested",
      source: { type: "quote", id: uuidv7() },
      inApp: [
        { userId: actor, title: "Mine", href: "/sales" },
        { userId: other, title: "Time off requested", href: "/hr/time-off" },
      ],
    });
    expect(result.inApp).toBe(1);
    const handle = await harness.companyDb(company.id);
    try {
      expect(await handle.db.select().from(notifications).where(eq(notifications.userId, actor))).toHaveLength(0);
      expect(await handle.db.select().from(notifications).where(eq(notifications.userId, other))).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it("stores a row restricted when the catalogue says so, even if the caller does not (spec rule 6)", async () => {
    const sourceId = uuidv7();
    await service().notify(tenant, null, {
      event: "commission.ready",
      source: { type: "commission_statement", id: sourceId },
      to: [{ kind: "user", id: uuidv7(), name: "Priya", email: "priya@example.test" }],
      values: { "employee.name": "Priya", "statement.month": "October 2026" },
    });
    expect((await rowsOf(sourceId))[0].restricted).toBe(true);
  });

  it("sends a failed message once however often Retry is pressed", async () => {
    const sourceId = uuidv7();
    const failing = failSendsTo("ray@example.test");
    await service().notify(tenant, null, quoteSent(sourceId, "ray@example.test"));
    const [failed] = await eventually(async () => {
      const rows = await rowsOf(sourceId);
      return rows[0]?.status === "failed" ? rows : undefined;
    }, "the failure");
    failing.mockRestore();
    const sends = vi.spyOn(harness.outbox, "send");
    // Both clicks may be accepted (a queued row may be retried); the worker's claim still sends it once.
    await Promise.allSettled([service().retry(tenant, failed.id), service().retry(tenant, failed.id)]);
    await eventually(async () => ((await rowsOf(sourceId))[0]?.status === "sent" ? true : undefined), "the send");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(callsTo(sends, "ray@example.test")).toBe(1);
    sends.mockRestore();
  });

  it("sends nothing for a read-only company and leaves its rows queued", async () => {
    const sourceId = uuidv7();
    await harness.control.db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, company.id));
    try {
      await service().notify(tenant, null, quoteSent(sourceId, "sam@example.test"));
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect((await rowsOf(sourceId))[0].status).toBe("queued");
    } finally {
      await harness.control.db.update(tenants).set({ status: "trial" }).where(eq(tenants.id, company.id));
    }
  });

  it("marks only the person's own notes read, and refuses ids that are not ids", async () => {
    const owner = await harness.userIdOf(await harness.addUser({ companyIds: [company.id] }));
    const otherEmail = await harness.addUser({ companyIds: [company.id] });
    await service().notify(tenant, null, {
      event: "timeoff.requested",
      source: { type: "pto", id: uuidv7() },
      inApp: [{ userId: owner, title: "Not yours", href: "/hr/time-off" }],
    });
    const other = await harness.signIn(otherEmail);
    const handle = await harness.companyDb(company.id);
    try {
      const [note] = await handle.db.select().from(notifications).where(eq(notifications.userId, owner));
      await call("post", "/notifications/read", other)
        .send({ ids: [note.id] })
        .expect(201);
      const [after] = await handle.db.select().from(notifications).where(eq(notifications.id, note.id));
      expect(after.readAt).toBeNull();
    } finally {
      await handle.close();
    }
    const bad = await call("post", "/notifications/read", other).send({ ids: ["not-an-id"] });
    expect(bad.status).toBe(400);
  });

  it("sends a row once even when two jobs are queued for it (PR #9 re-review)", async () => {
    const sourceId = uuidv7();
    const sends = vi.spyOn(harness.outbox, "send");
    const result = await service().notify(tenant, null, quoteSent(sourceId, "twice@example.test"));
    const jobs = harness.app.get(JobsService);
    await jobs.send(SEND_QUEUE, { companyId: company.id, messageId: result.queued[0] });
    await jobs.send(SEND_QUEUE, { companyId: company.id, messageId: result.queued[0] });
    await eventually(async () => ((await rowsOf(sourceId))[0]?.status === "sent" ? true : undefined), "the send");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(callsTo(sends, "twice@example.test")).toBe(1);
    sends.mockRestore();
  });

  it("never sends a scheduled row cancelled before its time (PR #9 re-review)", async () => {
    const sourceId = uuidv7();
    const sends = vi.spyOn(harness.outbox, "send");
    await service().notify(
      tenant,
      null,
      quoteSent(sourceId, "soon@example.test", { scheduledFor: new Date(Date.now() + 1_500) }),
    );
    const [held] = await rowsOf(sourceId);
    await service().cancel(tenant, held.id);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect(callsTo(sends, "soon@example.test")).toBe(0);
    expect((await rowsOf(sourceId))[0].status).toBe("cancelled");
    sends.mockRestore();
  });

  it("sends a retried row scheduled for later at its time, not at once, and keeps it cancellable (owner's work queue)", async () => {
    const sourceId = uuidv7();
    const sends = vi.spyOn(harness.outbox, "send");
    await service().notify(
      tenant,
      null,
      quoteSent(sourceId, "not-an-address", { scheduledFor: new Date(Date.now() + 3_600_000) }),
    );
    const [failed] = await rowsOf(sourceId);
    expect(failed.status).toBe("failed");
    const handle = await harness.companyDb(company.id);
    try {
      await handle.db
        .update(outboxMessages)
        .set({ recipientEmail: "later@example.test" })
        .where(eq(outboxMessages.id, failed.id));
    } finally {
      await handle.close();
    }
    await service().retry(tenant, failed.id);
    expect((await rowsOf(sourceId))[0].status).toBe("scheduled");
    // An early job for the row (an older Retry, a duplicate) must not send it before its time.
    await harness.app.get(JobsService).send(SEND_QUEUE, { companyId: company.id, messageId: failed.id });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(callsTo(sends, "later@example.test")).toBe(0);
    expect((await rowsOf(sourceId))[0].status).toBe("scheduled");
    await service().cancel(tenant, failed.id);
    expect((await rowsOf(sourceId))[0].status).toBe("cancelled");
    sends.mockRestore();
  });

  it("sends nothing for a company in maintenance mode (owner decision 2026-11-13)", async () => {
    const sourceId = uuidv7();
    await harness.control.db
      .update(tenants)
      .set({ maintenanceMode: true, maintenanceReason: "migration_failed" })
      .where(eq(tenants.id, company.id));
    try {
      await service().notify(tenant, null, quoteSent(sourceId, "pat@example.test"));
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect((await rowsOf(sourceId))[0].status).toBe("queued");
    } finally {
      await harness.control.db
        .update(tenants)
        .set({ maintenanceMode: false, maintenanceReason: null })
        .where(eq(tenants.id, company.id));
    }
  });
});
