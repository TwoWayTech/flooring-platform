import type { Attendee, Meeting } from "../types";

const CRLF = "\r\n";
const LINE_LIMIT = 75;

/** Escapes text for an iCalendar value (RFC 5545 section 3.3.11). */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
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

/** The US zones the demo offers, with their standard and daylight offsets. */
const ZONES: Record<string, { std: string; dst: string | null; stdName: string; dstName: string }> = {
  "America/New_York": { std: "-0500", dst: "-0400", stdName: "EST", dstName: "EDT" },
  "America/Chicago": { std: "-0600", dst: "-0500", stdName: "CST", dstName: "CDT" },
  "America/Denver": { std: "-0700", dst: "-0600", stdName: "MST", dstName: "MDT" },
  "America/Phoenix": { std: "-0700", dst: null, stdName: "MST", dstName: "" },
  "America/Los_Angeles": { std: "-0800", dst: "-0700", stdName: "PST", dstName: "PDT" },
  "America/Anchorage": { std: "-0900", dst: "-0800", stdName: "AKST", dstName: "AKDT" },
  "Pacific/Honolulu": { std: "-1000", dst: null, stdName: "HST", dstName: "" },
};

function timezoneBlock(tzid: string): string[] {
  const zone = ZONES[tzid] ?? ZONES["America/New_York"]!;
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

const localStamp = (iso: string) => `${iso.slice(0, 10).replaceAll("-", "")}T${iso.slice(11, 16).replace(":", "")}00`;
const utcStamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

/** Adds minutes to a local "YYYY-MM-DDTHH:mm" without any time zone conversion. */
function plusMinutes(iso: string, minutes: number): string {
  const [date, time] = iso.split("T") as [string, string];
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, m] = time.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, m + minutes)).toISOString().slice(0, 16);
}

/** The end of a day in a zone, as a UTC instant, for an RRULE's UNTIL (RFC 5545). */
export function endOfDayUtc(day: string, tzid: string): string {
  const guess = new Date(`${day}T23:59:59Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return utcStamp(new Date(guess.getTime() + (guess.getTime() - shown)));
}

const WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Why a repeating meeting can't start on this date, or null: a fifth-week monthly date falls outside its own rule (ADR 0021). */
export function recurrenceProblem(start: string, recurrence: Meeting["recurrence"]): string | null {
  if (recurrence === "monthly" && Number(start.slice(8, 10)) > 28)
    return "A monthly meeting can't start in the fifth week of a month.";
  return null;
}

function recurrenceRule(meeting: Pick<Meeting, "recurrence" | "start" | "until" | "timeZone">): string | null {
  const until = meeting.until ? `;UNTIL=${endOfDayUtc(meeting.until, meeting.timeZone)}` : "";
  if (meeting.recurrence === "weekly") return `RRULE:FREQ=WEEKLY${until}`;
  if (meeting.recurrence === "biweekly") return `RRULE:FREQ=WEEKLY;INTERVAL=2${until}`;
  if (meeting.recurrence === "monthly") {
    const date = new Date(`${meeting.start.slice(0, 10)}T00:00:00Z`);
    return `RRULE:FREQ=MONTHLY;BYDAY=${Math.ceil(date.getUTCDate() / 7)}${WEEKDAY[date.getUTCDay()]}${until}`;
  }
  return null;
}

/** What one calendar file says. */
export interface IcsInput {
  method: "REQUEST" | "CANCEL" | "PUBLISH" | "DECLINECOUNTER";
  meeting: Meeting;
  sequence: number;
  /** When the message is made; DTSTAMP is written in UTC. */
  stamp: Date;
  organizer: { name: string; email: string };
  /** Who the file lists; PUBLISH lists nobody. */
  attendees: readonly Attendee[];
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** Set when this file is about one occurrence of a series. */
  recurrenceId?: string;
  /** The occurrence's own time and length, when it has moved. */
  start?: string;
  durationMin?: number;
}

const PART_STAT: Record<Attendee["partStat"], string> = {
  "needs-action": "NEEDS-ACTION",
  accepted: "ACCEPTED",
  tentative: "TENTATIVE",
  declined: "DECLINED",
};

const attendeeLine = (a: Attendee) =>
  `ATTENDEE;CN="${a.name.replace(/"/g, "'")}";ROLE=${a.role === "optional" ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT"};PARTSTAT=${PART_STAT[a.partStat]};RSVP=TRUE:mailto:${a.email}`;

/**
 * One iCalendar file with a single VEVENT (RFC 5545 and 5546, ADR 0021): same UID for the life of
 * the meeting, SEQUENCE from the caller, local times with their VTIMEZONE and a UTC DTSTAMP. REQUEST
 * files carry one reminder and CANCEL files none.
 */
export function meetingIcs(input: IcsInput): string {
  const { meeting } = input;
  const start = input.start ?? meeting.start;
  const end = plusMinutes(start, input.durationMin ?? meeting.durationMin);
  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Flooring Suite//Demo//EN",
    `METHOD:${input.method}`,
    ...timezoneBlock(meeting.timeZone),
    "BEGIN:VEVENT",
    `UID:${meeting.uid}`,
    `DTSTAMP:${utcStamp(input.stamp)}`,
    `SEQUENCE:${input.sequence}`,
    input.recurrenceId ? `RECURRENCE-ID;TZID=${meeting.timeZone}:${localStamp(input.recurrenceId)}` : null,
    `DTSTART;TZID=${meeting.timeZone}:${localStamp(start)}`,
    `DTEND;TZID=${meeting.timeZone}:${localStamp(end)}`,
    input.recurrenceId ? null : recurrenceRule(meeting),
    `SUMMARY:${icsEscape(meeting.title)}`,
    meeting.location ? `LOCATION:${icsEscape(meeting.location)}` : null,
    meeting.notes ? `DESCRIPTION:${icsEscape(meeting.notes)}` : null,
    `ORGANIZER;CN="${input.organizer.name.replace(/"/g, "'")}":mailto:${input.organizer.email}`,
    ...input.attendees.map(attendeeLine),
    input.status ? `STATUS:${input.status}` : null,
    ...(input.method === "REQUEST"
      ? [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${icsEscape(meeting.title)}`,
          `TRIGGER:-PT${meeting.reminderMin}M`,
          "END:VALARM",
        ]
      : []),
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
