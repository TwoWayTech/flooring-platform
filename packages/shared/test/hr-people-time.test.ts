import { describe, expect, it } from "vitest";
import {
  approvedHoursInYear,
  clockedHours,
  dec,
  seesPersonRecords,
  timeOffRequestProblem,
  withClockedHours,
  type PtoRequest,
  type TimeOffPolicy,
} from "../src";

const policy = (patch: Partial<TimeOffPolicy> = {}): TimeOffPolicy => ({
  id: "p",
  name: "Vacation",
  kind: "vacation",
  paid: true,
  accrualMethod: "per_pay_period",
  accrualRate: "3.08",
  capHours: "120",
  annualUseLimitHours: "",
  carryoverHours: "",
  waitingPeriodDays: 0,
  allowNegative: false,
  ...patch,
});

const employee = { workerType: "w2" as const, flsaStatus: "non_exempt" as const, hiredAt: "2026-01-05" };

const ask = (patch: Partial<Parameters<typeof timeOffRequestProblem>[0]> = {}) =>
  timeOffRequestProblem({
    employee,
    policy: policy(),
    start: "2026-06-01",
    end: "2026-06-01",
    hours: "8",
    balance: dec(40),
    pending: dec(0),
    approvedThisYear: dec(0),
    ...patch,
  });

describe("who sees a person's HR records (hr.md data scope, ownOrReports)", () => {
  const person = { id: "e2", managerId: "e1" };

  it("lets scope all see everyone, linked or not", () => {
    expect(seesPersonRecords("all", null, person)).toBe(true);
  });

  it("lets own scope see only the viewer's own records", () => {
    expect(seesPersonRecords("own", "e2", person)).toBe(true);
    expect(seesPersonRecords("own", "e1", person)).toBe(false);
  });

  it("adds direct reports at branch scope, not reports of reports", () => {
    expect(seesPersonRecords("branch", "e1", person)).toBe(true);
    expect(seesPersonRecords("branch", "e0", person)).toBe(false);
  });

  it("shows nothing below scope all to someone with no employee link", () => {
    expect(seesPersonRecords("branch", null, { id: "e2", managerId: null })).toBe(false);
    expect(seesPersonRecords("own", null, person)).toBe(false);
  });
});

describe("time-off request checks (hr.md rule 11)", () => {
  it("accepts a request the balance covers", () => {
    expect(ask()).toBeNull();
  });

  it("refuses a 1099 worker first", () => {
    expect(ask({ employee: { ...employee, workerType: "1099" } })).toMatch(/Contractors/);
  });

  it("refuses more than the balance less what is pending", () => {
    expect(ask({ hours: "16", balance: dec(20), pending: dec(8) })).toMatch(/12 hours left/);
  });

  it("refuses a request inside the waiting period, counted from the hire date", () => {
    const waiting = policy({ waitingPeriodDays: 90 });
    expect(ask({ policy: waiting, start: "2026-04-04", end: "2026-04-04" })).toMatch(/after 90 days/);
    expect(ask({ policy: waiting, start: "2026-04-05", end: "2026-04-05" })).toBeNull();
  });

  it("refuses past the yearly use limit, counting approved hours", () => {
    const limited = policy({ annualUseLimitHours: "24" });
    expect(ask({ policy: limited, approvedThisYear: dec(16) })).toBeNull();
    expect(ask({ policy: limited, approvedThisYear: dec(20) })).toMatch(/limited to 24 hours/);
  });

  it("asks an exempt person to take unpaid leave in full days", () => {
    const unpaid = policy({ kind: "unpaid", paid: false });
    const exempt = { ...employee, flsaStatus: "exempt" as const };
    expect(ask({ employee: exempt, policy: unpaid, hours: "4" })).toMatch(/full days/);
    expect(ask({ employee: exempt, policy: unpaid, end: "2026-06-02", hours: "16" })).toBeNull();
    expect(ask({ policy: unpaid, hours: "4" })).toBeNull();
  });

  it("sums approved hours by the year of their first day", () => {
    const requests = [
      { employeeId: "e", policyId: "p", status: "approved", start: "2026-02-01", hours: "8" },
      { employeeId: "e", policyId: "p", status: "approved", start: "2025-12-31", hours: "8" },
      { employeeId: "e", policyId: "p", status: "pending", start: "2026-03-01", hours: "8" },
      { employeeId: "x", policyId: "p", status: "approved", start: "2026-03-01", hours: "8" },
    ] as PtoRequest[];
    expect(approvedHoursInYear(requests, "e", "p", "2026").toString()).toBe("8");
  });
});

describe("the clock (spec C2)", () => {
  it("rounds clocked time to two decimals and never goes below zero", () => {
    expect(clockedHours("2026-11-02T08:00:00Z", "2026-11-02T16:20:00Z")).toBe(8.33);
    expect(clockedHours("2026-11-02T08:00:00Z", "2026-11-02T07:00:00Z")).toBe(0);
  });

  it("adds hours to one day of the week", () => {
    expect(withClockedHours([1, 2.25, 0, 0, 0, 0, 0], 1, 0.33)).toEqual([1, 2.58, 0, 0, 0, 0, 0]);
  });
});
