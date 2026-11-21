import { randomUUID } from "node:crypto";
import {
  auditLog,
  meetingAttendees,
  meetings,
  outboxMessages,
  rolePermissions,
  roles,
  settings,
  userProfiles,
} from "@workspace/db/company";
import { tenantModuleOverrides, user } from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import {
  FEATURES,
  addDays,
  nextPlannedStart,
  type Attendee,
  type Conflict,
  type FeatureKey,
  type Meeting,
} from "@workspace/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { meetingsSharing } from "../src/modules/meetings/meeting-conflicts";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

/** Next year, so every test time is ahead of now; 10 November is always standard time in the US. */
const YEAR = new Date().getUTCFullYear() + 1;
const at = (monthDay: string, time = "09:00") => `${YEAR}-${monthDay}T${time}`;

/** The company's today in America/Chicago, the day the start bound counts from (ADR 0051 "Part 2"). */
const chicagoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

/** The second Sunday of March of a year: the night US clocks go forward. */
function springForward(year: number): string {
  const firstDay = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstDay) % 7);
  return `${year}-03-${String(firstSunday + 7).padStart(2, "0")}`;
}

/** What a move answers. */
interface MoveResult {
  meetings: Meeting[];
  conflicts: Conflict[];
  undo: { previous: Meeting; createdIds: string[] };
}

/** The calendar file of an Outbox row. */
const fileOf = (row: { attachments: { text?: string }[] }) => (row.attachments[0]?.text ?? "").replace(/\r\n /g, "");

/**
 * Meetings on the API, part 2 (meetings.md "Move or resize", "Propose a new time" and the sends
 * table; ADR 0051 "Part 2"): moves, conflicts, undo and proposal decisions, on a company with a
 * database of its own in America/Chicago.
 */
describe("meeting moves, undo and proposals (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  const ids = { owner: "", manager: "", sales: "", sales2: "", employee: "" };
  const emails = { ...ids };
  const cookies = { ...ids, none: "" };

  function call(method: "get" | "post" | "patch", path: string, cookie?: string) {
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

  function conflicted(response: Response, code: string): void {
    status(response, 409);
    expect(response.body.code).toBe(code);
  }

  async function rows<T>(read: (db: Awaited<ReturnType<typeof harness.companyDb>>["db"]) => Promise<T>): Promise<T> {
    const handle = await harness.companyDb(company.id);
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
  const invitesOf = async (meetingId: string) =>
    (await outboxOf(meetingId)).filter((row) => row.eventKey === "meeting.invite");
  const waitingReminders = async (meetingId: string) =>
    (await outboxOf(meetingId)).filter((row) => row.eventKey === "meeting.reminder" && row.status === "scheduled");
  const entriesOf = (meetingId: string) =>
    rows((db) => db.select().from(auditLog).where(eq(auditLog.targetId, meetingId)));
  const storedMeeting = async (meetingId: string) =>
    (await rows((db) => db.select().from(meetings).where(eq(meetings.id, meetingId))))[0]!;

  const staff = (id: string) => ({ kind: "staff", id });

  const meetingBody = (over: Record<string, unknown> = {}) => ({
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
    ...over,
  });

  async function schedule(cookie: string, over: Record<string, unknown> = {}): Promise<Meeting> {
    const made = await call("post", "/meetings", cookie).send(meetingBody(over));
    status(made, 201);
    return made.body as Meeting;
  }

  async function moved(
    cookie: string,
    meeting: Pick<Meeting, "id">,
    move: { planned: string; start: string; durationMin?: number; scope?: string },
  ): Promise<MoveResult> {
    const response = await call("post", `/meetings/${meeting.id}/reschedule`, cookie).send({
      durationMin: 60,
      scope: "this",
      ...move,
    });
    status(response, 201);
    return response.body as MoveResult;
  }

  const undo = (cookie: string, meetingId: string, sequence: number) =>
    call("post", `/meetings/${meetingId}/reschedule/undo`, cookie).send({ sequence });

  const answer = (cookie: string, meetingId: string, body: Record<string, unknown>) =>
    call("post", `/meetings/${meetingId}/response`, cookie).send({ note: "", proposal: null, ...body });

  beforeAll(async () => {
    process.env.JOBS_POLL_SECONDS = "0.5";
    await harness.start();
    company = await harness.provisionCompany("moves");
    await rows(async (db) => {
      await db.insert(settings).values({
        group: "meetings",
        value: { defaultReminderMin: 15, newGuestHandling: "none", allowProposals: true, hideGuestList: false },
      });
      const [role] = await db.insert(roles).values({ key: "nomove", name: "nomove", dataScope: "all" }).returning();
      await db.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "meetings.meeting.view" });
    });
    const people = {
      owner: await member(["owner"], "Olga Owner"),
      manager: await member(["manager"], "Mia Manager"),
      sales: await member(["sales"], "Sal Sales"),
      sales2: await member(["sales"], "Sue Sales"),
      employee: await member(["employee"], "Ed Employee"),
    };
    for (const key of Object.keys(people) as (keyof typeof people)[]) {
      ids[key] = people[key].userId;
      emails[key] = people[key].email;
    }
    cookies.owner = await enrolled(emails.owner);
    for (const key of ["manager", "sales", "sales2", "employee"] as const)
      cookies[key] = await harness.signIn(emails[key]);
    cookies.none = await harness.signIn((await member(["nomove"], "Nina Nomove")).email);
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("answers 401, 403 without edit, 404 with a switch off, 403 with the module off, and checks the body", async () => {
    const id = uuidv7();
    const routes = [
      `/meetings/${id}/reschedule`,
      `/meetings/${id}/reschedule/undo`,
      `/meetings/${id}/attendees/${uuidv7()}/proposal`,
    ];
    for (const path of routes) {
      status(await call("post", path), 401);
      status(await call("post", path, cookies.none), 403);
      status(await call("post", path, cookies.employee), 403);
    }
    await withFeatureOff("meetings.calendar", async () => {
      for (const path of routes) status(await call("post", path, cookies.owner), 404);
    });
    await withFeatureOff("meetings.invites", async () => {
      status(await call("post", routes[2]!, cookies.owner).send({ accept: true }), 404);
    });
    await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: company.id, module: "meetings", enabled: false });
    try {
      const off = await call("post", routes[0]!, cookies.owner).send({});
      expect(off.status).toBe(403);
      expect(off.body.code).toBe("module_not_enabled");
    } finally {
      await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.tenantId, company.id));
    }

    const made = await schedule(cookies.manager, { title: "Body check" });
    const path = `/meetings/${made.id}/reschedule`;
    const body = { planned: made.start, start: at("11-10", "11:00"), durationMin: 60, scope: "all" };
    status(await call("post", path, cookies.manager).send({ ...body, title: "Sneaky" }), 400);
    refused(
      await call("post", path, cookies.manager).send({ ...body, meetingId: uuidv7() }),
      "The meeting moved must be the one in the address.",
    );
    status(await call("post", path, cookies.manager).send({ ...body, meetingId: made.id }), 201);
    // Undo takes the SEQUENCE seen before the move, never a copy of the meeting (critic B3).
    status(
      await call("post", `${path}/undo`, cookies.manager).send({ sequence: 0, previous: made, createdIds: [] }),
      400,
    );
    status(await call("post", `/meetings/not-a-uuid/reschedule`, cookies.manager).send(body), 400);
  });

  it("moves only a meeting the person may change: 404 unseen or in another company, 403 seen but not theirs", async () => {
    const made = await schedule(cookies.manager, { title: "Scope check", guests: [staff(ids.sales)] });
    const body = { planned: made.start, start: at("11-10", "12:00"), durationMin: 60, scope: "all" };
    status(await call("post", `/meetings/${made.id}/reschedule`, cookies.sales2).send(body), 404);
    const guest = await call("post", `/meetings/${made.id}/reschedule`, cookies.sales).send(body);
    status(guest, 403);
    expect(guest.body.message).toBe("Only the organiser can change this meeting.");
    status(await undo(cookies.sales2, made.id, 0), 404);
    const other = await harness.provisionCompany("movesother");
    const outsider = await enrolled(await harness.addUser({ companyIds: [other.id], roles: ["owner"] }));
    status(await call("post", `/meetings/${made.id}/reschedule`, outsider).send(body), 404);
    status(await undo(outsider, made.id, 0), 404);
    status(
      await call("post", `/meetings/${made.id}/attendees/${ids.sales}/proposal`, outsider).send({ accept: false }),
      404,
    );
    expect(await storedMeeting(made.id)).toMatchObject({ sequence: 0 });
  });

  it("moves a one-off: SEQUENCE + 1, answers kept, an Updated REQUEST at the new time, the reminder moved, times-only audit", async () => {
    const made = await schedule(cookies.manager, {
      title: "Kitchen measure",
      guests: [staff(ids.employee)],
      newGuests: [{ email: "riley@outside.example", name: "Riley Chen" }],
    });
    status(await answer(cookies.employee, made.id, { partStat: "accepted" }), 201);
    const result = await moved(cookies.manager, made, {
      planned: made.start,
      start: at("11-12", "14:00"),
      durationMin: 45,
      scope: "this",
    });
    const [after] = result.meetings;
    expect(after).toMatchObject({ start: at("11-12", "14:00"), durationMin: 45, sequence: 1, rescheduleSequence: 1 });
    expect(after!.attendees.find((a) => a.id === ids.employee)?.partStat).toBe("accepted");
    expect(result).toMatchObject({ conflicts: [], undo: { createdIds: [] } });
    expect(result.undo.previous).toMatchObject({ start: made.start, sequence: 0 });
    expect((await storedMeeting(made.id)).start.toISOString()).toBe(`${YEAR}-11-12T20:00:00.000Z`);

    const updates = (await invitesOf(made.id)).filter((row) => row.values["meeting.action"] === "Updated");
    expect(updates.map((row) => row.recipientType).sort()).toEqual(["guest", "user"]);
    for (const row of updates) {
      expect(fileOf(row)).toContain(`DTSTART;TZID=America/Chicago:${YEAR}1112T140000`);
      expect(fileOf(row)).toContain("SEQUENCE:1");
      expect(fileOf(row)).not.toContain("RECURRENCE-ID");
    }
    const [reminder, ...more] = await waitingReminders(made.id);
    expect(more).toEqual([]);
    expect(reminder?.scheduledFor).toEqual(new Date(`${YEAR}-11-12T19:45:00.000Z`));
    const [entry] = (await entriesOf(made.id)).filter((row) => row.action === "Moved meeting");
    expect(entry!.after).toMatchObject({
      start: at("11-12", "14:00"),
      scope: "all",
      sequence: 1,
      sends: { outside: 1, total: 2 },
    });
    expect(JSON.stringify([entry!.before, entry!.after])).not.toMatch(/Kitchen|@|Riley/);
  });

  it("moves one occurrence on its own: a RECURRENCE-ID file, rescheduleSequence kept, the exception stored", async () => {
    const made = await schedule(cookies.manager, {
      title: "Crew huddle",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
    });
    const planned = at("11-17");
    const result = await moved(cookies.manager, made, { planned, start: at("11-18", "10:00"), durationMin: 30 });
    expect(result.meetings[0]).toMatchObject({ start: made.start, sequence: 1, rescheduleSequence: 0 });
    expect((await storedMeeting(made.id)).exceptions).toEqual([
      { planned, start: at("11-18", "10:00"), durationMin: 30 },
    ]);
    const [row] = (await invitesOf(made.id)).filter((r) => fileOf(r).includes("SEQUENCE:1"));
    expect(fileOf(row!)).toContain(`RECURRENCE-ID;TZID=America/Chicago:${YEAR}1117T090000`);
    expect(fileOf(row!)).toContain(`DTSTART;TZID=America/Chicago:${YEAR}1118T100000`);
    expect(fileOf(row!)).not.toContain("RRULE:FREQ=WEEKLY");
    expect(row!.values["meeting.when"]).toBe(`${YEAR}-11-18 at 10:00`);
  });

  it("splits a series: a new UID at SEQUENCE 0 with copied guests, one REQUEST per series, both reminders; the mover undoes it", async () => {
    const made = await schedule(cookies.manager, {
      title: "Weekly review",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
      newGuests: [{ email: "pat@outside.example", name: "Pat Builder" }],
    });
    status(await answer(cookies.employee, made.id, { partStat: "accepted" }), 201);
    const result = await moved(cookies.owner, made, {
      planned: at("11-24"),
      start: at("11-24", "10:00"),
      scope: "following",
    });
    expect(result.conflicts).toEqual([]);
    const [original, split] = result.meetings;
    expect(original).toMatchObject({
      id: made.id,
      until: `${YEAR}-11-23`,
      sequence: 1,
      rescheduleSequence: 1,
      uid: made.uid,
    });
    expect(split).toMatchObject({
      start: at("11-24", "10:00"),
      until: null,
      sequence: 0,
      rescheduleSequence: 0,
      ownerUserId: ids.manager,
    });
    expect(split!.uid).not.toBe(made.uid);
    expect(result.undo.createdIds).toEqual([split!.id]);
    expect((await storedMeeting(split!.id)).createdBy).toBe(ids.owner);
    const external = (meeting: Meeting) => meeting.attendees.find((a) => a.kind === "external")!;
    expect(external(split!).id).not.toBe(external(original!).id);
    expect(split!.attendees.find((a) => a.id === ids.employee)).toMatchObject({
      partStat: "accepted",
      respondedSequence: 0,
    });

    const oldFiles = (await invitesOf(made.id)).filter((row) => fileOf(row).includes("SEQUENCE:1")).map(fileOf);
    expect(oldFiles).toHaveLength(2);
    for (const file of oldFiles) expect(file).toMatch(/RRULE:FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z/);
    const newFiles = (await invitesOf(split!.id)).map(fileOf);
    expect(newFiles).toHaveLength(2);
    for (const file of newFiles) expect(file).toContain(`UID:${split!.uid}`);
    expect((await waitingReminders(made.id)).map((row) => row.recipientId)).toEqual([ids.employee]);
    expect((await waitingReminders(split!.id)).map((row) => row.recipientId)).toEqual([ids.employee]);
    const [splitEntry] = await entriesOf(split!.id);
    expect(splitEntry).toMatchObject({
      action: "Split meeting series",
      actorUserId: ids.owner,
      after: { from: made.id },
    });

    // Only the person who moved it may undo it, even someone who may change the meeting.
    const notMover = await undo(cookies.manager, made.id, 0);
    status(notMover, 403);
    expect(notMover.body.message).toBe("Only the person who moved this meeting can undo the move.");
    conflicted(await undo(cookies.owner, made.id, 1), "meeting_changed");

    const undone = await undo(cookies.owner, made.id, result.undo.previous.sequence);
    status(undone, 201);
    expect(undone.body).toMatchObject({ start: made.start, until: null, sequence: 2, rescheduleSequence: 2 });
    const removed = await storedMeeting(split!.id);
    expect(removed).toMatchObject({ status: "cancelled", sequence: 1 });
    expect(removed.deletedAt).not.toBeNull();
    const liveCopies = await rows((db) =>
      db.select().from(meetingAttendees).where(eq(meetingAttendees.meetingId, split!.id)),
    );
    expect(liveCopies.every((row) => row.deletedAt !== null)).toBe(true);
    const cancels = (await invitesOf(split!.id)).filter((row) => fileOf(row).includes("METHOD:CANCEL"));
    expect(cancels.map((row) => row.recipientType).sort()).toEqual(["guest", "user"]);
    for (const row of cancels) expect(fileOf(row)).toContain("STATUS:CANCELLED");
    expect(await waitingReminders(split!.id)).toEqual([]);
    expect((await waitingReminders(made.id)).map((row) => row.recipientId)).toEqual([ids.employee]);
    const restored = (await invitesOf(made.id)).filter((row) => fileOf(row).includes("SEQUENCE:2"));
    expect(restored).toHaveLength(2);
    for (const row of restored) expect(fileOf(row)).toMatch(/RRULE:FREQ=WEEKLY\r\n/);
    expect((await entriesOf(made.id)).map((row) => row.action)).toContain("Undid meeting move");
    expect((await entriesOf(split!.id)).map((row) => row.action).sort()).toEqual([
      "Removed split meeting series",
      "Split meeting series",
    ]);
    // A second undo finds the undo as the last change.
    conflicted(await undo(cookies.owner, made.id, 0), "meeting_changed");
  });

  it("splits a series with occurrences moved on their own: each stays on its series under its UID, and the undo puts them back", async () => {
    // Review round 3 of PR #35: the split and its undo with stored exceptions, through the audit entry and back.
    const made = await schedule(cookies.manager, {
      title: "Split with changes",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
    });
    const earlier = { planned: at("11-17"), start: at("11-18", "10:00"), durationMin: 30 };
    const later = { planned: at("12-08"), start: at("12-09", "11:00"), durationMin: 45 };
    await moved(cookies.manager, made, earlier);
    await moved(cookies.manager, made, later);
    const startsAt = (await storedMeeting(made.id)).start;
    const result = await moved(cookies.manager, made, {
      planned: at("11-24"),
      start: at("11-25", "10:00"),
      scope: "following",
    });
    const [original, split] = result.meetings;
    expect(original).toMatchObject({ until: `${YEAR}-11-23`, sequence: 3 });
    expect((await storedMeeting(made.id)).exceptions).toEqual([earlier]);
    // The later one moves with its series, a day and an hour, and keeps its own time.
    expect((await storedMeeting(split!.id)).exceptions).toEqual([{ ...later, planned: at("12-09", "10:00") }]);
    const overrides = async (meetingId: string, sequence: number) =>
      (await invitesOf(meetingId))
        .map(fileOf)
        .filter((file) => file.includes("RECURRENCE-ID") && file.includes(`SEQUENCE:${sequence}\r\n`));
    const [oldCopy, ...moreOld] = await overrides(made.id, 3);
    expect(moreOld).toEqual([]);
    expect(oldCopy).toContain(`UID:${made.uid}`);
    expect(oldCopy).toContain(`RECURRENCE-ID;TZID=America/Chicago:${YEAR}1117T090000`);
    expect(oldCopy).toContain(`DTSTART;TZID=America/Chicago:${YEAR}1118T100000`);
    const [newCopy, ...moreNew] = await overrides(split!.id, 0);
    expect(moreNew).toEqual([]);
    expect(newCopy).toContain(`UID:${split!.uid}`);
    expect(newCopy).toContain(`RECURRENCE-ID;TZID=America/Chicago:${YEAR}1209T100000`);
    expect(newCopy).toContain(`DTSTART;TZID=America/Chicago:${YEAR}1209T110000`);

    const undone = await undo(cookies.manager, made.id, result.undo.previous.sequence);
    status(undone, 201);
    expect(undone.body).toMatchObject({ start: made.start, until: null, sequence: 4, exceptions: [earlier, later] });
    const stored = await storedMeeting(made.id);
    expect(stored).toMatchObject({ until: null, exceptions: [earlier, later], sequence: 4 });
    expect(stored.start).toEqual(startsAt);
    const restored = await overrides(made.id, 4);
    expect(restored.every((file) => file.includes(`UID:${made.uid}`))).toBe(true);
    const recurrenceIds = restored.map((file) => /RECURRENCE-ID;TZID=America\/Chicago:(\d{8}T\d{6})/.exec(file)?.[1]);
    expect(recurrenceIds.sort()).toEqual([`${YEAR}1117T090000`, `${YEAR}1208T090000`]);
    expect(restored.find((file) => file.includes(`${YEAR}1208T090000`))).toContain(
      `DTSTART;TZID=America/Chicago:${YEAR}1209T110000`,
    );
    expect(await storedMeeting(split!.id)).toMatchObject({ status: "cancelled" });
  });

  it("sends a series' surviving exceptions again after an all move, but not one that has ended", async () => {
    // A series that began before the start bound, so its first date is written directly.
    const start = `${YEAR - 2}-01-05T09:00`;
    const made = await schedule(cookies.manager, {
      title: "Long runner",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
    });
    const past = addDays(start, 7);
    const future = addDays(start, 7 * 110);
    expect(future.slice(0, 4)).toBe(String(YEAR));
    await rows((db) =>
      db
        .update(meetings)
        .set({
          start: new Date(`${YEAR - 2}-01-05T15:00:00.000Z`),
          exceptions: [
            { planned: past, start: past.replace("09:00", "11:00") },
            { planned: future, start: future.replace("09:00", "12:00") },
          ],
        })
        .where(eq(meetings.id, made.id)),
    );
    const planned = addDays(start, 7 * 111);
    await moved(cookies.manager, made, { planned, start: planned.replace("09:00", "10:00"), scope: "all" });
    expect((await storedMeeting(made.id)).exceptions).toEqual([
      { planned: past.replace("09:00", "10:00"), start: past.replace("09:00", "11:00") },
      { planned: future.replace("09:00", "10:00"), start: future.replace("09:00", "12:00") },
    ]);
    const files = (await invitesOf(made.id)).map(fileOf);
    const stamp = (local: string) => local.replaceAll("-", "").replace(":", "") + "00";
    const resent = files.filter((file) => file.includes("RECURRENCE-ID"));
    expect(resent).toHaveLength(1);
    expect(resent[0]).toContain(`RECURRENCE-ID;TZID=America/Chicago:${stamp(future.replace("09:00", "10:00"))}`);
    expect(resent[0]).toContain(`DTSTART;TZID=America/Chicago:${stamp(future.replace("09:00", "12:00"))}`);
    expect(files.some((file) => file.includes(stamp(past.replace("09:00", "10:00"))))).toBe(false);
  });

  it("sends an occurrence moved on its own again after a place, title, notes or reminder edit of its series", async () => {
    // Review round 2 of PR #35: an override replaces its occurrence whole, so it must carry the edit.
    const made = await schedule(cookies.manager, {
      title: "Floor walk",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
    });
    await moved(cookies.manager, made, { planned: at("11-17"), start: at("11-18", "10:00"), durationMin: 30 });
    const copies = async () =>
      (await invitesOf(made.id))
        .map(fileOf)
        .filter((file) => file.includes(`RECURRENCE-ID;TZID=America/Chicago:${YEAR}1117T090000`));
    // The move raised SEQUENCE to 1 and the new place to 2; the other edits keep it.
    const edits: [Record<string, unknown>, string][] = [
      [{ location: "Bay 4" }, "LOCATION:Bay 4"],
      [{ title: "Floor walk east" }, "SUMMARY:Floor walk east"],
      [{ notes: "Bring the moisture meter" }, "DESCRIPTION:Bring the moisture meter"],
      [{ reminderMin: 30 }, "TRIGGER:-PT30M"],
    ];
    for (const [patch, line] of edits) {
      const before = (await copies()).length;
      status(await call("patch", `/meetings/${made.id}`, cookies.manager).send(patch), 200);
      const after = await copies();
      expect(after).toHaveLength(before + 1);
      const [latest, ...more] = after.filter((file) => file.includes(line));
      expect(more).toEqual([]);
      expect(latest).toContain(`DTSTART;TZID=America/Chicago:${YEAR}1118T100000`);
      expect(latest).toContain("SEQUENCE:2");
      expect(latest).not.toContain("RRULE:FREQ=WEEKLY");
    }
    expect((await storedMeeting(made.id)).exceptions).toEqual([
      { planned: at("11-17"), start: at("11-18", "10:00"), durationMin: 30 },
    ]);
  });

  it("refuses what can't be moved correctly, and writes nothing", async () => {
    const series = await schedule(cookies.manager, { title: "Refusals", recurrence: "weekly" });
    const refuse = (body: Record<string, unknown>, message: RegExp) =>
      call("post", `/meetings/${series.id}/reschedule`, cookies.manager)
        .send({ durationMin: 60, scope: "this", ...body })
        .then((response) => {
          status(response, 400);
          expect(response.body.message).toMatch(message);
        });
    await refuse({ planned: series.start, start: at("11-10", "10:00"), scope: "following" }, /first occurrence/);
    // Review round 3 of PR #35: the old series keeps 10 and 17 November, so the new one must start after them.
    const keptEarlier =
      /earlier occurrences stay where they are, so this and following must start after the last of them ends/;
    await refuse({ planned: at("11-24"), start: at("11-11"), scope: "following" }, keptEarlier);
    await refuse({ planned: at("11-24"), start: at("11-17", "09:30"), scope: "following" }, keptEarlier);
    await refuse({ planned: at("11-17", "09:30"), start: at("11-17", "10:00") }, /not part of this meeting/);
    await refuse({ planned: at("11-17"), start: `${springForward(YEAR)}T02:30` }, /doesn't exist/);
    await refuse({ planned: at("11-17"), start: at("11-17", "10:00"), durationMin: 5 }, /15 minutes/);
    const monthly = await schedule(cookies.manager, { title: "Monthly", recurrence: "monthly", start: at("11-03") });
    const second = nextPlannedStart(monthly.start, "monthly")!;
    const fifthWeek = await call("post", `/meetings/${monthly.id}/reschedule`, cookies.manager).send({
      planned: second,
      start: at("12-29"),
      durationMin: 60,
      scope: "following",
    });
    refused(fifthWeek, "A monthly meeting can't start in the fifth week of a month.");
    status(await call("post", `/meetings/${series.id}/cancel`, cookies.manager), 201);
    await refuse({ planned: at("11-17"), start: at("11-17", "10:00") }, /cancelled/);
    expect(await storedMeeting(series.id)).toMatchObject({ exceptions: [], sequence: 1, until: null });
    expect((await entriesOf(series.id)).some((row) => row.action === "Moved meeting")).toBe(false);
    expect(await rows((db) => db.select().from(meetings).where(eq(meetings.title, "Refusals")))).toHaveLength(1);
  });

  it("refuses all events from an occurrence moved on its own and writes nothing; this and following from it starts at the new time", async () => {
    // Final review of PR #35: an all move shifts the occurrence's date but keeps its own time, so it would stay put.
    const made = await schedule(cookies.manager, {
      title: "Dragged twice",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
    });
    const own = { planned: at("11-17"), start: at("11-18", "10:00"), durationMin: 60 };
    await moved(cookies.manager, made, own);
    const before = {
      row: await storedMeeting(made.id),
      sent: (await invitesOf(made.id)).length,
      entries: (await entriesOf(made.id)).length,
    };
    const drag = { planned: own.planned, start: at("11-19", "10:00"), durationMin: 60 };
    refused(
      await call("post", `/meetings/${made.id}/reschedule`, cookies.manager).send({ ...drag, scope: "all" }),
      "This occurrence was changed on its own. Choose This event, or move another occurrence to move all events.",
    );
    expect(await storedMeeting(made.id)).toEqual(before.row);
    expect((await invitesOf(made.id)).length).toBe(before.sent);
    expect((await entriesOf(made.id)).length).toBe(before.entries);
    // This and following drops it from both series: the new one starts where it was dragged.
    const split = await moved(cookies.manager, made, { ...drag, scope: "following" });
    const [original, next] = split.meetings;
    expect(original).toMatchObject({ until: `${YEAR}-11-16`, exceptions: [] });
    expect(next).toMatchObject({ start: drag.start, durationMin: 60, exceptions: [] });
    expect((await storedMeeting(next!.id)).exceptions).toEqual([]);
  });

  it("refuses a move over the daily email limit and writes nothing; a private meeting's rows are restricted", async () => {
    const mover = await member(["manager"], "Max Mover");
    const cookie = await harness.signIn(mover.email);
    const made = await schedule(cookie, { title: "Capped", newGuests: [{ email: "cap@outside.example", name: "" }] });
    await rows((db) =>
      db.insert(auditLog).values({
        actorUserId: mover.userId,
        category: "data",
        action: "Scheduled meeting",
        targetType: "meeting",
        targetId: uuidv7(),
        after: { sends: { outside: 200, total: 200 } },
      }),
    );
    refused(
      await call("post", `/meetings/${made.id}/reschedule`, cookie).send({
        planned: made.start,
        start: at("11-11"),
        durationMin: 60,
        scope: "all",
      }),
      "Your meetings can send at most 200 emails a day to people outside the company. Try again tomorrow.",
    );
    expect(await storedMeeting(made.id)).toMatchObject({ sequence: 0 });

    const secret = await schedule(cookies.manager, {
      title: "Secret review",
      private: true,
      guests: [staff(ids.employee)],
    });
    await moved(cookies.manager, secret, { planned: secret.start, start: at("11-10", "15:00"), scope: "all" });
    const updates = (await invitesOf(secret.id)).filter((row) => row.values["meeting.action"] === "Updated");
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((row) => row.restricted)).toBe(true);
    const [entry] = (await entriesOf(secret.id)).filter((row) => row.action === "Moved meeting");
    expect(entry!.targetLabel).toBe("Private meeting");
  });

  it("moves with invites off and sends nothing", async () => {
    const made = await schedule(cookies.manager, { title: "Quiet", guests: [staff(ids.employee)] });
    const before = (await invitesOf(made.id)).length;
    await withFeatureOff("meetings.invites", async () => {
      await moved(cookies.manager, made, { planned: made.start, start: at("11-10", "16:00"), scope: "all" });
    });
    expect((await invitesOf(made.id)).length).toBe(before);
    expect(await storedMeeting(made.id)).toMatchObject({ sequence: 1 });
  });

  it("warns of conflicts, naming a meeting only to a mover who sees it and the guest on it; otherwise Busy", async () => {
    const slot = at("12-01", "13:00");
    const hidden = await schedule(cookies.sales, {
      title: "Private pricing talk",
      start: slot,
      private: true,
      location: "Back office",
      notes: "Margins",
      guests: [staff(ids.employee)],
    });
    const open = await schedule(cookies.sales, {
      title: "Open showroom shift",
      start: at("12-02", "13:00"),
      guests: [staff(ids.employee)],
    });
    const mine = await schedule(cookies.manager, {
      title: "Manager sync",
      start: at("12-01", "08:00"),
      guests: [staff(ids.employee)],
    });

    const busy = await moved(cookies.manager, mine, { planned: mine.start, start: at("12-01", "13:30"), scope: "all" });
    expect(busy.conflicts).toEqual([{ name: "Ed Employee", title: "Busy", start: slot }]);
    expect(JSON.stringify(busy)).not.toMatch(/Private pricing|Back office|Margins/);
    expect(JSON.stringify(busy)).not.toContain(hidden.id);

    const seen = await moved(cookies.manager, mine, {
      planned: at("12-01", "13:30"),
      start: at("12-02", "13:15"),
      scope: "all",
    });
    expect(seen.conflicts).toEqual([
      { name: "Ed Employee", title: "Open showroom shift", start: at("12-02", "13:00") },
    ]);
    expect(JSON.stringify(seen)).not.toContain(open.id);

    // Sue sees Sal's meeting as a guest, but its hidden list hides Ed from her.
    const listHidden = await schedule(cookies.sales, {
      title: "Hidden list",
      start: at("12-03", "13:00"),
      hideGuestList: true,
      guests: [staff(ids.employee), staff(ids.sales2)],
    });
    const hers = await schedule(cookies.sales2, {
      title: "Sue's call",
      start: at("12-03", "08:00"),
      guests: [staff(ids.employee)],
    });
    const sue = await moved(cookies.sales2, hers, { planned: hers.start, start: at("12-03", "13:00"), scope: "all" });
    expect(sue.conflicts).toContainEqual({ name: "Ed Employee", title: "Busy", start: at("12-03", "13:00") });
    expect(sue.conflicts).toContainEqual({ name: "Sue Sales", title: "Hidden list", start: at("12-03", "13:00") });
    expect(JSON.stringify(sue)).not.toContain(listHidden.id);
  });

  it("undoes a move of one occurrence by sending that occurrence again at its restored time", async () => {
    const made = await schedule(cookies.manager, {
      title: "Stand-up",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
    });
    const planned = at("11-24");
    const result = await moved(cookies.manager, made, { planned, start: at("11-25", "07:30"), durationMin: 30 });
    const undone = await undo(cookies.manager, made.id, result.undo.previous.sequence);
    status(undone, 201);
    expect(undone.body).toMatchObject({ exceptions: [], sequence: 2, rescheduleSequence: 2 });
    const files = (await invitesOf(made.id)).map(fileOf).filter((file) => file.includes("SEQUENCE:2"));
    const occurrence = files.filter((file) => file.includes("RECURRENCE-ID"));
    expect(occurrence).toHaveLength(1);
    expect(occurrence[0]).toContain(`RECURRENCE-ID;TZID=America/Chicago:${YEAR}1124T090000`);
    expect(occurrence[0]).toContain(`DTSTART;TZID=America/Chicago:${YEAR}1124T090000`);
    expect(files.filter((file) => !file.includes("RECURRENCE-ID"))).toHaveLength(1);
  });

  it("undoes a move of one occurrence with the series' other occurrences moved on their own sent again, each once", async () => {
    // Final review of PR #35: the undo's series REQUEST carries the surviving exceptions, as every series REQUEST does.
    const made = await schedule(cookies.manager, {
      title: "Two changes",
      recurrence: "weekly",
      guests: [staff(ids.employee)],
    });
    const other = { planned: at("11-17"), start: at("11-18", "10:00"), durationMin: 30 };
    await moved(cookies.manager, made, other);
    const result = await moved(cookies.manager, made, {
      planned: at("11-24"),
      start: at("11-25", "07:30"),
      durationMin: 30,
    });
    const undone = await undo(cookies.manager, made.id, result.undo.previous.sequence);
    status(undone, 201);
    expect(undone.body).toMatchObject({ sequence: 3, exceptions: [other] });
    const filesAt = async (sequence: number) =>
      (await invitesOf(made.id)).map(fileOf).filter((file) => file.includes(`SEQUENCE:${sequence}\r\n`));
    const overrideOf = (files: string[], planned: string) =>
      files.filter((file) => file.includes(`RECURRENCE-ID;TZID=America/Chicago:${YEAR}${planned}`));
    const third = await filesAt(3);
    expect(third.filter((file) => !file.includes("RECURRENCE-ID"))).toHaveLength(1);
    const [resent, ...resentTwice] = overrideOf(third, "1117T090000");
    expect(resentTwice).toEqual([]);
    expect(resent).toContain(`DTSTART;TZID=America/Chicago:${YEAR}1118T100000`);
    const [restored, ...restoredTwice] = overrideOf(third, "1124T090000");
    expect(restoredTwice).toEqual([]);
    expect(restored).toContain(`DTSTART;TZID=America/Chicago:${YEAR}1124T090000`);
    expect(third).toHaveLength(3);

    // Moved again on its own and undone: its earlier exception is among the re-sends, so it goes once, not twice.
    const twice = await moved(cookies.manager, made, {
      planned: at("11-17"),
      start: at("11-19", "11:00"),
      durationMin: 45,
    });
    status(await undo(cookies.manager, made.id, twice.undo.previous.sequence), 201);
    const fifth = await filesAt(5);
    const back = overrideOf(fifth, "1117T090000");
    expect(back).toHaveLength(1);
    expect(back[0]).toContain(`DTSTART;TZID=America/Chicago:${YEAR}1118T100000`);
    expect(fifth).toHaveLength(2);
    const undoSends = (await entriesOf(made.id))
      .filter((row) => row.action === "Undid meeting move")
      .map((row) => (row.after as { sends: { total: number } }).sends.total);
    expect(undoSends.sort()).toEqual([2, 3]);
  });

  it("refuses an undo after an edit, an answer or a cancel, and with the wrong SEQUENCE", async () => {
    const one = async (title: string) => {
      const made = await schedule(cookies.manager, { title, guests: [staff(ids.employee)] });
      await moved(cookies.manager, made, { planned: made.start, start: at("11-10", "10:30"), scope: "all" });
      return made;
    };
    const edited = await one("Edited after");
    status(await call("patch", `/meetings/${edited.id}`, cookies.manager).send({ title: "Edited again" }), 200);
    conflicted(await undo(cookies.manager, edited.id, 0), "meeting_changed");
    const answered = await one("Answered after");
    status(await answer(cookies.employee, answered.id, { partStat: "declined" }), 201);
    conflicted(await undo(cookies.manager, answered.id, 0), "meeting_changed");
    const cancelled = await one("Cancelled after");
    status(await call("post", `/meetings/${cancelled.id}/cancel`, cookies.manager), 201);
    conflicted(await undo(cookies.manager, cancelled.id, 0), "meeting_changed");
    const wrong = await one("Wrong sequence");
    conflicted(await undo(cookies.manager, wrong.id, 1), "meeting_changed");
    status(await undo(cookies.manager, wrong.id, 0), 201);
    const never = await schedule(cookies.manager, { title: "Never moved" });
    conflicted(await undo(cookies.manager, never.id, 0), "meeting_changed");
  });

  it("offers undo for five minutes by the database clock", async () => {
    // A meeting already moved once, written directly, so its move entry can be given an age.
    const startsAt = new Date(`${YEAR}-11-10T15:00:00.000Z`);
    const id = await rows(async (db) => {
      const [row] = await db
        .insert(meetings)
        .values({
          title: "Aged move",
          start: new Date(`${YEAR}-11-10T17:00:00.000Z`),
          durationMin: 60,
          recurrence: "none",
          reminderMin: 15,
          ownerUserId: ids.manager,
          timeZone: "America/Chicago",
          exceptions: [],
          uid: randomUUID(),
          sequence: 1,
          rescheduleSequence: 1,
          status: "confirmed",
          createdBy: ids.manager,
        })
        .returning({ id: meetings.id });
      await db.insert(meetingAttendees).values({
        meetingId: row!.id,
        partyType: "staff",
        partyId: ids.manager,
        name: "Mia Manager",
        email: emails.manager,
        role: "required",
        partStat: "accepted",
        createdBy: ids.manager,
      });
      return row!.id;
    });
    const aged = (minutes: number) =>
      rows((db) =>
        db.insert(auditLog).values({
          at: sql`clock_timestamp() - make_interval(mins => ${minutes})`,
          actorUserId: ids.manager,
          category: "data",
          action: "Moved meeting",
          targetType: "meeting",
          targetId: id,
          before: {
            planned: at("11-10"),
            sequence: 0,
            series: {
              start: at("11-10"),
              startsAt: startsAt.toISOString(),
              durationMin: 60,
              until: null,
              exceptions: [],
            },
          },
          after: {
            start: at("11-10", "11:00"),
            durationMin: 60,
            scope: "all",
            sequence: 1,
            createdIds: [],
            sends: { outside: 0, total: 0 },
          },
        }),
      );
    await aged(6);
    const expired = await undo(cookies.manager, id, 0);
    conflicted(expired, "undo_expired");
    expect(expired.body.message).toBe("This move can no longer be undone.");
    await aged(4);
    const undone = await undo(cookies.manager, id, 0);
    status(undone, 201);
    expect(undone.body).toMatchObject({ start: at("11-10"), sequence: 2 });
    expect((await storedMeeting(id)).start).toEqual(startsAt);
  });

  it("lets only the organiser who may change the meeting decide a proposal; decline sends DECLINECOUNTER, accept moves it", async () => {
    const made = await schedule(cookies.manager, {
      title: "Proposal review",
      guests: [staff(ids.employee), staff(ids.sales)],
      newGuests: [{ email: "pro@outside.example", name: "Pro Guest" }],
    });
    expect(made.allowProposals).toBe(true);
    const proposeAt = at("11-11", "15:00");
    status(
      await answer(cookies.employee, made.id, {
        partStat: "accepted",
        proposal: { start: proposeAt, durationMin: 30, note: "Later" },
      }),
      201,
    );
    status(
      await answer(cookies.sales, made.id, {
        partStat: "accepted",
        proposal: { start: at("11-12"), durationMin: 60, note: "" },
      }),
      201,
    );
    const decide = (cookie: string, attendeeId: string, accept: boolean) =>
      call("post", `/meetings/${made.id}/attendees/${attendeeId}/proposal`, cookie).send({ accept });
    const owner = await decide(cookies.owner, ids.employee, true);
    status(owner, 403);
    expect(owner.body.message).toBe("Only the organiser can decide a proposed time.");
    status(await decide(cookies.sales, ids.employee, true), 403);
    status(await decide(cookies.employee, ids.employee, true), 403);
    const emailGuest = made.attendees.find((a) => a.kind === "external")!.id;
    refused(await decide(cookies.manager, emailGuest, true), "There is no proposal waiting from this guest.");
    status(await decide(cookies.manager, uuidv7(), true), 404);
    status(
      await call("post", `/meetings/${made.id}/attendees/${ids.sales}/proposal`, cookies.manager).send({
        accept: "yes",
      }),
      400,
    );

    const declined = await decide(cookies.manager, ids.sales, false);
    status(declined, 201);
    expect((declined.body as Meeting).sequence).toBe(0);
    const counter = (await invitesOf(made.id)).filter((row) => row.values["meeting.action"] === "Proposal declined");
    expect(counter.map((row) => row.recipientId)).toEqual([ids.sales]);
    const counterFile = fileOf(counter[0]!);
    expect(counterFile).toContain("METHOD:DECLINECOUNTER");
    expect(counterFile.match(/^ATTENDEE/gm)).toHaveLength(1);
    expect(counterFile).not.toMatch(/STATUS:|BEGIN:VALARM/);
    const stored = await rows((db) =>
      db.select().from(meetingAttendees).where(eq(meetingAttendees.meetingId, made.id)),
    );
    expect(stored.find((row) => row.partyId === ids.sales)).toMatchObject({
      partStat: "tentative",
      proposal: { status: "declined" },
    });

    const accepted = await decide(cookies.manager, ids.employee, true);
    status(accepted, 201);
    const after = accepted.body as Meeting;
    expect(after).toMatchObject({ start: proposeAt, durationMin: 30, sequence: 1, rescheduleSequence: 1 });
    expect(after.attendees.every((a) => a.partStat === "needs-action" && a.respondedAt === null)).toBe(true);
    expect(after.attendees.find((a) => a.id === ids.employee)?.proposal?.status).toBe("accepted");
    expect(after.attendees.find((a) => a.id === ids.sales)?.proposal).toBeNull();
    const updates = (await invitesOf(made.id)).filter((row) => row.values["meeting.action"] === "Updated");
    expect(updates.map((row) => row.recipientType).sort()).toEqual(["guest", "user", "user"]);
    expect((await waitingReminders(made.id))[0]?.scheduledFor).toEqual(new Date(`${YEAR}-11-11T20:45:00.000Z`));
    const actions = (await entriesOf(made.id)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["Declined proposed time", "Accepted proposed time"]));

    status(await call("post", `/meetings/${made.id}/cancel`, cookies.manager), 201);
    refused(await decide(cookies.manager, ids.employee, true), "This meeting was cancelled.");
  });

  it("sends no DECLINECOUNTER to a proposer who is no longer a member", async () => {
    const leaver = await member(["employee"], "Lee Leaver");
    const cookie = await harness.signIn(leaver.email);
    const made = await schedule(cookies.manager, { title: "Leaver check", guests: [staff(leaver.userId)] });
    status(
      await answer(cookie, made.id, {
        partStat: "accepted",
        proposal: { start: at("11-13"), durationMin: 60, note: "" },
      }),
      201,
    );
    await rows((db) =>
      db.update(userProfiles).set({ status: "disabled" }).where(eq(userProfiles.userId, leaver.userId)),
    );
    status(
      await call("post", `/meetings/${made.id}/attendees/${leaver.userId}/proposal`, cookies.manager).send({
        accept: false,
      }),
      201,
    );
    expect((await invitesOf(made.id)).filter((row) => row.values["meeting.action"] === "Proposal declined")).toEqual(
      [],
    );
  });

  it("puts the reminder back after an undo and keeps titles, emails and notes out of every audit entry", async () => {
    const made = await schedule(cookies.manager, {
      title: "Cabinet walkthrough",
      notes: "Gate code is a secret",
      guests: [staff(ids.employee)],
      newGuests: [{ email: "walk@outside.example", name: "Wanda Walker" }],
    });
    const result = await moved(cookies.manager, made, {
      planned: made.start,
      start: at("11-14", "13:00"),
      scope: "all",
    });
    expect((await waitingReminders(made.id))[0]?.scheduledFor).toEqual(new Date(`${YEAR}-11-14T18:45:00.000Z`));
    status(await undo(cookies.manager, made.id, result.undo.previous.sequence), 201);
    const [reminder, ...more] = await waitingReminders(made.id);
    expect(more).toEqual([]);
    expect(reminder?.scheduledFor).toEqual(new Date(`${YEAR}-11-10T14:45:00.000Z`));
    const entries = await entriesOf(made.id);
    expect(entries.map((row) => row.action)).toEqual(expect.arrayContaining(["Moved meeting", "Undid meeting move"]));
    expect(JSON.stringify(entries.map((row) => [row.before, row.after]))).not.toMatch(
      /Cabinet|secret|Wanda|walk@|outside\.example/,
    );
  });

  it("audits a change of length alone as 'Changed meeting length', a new start as 'Moved meeting', and undoes either", async () => {
    const made = await schedule(cookies.manager, { title: "Length check", recurrence: "weekly", durationMin: 30 });
    const planned = at("11-17");
    // The same start with a new length is a resize (click-through #44), decided from the stored meeting.
    const resized = await moved(cookies.manager, made, { planned, start: planned, durationMin: 90 });
    const actions = async () => (await entriesOf(made.id)).map((row) => row.action);
    expect(await actions()).toContain("Changed meeting length");
    expect(await actions()).not.toContain("Moved meeting");
    const [lengthEntry] = (await entriesOf(made.id)).filter((row) => row.action === "Changed meeting length");
    expect(lengthEntry!.after).toMatchObject({ start: planned, durationMin: 90, scope: "this" });
    status(await undo(cookies.manager, made.id, resized.undo.previous.sequence), 201);
    expect((await storedMeeting(made.id)).exceptions).toEqual([]);

    // A new start keeping the length is a move, also on an occurrence whose length was changed on its own.
    const next = at("11-24");
    const longer = await moved(cookies.manager, made, { planned: next, start: next, durationMin: 45 });
    const later = await moved(cookies.manager, made, { planned: next, start: at("11-24", "10:00"), durationMin: 45 });
    expect(later.undo.previous.sequence).toBe(longer.undo.previous.sequence + 1);
    const last = (await entriesOf(made.id)).map((row) => row.action);
    expect(last.filter((action) => action === "Moved meeting")).toHaveLength(1);
    expect(last.filter((action) => action === "Changed meeting length")).toHaveLength(2);
    status(await undo(cookies.manager, made.id, later.undo.previous.sequence), 201);
  });

  it("undoes only the last move: an older toast is refused, the newest answers, and the undo itself can't be undone", async () => {
    const made = await schedule(cookies.manager, { title: "Two moves", guests: [staff(ids.employee)] });
    const first = await moved(cookies.manager, made, {
      planned: made.start,
      start: at("11-10", "10:00"),
      scope: "all",
    });
    const second = await moved(cookies.manager, made, {
      planned: at("11-10", "10:00"),
      start: at("11-10", "12:00"),
      scope: "all",
    });
    expect(second.undo.previous.sequence).toBe(first.meetings[0]!.sequence);
    conflicted(await undo(cookies.manager, made.id, first.undo.previous.sequence), "meeting_changed");
    expect(await storedMeeting(made.id)).toMatchObject({ sequence: 2 });
    const undone = await undo(cookies.manager, made.id, second.undo.previous.sequence);
    status(undone, 201);
    expect(undone.body).toMatchObject({ start: at("11-10", "10:00") });
    conflicted(await undo(cookies.manager, made.id, second.undo.previous.sequence), "meeting_changed");
  });

  it("answers a stale undo toast after a colleague's newer move with 409 meeting_changed and writes nothing", async () => {
    // The SEQUENCE is checked before the mover (ADR 0051 "Part 3"; docs/api-contract.md undo).
    const made = await schedule(cookies.manager, { title: "Stale toast", guests: [staff(ids.employee)] });
    const ownersMove = await moved(cookies.owner, made, {
      planned: made.start,
      start: at("11-12", "10:00"),
      scope: "all",
    });
    expect(ownersMove.undo.previous.sequence).toBe(0);
    const managersMove = await moved(cookies.manager, made, {
      planned: at("11-12", "10:00"),
      start: at("11-12", "13:00"),
      scope: "all",
    });
    expect(managersMove.undo.previous.sequence).toBe(1);
    const storedBefore = await storedMeeting(made.id);
    expect(storedBefore).toMatchObject({ sequence: 2 });
    const outboxBefore = (await outboxOf(made.id)).map((row) => row.id).sort();
    const entriesBefore = (await entriesOf(made.id)).length;

    const stale = await undo(cookies.owner, made.id, ownersMove.undo.previous.sequence);
    conflicted(stale, "meeting_changed");
    expect(stale.body.message).toBe("This meeting changed after the move, so the move can't be undone.");
    expect(await storedMeeting(made.id)).toEqual(storedBefore);
    expect((await outboxOf(made.id)).map((row) => row.id).sort()).toEqual(outboxBefore);
    expect(await entriesOf(made.id)).toHaveLength(entriesBefore);

    const undone = await undo(cookies.manager, made.id, managersMove.undo.previous.sequence);
    status(undone, 201);
    expect(undone.body).toMatchObject({ start: at("11-12", "10:00"), sequence: 3 });
  });

  it("counts an undo and a decision against the daily email limits and writes nothing when over", async () => {
    const mover = await member(["manager"], "Cap Mover");
    const cookie = await harness.signIn(mover.email);
    const made = await schedule(cookie, {
      title: "Cap undo",
      guests: [staff(ids.employee)],
      newGuests: [{ email: "capundo@outside.example", name: "" }],
    });
    const result = await moved(cookie, made, { planned: made.start, start: at("11-11", "09:00"), scope: "all" });
    const fill = (outside: number) =>
      rows((db) =>
        db.insert(auditLog).values({
          actorUserId: mover.userId,
          category: "data",
          action: "Scheduled meeting",
          targetType: "meeting",
          targetId: uuidv7(),
          after: { sends: { outside, total: outside } },
        }),
      );
    const proposed = await schedule(cookie, {
      title: "Cap decision",
      guests: [staff(ids.employee)],
      newGuests: [{ email: "capdecide@outside.example", name: "" }],
    });
    status(
      await answer(cookies.employee, proposed.id, {
        partStat: "accepted",
        proposal: { start: at("11-12", "10:00"), durationMin: 60, note: "" },
      }),
      201,
    );
    await fill(200);
    const blocked = await undo(cookie, made.id, result.undo.previous.sequence);
    status(blocked, 400);
    expect(blocked.body.message).toMatch(/at most 200 emails a day/);
    expect(await storedMeeting(made.id)).toMatchObject({ sequence: 1 });
    expect((await entriesOf(made.id)).some((row) => row.action === "Undid meeting move")).toBe(false);

    const accept = await call("post", `/meetings/${proposed.id}/attendees/${ids.employee}/proposal`, cookie).send({
      accept: true,
    });
    status(accept, 400);
    expect(accept.body.message).toMatch(/at most 200 emails a day/);
    expect(await storedMeeting(proposed.id)).toMatchObject({ sequence: 0 });
  });

  it("sends a DECLINECOUNTER each time a proposal is declined, keeps the version, and writes audit entries without notes", async () => {
    const made = await schedule(cookies.manager, { title: "Counter twice", guests: [staff(ids.employee)] });
    const propose = (note: string) =>
      answer(cookies.employee, made.id, {
        partStat: "accepted",
        proposal: { start: at("11-13", "10:00"), durationMin: 60, note },
      });
    const decline = () =>
      call("post", `/meetings/${made.id}/attendees/${ids.employee}/proposal`, cookies.manager).send({ accept: false });
    status(await propose("Private note one"), 201);
    status(await decline(), 201);
    status(await propose("Private note two"), 201);
    status(await decline(), 201);
    const counters = (await invitesOf(made.id)).filter((row) => row.values["meeting.action"] === "Proposal declined");
    expect(counters).toHaveLength(2);
    for (const row of counters) expect(fileOf(row)).toContain("METHOD:DECLINECOUNTER");
    expect(await storedMeeting(made.id)).toMatchObject({ sequence: 0, rescheduleSequence: 0 });
    refused(await decline(), "There is no proposal waiting from this guest.");
    const entries = (await entriesOf(made.id)).filter((row) => row.action === "Declined proposed time");
    expect(entries).toHaveLength(2);
    expect(JSON.stringify(entries.map((row) => [row.before, row.after]))).not.toMatch(/Private note|Counter twice|@/);
  });

  it("allows at most 100 occurrences of a series changed on their own", async () => {
    // It began 300 days ago, so its 101st week stays inside the start bound whatever the month.
    const start = `${addDays(chicagoToday(), -300)}T09:00`;
    const made = await schedule(cookies.manager, { title: "Many changes", recurrence: "weekly", start });
    await rows((db) =>
      db
        .update(meetings)
        .set({
          exceptions: Array.from({ length: 100 }, (_, i) => {
            const planned = addDays(start, 7 * (i + 1));
            return { planned, start: planned.replace("09:00", "11:00") };
          }),
        })
        .where(eq(meetings.id, made.id)),
    );
    const planned = addDays(start, 7 * 101);
    const response = await call("post", `/meetings/${made.id}/reschedule`, cookies.manager).send({
      planned,
      start: planned.replace("09:00", "10:00"),
      durationMin: 60,
      scope: "this",
    });
    status(response, 400);
    expect(response.body.message).toMatch(/at most 100 occurrences/);
    expect((await storedMeeting(made.id)).exceptions).toHaveLength(100);
    expect((await entriesOf(made.id)).some((row) => row.action === "Moved meeting")).toBe(false);
  });

  it("refuses a series change that ties an occurrence already held to a date still ahead, and writes nothing", async () => {
    // Review round 3 of PR #35: such an occurrence is not sent again, so guests' calendars would show that date.
    const today = chicagoToday();
    const day = (offset: number, time = "09:00") => `${addDays(today, offset)}T${time}`;
    const refusedUnchanged = async (meetingId: string, send: () => Promise<Response>) => {
      const before = {
        row: await storedMeeting(meetingId),
        sent: (await invitesOf(meetingId)).length,
        entries: (await entriesOf(meetingId)).length,
      };
      const response = await send();
      status(response, 400);
      expect(response.body.message).toMatch(/has already taken place, but its date in the series is still ahead/);
      expect(await storedMeeting(meetingId)).toEqual(before.row);
      expect((await invitesOf(meetingId)).length).toBe(before.sent);
      expect((await entriesOf(meetingId)).length).toBe(before.entries);
      return response.body.message as string;
    };
    const series = (title: string) =>
      schedule(cookies.manager, { title, recurrence: "weekly", start: day(-21), guests: [staff(ids.employee)] });

    // A week ago's was held an hour late; two weeks later its date in the series would be a week ahead.
    const late = await series("Held late");
    await moved(cookies.manager, late, { planned: day(-7), start: day(-7, "10:00") });
    await refusedUnchanged(late.id, () =>
      call("patch", `/meetings/${late.id}`, cookies.manager).send({ start: day(-7) }),
    );
    await refusedUnchanged(late.id, () =>
      call("post", `/meetings/${late.id}/reschedule`, cookies.manager).send({
        planned: day(7),
        start: day(21),
        durationMin: 60,
        scope: "all",
      }),
    );
    // A day earlier keeps its date in the past, and is taken.
    status(await call("patch", `/meetings/${late.id}`, cookies.manager).send({ start: day(-22) }), 200);

    // Next week's was held early, yesterday: a length edit changes the series' DTEND, so it waits for that date.
    const early = await series("Held early");
    await moved(cookies.manager, early, { planned: day(7), start: day(-1, "10:00") });
    await refusedUnchanged(early.id, () =>
      call("patch", `/meetings/${early.id}`, cookies.manager).send({ durationMin: 45 }),
    );
    // Final review of PR #35: any edit sends a series REQUEST, which can drop that override, so a place or title waits too.
    for (const patch of [{ location: "Bay 2" }, { title: "Held early, renamed" }]) {
      const message = await refusedUnchanged(early.id, () =>
        call("patch", `/meetings/${early.id}`, cookies.manager).send(patch),
      );
      expect(message).toMatch(/Edit the series after that date\.$/);
    }
    // Two weeks back puts its date in the past, so the move is taken; undoing it would bring the date back.
    const back = await moved(cookies.manager, early, { planned: day(21), start: day(7), scope: "all" });
    expect((await storedMeeting(early.id)).exceptions).toEqual([
      { planned: day(-7), start: day(-1, "10:00"), durationMin: 60 },
    ]);
    await refusedUnchanged(early.id, () => undo(cookies.manager, early.id, back.undo.previous.sequence));
    expect((await entriesOf(early.id)).map((row) => row.action)).not.toContain("Undid meeting move");
    // With nothing held now, a place edit is taken.
    status(await call("patch", `/meetings/${early.id}`, cookies.manager).send({ location: "Bay 2" }), 200);

    // Undoing a move of another occurrence also sends a series REQUEST, so it waits while one is held early.
    const undoOne = await series("Held early, one more moved");
    await moved(cookies.manager, undoOne, { planned: day(7), start: day(-1, "10:00") });
    const one = await moved(cookies.manager, undoOne, { planned: day(14), start: day(14, "10:00") });
    const message = await refusedUnchanged(undoOne.id, () =>
      undo(cookies.manager, undoOne.id, one.undo.previous.sequence),
    );
    expect(message).toMatch(/Move the occurrence back with This event instead\.$/);
    expect((await entriesOf(undoOne.id)).map((row) => row.action)).not.toContain("Undid meeting move");
  });

  it("takes a start only from a year before the company's today to three years after it, and writes nothing otherwise", async () => {
    const today = chicagoToday();
    const message = "Choose a start from one year ago up to three years ahead.";
    const tooLate = `${addDays(today, 1098)}T10:00`;
    const tooEarly = `${addDays(today, -368)}T10:00`;
    refused(await call("post", "/meetings", cookies.manager).send(meetingBody({ start: tooLate })), message);
    refused(
      await call("post", "/meetings", cookies.manager).send(
        meetingBody({ start: "1900-01-01T07:00", recurrence: "weekly" }),
      ),
      message,
    );
    refused(
      await call("post", "/meeting-requests", cookies.manager).send({
        withUserId: ids.employee,
        title: "Far request",
        start: tooLate,
        note: "",
        private: false,
      }),
      message,
    );
    const edge = await schedule(cookies.manager, {
      title: "Near the edges",
      start: `${addDays(today, 1095)}T10:00`,
      guests: [staff(ids.employee)],
    });
    await schedule(cookies.manager, {
      title: "A year back",
      start: `${addDays(today, -365)}T10:00`,
      recurrence: "weekly",
    });
    refused(await call("patch", `/meetings/${edge.id}`, cookies.manager).send({ start: tooEarly }), message);
    refused(
      await answer(cookies.employee, edge.id, {
        partStat: "tentative",
        proposal: { start: tooLate, durationMin: 30, note: "" },
      }),
      message,
    );
    refused(
      await call("post", `/meetings/${edge.id}/reschedule`, cookies.manager).send({
        planned: edge.start,
        start: "2999-12-01T10:00",
        durationMin: 60,
        scope: "all",
      }),
      message,
    );
    expect(await storedMeeting(edge.id)).toMatchObject({ sequence: 0 });
    expect((await entriesOf(edge.id)).map((row) => row.action)).toEqual(["Scheduled meeting"]);
  });

  it("works out conflicts from the moved day, however long ago the guests' other series began", async () => {
    const mover = await member(["manager"], "Fay Faraway");
    const cookie = await harness.signIn(mover.email);
    const guest = await member(["employee"], "Gus Guest");
    const near = `${addDays(chicagoToday(), -365)}T10:00`;
    await schedule(cookie, {
      title: "Year-old huddle",
      recurrence: "weekly",
      start: near,
      guests: [staff(guest.userId)],
    });
    // Six hundred series from 1900 with the same guest, written directly, at an hour that overlaps nothing.
    await rows(async (db) => {
      const old = await db
        .insert(meetings)
        .values(
          Array.from({ length: 600 }, (_, i) => ({
            title: `Old series ${i}`,
            start: new Date("1900-01-01T13:00:00.000Z"),
            durationMin: 30,
            recurrence: i % 2 ? ("weekly" as const) : ("monthly" as const),
            reminderMin: 15,
            ownerUserId: mover.userId,
            timeZone: "America/Chicago",
            exceptions: [],
            uid: randomUUID(),
            sequence: 0,
            rescheduleSequence: 0,
            status: "confirmed" as const,
            createdBy: mover.userId,
          })),
        )
        .returning({ id: meetings.id });
      await db.insert(meetingAttendees).values(
        old.map((row) => ({
          meetingId: row.id,
          partyType: "staff" as const,
          partyId: guest.userId,
          name: "Gus Guest",
          email: guest.email,
          role: "required" as const,
          partStat: "accepted" as const,
          createdBy: mover.userId,
        })),
      );
    });
    // The huddle's last week inside the start bound, three years from today.
    const far = addDays(near, 7 * Math.floor((365 + 1095) / 7));
    const oneOff = await schedule(cookie, { title: "Far one-off", guests: [staff(guest.userId)] });
    const began = Date.now();
    const result = await moved(cookie, oneOff, {
      planned: oneOff.start,
      start: far.replace("10:00", "10:30"),
      scope: "all",
    });
    // Walking each series from 1900 took seconds of the meeting's lock (review round 1 of PR #35).
    expect(Date.now() - began).toBeLessThan(2500);
    expect(result.conflicts).toEqual([
      { name: "Fay Faraway", title: "Year-old huddle", start: far },
      { name: "Gus Guest", title: "Year-old huddle", start: far },
    ]);
  });

  it("reads for a conflict only series that have not ended before the day, or that have occurrences moved on their own", async () => {
    // Final review of PR #35: an ended series holds nothing on the day, but one of its occurrences can be moved past its end.
    const mover = await member(["manager"], "Ula Until");
    const cookie = await harness.signIn(mover.email);
    const guest = await member(["employee"], "Ike Ended");
    const day = at("12-15").slice(0, 10);
    const insert = (title: string, until: string | null, exceptions: Meeting["exceptions"] = []) =>
      rows(async (db) => {
        const [row] = await db
          .insert(meetings)
          .values({
            title,
            // Weekly at 09:00 in Chicago from 10 November, standard time, as `at` writes them.
            start: new Date(`${YEAR}-11-10T15:00:00.000Z`),
            durationMin: 60,
            recurrence: "weekly",
            reminderMin: 15,
            ownerUserId: mover.userId,
            timeZone: "America/Chicago",
            until,
            exceptions,
            uid: randomUUID(),
            sequence: 0,
            rescheduleSequence: 0,
            status: "confirmed",
            createdBy: mover.userId,
          })
          .returning({ id: meetings.id });
        await db.insert(meetingAttendees).values({
          meetingId: row!.id,
          partyType: "staff",
          partyId: guest.userId,
          name: "Ike Ended",
          email: guest.email,
          role: "required",
          partStat: "accepted",
          createdBy: mover.userId,
        });
        return row!.id;
      });
    const open = await insert("Open series", null);
    const endsThatDay = await insert("Ends that day", day);
    await insert("Ended series", `${YEAR}-12-01`);
    const movedPast = await insert("Moved past its end", `${YEAR}-12-01`, [
      { planned: at("12-01"), start: at("12-15", "10:00") },
    ]);
    const asGuest: Attendee = {
      kind: "staff",
      id: guest.userId,
      name: "Ike Ended",
      email: guest.email,
      role: "required",
      partStat: "accepted",
      respondedAt: null,
      respondedSequence: null,
      note: "",
      proposal: null,
    };
    const read = await rows((db) => meetingsSharing(db, [asGuest], day));
    expect(read.sort()).toEqual([open, endsThatDay, movedPast].sort());
    // The move's warning is the same as before: the ended series holds nothing that day.
    const oneOff = await schedule(cookie, { title: "Checked one-off", guests: [staff(guest.userId)] });
    const result = await moved(cookie, oneOff, { planned: oneOff.start, start: at("12-15", "09:30"), scope: "all" });
    expect(result.conflicts.map((conflict) => [conflict.name, conflict.title, conflict.start]).sort()).toEqual([
      ["Ike Ended", "Ends that day", at("12-15")],
      ["Ike Ended", "Moved past its end", at("12-15", "10:00")],
      ["Ike Ended", "Open series", at("12-15")],
    ]);
  });

  it("refuses to undo a split once the split-off series changed: an answer, an edit or a cancel on it", async () => {
    const splitOff = async (title: string) => {
      const made = await schedule(cookies.manager, { title, recurrence: "weekly", guests: [staff(ids.employee)] });
      const result = await moved(cookies.owner, made, {
        planned: at("11-24"),
        start: at("11-24", "10:00"),
        scope: "following",
      });
      return { made, result, split: result.meetings[1]! };
    };
    const refusedUndo = async (
      { made, result, split }: Awaited<ReturnType<typeof splitOff>>,
      change: () => Promise<void>,
      splitSequence: number,
    ) => {
      await change();
      const sentBefore = { original: (await invitesOf(made.id)).length, split: (await invitesOf(split.id)).length };
      conflicted(await undo(cookies.owner, made.id, result.undo.previous.sequence), "meeting_changed");
      expect(await storedMeeting(made.id)).toMatchObject({ sequence: 1, until: `${YEAR}-11-23`, deletedAt: null });
      expect(await storedMeeting(split.id)).toMatchObject({ sequence: splitSequence, deletedAt: null });
      const liveCopies = await rows((db) =>
        db.select().from(meetingAttendees).where(eq(meetingAttendees.meetingId, split.id)),
      );
      expect(liveCopies.every((row) => row.deletedAt === null)).toBe(true);
      expect((await invitesOf(made.id)).length).toBe(sentBefore.original);
      expect((await invitesOf(split.id)).length).toBe(sentBefore.split);
      expect((await entriesOf(made.id)).map((row) => row.action)).not.toContain("Undid meeting move");
      expect((await entriesOf(split.id)).map((row) => row.action)).not.toContain("Removed split meeting series");
    };

    const answered = await splitOff("Split answered");
    await refusedUndo(
      answered,
      async () => status(await answer(cookies.employee, answered.split.id, { partStat: "declined" }), 201),
      0,
    );
    // A title edit keeps SEQUENCE 0, so only the split's last audit entry shows the change.
    const edited = await splitOff("Split edited");
    await refusedUndo(
      edited,
      async () =>
        status(await call("patch", `/meetings/${edited.split.id}`, cookies.manager).send({ title: "Renamed" }), 200),
      0,
    );
    const cancelled = await splitOff("Split cancelled");
    await refusedUndo(
      cancelled,
      async () => status(await call("post", `/meetings/${cancelled.split.id}/cancel`, cookies.manager), 201),
      1,
    );
  });

  it("answers every one of several moves and an undo sent at once: no second pool connection inside a transaction", async () => {
    const made = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => schedule(cookies.manager, { title: `Burst ${i}`, guests: [staff(ids.employee)] })),
    );
    const first = await moved(cookies.manager, made[0]!, {
      planned: made[0]!.start,
      start: at("11-10", "17:00"),
      scope: "all",
    });
    const responses = await Promise.all([
      undo(cookies.manager, made[0]!.id, first.undo.previous.sequence),
      ...made.slice(1).map((m, i) =>
        call("post", `/meetings/${m.id}/reschedule`, cookies.manager).send({
          planned: m.start,
          start: at("11-10", `1${i}:15`),
          durationMin: 60,
          scope: "all",
        }),
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
  }, 60_000);
});
