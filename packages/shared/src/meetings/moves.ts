import { recurrenceProblem } from "../calendar/ics";
import { addDays } from "../dates";
import {
  addMinutes,
  meetingOccurrences,
  MOVED_EARLIER_REACH_DAYS,
  moveOccurrence,
  onSeriesRule,
  previousPlannedStart,
  type Conflict,
  type MoveScope,
} from "../operations/meetings";
import type { Attendee, Meeting, MeetingException } from "../types";
import { meetingForViewer, sameAttendee, seesMeeting, type MeetingViewer } from "./access";
import { durationProblem, MEETING_LIMITS, startProblem, typedStartProblem } from "./input";
import { hasEnded } from "./sends";

/** A move as a person asks for it (meetings.md "Move or resize", `MeetingMove` without its id). */
export interface MeetingMoveInput {
  /** The date-time the series planned the occurrence for (spec F); a one-off's own start. */
  planned: string;
  start: string;
  durationMin: number;
  scope: MoveScope;
}

/** The scope a move really has (meetings.md rule 4): a one-off always moves as `all`. */
export function effectiveScope(meeting: Pick<Meeting, "recurrence">, scope: MoveScope): MoveScope {
  return meeting.recurrence === "none" ? "all" : scope;
}

/**
 * Whether a date-time is one of the meeting's occurrences as the series plans them (meetings.md rules
 * 1 and 2): a one-off's own start, or a date-time its rule reaches from `start` up to `until`, that
 * is not a cancelled exception. A move names its occurrence by this key, so a key the meeting never
 * had is refused rather than written as an exception that matches nothing.
 */
export function isPlannedOccurrence(
  meeting: Pick<Meeting, "start" | "recurrence" | "until" | "exceptions">,
  planned: string,
): boolean {
  return allPlanned(meeting, [planned]);
}

/**
 * Whether every one of these date-times is a planned occurrence (`isPlannedOccurrence`). Each is
 * checked against the rule directly (`onSeriesRule`), never by walking the series, so checking a
 * series' exceptions costs the same however many there are and however far ahead they lie.
 */
function allPlanned(
  meeting: Pick<Meeting, "start" | "recurrence" | "until" | "exceptions">,
  keys: readonly string[],
): boolean {
  const cancelled = new Set(meeting.exceptions.filter((e) => e.cancelled).map((e) => e.planned));
  return keys.every(
    (key) => !cancelled.has(key) && !(meeting.until && key.slice(0, 10) > meeting.until) && onSeriesRule(meeting, key),
  );
}

/**
 * Whether an occurrence changed on its own starts more than `MOVED_EARLIER_REACH_DAYS` before the
 * date the series plans for it. The calendar, the reminders and a conflict check look for it only
 * that far ahead of the days they read (`meetingOccurrences`), so such an occurrence would vanish
 * from all three (ADR 0051 "Part 2", review round 3 of PR #35).
 */
function beyondReach(exception: Pick<MeetingException, "planned" | "start">): boolean {
  const day = (exception.start ?? exception.planned).slice(0, 10);
  return exception.planned.slice(0, 10) > addDays(day, MOVED_EARLIER_REACH_DAYS);
}

const BEYOND_REACH = `An occurrence changed on its own would be more than ${MOVED_EARLIER_REACH_DAYS} days before its date in the series, where the calendar can't find it. Choose another time.`;

/**
 * Why a series whose time or rule changes would leave an occurrence changed on its own behind, or
 * null (ADR 0051 "Part 2", review round 3 of PR #35, safer than the spec). A guest's calendar drops a
 * series' overrides when its DTSTART, DTEND or RRULE changes, and one is sent again only while its
 * own time has not ended (`exceptionResends`, `hasEnded`). So an occurrence that has taken place
 * while the date the series plans for it is still ahead would leave that date in every guest's
 * calendar as a plain occurrence, a meeting the app doesn't have. Such a change is refused until
 * that date has passed. Check it on the series as the change saves it: after an "all" move, both
 * series of a split, an edit of the start or length, and an undo of "all" or a split.
 */
export function leftBehindProblem(series: Meeting, now: Date): string | null {
  if (series.recurrence === "none") return null;
  const { timeZone, durationMin } = series;
  const behind = series.exceptions.some(
    (e) =>
      !e.cancelled &&
      hasEnded(e.start ?? e.planned, e.durationMin ?? durationMin, timeZone, now) &&
      !hasEnded(e.planned, durationMin, timeZone, now),
  );
  return behind
    ? "An occurrence changed on its own has already taken place, but its date in the series is still ahead, so guests' calendars would show the meeting again on that date. Change the series after that date, or move one occurrence at a time."
    : null;
}

/**
 * Why a series as a change leaves it has an occurrence changed on its own that can't be kept, or
 * null (ADR 0051 "Part 2"): every exception's planned time must still be on the series' rule, its
 * own start no more than `MOVED_EARLIER_REACH_DAYS` before it (`beyondReach`), and none left behind
 * by the change (`leftBehindProblem`).
 */
function strandedException(series: Meeting, now: Date): string | null {
  const keys = series.exceptions.map((e) => e.planned);
  if (!allPlanned({ ...series, exceptions: [] }, keys))
    return "An occurrence changed on its own would no longer be part of the series after this move. Move it on its own first, or choose another time.";
  return series.exceptions.some(beyondReach) ? BEYOND_REACH : leftBehindProblem(series, now);
}

/**
 * When the last occurrence a series keeps before `planned` ends, as a local date-time (meetings.md
 * rule 4, "this and following"): the latest end among the occurrences changed on their own before
 * it, and the nearest planned date before it that is not one of them. The walk back passes only
 * planned dates that are exceptions, so it takes at most one step more than there are exceptions.
 */
function lastKeptEnd(meeting: Meeting, planned: string): string {
  const own = new Set(meeting.exceptions.map((e) => e.planned));
  let last = "";
  for (const e of meeting.exceptions) {
    const end = addMinutes(e.start ?? e.planned, e.durationMin ?? meeting.durationMin);
    if (e.planned < planned && !e.cancelled && end > last) last = end;
  }
  for (let p = previousPlannedStart(meeting, planned); p; p = previousPlannedStart(meeting, p)) {
    if (own.has(p)) continue;
    const end = addMinutes(p, meeting.durationMin);
    return end > last ? end : last;
  }
  return last;
}

/**
 * Why a series' start can't take a new date-time, or null: it must be a time the clock shows and
 * pass the monthly start limit (meetings.md rule 3; ADR 0051 "Time zones"). Checked only when the
 * start really changes, so the seeded day-30 safety talk can still be resized.
 */
function seriesStartProblem(before: Meeting, after: Meeting): string | null {
  if (after.start === before.start) return null;
  return startProblem(after.start, after.timeZone) ?? recurrenceProblem(after.start, after.recurrence);
}

/**
 * Why a series whose start or length changes as a whole would be wrong, or null (ADR 0051 "Part 2"):
 * its new start must exist on the clock and pass rule 3, and every occurrence changed on its own
 * must still be one of its occurrences once it moves with the start (`shiftedSeries`). A monthly
 * shift can change the week of the month, and a shift can push an occurrence past `until`; nothing
 * would be correct to send for such an occurrence, so the change is refused. So is one that would
 * put an occurrence out of the calendar's reach or leave one behind (`strandedException`, review
 * round 3 of PR #35), checked against `now`, the database clock of the change.
 */
export function shiftedSeriesProblem(before: Meeting, after: Meeting, now: Date): string | null {
  if (before.recurrence === "none") return null;
  return seriesStartProblem(before, after) ?? strandedException(after, now);
}

/**
 * A series with its start and length changed as a whole (meetings.md rule 4, scope `all`): every
 * exception's planned time moves by the same shift, through the spec's own `moveOccurrence`, so an
 * edit and a move shift a series one way.
 */
export function shiftedSeries(meeting: Meeting, change: { start: string; durationMin: number }): Meeting {
  return moveOccurrence(meeting, meeting.start, change, "all", meeting.id)[0] ?? meeting;
}

/** The id the new series of a split takes while a move is only being checked. */
const CHECK_ID = "split-check";

/**
 * Why a move can't be made, or null (meetings.md rules 4 and 5, "Move or resize"; ADR 0051 "Part 2",
 * each refusal safer than the demo, which moves whatever it is given). `today` is the company's day
 * and `now` the database clock of the move:
 * - a cancelled meeting is refused;
 * - the new start must pass `typedStartProblem` (on the clock, and from a year before the company's
 *   `today` to three years after it), and the length is 15 to 1440 whole minutes;
 * - `planned` must be one of the meeting's occurrences (`isPlannedOccurrence`);
 * - "this and following" from the first occurrence is refused: the old series would keep a DTSTART
 *   that RFC 5545 counts as an occurrence, so guests would see the meeting twice;
 * - "this and following" must start after the last occurrence the old series keeps has ended
 *   (`lastKeptEnd`), or both series would hold the same weeks and every guest would get both
 *   (review round 3 of PR #35; rule 4 only says the new series starts at the new time);
 * - "this event" may not move an occurrence more than `MOVED_EARLIER_REACH_DAYS` earlier
 *   (`beyondReach`), where the calendar would lose it;
 * - the series the move leaves must be right: a shifted series start must exist and pass rule 3, a
 *   new series' start must pass rule 3, the moved occurrence must still be one of the result's
 *   occurrences (not past `until`, not off a monthly week), every exception must stay on its series
 *   within reach, none may be left behind on either series (`strandedException`,
 *   `leftBehindProblem`), and a series takes at most `MEETING_LIMITS.exceptionsMax` exceptions.
 */
export function moveProblem(meeting: Meeting, move: MeetingMoveInput, today: string, now: Date): string | null {
  if (meeting.status === "cancelled") return "This meeting was cancelled.";
  const timing = typedStartProblem(move.start, { zone: meeting.timeZone, today }) ?? durationProblem(move.durationMin);
  if (timing) return timing;
  if (!isPlannedOccurrence(meeting, move.planned))
    return "That occurrence is not part of this meeting. Reload the calendar and try again.";
  const scope = effectiveScope(meeting, move.scope);
  if (scope === "following" && move.planned === meeting.start)
    return "This is the first occurrence of the series. Choose All events to move the whole series.";
  const [original, split] = moveOccurrence(meeting, move.planned, move, scope, CHECK_ID);
  if (!original) return "This meeting can't be moved.";
  if (scope === "this") {
    if (original.exceptions.length > MEETING_LIMITS.exceptionsMax)
      return `A series can have at most ${MEETING_LIMITS.exceptionsMax} occurrences changed on their own.`;
    return beyondReach({ planned: move.planned, start: move.start }) ? BEYOND_REACH : null;
  }
  const result = split ?? original;
  const lost = "The moved occurrence would no longer be part of the series. Choose another time.";
  if (scope === "following") {
    const problem = recurrenceProblem(result.start, result.recurrence);
    if (problem) return problem;
    if (move.start <= lastKeptEnd(meeting, move.planned))
      return "The earlier occurrences stay where they are, so this and following must start after the last of them ends. Choose a later time, or choose This event or All events.";
    if (!isPlannedOccurrence(result, move.start)) return lost;
    return strandedException(result, now) ?? leftBehindProblem(original, now);
  }
  if (meeting.recurrence === "none") return null;
  const problem = seriesStartProblem(meeting, original);
  if (problem) return problem;
  return isPlannedOccurrence(original, move.start) ? strandedException(original, now) : lost;
}

/** The meetings a move saves: the original, and the new series of a "this and following" split. */
export interface MovedMeetings {
  scope: MoveScope;
  original: Meeting;
  split: Meeting | null;
}

/**
 * Applies a move (meetings.md rule 4 and the sends table). Check `moveProblem` first.
 * - The original takes SEQUENCE + 1. `rescheduleSequence` is kept for "this event" and set to the new
 *   SEQUENCE for "all" and "this and following".
 * - A split's new series takes `ids.newId`, a new UID, SEQUENCE 0 and `rescheduleSequence` 0. Its
 *   guests are the same, with their answers; an answer's SEQUENCE becomes 0, the new series' own.
 * - Answers and proposals are never reset by a move (meetings.md "Differences from ADR 0021").
 */
export function movedMeetings(
  meeting: Meeting,
  move: MeetingMoveInput,
  ids: { newId: string; newUid: string },
): MovedMeetings {
  const scope = effectiveScope(meeting, move.scope);
  const [moved, next] = moveOccurrence(meeting, move.planned, move, scope, ids.newId);
  const sequence = meeting.sequence + 1;
  const original: Meeting = {
    ...(moved ?? meeting),
    sequence,
    rescheduleSequence: scope === "this" ? meeting.rescheduleSequence : sequence,
  };
  const split: Meeting | null = next
    ? {
        ...next,
        uid: ids.newUid,
        sequence: 0,
        rescheduleSequence: 0,
        attendees: next.attendees.map((a) => ({ ...a, respondedSequence: a.respondedSequence === null ? null : 0 })),
      }
    : null;
  return { scope, original, split };
}

/** One occurrence of one meeting, by the meeting's id and the occurrence's planned date-time. */
export interface OccurrenceKey {
  meetingId: string;
  planned: string;
}

/**
 * The occurrence a move produced, as the saved meetings name it: the planned time of "this event"
 * on the original, the new start on the original for "all" (every planned time moved by the same
 * shift), and the new start on the new series of a split.
 */
export function movedOccurrenceKey(move: MeetingMoveInput, moved: MovedMeetings): OccurrenceKey {
  if (moved.scope === "this") return { meetingId: moved.original.id, planned: move.planned };
  return { meetingId: (moved.split ?? moved.original).id, planned: move.start };
}

/** A guest of the moved meeting booked in another occurrence at the same time, before it is shaped for a reader. */
export interface RawConflict {
  /** The guest as the moved meeting lists them for the mover. */
  guest: Attendee;
  meeting: Meeting;
  start: string;
}

/**
 * Who of the moved meeting's guests is already in another occurrence that overlaps the moved one
 * (meetings.md rule 13), on the state after the move: occurrences on the new start's day only,
 * cancelled meetings and occurrences left out (`meetingOccurrences`). Only the occurrence the move
 * produced is skipped (`movedOccurrenceKey`), so another occurrence of the same series counts, and
 * the meeting never warns about itself after an "all" or split move (the demo compares the key from
 * before the move). Guests are matched by kind and id (`sameAttendee`), so an email guest, whose id
 * is their own row, never matches another meeting's.
 */
export function occurrenceConflicts(
  meetings: readonly Meeting[],
  moved: OccurrenceKey & { start: string; durationMin: number },
  guests: readonly Attendee[],
): RawConflict[] {
  const day = moved.start.slice(0, 10);
  const end = addMinutes(moved.start, moved.durationMin);
  const out: RawConflict[] = [];
  for (const o of meetingOccurrences(meetings, day, day)) {
    if (o.meeting.id === moved.meetingId && o.planned === moved.planned) continue;
    if (o.start >= end || addMinutes(o.start, o.durationMin) <= moved.start) continue;
    for (const guest of guests) {
      if (o.meeting.attendees.some((a) => sameAttendee(a, guest)))
        out.push({ guest, meeting: o.meeting, start: o.start });
    }
  }
  return out;
}

/** What a conflict with a meeting the mover can't read is called (ADR 0051 "Part 2"). */
export const BUSY_TITLE = "Busy";

/**
 * A conflict as the mover may read it (ADR 0051 "Part 2", safer than meetings.md, whose warning names
 * any meeting's title, private ones included): the guest's name as the mover reads it on the moved
 * meeting, the other occurrence's start, and the other meeting's title only when the mover sees that
 * meeting (`seesMeeting`) and sees that guest on it (`meetingForViewer`, so a hidden guest list
 * hides them). Otherwise the title is "Busy": nothing else of the other meeting is given, no id,
 * guests, place, notes or private flag. The start is kept, as free/busy time.
 */
export function conflictForViewer(
  raw: RawConflict,
  viewer: MeetingViewer,
  seesParty: (attendee: Attendee) => boolean,
): Conflict {
  const seen =
    seesMeeting(viewer, raw.meeting) &&
    meetingForViewer(raw.meeting, viewer, seesParty).attendees.some((a) => sameAttendee(a, raw.guest));
  return { name: raw.guest.name, title: seen ? raw.meeting.title : BUSY_TITLE, start: raw.start };
}

/**
 * What the "Moved meeting" audit entry keeps, so Undo is rebuilt on the server from its own copy and
 * never from the client's (ADR 0051 "Part 2", critic B3). Times only: no title, email or note.
 */
export interface MoveRecord {
  before: {
    planned: string;
    /** The SEQUENCE before the move: the one the mover's screen saw. */
    sequence: number;
    /** The series as it was: local start, the stored instant, length, end and exceptions. */
    series: {
      start: string;
      startsAt: string;
      durationMin: number;
      until: string | null;
      exceptions: MeetingException[];
    };
  };
  after: {
    start: string;
    durationMin: number;
    scope: MoveScope;
    /** The SEQUENCE the move gave the original. */
    sequence: number;
    /** The new series a split inserted. */
    createdIds: string[];
  };
}

/** The "Moved meeting" entry of a move: the meeting before it (with its stored start instant) and what it saved. */
export function moveAuditEntry(
  before: Meeting,
  startsAt: Date,
  move: MeetingMoveInput,
  moved: MovedMeetings,
): MoveRecord {
  return {
    before: {
      planned: move.planned,
      sequence: before.sequence,
      series: {
        start: before.start,
        startsAt: startsAt.toISOString(),
        durationMin: before.durationMin,
        until: before.until,
        exceptions: before.exceptions,
      },
    },
    after: {
      start: move.start,
      durationMin: move.durationMin,
      scope: moved.scope,
      sequence: moved.original.sequence,
      createdIds: moved.split ? [moved.split.id] : [],
    },
  };
}

/** How long a move can be undone (ADR 0051 "Part 2"; meetings.md sets no window, and its toast lasts seconds). */
export const UNDO_WINDOW_MINUTES = 5;

/** Why an undo is refused: 403 for someone who may not undo it, 409 when the move can no longer be undone. */
export interface UndoRefusal {
  status: 403 | 409;
  code: "forbidden" | "meeting_changed" | "undo_expired";
  message: string;
}

/** The answer when anything happened to a meeting after its move. */
export const MEETING_CHANGED: UndoRefusal = {
  status: 409,
  code: "meeting_changed",
  message: "This meeting changed after the move, so the move can't be undone.",
};

/** What undo knows besides the record: who wrote the entry, when, who asks, and the SEQUENCE their screen saw. */
export interface UndoContext {
  /** The move's entry, by the meeting's last audit entry: null when that entry is not a move it can read. */
  record: MoveRecord | null;
  moverUserId: string | null;
  callerUserId: string;
  /** How old the move's entry is, by the database clock. */
  ageMs: number;
  /** The SEQUENCE the screen saw before its move (`undo.previous.sequence`). */
  clientSequence: number;
}

/**
 * Why an undo can't be made, or null (meetings.md `undoReschedule`; ADR 0051 "Part 2", safer than the
 * spec, which restores whatever copy the client sends). The caller has already locked a meeting they
 * may change. Then:
 * - the meeting's last audit entry must be the move (`record`), so nothing changed since: every
 *   change to a meeting writes an entry under its lock, so its guests still answer as they did;
 * - only the person who moved it may undo it;
 * - within `UNDO_WINDOW_MINUTES` by the database clock;
 * - the SEQUENCE must be the one the move saved, and the screen's must be the one before it, so a
 *   toast for an older move can't undo a newer one.
 */
export function undoProblem(current: Meeting, ctx: UndoContext): UndoRefusal | null {
  const { record } = ctx;
  if (!record || current.status === "cancelled") return MEETING_CHANGED;
  if (ctx.moverUserId !== ctx.callerUserId)
    return { status: 403, code: "forbidden", message: "Only the person who moved this meeting can undo the move." };
  if (ctx.ageMs > UNDO_WINDOW_MINUTES * 60_000)
    return { status: 409, code: "undo_expired", message: "This move can no longer be undone." };
  if (current.sequence !== record.after.sequence || ctx.clientSequence !== record.before.sequence)
    return MEETING_CHANGED;
  return null;
}

/**
 * Why an undo can't put the series back, or null (ADR 0051 "Part 2", review round 3 of PR #35, safer
 * than the spec): undoing "all" or a split changes the restored series' time or rule again, so it is
 * refused when that would leave an occurrence changed on its own behind (`leftBehindProblem`), as a
 * move is. Undoing "this event" leaves the series' own time and rule as they are.
 */
export function undoneSeriesProblem(current: Meeting, record: MoveRecord, now: Date): string | null {
  return record.after.scope === "this" ? null : leftBehindProblem(undoneMeeting(current, record), now);
}

/**
 * A meeting as an undo restores it (meetings.md sends table, "Undo a move"): start, length, end and
 * exceptions from the move's own record, SEQUENCE + 1 and `rescheduleSequence` set to it. The guests
 * are untouched: the undo is refused when anything changed since the move, so their answers are
 * those of the copy the move saved.
 */
export function undoneMeeting(current: Meeting, record: MoveRecord): Meeting {
  const { series } = record.before;
  const sequence = current.sequence + 1;
  return {
    ...current,
    start: series.start,
    durationMin: series.durationMin,
    until: series.until,
    exceptions: series.exceptions,
    sequence,
    rescheduleSequence: sequence,
  };
}

/**
 * The occurrence an undone "this event" move restores (ADR 0051 "Part 2", critic: the override the
 * move sent must be taken back): its RECURRENCE-ID, at the time an earlier exception gave it, or the
 * series' own time.
 */
export function restoredOccurrence(record: MoveRecord): { recurrenceId: string; start: string; durationMin: number } {
  const { planned, series } = record.before;
  const earlier = series.exceptions.find((e) => e.planned === planned);
  return {
    recurrenceId: planned,
    start: earlier?.start ?? planned,
    durationMin: earlier?.durationMin ?? series.durationMin,
  };
}
