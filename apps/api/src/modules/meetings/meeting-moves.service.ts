import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { meetingAttendees, meetings } from "@workspace/db/company";
import {
  acceptedProposal,
  canChangeMeeting,
  canDecideProposal,
  cancelledMeeting,
  declinedProposal,
  guestAuditName,
  isMoveAuditAction,
  MEETING_AUDIT_ACTIONS,
  MEETING_CHANGED,
  MEETING_REFUSALS,
  meetingEmailCount,
  meetingForViewer,
  moveAuditAction,
  moveAuditEntry,
  movedMeetings,
  movedOccurrenceKey,
  moveKind,
  moveProblem,
  normalizeGuestEmail,
  occurrenceTime,
  proposalDecisionProblem,
  restoredOccurrence,
  sameAttendee,
  undoneMeeting,
  undoneSeriesProblem,
  undoProblem,
  zonedToInstant,
  type Conflict,
  type Meeting,
  type MeetingMoveInput,
  type MeetingSend,
  type MovedMeetings,
  type MoveRecord,
  type UndoRefusal,
} from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { databaseNow } from "../hr/hr-common";
import { notFound, refuse } from "../sales/sales-common";
import { moveConflicts } from "./meeting-conflicts";
import { companyDay, companyDayStart, outsideInviteProblem, SENDS_ENTRY } from "./meeting-limits";
import { attendeesOf, meetingOf, partySight, type LoadedMeeting } from "./meeting-records";
import { MeetingSends, type PlannedInvites } from "./meeting-sends";
import { lastMeetingEntry, parseMoveRecord } from "./meeting-undo";
import {
  checkSends,
  loadedIn,
  lockChangeable,
  MeetingWrites,
  resetAnswers,
  shaped,
  type PartySight,
} from "./meeting-writes";
import { auditMeeting, lockMeetingRow, meetingViewer, refuseIf } from "./meetings-common";

/** What a move answers (`rescheduleMeeting` in the contract): the saved meetings, the conflicts and what Undo needs. */
export interface MeetingMoveResult {
  meetings: Meeting[];
  conflicts: Conflict[];
  /** The meeting as it was, shaped for the mover; Undo sends back its SEQUENCE only. */
  undo: { previous: Meeting; createdIds: string[] };
}

/** An undo's refusal as the API answers it: 403, or 409 with its own code. */
function refusal(problem: UndoRefusal): ForbiddenException | ConflictException {
  const body = { code: problem.code, message: problem.message };
  return problem.status === 403 ? new ForbiddenException(body) : new ConflictException(body);
}

/** The answer when a meeting changed after its move, so the move can't be undone. */
const changedSince = () => refusal(MEETING_CHANGED);

/** The `after.from` of a "Split meeting series" entry: the meeting the series was split from. */
function splitFrom(after: unknown): string | null {
  const from = (after as { from?: unknown } | null)?.from;
  return typeof from === "string" ? from : null;
}

/**
 * Meetings on the API, part 2 (meetings.md "Move or resize", "Propose a new time" and the sends
 * table; ADR 0051 "Part 2"): moving a meeting or one of its occurrences, undoing the last move, and
 * the organiser's decision on a proposed time. Each write is part 1's: it locks the meeting, applies
 * the shared rule, works out what it will send from the state it commits, checks the daily email
 * limits and writes its audit entries, all in one transaction on one connection. After the commit
 * come the invites and the reminder re-syncs (`MeetingWrites.afterCommit`), which can't fail the
 * request, and the answer is the committed state shaped for the reader.
 */
@Injectable()
export class MeetingMoves {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly sends: MeetingSends,
    private readonly writes: MeetingWrites,
  ) {}

  /**
   * Moves or resizes a meeting, or one or more of a series' occurrences (meetings.md rule 4 and the
   * sends table; ADR 0051 "Part 2"). Only someone who may change it (`canChangeMeeting`; 404 when they
   * can't see it, 403 otherwise), and only a move `moveProblem` allows, by the company's day and the
   * database clock. Answers are not reset.
   * "This and following" inserts the new series with the same organiser, created by the mover, and
   * copies the live guests with their answers; its email guests count against the mover's daily
   * outside-address limit. Conflicts are worked out in the same transaction, after the save.
   */
  async reschedule(
    tenant: TenantContext,
    actor: Actor,
    id: string,
    move: MeetingMoveInput,
  ): Promise<MeetingMoveResult> {
    const userId = actor.access.userId;
    const db = await this.tenancy.db(tenant);
    const { today, dayStart } = await companyDay(this.control.db, tenant);
    const done = await db.transaction(async (tx) => {
      const { loaded: before, sight } = await lockChangeable(tx, actor.access, id);
      const now = await databaseNow(tx);
      refuseIf(moveProblem(before.meeting, move, today, now));
      const moved = movedMeetings(before.meeting, move, { newId: uuidv7(), newUid: randomUUID() });
      await this.saveOriginal(tx, before, moved.original, now);
      if (moved.split) await this.insertSplit(tx, userId, before, moved.split, now, dayStart);
      const saved = await loadedIn(tx, id);
      const split = moved.split ? await loadedIn(tx, moved.split.id) : null;
      const plans = await this.movePlans(tx, move, moved, saved, split);
      const sends = await checkSends(
        tx,
        userId,
        dayStart,
        plans.flatMap((planned) => planned.sends),
      );
      const record = moveAuditEntry(before.meeting, before.row.start, move, moved);
      // A change that keeps the occurrence's start is a resize, worked out from the stored meeting (#44).
      const kind = moveKind(occurrenceTime(before.meeting, move.planned), move);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: moveAuditAction(kind),
        meeting: before.meeting,
        before: { ...record.before },
        after: { ...record.after, [SENDS_ENTRY]: sends },
      });
      if (split) {
        await auditMeeting(this.auditLog, tenant, actor, tx, {
          action: MEETING_AUDIT_ACTIONS.split,
          meeting: split.meeting,
          before: null,
          after: { from: id, start: move.start },
        });
      }
      const key = movedOccurrenceKey(move, moved);
      const holder = split && key.meetingId === split.meeting.id ? split : saved;
      const conflicts = await moveConflicts(
        tx,
        actor.access,
        holder,
        { ...key, start: move.start, durationMin: move.durationMin },
        sight,
      );
      return { before, saved, split, sight, plans, conflicts, record };
    });
    const savedMeetings = done.split ? [done.saved, done.split] : [done.saved];
    await this.writes.afterCommit(
      tenant,
      userId,
      done.plans,
      savedMeetings.map((loaded) => loaded.meeting.id),
    );
    return {
      meetings: savedMeetings.map((saved) => shaped(actor.access, { saved, sight: done.sight })),
      conflicts: done.conflicts,
      undo: {
        previous: meetingForViewer(done.before.meeting, meetingViewer(actor.access), done.sight),
        createdIds: done.record.after.createdIds,
      },
    };
  }

  /**
   * Undoes the last move of a meeting (meetings.md `undoReschedule` and the sends table; ADR 0051
   * "Part 2", critic B3). The meeting is rebuilt from the server's own "Moved meeting" entry, never
   * from the client: only the SEQUENCE the client saw before the move is read, to refuse a mismatch.
   * `undoProblem` decides: the move must be the meeting's last change, at the SEQUENCE the screen
   * saw (checked first, so a stale toast after a colleague's newer move is 409 `meeting_changed`; ADR
   * 0051 "Part 3"), by the caller, within five minutes. Every undo sends a series REQUEST, so it is refused with 400 when the restored series
   * would leave an occurrence changed on its own that has taken place behind at a date still ahead
   * (`undoneSeriesProblem`, review round 3 and the final review of PR #35, "this event" included).
   * A series the move split off must still be exactly as the move left it, and
   * is removed: soft-deleted with its guests, cancelled at SEQUENCE 1, and its guests get a CANCEL
   * (closing the spec's "Undo removes a split-off series without sending its guests a cancellation").
   */
  async undo(tenant: TenantContext, actor: Actor, id: string, clientSequence: number): Promise<Meeting> {
    const userId = actor.access.userId;
    const db = await this.tenancy.db(tenant);
    const dayStart = await companyDayStart(this.control.db, tenant);
    const done = await db.transaction(async (tx) => {
      const { loaded: current, sight } = await lockChangeable(tx, actor.access, id);
      const last = await lastMeetingEntry(tx, id);
      const record = last && isMoveAuditAction(last.action) ? parseMoveRecord(last.before, last.after) : null;
      const problem = undoProblem(current.meeting, {
        record,
        moverUserId: last?.actorUserId ?? null,
        callerUserId: userId,
        ageMs: last?.ageMs ?? Number.POSITIVE_INFINITY,
        clientSequence,
      });
      if (problem || !record) throw problem ? refusal(problem) : changedSince();
      const now = await databaseNow(tx);
      refuseIf(undoneSeriesProblem(current.meeting, record, now));
      const splits: LoadedMeeting[] = [];
      for (const splitId of record.after.createdIds) splits.push(await this.lockSplit(tx, actor.access, id, splitId));
      const restored = undoneMeeting(current.meeting, record);
      await tx
        .update(meetings)
        .set({
          start: new Date(record.before.series.startsAt),
          durationMin: restored.durationMin,
          until: restored.until,
          exceptions: restored.exceptions,
          sequence: restored.sequence,
          rescheduleSequence: restored.rescheduleSequence,
          updatedAt: now,
        })
        .where(eq(meetings.id, id));
      for (const split of splits) await this.removeSplit(tx, split, now);
      const saved = await loadedIn(tx, id);
      const plans = await this.undoPlans(tx, record, saved);
      const removals: PlannedInvites[] = [];
      for (const split of splits)
        removals.push(await this.sends.plan(tx, "cancel", cancelledMeeting(split.meeting), now));
      const restoredSends = plans.flatMap((planned) => planned.sends);
      await checkSends(tx, userId, dayStart, [...restoredSends, ...removals.flatMap((planned) => planned.sends)]);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: MEETING_AUDIT_ACTIONS.undone,
        meeting: current.meeting,
        before: { start: current.meeting.start },
        after: { start: restored.start, [SENDS_ENTRY]: emailCount(restoredSends) },
      });
      for (const [index, split] of splits.entries()) {
        await auditMeeting(this.auditLog, tenant, actor, tx, {
          action: MEETING_AUDIT_ACTIONS.splitRemoved,
          meeting: split.meeting,
          before: { start: split.meeting.start },
          after: { [SENDS_ENTRY]: emailCount(removals[index]?.sends ?? []) },
        });
      }
      return { saved, sight, plans: [...plans, ...removals], splitIds: splits.map((split) => split.meeting.id) };
    });
    await this.writes.afterCommit(tenant, userId, done.plans, [id, ...done.splitIds]);
    return shaped(actor.access, done);
  }

  /**
   * The organiser accepts or declines a guest's proposed time (meetings.md "Propose a new time",
   * `decideProposal` and the sends table; ADR 0051 "Part 2"). Only an organiser who may change the
   * meeting (`canDecideProposal`; 404 when unseen, 403 otherwise), only a guest of this meeting (404
   * otherwise), and only a pending proposal on a one-off that is not cancelled (400). Accepting moves
   * the meeting to the proposed time, raises SEQUENCE, asks every guest again and sends them an
   * "Updated" REQUEST; declining sends the proposer alone a DECLINECOUNTER and changes nothing else.
   */
  async decide(tenant: TenantContext, actor: Actor, id: string, attendeeId: string, accept: boolean): Promise<Meeting> {
    const userId = actor.access.userId;
    const db = await this.tenancy.db(tenant);
    const { today, dayStart } = await companyDay(this.control.db, tenant);
    const done = await db.transaction(async (tx) => {
      const { loaded: before, sight } = await lockChangeable(tx, actor.access, id);
      if (!canDecideProposal(meetingViewer(actor.access), before.meeting, sight))
        throw new ForbiddenException({ code: "forbidden", message: MEETING_REFUSALS.organiserDecides });
      const row = before.rows.get(attendeeId);
      const guest = before.meeting.attendees.find((a) => a.id === attendeeId);
      if (!row || !guest) throw notFound("guest");
      refuseIf(proposalDecisionProblem(before.meeting, guest, accept, today));
      const now = await databaseNow(tx);
      const after = accept ? acceptedProposal(before.meeting, guest) : declinedProposal(before.meeting, guest);
      const proposal = after.attendees.find((a) => sameAttendee(a, guest))?.proposal ?? null;
      if (accept) {
        const start = zonedToInstant(after.start, after.timeZone).instant;
        if (!start) throw refuse("Enter a date and a start time.");
        await tx
          .update(meetings)
          .set({
            start,
            durationMin: after.durationMin,
            sequence: after.sequence,
            rescheduleSequence: after.rescheduleSequence,
            updatedAt: now,
          })
          .where(eq(meetings.id, id));
        await resetAnswers(tx, id, now);
      } else {
        // The meeting's stamp moves too, so each decline is its own Outbox row and DTSTAMP follows commit order.
        await tx.update(meetings).set({ updatedAt: now }).where(eq(meetings.id, id));
      }
      await tx.update(meetingAttendees).set({ proposal, updatedAt: now }).where(eq(meetingAttendees.id, row.id));
      const saved = await loadedIn(tx, id);
      const proposer = saved.meeting.attendees.find((a) => sameAttendee(a, guest));
      const planned = accept
        ? await this.sends.plan(tx, "edit", saved.meeting, saved.row.updatedAt)
        : await this.sends.plan(tx, "declineCounter", saved.meeting, saved.row.updatedAt, { only: proposer });
      const sends = await checkSends(tx, userId, dayStart, planned.sends);
      await auditMeeting(this.auditLog, tenant, actor, tx, {
        action: accept ? MEETING_AUDIT_ACTIONS.proposalAccepted : MEETING_AUDIT_ACTIONS.proposalDeclined,
        meeting: before.meeting,
        before: accept ? { start: before.meeting.start } : { guest: guestAuditName(guest, before.meeting) },
        after: accept ? { start: after.start, [SENDS_ENTRY]: sends } : { [SENDS_ENTRY]: sends },
      });
      return { saved, sight, planned };
    });
    await this.writes.afterCommit(tenant, userId, [done.planned], accept ? [id] : []);
    return shaped(actor.access, done);
  }

  /**
   * Saves the original meeting of a move. Its stored instant is kept unless its start changed, so a
   * time the clock shows twice keeps its reading (as an edit does); a new start was checked by
   * `moveProblem` to exist.
   */
  private async saveOriginal(tx: CompanyDb, before: LoadedMeeting, after: Meeting, now: Date): Promise<void> {
    const start =
      after.start === before.meeting.start ? before.row.start : zonedToInstant(after.start, after.timeZone).instant;
    if (!start) throw refuse("Enter a date and a start time.");
    await tx
      .update(meetings)
      .set({
        start,
        durationMin: after.durationMin,
        until: after.until,
        exceptions: after.exceptions,
        sequence: after.sequence,
        rescheduleSequence: after.rescheduleSequence,
        updatedAt: now,
      })
      .where(eq(meetings.id, before.meeting.id));
  }

  /**
   * Inserts the new series of a "this and following" move (meetings.md rule 4 and 14; critic H): its
   * own id and UID, SEQUENCE 0, the organiser kept and the mover as `created_by`, and a copy of each
   * live guest row with its answer, an email guest under a new row id. The copied outside addresses
   * count as ones the mover invites today (ADR 0051 "Volume limits"), checked before they are written.
   */
  private async insertSplit(
    tx: CompanyDb,
    userId: string,
    before: LoadedMeeting,
    split: Meeting,
    now: Date,
    dayStart: Date,
  ): Promise<void> {
    const start = zonedToInstant(split.start, split.timeZone).instant;
    if (!start) throw refuse("Enter a date and a start time.");
    const guests = [...before.rows.values()];
    const outside = guests.filter((row) => row.partyType === "external").map((row) => normalizeGuestEmail(row.email));
    refuseIf(await outsideInviteProblem(tx, userId, outside, dayStart));
    const { row } = before;
    await tx.insert(meetings).values({
      id: split.id,
      title: row.title,
      start,
      durationMin: split.durationMin,
      location: row.location,
      recurrence: row.recurrence,
      reminderMin: row.reminderMin,
      ownerUserId: row.ownerUserId,
      notes: row.notes,
      timeZone: row.timeZone,
      until: split.until,
      exceptions: split.exceptions,
      uid: split.uid,
      sequence: split.sequence,
      rescheduleSequence: split.rescheduleSequence,
      status: row.status,
      kind: row.kind,
      private: row.private,
      hideGuestList: row.hideGuestList,
      allowProposals: row.allowProposals,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(meetingAttendees).values(
      guests.map((guest, index) => ({
        meetingId: split.id,
        partyType: guest.partyType,
        partyId: guest.partyId,
        name: guest.name,
        email: guest.email,
        role: guest.role,
        partStat: guest.partStat,
        respondedAt: guest.respondedAt,
        respondedSequence: guest.respondedSequence === null ? null : 0,
        note: guest.note,
        proposal: guest.proposal,
        createdBy: userId,
        // One millisecond apart, so the guests read back in the order they were added.
        createdAt: new Date(now.getTime() + index),
        updatedAt: now,
      })),
    );
  }

  /**
   * What a move sends (meetings.md sends table): "this event" an "occurrence" REQUEST with its
   * RECURRENCE-ID and own time; "all" (and any one-off) an "Updated" REQUEST; a split one per series,
   * the old with its trimmed UNTIL and the new under its new UID. After a series' time or rule
   * changed, its surviving exceptions are sent again.
   */
  private async movePlans(
    tx: CompanyDb,
    move: MeetingMoveInput,
    moved: MovedMeetings,
    saved: LoadedMeeting,
    split: LoadedMeeting | null,
  ): Promise<PlannedInvites[]> {
    if (moved.scope === "this") {
      const occurrence = { recurrenceId: move.planned, start: move.start, durationMin: move.durationMin };
      return [await this.sends.plan(tx, "occurrence", saved.meeting, saved.row.updatedAt, { occurrence })];
    }
    const series = split ? [saved, split] : [saved];
    const plans: PlannedInvites[] = [];
    for (const loaded of series)
      plans.push(await this.sends.plan(tx, "edit", loaded.meeting, loaded.row.updatedAt, { resendExceptions: true }));
    return plans;
  }

  /**
   * What an undo sends (meetings.md sends table, "Undo a move"): an "Updated" REQUEST to every guest
   * at the new SEQUENCE, with the restored series' surviving exceptions again, as every series
   * REQUEST has them (final review of PR #35: a calendar that replaces the whole set on a series-only
   * REQUEST would otherwise drop them). After undoing "this event", that occurrence also goes again
   * at its restored time, so the override the move sent is taken back (ADR 0051 "Part 2"), unless an
   * earlier exception there is already among the re-sends: the two would be one Outbox version.
   */
  private async undoPlans(tx: CompanyDb, record: MoveRecord, saved: LoadedMeeting): Promise<PlannedInvites[]> {
    const { meeting, row } = saved;
    const series = await this.sends.plan(tx, "edit", meeting, row.updatedAt, { resendExceptions: true });
    const { planned } = record.before;
    if (record.after.scope !== "this" || series.sends.some((send) => send.recurrenceId === planned)) return [series];
    const occurrence = restoredOccurrence(record);
    return [series, await this.sends.plan(tx, "occurrence", meeting, row.updatedAt, { occurrence })];
  }

  /**
   * Locks the series a move split off, after the original (the lock order in `meeting-limits.ts`),
   * and checks it is exactly as the move left it: live, not cancelled, at SEQUENCE 0, changeable by
   * the caller, and with this move's "Split meeting series" by the caller as its last entry, so none
   * of its guests answered since. Anything else answers 409.
   */
  private async lockSplit(
    tx: CompanyDb,
    access: RequestAccess,
    originalId: string,
    splitId: string,
  ): Promise<LoadedMeeting> {
    const row = await lockMeetingRow(tx, splitId);
    if (!row || row.deletedAt || row.status === "cancelled" || row.sequence !== 0) throw changedSince();
    const loaded = meetingOf(row, await attendeesOf(tx, [splitId]));
    const sight: PartySight = await partySight(tx, access, [loaded.meeting]);
    if (!canChangeMeeting(meetingViewer(access), loaded.meeting, sight)) throw changedSince();
    const last = await lastMeetingEntry(tx, splitId);
    if (
      last?.action !== MEETING_AUDIT_ACTIONS.split ||
      last.actorUserId !== access.userId ||
      splitFrom(last.after) !== originalId
    )
      throw changedSince();
    return loaded;
  }

  /** Removes a split-off series: soft-deleted with its guests, cancelled at SEQUENCE 1 (`cancelledMeeting`). */
  private async removeSplit(tx: CompanyDb, split: LoadedMeeting, now: Date): Promise<void> {
    const cancelled = cancelledMeeting(split.meeting);
    await tx
      .update(meetings)
      .set({
        status: cancelled.status,
        sequence: cancelled.sequence,
        rescheduleSequence: cancelled.rescheduleSequence,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(meetings.id, split.meeting.id));
    await tx
      .update(meetingAttendees)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(meetingAttendees.meetingId, split.meeting.id), isNull(meetingAttendees.deletedAt)));
  }
}

/** The emails some sends are, as an audit entry's `sends` counts them for the daily limits. */
function emailCount(sends: readonly MeetingSend[]) {
  return meetingEmailCount(sends.map((send) => send.recipient));
}
