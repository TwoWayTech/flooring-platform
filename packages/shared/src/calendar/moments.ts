import { instantToZoned, zonedToInstantLenient } from "./zones";

/**
 * Moments shown in the company's time zone (ADR 0064). A moment reaches a screen, an email or an
 * export in one of two forms:
 * - an instant with its zone mark, ISO 8601 ending in `Z` or `±hh:mm` (every API answer since ADR
 *   0064), which is read on the company's clock;
 * - a wall time with no mark, "YYYY-MM-DDTHH:mm" (DemoStore's stamps, meeting times, legacy rows
 *   that were never sent by the API), which already is the clock of the zone it is shown in.
 * A plain calendar date, "YYYY-MM-DD" (due dates, periods), is not a moment and is never shifted.
 */

const MARKED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;
const MINUTE_MS = 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A moment read on a zone's clock. */
export interface ZonedMoment {
  /** The zone's wall clock, "YYYY-MM-DDTHH:mm". */
  wall: string;
  /** The instant itself. */
  instant: Date;
  /** The zone's short name at that instant, "MST" or "MDT" for Denver; "GMT+9" where Intl has no letters. */
  abbreviation: string;
  /** The zone's offset from UTC at that instant, "-07:00". */
  offset: string;
}

const namers = new Map<string, Intl.DateTimeFormat>();

/** One cached formatter per zone that names it ("MST"); Intl throws a RangeError for a zone it doesn't know. */
function namer(zone: string): Intl.DateTimeFormat {
  const cached = namers.get(zone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
  namers.set(zone, made);
  return made;
}

/** "-07:00" from an offset in minutes. */
function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Whether a text is a moment with its zone mark (`Z` or `±hh:mm`). */
export function isMarkedMoment(text: string): boolean {
  return MARKED.test(text);
}

/** Whether a text is a moment in either form, as opposed to a calendar date or anything else. */
export function isMoment(text: string): boolean {
  return MARKED.test(text) || WALL.test(text);
}

/**
 * A moment read on a zone's clock (ADR 0064), or null when the text is not a moment (a calendar date,
 * empty, malformed) or Intl doesn't know the zone. A wall time the clocks show twice, when they go
 * back, is the earlier instant, as `zonedToInstantLenient` reads it.
 */
export function momentInZone(text: string, zone: string): ZonedMoment | null {
  try {
    let instant: Date | null;
    let wall: string;
    if (MARKED.test(text)) {
      instant = new Date(text);
      if (Number.isNaN(instant.getTime())) return null;
      wall = instantToZoned(instant, zone);
    } else if (WALL.test(text)) {
      wall = text.slice(0, 16);
      instant = zonedToInstantLenient(wall, zone);
      if (!instant) return null;
    } else {
      return null;
    }
    const minute = Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
    const offset = Math.round((Date.parse(`${wall}:00Z`) - minute) / MINUTE_MS);
    const abbreviation =
      namer(zone)
        .formatToParts(instant)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    return { wall, instant, abbreviation, offset: offsetText(offset) };
  } catch {
    return null;
  }
}

/** "7:56 AM" from a wall time "YYYY-MM-DDTHH:mm": 12-hour, as en-US reads a clock (ADR 0064). */
export function clockText(wall: string): string {
  const hour = Number(wall.slice(11, 13));
  const minute = wall.slice(14, 16);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

/** "Nov 21, 2026" from a calendar date "YYYY-MM-DD", for text made without the company's date format (emails). */
export function calendarDateText(day: string): string {
  const month = MONTHS[Number(day.slice(5, 7)) - 1] ?? "";
  return `${month} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`;
}

/**
 * "Nov 21, 2026, 7:56 AM MST": a moment on a zone's clock with the zone named, for text made where no
 * company date format applies (emails, notices). A text that is not a moment is returned unchanged.
 */
export function momentText(text: string, zone: string): string {
  const moment = momentInZone(text, zone);
  if (!moment) return text;
  return `${calendarDateText(moment.wall.slice(0, 10))}, ${clockText(moment.wall)} ${moment.abbreviation}`.trim();
}

/**
 * A moment as ISO 8601 with the zone's offset, "2026-11-21T07:56:00-07:00", for exports (ADR 0064):
 * a spreadsheet keeps the exact instant and still reads the company's clock. A text that is not a
 * moment is returned unchanged.
 */
export function momentIso(text: string, zone: string): string {
  const moment = momentInZone(text, zone);
  if (!moment) return text;
  const seconds = String(moment.instant.getUTCSeconds()).padStart(2, "0");
  return `${moment.wall}:${seconds}${moment.offset}`;
}

/**
 * A moment as an instant with its mark. A legacy wall time with no mark that the API wrote into a JSON
 * column before ADR 0064 (a timesheet's history, a contract's signature) was UTC minutes, so it is
 * read as UTC; anything else is returned unchanged. Stored rows are never rewritten for this.
 */
export function utcMinuteAsInstant(text: string): string {
  return WALL.test(text) && !MARKED.test(text) ? `${text.slice(0, 16)}:00.000Z` : text;
}
