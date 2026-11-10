/** A public holiday on the company's calendar. */
export interface Holiday {
  date: string;
  name: string;
}

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** The date of the nth given weekday of a month (n = 1 for first; 0 = Sunday). */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return iso(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/** The date of the last given weekday of a month. */
function lastWeekday(year: number, month: number, weekday: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0));
  const back = (lastDay.getUTCDay() - weekday + 7) % 7;
  return iso(year, month, lastDay.getUTCDate() - back);
}

/** The US federal holidays of a year (US pack), as a starting list each company can edit. */
export function federalHolidays(year: number): Holiday[] {
  return [
    { date: iso(year, 1, 1), name: "New Year's Day" },
    { date: nthWeekday(year, 1, 1, 3), name: "Martin Luther King Jr. Day" },
    { date: nthWeekday(year, 2, 1, 3), name: "Presidents' Day" },
    { date: lastWeekday(year, 5, 1), name: "Memorial Day" },
    { date: iso(year, 6, 19), name: "Juneteenth" },
    { date: iso(year, 7, 4), name: "Independence Day" },
    { date: nthWeekday(year, 9, 1, 1), name: "Labor Day" },
    { date: iso(year, 11, 11), name: "Veterans Day" },
    { date: nthWeekday(year, 11, 4, 4), name: "Thanksgiving Day" },
    { date: iso(year, 12, 25), name: "Christmas Day" },
  ];
}
