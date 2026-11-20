/**
 * Local date-times in a named time zone, with Intl only (no tz library, ADR 0051). The wire and
 * the shared meeting rules keep the spec's local "YYYY-MM-DDTHH:mm" (meetings.md "Meeting"); the
 * database keeps instants. These helpers convert between the two and say when a local time can't
 * be placed on the clock.
 */

const DAY_MS = 86_400_000;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The calendar years a local date-time may use; outside them the text is refused as malformed. */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2999;

/**
 * The US zones a meeting can be booked in: the ones the calendar file has a VTIMEZONE block for
 * (`calendar/ics.ts`) and Settings → Localization offers. Anything else is refused (ADR 0051).
 */
export const MEETING_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

/** One of the zones a meeting can be booked in. */
export type MeetingTimeZone = (typeof MEETING_TIME_ZONES)[number];

/** Why a local date-time has no instant: bad text, a time the clocks skip, or a zone Intl doesn't know. */
export type LocalTimeProblem = "malformed" | "nonexistent" | "unknown_zone";

/** A local date-time placed on the clock, or the reason it can't be. */
export type ZonedInstant = { instant: Date; problem: null } | { instant: null; problem: LocalTimeProblem };

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One cached formatter per zone; Intl throws a RangeError for a zone it doesn't know. */
function formatter(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(zone, made);
  return made;
}

/** The wall clock a zone shows at an instant, read as if it were UTC, in milliseconds. */
function wallClockAt(instantMs: number, zone: string): number {
  const parts = formatter(zone).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** The zone's offset from UTC at an instant, in milliseconds (negative west of Greenwich). */
function offsetAt(instantMs: number, zone: string): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  return wallClockAt(whole, zone) - whole;
}

/**
 * A local "YYYY-MM-DDTHH:mm" read as if it were UTC, in milliseconds, or null when it is not a real
 * date and time (February 30th, hour 24, a year outside 1900 to 2999).
 */
function localAsUtc(local: string): number | null {
  const match = LOCAL.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (year < FIRST_YEAR || year > LAST_YEAR) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const back = new Date(ms);
  const same =
    back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day &&
    back.getUTCHours() === hour &&
    back.getUTCMinutes() === minute;
  return same ? ms : null;
}

/** Whether a text is a real local date-time in the spec's "YYYY-MM-DDTHH:mm" form. */
export function isLocalDateTime(text: string): boolean {
  return localAsUtc(text) !== null;
}

/**
 * The instants at which a zone's clock shows this wall time, earliest first: none in the spring
 * gap, two in the autumn overlap. US zones change their offset at most once in two days, so the
 * offsets a day either side are the only candidates.
 */
function instantsShowing(wall: number, zone: string): number[] {
  const offsets = new Set([offsetAt(wall - DAY_MS, zone), offsetAt(wall, zone), offsetAt(wall + DAY_MS, zone)]);
  const hits = new Set([...offsets].map((offset) => wall - offset).filter((t) => wallClockAt(t, zone) === wall));
  return [...hits].sort((a, b) => a - b);
}

/**
 * The instant a local date-time names in a zone, for times people type (meetings.md rule 5; ADR
 * 0051 "Time zones"). A time the clocks skip when they go forward is refused (`nonexistent`),
 * because no meeting can start then. A time the clocks show twice when they go back means the
 * earlier one, as RFC 5545 section 3.3.5 reads it, so the app and the calendar file agree.
 */
export function zonedToInstant(local: string, zone: string): ZonedInstant {
  const wall = localAsUtc(local);
  if (wall === null) return { instant: null, problem: "malformed" };
  let hits: number[];
  try {
    hits = instantsShowing(wall, zone);
  } catch {
    return { instant: null, problem: "unknown_zone" };
  }
  const first = hits[0];
  return first === undefined ? { instant: null, problem: "nonexistent" } : { instant: new Date(first), problem: null };
}

/**
 * The instant a local date-time names, for times a rule derives rather than a person types, such
 * as the occurrences of a weekly series (critic G). A time in the spring gap uses the offset from
 * before the gap, as RFC 5545 section 3.3.5 says, so 02:30 on that Sunday is 03:30 daylight time,
 * the same instant a calendar shows. Null only for malformed text or an unknown zone.
 */
export function zonedToInstantLenient(local: string, zone: string): Date | null {
  const strict = zonedToInstant(local, zone);
  if (strict.problem === null) return strict.instant;
  const wall = localAsUtc(local);
  if (strict.problem !== "nonexistent" || wall === null) return null;
  return new Date(wall - offsetAt(wall - DAY_MS, zone));
}

/** The local "YYYY-MM-DDTHH:mm" a zone's clock shows at an instant; seconds are dropped. Throws for an unknown zone. */
export function instantToZoned(instant: Date, zone: string): string {
  return new Date(wallClockAt(instant.getTime(), zone)).toISOString().slice(0, 16);
}

/**
 * The calendar day, "YYYY-MM-DD", a zone's clock shows at an instant: the company's day when the zone
 * is the company's (`tenants.time_zone`). The API dates and checks every record on it (`companyClock`)
 * and the web's `today()` reads it too, so a form's default date is the day the server accepts
 * (ADR 0051, "The company's day on the web", 2026-11-20). Throws a RangeError for a zone Intl doesn't know.
 */
export function dayInZone(instant: Date, zone: string): string {
  return instantToZoned(instant, zone).slice(0, 10);
}

/** Whether Intl knows a zone name, so that `dayInZone` and `instantToZoned` can read a clock in it. */
export function isKnownTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Whether a name is one of the zones a meeting can be booked in, exactly as listed. */
export function isMeetingTimeZone(zone: string): zone is MeetingTimeZone {
  return (MEETING_TIME_ZONES as readonly string[]).includes(zone);
}

/**
 * The zone a company's meetings are booked in, or null when it has none of ours (ADR 0051). The name
 * is canonicalised by Intl first, so a spelling Intl maps to one of the seven zones is accepted
 * under the canonical name; a zone that only shares offsets with one (America/Detroit,
 * America/Puerto_Rico) is refused rather than given another zone's daylight rules.
 */
export function supportedMeetingZone(zone: string): MeetingTimeZone | null {
  if (!zone) return null;
  try {
    const canonical = new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
    return isMeetingTimeZone(canonical) ? canonical : null;
  } catch {
    return null;
  }
}
