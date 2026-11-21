import { clockText, momentInZone } from "@workspace/shared";
import { format, parseISO } from "date-fns";

/** The browser's own IANA zone: the platform console's, which belongs to no company (ADR 0064). */
export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** How `formatWhen` writes a value. */
export interface WhenOptions {
  /** The date-fns pattern of the date part: the company's date format (Settings → Localization, Region). */
  pattern: string;
  /** The IANA zone moments are shown in: the company's, or the browser's on the platform console. */
  zone: string;
  /** Whether a moment also shows its time and its zone, "Nov 21, 2026, 7:56 AM MST". */
  withTime?: boolean;
}

/**
 * The one formatter for dates and moments on screens and documents (ADR 0064). A calendar date
 * "YYYY-MM-DD" (a due date, a period) is written as it is and never shifted. A moment is read on
 * `zone`'s clock first, so its date is the company's day, and with `withTime` it shows a 12-hour time
 * and names the zone, as the audit log, the Outbox and the clock need (click-through #57, #66).
 * A moment with its mark is an instant; one without is already that zone's wall time (DemoStore).
 */
export function formatWhen(text: string, { pattern, zone, withTime = false }: WhenOptions): string {
  const moment = momentInZone(text, zone);
  if (!moment) return format(parseISO(text), pattern);
  const day = format(parseISO(moment.wall.slice(0, 10)), pattern);
  return withTime ? `${day}, ${clockTime(moment.wall, moment.abbreviation)}` : day;
}

/**
 * "7:04 AM MST": a moment's time alone on `zone`'s clock, with the zone named (the portal's
 * "Clocked in at", click-through #66). A text that is not a moment is returned unchanged.
 */
export function formatClockTime(text: string, zone: string): string {
  const moment = momentInZone(text, zone);
  return moment ? clockTime(moment.wall, moment.abbreviation) : text;
}

function clockTime(wall: string, abbreviation: string): string {
  return `${clockText(wall)} ${abbreviation}`.trim();
}
