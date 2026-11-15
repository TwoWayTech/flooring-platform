import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { meetingAttendees, meetingResponses, meetings } from "@workspace/db/company";
import {
  canChangeMeeting,
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
  meetingEmailCount,
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
  seesEveryLinkedGuest,
  seesMeeting,
  staffGuestOf,
  withoutGuest,
  zonedToInstant,
  type Attendee,
  type GuestOption,
  type Meeting,
  type MeetingEmailCount,
  type MeetingPatch,
  type MeetingReplyInput,
  type MyMeetings,
  type NewGuestInput,
  type ReplyAnswer,
} from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import { AccessService, type RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { databaseNow } from "../hr/hr-common";
import { notFound, refuse } from "../sales/sales-common";
import { guestOptions, resolveGuests, type PickedGuest } from "./meeting-guests";
import { companyDayStart, dailyEmailsProblem, dayStartOf, outsideInviteProblem, SENDS_ENTRY } from "./meeting-limits";
import { attendeesOf, loadMeetings, meetingOf, partySight, type LoadedMeeting } from "./meeting-records";
import { MeetingReminders } from "./meeting-reminders";
import { MeetingSends, type PlannedInvites } from "./meeting-sends";
import {
  activeMembers,
  auditMeeting,
  cantSeeEveryGuest,
  loadMeetingSettings,
  lockMeeting,
  meetingClock,
  meetingViewer,
  notTheOrganiser,
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

/** Whether the person reading a meeting may read a guest linked to a record (`partySight`). */
type PartySight = (attendee: Attendee) => boolean;

/** A meeting as a write's transaction commits it, with the reader's sight of its linked guests. */
interface Committed {
  saved: LoadedMeeting;
  sight: PartySight;
}

/**
 * Meetings on the API, part 1 (meetings.md; ADR 0051): the calendar within the viewer's sight,
 * scheduling with guests resolved on the server, edits, cancelling, removing a guest, answers,
 * requests and the calendar file. Every write locks the meeting, applies the shared rules, works
 * out what it will send from the state it commits, checks the daily email limits and writes its
 * audit entry, all in one transaction. After the commit it sends the invites and re-syncs the
 * reminder, neither of which can fail the request, and answers with the meeting it committed.
 * Moves, undo and proposal decisions are part 2.
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
    refuseIf(meetingFieldsProblem(input, { zone: clock.zone, recurrence: input.recurrence }));
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
      const saved = await this.loadedIn(tx, id);
      const planned = await this.sends.plan(tx, "schedule", saved.meeting, saved.row.updatedAt);
      const sends = await this.checkSends(tx, userId, dayStart, planned.sends);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Scheduled meeting",
        meeting: saved.meeting,
        before: null,
        after: { start: input.start, guests: guests.length, [SENDS_ENTRY]: sends },
      });
      return { saved, planned, sight: await partySight(tx, actor.access, [saved.meeting]) };
    });
    await this.afterCommit(tenant, userId, done.planned);
    return this.shaped(actor.access, done);
  }

  /**
   * Edits a meeting's title, notes, place, start, length or reminder (meetings.md rule 6 and the
   * sends table; ADR 0051). Only someone who may change it (`canChangeMeeting`, 403 otherwise), and
   * never a cancelled one. A change of nothing writes nothing. A change of start, length or place
   * raises SEQUENCE and asks every guest again; every guest gets an "Updated" invite either way.
   */
  async update(tenant: TenantContext, actor: Actor, id: string, sent: MeetingPatch): Promise<Meeting> {
    // Compared as stored, so a title or place sent with spaces around it is no change of its own.
    const patch: MeetingPatch = { ...sent, title: sent.title?.trim(), location: sent.location?.trim() };
    const userId = actor.access.userId;
    const db = await this.tenancy.db(tenant);
    const dayStart = await companyDayStart(this.control.db, tenant);
    const done = await db.transaction(async (tx) => {
      const { loaded: before, sight } = await this.lockChangeable(tx, actor.access, id);
      refuseIf(editProblem(before.meeting, patch));
      const edit = editedMeeting(before.meeting, patch);
      if (edit.changed.length === 0) return { saved: before, sight, planned: null };
      const now = await databaseNow(tx);
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
          reminderMin: edit.meeting.reminderMin,
          sequence: edit.meeting.sequence,
          rescheduleSequence: edit.meeting.rescheduleSequence,
          updatedAt: now,
        })
        .where(eq(meetings.id, id));
      if (edit.significant) {
        await tx
          .update(meetingAttendees)
          .set({ partStat: "needs-action", respondedAt: null, proposal: null, updatedAt: now })
          .where(and(eq(meetingAttendees.meetingId, id), isNull(meetingAttendees.deletedAt)));
      }
      const saved = await this.loadedIn(tx, id);
      const planned = await this.sends.plan(tx, "edit", saved.meeting, saved.row.updatedAt);
      const sends = await this.checkSends(tx, userId, dayStart, planned.sends);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Edited meeting",
        meeting: before.meeting,
        before: { start: before.meeting.start, changed: edit.changed },
        after: { start: edit.meeting.start, changed: edit.changed, [SENDS_ENTRY]: sends },
      });
      return { saved, sight, planned };
    });
    if (done.planned) await this.afterCommit(tenant, userId, done.planned);
    return this.shaped(actor.access, done);
  }

  /** Cancels a meeting, once (meetings.md sends table; ADR 0051): CANCEL to every guest and no reminder. */
  async cancel(tenant: TenantContext, actor: Actor, id: string): Promise<Meeting> {
    const userId = actor.access.userId;
    const db = await this.tenancy.db(tenant);
    const dayStart = await companyDayStart(this.control.db, tenant);
    const done = await db.transaction(async (tx) => {
      const { loaded: before, sight } = await this.lockChangeable(tx, actor.access, id);
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
      const saved = await this.loadedIn(tx, id);
      const planned = await this.sends.plan(tx, "cancel", saved.meeting, saved.row.updatedAt);
      const sends = await this.checkSends(tx, userId, dayStart, planned.sends);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Cancelled meeting",
        meeting: before.meeting,
        before: { status: before.meeting.status },
        after: { status: after.status, [SENDS_ENTRY]: sends },
      });
      return { saved, sight, planned };
    });
    await this.afterCommit(tenant, userId, done.planned);
    return this.shaped(actor.access, done);
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
      const { loaded: before, sight } = await this.lockChangeable(tx, actor.access, id);
      const row = before.rows.get(attendeeId);
      const guest = before.meeting.attendees.find((a) => a.id === attendeeId);
      if (!row || !guest) throw notFound("guest");
      refuseIf(removeGuestProblem(before.meeting, guest));
      const after = withoutGuest(before.meeting, guest);
      const now = await databaseNow(tx);
      await tx.update(meetingAttendees).set({ deletedAt: now, updatedAt: now }).where(eq(meetingAttendees.id, row.id));
      await tx.update(meetings).set({ sequence: after.sequence, updatedAt: now }).where(eq(meetings.id, id));
      const saved = await this.loadedIn(tx, id);
      const planned = await this.sends.plan(tx, "remove", saved.meeting, saved.row.updatedAt, guest);
      const sends = await this.checkSends(tx, userId, dayStart, planned.sends);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Removed meeting guest",
        meeting: before.meeting,
        before: { guest: guestAuditName(guest, before.meeting) },
        after: { [SENDS_ENTRY]: sends },
      });
      return { saved, sight, planned };
    });
    await this.afterCommit(tenant, userId, done.planned);
    return this.shaped(actor.access, done);
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
    const dayStart = await companyDayStart(this.control.db, tenant);
    const answered = await db.transaction(async (tx) => {
      const before = await this.lockVisible(tx, actor.access, id);
      const { meeting } = before;
      const guest = staffGuestOf(meeting, userId);
      const row = before.rows.get(userId);
      if (!guest || !row || row.partyType !== "staff" || isOrganiser(meeting, userId))
        throw refuse("Only a guest on this meeting can answer it.");
      refuseIf(replyProblem(meeting, reply));
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
      const sends = await this.checkSends(
        tx,
        userId,
        dayStart,
        outcome.event ? [{ recipient: { kind: "staff" } }] : [],
      );
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Answered meeting",
        meeting,
        before: { answer: guest.partStat },
        after: { answer: outcome.partStat, [SENDS_ENTRY]: sends },
      });
      const saved = await this.loadedIn(tx, id);
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
    return this.shaped(actor.access, answered);
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
    refuseIf(meetingRequestProblem(input, clock.zone));
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
      const sends = await this.checkSends(tx, userId, dayStart, [{ recipient: guest }]);
      const saved = await this.loadedIn(tx, id);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Requested meeting",
        meeting: saved.meeting,
        before: null,
        after: { with: guestAuditName(guest, { private: input.private }), [SENDS_ENTRY]: sends },
      });
      return { saved, sight: await partySight(tx, actor.access, [saved.meeting]) };
    });
    await this.sends.requested(tenant, asker, done.saved.meeting, asked);
    return this.shaped(actor.access, done);
  }

  /**
   * "Add to my calendar" (meetings.md sends table): a PUBLISH file with no guests and no STATUS, at
   * the current UID and SEQUENCE, for a meeting the person may see. A cancelled meeting has none
   * (404, ADR 0051).
   */
  async calendarFile(
    tenant: TenantContext,
    access: RequestAccess,
    id: string,
  ): Promise<{ fileName: string; text: string }> {
    const db = await this.tenancy.db(tenant);
    const [loaded] = await loadMeetings(db, { ids: [id] });
    if (!loaded || !seesMeeting(meetingViewer(access), loaded.meeting)) throw notFound("meeting");
    const { meeting, row } = loaded;
    const text = meetingIcs({
      method: "PUBLISH",
      meeting,
      sequence: meeting.sequence,
      stamp: row.updatedAt,
      organizer: await organiserOf(this.control.db, meeting.ownerUserId),
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

  /**
   * The emails an action will send, once the daily limits allow them (ADR 0051 "Volume limits"):
   * refused with 400 before anything commits when they don't. The count goes into the action's
   * audit entry, which is what later actions count.
   */
  private async checkSends(
    tx: CompanyDb,
    userId: string,
    dayStart: Date,
    emails: readonly { recipient: Pick<Attendee, "kind"> }[],
  ): Promise<MeetingEmailCount> {
    const sends = meetingEmailCount(emails.map((email) => email.recipient));
    refuseIf(await dailyEmailsProblem(tx, userId, dayStart, sends));
    return sends;
  }

  /**
   * After a change committed: its invites, then the reminder re-sync. Neither throws (each catches
   * and logs its own failure), and the re-sync runs whatever happened to the invites, so a
   * committed change never answers 500 and never keeps a reminder of the meeting as it was.
   */
  private async afterCommit(tenant: TenantContext, actorUserId: string, planned: PlannedInvites): Promise<void> {
    try {
      await this.sends.invites(tenant, actorUserId, planned);
    } finally {
      await this.reminders.sync(tenant, planned.meeting.id);
    }
  }

  /** Locks a meeting the person may see, or answers 404 (CLAUDE.md rule 3). */
  private async lockVisible(tx: CompanyDb, access: RequestAccess, id: string): Promise<LoadedMeeting> {
    const row = await lockMeeting(tx, id);
    const loaded = meetingOf(row, await attendeesOf(tx, [id]));
    if (!seesMeeting(meetingViewer(access), loaded.meeting)) throw notFound("meeting");
    return loaded;
  }

  /**
   * Locks a meeting the person may change (`canChangeMeeting`): 404 when they can't see it, 403
   * when they see it but may not change it, including when they can't read a customer, supplier
   * or contact on it. Returns it with their sight of its linked guests.
   */
  private async lockChangeable(
    tx: CompanyDb,
    access: RequestAccess,
    id: string,
  ): Promise<{ loaded: LoadedMeeting; sight: PartySight }> {
    const loaded = await this.lockVisible(tx, access, id);
    const sight = await partySight(tx, access, [loaded.meeting]);
    const viewer = meetingViewer(access);
    if (!canChangeMeeting(viewer, loaded.meeting, sight)) {
      const onlySightMissing =
        !seesEveryLinkedGuest(loaded.meeting, sight) && canChangeMeeting(viewer, loaded.meeting, () => true);
      throw onlySightMissing ? cantSeeEveryGuest() : notTheOrganiser();
    }
    return { loaded, sight };
  }

  /** A meeting as the caller's transaction sees it: as it will commit, cancelled or not. */
  private async loadedIn(tx: CompanyDb, id: string): Promise<LoadedMeeting> {
    const [loaded] = await loadMeetings(tx, { ids: [id], withCancelled: true });
    if (!loaded) throw notFound("meeting");
    return loaded;
  }

  /** The committed meeting as this person may read it (`meetingForViewer`), with no read after the commit. */
  private shaped(access: RequestAccess, committed: Committed): Meeting {
    return meetingForViewer(committed.saved.meeting, meetingViewer(access), committed.sight);
  }

  /** The person as a meeting names them, from their sign-in. */
  private async person(userId: string): Promise<MeetingPerson> {
    const organiser = await organiserOf(this.control.db, userId);
    return { id: userId, ...organiser };
  }

  /**
   * The colleagues My meetings offers to ask (ADR 0051): active members who may read meetings,
   * never the person, and none unless the person may create one and requests can be answered.
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
    const members = (await activeMembers(db, this.control.db)).filter((member) => member.id !== access.userId);
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
