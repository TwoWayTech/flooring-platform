import {
  auditLog,
  customers,
  meetingAttendees,
  meetingResponses,
  meetings,
  outboxMessages,
  rolePermissions,
  roles,
  settings,
  suppliers,
  userProfiles,
} from "@workspace/db/company";
import { tenantModuleOverrides, tenants, user } from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import {
  FEATURES,
  addDays,
  nextPlannedStart,
  type Attendee,
  type FeatureKey,
  type GuestOption,
  type Meeting,
  type MyMeetings,
} from "@workspace/shared";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AccessService } from "../src/core/access/access.service";
import { JobsService } from "../src/core/jobs/jobs.service";
import { NotificationService, SEND_QUEUE } from "../src/core/notifications/notification.service";
import { TenantContext } from "../src/core/tenancy/tenant-context";
import { MeetingReminders } from "../src/modules/meetings/meeting-reminders";
import { MeetingSends } from "../src/modules/meetings/meeting-sends";
import { activeMembers } from "../src/modules/meetings/meetings-common";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

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

/** Next year, so every test time is ahead of now; 10 November is always standard time in the US. */
const YEAR = new Date().getUTCFullYear() + 1;
const at = (monthDay: string, time = "09:00") => `${YEAR}-${monthDay}T${time}`;

/** The second Sunday of March of a year: the night US clocks go forward. */
function springForward(year: number): string {
  const firstDay = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstDay) % 7);
  return `${year}-03-${String(firstSunday + 7).padStart(2, "0")}`;
}

/** The text of a sent attachment. */
const textOf = (content: Uint8Array | string | undefined) =>
  content instanceof Uint8Array ? new TextDecoder().decode(content) : (content ?? "");

/**
 * Meetings on the API, part 1 (meetings.md; ADR 0051), on Summit as seeded and on a company with a
 * database of its own in America/Chicago.
 */
describe("meetings (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let customerId = "";
  const ids = { owner: "", manager: "", sales: "", sales2: "", employee: "", warehouse: "" };
  const emails = { ...ids };
  const cookies = { ...ids, none: "" };

  function call(method: "get" | "post" | "patch" | "delete", path: string, cookie?: string) {
    let test = request(harness.app.getHttpServer())[method](path).set("X-Forwarded-Host", "localhost:3000");
    if (cookie) test = test.set("Cookie", cookie);
    return test;
  }

  function status(response: Response, expected: number): void {
    expect(response.status, JSON.stringify(response.body)).toBe(expected);
  }

  function refused(response: Response, message: string): void {
    status(response, 400);
    expect(response.body).toEqual({ code: "invalid_request", message });
  }

  async function rows<T>(
    read: (db: Awaited<ReturnType<typeof harness.companyDb>>["db"]) => Promise<T>,
    companyId = company.id,
  ): Promise<T> {
    const handle = await harness.companyDb(companyId);
    try {
      return await read(handle.db);
    } finally {
      await handle.close();
    }
  }

  async function member(roleKeys: string[], name: string) {
    const email = await harness.addUser({ companyIds: [company.id], roles: roleKeys });
    const userId = await harness.userIdOf(email);
    await harness.control.db.update(user).set({ name }).where(eq(user.id, userId));
    return { email, userId };
  }

  async function enrolled(email: string) {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    return sessionCookie(confirmed.headers["set-cookie"]);
  }

  async function withFeatureOff(key: FeatureKey, run: () => Promise<void>) {
    const feature = FEATURES[key] as { enabled: boolean };
    feature.enabled = false;
    try {
      await run();
    } finally {
      feature.enabled = true;
    }
  }

  const outboxOf = (meetingId: string) =>
    rows((db) => db.select().from(outboxMessages).where(eq(outboxMessages.sourceId, meetingId)));

  const waitingReminders = async (meetingId: string) =>
    (await outboxOf(meetingId)).filter((row) => row.eventKey === "meeting.reminder" && row.status === "scheduled");

  /** A meeting body as the New meeting form sends it, with no guests. */
  function meetingBody(over: Record<string, unknown> = {}) {
    return {
      title: "Site visit",
      start: at("11-10"),
      durationMin: 60,
      location: "Showroom",
      guests: [],
      newGuests: [],
      recurrence: "none",
      reminderMin: 15,
      notes: "",
      private: false,
      hideGuestList: false,
      allowProposals: true,
      ...over,
    };
  }

  const staff = (id: string) => ({ kind: "staff", id });

  /** The company as a background job sees it, for calling the services directly. */
  const jobTenant = () =>
    TenantContext.forJob({
      id: company.id,
      status: "trial",
      products: ["flooring"],
      maintenanceMode: false,
      phase: "full",
      databaseStatus: "ready",
    });

  async function schedule(cookie: string, over: Record<string, unknown> = {}): Promise<Meeting> {
    const made = await call("post", "/meetings", cookie).send(meetingBody(over));
    status(made, 201);
    return made.body as Meeting;
  }

  beforeAll(async () => {
    process.env.JOBS_POLL_SECONDS = "0.5";
    await harness.start();
    company = await harness.provisionCompany("meet");
    await rows(async (db) => {
      await db.insert(settings).values({
        group: "meetings",
        value: { defaultReminderMin: 15, newGuestHandling: "contact", allowProposals: true, hideGuestList: false },
      });
      const [role] = await db.insert(roles).values({ key: "nomeet", name: "nomeet", dataScope: "all" }).returning();
      await db.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "customers.customer.view" });
    });
    const people = {
      owner: await member(["owner"], "Olga Owner"),
      manager: await member(["manager"], "Mia Manager"),
      sales: await member(["sales"], "Sal Sales"),
      sales2: await member(["sales"], "Sue Sales"),
      employee: await member(["employee"], "Ed Employee"),
      warehouse: await member(["warehouse"], "Wes Warehouse"),
    };
    for (const key of Object.keys(people) as (keyof typeof people)[]) {
      ids[key] = people[key].userId;
      emails[key] = people[key].email;
    }
    customerId = await rows(
      async (db) =>
        (
          await db
            .insert(customers)
            .values({
              type: "homeowner",
              name: "Coby Customer",
              email: "coby@customer.example",
              terms: "due_on_receipt",
              salesRepId: ids.sales,
            })
            .returning()
        )[0]!.id,
    );
    cookies.owner = await enrolled(emails.owner);
    for (const key of ["manager", "sales", "sales2", "employee", "warehouse"] as const) {
      cookies[key] = await harness.signIn(emails[key]);
    }
    cookies.none = await harness.signIn((await member(["nomeet"], "Nora None")).email);
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("answers 401 without a session, 403 without the key, 404 with a switch off and 403 with the module off", async () => {
    const id = uuidv7();
    const routes: ["get" | "post" | "patch" | "delete", string][] = [
      ["get", "/meetings"],
      ["get", "/meeting-guests"],
      ["get", "/me/meetings"],
      ["get", `/meetings/${id}/calendar.ics`],
      ["post", "/meetings"],
      ["patch", `/meetings/${id}`],
      ["post", `/meetings/${id}/cancel`],
      ["delete", `/meetings/${id}/attendees/${uuidv7()}`],
      ["post", `/meetings/${id}/response`],
      ["post", "/meeting-requests"],
    ];
    for (const [method, path] of routes) {
      status(await call(method, path), 401);
      status(await call(method, path, cookies.none), 403);
    }
    await withFeatureOff("meetings.calendar", async () => {
      for (const [method, path] of routes) status(await call(method, path, cookies.owner), 404);
    });
    await withFeatureOff("meetings.invites", async () => {
      status(await call("get", "/meeting-guests", cookies.owner), 404);
      status(await call("delete", `/meetings/${id}/attendees/${uuidv7()}`, cookies.owner), 404);
      status(await call("post", `/meetings/${id}/response`, cookies.owner), 404);
      status(await call("post", "/meeting-requests", cookies.owner), 404);
      refused(
        await call("post", "/meetings", cookies.sales).send(meetingBody({ guests: [staff(ids.employee)] })),
        "Guests can't be invited while meeting invites are switched off.",
      );
      status(await call("post", "/meetings", cookies.sales).send(meetingBody({ title: "Alone" })), 201);
    });
    await withFeatureOff("meetings.requests", async () => {
      status(await call("post", "/meeting-requests", cookies.owner), 404);
    });
    await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: company.id, module: "meetings", enabled: false });
    try {
      const off = await call("get", "/meetings", cookies.owner);
      expect(off.status).toBe(403);
      expect(off.body.code).toBe("module_not_enabled");
    } finally {
      await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.tenantId, company.id));
    }
  });

  it("shows Summit's seeded meetings to the staff guests who sign in, with the customer blanked for an installer", async () => {
    // Marcus Bell is an installer (own scope) and a seeded guest; staff guests are seeded by sign-in id (critic A3).
    const marcus = await harness.signIn("marcus.bell@summitfloor.example");
    const listed = await call("get", "/meetings", marcus);
    status(listed, 200);
    const titles = (listed.body as Meeting[]).map((m) => m.title).sort();
    expect(titles).toEqual([
      "Design consultation: Coby Harris",
      "Monthly safety talk",
      "Sample delivery: Coastal Plank Co.",
    ]);
    const consult = (listed.body as Meeting[]).find((m) => m.title.startsWith("Design consultation"))!;
    expect(consult.start).toBe("2026-11-19T08:30");
    const customer = consult.attendees.find((a) => a.kind === "customer")!;
    expect(customer).toMatchObject({ name: "Customer", email: "" });
    // Other guests' addresses are blank for a guest who may not change the meeting.
    expect(consult.attendees.filter((a) => a.email).map((a) => a.name)).toEqual(["Marcus Bell"]);
    const mine = await call("get", "/me/meetings", marcus);
    status(mine, 200);
    const body = mine.body as MyMeetings;
    expect(body.meetings.map((m) => m.meeting.title)).toContain("Monthly safety talk");
    expect(body.meetings.every((m) => m.next.start >= "2026-11-15")).toBe(true);
    expect(body.viewerUserId).toBe(await harness.userIdOf("marcus.bell@summitfloor.example"));
  });

  it("schedules a meeting: the server adds the organiser, resolves every guest, stores the instant and sends each guest an .ics", async () => {
    const made = await schedule(cookies.sales, {
      title: "Kitchen measure",
      // Forged guest fields and a second organiser entry are ignored (critic B4).
      guests: [
        { ...staff(ids.sales), partStat: "declined" },
        { ...staff(ids.employee), name: "Forged", email: "forged@evil.example", partStat: "accepted", note: "x" },
        { kind: "customer", id: customerId },
      ],
      newGuests: [{ email: "Riley@Outside.example", name: "Riley Chen", customerId: null }],
    });
    expect(made.ownerUserId).toBe(ids.sales);
    expect(made.attendees.map((a) => [a.kind, a.name, a.partStat])).toEqual([
      ["staff", "Sal Sales", "accepted"],
      ["staff", "Ed Employee", "needs-action"],
      ["customer", "Coby Customer", "needs-action"],
      ["external", "Riley Chen", "needs-action"],
    ]);
    expect(made.attendees[1]!.email).toBe(emails.employee);
    // Any guest outside the company hides the list (ADR 0051), and proposals follow the settings.
    expect(made).toMatchObject({ hideGuestList: true, allowProposals: true, timeZone: "America/Chicago" });
    const [stored] = await rows((db) => db.select().from(meetings).where(eq(meetings.id, made.id)));
    expect(stored!.start.toISOString()).toBe(`${YEAR}-11-10T15:00:00.000Z`);

    const outbox = await outboxOf(made.id);
    const invites = outbox.filter((row) => row.eventKey === "meeting.invite");
    expect(invites.map((row) => row.recipientType).sort()).toEqual(["customer", "guest", "user"]);
    expect(invites.every((row) => row.restricted === false)).toBe(true);
    const [reminder, ...more] = await waitingReminders(made.id);
    expect(more).toEqual([]);
    expect(reminder).toMatchObject({
      recipientId: ids.employee,
      scheduledFor: new Date(`${YEAR}-11-10T14:45:00.000Z`),
    });

    const sent = await eventually(
      async () =>
        harness.outbox.sent.find((m) => m.to.includes(emails.employee) && m.subject.includes("Kitchen measure")),
      "the employee's invite",
    );
    const [file] = sent.attachments ?? [];
    expect(file?.contentType).toBe("text/calendar; method=REQUEST; charset=UTF-8");
    const ics = textOf(file?.content);
    expect(ics).toContain(`UID:${made.uid}`);
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("PRODID:-//Platform//Meetings//EN");
    // With a hidden list each file names only its recipient.
    expect(ics.match(/^ATTENDEE/gm)).toHaveLength(1);
    expect(ics).toContain(`mailto:${emails.employee}`);

    const [entry] = await rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "Scheduled meeting"), eq(auditLog.targetId, made.id))),
    );
    // The emails it sends are counted for the daily limits: the customer and Riley are outside.
    expect(entry).toMatchObject({
      targetLabel: "Kitchen measure",
      after: { start: at("11-10"), guests: 3, sends: { outside: 2, total: 3 } },
    });
    expect(JSON.stringify(entry)).not.toContain("@");
  });

  it("refuses what can't be booked: a time the clocks skip, a line break in the title, too many outside guests, unknown guests", async () => {
    refused(
      await call("post", "/meetings", cookies.sales).send(meetingBody({ start: `${springForward(YEAR)}T02:30` })),
      "That time doesn't exist on the clock: the clocks go forward then. Choose another time.",
    );
    refused(
      await call("post", "/meetings", cookies.sales).send(meetingBody({ title: "Visit\rBCC" })),
      "A title can't contain line breaks or control characters.",
    );
    refused(
      await call("post", "/meetings", cookies.sales).send(meetingBody({ durationMin: 5 })),
      "A meeting lasts from 15 minutes to 24 hours, in whole minutes.",
    );
    const outside = Array.from({ length: 21 }, (_, i) => ({ email: `guest${i}@outside.example`, name: "" }));
    refused(
      await call("post", "/meetings", cookies.sales).send(meetingBody({ newGuests: outside })),
      "A meeting can have at most 20 guests from outside the company.",
    );
    status(await call("post", "/meetings", cookies.sales).send(meetingBody({ guests: [staff(uuidv7())] })), 404);
    // A warehouse user can't read customers, so a customer guest reads as missing.
    status(
      await call("post", "/meetings", cookies.warehouse).send(
        meetingBody({ guests: [{ kind: "customer", id: customerId }] }),
      ),
      404,
    );
  });

  it("hides a private meeting from everyone not on it, the Owner included, in /meetings, the file and /outbox", async () => {
    const made = await schedule(cookies.sales, {
      title: "Private review",
      private: true,
      guests: [staff(ids.employee)],
    });
    expect(made.hideGuestList).toBe(true);
    const ownerList = await call("get", "/meetings", cookies.owner);
    expect((ownerList.body as Meeting[]).some((m) => m.id === made.id)).toBe(false);
    status(await call("get", `/meetings/${made.id}/calendar.ics`, cookies.owner), 404);
    status(await call("patch", `/meetings/${made.id}`, cookies.owner).send({ title: "Seen" }), 404);
    const outbox = await call("get", "/outbox", cookies.owner);
    status(outbox, 200);
    const rowsSeen = (outbox.body as { sourceId: string; subject: string; attachments: unknown[] }[]).filter(
      (row) => row.sourceId === made.id,
    );
    expect(rowsSeen.length).toBeGreaterThan(0);
    expect(rowsSeen.every((row) => row.subject === "Restricted message" && row.attachments.length === 0)).toBe(true);
    const [entry] = await rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "Scheduled meeting"), eq(auditLog.targetId, made.id))),
    );
    expect(entry!.targetLabel).toBe("Private meeting");

    // The guest sees it until they are taken off it.
    status(await call("get", `/meetings/${made.id}/calendar.ics`, cookies.employee), 200);
    status(await call("delete", `/meetings/${made.id}/attendees/${ids.employee}`, cookies.sales), 200);
    status(await call("get", `/meetings/${made.id}/calendar.ics`, cookies.employee), 404);
    const cancel = await eventually(
      async () =>
        harness.outbox.sent.find((m) => m.to.includes(emails.employee) && m.subject === "Removed: Private review"),
      "the removed guest's cancellation",
    );
    expect(textOf(cancel.attachments?.[0]?.content)).toContain("METHOD:CANCEL");
    expect(await waitingReminders(made.id)).toEqual([]);
  });

  it("lets only someone who may change a meeting edit it; a time edit asks everyone again; a reminder edit leaves one reminder each", async () => {
    const made = await schedule(cookies.manager, {
      title: "Pricing review",
      guests: [staff(ids.sales2), staff(ids.employee)],
    });
    // Sue holds edit but has own scope and is only a guest (ADR 0051 "Who may change a meeting").
    const forbidden = await call("patch", `/meetings/${made.id}`, cookies.sales2).send({ title: "Mine now" });
    status(forbidden, 403);
    expect(forbidden.body.code).toBe("forbidden");

    status(
      await call("post", `/meetings/${made.id}/response`, cookies.employee).send({
        partStat: "accepted",
        note: "",
        proposal: null,
      }),
      201,
    );
    const retitled = await call("patch", `/meetings/${made.id}`, cookies.manager).send({ title: "Pricing review, Q4" });
    status(retitled, 200);
    expect(retitled.body).toMatchObject({ sequence: 0, title: "Pricing review, Q4" });
    expect((retitled.body as Meeting).attendees.find((a) => a.id === ids.employee)!.partStat).toBe("accepted");

    status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ reminderMin: 60 }), 200);
    const waiting = await waitingReminders(made.id);
    expect(waiting.map((row) => row.recipientId).sort()).toEqual([ids.employee, ids.sales2].sort());
    expect(waiting.every((row) => row.scheduledFor?.toISOString() === `${YEAR}-11-10T14:00:00.000Z`)).toBe(true);

    const moved = await call("patch", `/meetings/${made.id}`, cookies.manager).send({ start: at("11-10", "10:30") });
    status(moved, 200);
    const after = moved.body as Meeting;
    expect(after).toMatchObject({ sequence: 1, rescheduleSequence: 1, start: at("11-10", "10:30") });
    expect(after.attendees.every((a) => a.partStat === "needs-action")).toBe(true);
    expect(
      (await waitingReminders(made.id)).every(
        (row) => row.scheduledFor?.toISOString() === `${YEAR}-11-10T15:30:00.000Z`,
      ),
    ).toBe(true);
    const updated = (await outboxOf(made.id)).filter(
      (row) => row.eventKey === "meeting.invite" && row.values["meeting.action"] === "Updated",
    );
    expect(updated.length).toBe(6);
    refused(
      await call("patch", `/meetings/${made.id}`, cookies.manager).send({ start: `${springForward(YEAR)}T02:15` }),
      "That time doesn't exist on the clock: the clocks go forward then. Choose another time.",
    );
  });

  it("cancels once: CANCEL to every guest, no reminder left, and no calendar file", async () => {
    const made = await schedule(cookies.manager, {
      title: "Crew briefing",
      guests: [staff(ids.sales2), staff(ids.employee)],
    });
    expect(await waitingReminders(made.id)).toHaveLength(2);
    const cancelled = await call("post", `/meetings/${made.id}/cancel`, cookies.manager);
    status(cancelled, 201);
    expect(cancelled.body).toMatchObject({ status: "cancelled", sequence: 1, rescheduleSequence: 1 });
    refused(await call("post", `/meetings/${made.id}/cancel`, cookies.manager), "This meeting was already cancelled.");
    expect(await waitingReminders(made.id)).toEqual([]);
    status(await call("get", `/meetings/${made.id}/calendar.ics`, cookies.manager), 404);
    const cancels = (await outboxOf(made.id)).filter((row) => row.values["meeting.action"] === "Cancelled");
    expect(cancels.map((row) => row.recipientId).sort()).toEqual([ids.employee, ids.sales2].sort());
    expect(cancels.every((row) => (row.attachments[0]?.text ?? "").includes("STATUS:CANCELLED"))).toBe(true);
    refused(
      await call("patch", `/meetings/${made.id}`, cookies.manager).send({ title: "Back" }),
      "This meeting was cancelled.",
    );
  });

  it("takes answers only from staff guests, tells the organiser each one, and confirms a request on Accept", async () => {
    const made = await schedule(cookies.manager, {
      title: "Showroom plan",
      guests: [staff(ids.sales), staff(ids.employee)],
    });
    refused(
      await call("post", `/meetings/${made.id}/response`, cookies.manager).send({
        partStat: "accepted",
        note: "",
        proposal: null,
      }),
      "Only a guest on this meeting can answer it.",
    );
    refused(
      await call("post", `/meetings/${made.id}/response`, cookies.employee).send({
        partStat: "needs-action",
        note: "",
        proposal: null,
      }),
      "Answer Accept, Maybe or Decline.",
    );
    status(
      await call("post", `/meetings/${made.id}/response`, cookies.employee).send({
        partStat: "accepted",
        note: "Yes",
        proposal: null,
      }),
      201,
    );
    const proposal = { start: at("11-11"), durationMin: 60, note: "Tuesday is busy" };
    const proposed = await call("post", `/meetings/${made.id}/response`, cookies.sales).send({
      partStat: "declined",
      note: "",
      proposal,
    });
    status(proposed, 201);
    // A guest sees their own answer; the other guest's note is not theirs to read.
    const mine = (proposed.body as Meeting).attendees;
    expect(mine.find((a) => a.id === ids.sales)).toMatchObject({
      partStat: "tentative",
      proposal: { status: "pending" },
    });
    expect(mine.find((a) => a.id === ids.employee)).toMatchObject({ note: "", proposal: null });
    const told = (await outboxOf(made.id)).filter((row) =>
      ["meeting.reply", "meeting.proposed"].includes(row.eventKey),
    );
    expect(told.map((row) => row.eventKey).sort()).toEqual(["meeting.proposed", "meeting.reply"]);
    expect(told.every((row) => row.recipientId === ids.manager)).toBe(true);
    const logged = await rows((db) =>
      db.select().from(meetingResponses).where(eq(meetingResponses.meetingId, made.id)),
    );
    expect(logged.map((row) => row.method).sort()).toEqual(["counter", "reply"]);

    // A request: half an hour, "To be agreed", tentative, no reminder until it is accepted.
    refused(
      await call("post", "/meeting-requests", cookies.employee).send({
        withUserId: ids.employee,
        title: "Talk",
        start: at("11-12"),
        note: "",
        private: false,
      }),
      "Choose who to meet with.",
    );
    const asked = await call("post", "/meeting-requests", cookies.employee).send({
      withUserId: ids.sales2,
      title: "Review my goals",
      start: at("11-12", "14:00"),
      durationMin: 240,
      location: "Anywhere",
      note: "Half an hour, please",
      private: false,
    });
    status(asked, 201);
    const requestMeeting = asked.body as Meeting;
    expect(requestMeeting).toMatchObject({
      kind: "request",
      status: "tentative",
      durationMin: 30,
      location: "To be agreed",
      allowProposals: false,
    });
    expect(await waitingReminders(requestMeeting.id)).toEqual([]);
    const requested = (await outboxOf(requestMeeting.id)).filter((row) => row.eventKey === "meeting.requested");
    expect(requested.map((row) => row.recipientId)).toEqual([ids.sales2]);
    const accepted = await call("post", `/meetings/${requestMeeting.id}/response`, cookies.sales2).send({
      partStat: "accepted",
      note: "",
      proposal: null,
    });
    status(accepted, 201);
    expect(accepted.body).toMatchObject({ status: "confirmed", sequence: 1 });
    expect((await waitingReminders(requestMeeting.id)).map((row) => row.recipientId)).toEqual([ids.sales2]);
  });

  it("gives a calendar file to anyone who may see the meeting: PUBLISH, no guests, no status", async () => {
    const made = await schedule(cookies.manager, { title: "Team lunch", guests: [staff(ids.employee)] });
    const file = await call("get", `/meetings/${made.id}/calendar.ics`, cookies.warehouse);
    status(file, 200);
    expect(file.body.fileName).toBe("Team lunch.ics");
    const text = file.body.text as string;
    expect(text).toContain("METHOD:PUBLISH");
    expect(text).toContain(`UID:${made.uid}`);
    expect(text).not.toMatch(/^ATTENDEE/m);
    expect(text).not.toContain("STATUS:");
    // Warehouse reads no guest's address, so its file names no organiser address either.
    expect(text).not.toContain("mailto:");
    expect(text).not.toMatch(/^ORGANIZER/m);
    // An own-scope colleague who is not on it can't see it.
    status(await call("get", `/meetings/${made.id}/calendar.ics`, cookies.sales2), 404);
  });

  it("puts the organiser's address in the calendar file only for those who may read guests' addresses", async () => {
    const made = await schedule(cookies.manager, { title: "Stock count", guests: [staff(ids.employee)] });
    const fileOf = async (cookie: string) => {
      const file = await call("get", `/meetings/${made.id}/calendar.ics`, cookie);
      status(file, 200);
      // Unfolded (RFC 5545 section 3.1), so a long address reads as one line.
      return (file.body.text as string).replace(/\r\n[ \t]/g, "");
    };
    const organizer = `\r\nORGANIZER;CN="Mia Manager":mailto:${emails.manager}\r\n`;
    // The organiser, and the Owner, who may change it.
    expect(await fileOf(cookies.manager)).toContain(organizer);
    expect(await fileOf(cookies.owner)).toContain(organizer);
    // A staff guest who may not change it reads no colleague's address on the meeting either.
    const asGuest = await fileOf(cookies.employee);
    expect(asGuest).not.toContain("mailto:");
    expect(asGuest).not.toMatch(/^ORGANIZER/m);
  });

  it("never sends a reminder after it expired: the send job cancels it", async () => {
    const sourceId = uuidv7();
    const result = await harness.app.get(NotificationService).notify(jobTenant(), null, {
      event: "meeting.reminder",
      source: { type: "meeting", id: sourceId },
      version: "late",
      to: [{ kind: "user", id: ids.employee, name: "Ed Employee", email: "late@example.test" }],
      values: { "meeting.title": "Late", "meeting.when": "now", "meeting.location": "" },
      scheduledFor: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(result.queued).toHaveLength(1);
    const [row] = await eventually(async () => {
      const found = await outboxOf(sourceId);
      return found[0]?.status === "cancelled" ? found : undefined;
    }, "the expired reminder to be cancelled");
    expect(row!.sentAt).toBeNull();
    expect(harness.outbox.sent.some((m) => m.to.includes("late@example.test"))).toBe(false);
  });

  it("caps outside addresses at 50 a person a day, counting an address once, and writes to no colleague who left", async () => {
    const outside = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({ email: `${prefix}${i}@outside.example`, name: "" }));
    await schedule(cookies.warehouse, { title: "Batch A", newGuests: outside("a", 20) });
    await schedule(cookies.warehouse, { title: "Batch B", newGuests: outside("b", 20) });
    refused(
      await call("post", "/meetings", cookies.warehouse).send(meetingBody({ newGuests: outside("c", 11) })),
      "You can invite at most 50 people from outside the company a day. Try again tomorrow.",
    );
    // Addresses already invited today count once, so 10 new ones reach exactly 50.
    await schedule(cookies.warehouse, { title: "Batch C", newGuests: [...outside("c", 10), ...outside("a", 10)] });

    const departed = await member(["employee"], "Dee Departed");
    const made = await schedule(cookies.manager, {
      title: "Handover",
      guests: [staff(departed.userId), staff(ids.employee)],
    });
    await rows((db) =>
      db.update(userProfiles).set({ status: "disabled" }).where(eq(userProfiles.userId, departed.userId)),
    );
    status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ title: "Handover notes" }), 200);
    const updated = (await outboxOf(made.id)).filter((row) => row.values["meeting.action"] === "Updated");
    expect(updated.map((row) => row.recipientId)).toEqual([ids.employee]);
    expect((await waitingReminders(made.id)).map((row) => row.recipientId)).toEqual([ids.employee]);
  });

  it("offers guests the person may invite: colleagues without addresses, and only the customers they may read", async () => {
    const forSales = await call("get", "/meeting-guests", cookies.sales);
    status(forSales, 200);
    const options = forSales.body as { kind: Attendee["kind"]; id: string; name: string; email: string }[];
    expect(options.some((o) => o.kind === "staff" && o.id === ids.sales)).toBe(false);
    expect(options.filter((o) => o.kind === "staff").every((o) => o.email === "")).toBe(true);
    expect(options.find((o) => o.kind === "customer")).toMatchObject({
      id: customerId,
      email: "coby@customer.example",
    });
    const forWarehouse = await call("get", "/meeting-guests", cookies.warehouse);
    expect((forWarehouse.body as { kind: string }[]).some((o) => o.kind === "customer")).toBe(false);
    const guestRows = await rows((db) => db.select().from(meetingAttendees));
    expect(guestRows.every((row) => row.partyType !== "external" || row.partyId === null)).toBe(true);
  });

  it("keeps one company's meetings out of reach of another company's people", async () => {
    const other = await harness.provisionCompany("meetother");
    const outsider = await enrolled(await harness.addUser({ companyIds: [other.id], roles: ["owner"] }));
    const made = await schedule(cookies.manager, { title: "Tenancy probe", guests: [staff(ids.employee)] });
    const listed = await call("get", "/meetings", outsider);
    status(listed, 200);
    expect((listed.body as Meeting[]).some((m) => m.id === made.id || m.title === "Tenancy probe")).toBe(false);
    status(await call("get", `/meetings/${made.id}/calendar.ics`, outsider), 404);
    status(await call("patch", `/meetings/${made.id}`, outsider).send({ title: "Mine" }), 404);
    status(await call("post", `/meetings/${made.id}/cancel`, outsider), 404);
    status(await call("delete", `/meetings/${made.id}/attendees/${ids.employee}`, outsider), 404);
    status(
      await call("post", `/meetings/${made.id}/response`, outsider).send({
        partStat: "accepted",
        note: "",
        proposal: null,
      }),
      404,
    );
    // A colleague of ours is not a guest there either.
    status(await call("post", "/meetings", outsider).send(meetingBody({ guests: [staff(ids.employee)] })), 404);
  });

  it("applies data scope: an own-scope colleague neither sees nor changes another's meeting; a wider scope may", async () => {
    const made = await schedule(cookies.sales, { title: "Dock layout" });
    const ownList = await call("get", "/meetings", cookies.sales2);
    expect((ownList.body as Meeting[]).some((m) => m.id === made.id)).toBe(false);
    status(await call("patch", `/meetings/${made.id}`, cookies.sales2).send({ title: "Hijack" }), 404);
    status(await call("post", `/meetings/${made.id}/cancel`, cookies.sales2), 404);
    const managerList = await call("get", "/meetings", cookies.manager);
    expect((managerList.body as Meeting[]).some((m) => m.id === made.id)).toBe(true);
    status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ title: "Dock layout v2" }), 200);
    // The organiser may always change their own meeting.
    status(await call("patch", `/meetings/${made.id}`, cookies.sales).send({ notes: "Bring a tape" }), 200);
    const [entry] = await rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "Edited meeting"), eq(auditLog.targetId, made.id))),
    );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain("Bring a tape");
  });

  it("answers the one error body for a malformed request, and writes an audit row for each change", async () => {
    refused(
      await call("post", "/meetings", cookies.sales).send(meetingBody({ recurrence: "yearly" })),
      "Choose how the meeting repeats.",
    );
    const bad = await call("post", "/meetings", cookies.sales).send({ title: 7 });
    status(bad, 400);
    expect(Object.keys(bad.body).sort()).toEqual(["code", "message"]);
    const made = await schedule(cookies.manager, { title: "Audit trail", guests: [staff(ids.employee)] });
    status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ location: "Warehouse" }), 200);
    status(
      await call("post", `/meetings/${made.id}/response`, cookies.employee).send({
        partStat: "tentative",
        note: "Maybe",
        proposal: null,
      }),
      201,
    );
    status(await call("post", `/meetings/${made.id}/cancel`, cookies.manager), 201);
    const actions = (await rows((db) => db.select().from(auditLog).where(eq(auditLog.targetId, made.id)))).map(
      (row) => row.action,
    );
    expect(actions.sort()).toEqual(["Answered meeting", "Cancelled meeting", "Edited meeting", "Scheduled meeting"]);
  });

  it("sends a new invite each time a guest is told again, and one reply notice per answer", async () => {
    const made = await schedule(cookies.manager, { title: "Version check", guests: [staff(ids.employee)] });
    for (const partStat of ["accepted", "declined", "accepted"]) {
      status(
        await call("post", `/meetings/${made.id}/response`, cookies.employee).send({
          partStat,
          note: "",
          proposal: null,
        }),
        201,
      );
    }
    const replies = (await outboxOf(made.id)).filter((row) => row.eventKey === "meeting.reply");
    expect(replies).toHaveLength(3);
    expect(new Set(replies.map((row) => row.dedupeKey)).size).toBe(3);

    status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ start: at("11-10", "13:00") }), 200);
    status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ location: "Lot B" }), 200);
    status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ title: "Version check 2" }), 200);
    const updates = (await outboxOf(made.id)).filter((row) => row.values["meeting.action"] === "Updated");
    expect(updates).toHaveLength(3);
    expect(new Set(updates.map((row) => row.dedupeKey)).size).toBe(3);
    // Start, length and place raise SEQUENCE; a title edit keeps it (meetings.md "Sends").
    const sequences = updates.map((row) => /SEQUENCE:(\d+)/.exec(row.attachments[0]?.text ?? "")?.[1]).sort();
    expect(sequences).toEqual(["1", "2", "2"]);
    expect(updates.every((row) => (row.attachments[0]?.text ?? "").includes("METHOD:REQUEST"))).toBe(true);
  });

  it("leaves one waiting reminder per guest after repeated edits, and the old ones cancelled", async () => {
    const made = await schedule(cookies.manager, { title: "Reminder churn", guests: [staff(ids.employee)] });
    for (const reminderMin of [30, 60, 15]) {
      status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ reminderMin }), 200);
    }
    const reminders = (await outboxOf(made.id)).filter((row) => row.eventKey === "meeting.reminder");
    expect(reminders.filter((row) => row.status === "scheduled")).toHaveLength(1);
    expect(reminders.filter((row) => row.status === "cancelled").length).toBe(reminders.length - 1);
    expect(new Set(reminders.map((row) => row.dedupeKey)).size).toBe(reminders.length);
    expect((await waitingReminders(made.id))[0]!.scheduledFor).toEqual(new Date(`${YEAR}-11-10T14:45:00.000Z`));
    // Taking the only guest off leaves no reminder.
    status(await call("delete", `/meetings/${made.id}/attendees/${ids.employee}`, cookies.manager), 200);
    expect(await waitingReminders(made.id)).toEqual([]);
  });

  it("shifts a series' moved occurrences with a new start and sends them again; refuses a shift that takes one off (part 2)", async () => {
    const made = await schedule(cookies.manager, {
      title: "Weekly crew",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
    });
    const planned = at("11-17");
    await rows((db) =>
      db
        .update(meetings)
        .set({ exceptions: [{ planned, start: at("11-18", "10:00") }] })
        .where(eq(meetings.id, made.id)),
    );
    const edited = await call("patch", `/meetings/${made.id}`, cookies.manager).send({ start: at("11-10", "10:00") });
    status(edited, 200);
    expect((edited.body as Meeting).exceptions).toEqual([
      { planned: at("11-17", "10:00"), start: at("11-18", "10:00") },
    ]);
    const files = (await outboxOf(made.id))
      .filter((row) => row.eventKey === "meeting.invite")
      .map((row) => (row.attachments[0]?.text ?? "").replace(/\r\n /g, ""))
      .filter((text) => text.includes("SEQUENCE:1"));
    expect(files).toHaveLength(2);
    expect(files.filter((text) => text.includes(`RECURRENCE-ID;TZID=America/Chicago:${YEAR}1117T100000`))).toHaveLength(
      1,
    );
    status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ durationMin: 90 }), 200);
    status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ title: "Weekly crew sync" }), 200);

    // A monthly series whose fourth-week occurrence was moved can't shift into the first week.
    const monthly = await schedule(cookies.manager, {
      title: "Fourth week",
      recurrence: "monthly",
      start: at("11-22"),
    });
    const second = nextPlannedStart(monthly.start, "monthly")!;
    await rows((db) =>
      db
        .update(meetings)
        .set({ exceptions: [{ planned: second, start: second.replace("09:00", "11:00") }] })
        .where(eq(meetings.id, monthly.id)),
    );
    refused(
      await call("patch", `/meetings/${monthly.id}`, cookies.manager).send({ start: addDays(monthly.start, 14) }),
      "An occurrence changed on its own would no longer be part of the series after this move. Move it on its own first, or choose another time.",
    );
  });

  it("lets the organiser retitle Summit's seeded monthly meeting", async () => {
    const [summit] = (await harness.control.db.select().from(tenants)).filter((t) => /summit/i.test(t.name));
    const [monthly] = await rows(
      (db) => db.select().from(meetings).where(eq(meetings.recurrence, "monthly")),
      summit!.id,
    );
    expect(monthly).toBeDefined();
    const [organiser] = await harness.control.db.select().from(user).where(eq(user.id, monthly!.ownerUserId));
    const cookie = await enrolled(organiser!.email);
    const edited = await call("patch", `/meetings/${monthly!.id}`, cookie).send({
      title: "Monthly safety talk (bay 2)",
    });
    status(edited, 200);
    expect(edited.body).toMatchObject({ title: "Monthly safety talk (bay 2)", sequence: 0 });
  });

  it("refuses customer guests in an HR Suite company, which has no customers", async () => {
    const hrSuite = await harness.provisionCompany("meethr", ["hr"]);
    const cookie = await enrolled(await harness.addUser({ companyIds: [hrSuite.id], roles: ["owner"] }));
    status(
      await call("post", "/meetings", cookie).send(meetingBody({ guests: [{ kind: "customer", id: customerId }] })),
      404,
    );
    status(await call("post", "/meetings", cookie).send(meetingBody({ title: "HR standup" })), 201);
  });

  it("answers every one of several requests sent at once: no second pool connection inside a transaction", async () => {
    const askers = [cookies.employee, cookies.warehouse, cookies.manager];
    const responses = await Promise.all(
      [...askers, ...askers].map((cookie, i) =>
        call("post", "/meeting-requests", cookie).send({
          withUserId: ids.sales2,
          title: `Quick sync ${i}`,
          start: at("11-13", "10:00"),
          note: "",
          private: false,
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201, 201]);
  }, 60_000);

  it("lets nobody change a meeting with a customer they can't read, the organiser included, so /outbox never shows it", async () => {
    const hr = await member(["hr"], "Hana HR");
    const hrCookie = await enrolled(hr.email);
    const homeowner = await rows(
      async (db) =>
        (
          await db
            .insert(customers)
            .values({
              type: "homeowner",
              name: "Avery Homes",
              email: "avery@homes.example",
              terms: "due_on_receipt",
              salesRepId: ids.sales,
            })
            .returning()
        )[0]!.id,
    );
    const made = await schedule(cookies.sales, {
      title: "Measure for Avery",
      guests: [staff(ids.employee), { kind: "customer", id: homeowner }],
    });
    // The HR manager has all scope and meetings.*, but no customers: the meeting shows, the customer doesn't.
    const seen = ((await call("get", "/meetings", hrCookie)).body as Meeting[]).find((m) => m.id === made.id);
    expect(seen).toBeDefined();
    expect(JSON.stringify(seen)).not.toMatch(/avery@homes\.example|Avery Homes/);
    const message = "Only someone who can see every guest on this meeting can change it.";
    const edit = await call("patch", `/meetings/${made.id}`, hrCookie).send({ notes: "Bring samples" });
    status(edit, 403);
    expect(edit.body).toEqual({ code: "forbidden", message });
    status(await call("post", `/meetings/${made.id}/cancel`, hrCookie), 403);
    status(await call("delete", `/meetings/${made.id}/attendees/${ids.employee}`, hrCookie), 403);
    const outbox = await call("get", "/outbox", hrCookie);
    status(outbox, 200);
    expect(JSON.stringify(outbox.body)).not.toMatch(/avery@homes\.example|Avery Homes/);

    // The organiser loses the change with the customer, once it moves to another rep.
    await rows((db) => db.update(customers).set({ salesRepId: ids.sales2 }).where(eq(customers.id, homeowner)));
    const own = await call("patch", `/meetings/${made.id}`, cookies.sales).send({ notes: "Mine" });
    status(own, 403);
    expect(own.body.message).toBe(message);
    // Someone who reads every guest still may.
    status(await call("patch", `/meetings/${made.id}`, cookies.owner).send({ notes: "Bring samples" }), 200);
    const [stored] = await rows((db) => db.select().from(meetings).where(eq(meetings.id, made.id)));
    expect(stored!.notes).toBe("Bring samples");
  });

  it("caps every email outside the company, repeats included: 200 a person a day, on schedule, edit and cancel", async () => {
    const mailer = await member(["manager"], "Max Mailer");
    const cookie = await harness.signIn(mailer.email);
    const same = Array.from({ length: 20 }, (_, i) => ({ email: `repeat${i}@outside.example`, name: "" }));
    const made: Meeting[] = [];
    for (let i = 0; i < 10; i += 1) made.push(await schedule(cookie, { title: `Repeat ${i}`, newGuests: same }));
    const message =
      "Your meetings can send at most 200 emails a day to people outside the company. Try again tomorrow.";
    refused(
      await call("post", "/meetings", cookie).send(meetingBody({ title: "Repeat 10", newGuests: same })),
      message,
    );
    const first = made[0]!.id;
    refused(await call("patch", `/meetings/${first}`, cookie).send({ title: "Repeat 0 again" }), message);
    refused(await call("post", `/meetings/${first}/cancel`, cookie), message);
    // A refused change writes nothing.
    const [kept] = await rows((db) => db.select().from(meetings).where(eq(meetings.id, first)));
    expect(kept).toMatchObject({ title: "Repeat 0", status: "confirmed", sequence: 0 });
    // Emails to colleagues only still go.
    status(
      await call("post", "/meetings", cookie).send(meetingBody({ title: "Team only", guests: [staff(ids.employee)] })),
      201,
    );
    const invites = await rows((db) =>
      db
        .select()
        .from(outboxMessages)
        .where(and(eq(outboxMessages.actorUserId, mailer.userId), eq(outboxMessages.eventKey, "meeting.invite"))),
    );
    expect(invites.filter((row) => row.recipientType !== "user")).toHaveLength(200);
  }, 120_000);

  it("answers a committed change even when its invites can't be written, and still re-syncs the reminder", async () => {
    const made = await schedule(cookies.manager, { title: "Sturdy edit", guests: [staff(ids.employee)] });
    const notifications = harness.app.get(NotificationService);
    const real = notifications.notify.bind(notifications);
    const failing = vi.spyOn(notifications, "notify").mockImplementation(async (tenant, actor, input, options) => {
      if (input.event === "meeting.invite") throw new Error("The Outbox is down.");
      return real(tenant, actor, input, options);
    });
    try {
      const edited = await call("patch", `/meetings/${made.id}`, cookies.manager).send({ reminderMin: 60 });
      status(edited, 200);
      expect(edited.body).toMatchObject({ reminderMin: 60 });
    } finally {
      failing.mockRestore();
    }
    const waiting = await waitingReminders(made.id);
    expect(waiting.map((row) => row.scheduledFor?.toISOString())).toEqual([`${YEAR}-11-10T14:00:00.000Z`]);
    expect((await outboxOf(made.id)).filter((row) => row.values["meeting.action"] === "Updated")).toEqual([]);

    // A failure while working out what to send happens before the commit, so nothing is half done.
    const planning = vi.spyOn(harness.app.get(MeetingSends), "plan").mockRejectedValueOnce(new Error("No control."));
    try {
      status(await call("patch", `/meetings/${made.id}`, cookies.manager).send({ title: "Half done" }), 500);
    } finally {
      planning.mockRestore();
    }
    const [stored] = await rows((db) => db.select().from(meetings).where(eq(meetings.id, made.id)));
    expect(stored).toMatchObject({ title: "Sturdy edit", reminderMin: 60 });
  });

  it("holds no meeting lock while background jobs are down, and waits on the outage once per change (final review of PR #33)", async () => {
    const jobs = harness.app.get(JobsService);
    const real = jobs.send.bind(jobs);
    const handle = await harness.companyDb(company.id);
    /** Each queueing of this company's rows: which row, and whether its meeting was locked meanwhile. */
    const tries: { messageId: string; meetingLocked: boolean }[] = [];
    const down = vi.spyOn(jobs, "send").mockImplementation(async (queue, data, options) => {
      const job = data as { companyId?: string; messageId?: string };
      if (queue !== SEND_QUEUE || job.companyId !== company.id || !job.messageId) return real(queue, data, options);
      const [row] = await handle.db
        .select({ sourceId: outboxMessages.sourceId })
        .from(outboxMessages)
        .where(eq(outboxMessages.id, job.messageId));
      let meetingLocked = false;
      try {
        await handle.db.transaction(async (tx) => {
          await tx
            .select({ id: meetings.id })
            .from(meetings)
            .where(eq(meetings.id, row!.sourceId))
            .for("update", { noWait: true });
        });
      } catch {
        meetingLocked = true;
      }
      tries.push({ messageId: job.messageId, meetingLocked });
      throw new Error("Background jobs are not available right now.");
    });
    const triesFor = async (meetingId: string, event: string) => {
      const ids = new Set((await outboxOf(meetingId)).filter((row) => row.eventKey === event).map((row) => row.id));
      return tries.filter((attempt) => ids.has(attempt.messageId));
    };
    try {
      const made = await schedule(cookies.manager, {
        title: "Jobs down",
        guests: [staff(ids.employee), staff(ids.warehouse), staff(ids.sales2)],
      });
      // Every guest's invite and reminder is written; one failed queueing stops the rest.
      const outbox = await outboxOf(made.id);
      const invites = outbox.filter((row) => row.eventKey === "meeting.invite");
      expect(invites.map((row) => row.status)).toEqual(["queued", "queued", "queued"]);
      expect(await waitingReminders(made.id)).toHaveLength(3);
      expect(await triesFor(made.id, "meeting.invite")).toHaveLength(1);
      expect(await triesFor(made.id, "meeting.reminder")).toEqual([]);

      // A re-sync on its own queues its reminders after its transaction committed, and stops at the first failure.
      const reminders = harness.app.get(MeetingReminders);
      await reminders.sync(jobTenant(), made.id);
      expect(await waitingReminders(made.id)).toHaveLength(3);
      const reminderTries = await triesFor(made.id, "meeting.reminder");
      expect(reminderTries).toHaveLength(1);
      expect(reminderTries[0]!.meetingLocked).toBe(false);

      down.mockRestore();
      // A row left with no job waits for Retry, which queues it. (Earlier tests keep the worker busy, so the send isn't awaited.)
      const queued = vi.spyOn(jobs, "send");
      await harness.app.get(NotificationService).retry(jobTenant(), invites[0]!.id);
      expect(
        queued.mock.calls.filter(([, data]) => (data as { messageId?: string }).messageId === invites[0]!.id),
      ).toHaveLength(1);
      queued.mockRestore();
    } finally {
      down.mockRestore();
      await handle.close();
    }
  });

  it("takes an email guest off by its row id with a CANCEL to them alone, and refuses the organiser and anyone not on it", async () => {
    const made = await schedule(cookies.manager, {
      title: "Tile samples",
      guests: [staff(ids.employee)],
      newGuests: [{ email: "pat@outside.example", name: "Pat Lee" }],
    });
    refused(
      await call("delete", `/meetings/${made.id}/attendees/${ids.manager}`, cookies.manager),
      "The organiser can't be removed from the meeting.",
    );
    // Someone who is not on the meeting is 404, a colleague or not, before any other check.
    status(await call("delete", `/meetings/${made.id}/attendees/${uuidv7()}`, cookies.manager), 404);
    status(await call("delete", `/meetings/${made.id}/attendees/${ids.sales}`, cookies.manager), 404);

    // An email guest has no record of their own, so their wire id is their guest row's id (ADR 0051 "Ids").
    const emailGuest = made.attendees.find((a) => a.kind === "external")!;
    const [stored] = await rows((db) =>
      db
        .select()
        .from(meetingAttendees)
        .where(and(eq(meetingAttendees.meetingId, made.id), eq(meetingAttendees.partyType, "external"))),
    );
    expect(emailGuest.id).toBe(stored!.id);
    const removed = await call("delete", `/meetings/${made.id}/attendees/${emailGuest.id}`, cookies.manager);
    status(removed, 200);
    expect(removed.body).toMatchObject({ sequence: 1 });
    expect((removed.body as Meeting).attendees.map((a) => a.id)).toEqual([ids.manager, ids.employee]);
    const cancels = (await outboxOf(made.id)).filter((row) => row.values["meeting.action"] === "Removed");
    expect(cancels.map((row) => [row.recipientType, row.recipientEmail])).toEqual([["guest", "pat@outside.example"]]);
    const file = cancels[0]!.attachments[0]?.text ?? "";
    expect(file).toContain("METHOD:CANCEL");
    expect(file.match(/^ATTENDEE/gm)).toHaveLength(1);
    expect(file).not.toContain(emails.employee);
    // The colleague still on it keeps their reminder.
    expect((await waitingReminders(made.id)).map((row) => row.recipientId)).toEqual([ids.employee]);
    status(await call("delete", `/meetings/${made.id}/attendees/${emailGuest.id}`, cookies.manager), 404);

    status(await call("post", `/meetings/${made.id}/cancel`, cookies.manager), 201);
    refused(
      await call("delete", `/meetings/${made.id}/attendees/${ids.employee}`, cookies.manager),
      "This meeting was cancelled.",
    );
  });

  it("refuses an answer on a cancelled meeting and a proposal where none is taken; a declined request is cancelled", async () => {
    const proposal = { start: at("11-11"), durationMin: 30, note: "" };
    const weekly = await schedule(cookies.manager, {
      title: "Weekly stock check",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
    });
    // A series takes no proposed time (meetings.md rule 8), even with proposals on.
    expect(weekly.allowProposals).toBe(true);
    refused(
      await call("post", `/meetings/${weekly.id}/response`, cookies.employee).send({
        partStat: "tentative",
        note: "",
        proposal,
      }),
      "This meeting does not take proposed times.",
    );
    status(await call("post", `/meetings/${weekly.id}/cancel`, cookies.manager), 201);
    refused(
      await call("post", `/meetings/${weekly.id}/response`, cookies.employee).send({
        partStat: "accepted",
        note: "",
        proposal: null,
      }),
      "This meeting was cancelled.",
    );
    const logged = await rows((db) =>
      db.select().from(meetingResponses).where(eq(meetingResponses.meetingId, weekly.id)),
    );
    expect(logged).toEqual([]);

    // An employee holds no edit key, so their request takes no proposals.
    const asked = await call("post", "/meeting-requests", cookies.employee).send({
      withUserId: ids.sales,
      title: "Leave plan",
      start: at("11-16", "15:00"),
      note: "",
      private: false,
    });
    status(asked, 201);
    const requested = asked.body as Meeting;
    expect(requested.allowProposals).toBe(false);
    refused(
      await call("post", `/meetings/${requested.id}/response`, cookies.sales).send({
        partStat: "tentative",
        note: "",
        proposal,
      }),
      "This meeting does not take proposed times.",
    );
    const declined = await call("post", `/meetings/${requested.id}/response`, cookies.sales).send({
      partStat: "declined",
      note: "Busy that week",
      proposal: null,
    });
    status(declined, 201);
    expect(declined.body).toMatchObject({ kind: "request", status: "cancelled", sequence: 1 });
    expect(await waitingReminders(requested.id)).toEqual([]);
    const told = (await outboxOf(requested.id)).filter((row) => row.eventKey === "meeting.reply");
    expect(told.map((row) => row.recipientId)).toEqual([ids.employee]);
    refused(
      await call("post", `/meetings/${requested.id}/response`, cookies.sales).send({
        partStat: "accepted",
        note: "",
        proposal: null,
      }),
      "This meeting was cancelled.",
    );
  });

  it("gives a request proposals only when Settings → Meetings allows them and the asker holds edit", async () => {
    const ask = (title: string) =>
      call("post", "/meeting-requests", cookies.manager).send({
        withUserId: ids.employee,
        title,
        start: at("11-17", "11:00"),
        note: "",
        private: false,
      });
    const on = await ask("Goals check");
    status(on, 201);
    expect(on.body).toMatchObject({ allowProposals: true });
    const [stored] = await rows((db) => db.select().from(settings).where(eq(settings.group, "meetings")));
    const value = stored!.value as Record<string, unknown>;
    await rows((db) =>
      db
        .update(settings)
        .set({ value: { ...value, allowProposals: false } })
        .where(eq(settings.id, stored!.id)),
    );
    try {
      const off = await ask("Goals check again");
      status(off, 201);
      expect(off.body).toMatchObject({ allowProposals: false });
    } finally {
      await rows((db) => db.update(settings).set({ value }).where(eq(settings.id, stored!.id)));
    }
  });

  it("lists the colleagues one may ask to meet: active members who read meetings, never oneself, none without create or a switch", async () => {
    await rows(async (db) => {
      const [role] = await db.insert(roles).values({ key: "meetview", name: "meetview", dataScope: "own" }).returning();
      // My meetings lives in the employee portal, so the role reads it too.
      await db
        .insert(rolePermissions)
        .values(
          ["meetings.meeting.view", "hr.portal.view"].map((permissionKey) => ({ roleId: role!.id, permissionKey })),
        );
    });
    const viewer = await member(["meetview"], "Vic Viewer");
    const left = await member(["employee"], "Lee Left");
    await rows((db) => db.update(userProfiles).set({ status: "disabled" }).where(eq(userProfiles.userId, left.userId)));
    // Two who may not read meetings: one only creates them, one had the view tick taken off.
    await rows(async (db) => {
      const [creates] = await db
        .insert(roles)
        .values({ key: "meetcreate", name: "meetcreate", dataScope: "own" })
        .returning();
      await db.insert(rolePermissions).values(
        ["meetings.meeting.create", "hr.portal.view"].map((permissionKey) => ({
          roleId: creates!.id,
          permissionKey,
        })),
      );
      const [untick] = await db
        .insert(roles)
        .values({ key: "meetgone", name: "meetgone", dataScope: "all" })
        .returning();
      await db.insert(rolePermissions).values({
        roleId: untick!.id,
        permissionKey: "meetings.meeting.view",
        deletedAt: new Date(),
      });
    });
    const creator = await member(["meetcreate"], "Cy Creator");
    const unticked = await member(["meetgone"], "Gus Gone");

    const access = harness.app.get(AccessService);
    const asked = vi.spyOn(access, "membersAccess");
    const mine = await call("get", "/me/meetings", cookies.sales);
    status(mine, 200);
    // The engine is asked about those whose roles tick the view key only, all at once.
    expect(asked).toHaveBeenCalledTimes(1);
    const weighed = asked.mock.calls[0]![1];
    asked.mockRestore();
    for (const out of [ids.sales, creator.userId, unticked.userId, left.userId]) expect(weighed).not.toContain(out);
    const colleagues = (mine.body as MyMeetings).colleagues;
    const listed = colleagues.map((c) => c.id);
    expect(listed).toEqual(
      expect.arrayContaining([ids.owner, ids.manager, ids.sales2, ids.employee, ids.warehouse, viewer.userId]),
    );
    expect(listed).not.toContain(ids.sales);
    expect(listed).not.toContain(left.userId);
    expect(listed).not.toContain(creator.userId);
    expect(listed).not.toContain(unticked.userId);
    // Nora holds no meetings key, so nobody may ask her; and a colleague comes with a name only.
    expect(colleagues.some((c) => c.name === "Nora None")).toBe(false);
    expect(colleagues.every((c) => Object.keys(c).sort().join() === "id,name")).toBe(true);

    // The same colleagues as weighing every active member one by one through the engine.
    const everyone = (await rows((db) => activeMembers(db, harness.control.db))).filter((m) => m.id !== ids.sales);
    const oneByOne = await Promise.all(
      everyone.map(async (m) => (await access.membersAccess(jobTenant(), [m.id]))[0]!),
    );
    const expected = everyone.filter(
      (m, i) => !oneByOne[i]!.disabled && oneByOne[i]!.permissions.has("meetings.meeting.view"),
    );
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect([...colleagues].sort(byId)).toEqual(expected.map(({ id, name }) => ({ id, name })).sort(byId));
    // And the engine's answer for many people at once is its answer for each alone, for someone never set up too.
    const stranger = uuidv7();
    const many = await access.membersAccess(jobTenant(), [...everyone.map((m) => m.id), left.userId, stranger]);
    const alone = await Promise.all(
      [...everyone.map((m) => m.id), left.userId, stranger].map(
        async (id) => (await access.membersAccess(jobTenant(), [id]))[0]!,
      ),
    );
    const shape = (a: (typeof many)[number]) => ({
      ...a,
      permissions: [...a.permissions].sort(),
      roleNames: [...a.roleNames].sort(),
    });
    expect(many.map(shape)).toEqual(alone.map(shape));
    expect(many.at(-2)).toMatchObject({ disabled: true });
    expect(many.at(-1)).toMatchObject({ disabled: true, permissions: new Set(), roleNames: [] });

    // Without meetings.meeting.create there is nobody to ask.
    const viewOnly = await call("get", "/me/meetings", await harness.signIn(viewer.email));
    status(viewOnly, 200);
    expect((viewOnly.body as MyMeetings).colleagues).toEqual([]);
    for (const key of ["meetings.requests", "meetings.invites"] as const) {
      await withFeatureOff(key, async () => {
        const off = await call("get", "/me/meetings", cookies.sales);
        status(off, 200);
        expect((off.body as MyMeetings).colleagues, key).toEqual([]);
      });
    }
  });

  it("lets only those who read suppliers invite one, from the record, and hides it from a guest who can't", async () => {
    const supplierId = await rows(
      async (db) =>
        (
          await db
            .insert(suppliers)
            .values({
              name: "Granite Supply",
              type: "goods" as const,
              terms: "net_30" as const,
              email: "orders@granite.example",
              address: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
            })
            .returning()
        )[0]!.id,
    );
    const forWarehouse = (await call("get", "/meeting-guests", cookies.warehouse)).body as GuestOption[];
    expect(forWarehouse.find((o) => o.kind === "supplier" && o.id === supplierId)).toMatchObject({
      name: "Granite Supply",
      email: "orders@granite.example",
    });
    // Sales holds no supplier key: no supplier is offered, and one sent anyway reads as missing.
    const forSales = (await call("get", "/meeting-guests", cookies.sales)).body as GuestOption[];
    expect(forSales.some((o) => o.kind === "supplier" || o.kind === "supplier-contact")).toBe(false);
    status(
      await call("post", "/meetings", cookies.sales).send(
        meetingBody({ guests: [{ kind: "supplier", id: supplierId }] }),
      ),
      404,
    );

    const made = await schedule(cookies.warehouse, {
      title: "Slab delivery",
      guests: [{ kind: "supplier", id: supplierId, name: "Forged", email: "forged@evil.example" }, staff(ids.sales)],
    });
    expect(made.attendees.find((a) => a.kind === "supplier")).toMatchObject({
      id: supplierId,
      name: "Granite Supply",
      email: "orders@granite.example",
    });
    expect(made.hideGuestList).toBe(true);
    const invites = (await outboxOf(made.id)).filter((row) => row.eventKey === "meeting.invite");
    expect(invites.map((row) => [row.recipientType, row.recipientEmail]).sort()).toEqual(
      [
        ["supplier", "orders@granite.example"],
        ["user", emails.sales],
      ].sort(),
    );
    // The staff guest who can't read suppliers sees only their own row.
    const seen = ((await call("get", "/meetings", cookies.sales)).body as Meeting[]).find((m) => m.id === made.id)!;
    expect(seen.attendees.map((a) => a.id)).toEqual([ids.sales]);
    expect(JSON.stringify(seen)).not.toMatch(/Granite|orders@granite|forged/);
  });

  it("answers 409 when the company's time zone has no calendar block", async () => {
    const odd = await harness.provisionCompany("meetzone");
    await harness.control.db.update(tenants).set({ timeZone: "Europe/Paris" }).where(eq(tenants.id, odd.id));
    const cookie = await enrolled(await harness.addUser({ companyIds: [odd.id], roles: ["owner"] }));
    const response = await call("post", "/meetings", cookie).send(meetingBody());
    status(response, 409);
    expect(response.body.code).toBe("time_zone_unsupported");
  });
});
