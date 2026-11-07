import { addDays, daysBetween, mondayOf } from "./dates";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
const MONTH = /^\d{4}-\d{2}$/;

/** How far fixture dates move so the generator's anchor date lands on today. */
export interface DateShift {
  days: number;
  /** Weekly records (timesheets) move by whole weeks so their weeks still start on Monday. */
  weeks: number;
}

/** The shift that maps `anchor` onto `today`. */
export function dateShift(anchor: string, today: string): DateShift {
  return { days: daysBetween(anchor, today), weeks: daysBetween(mondayOf(anchor), mondayOf(today)) / 7 };
}

function shiftString(key: string, value: string, shift: DateShift): string {
  if (key === "weekStart") return addDays(value, shift.weeks * 7);
  if (ISO_DATE.test(value)) return addDays(value, shift.days);
  if (key === "month" && MONTH.test(value)) return addDays(`${value}-15`, shift.days).slice(0, 7);
  return value;
}

/**
 * Returns a deep copy of fixture data with every date moved by the shift, so a demo presented
 * weeks after the fixtures were generated still shows today's jobs and a current aging.
 */
export function shiftDates<T>(value: T, shift: DateShift, key = ""): T {
  if (shift.days === 0 && shift.weeks === 0) return value;
  if (typeof value === "string") return shiftString(key, value, shift) as T;
  if (Array.isArray(value)) return value.map((item) => shiftDates(item, shift, key)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, shift, k)])) as T;
  }
  return value;
}
