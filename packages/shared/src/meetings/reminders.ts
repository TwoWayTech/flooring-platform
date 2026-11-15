import { instantToZoned, zonedToInstantLenient } from "../calendar/zones";
import { addDays, daysBetween } from "../dates";
import { meetingOccurrences } from "../operations/meetings";
import type { Attendee, Meeting } from "../types";
import { isOrganiser } from "./access";

const MINUTE_MS = 60_000;

/** How far ahead My meetings looks for a meeting's next occurrence (ADR 0051): a year and a day covers every repeat choice. */
export const NEXT_OCCURRENCE_DAYS = 366;

/** One occurrence with the instant it starts. */
export interface PlacedOccurrence {
  start: string;
  durationMin: number;
  /** The date-time the series planned it for (spec F). */
  planned: string;
  startsAt: Date;
}

/**
 * The occurrences of one meeting between two days, each placed on the clock, in order. A time a rule
 * derives uses the lenient reading, so an occurrence on the spring-forward night starts where a
 * calendar puts it (RFC 5545 section 3.3.5; critic G), never at the series' first instant plus weeks.
 */
function placedOccurrences(meeting: Meeting, from: string, to: string): PlacedOccurrence[] {
  return meetingOccurrences([meeting], from, to).flatMap((o) => {
    const startsAt = zonedToInstantLenient(o.start, meeting.timeZone);
    return startsAt ? [{ start: o.start, durationMin: o.durationMin, planned: o.planned, startsAt }] : [];
  });
}

/**
 * A meeting's next occurrence on or after a day, within NEXT_OCCURRENCE_DAYS, or null (My meetings,
 * ADR 0051): a series shows its next date, not its first. Cancelled meetings and cancelled
 * occurrences have none.
 */
export function nextOccurrence(meeting: Meeting, today: string): PlacedOccurrence | null {
  return placedOccurrences(meeting, today, addDays(today, NEXT_OCCURRENCE_DAYS))[0] ?? null;
}

/** When a meeting's next reminder goes out, for which occurrence, and when it stops being worth sending. */
export interface MeetingReminder {
  occurrence: PlacedOccurrence;
  scheduledFor: Date;
  /** The occurrence's start: a reminder not sent by then is dropped (ADR 0051 "Reminder expiry"). */
  expiresAt: Date;
}

/**
 * The next reminder of a meeting (meetings.md rule 10; ADR 0051 "Reminders"): `reminderMin` before
 * the first occurrence whose reminder time is still ahead of `now`, or null when there is none. A
 * cancelled meeting and a request still waiting for its answer get none. The time is counted in
 * real minutes from the occurrence's instant, so a reminder the night the clocks change is on time.
 */
export function nextReminder(meeting: Meeting, now: Date): MeetingReminder | null {
  if (meeting.status !== "confirmed" || !Number.isInteger(meeting.reminderMin) || meeting.reminderMin <= 0) return null;
  const today = instantToZoned(now, meeting.timeZone).slice(0, 10);
  const from = addDays(today, -1);
  const reach = Math.max(NEXT_OCCURRENCE_DAYS, daysBetween(from, meeting.start) + 1);
  for (const occurrence of placedOccurrences(meeting, from, addDays(from, reach))) {
    const scheduledFor = new Date(occurrence.startsAt.getTime() - meeting.reminderMin * MINUTE_MS);
    if (scheduledFor > now) return { occurrence, scheduledFor, expiresAt: occurrence.startsAt };
  }
  return null;
}

/**
 * Who gets a meeting's reminder (meetings.md rule 10): its staff guests, never anyone outside the
 * company. The organiser is left out every time, as the demo does when it schedules one, so a
 * re-sync by someone else neither adds nor drops a person (ADR 0051).
 */
export function reminderRecipients(meeting: Meeting): Attendee[] {
  return meeting.attendees.filter((a) => a.kind === "staff" && !isOrganiser(meeting, a.id));
}
