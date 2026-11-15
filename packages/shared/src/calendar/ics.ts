import { validGuestEmail } from "../meetings/email";
import { monthlyWeekOf, nextPlannedStart } from "../operations/meetings";
import type { Attendee, Meeting } from "../types";
import {
  instantToZoned,
  supportedMeetingZone,
  zonedToInstant,
  zonedToInstantLenient,
  type MeetingTimeZone,
} from "./zones";

const CRLF = "\r\n";
const LINE_LIMIT = 75;
const MINUTE_MS = 60_000;
/** The longest CN a calendar line gets; a guest's name is capped at 100 on input too (ADR 0051). */
const CN_MAX = 100;

/** The PRODID the demo writes (ADR 0021); exported so the demo store names it when it writes a file (ADR 0051 "Part 3"). */
export const DEMO_PRODID = "-//Flooring Suite//Demo//EN";

/** The PRODID the real build writes: product-neutral, because HR Suite sends invites too (ADR 0051). */
export const MEETINGS_PRODID = "-//Platform//Meetings//EN";

/**
 * Control characters a calendar text value may not carry (RFC 5545 section 3.3.11 allows none but
 * HTAB; a line break is escaped instead), plus the Unicode line and paragraph separators.
 */
const CONTROL_IN_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;
/** Characters a quoted parameter such as CN may not carry (RFC 5545 section 3.1, QSAFE-CHAR). */
const CONTROL_IN_PARAM = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * Escapes text for an iCalendar value (RFC 5545 section 3.3.11). A line break becomes `\n`; every
 * other control character, a lone CR included, is dropped, so no text can end the line and start
 * a property of its own (ADR 0051).
 */
export function icsEscape(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(CONTROL_IN_TEXT, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** A name as a quoted parameter value: no control characters, `"` turned into `'`, at most 100 characters. */
function quotedParam(name: string): string {
  const safe = name.replace(CONTROL_IN_PARAM, "").replace(/"/g, "'").trim();
  return Array.from(safe).slice(0, CN_MAX).join("");
}

/** Folds a line at 75 octets without splitting a UTF-8 character; continuation lines start with a space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > LINE_LIMIT) {
      parts.push(current);
      current = " ";
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

/** The US zones a meeting can be booked in, with their standard and daylight offsets. */
const ZONES: Record<MeetingTimeZone, { std: string; dst: string | null; stdName: string; dstName: string }> = {
  "America/New_York": { std: "-0500", dst: "-0400", stdName: "EST", dstName: "EDT" },
  "America/Chicago": { std: "-0600", dst: "-0500", stdName: "CST", dstName: "CDT" },
  "America/Denver": { std: "-0700", dst: "-0600", stdName: "MST", dstName: "MDT" },
  "America/Phoenix": { std: "-0700", dst: null, stdName: "MST", dstName: "" },
  "America/Los_Angeles": { std: "-0800", dst: "-0700", stdName: "PST", dstName: "PDT" },
  "America/Anchorage": { std: "-0900", dst: "-0800", stdName: "AKST", dstName: "AKDT" },
  "Pacific/Honolulu": { std: "-1000", dst: null, stdName: "HST", dstName: "" },
};

function timezoneBlock(tzid: MeetingTimeZone): string[] {
  const zone = ZONES[tzid];
  if (!zone.dst) {
    return [
      "BEGIN:VTIMEZONE",
      `TZID:${tzid}`,
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${zone.std}`,
      `TZOFFSETTO:${zone.std}`,
      `TZNAME:${zone.stdName}`,
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
  }
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${tzid}`,
    "BEGIN:STANDARD",
    "DTSTART:19701101T020000",
    `TZOFFSETFROM:${zone.dst}`,
    `TZOFFSETTO:${zone.std}`,
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    `TZNAME:${zone.stdName}`,
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700308T020000",
    `TZOFFSETFROM:${zone.std}`,
    `TZOFFSETTO:${zone.dst}`,
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    `TZNAME:${zone.dstName}`,
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ];
}

/**
 * The TZID a file is written in. A zone outside the table is refused, not given New York's block
 * under its own name (meetings.md "Other"), because the file would then be wrong (ADR 0051).
 */
function calendarZone(zone: string): MeetingTimeZone {
  const tzid = supportedMeetingZone(zone);
  if (!tzid) throw new Error(`A calendar file can't be written for the time zone "${zone}".`);
  return tzid;
}

const localStamp = (iso: string) => `${iso.slice(0, 10).replaceAll("-", "")}T${iso.slice(11, 16).replace(":", "")}00`;
const utcStamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

/** The start of an occurrence as an instant; a derived time in the spring gap reads as RFC 5545 says. */
function startInstant(start: string, tzid: MeetingTimeZone): Date {
  const instant = zonedToInstantLenient(start, tzid);
  if (!instant) throw new Error(`"${start}" is not a local date and time.`);
  return instant;
}

/** The end of a day in a zone, as a UTC instant, for an RRULE's UNTIL (RFC 5545 section 3.3.10). */
export function endOfDayUtc(day: string, tzid: string): string {
  const lastMinute = zonedToInstantLenient(`${day.slice(0, 10)}T23:59`, tzid);
  if (!lastMinute) throw new Error(`"${day}" is not a day in ${tzid}.`);
  return utcStamp(new Date(lastMinute.getTime() + 59_000));
}

/**
 * DTEND as the start instant plus the length (ADR 0051), not wall-clock arithmetic, so a meeting
 * across the autumn clock change still lasts its minutes. It is local with the TZID, as ADR 0021
 * asks, unless that local time is one the clock shows twice and the end is the later of the two:
 * RFC 5545 section 3.3.5 reads such a time as the earlier one, so that rare end is written in UTC.
 */
function endLine(start: string, durationMin: number, tzid: MeetingTimeZone): string {
  const end = new Date(startInstant(start, tzid).getTime() + durationMin * MINUTE_MS);
  const local = instantToZoned(end, tzid);
  const readBack = zonedToInstant(local, tzid).instant;
  return readBack?.getTime() === end.getTime() ? `DTEND;TZID=${tzid}:${localStamp(local)}` : `DTEND:${utcStamp(end)}`;
}

const WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Why a repeating meeting can't start on this date, or null: a fifth-week monthly date falls outside its own rule (ADR 0021). */
export function recurrenceProblem(start: string, recurrence: Meeting["recurrence"]): string | null {
  if (recurrence === "monthly" && Number(start.slice(8, 10)) > 28)
    return "A monthly meeting can't start in the fifth week of a month.";
  return null;
}

/** The RRULE of a series that starts at `start` (meetings.md rule 16); monthly uses the app's week rule. */
function recurrenceRule(meeting: Pick<Meeting, "recurrence" | "until">, start: string, tzid: MeetingTimeZone) {
  const until = meeting.until ? `;UNTIL=${endOfDayUtc(meeting.until, tzid)}` : "";
  if (meeting.recurrence === "weekly") return `RRULE:FREQ=WEEKLY${until}`;
  if (meeting.recurrence === "biweekly") return `RRULE:FREQ=WEEKLY;INTERVAL=2${until}`;
  if (meeting.recurrence === "monthly") {
    const weekday = WEEKDAY[new Date(`${start.slice(0, 10)}T00:00:00Z`).getUTCDay()];
    return `RRULE:FREQ=MONTHLY;BYDAY=${monthlyWeekOf(start)}${weekday}${until}`;
  }
  return null;
}

/**
 * DTSTART and the repeat lines of a series. RFC 5545 section 3.8.5.3 leaves a DTSTART outside its
 * own RRULE undefined, and a monthly series that starts after day 28 is such a case: its later dates
 * are in the fourth week (meetings.md rule 2; the seeded Summit safety talk starts on the 30th). The
 * file then starts the rule at the second occurrence and lists the first as an RDATE, so it names
 * the dates meetingOccurrences does; one that ends before its second occurrence is a single event.
 */
function seriesLines(
  meeting: Pick<Meeting, "recurrence" | "until" | "start">,
  tzid: MeetingTimeZone,
): { dtstart: string; lines: string[] } {
  const rule = recurrenceRule(meeting, meeting.start, tzid);
  const second = nextPlannedStart(meeting.start, meeting.recurrence);
  if (!rule || !second || meeting.recurrence !== "monthly" || Number(meeting.start.slice(8, 10)) <= 28) {
    return { dtstart: meeting.start, lines: rule ? [rule] : [] };
  }
  if (meeting.until && second.slice(0, 10) > meeting.until) return { dtstart: meeting.start, lines: [] };
  const fromSecond = recurrenceRule(meeting, second, tzid) ?? rule;
  return { dtstart: second, lines: [fromSecond, `RDATE;TZID=${tzid}:${localStamp(meeting.start)}`] };
}

/** What one calendar file says. */
export interface IcsInput {
  method: "REQUEST" | "CANCEL" | "PUBLISH" | "DECLINECOUNTER";
  meeting: Meeting;
  sequence: number;
  /** When the message is made; DTSTAMP is written in UTC. */
  stamp: Date;
  organizer: { name: string; email: string };
  /** Who the file lists; PUBLISH lists nobody. Guests without a valid address are left out. */
  attendees: readonly Attendee[];
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** Set when this file is about one occurrence of a series. */
  recurrenceId?: string;
  /** The occurrence's own time and length, when it has moved. */
  start?: string;
  durationMin?: number;
  /** The PRODID line; the demo's is the default, and the API passes MEETINGS_PRODID. */
  prodId?: string;
}

const PART_STAT: Record<Attendee["partStat"], string> = {
  "needs-action": "NEEDS-ACTION",
  accepted: "ACCEPTED",
  tentative: "TENTATIVE",
  declined: "DECLINED",
};

/** A CN parameter, or nothing when the name has no safe characters left. */
const cnParam = (name: string) => {
  const cn = quotedParam(name);
  return cn ? `;CN="${cn}"` : "";
};

/** One ATTENDEE line, or null for a guest whose address is not a valid one (ADR 0051). */
function attendeeLine(a: Attendee): string | null {
  if (!validGuestEmail(a.email)) return null;
  const role = a.role === "optional" ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT";
  return `ATTENDEE${cnParam(a.name)};ROLE=${role};PARTSTAT=${PART_STAT[a.partStat]};RSVP=TRUE:mailto:${a.email}`;
}

/** The ORGANIZER line, or null when the organiser has no valid address. */
function organizerLine(organizer: IcsInput["organizer"]): string | null {
  return validGuestEmail(organizer.email) ? `ORGANIZER${cnParam(organizer.name)}:mailto:${organizer.email}` : null;
}

/** The reminder a REQUEST carries, when the meeting has a whole number of minutes to remind at. */
function alarmLines(input: IcsInput): string[] {
  const { meeting } = input;
  if (input.method !== "REQUEST" || !Number.isInteger(meeting.reminderMin) || meeting.reminderMin <= 0) return [];
  return [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(meeting.title)}`,
    `TRIGGER:-PT${meeting.reminderMin}M`,
    "END:VALARM",
  ];
}

/**
 * One iCalendar file with a single VEVENT (RFC 5545 and 5546, ADR 0021 and 0051): same UID for the
 * life of the meeting, SEQUENCE from the caller, local times with their VTIMEZONE and a UTC
 * DTSTAMP. REQUEST files carry one reminder and CANCEL files none. Text is escaped and stripped of
 * control characters, names are safe quoted parameters, and a guest or organiser without a valid
 * address gets no line, so nothing a person types can add a property to the file.
 */
export function meetingIcs(input: IcsInput): string {
  const { meeting } = input;
  const tzid = calendarZone(meeting.timeZone);
  const own = input.start ?? meeting.start;
  const series = input.recurrenceId
    ? { dtstart: own, lines: [] }
    : seriesLines({ recurrence: meeting.recurrence, until: meeting.until, start: own }, tzid);
  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${input.prodId ?? DEMO_PRODID}`,
    `METHOD:${input.method}`,
    ...timezoneBlock(tzid),
    "BEGIN:VEVENT",
    `UID:${icsEscape(meeting.uid)}`,
    `DTSTAMP:${utcStamp(input.stamp)}`,
    `SEQUENCE:${input.sequence}`,
    input.recurrenceId ? `RECURRENCE-ID;TZID=${tzid}:${localStamp(input.recurrenceId)}` : null,
    `DTSTART;TZID=${tzid}:${localStamp(series.dtstart)}`,
    endLine(series.dtstart, input.durationMin ?? meeting.durationMin, tzid),
    ...series.lines,
    `SUMMARY:${icsEscape(meeting.title)}`,
    meeting.location ? `LOCATION:${icsEscape(meeting.location)}` : null,
    meeting.notes ? `DESCRIPTION:${icsEscape(meeting.notes)}` : null,
    organizerLine(input.organizer),
    ...input.attendees.map(attendeeLine),
    input.status ? `STATUS:${input.status}` : null,
    ...alarmLines(input),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return (
    lines
      .filter((l): l is string => l !== null)
      .map(foldLine)
      .join(CRLF) + CRLF
  );
}
