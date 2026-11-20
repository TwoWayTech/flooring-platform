import { payFrequencyProblem } from "../hr/pay";
import type { Employee, PayPeriod } from "../types/hr";
import type { HrSettings } from "../types/settings";

// Settings → HR (ADR 0059, part 5; hr.md "HrSettings"): the content rules both modes run, and the
// schedule lock that keeps pay periods and workweeks from being re-cut under recorded pay.

/** The pay frequencies Settings → HR offers (hr.md rule 14, `periodFor`). */
export const PAY_FREQUENCIES: readonly PayPeriod["frequency"][] = ["weekly", "biweekly", "semimonthly", "monthly"];

/** The most holidays one company lists: ten federal days a year for several years, with room for its own. */
export const HOLIDAYS_MAX = 100;

/** The longest holiday name, once trimmed. */
export const HOLIDAY_NAME_MAX = 80;

/** What Settings → HR says about each thing it refuses, the same words in both modes (ADR 0059, part 5, D2 and D4). */
export const HR_MESSAGES = {
  workweekStartDay: "Choose the day the workweek starts, Sunday to Saturday.",
  payFrequency: "Choose how often people are paid: weekly, every two weeks, twice a month or monthly.",
  payPeriodAnchor: "The day pay periods count from must be a real date, such as 2026-01-05.",
  holidays: `Keep the holiday list to ${HOLIDAYS_MAX} days or fewer.`,
  holidayDate: "Enter each holiday's date as a real date, such as 2026-12-25.",
  holidayName: `Give each holiday a name of up to ${HOLIDAY_NAME_MAX} characters.`,
  holidayTwice: "List each holiday date once.",
  switches: "Choose on or off for each employee and clock setting.",
  scheduleLocked:
    "The pay frequency and the day pay periods count from can't change once a pay period exists, because each day must be paid in exactly one pay period.",
  workweekLocked:
    "The workweek start can't change once hours are recorded or a pay period exists, because overtime is worked out per fixed workweek.",
} as const;

/**
 * Settings → HR as a save sends it, before `hrSettingsProblem` has checked it: the pay frequency as
 * plain text (ADR 0059, part 5). The stored type is assignable to it.
 */
export type HrSettingsInput = Omit<HrSettings, "payFrequency"> & { payFrequency: string };

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a text is a real calendar day written yyyy-MM-dd, in 2000 to 2099: the years a pay
 * calendar or holiday list can mean, so no date sum in `periodFor` leaves four digits.
 */
function realDay(text: unknown): boolean {
  if (typeof text !== "string" || !DAY_TEXT.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return false;
  const year = parsed.getUTCFullYear();
  return year >= 2000 && year <= 2099;
}

/** Why the holiday list can't be saved, or null: bounded, each a real day with a name, each date once. */
function holidaysProblem(holidays: HrSettingsInput["holidays"]): string | null {
  if (!Array.isArray(holidays) || holidays.length > HOLIDAYS_MAX) return HR_MESSAGES.holidays;
  const seen = new Set<string>();
  for (const holiday of holidays) {
    if (!realDay(holiday.date)) return HR_MESSAGES.holidayDate;
    const name = typeof holiday.name === "string" ? holiday.name.trim() : "";
    if (name === "" || name.length > HOLIDAY_NAME_MAX) return HR_MESSAGES.holidayName;
    if (seen.has(holiday.date)) return HR_MESSAGES.holidayTwice;
    seen.add(holiday.date);
  }
  return null;
}

/**
 * Why Settings → HR can't be saved, or null (hr.md "HrSettings"; ADR 0059, part 5, D2): the workweek
 * a whole day 0 (Sunday) to 6, designated because the law needs it (ADR 0024); a known pay
 * frequency; the anchor weekly and biweekly periods count from a real day (rule 14); the holidays
 * well formed and each date once; the five switches on or off. Names are checked trimmed and stored
 * as sent. Judges the value alone: what recorded pay forbids is `hrScheduleProblem`'s.
 */
export function hrSettingsProblem(hr: HrSettingsInput): string | null {
  const day = hr.workweekStartDay;
  if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) return HR_MESSAGES.workweekStartDay;
  if (!(PAY_FREQUENCIES as readonly string[]).includes(hr.payFrequency)) return HR_MESSAGES.payFrequency;
  if (!realDay(hr.payPeriodAnchor)) return HR_MESSAGES.payPeriodAnchor;
  const holidays = holidaysProblem(hr.holidays);
  if (holidays) return holidays;
  const switches = [
    hr.showPayToEmployees,
    hr.showCommissionToEmployees,
    hr.showRatesToEmployees,
    hr.showTeamCalendarToEmployees,
    hr.clockEnabled,
  ];
  return switches.every((value) => typeof value === "boolean") ? null : HR_MESSAGES.switches;
}

/** What the company has recorded that fixes its pay calendar: any live pay period, any live timesheet or clock entry. */
export interface HrScheduleFacts {
  payPeriods: boolean;
  hoursRecorded: boolean;
}

/**
 * Why a Settings → HR save would re-cut recorded pay, or null (ADR 0059, part 5, D4; the safest
 * reading of hr.md "Changing the workweek start or pay frequency"). Pay periods are cut from the
 * frequency and the anchor (rule 14) and a day is paid in one period only (ADR 0047), so neither
 * changes once a period exists. Overtime is worked per fixed workweek (ADR 0024; FLSA Fact Sheet 23,
 * 29 CFR 778.104) and timesheets, clock punches and pay runs are cut on it (rule 6), so the start
 * day doesn't change once any exists. `current` is the stored section (it may lack fields) or
 * undefined when never saved, when every field counts as changed. The API judges it under the `hr`
 * row's lock, the lock opening a pay period takes.
 */
export function hrScheduleProblem(
  next: HrSettings,
  current: Partial<HrSettings> | undefined,
  facts: HrScheduleFacts,
): string | null {
  if (next.workweekStartDay !== current?.workweekStartDay && (facts.hoursRecorded || facts.payPeriods))
    return HR_MESSAGES.workweekLocked;
  const scheduleChanged =
    next.payFrequency !== current?.payFrequency || next.payPeriodAnchor !== current?.payPeriodAnchor;
  return scheduleChanged && facts.payPeriods ? HR_MESSAGES.scheduleLocked : null;
}

/**
 * Why a change of pay frequency can't be saved, or null: monthly can't serve California non-exempt
 * staff (hr.md rule 16, `payFrequencyProblem`; on whatever the California switch says, ADR 0050).
 * Judged only when the frequency changes, so a company already on monthly can still save its
 * holidays and switches; approving a run still refuses it (ADR 0059, part 5, D5).
 */
export function hrFrequencyProblem(
  next: HrSettings,
  current: Partial<HrSettings> | undefined,
  employees: readonly Pick<Employee, "state" | "flsaStatus" | "status">[],
): string | null {
  return next.payFrequency === current?.payFrequency ? null : payFrequencyProblem(next.payFrequency, employees);
}
