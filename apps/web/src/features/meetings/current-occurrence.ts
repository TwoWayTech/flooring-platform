import {
  effectiveScope,
  isPlannedOccurrence,
  type Meeting,
  type MeetingOccurrence,
  type OccurrenceKey,
} from "@workspace/shared";
import type { MeetingMove, MeetingUndo } from "@/lib/api/contract";

/** The key that names an occurrence: its meeting and the date-time the series planned it for (spec F). */
export function keyOf(occurrence: MeetingOccurrence): OccurrenceKey {
  return { meetingId: occurrence.meeting.id, planned: occurrence.planned };
}

/**
 * The occurrence a key names in the meetings as last read (ADR 0051 "Part 3", safest option 16), so
 * the drawer always shows the meeting as it is now, whatever range the calendar shows:
 * - null when the meeting is gone, cancelled, or no longer plans that occurrence, so the drawer
 *   closes rather than offer a move or a cancel against something that no longer exists;
 * - a one-off is rebuilt from the fresh meeting, so after it moves it is still found by its id;
 * - a series occurrence takes its own time and length when it was changed on its own, as
 *   `meetingOccurrences` does (the first exception for that planned time).
 */
export function occurrenceAt(meetings: readonly Meeting[], key: OccurrenceKey): MeetingOccurrence | null {
  const meeting = meetings.find((m) => m.id === key.meetingId);
  if (!meeting || meeting.status === "cancelled") return null;
  if (meeting.recurrence === "none")
    return { meeting, planned: meeting.start, start: meeting.start, durationMin: meeting.durationMin };
  if (!isPlannedOccurrence(meeting, key.planned)) return null;
  const exception = meeting.exceptions.find((x) => x.planned === key.planned);
  return {
    meeting,
    planned: key.planned,
    start: exception?.start ?? key.planned,
    durationMin: exception?.durationMin ?? meeting.durationMin,
  };
}

/**
 * The occurrence a move produced, so the drawer follows it (meetings.md rule 4, as the shared
 * `movedOccurrenceKey` names it on the server): "this event" keeps its planned time; "all", a
 * one-off included, shifts every planned time, so the moved one is planned at its new start; "this
 * and following" lands on the new series, the first id the server created.
 */
export function movedKey(move: MeetingMove, answer: { undo: MeetingUndo }, meeting: Meeting): OccurrenceKey {
  const scope = effectiveScope(meeting, move.scope);
  if (scope === "this") return { meetingId: move.meetingId, planned: move.planned };
  if (scope === "all") return { meetingId: move.meetingId, planned: move.start };
  return { meetingId: answer.undo.createdIds[0] ?? move.meetingId, planned: move.start };
}

/** One read of the meetings. A re-read gives a new object, so the drawer tells reads apart by identity. */
export interface MeetingsRead {
  readonly meetings: readonly Meeting[];
}

/**
 * What the meeting drawer follows (meetings.md Part 3, "The drawer follows its occurrence"; ADR 0051
 * "Part 3", safest option 16). After a move or an Undo made from it, the occurrence it heads for
 * (`key`) is only in the meetings once the re-read after that write answers: a "this and following"
 * split's new series and an "all" shift's new times are not in the read shown when the write
 * answered (`against`). Until a newer read comes, the drawer keeps showing the occurrence it showed
 * (`was`), so it neither closes on the old read nor shows an occurrence the move changed.
 */
export interface DrawerTarget {
  key: OccurrenceKey;
  was: OccurrenceKey | null;
  against: MeetingsRead | null;
}

/** The drawer opened on one occurrence. */
export function drawerOn(key: OccurrenceKey): DrawerTarget {
  return { key, was: null, against: null };
}

const sameOccurrence = (a: OccurrenceKey, b: OccurrenceKey) => a.meetingId === b.meetingId && a.planned === b.planned;

/**
 * The drawer after a move or an Undo took `from` to `to`, with `shown` the read on screen when the
 * write answered. It follows only a change to the occurrence it is on, the one it heads for or the
 * one it still shows; any other move leaves it where it is.
 */
export function followMove(
  target: DrawerTarget | null,
  from: OccurrenceKey,
  to: OccurrenceKey,
  shown: MeetingsRead | null,
): DrawerTarget | null {
  if (!target) return null;
  const onIt = sameOccurrence(target.key, from) || (target.was !== null && sameOccurrence(target.was, from));
  return onIt ? { key: to, was: from, against: shown } : target;
}

/**
 * What the drawer shows in a read, and the target it settles to:
 * - while the read is still the one shown when a move or Undo answered, the occurrence it showed;
 * - otherwise the occurrence it follows (`occurrenceAt`), and it stops waiting;
 * - null, closing it, once a newer read has no such occurrence (moved away by someone else,
 *   cancelled or removed), so it never offers a move or a cancel against it.
 */
export function drawerOccurrence(
  read: MeetingsRead,
  target: DrawerTarget | null,
): { occurrence: MeetingOccurrence | null; target: DrawerTarget | null } {
  if (!target) return { occurrence: null, target: null };
  if (target.was && read === target.against) {
    const before = occurrenceAt(read.meetings, target.was);
    if (before) return { occurrence: before, target };
  }
  const occurrence = occurrenceAt(read.meetings, target.key);
  if (!occurrence) return { occurrence: null, target: null };
  return { occurrence, target: target.was ? drawerOn(target.key) : target };
}
