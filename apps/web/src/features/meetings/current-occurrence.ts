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
