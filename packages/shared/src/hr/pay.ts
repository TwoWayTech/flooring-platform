import { addDays } from "../dates";
import { dec, maxDec, moneyString, roundMoney, sum, type Dec } from "../money";
import type {
  Bonus,
  Employee,
  PayPeriod,
  PayPeriodLine,
  PayWeek,
  PtoRequest,
  TimeOffPolicy,
  Timesheet,
} from "../types";
import { overtimeRuleFor, splitOvertime, type OvertimeRule } from "../us-pack/overtime";

/** Pay runs a year per pay frequency. */
export const PERIODS_PER_YEAR: Record<PayPeriod["frequency"], number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

/** Hours a person worked on each date, from their approved timesheets. */
export function hoursByDate(sheets: readonly Timesheet[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const sheet of sheets) {
    if (sheet.status !== "approved") continue;
    sheet.days.forEach((h, i) => out.set(addDays(sheet.weekStart, i), h));
  }
  return out;
}

/** Hours of approved time off on each date, split into paid and unpaid by policy. */
function leaveByDate(
  requests: readonly PtoRequest[],
  policies: readonly TimeOffPolicy[],
): { paid: Map<string, number>; unpaid: Map<string, number> } {
  const paid = new Map<string, number>();
  const unpaid = new Map<string, number>();
  for (const r of requests) {
    if (r.status !== "approved") continue;
    const policy = policies.find((p) => p.id === r.policyId);
    const days = [];
    for (let d = r.start; d <= r.end; d = addDays(d, 1)) days.push(d);
    const each = Number(r.hours) / Math.max(days.length, 1);
    const target = policy?.paid === false || r.kind === "unpaid" ? unpaid : paid;
    for (const d of days) target.set(d, (target.get(d) ?? 0) + each);
  }
  return { paid, unpaid };
}

/** Commission or bonus already earned, spread over the workweek it belongs to (ADR 0024). */
export interface WeekAllocation {
  weekStart: string;
  amount: string;
}

/** What gross pay reads for one employee and one period. */
export interface GrossPayInput {
  employee: Employee;
  period: Pick<PayPeriod, "start" | "end" | "frequency">;
  sheets: readonly Timesheet[];
  leave: readonly PtoRequest[];
  policies: readonly TimeOffPolicy[];
  companyRule: OvertimeRule;
  /** Commission approved for payment in this period (the statements' payable). */
  commission: string;
  bonuses: readonly Bonus[];
  /** Commission and non-discretionary bonus allocated to workweeks, for the overtime true-up. */
  allocations: readonly WeekAllocation[];
}

function sumHours(map: Map<string, number>, start: string, end: string): number {
  let total = 0;
  for (const [date, hours] of map) if (date >= start && date <= end) total += hours;
  return total;
}

const qty = (n: number | Dec | string) => dec(n).toDecimalPlaces(2).toString();

/** A demo sheet's numeric days as the decimal strings `splitOvertime` takes. */
const daysText = (days: readonly number[]) => days.map((h) => String(h));

/**
 * Gross pay for one employee and period (spec C1 as corrected by ADR 0024, plan N-3). Overtime is
 * worked out per workweek and paid in the period the week ends; the premium is on the regular
 * rate, which includes commission and non-discretionary bonuses through the true-up. Hourly staff
 * are paid for hours worked, so unpaid leave is shown but not subtracted. Salaried non-exempt
 * staff lose unpaid hours and earn overtime; exempt staff lose only full unpaid days. Money is
 * rounded to cents once per workweek premium and once per pay line. Returns null for 1099 workers,
 * who are not in a pay period.
 */
export function grossPay(input: GrossPayInput): PayPeriodLine | null {
  const { employee, period, sheets, leave, policies, companyRule, bonuses, allocations } = input;
  if (employee.workerType === "1099") return null;
  const worked = hoursByDate(sheets);
  const { paid, unpaid } = leaveByDate(leave, policies);
  const rule = overtimeRuleFor(employee.state, companyRule);
  const hourly = employee.payType === "hourly";
  const exempt = employee.flsaStatus === "exempt";
  const annual = hourly ? dec(0) : dec(employee.payRate);
  const base = hourly ? dec(employee.payRate) : annual.dividedBy(52).dividedBy(employee.salaryHoursPerWeek || 40);
  const hoursInPeriod = sumHours(worked, period.start, period.end);
  const paidHours = sumHours(paid, period.start, period.end);
  const unpaidHours = sumHours(unpaid, period.start, period.end);

  // Workweeks that END in this period carry their premium here; a week that straddles is flagged.
  const weeks: PayWeek[] = [];
  let premiumTotal = dec(0);
  let otTotal = dec(0);
  let dtTotal = dec(0);
  const bonusWeeks = bonusAllocations(bonuses, sheets, rule);
  const allocated = new Map<string, Dec>();
  for (const a of [...allocations, ...bonusWeeks]) {
    allocated.set(a.weekStart, (allocated.get(a.weekStart) ?? dec(0)).plus(a.amount));
  }
  for (const sheet of sheets) {
    if (sheet.status !== "approved") continue;
    const weekEnd = addDays(sheet.weekStart, 6);
    if (weekEnd < period.start || weekEnd > period.end) continue;
    const split = splitOvertime(daysText(sheet.days), rule);
    const hours = sheet.days.reduce((a, b) => a + b, 0);
    const extra = allocated.get(sheet.weekStart) ?? dec(0);
    const multiplier = dec(split.overtime).times("0.5").plus(split.doubleTime);
    // A salaried non-exempt employee's straight pay is the salary, so overtime hours pay in full.
    const paidMultiplier = hourly ? multiplier : dec(split.overtime).times("1.5").plus(dec(split.doubleTime).times(2));
    const premium = exempt ? dec(0) : roundMoney(paidMultiplier.times(base));
    premiumTotal = premiumTotal.plus(premium);
    otTotal = otTotal.plus(split.overtime);
    dtTotal = dtTotal.plus(split.doubleTime);
    const regularRate = hours === 0 ? base : base.plus(extra.dividedBy(hours));
    weeks.push({
      weekStart: sheet.weekStart,
      weekEnd,
      hoursWorked: qty(hours),
      overtimeHours: qty(split.overtime),
      doubleTimeHours: qty(split.doubleTime),
      allocatedEarnings: moneyString(extra),
      regularRate: regularRate.toDecimalPlaces(4).toString(),
      overtimePremium: moneyString(premium),
      straddlesPeriod: sheet.weekStart < period.start,
    });
  }

  // The true-up covers every week an amount belongs to, including weeks paid in earlier periods.
  let trueUpTotal = exempt ? dec(0) : flatSumPremium(bonuses, sheets, rule);
  for (const [weekStart, extra] of allocated) {
    const sheet = sheets.find((s) => s.status === "approved" && s.weekStart === weekStart);
    if (!sheet || exempt) continue;
    const hours = sheet.days.reduce((a, b) => a + b, 0);
    if (hours === 0) continue;
    const split = splitOvertime(daysText(sheet.days), rule);
    const multiplier = dec(split.overtime).times("0.5").plus(split.doubleTime);
    trueUpTotal = trueUpTotal.plus(roundMoney(multiplier.times(extra.dividedBy(hours))));
  }

  const periods = PERIODS_PER_YEAR[period.frequency];
  let salaryAmount: Dec = dec(0);
  let salaryDeduction: Dec = dec(0);
  let straight: Dec = dec(0);
  let paidLeavePay: Dec = dec(0);
  if (hourly) {
    straight = roundMoney(dec(hoursInPeriod).times(base));
    paidLeavePay = roundMoney(dec(paidHours).times(base));
  } else {
    salaryAmount = roundMoney(annual.dividedBy(periods));
    if (exempt) {
      // Full days only: a partial-day absence never reduces an exempt salary (29 CFR 541.602).
      const fullDays = countFullDays(unpaid, period.start, period.end);
      salaryDeduction = roundMoney(annual.dividedBy(52).dividedBy(5).times(fullDays));
    } else {
      salaryDeduction = roundMoney(dec(unpaidHours).times(base));
    }
  }
  const nonDiscretionary = sum(bonuses.filter((b) => b.kind !== "discretionary").map((b) => b.amount));
  const discretionary = sum(bonuses.filter((b) => b.kind === "discretionary").map((b) => b.amount));
  const gross = maxDec(
    straight
      .plus(paidLeavePay)
      .plus(salaryAmount)
      .minus(salaryDeduction)
      .plus(premiumTotal)
      .plus(input.commission)
      .plus(nonDiscretionary)
      .plus(discretionary)
      .plus(trueUpTotal),
    0,
  );
  const openWeeks = sheets.some(
    (s) => s.status === "approved" && s.weekStart <= period.end && addDays(s.weekStart, 6) > period.end,
  );
  return {
    employeeId: employee.id,
    hoursWorked: qty(hoursInPeriod),
    overtimeHours: qty(otTotal),
    doubleTimeHours: qty(dtTotal),
    paidLeaveHours: qty(paidHours),
    unpaidLeaveHours: qty(unpaidHours),
    baseRate: base.toDecimalPlaces(4).toString(),
    straightTimePay: moneyString(straight),
    overtimePremium: moneyString(premiumTotal),
    paidLeavePay: moneyString(paidLeavePay),
    salaryAmount: moneyString(salaryAmount),
    salaryDeduction: moneyString(salaryDeduction),
    commissionPay: moneyString(input.commission),
    nondiscretionaryBonus: moneyString(nonDiscretionary),
    discretionaryBonus: moneyString(discretionary),
    overtimeTrueUp: moneyString(trueUpTotal),
    grossPay: moneyString(gross),
    straddleNote: openWeeks ? "Overtime in a week that ends next period is settled there." : null,
    weeks,
  };
}

const isFlatSumCa = (b: Bonus, rule: OvertimeRule) => b.kind === "flat_sum" && rule === "california";

const inBonusPeriod = (sheet: Timesheet, b: Bonus) =>
  sheet.status === "approved" && addDays(sheet.weekStart, 6) >= b.periodStart && sheet.weekStart <= b.periodEnd;

const weekHours = (sheet: Timesheet) => sheet.days.reduce((a, b) => a + b, 0);

/** Non-discretionary bonuses spread per hour over the weeks of their period (29 CFR 778.209). */
function bonusAllocations(
  bonuses: readonly Bonus[],
  sheets: readonly Timesheet[],
  rule: OvertimeRule,
): WeekAllocation[] {
  return bonuses
    .filter((b) => b.kind !== "discretionary" && !isFlatSumCa(b, rule))
    .flatMap((b) => {
      const weeks = sheets.filter((s) => inBonusPeriod(s, b));
      const total = weeks.reduce((all, s) => all + weekHours(s), 0);
      if (total === 0) return [];
      return weeks.map((s) => ({
        weekStart: s.weekStart,
        amount: dec(b.amount).times(weekHours(s)).dividedBy(total).toString(),
      }));
    });
}

/** California flat-sum bonus (ADR 0024): amount ÷ maximum legal regular hours × 1.5 or 2 per overtime hour. */
function flatSumPremium(bonuses: readonly Bonus[], sheets: readonly Timesheet[], rule: OvertimeRule): Dec {
  let total = dec(0);
  for (const bonus of bonuses.filter((b) => isFlatSumCa(b, rule))) {
    const weeks = sheets.filter((s) => inBonusPeriod(s, bonus));
    if (weeks.length === 0) continue;
    const perHour = dec(bonus.amount).dividedBy(weeks.length * 40);
    for (const week of weeks) {
      const split = splitOvertime(daysText(week.days), rule);
      total = total.plus(
        roundMoney(dec(split.overtime).times("1.5").plus(dec(split.doubleTime).times(2)).times(perHour)),
      );
    }
  }
  return total;
}

function countFullDays(map: Map<string, number>, start: string, end: string): number {
  let days = 0;
  for (const [date, hours] of map) if (date >= start && date <= end && hours >= 8) days += 1;
  return days;
}

/** The period that holds a date, for each frequency. Biweekly counts from the anchor; all others from the calendar. */
export function periodFor(
  date: string,
  frequency: PayPeriod["frequency"],
  anchor: string,
): { start: string; end: string } {
  if (frequency === "monthly") {
    const start = `${date.slice(0, 7)}-01`;
    return { start, end: lastDayOfMonth(start) };
  }
  if (frequency === "semimonthly") {
    const month = date.slice(0, 7);
    return Number(date.slice(8)) <= 15
      ? { start: `${month}-01`, end: `${month}-15` }
      : { start: `${month}-16`, end: lastDayOfMonth(`${month}-01`) };
  }
  const length = frequency === "weekly" ? 7 : 14;
  const elapsed = Math.floor((Date.parse(date) - Date.parse(anchor)) / 86_400_000);
  const offset = Math.floor(elapsed / length) * length;
  const start = addDays(anchor, offset);
  return { start, end: addDays(start, length - 1) };
}

function lastDayOfMonth(firstDay: string): string {
  const [y, m] = firstDay.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Why a pay frequency cannot be used, or null: monthly cannot serve California non-exempt staff (ADR 0024). */
export function payFrequencyProblem(frequency: PayPeriod["frequency"], employees: readonly Employee[]): string | null {
  if (frequency !== "monthly") return null;
  const blocked = employees.some((e) => e.state === "CA" && e.flsaStatus === "non_exempt" && e.status !== "terminated");
  return blocked ? "California non-exempt staff must be paid at least twice a month." : null;
}
