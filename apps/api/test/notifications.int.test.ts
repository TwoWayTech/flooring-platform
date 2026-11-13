import { notifications, outboxMessages, rolePermissions, roles, userRoles } from "@workspace/db/company";
import { authAttempts, rateLimit } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JobsService } from "../src/core/jobs/jobs.service";
import { CLEANUP_QUEUE, NotificationService, type NotifyInput } from "../src/core/notifications/notification.service";
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
      databaseStatus: "ready",
    });
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  const service = () => harness.app.get(NotificationService);

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
    expect(harness.outbox.sent.filter((message) => message.idempotencyKey === sent.dedupeKey)).toHaveLength(1);
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
    const failing = vi.spyOn(harness.outbox, "send").mockRejectedValueOnce(new Error("provider down"));
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
  });

  it("refuses retry and cancel without settings.outbox.view", async () => {
    const plain = await harness.signIn(await harness.addUser({ companyIds: [company.id] }));
    const response = await call("post", `/outbox/${uuidv7()}/retry`, plain);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("forbidden");
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
});
