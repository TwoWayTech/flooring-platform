import { dec, maxDec, minDec, type Dec } from "../money";

/**
 * Overtime rules from the US pack (spec section 1, ADR 0024). Federal: hours over 40 in a workweek
 * are overtime. California example: hours over 8 in a day are overtime and over 12 are double
 * time, the first 8 hours of a seventh consecutive day are overtime and the rest double time, and
 * the weekly 40-hour rule still applies to the remaining regular hours.
 */
export type OvertimeRule = "federal" | "california";

/** Labels for the overtime rule options in Payroll settings. */
export const OVERTIME_RULE_LABELS: Record<OvertimeRule, string> = {
  federal: "Federal: over 40 hours per week",
  california: "California: daily over 8 h, double over 12 h, seventh day, plus weekly 40",
};

/** Hours split into pay buckets, as decimal strings (CLAUDE.md rule 6). */
export interface OvertimeSplit {
  regular: string;
  overtime: string;
  doubleTime: string;
  /** Indexes of days that crossed a daily threshold, for flagging in the grid. */
  flaggedDays: number[];
}

/** One day's hours as `splitOvertime` takes them: a decimal string or a Decimal, never a float. */
export type HoursInput = string | Dec;

const WEEKLY_LIMIT = dec(40);
const DAILY_LIMIT = dec(8);
const DOUBLE_FROM = dec(12);
const ZERO = dec(0);

/**
 * Splits a workweek of daily hours (first day = the company's workweek start) into regular,
 * overtime and double time, computed with decimal.js so quarter hours stay exact (CLAUDE.md
 * rule 6; fourth security review of PR #25).
 */
export function splitOvertime(days: readonly HoursInput[], rule: OvertimeRule): OvertimeSplit {
  const hours = days.map((h) => dec(h));
  if (rule === "federal") {
    const total = hours.reduce((a, b) => a.plus(b), ZERO);
    const overtime = maxDec(total.minus(WEEKLY_LIMIT), 0);
    return split(total.minus(overtime), overtime, ZERO, []);
  }
  let regular = ZERO;
  let overtime = ZERO;
  let doubleTime = ZERO;
  const flaggedDays: number[] = [];
  // The seventh-day rule needs work on all seven days of the workweek (ADR 0024, DLSE reading).
  const sevenDays = hours.length === 7 && hours.every((h) => h.gt(0));
  hours.forEach((h, i) => {
    if (sevenDays && i === 6) {
      overtime = overtime.plus(minDec(h, DAILY_LIMIT));
      doubleTime = doubleTime.plus(maxDec(h.minus(DAILY_LIMIT), 0));
      flaggedDays.push(i);
      return;
    }
    const dailyRegular = minDec(h, DAILY_LIMIT);
    const dailyOt = minDec(maxDec(h.minus(DAILY_LIMIT), 0), DOUBLE_FROM.minus(DAILY_LIMIT));
    const dailyDouble = maxDec(h.minus(DOUBLE_FROM), 0);
    if (h.gt(DAILY_LIMIT)) flaggedDays.push(i);
    // Regular hours past the weekly limit become overtime too.
    const roomLeft = maxDec(WEEKLY_LIMIT.minus(regular), 0);
    regular = regular.plus(minDec(dailyRegular, roomLeft));
    overtime = overtime.plus(dailyOt).plus(maxDec(dailyRegular.minus(roomLeft), 0));
    doubleTime = doubleTime.plus(dailyDouble);
  });
  return split(regular, overtime, doubleTime, flaggedDays);
}

function split(regular: Dec, overtime: Dec, doubleTime: Dec, flaggedDays: number[]): OvertimeSplit {
  return { regular: regular.toString(), overtime: overtime.toString(), doubleTime: doubleTime.toString(), flaggedDays };
}

/**
 * The overtime rule for one worker: California's daily rule follows the work state, so a
 * California worker gets it whatever the company default is (US pack example).
 */
export function overtimeRuleFor(workState: string, companyRule: OvertimeRule): OvertimeRule {
  return workState === "CA" ? "california" : companyRule;
}
