import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { meetingAttendees, meetingResponses, meetings } from "@workspace/db/company";
import {
  cancelledMeeting,
  cancelProblem,
  editedMeeting,
  editProblem,
  featureOn,
  guestAuditName,
  guestLimitProblem,
  icsFileName,
  instantToZoned,
  isOnMeeting,
  isOrganiser,
  MEETING_REQUEST_DEFAULTS,
  meetingFieldsProblem,
  meetingForViewer,
  meetingIcs,
  meetingRequestProblem,
  MEETINGS_PRODID,
  newAttendee,
  newGuestProblem,
  nextOccurrence,
  removeGuestProblem,
  replyOutcome,
  replyProblem,
  requestFlags,
  scheduleFlags,
  seesGuestAddresses,
  seesMeeting,
  staffGuestOf,
  withoutGuest,
  zonedToInstant,
  type Attendee,
  type GuestOption,
  type Meeting,
  type MeetingPatch,
  type MeetingReplyInput,
  type MyMeetings,
  type NewGuestInput,
  type ReplyAnswer,
} from "@workspace/shared";
import { eq } from "drizzle-orm";
import { AccessService, type RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { databaseNow, roleHolders } from "../hr/hr-common";
import { notFound, refuse } from "../sales/sales-common";
import { guestOptions, resolveGuests, type PickedGuest } from "./meeting-guests";
import { companyDay, companyDayStart, dayStartOf, outsideInviteProblem, SENDS_ENTRY } from "./meeting-limits";
import { loadMeetings, partySight } from "./meeting-records";
import { MeetingReminders } from "./meeting-reminders";
import { MeetingSends } from "./meeting-sends";
import {
  checkSends,
  loadedIn,
  lockChangeable,
  lockVisible,
  MeetingWrites,
  resetAnswers,
  shaped,
} from "./meeting-writes";
import {
  activeMembers,
  auditMeeting,
  loadMeetingSettings,
  meetingClock,
  meetingViewer,
  organiserOf,
  refuseIf,
  type MeetingPerson,
} from "./meetings-common";

/** A new meeting as the New meeting form sends it (`MeetingInput`); the server owns everything else. */
export interface MeetingCreateInput {
  title: string;
  start: string;
  durationMin: number;
  location: string;
  notes: string;
  recurrence: Meeting["recurrence"];
  reminderMin: number;
  private: boolean;
  hideGuestList: boolean;
  guests: readonly PickedGuest[];
  newGuests: readonly NewGuestInput[];
}

/** A request to meet as the dialog sends it (`MeetingRequestInput`); its length and place are fixed by the server. */
export interface MeetingRequestCreate {
  withUserId: string;
  title: string;
  start: string;
  note: string;
  private: boolean;
}

/**
 * Meetings on the API, part 1 (meetings.md; ADR 0051): the calendar within the viewer's sight,
 * scheduling with guests resolved on the server, edits, cancelling, removing a guest, answers,
 * requests and the calendar file. Every write locks the meeting, applies the shared rules, works
 * out what it will send from the state it commits, checks the daily email limits and writes its
 * audit entry, all in one transaction. After the commit it sends the invites and re-syncs the
 * reminder, neither of which can fail the request, and answers with the meeting it committed.
 * Moves, undo and proposal decisions are part 2's `MeetingMoves`; both use `meeting-writes.ts`.
 */
@Injectable()
export class MeetingsService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly access: AccessService,
    private readonly sends: MeetingSends,
    private readonly reminders: MeetingReminders,
    private readonly writes: MeetingWrites,
  ) {}

  /** The meetings the person may see, each as they may read it (meetings.md "Who sees which meeting"). */
  async list(tenant: TenantContext, access: RequestAccess): Promise<Meeting[]> {
    const db = await this.tenancy.db(tenant);
    const viewer = meetingViewer(access);
    const seen = (await loadMeetings(db)).map((loaded) => loaded.meeting).filter((m) => seesMeeting(viewer, m));
    const sight = await partySight(db, access, seen);
    return seen.map((meeting) => meetingForViewer(meeting, viewer, sight));
  }

  /** Whom the person may invite (GET /meeting-guests). */
  async guests(tenant: TenantContext, access: RequestAccess): Promise<GuestOption[]> {
    return guestOptions(await this.tenancy.db(tenant), this.control.db, access);
  }

  /**
   * My meetings (GET /me/meetings; meetings.md "The person's own coming meetings"; ADR 0051): the
   * meetings the person organises or is a staff guest on, not cancelled, each with its next
   * occurrence from today in its zone, soonest first. The colleagues they may ask to meet come
   * only when they may send a request and requests can be answered.
   */
  async mine(tenant: TenantContext, access: RequestAccess): Promise<MyMeetings> {
    const db = await this.tenancy.db(tenant);
    const viewer = meetingViewer(access);
    const own = (await loadMeetings(db)).map((loaded) => loaded.meeting).filter((m) => isOnMeeting(m, access.userId));
    const sight = await partySight(db, access, own);
    const now = new Date();
    const coming = own.flatMap((meeting) => {
      const next = nextOccurrence(meeting, instantToZoned(now, meeting.timeZone).slice(0, 10));
      return next ? [{ meeting: meetingForViewer(meeting, viewer, sight), next }] : [];
    });
    coming.sort((a, b) => a.next.startsAt.getTime() - b.next.startsAt.getTime());
    return {
      viewerUserId: access.userId,
      meetings: coming.map(({ meeting, next }) => ({
        meeting,
        next: { start: next.start, durationMin: next.durationMin, planned: next.planned },
      })),
      colleagues: await this.colleagues(tenant, db, access),
    };
  }

  /**
   * Schedules a meeting (meetings.md "Schedule a meeting"; ADR 0051). The zone is the company's,
   * the organiser is the person, and every guest is resolved here; with `meetings.invites` off a
   * meeting takes no guests. The guest list is hidden when asked, when private, and when any guest
   * is not staff; proposals follow the settings and whether the organiser can decide them.
   */
  async create(tenant: TenantContext, actor: Actor, input: MeetingCreateInput): Promise<Meeting> {
    const clock = await meetingClock(this.control.db, tenant);
    refuseIf(meetingFieldsProblem(input, { zone: clock.zone, today: clock.day, recurrence: input.recurrence }));
    for (const guest of input.newGuests) refuseIf(newGuestProblem(guest));
    const userId = actor.access.userId;
    const othersAsked =
      input.newGuests.length > 0 || input.guests.some((g) => !(g.kind === "staff" && g.id === userId));
    if (othersAsked && !featureOn("meetings.invites"))
      throw refuse("Guests can't be invited while meeting invites are switched off.");
    const db = await this.tenancy.db(tenant);
    const meetingSettings = await loadMeetingSettings(db);
    const dayStart = dayStartOf(clock);
    const organiser = await this.person(userId);
    const done = await db.transaction(async (tx) => {
      const { guests, outside } = await resolveGuests(tx, this.control.db, actor.access, input.guests, input.newGuests);
      refuseIf(guestLimitProblem({ guests: guests.length, emailGuests: outside.length }));
      refuseIf(await outsideInviteProblem(tx, userId, outside, dayStart));
      const flags = scheduleFlags(
        { private: input.private, hideGuestList: input.hideGuestList },
        guests,
        meetingSettings,
        actor.access.permissions.has("meetings.meeting.edit"),
      );
      const id = await this.insert(
        tx,
        userId,
        {
          title: input.title.trim(),
          start: input.start,
          durationMin: input.durationMin,
          location: input.location.trim(),
          notes: input.notes,
          recurrence: input.recurrence,
          reminderMin: input.reminderMin,
          timeZone: clock.zone,
          status: "confirmed",
          kind: "meeting",
          private: input.private,
          ...flags,
        },
        [newAttendee({ kind: "staff", ...organiser }, true), ...guests],
      );
      const saved = await loadedIn(tx, id);
      const planned = await this.sends.plan(tx, "schedule", saved.meeting, saved.row.updatedAt);
      const sends = await checkSends(tx, userId, dayStart, planned.sends);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Scheduled meeting",
        meeting: saved.meeting,
        before: null,
        after: { start: input.start, guests: guests.length, [SENDS_ENTRY]: sends },
      });
      return { saved, planned, sight: await partySight(tx, actor.access, [saved.meeting]) };
    });
    await this.writes.afterCommit(tenant, userId, [done.planned]);
    return shaped(actor.access, done);
  }

  /**
   * Edits a meeting's title, notes, place, start, length or reminder (meetings.md rule 6 and the
   * sends table; ADR 0051). Only someone who may change it (`canChangeMeeting`, 403 otherwise), and
   * never a cancelled one. A change of nothing writes nothing. A change of start, length or place
   * raises SEQUENCE and asks every guest again; every guest gets an "Updated" invite either way. A
   * series' occurrences moved on their own shift with a new start, and after any edit the ones that
   * have not ended are sent again, since each carries the title, place, notes, time and reminder it
   * was sent with (ADR 0051 "Series exceptions sent again", ADR 0021). An edit `editProblem` refuses
   * by the database clock is 400 and writes nothing: a start or length change that would put an
   * occurrence out of reach (review round 3 of PR #35), and any edit of a series that would leave an
   * occurrence that has taken place behind at a date still ahead (final review of PR #35).
   */
  async update(tenant: TenantContext, actor: Actor, id: string, sent: MeetingPatch): Promise<Meeting> {
    // Compared as stored, so a title or place sent with spaces around it is no change of its own.
    const patch: MeetingPatch = { ...sent, title: sent.title?.trim(), location: sent.location?.trim() };
    const userId = actor.access.userId;
    const db = await this.tenancy.db(tenant);
    const { today, dayStart } = await companyDay(this.control.db, tenant);
    const done = await db.transaction(async (tx) => {
      const { loaded: before, sight } = await lockChangeable(tx, actor.access, id);
      const now = await databaseNow(tx);
      refuseIf(editProblem(before.meeting, patch, today, now));
      const edit = editedMeeting(before.meeting, patch);
      if (edit.changed.length === 0) return { saved: before, sight, planned: null };
      // The stored instant is kept unless the start changed, so a time the clock shows twice keeps its reading.
      const moved = edit.changed.includes("start");
      const start = (moved && zonedToInstant(edit.meeting.start, edit.meeting.timeZone).instant) || before.row.start;
      await tx
        .update(meetings)
        .set({
          title: edit.meeting.title.trim(),
          notes: edit.meeting.notes,
          location: edit.meeting.location.trim(),
          start,
          durationMin: edit.meeting.durationMin,
          exceptions: edit.meeting.exceptions,
          reminderMin: edit.meeting.reminderMin,
          sequence: edit.meeting.sequence,
          rescheduleSequence: edit.meeting.rescheduleSequence,
          updatedAt: now,
        })
        .where(eq(meetings.id, id));
      if (edit.significant) await resetAnswers(tx, id, now);
      const saved = await loadedIn(tx, id);
      // Every field an edit changes is in the file each moved occurrence was sent with (SUMMARY,
      // LOCATION, DESCRIPTION, DTSTART/DTEND, VALARM), and an override replaces its occurrence whole
      // (RFC 5545 RECURRENCE-ID), so a series' surviving exceptions go again after any edit, not only
      // a timing one (ADR 0051 "Series exceptions sent again"; review round 2 of PR #35).
      const planned = await this.sends.plan(tx, "edit", saved.meeting, saved.row.updatedAt, {
        resendExceptions: true,
      });
      const sends = await checkSends(tx, userId, dayStart, planned.sends);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Edited meeting",
        meeting: before.meeting,
        before: { start: before.meeting.start, changed: edit.changed },
        after: { start: edit.meeting.start, changed: edit.changed, [SENDS_ENTRY]: sends },
      });
      return { saved, sight, planned };
    });
    if (done.planned) await this.writes.afterCommit(tenant, userId, [done.planned]);
    return shaped(actor.access, done);
  }

  /** Cancels a meeting, once (meetings.md sends table; ADR 0051): CANCEL to every guest and no reminder. */
  async cancel(tenant: TenantContext, actor: Actor, id: string): Promise<Meeting> {
    const userId = actor.access.userId;
    const db = await this.tenancy.db(tenant);
    const dayStart = await companyDayStart(this.control.db, tenant);
    const done = await db.transaction(async (tx) => {
      const { loaded: before, sight } = await lockChangeable(tx, actor.access, id);
      refuseIf(cancelProblem(before.meeting));
      const after = cancelledMeeting(before.meeting);
      await tx
        .update(meetings)
        .set({
          status: after.status,
          sequence: after.sequence,
          rescheduleSequence: after.rescheduleSequence,
          updatedAt: await databaseNow(tx),
        })
        .where(eq(meetings.id, id));
      const saved = await loadedIn(tx, id);
      const planned = await this.sends.plan(tx, "cancel", saved.meeting, saved.row.updatedAt);
      const sends = await checkSends(tx, userId, dayStart, planned.sends);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Cancelled meeting",
        meeting: before.meeting,
        before: { status: before.meeting.status },
        after: { status: after.status, [SENDS_ENTRY]: sends },
      });
      return { saved, sight, planned };
    });
    await this.writes.afterCommit(tenant, userId, [done.planned]);
    return shaped(actor.access, done);
  }

  /**
   * Takes one guest off a meeting (meetings.md sends table; ADR 0051): never the organiser, never
   * on a cancelled meeting, and only a guest of this meeting (404 otherwise). The guest's row is
   * marked deleted, SEQUENCE rises by one, and only that guest gets a CANCEL that lists only them.
   */
  async removeGuest(tenant: TenantContext, actor: Actor, id: string, attendeeId: string): Promise<Meeting> {
    const userId = actor.access.userId;
    const db = await this.tenancy.db(tenant);
    const dayStart = await companyDayStart(this.control.db, tenant);
    const done = await db.transaction(async (tx) => {
      const { loaded: before, sight } = await lockChangeable(tx, actor.access, id);
      const row = before.rows.get(attendeeId);
      const guest = before.meeting.attendees.find((a) => a.id === attendeeId);
      if (!row || !guest) throw notFound("guest");
      refuseIf(removeGuestProblem(before.meeting, guest));
      const after = withoutGuest(before.meeting, guest);
      const now = await databaseNow(tx);
      await tx.update(meetingAttendees).set({ deletedAt: now, updatedAt: now }).where(eq(meetingAttendees.id, row.id));
      await tx.update(meetings).set({ sequence: after.sequence, updatedAt: now }).where(eq(meetings.id, id));
      const saved = await loadedIn(tx, id);
      const planned = await this.sends.plan(tx, "remove", saved.meeting, saved.row.updatedAt, { only: guest });
      const sends = await checkSends(tx, userId, dayStart, planned.sends);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Removed meeting guest",
        meeting: before.meeting,
        before: { guest: guestAuditName(guest, before.meeting) },
        after: { [SENDS_ENTRY]: sends },
      });
      return { saved, sight, planned };
    });
    await this.writes.afterCommit(tenant, userId, [done.planned]);
    return shaped(actor.access, done);
  }

  /**
   * The person answers their own invitation or request (meetings.md "Answer", rules 7 and 8; ADR
   * 0051): only a staff guest who is not the organiser, on a meeting that is not cancelled. Every
   * answer is logged; a proposal is a pending Maybe. Accepting a request confirms it and declining
   * cancels it. The organiser is told, and a request that changed status gets its reminder.
   */
  async respond(tenant: TenantContext, actor: Actor, id: string, reply: MeetingReplyInput): Promise<Meeting> {
    const db = await this.tenancy.db(tenant);
    const userId = actor.access.userId;
    const { today, dayStart } = await companyDay(this.control.db, tenant);
    const answered = await db.transaction(async (tx) => {
      const before = await lockVisible(tx, actor.access, id);
      const { meeting } = before;
      const guest = staffGuestOf(meeting, userId);
      const row = before.rows.get(userId);
      if (!guest || !row || row.partyType !== "staff" || isOrganiser(meeting, userId))
        throw refuse("Only a guest on this meeting can answer it.");
      refuseIf(replyProblem(meeting, reply, today));
      const now = await databaseNow(tx);
      const outcome = replyOutcome(meeting, guest, reply as ReplyAnswer, {
        sequence: meeting.sequence,
        respondedAt: instantToZoned(now, meeting.timeZone),
      });
      const answer = outcome.meeting.attendees.find((a) => a.kind === "staff" && a.id === userId) ?? guest;
      if (!outcome.stale) {
        await tx
          .update(meetingAttendees)
          .set({
            partStat: answer.partStat,
            respondedAt: now,
            respondedSequence: answer.respondedSequence,
            note: answer.note,
            proposal: answer.proposal,
            updatedAt: now,
          })
          .where(eq(meetingAttendees.id, row.id));
      }
      if (outcome.statusChange) {
        await tx
          .update(meetings)
          .set({ status: outcome.meeting.status, sequence: outcome.meeting.sequence, updatedAt: now })
          .where(eq(meetings.id, id));
      }
      const proposedStart = reply.proposal ? zonedToInstant(reply.proposal.start, meeting.timeZone).instant : null;
      const [logged] = await tx
        .insert(meetingResponses)
        .values({
          meetingId: id,
          attendeeId: row.id,
          method: outcome.method,
          partStat: outcome.partStat,
          proposedStart,
          note: reply.note,
          sequence: meeting.sequence,
          at: now,
          stale: outcome.stale,
          createdBy: userId,
        })
        .returning({ id: meetingResponses.id });
      // The organiser's notice is one email, to a colleague.
      const sends = await checkSends(tx, userId, dayStart, outcome.event ? [{ recipient: { kind: "staff" } }] : []);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Answered meeting",
        meeting,
        before: { answer: guest.partStat },
        after: { answer: outcome.partStat, [SENDS_ENTRY]: sends },
      });
      const saved = await loadedIn(tx, id);
      return {
        meeting,
        guest,
        outcome,
        responseId: logged!.id,
        saved,
        sight: await partySight(tx, actor.access, [saved.meeting]),
      };
    });
    await this.sends.answered(
      tenant,
      userId,
      answered.meeting,
      answered.guest,
      answered.outcome,
      answered.responseId,
      reply.proposal?.start ?? null,
    );
    if (answered.outcome.statusChange) await this.reminders.sync(tenant, id);
    return shaped(actor.access, answered);
  }

  /**
   * Asks a colleague to meet (meetings.md "Request a meeting"; ADR 0051): an active member who may
   * read meetings, never oneself. Half an hour, "To be agreed", tentative until they answer, with
   * the reminder from Settings → Meetings; they get `meeting.requested`, not a calendar file.
   * Who is asked is checked before the transaction opens: their access is read through the
   * company's pool, and a transaction that waited on a second connection from that small pool
   * could hang the company when a few requests come at once (review of PR #33).
   */
  async request(tenant: TenantContext, actor: Actor, input: MeetingRequestCreate): Promise<Meeting> {
    const clock = await meetingClock(this.control.db, tenant);
    refuseIf(meetingRequestProblem(input, { zone: clock.zone, today: clock.day }));
    const userId = actor.access.userId;
    if (input.withUserId === userId) throw refuse("Choose who to meet with.");
    const db = await this.tenancy.db(tenant);
    const meetingSettings = await loadMeetingSettings(db);
    const [asked] = await activeMembers(db, this.control.db, [input.withUserId]);
    const [askedAccess] = asked ? await this.access.membersAccess(tenant, [asked.id]) : [];
    if (!asked || !askedAccess || askedAccess.disabled || !askedAccess.permissions.has("meetings.meeting.view"))
      throw refuse("Choose who to meet with.");
    const asker = await this.person(userId);
    const dayStart = dayStartOf(clock);
    const done = await db.transaction(async (tx) => {
      const guest = newAttendee({ kind: "staff", ...asked });
      const id = await this.insert(
        tx,
        userId,
        {
          title: input.title.trim(),
          start: input.start,
          durationMin: MEETING_REQUEST_DEFAULTS.durationMin,
          location: MEETING_REQUEST_DEFAULTS.location,
          notes: input.note,
          recurrence: "none",
          reminderMin: meetingSettings.defaultReminderMin,
          timeZone: clock.zone,
          status: "tentative",
          kind: "request",
          private: input.private,
          ...requestFlags(input.private, meetingSettings, actor.access.permissions.has("meetings.meeting.edit")),
        },
        [newAttendee({ kind: "staff", ...asker }, true), guest],
      );
      const sends = await checkSends(tx, userId, dayStart, [{ recipient: guest }]);
      const saved = await loadedIn(tx, id);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Requested meeting",
        meeting: saved.meeting,
        before: null,
        after: { with: guestAuditName(guest, { private: input.private }), [SENDS_ENTRY]: sends },
      });
      return { saved, sight: await partySight(tx, actor.access, [saved.meeting]) };
    });
    await this.sends.requested(tenant, asker, done.saved.meeting, asked);
    return shaped(actor.access, done);
  }

  /**
   * "Add to my calendar" (meetings.md sends table): a PUBLISH file with no guests and no STATUS, at
   * the current UID and SEQUENCE, for a meeting the person may see. A cancelled meeting has none
   * (404, ADR 0051). The ORGANIZER address goes only to a reader who may read guests' addresses
   * (`seesGuestAddresses`); anyone else's file has no ORGANIZER line, which the writer leaves out
   * for an empty address.
   */
  async calendarFile(
    tenant: TenantContext,
    access: RequestAccess,
    id: string,
  ): Promise<{ fileName: string; text: string }> {
    const db = await this.tenancy.db(tenant);
    const viewer = meetingViewer(access);
    const [loaded] = await loadMeetings(db, { ids: [id] });
    if (!loaded || !seesMeeting(viewer, loaded.meeting)) throw notFound("meeting");
    const { meeting, row } = loaded;
    const organiser = await organiserOf(this.control.db, meeting.ownerUserId);
    const showsAddress = seesGuestAddresses(viewer, meeting, await partySight(db, access, [meeting]));
    const text = meetingIcs({
      method: "PUBLISH",
      meeting,
      sequence: meeting.sequence,
      stamp: row.updatedAt,
      organizer: showsAddress ? organiser : { ...organiser, email: "" },
      attendees: [],
      prodId: MEETINGS_PRODID,
    });
    return { fileName: icsFileName(meeting.title), text };
  }

  /** Writes a new meeting and its guests, organiser first; returns its id. The caller writes the audit entry. */
  private async insert(
    tx: CompanyDb,
    userId: string,
    fields: Omit<
      Meeting,
      "id" | "attendees" | "ownerUserId" | "until" | "exceptions" | "uid" | "sequence" | "rescheduleSequence"
    >,
    attendees: readonly Attendee[],
  ): Promise<string> {
    const start = zonedToInstant(fields.start, fields.timeZone).instant;
    if (!start) throw refuse("Enter a date and a start time.");
    const now = await databaseNow(tx);
    const [row] = await tx
      .insert(meetings)
      .values({
        ...fields,
        start,
        ownerUserId: userId,
        until: null,
        exceptions: [],
        uid: randomUUID(),
        sequence: 0,
        rescheduleSequence: 0,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: meetings.id });
    const id = row!.id;
    await tx.insert(meetingAttendees).values(
      attendees.map((guest, index) => ({
        meetingId: id,
        partyType: guest.kind,
        partyId: guest.kind === "external" ? null : guest.id,
        name: guest.name,
        email: guest.email,
        role: guest.role,
        partStat: guest.partStat,
        createdBy: userId,
        // One millisecond apart, so the guests read back in the order they were added.
        createdAt: new Date(now.getTime() + index),
        updatedAt: now,
      })),
    );
    return id;
  }

  /** The person as a meeting names them, from their sign-in. */
  private async person(userId: string): Promise<MeetingPerson> {
    const organiser = await organiserOf(this.control.db, userId);
    return { id: userId, ...organiser };
  }

  /**
   * The colleagues My meetings offers to ask (ADR 0051): active members who may read meetings,
   * never the person, and none unless the person may create one and requests can be answered.
   * The members whose roles tick `meetings.meeting.view` are chosen in SQL first, and the shared
   * engine then decides for those only, with everyone's roles read at once (final review of PR #33).
   */
  private async colleagues(
    tenant: TenantContext,
    db: CompanyDb,
    access: RequestAccess,
  ): Promise<{ id: string; name: string }[]> {
    if (
      !access.permissions.has("meetings.meeting.create") ||
      !featureOn("meetings.requests") ||
      !featureOn("meetings.invites")
    )
      return [];
    const candidates = (await roleHolders(db, "meetings.meeting.view")).filter((id) => id !== access.userId);
    const members = await activeMembers(db, this.control.db, candidates);
    const holders = await this.access.membersAccess(
      tenant,
      members.map((member) => member.id),
    );
    const allowed = new Set(
      holders.filter((h) => !h.disabled && h.permissions.has("meetings.meeting.view")).map((h) => h.userId),
    );
    return members.filter((member) => allowed.has(member.id)).map(({ id, name }) => ({ id, name }));
  }
}
