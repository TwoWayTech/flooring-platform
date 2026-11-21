/**
 * A statement month (YYYY-MM) in words, "2026-10" as "October 2026", for the month picker and the
 * statement title (click-through #49). Read at mid-month in UTC, so no time zone moves it.
 */
export function monthName(month: string): string {
  return new Date(`${month}-15T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
