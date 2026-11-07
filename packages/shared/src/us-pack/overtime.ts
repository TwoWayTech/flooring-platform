/**
 * Overtime rules from the US pack (spec section 1). Federal: hours over 40 in a workweek are
 * overtime. California example: hours over 8 in a day are overtime and over 12 are double time,
 * and the weekly 40-hour rule still applies to the remaining regular hours.
 */
export type OvertimeRule = "federal" | "california";

/** Labels for the overtime rule options in Payroll settings. */
export const OVERTIME_RULE_LABELS: Record<OvertimeRule, string> = {
  federal: "Federal: over 40 hours per week",
  california: "California: daily over 8 h, double over 12 h, plus weekly 40",
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

/** Splits a week of daily hours (Monday first) into regular, overtime and double time. */
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
  days.forEach((h, i) => {
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
