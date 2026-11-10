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

/** Hours split into pay buckets. */
export interface OvertimeSplit {
  regular: number;
  overtime: number;
  doubleTime: number;
  /** Indexes of days that crossed a daily threshold, for flagging in the grid. */
  flaggedDays: number[];
}

const WEEKLY_LIMIT = 40;

/** Splits a workweek of daily hours (first day = the company's workweek start) into regular, overtime and double time. */
export function splitOvertime(days: readonly number[], rule: OvertimeRule): OvertimeSplit {
  if (rule === "federal") {
    const total = days.reduce((a, b) => a + b, 0);
    const overtime = Math.max(0, total - WEEKLY_LIMIT);
    return { regular: total - overtime, overtime, doubleTime: 0, flaggedDays: [] };
  }
  let regular = 0;
  let overtime = 0;
  let doubleTime = 0;
  const flaggedDays: number[] = [];
  // The seventh-day rule needs work on all seven days of the workweek (ADR 0024, DLSE reading).
  const sevenDays = days.length === 7 && days.every((h) => h > 0);
  days.forEach((h, i) => {
    if (sevenDays && i === 6) {
      overtime += Math.min(h, 8);
      doubleTime += Math.max(h - 8, 0);
      flaggedDays.push(i);
      return;
    }
    const dailyRegular = Math.min(h, 8);
    const dailyOt = Math.min(Math.max(h - 8, 0), 4);
    const dailyDouble = Math.max(h - 12, 0);
    if (h > 8) flaggedDays.push(i);
    // Regular hours past the weekly limit become overtime too.
    const roomLeft = Math.max(WEEKLY_LIMIT - regular, 0);
    regular += Math.min(dailyRegular, roomLeft);
    overtime += dailyOt + Math.max(dailyRegular - roomLeft, 0);
    doubleTime += dailyDouble;
  });
  return { regular, overtime, doubleTime, flaggedDays };
}

/**
 * The overtime rule for one worker: California's daily rule follows the work state, so a
 * California worker gets it whatever the company default is (US pack example).
 */
export function overtimeRuleFor(workState: string, companyRule: OvertimeRule): OvertimeRule {
  return workState === "CA" ? "california" : companyRule;
}
