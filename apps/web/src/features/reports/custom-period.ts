import { businessPeriodProblem } from "@workspace/shared";

/** A Business report period: its first and last report days, `yyyy-MM-dd`. */
export interface PeriodDays {
  from: string;
  to: string;
}

/**
 * The Business report's Custom dates: what the person typed, the last pair the report is read for,
 * and why the typed pair is refused, if it is (ADR 0055 S8). The report is only ever asked for
 * `applied`, so a pair the API would refuse never leaves the screen and the last figures stay.
 */
export interface CustomPeriod {
  typed: PeriodDays;
  applied: PeriodDays;
  problem: string | null;
}

/** Custom dates that start from one pair, such as 1 January to today (always a period the report takes). */
export function customPeriod(days: PeriodDays): CustomPeriod {
  return { typed: days, applied: days, problem: businessPeriodProblem(days.from, days.to) };
}

/**
 * The Custom dates after the person changes From or To. A pair the report takes (ADR 0055 S8: real
 * days, From on or before To, at most 366 days) becomes the applied period; any other keeps the
 * last applied one and says why, in the API's own words.
 */
export function editCustomPeriod(current: CustomPeriod, change: Partial<PeriodDays>): CustomPeriod {
  const typed = { ...current.typed, ...change };
  const problem = businessPeriodProblem(typed.from, typed.to);
  return { typed, applied: problem ? current.applied : typed, problem };
}
