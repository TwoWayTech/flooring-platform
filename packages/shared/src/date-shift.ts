import { addDays, daysBetween, mondayOf } from "./dates";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
const MONTH = /^\d{4}-\d{2}$/;

/**
 * Values under these keys move by whole weeks instead of days: timesheet weeks must still start
 * on Monday, and a meeting must keep its weekday so recurring series line up with the calendar.
 */
const WEEKLY_KEYS = new Set(["weekStart", "meetings"]);

/** How far fixture dates move so the generator's anchor date lands on today. */
export interface DateShift {
  days: number;
  /** Whole weeks, for the weekly records listed in WEEKLY_KEYS. */
  weeks: number;
}

/** The shift that maps `anchor` onto `today`. */
export function dateShift(anchor: string, today: string): DateShift {
  return { days: daysBetween(anchor, today), weeks: daysBetween(mondayOf(anchor), mondayOf(today)) / 7 };
}

function shiftString(key: string, value: string, days: number): string {
  if (ISO_DATE.test(value)) return addDays(value, days);
  if (key === "month" && MONTH.test(value)) return addDays(`${value}-15`, days).slice(0, 7);
  return value;
}

/**
 * Returns a deep copy of fixture data with every date moved by the shift, so a demo presented
 * weeks after the fixtures were generated still shows today's jobs and a current aging.
 */
export function shiftDates<T>(value: T, shift: DateShift, key = ""): T {
  const by = WEEKLY_KEYS.has(key) ? { days: shift.weeks * 7, weeks: shift.weeks } : shift;
  if (by.days === 0 && by.weeks === 0) return value;
  if (typeof value === "string") return shiftString(key, value, by.days) as T;
  if (Array.isArray(value)) return value.map((item) => shiftDates(item, by, key)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, by, k)])) as T;
  }
  return value;
}
