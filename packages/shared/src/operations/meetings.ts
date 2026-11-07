import { addDays } from "../dates";
import type { Meeting } from "../types";

/** One occurrence of a meeting: the meeting and the date-time it happens on. */
export interface MeetingOccurrence {
  meeting: Meeting;
  start: string;
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
 * Every occurrence of the meetings between two dates, inclusive (spec "Meetings": recurring
 * meetings). A recurring meeting repeats from its first date; one-offs appear once.
 */
export function meetingOccurrences(meetings: readonly Meeting[], from: string, to: string): MeetingOccurrence[] {
  const out: MeetingOccurrence[] = [];
  for (const meeting of meetings) {
    for (
      let start: string | null = meeting.start;
      start && start.slice(0, 10) <= to;
      start = next(start, meeting.recurrence)
    ) {
      if (start.slice(0, 10) >= from) out.push({ meeting, start });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
