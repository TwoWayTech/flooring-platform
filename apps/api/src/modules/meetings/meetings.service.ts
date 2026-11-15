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
  seesMeeting,
  staffGuestOf,
  withoutGuest,
  zonedToInstant,
  zonedToInstantLenient,
  type Attendee,
  type GuestOption,
  type Meeting,
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
import { guestOptions, outsideInviteProblem, resolveGuests, type PickedGuest } from "./meeting-guests";
import { attendeesOf, loadMeetings, meetingOf, partySight, type LoadedMeeting } from "./meeting-records";
import { MeetingReminders } from "./meeting-reminders";
import { MeetingSends } from "./meeting-sends";
import {
  activeMembers,
  auditMeeting,
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

/**
 * Meetings on the API, part 1 (meetings.md; ADR 0051): the calendar within the viewer's sight,
 * scheduling with guests resolved on the server, edits, cancelling, removing a guest, answers,
 * requests and the calendar file. Every write locks the meeting, applies the shared rules,
 * writes its audit entry in the same transaction, and after the commit sends the invites and
 * re-syncs the reminder. Moves, undo and proposal decisions are part 2.
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
    const id = await db.transaction(async (tx) => {
      const { guests, outside } = await resolveGuests(tx, this.control.db, actor.access, input.guests, input.newGuests);
      refuseIf(guestLimitProblem({ guests: guests.length, emailGuests: outside.length }));
      const dayStart = zonedToInstantLenient(`${clock.day}T00:00`, clock.zone) ?? clock.now;
      refuseIf(await outsideInviteProblem(tx, userId, outside, dayStart));
      const flags = scheduleFlags(
        { private: input.private, hideGuestList: input.hideGuestList },
        guests,
        meetingSettings,
        actor.access.permissions.has("meetings.meeting.edit"),
      );
      const organiser = await this.person(userId);
      return this.insert(tx, actor, {
        fields: {
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
        attendees: [newAttendee({ kind: "staff", ...organiser }, true), ...guests],
        audit: { action: "Scheduled meeting", after: { start: input.start, guests: guests.length } },
        tenant,
      });
    });
    const saved = await this.loaded(db, id);
    await this.sends.invites(tenant, userId, "schedule", saved.meeting, saved.row.updatedAt);
    await this.reminders.sync(tenant, id);
    return this.view(db, actor.access, saved.meeting);
  }

  /**
   * Edits a meeting's title, notes, place, start, length or reminder (meetings.md rule 6 and the
   * sends table; ADR 0051). Only someone who may change it (`canChangeMeeting`, 403 otherwise), and
   * never a cancelled one. A change of nothing writes nothing. A change of start, length or place
   * raises SEQUENCE and asks every guest again; every guest gets an "Updated" invite either way.
   */
  async update(tenant: TenantContext, actor: Actor, id: string, patch: MeetingPatch): Promise<Meeting> {
    const db = await this.tenancy.db(tenant);
    const result = await db.transaction(async (tx) => {
      const before = await this.lockChangeable(tx, actor.access, id);
      refuseIf(editProblem(before.meeting, patch));
      const edit = editedMeeting(before.meeting, patch);
      if (edit.changed.length === 0) return null;
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
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Edited meeting",
        meeting: before.meeting,
        before: { start: before.meeting.start, changed: edit.changed },
        after: { start: edit.meeting.start, changed: edit.changed },
      });
      return true;
    });
    const saved = await this.loaded(db, id);
    if (result) {
      await this.sends.invites(tenant, actor.access.userId, "edit", saved.meeting, saved.row.updatedAt);
      await this.reminders.sync(tenant, id);
    }
    return this.view(db, actor.access, saved.meeting);
  }

  /** Cancels a meeting, once (meetings.md sends table; ADR 0051): CANCEL to every guest and no reminder. */
  async cancel(tenant: TenantContext, actor: Actor, id: string): Promise<Meeting> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const before = await this.lockChangeable(tx, actor.access, id);
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
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Cancelled meeting",
        meeting: before.meeting,
        before: { status: before.meeting.status },
        after: { status: after.status },
      });
    });
    const saved = await this.loaded(db, id);
    await this.sends.invites(tenant, actor.access.userId, "cancel", saved.meeting, saved.row.updatedAt);
    await this.reminders.sync(tenant, id);
    return this.view(db, actor.access, saved.meeting);
  }

  /**
   * Takes one guest off a meeting (meetings.md sends table; ADR 0051): never the organiser, never
   * on a cancelled meeting, and only a guest of this meeting (404 otherwise). The guest's row is
   * marked deleted, SEQUENCE rises by one, and only that guest gets a CANCEL that lists only them.
   */
  async removeGuest(tenant: TenantContext, actor: Actor, id: string, attendeeId: string): Promise<Meeting> {
    const db = await this.tenancy.db(tenant);
    const removed = await db.transaction(async (tx) => {
      const before = await this.lockChangeable(tx, actor.access, id);
      const row = before.rows.get(attendeeId);
      const guest = before.meeting.attendees.find((a) => a.id === attendeeId);
      if (!row || !guest) throw notFound("guest");
      refuseIf(removeGuestProblem(before.meeting, guest));
      const after = withoutGuest(before.meeting, guest);
      const now = await databaseNow(tx);
      await tx.update(meetingAttendees).set({ deletedAt: now, updatedAt: now }).where(eq(meetingAttendees.id, row.id));
      await tx.update(meetings).set({ sequence: after.sequence, updatedAt: now }).where(eq(meetings.id, id));
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Removed meeting guest",
        meeting: before.meeting,
        before: { guest: guestAuditName(guest, before.meeting) },
        after: null,
      });
      return guest;
    });
    const saved = await this.loaded(db, id);
    await this.sends.invites(tenant, actor.access.userId, "remove", saved.meeting, saved.row.updatedAt, removed);
    await this.reminders.sync(tenant, id);
    return this.view(db, actor.access, saved.meeting);
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
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: "Answered meeting",
        meeting,
        before: { answer: guest.partStat },
        after: { answer: outcome.partStat },
      });
      return { meeting, guest, outcome, responseId: logged!.id };
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
    const saved = await this.loaded(db, id);
    return this.view(db, actor.access, saved.meeting);
  }

  /**
   * Asks a colleague to meet (meetings.md "Request a meeting"; ADR 0051): an active member who may
   * read meetings, never oneself. Half an hour, "To be agreed", tentative until they answer, with
   * the reminder from Settings → Meetings; they get `meeting.requested`, not a calendar file.
   */
  async request(tenant: TenantContext, actor: Actor, input: MeetingRequestCreate): Promise<Meeting> {
    const clock = await meetingClock(this.control.db, tenant);
    refuseIf(meetingRequestProblem(input, clock.zone));
    const userId = actor.access.userId;
    if (input.withUserId === userId) throw refuse("Choose who to meet with.");
    const db = await this.tenancy.db(tenant);
    const meetingSettings = await loadMeetingSettings(db);
    const made = await db.transaction(async (tx) => {
      const [asked] = await activeMembers(tx, this.control.db, [input.withUserId]);
      const [askedAccess] = asked ? await this.access.membersAccess(tenant, [asked.id]) : [];
      if (!asked || !askedAccess || askedAccess.disabled || !askedAccess.permissions.has("meetings.meeting.view"))
        throw refuse("Choose who to meet with.");
      const asker = await this.person(userId);
      const guest = newAttendee({ kind: "staff", ...asked });
      const id = await this.insert(tx, actor, {
        fields: {
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
          ...requestFlags(input.private, actor.access.permissions.has("meetings.meeting.edit")),
        },
        attendees: [newAttendee({ kind: "staff", ...asker }, true), guest],
        audit: { action: "Requested meeting", after: { with: guestAuditName(guest, { private: input.private }) } },
        tenant,
      });
      return { id, asker, asked };
    });
    const saved = await this.loaded(db, made.id);
    await this.sends.requested(tenant, made.asker, saved.meeting, made.asked);
    return this.view(db, actor.access, saved.meeting);
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

  /** Writes a new meeting and its guests, organiser first, and its audit entry; returns its id. */
  private async insert(
    tx: CompanyDb,
    actor: Actor,
    made: {
      fields: Omit<
        Meeting,
        "id" | "attendees" | "ownerUserId" | "until" | "exceptions" | "uid" | "sequence" | "rescheduleSequence"
      >;
      attendees: readonly Attendee[];
      audit: { action: string; after: Record<string, unknown> };
      tenant: TenantContext;
    },
  ): Promise<string> {
    const userId = actor.access.userId;
    const start = zonedToInstant(made.fields.start, made.fields.timeZone).instant;
    if (!start) throw refuse("Enter a date and a start time.");
    const now = await databaseNow(tx);
    const [row] = await tx
      .insert(meetings)
      .values({
        ...made.fields,
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
      made.attendees.map((guest, index) => ({
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
    await auditMeeting(this.auditLog, made.tenant, actor, tx, {
      action: made.audit.action,
      meeting: { id, title: made.fields.title, private: made.fields.private },
      before: null,
      after: made.audit.after,
    });
    return id;
  }

  /** Locks a meeting the person may see, or answers 404 (CLAUDE.md rule 3). */
  private async lockVisible(tx: CompanyDb, access: RequestAccess, id: string): Promise<LoadedMeeting> {
    const row = await lockMeeting(tx, id);
    const loaded = meetingOf(row, await attendeesOf(tx, [id]));
    if (!seesMeeting(meetingViewer(access), loaded.meeting)) throw notFound("meeting");
    return loaded;
  }

  /** Locks a meeting the person may change: 404 when they can't see it, 403 when they see it but may not change it. */
  private async lockChangeable(tx: CompanyDb, access: RequestAccess, id: string): Promise<LoadedMeeting> {
    const loaded = await this.lockVisible(tx, access, id);
    if (!canChangeMeeting(meetingViewer(access), loaded.meeting)) throw notTheOrganiser();
    return loaded;
  }

  /** A meeting as stored now, cancelled or not. */
  private async loaded(db: CompanyDb, id: string): Promise<LoadedMeeting> {
    const [loaded] = await loadMeetings(db, { ids: [id], withCancelled: true });
    if (!loaded) throw notFound("meeting");
    return loaded;
  }

  /** A meeting as this person may read it (`meetingForViewer`). */
  private async view(db: CompanyDb, access: RequestAccess, meeting: Meeting): Promise<Meeting> {
    const sight = await partySight(db, access, [meeting]);
    return meetingForViewer(meeting, meetingViewer(access), sight);
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
