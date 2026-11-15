import {
  acceptedProposal,
  canChangeMeeting,
  canDecideProposal,
  cancelledMeeting,
  conflictForViewer,
  declinedProposal,
  guestAuditName,
  MEETING_AUDIT_ACTIONS,
  MEETING_CHANGED,
  MEETING_REFUSALS,
  meetingAuditTarget,
  moveAuditEntry,
  movedMeetings,
  movedOccurrenceKey,
  moveProblem,
  occurrenceConflicts,
  proposalDecisionProblem,
  restoredOccurrence,
  sameAttendee,
  sendPlan,
  undoneMeeting,
  undoneSeriesProblem,
  undoProblem,
  zonedToInstantLenient,
  type Conflict,
  type Meeting,
  type MeetingMoveInput,
  type MoveRecord,
  type MoveScope,
  type MovedMeetings,
} from "@workspace/shared";
import type { MeetingMove, MeetingUndo } from "../contract";
import { DemoRuleError } from "./admin-rules";
import {
  calendarOn,
  changeable,
  GUEST_GONE,
  invitesSwitchedOn,
  refuseIf,
  saveMeeting,
  type MeetingScope,
} from "./meeting-actions";
import { deliver, invitesOn, seriesSends, syncReminder } from "./meeting-sends";
import { shapedFor, type MeetingSight } from "./meeting-sight";
import type { ActionContext } from "./payment-actions";

/** The last move of one meeting, as the demo keeps it for Undo. */
export interface RememberedMove {
  /** The move as the API's "Moved meeting" audit entry records it (`moveAuditEntry`). */
  record: MoveRecord;
  moverId: string;
  /** When it was made, in milliseconds (`Date.now()`). */
  at: number;
  /** The series a "this and following" move split off, or null. */
  splitId: string | null;
}

/**
 * The demo's memory of each meeting's last move, which Undo rebuilds the meeting from, as the API
 * rebuilds it from its own "Moved meeting" entry and never from the client's copy (ADR 0051 "Part 2",
 * critic B3; B.6 item 6). It lives in memory only, so a reload forgets it and a stale toast is then
 * refused in the API's words. Every later change to the meeting, or to the series its move split
 * off, forgets it (`forget`), as the API refuses an undo whose move is no longer the meeting's last
 * audit entry or whose split is no longer as the move left it.
 */
export class MeetingMoveMemo {
  private readonly moves = new Map<string, RememberedMove>();

  /** Keeps a meeting's move, in place of any earlier one. */
  remember(meetingId: string, move: RememberedMove): void {
    this.moves.set(meetingId, move);
  }

  /** Forgets the move of this meeting, and the move that split this meeting off. */
  forget(meetingId: string): void {
    this.moves.delete(meetingId);
    for (const [id, move] of this.moves) if (move.splitId === meetingId) this.moves.delete(id);
  }

  /** The meeting's last move, if the demo still holds it. */
  get(meetingId: string): RememberedMove | undefined {
    return this.moves.get(meetingId);
  }

  /** Forgets every move, when the demo is reset or a company opens. */
  clear(): void {
    this.moves.clear();
  }
}

/** How the audit entry names a move's scope (the demo's words, kept). */
const SCOPE_WORDS: Record<MoveScope, string> = {
  this: "this event",
  following: "this and following",
  all: "all events",
};

const auditTime = (start: string) => start.replace("T", " ");

/**
 * Moves or resizes a meeting, or one or more of a series' occurrences (meetings.md rule 4 and the
 * sends table; ADR 0051 "Part 2" and "Part 3"), on the same shared rules as the API's
 * `MeetingMoves.reschedule`: only someone who may change it (`changeRefusal`), only a move
 * `moveProblem` allows, then `movedMeetings`. A split's email guests get ids of their own. The
 * conflicts are worked out after the save, skipping only the occurrence the move produced, and shaped
 * for the mover (`conflictForViewer`: a meeting they can't read is "Busy" with its time). "This
 * event" sends one occurrence; "all" and a split send each series with its exceptions again. The
 * answer is shaped for the mover, and Undo's copy is the meeting as they read it before the move.
 */
export async function rescheduleMeeting(
  ctx: ActionContext,
  { sight, memo }: MeetingScope,
  move: MeetingMove,
): Promise<{ meetings: Meeting[]; conflicts: Conflict[]; undo: MeetingUndo }> {
  calendarOn();
  await ctx.assertCan(["meetings.meeting.edit"]);
  const before = changeable(ctx, sight, move.meetingId);
  const now = new Date();
  const input: MeetingMoveInput = {
    planned: move.planned,
    start: move.start,
    durationMin: move.durationMin,
    scope: move.scope,
  };
  refuseIf(moveProblem(before, input, ctx.today, now));
  const made = movedMeetings(before, input, { newId: ctx.newId("mtg"), newUid: crypto.randomUUID() });
  // An email guest's id is their own guest row's, so the new series gives each a row of its own (spec rule 14).
  const split = made.split && {
    ...made.split,
    attendees: made.split.attendees.map((a) => (a.kind === "external" ? { ...a, id: `ext-${ctx.newId("g")}` } : a)),
  };
  const moved: MovedMeetings = { ...made, split };
  ctx.db.put("meetings", moved.original);
  if (split) ctx.db.put("meetings", split);
  // A move of a split-off series is a change to it, so the move that split it can no longer be undone.
  memo.forget(before.id);
  memo.remember(before.id, {
    record: moveAuditEntry(before, zonedToInstantLenient(before.start, before.timeZone) ?? now, input, moved),
    moverId: ctx.actor.id,
    at: Date.now(),
    splitId: split?.id ?? null,
  });
  const conflicts = moveConflicts(ctx, sight, input, moved);
  sendMove(ctx, input, moved, now);
  syncReminder(ctx, moved.original);
  if (split) syncReminder(ctx, split);
  ctx.audit({
    category: "data",
    action: MEETING_AUDIT_ACTIONS.moved,
    target: meetingAuditTarget(before),
    before: auditTime(move.planned),
    after: `${auditTime(move.start)}, ${move.durationMin} min (${SCOPE_WORDS[moved.scope]})`,
  });
  if (split) {
    ctx.audit({
      category: "data",
      action: MEETING_AUDIT_ACTIONS.split,
      target: meetingAuditTarget(split),
      before: null,
      after: auditTime(split.start),
    });
  }
  const saved = split ? [moved.original, split] : [moved.original];
  return {
    meetings: saved.map((meeting) => shapedFor(sight, meeting)),
    conflicts,
    undo: { previous: shapedFor(sight, before), createdIds: split ? [split.id] : [] },
  };
}

/**
 * Who of the moved meeting's guests is booked elsewhere at the new time (meetings.md rule 13; the
 * API's `moveConflicts`): on the meetings as they are after the save, from the meeting that now holds
 * the moved occurrence, with its guests as the mover reads them, each conflict shaped for the mover.
 */
function moveConflicts(ctx: ActionContext, sight: MeetingSight, move: MeetingMoveInput, moved: MovedMeetings) {
  const key = movedOccurrenceKey(move, moved);
  const holder = moved.split && key.meetingId === moved.split.id ? moved.split : moved.original;
  const guests = shapedFor(sight, holder).attendees;
  return occurrenceConflicts(
    ctx.db.list("meetings"),
    { ...key, start: move.start, durationMin: move.durationMin },
    guests,
  ).map((raw) => conflictForViewer(raw, sight.viewer, sight.seesParty));
}

/** What a move sends (the API's `movePlans`): one occurrence for "this event", each series again otherwise. */
function sendMove(ctx: ActionContext, move: MeetingMoveInput, moved: MovedMeetings, now: Date): void {
  if (moved.scope === "this") {
    const occurrence = { recurrenceId: move.planned, start: move.start, durationMin: move.durationMin };
    deliver(ctx, moved.original, sendPlan("occurrence", moved.original, { invitesOn: invitesOn(), occurrence }));
    return;
  }
  for (const series of moved.split ? [moved.original, moved.split] : [moved.original])
    deliver(ctx, series, seriesSends(series, now));
}

/**
 * Undoes the reader's own last move of a meeting (meetings.md `undoReschedule` and the sends table;
 * ADR 0051 "Part 2" and "Part 3"), as the API's `MeetingMoves.undo`: the meeting is rebuilt from the
 * demo's own record of the move (`MeetingMoveMemo`), and only the SEQUENCE the screen saw is read
 * from the client. `undoProblem` decides in the API's order and words (the SEQUENCE before the
 * mover, then the five minutes), then `undoneSeriesProblem`. A series the move split off must be
 * exactly as the move left it; it is removed, and its guests get a CANCEL (closing the spec's
 * "Undo removes a split-off series without sending its guests a cancellation").
 */
export async function undoReschedule(ctx: ActionContext, { sight, memo }: MeetingScope, undo: MeetingUndo) {
  calendarOn();
  await ctx.assertCan(["meetings.meeting.edit"]);
  const current = changeable(ctx, sight, undo.previous.id);
  const last = memo.get(current.id);
  const problem = undoProblem(current, {
    record: last?.record ?? null,
    moverUserId: last?.moverId ?? null,
    callerUserId: ctx.actor.id,
    ageMs: last ? Date.now() - last.at : Number.POSITIVE_INFINITY,
    clientSequence: undo.previous.sequence,
  });
  if (problem || !last) throw new DemoRuleError((problem ?? MEETING_CHANGED).message);
  const { record } = last;
  const now = new Date();
  refuseIf(undoneSeriesProblem(current, record, now));
  const split = last.splitId ? splitAsLeft(ctx, sight, record, last.splitId) : null;
  const restored = undoneMeeting(current, record);
  ctx.db.put("meetings", restored);
  memo.forget(current.id);
  const sends = seriesSends(restored, now);
  // Undoing "this event" takes the override back, unless an earlier exception there already went again.
  if (record.after.scope === "this" && !sends.some((send) => send.recurrenceId === record.before.planned)) {
    const occurrence = restoredOccurrence(record);
    sends.push(...sendPlan("occurrence", restored, { invitesOn: invitesOn(), occurrence }));
  }
  deliver(ctx, restored, sends);
  syncReminder(ctx, restored);
  ctx.audit({
    category: "data",
    action: MEETING_AUDIT_ACTIONS.undone,
    target: meetingAuditTarget(current),
    before: auditTime(current.start),
    after: auditTime(restored.start),
  });
  if (split) {
    const removed = cancelledMeeting(split);
    ctx.db.remove("meetings", split.id);
    deliver(ctx, removed, sendPlan("cancel", removed, { invitesOn: invitesOn() }));
    syncReminder(ctx, removed);
    ctx.audit({
      category: "data",
      action: MEETING_AUDIT_ACTIONS.splitRemoved,
      target: meetingAuditTarget(split),
      before: auditTime(split.start),
      after: null,
    });
  }
  return shapedFor(sight, restored);
}

/**
 * The series a move split off, exactly as the move left it (the API's `lockSplit`): there, not
 * cancelled, at SEQUENCE 0, the move's own, and changeable by the reader. Anything else means it
 * changed since, so the undo is refused.
 */
function splitAsLeft(ctx: ActionContext, sight: MeetingSight, record: MoveRecord, splitId: string): Meeting {
  const split = ctx.db.get("meetings", splitId);
  if (
    !split ||
    split.status === "cancelled" ||
    split.sequence !== 0 ||
    !record.after.createdIds.includes(split.id) ||
    !canChangeMeeting(sight.viewer, split, sight.seesParty)
  )
    throw new DemoRuleError(MEETING_CHANGED.message);
  return split;
}

/**
 * The organiser accepts or declines a guest's proposed time (meetings.md "Propose a new time" and
 * the sends table; ADR 0051 "Part 2"), as the API's `MeetingMoves.decide`: only while
 * `meetings.invites` is on (S4), only an organiser who may change the meeting (`canDecideProposal`),
 * only a guest of this meeting, and only a pending proposal on a one-off that is not cancelled.
 * Accepting moves the meeting, asks every guest again and sends them an "Updated" REQUEST; declining
 * sends the proposer alone a DECLINECOUNTER and changes nothing else.
 */
export async function decideProposal(
  ctx: ActionContext,
  { sight, memo }: MeetingScope,
  meetingId: string,
  attendeeId: string,
  accept: boolean,
) {
  calendarOn();
  invitesSwitchedOn();
  await ctx.assertCan(["meetings.meeting.edit"]);
  const before = changeable(ctx, sight, meetingId);
  if (!canDecideProposal(sight.viewer, before, sight.seesParty))
    throw new DemoRuleError(MEETING_REFUSALS.organiserDecides);
  const guest = before.attendees.find((a) => a.id === attendeeId);
  if (!guest) throw new DemoRuleError(GUEST_GONE);
  refuseIf(proposalDecisionProblem(before, guest, accept, ctx.today));
  const after = saveMeeting(ctx, memo, accept ? acceptedProposal(before, guest) : declinedProposal(before, guest));
  if (accept) {
    deliver(ctx, after, sendPlan("edit", after, { invitesOn: invitesOn() }));
    syncReminder(ctx, after);
  } else {
    const proposer = after.attendees.find((a) => sameAttendee(a, guest));
    deliver(ctx, after, sendPlan("declineCounter", after, { invitesOn: invitesOn(), only: proposer }));
  }
  ctx.audit({
    category: "data",
    action: accept ? MEETING_AUDIT_ACTIONS.proposalAccepted : MEETING_AUDIT_ACTIONS.proposalDeclined,
    target: meetingAuditTarget(before),
    before: accept ? auditTime(before.start) : guestAuditName(guest, before),
    after: accept ? auditTime(after.start) : null,
  });
  return shapedFor(sight, after);
}
