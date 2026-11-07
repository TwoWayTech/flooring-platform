/**
 * Calendar helpers on ISO strings (YYYY-MM-DD, optionally with a time). All math runs in UTC so
 * a result never drifts by the viewer's time zone.
 */

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to`; positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY_MS);
}

/** Adds days to an ISO date or date-time, keeping any time part unchanged. */
export function addDays(iso: string, days: number): string {
  const date = new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * DAY_MS);
  return date.toISOString().slice(0, 10) + iso.slice(10);
}

/** The Monday on or before an ISO date (weeks start Monday for timesheets). */
export function mondayOf(iso: string): string {
  const weekday = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return addDays(iso.slice(0, 10), -((weekday + 6) % 7));
}

/** The month key YYYY-MM of an ISO date. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** The 12 months ending with the month of `today`, oldest first, as YYYY-MM. */
export function last12Months(today: string): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
