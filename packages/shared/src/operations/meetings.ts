import { addDays } from "../dates";
import type { Meeting } from "../types";

/** One occurrence of a meeting: the meeting, when it happens and for how long. */
export interface MeetingOccurrence {
  meeting: Meeting;
  start: string;
  durationMin: number;
  /** The date-time the series planned it for, which names it when it is moved (spec F). */
  planned: string;
}

/**
 * The same weekday in the same week of the next month, the way offices book monthly meetings
 * ("the second Thursday"), so a series never lands on a weekend. A fifth-week date moves to the
 * fourth week, which every month has.
 */
function nextMonthSameWeekday(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const week = Math.min(Math.ceil(date.getUTCDate() / 7), 4);
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const firstMatch = (date.getUTCDay() - first.getUTCDay() + 7) % 7;
  return addDays(first.toISOString().slice(0, 10), firstMatch + (week - 1) * 7) + iso.slice(10);
}

/** The step from one occurrence to the next, or null for a one-off meeting. */
function next(start: string, recurrence: Meeting["recurrence"]): string | null {
  if (recurrence === "weekly") return addDays(start, 7);
  if (recurrence === "biweekly") return addDays(start, 14);
  if (recurrence === "monthly") return nextMonthSameWeekday(start);
  return null;
}

/**
 * Every occurrence of the meetings between two dates, inclusive (spec "Meetings", F): a recurring
 * meeting repeats from its first date until its end date; an occurrence moved on its own takes its
 * new time and length, and a cancelled one is left out. Sorted by start.
 */
export function meetingOccurrences(meetings: readonly Meeting[], from: string, to: string): MeetingOccurrence[] {
  const out: MeetingOccurrence[] = [];
  for (const meeting of meetings) {
    for (
      let planned: string | null = meeting.start;
      planned && planned.slice(0, 10) <= addDays(to, 31) && (!meeting.until || planned.slice(0, 10) <= meeting.until);
      planned = next(planned, meeting.recurrence)
    ) {
      const moved = meeting.exceptions?.find((e) => e.planned === planned);
      if (moved?.cancelled) continue;
      const start = moved?.start ?? planned;
      const day = start.slice(0, 10);
      if (day >= from && day <= to)
        out.push({ meeting, start, durationMin: moved?.durationMin ?? meeting.durationMin, planned });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Which occurrences a change to a recurring meeting covers (spec F). */
export type MoveScope = "this" | "following" | "all";

/** Minutes between two local date-times. */
function minutesBetween(a: string, b: string): number {
  return (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60000;
}

/** A local date-time moved by minutes, "2026-11-09T10:30". */
export function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(`${iso}:00Z`) + minutes * 60000).toISOString().slice(0, 16);
}

/**
 * Moves or resizes one occurrence (spec F): just this one (an exception on the series), this and
 * the following ones (the series ends the day before and a new series starts at the new time), or
 * every occurrence (the series shifts by the same amount). Returns the meetings to save; for
 * "following" the second is the new series, which takes `newId`.
 */
export function moveOccurrence(
  meeting: Meeting,
  planned: string,
  change: { start: string; durationMin: number },
  scope: MoveScope,
  newId: string,
): Meeting[] {
  const shift = minutesBetween(planned, change.start);
  if (meeting.recurrence === "none" || scope === "all") {
    return [
      {
        ...meeting,
        start: addMinutes(meeting.start, shift),
        durationMin: change.durationMin,
        exceptions: (meeting.exceptions ?? []).map((e) => ({ ...e, planned: addMinutes(e.planned, shift) })),
      },
    ];
  }
  if (scope === "this") {
    const rest = (meeting.exceptions ?? []).filter((e) => e.planned !== planned);
    return [{ ...meeting, exceptions: [...rest, { planned, start: change.start, durationMin: change.durationMin }] }];
  }
  const before = (meeting.exceptions ?? []).filter((e) => e.planned < planned);
  const after = (meeting.exceptions ?? []).filter((e) => e.planned > planned);
  return [
    { ...meeting, until: addDays(planned.slice(0, 10), -1), exceptions: before },
    {
      ...meeting,
      id: newId,
      start: change.start,
      durationMin: change.durationMin,
      until: meeting.until,
      exceptions: after.map((e) => ({ ...e, planned: addMinutes(e.planned, shift) })),
    },
  ];
}

/** An attendee booked in two meetings at once (spec F: warn about conflicts). */
export interface Conflict {
  name: string;
  title: string;
  start: string;
}

/**
 * The attendees of a meeting who are already in another meeting overlapping the given time,
 * with that meeting's title and start; the occurrence being moved is ignored.
 */
export function attendeeConflicts(
  meetings: readonly Meeting[],
  candidate: {
    meetingId: string;
    planned: string | null;
    start: string;
    durationMin: number;
    attendees: Meeting["attendees"];
  },
): Conflict[] {
  const day = candidate.start.slice(0, 10);
  const end = addMinutes(candidate.start, candidate.durationMin);
  const ids = new Set(candidate.attendees.map((a) => a.id));
  const out: Conflict[] = [];
  for (const o of meetingOccurrences(meetings, day, day)) {
    if (o.meeting.id === candidate.meetingId && (o.planned === candidate.planned || o.meeting.recurrence === "none"))
      continue;
    const oEnd = addMinutes(o.start, o.durationMin);
    if (o.start >= end || oEnd <= candidate.start) continue;
    for (const a of o.meeting.attendees) {
      if (ids.has(a.id)) out.push({ name: a.name, title: o.meeting.title, start: o.start });
    }
  }
  return out;
}
