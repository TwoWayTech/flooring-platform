import { describe, expect, it } from "vitest";
import { grossPay, payFrequencyProblem, periodFor, splitOvertime, type Employee, type Timesheet } from "../src";

const employee = (patch: Partial<Employee> = {}) =>
  ({
    id: "e1",
    workerType: "w2",
    payType: "hourly",
    payRate: "20.00",
    state: "CO",
    flsaStatus: "non_exempt",
    salaryHoursPerWeek: 40,
    ...patch,
  }) as Employee;
const sheet = (weekStart: string, days: number[], status: Timesheet["status"] = "approved") =>
  ({ id: weekStart, employeeId: "e1", weekStart, days, status }) as Timesheet;
const base = {
  leave: [],
  policies: [],
  companyRule: "federal" as const,
  bonuses: [],
  allocations: [],
  commission: "0",
};
const period = (start: string, end: string, frequency: "weekly" | "semimonthly" | "biweekly" = "weekly") => ({
  start,
  end,
  frequency,
});

describe("gross pay (spec C1 as corrected by ADR 0024, plan N-3)", () => {
  it("example 1: hourly with commission, overtime on the regular rate", () => {
    const line = grossPay({
      ...base,
      employee: employee(),
      period: period("2026-11-02", "2026-11-08"),
      sheets: [sheet("2026-11-02", [10, 10, 10, 8, 8, 0, 0])],
      commission: "230",
      allocations: [{ weekStart: "2026-11-02", amount: "230" }],
    })!;
    expect(line.grossPay).toBe("1225.00");
    expect(line.overtimeTrueUp).toBe("15.00");
    expect(line.overtimePremium).toBe("60.00");
  });

  it("example 2: the same week in California pays daily overtime and double time", () => {
    const line = grossPay({
      ...base,
      employee: employee({ state: "CA" }),
      period: period("2026-11-02", "2026-11-08"),
      sheets: [sheet("2026-11-02", [10, 8, 8, 13, 7, 0, 0])],
      commission: "230",
      allocations: [{ weekStart: "2026-11-02", amount: "230" }],
    })!;
    expect(line.grossPay).toBe("1250.00");
  });

  it("example 3: overtime lands in the period where the workweek ends", () => {
    const sheets = [sheet("2026-12-14", [10, 10, 10, 10, 8, 0, 0])];
    const first = grossPay({
      ...base,
      employee: employee(),
      period: period("2026-12-01", "2026-12-15", "semimonthly"),
      sheets,
    })!;
    const second = grossPay({
      ...base,
      employee: employee(),
      period: period("2026-12-16", "2026-12-31", "semimonthly"),
      sheets,
    })!;
    expect(first.grossPay).toBe("400.00");
    expect(second.grossPay).toBe("640.00");
    expect(first.straddleNote).toMatch(/settled/);
    expect(second.weeks[0]!.straddlesPeriod).toBe(true);
  });

  it("example 4: a monthly commission trues up overtime by the amount per hour", () => {
    const weeks = ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"];
    const allocations = weeks.map((weekStart) => ({ weekStart, amount: "220" }));
    const sheets = weeks.map((w) => sheet(w, [11, 11, 11, 11, 0, 0, 0]));
    const line = grossPay({
      ...base,
      employee: employee(),
      period: period("2026-11-02", "2026-11-29", "biweekly"),
      sheets,
      commission: "880",
      allocations,
    })!;
    expect(line.overtimeTrueUp).toBe("40.00");
  });

  it("leaves 1099 contractors out", () => {
    expect(
      grossPay({
        ...base,
        employee: employee({ workerType: "1099" }),
        period: period("2026-11-02", "2026-11-08"),
        sheets: [],
      }),
    ).toBeNull();
  });

  it("example 6: exempt staff lose full days only", () => {
    const exempt = employee({ payType: "salary", payRate: "62400", flsaStatus: "exempt" });
    const policies = [{ id: "u", paid: false }] as never;
    const fullDay = [
      { policyId: "u", kind: "unpaid", status: "approved", start: "2026-11-03", end: "2026-11-03", hours: "8" },
    ] as never;
    const halfDay = [
      { policyId: "u", kind: "unpaid", status: "approved", start: "2026-11-03", end: "2026-11-03", hours: "4" },
    ] as never;
    const p = period("2026-11-01", "2026-11-15", "semimonthly");
    expect(grossPay({ ...base, employee: exempt, period: p, sheets: [], leave: fullDay, policies })!.grossPay).toBe(
      "2360.00",
    );
    expect(grossPay({ ...base, employee: exempt, period: p, sheets: [], leave: halfDay, policies })!.grossPay).toBe(
      "2600.00",
    );
  });

  it("does not subtract unpaid leave from hourly pay", () => {
    const policies = [{ id: "u", paid: false }] as never;
    const leave = [
      { policyId: "u", kind: "unpaid", status: "approved", start: "2026-11-02", end: "2026-11-02", hours: "8" },
    ] as never;
    const line = grossPay({
      ...base,
      employee: employee(),
      period: period("2026-11-02", "2026-11-08"),
      sheets: [sheet("2026-11-02", [0, 8, 8, 8, 8, 0, 0])],
      leave,
      policies,
    })!;
    expect(line.grossPay).toBe("640.00");
    expect(line.unpaidLeaveHours).toBe("8");
  });

  it("does not count paid leave as hours worked toward overtime", () => {
    const policies = [{ id: "v", paid: true }] as never;
    const leave = [
      { policyId: "v", kind: "vacation", status: "approved", start: "2026-11-02", end: "2026-11-02", hours: "8" },
    ] as never;
    const line = grossPay({
      ...base,
      employee: employee(),
      period: period("2026-11-02", "2026-11-08"),
      sheets: [sheet("2026-11-02", [0, 10, 10, 10, 10, 0, 0])],
      leave,
      policies,
    })!;
    expect(line.overtimeHours).toBe("0");
    expect(line.grossPay).toBe("960.00");
  });

  it("ignores hours not yet approved", () => {
    const line = grossPay({
      ...base,
      employee: employee(),
      period: period("2026-11-02", "2026-11-08"),
      sheets: [sheet("2026-11-02", [8, 8, 8, 8, 8, 0, 0], "submitted")],
    })!;
    expect(line.grossPay).toBe("0.00");
  });
});

/** A week of hours as `splitOvertime` takes them: decimal strings. */
const h = (...days: number[]) => days.map(String);

describe("overtime (spec C1, ADR 0024)", () => {
  it("example 7: the California seventh day", () => {
    expect(splitOvertime(h(8, 8, 8, 8, 8, 8, 10), "california")).toMatchObject({
      regular: "40",
      overtime: "16",
      doubleTime: "2",
    });
  });

  it("the seventh-day rule needs all seven days worked", () => {
    expect(splitOvertime(h(8, 8, 8, 8, 8, 0, 10), "california").doubleTime).toBe("0");
  });

  it("federal counts only the weekly total", () => {
    expect(splitOvertime(h(10, 10, 10, 10, 8, 0, 0), "federal")).toMatchObject({
      regular: "40",
      overtime: "8",
      doubleTime: "0",
    });
  });

  it("federal splits quarter hours exactly, with decimal.js", () => {
    // 5 × 8.25 + 0.1 + 0.2 = 41.55: 40 regular, 1.55 overtime, with no float drift.
    expect(splitOvertime(["8.25", "8.25", "8.25", "8.25", "8.25", "0.1", "0.2"], "federal")).toMatchObject({
      regular: "40",
      overtime: "1.55",
      doubleTime: "0",
    });
  });

  it("California splits decimal days exactly: daily, double time and the weekly 40", () => {
    // 8.25 h days: 0.25 daily overtime each; 12.75 h: 4 overtime and 0.75 double time.
    const r = splitOvertime(["8.25", "8.25", "8.25", "8.25", "12.75", "0", "0"], "california");
    expect(r).toMatchObject({ regular: "40", overtime: "5", doubleTime: "0.75" });
    expect(r.flaggedDays).toEqual([0, 1, 2, 3, 4]);
    // Six 7.75 h days and 0.3 on the seventh: 0.3 seventh-day overtime, plus 6.5 past the weekly 40.
    const seventh = splitOvertime(["7.75", "7.75", "7.75", "7.75", "7.75", "7.75", "0.3"], "california");
    expect(seventh).toMatchObject({ regular: "40", overtime: "6.8", doubleTime: "0" });
  });
});

describe("pay periods (spec C1)", () => {
  it("finds the period holding a date", () => {
    expect(periodFor("2026-11-20", "semimonthly", "2026-01-05")).toEqual({ start: "2026-11-16", end: "2026-11-30" });
    expect(periodFor("2026-11-10", "semimonthly", "2026-01-05")).toEqual({ start: "2026-11-01", end: "2026-11-15" });
    expect(periodFor("2026-02-10", "monthly", "2026-01-05")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodFor("2026-01-20", "biweekly", "2026-01-05")).toEqual({ start: "2026-01-19", end: "2026-02-01" });
    expect(periodFor("2026-01-07", "weekly", "2026-01-05")).toEqual({ start: "2026-01-05", end: "2026-01-11" });
  });

  it("refuses monthly pay for California non-exempt staff", () => {
    expect(payFrequencyProblem("monthly", [employee({ state: "CA", status: "active" })])).toMatch(/California/);
    expect(payFrequencyProblem("biweekly", [employee({ state: "CA", status: "active" })])).toBeNull();
    expect(payFrequencyProblem("monthly", [employee({ state: "CO", status: "active" })])).toBeNull();
  });
});
