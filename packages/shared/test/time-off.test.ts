import { describe, expect, it } from "vitest";
import {
  accrualFor,
  californiaPolicyProblem,
  dec,
  pendingHours,
  timeOffBalance,
  timeOffProblem,
  type PtoRequest,
  type TimeOffEntry,
  type TimeOffPolicy,
} from "../src";

const policy = (patch: Partial<TimeOffPolicy> = {}): TimeOffPolicy =>
  ({
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
  }) as TimeOffPolicy;
const entry = (hours: string, employeeId = "e"): TimeOffEntry => ({
  id: hours,
  employeeId,
  policyId: "p",
  date: "2026-01-01",
  kind: "accrual",
  hours,
  note: "",
  requestId: null,
  payPeriodId: null,
});

describe("time off (spec C1, ADR 0024)", () => {
  it("a balance is the sum of the ledger for that person and policy", () => {
    expect(timeOffBalance([entry("40"), entry("-8"), entry("99", "other")], "e", "p").toString()).toBe("32");
  });

  it("counts only waiting requests as pending", () => {
    const requests = [
      { employeeId: "e", policyId: "p", status: "pending", hours: "8" },
      { employeeId: "e", policyId: "p", status: "approved", hours: "16" },
    ] as PtoRequest[];
    expect(pendingHours(requests, "e", "p").toString()).toBe("8");
  });

  it("accrues per pay period and per hour worked", () => {
    expect(accrualFor(policy(), dec(10), "80").toString()).toBe("3.08");
    expect(
      accrualFor(policy({ accrualMethod: "per_hour_worked", accrualRate: "0.05" }), dec(10), "80").toString(),
    ).toBe("4");
    expect(accrualFor(policy({ accrualMethod: "annual_grant" }), dec(10), "80").toString()).toBe("0");
  });

  it("pauses at the cap and never takes hours back", () => {
    expect(accrualFor(policy(), dec(119), "80").toString()).toBe("1");
    expect(accrualFor(policy(), dec(120), "80").toString()).toBe("0");
    expect(accrualFor(policy(), dec(150), "80").toString()).toBe("0");
    expect(accrualFor(policy({ capHours: "" }), dec(500), "80").toString()).toBe("3.08");
  });

  const ask = (hours: string, balance: string, pending = "0", p = policy()) =>
    timeOffProblem({
      start: "2026-06-01",
      end: "2026-06-02",
      hours,
      policy: p,
      balance: dec(balance),
      pending: dec(pending),
    });

  it("refuses more than the balance, counting what is already waiting", () => {
    expect(ask("16", "40")).toBeNull();
    expect(ask("16", "20", "8")).toMatch(/12 hours left/);
  });

  it("lets unpaid leave and an allowed negative balance through", () => {
    expect(ask("80", "0", "0", policy({ kind: "unpaid" }))).toBeNull();
    expect(ask("80", "0", "0", policy({ allowNegative: true }))).toBeNull();
  });

  it("refuses dates in the wrong order and no hours", () => {
    expect(
      timeOffProblem({
        start: "2026-06-02",
        end: "2026-06-01",
        hours: "8",
        policy: policy(),
        balance: dec(40),
        pending: dec(0),
      }),
    ).toMatch(/last day/);
    expect(ask("0", "40")).toMatch(/how many hours/);
  });

  it("California guard: vacation can have a cap but no carryover limit; sick leave can", () => {
    expect(californiaPolicyProblem({ kind: "vacation", carryoverHours: "40" })).toMatch(/California/);
    expect(californiaPolicyProblem({ kind: "personal", carryoverHours: "8" })).toMatch(/California/);
    expect(californiaPolicyProblem({ kind: "vacation", carryoverHours: "" })).toBeNull();
    expect(californiaPolicyProblem({ kind: "sick", carryoverHours: "40" })).toBeNull();
  });
});
