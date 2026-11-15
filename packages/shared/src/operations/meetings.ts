import { isLocalDateTime } from "../calendar/zones";
import { addDays, daysBetween } from "../dates";
import type { Meeting, MeetingException } from "../types";

/** One occurrence of a meeting: the meeting, when it happens and for how long. */
export interface MeetingOccurrence {
  meeting: Meeting;
  start: string;
  durationMin: number;
  /** The date-time the series planned it for, which names it when it is moved (spec F). */
  planned: string;
}

/**
 * The week of the month a monthly series repeats in (meetings.md rule 2): the week of its date,
 * with a fifth week moved to the fourth, which every month has. The calendar file's BYDAY uses the
 * same number (ADR 0051), so a series that starts in a fifth week still matches the app.
 */
export function monthlyWeekOf(iso: string): number {
  return Math.min(Math.ceil(Number(iso.slice(8, 10)) / 7), 4);
}

/** The days between a weekly or biweekly series' planned dates (meetings.md rule 2). */
const STEP_DAYS: Partial<Record<Meeting["recurrence"], number>> = { weekly: 7, biweekly: 14 };

/** The month ("YYYY-MM") a number of months after the month of an ISO date. */
function monthsAfter(iso: string, months: number): string {
  const date = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

/**
 * A monthly series' planned date-time in a month ("YYYY-MM") after the month of `start`, its first
 * (meetings.md rule 2): the same weekday in the same week, the way offices book monthly meetings
 * ("the second Thursday"), so a series never lands on a weekend. A fifth-week date moves to the
 * fourth week, which every month has. The week and weekday stay the same from one month to the
 * next, so the date in any month is worked out directly from the first, with no walk.
 */
function monthlyPlannedIn(start: string, month: string): string {
  const weekday = new Date(`${start.slice(0, 10)}T00:00:00Z`).getUTCDay();
  const firstOfMonth = new Date(`${month}-01T00:00:00Z`);
  const firstMatch = (weekday - firstOfMonth.getUTCDay() + 7) % 7;
  return addDays(`${month}-01`, firstMatch + (monthlyWeekOf(start) - 1) * 7) + start.slice(10);
}

/**
 * The planned start after this one, or null for a one-off meeting (meetings.md rule 2). The
 * calendar file uses it too, so its RRULE and the app's occurrences agree (ADR 0051).
 */
export function nextPlannedStart(start: string, recurrence: Meeting["recurrence"]): string | null {
  const step = STEP_DAYS[recurrence];
  if (step) return addDays(start, step);
  if (recurrence === "monthly") return monthlyPlannedIn(start, monthsAfter(start, 1));
  return null;
}

/**
 * Whether a date-time is one the meeting's rule reaches from its start (meetings.md rule 2), before
 * its end date and its exceptions are looked at: the start itself, a weekly or biweekly step from it
 * at the same time of day, or a monthly series' date in a later month (`nextPlannedStart`). Text that
 * is not a real local date-time never is. It is worked out directly, so it costs the same for any
 * date (ADR 0051 "Part 2", review round 1 of PR #35).
 */
export function onSeriesRule(meeting: Pick<Meeting, "start" | "recurrence">, key: string): boolean {
  if (key === meeting.start) return true;
  if (key < meeting.start || key.slice(10) !== meeting.start.slice(10) || !isLocalDateTime(key)) return false;
  const step = STEP_DAYS[meeting.recurrence];
  if (step) return daysBetween(meeting.start, key) % step === 0;
  return (
    meeting.recurrence === "monthly" &&
    key.slice(0, 7) > meeting.start.slice(0, 7) &&
    key === monthlyPlannedIn(meeting.start, key.slice(0, 7))
  );
}

/**
 * The planned start of each of a meeting's occurrences on a day from `from` to `to`, inclusive, in
 * order, whatever its end date and exceptions say. The first is found by counting from the start, not
 * by walking to it, so the work grows with the window, never with the age of the series.
 */
function plannedBetween(meeting: Meeting, from: string, to: string): string[] {
  const startDay = meeting.start.slice(0, 10);
  const inWindow = (planned: string) => planned.slice(0, 10) >= from && planned.slice(0, 10) <= to;
  const out = inWindow(meeting.start) ? [meeting.start] : [];
  const step = STEP_DAYS[meeting.recurrence];
  if (step) {
    let steps = Math.max(1, Math.ceil(daysBetween(startDay, from) / step));
    for (let p = addDays(meeting.start, steps * step); p.slice(0, 10) <= to; p = addDays(meeting.start, ++steps * step))
      out.push(p);
  } else if (meeting.recurrence === "monthly") {
    const first = from.slice(0, 7) > startDay.slice(0, 7) ? from.slice(0, 7) : monthsAfter(startDay, 1);
    for (let month = first; month <= to.slice(0, 7); month = monthsAfter(`${month}-01`, 1)) {
      const planned = monthlyPlannedIn(meeting.start, month);
      if (inWindow(planned)) out.push(planned);
    }
  }
  return out;
}

/**
 * How many days before its planned date an occurrence moved on its own is still found
 * (`meetingOccurrences`): it is looked for when its planned date is at most this many days after the
 * window, as the calendar always has.
 */
export const MOVED_EARLIER_REACH_DAYS = 31;

/** One meeting's occurrences between two days (`meetingOccurrences`), in the order the series plans them. */
function occurrencesOf(meeting: Meeting, from: string, to: string): MeetingOccurrence[] {
  const ends = (planned: string) => !meeting.until || planned.slice(0, 10) <= meeting.until;
  const moved = new Map<string, MeetingException>();
  for (const exception of meeting.exceptions ?? []) {
    if (!moved.has(exception.planned)) moved.set(exception.planned, exception);
  }
  const out: MeetingOccurrence[] = [];
  for (const planned of plannedBetween(meeting, from, meeting.until && meeting.until < to ? meeting.until : to)) {
    if (!moved.has(planned)) out.push({ meeting, start: planned, durationMin: meeting.durationMin, planned });
  }
  const reach = addDays(to, MOVED_EARLIER_REACH_DAYS);
  for (const [planned, exception] of moved) {
    if (exception.cancelled || planned.slice(0, 10) > reach || !ends(planned) || !onSeriesRule(meeting, planned))
      continue;
    const start = exception.start ?? planned;
    const day = start.slice(0, 10);
    if (day >= from && day <= to)
      out.push({ meeting, start, durationMin: exception.durationMin ?? meeting.durationMin, planned });
  }
  return out.sort((a, b) => a.planned.localeCompare(b.planned));
}

/**
 * Every occurrence of the meetings between two dates, inclusive (spec "Meetings", F): a recurring
 * meeting repeats from its first date until its end date; an occurrence moved on its own takes its
 * new time and length, and a cancelled one is left out. Sorted by start. Each series' occurrences
 * are worked out from the window, not walked from its first date, so a long-running or far-away
 * series costs no more than a new one (ADR 0051 "Part 2", review round 1 of PR #35).
 */
export function meetingOccurrences(meetings: readonly Meeting[], from: string, to: string): MeetingOccurrence[] {
  const out: MeetingOccurrence[] = [];
  for (const meeting of meetings) {
    if (meeting.status !== "cancelled") out.push(...occurrencesOf(meeting, from, to));
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
