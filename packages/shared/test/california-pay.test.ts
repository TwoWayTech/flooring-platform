import { describe, expect, it } from "vitest";
import {
  CALIFORNIA_OFF_NOTE,
  CALIFORNIA_PENDING_NOTE,
  californiaPayNote,
  californiaPayOn,
  californiaSalaryHours,
  companyOvertimeRule,
  FEATURES,
  grossPay,
  overtimeRuleFor,
  overtimeRuleProblem,
  payFrequencyProblem,
  californiaPolicyProblem,
  exemptSalaryWarning,
  type Bonus,
  type Employee,
  type FeatureRegister,
  type Timesheet,
} from "../src";

/** The register with the California pay rules switched on, as a reviewed company would have it. */
const on: FeatureRegister = {
  ...FEATURES,
  "hr.payroll.california": { ...FEATURES["hr.payroll.california"], enabled: true },
};

const carla = {
  id: "e1",
  workerType: "w2",
  payType: "hourly",
  payRate: "20.00",
  state: "CA",
  status: "active",
  flsaStatus: "non_exempt",
  salaryHoursPerWeek: 40,
} as Employee;

/** 46 hours with a 10- and a 13-hour day: 6 h federal overtime; 6 h overtime and 1 h double time in California. */
const week = {
  id: "w",
  employeeId: "e1",
  weekStart: "2026-11-02",
  days: [10, 8, 8, 13, 7, 0, 0],
  status: "approved",
} as Timesheet;

const flatSum: Bonus = {
  id: "b1",
  employeeId: "e1",
  amount: "400.00",
  kind: "flat_sum",
  periodStart: "2026-11-02",
  periodEnd: "2026-11-08",
  approvedBy: "u1",
  reason: "Attendance",
};

const pay = (californiaOn: boolean | undefined, bonuses: Bonus[] = []) =>
  grossPay({
    employee: carla,
    period: { start: "2026-11-02", end: "2026-11-08", frequency: "weekly" },
    sheets: [week],
    leave: [],
    policies: [],
    companyRule: "federal",
    commission: "0",
    bonuses,
    allocations: [],
    ...(californiaOn === undefined ? {} : { californiaOn }),
  })!;

describe("California pay rules switch (hr.payroll.california, ADR 0050)", () => {
  it("is off by default and deny by default", () => {
    expect(FEATURES["hr.payroll.california"].enabled).toBe(false);
    expect(californiaPayOn()).toBe(false);
    expect(californiaPayOn(on)).toBe(true);
  });

  it("off: a California worker and a California company rule are on the federal weekly rule", () => {
    expect(overtimeRuleFor("CA", "federal")).toBe("federal");
    expect(overtimeRuleFor("CA", "california", false)).toBe("federal");
    expect(overtimeRuleFor("FL", "california", false)).toBe("federal");
    expect(companyOvertimeRule("california")).toBe("federal");
  });

  it("on: California's daily rule follows the work state, and the company's choice stands", () => {
    expect(overtimeRuleFor("CA", "federal", true)).toBe("california");
    expect(overtimeRuleFor("FL", "california", true)).toBe("california");
    expect(overtimeRuleFor("FL", "federal", true)).toBe("federal");
    expect(companyOvertimeRule("california", true)).toBe("california");
  });

  it("off: a California worker's week pays federal weekly overtime only", () => {
    for (const line of [pay(undefined), pay(false)]) {
      expect(line).toMatchObject({ overtimeHours: "6.00", doubleTimeHours: "0.00", overtimePremium: "60.00" });
      expect(line.grossPay).toBe("980.00");
    }
  });

  it("on: the same week pays daily overtime and double time", () => {
    const line = pay(true);
    expect(line).toMatchObject({ overtimeHours: "6.00", doubleTimeHours: "1.00", overtimePremium: "80.00" });
    expect(line.grossPay).toBe("1000.00");
  });

  it("gates the California flat-sum bonus premium: off, the bonus is spread like any non-discretionary bonus", () => {
    // Off: 400 over 46 hours, half time on 6 overtime hours = 26.09 (29 CFR 778.209).
    const off = pay(false, [flatSum]);
    expect(off.overtimeTrueUp).toBe("26.09");
    expect(off.grossPay).toBe("1406.09");
    // On: 400 ÷ 40 = 10 an hour, × 1.5 on 6 overtime hours and × 2 on 1 double-time hour = 110.
    const caOn = pay(true, [flatSum]);
    expect(caOn.overtimeTrueUp).toBe("110.00");
    expect(caOn.grossPay).toBe("1510.00");
  });

  it("refuses saving California as the company rule while the switch is off, and anything but the two rules", () => {
    expect(overtimeRuleProblem("california")).toMatch(/switched off until a payroll review/);
    expect(overtimeRuleProblem("california", true)).toBeNull();
    expect(overtimeRuleProblem("federal")).toBeNull();
    expect(overtimeRuleProblem("daily", true)).toMatch(/federal or the California/);
    expect(overtimeRuleProblem(undefined)).toMatch(/federal or the California/);
  });

  it("gates the 40-hour California salary", () => {
    expect(californiaSalaryHours("CA")).toBeNull();
    expect(californiaSalaryHours("CA", true)).toBe(40);
    expect(californiaSalaryHours("CO", true)).toBeNull();
  });

  it("notes the rules wherever California plays a part", () => {
    expect(californiaPayNote([carla], "federal", true)).toBe(CALIFORNIA_PENDING_NOTE);
    expect(californiaPayNote([carla], "federal")).toBe(CALIFORNIA_OFF_NOTE);
    expect(californiaPayNote([{ state: "CO", status: "active" }], "california", true)).toBe(CALIFORNIA_PENDING_NOTE);
    expect(californiaPayNote([{ state: "CO", status: "active" }], "california", false)).toBe(CALIFORNIA_OFF_NOTE);
    expect(californiaPayNote([{ state: "CA", status: "terminated" }], "federal", true)).toBeNull();
    expect(californiaPayNote([{ state: "CO", status: "active" }], "federal", true)).toBeNull();
    // Overtime law does not reach 1099 contractors, so a California contractor alone needs no note.
    expect(californiaPayNote([{ state: "CA", status: "active", workerType: "1099" }], "federal")).toBeNull();
    expect(CALIFORNIA_PENDING_NOTE).toBe(
      "California pay rules are pending payroll review — don't use them for real pay.",
    );
  });

  it("keeps the California refusals on with the switch off (owner, 2026-11-14)", () => {
    expect(californiaPayOn()).toBe(false);
    expect(payFrequencyProblem("monthly", [carla])).toMatch(/California/);
    expect(californiaPolicyProblem({ kind: "vacation", carryoverHours: "40" })).toMatch(/California/);
    const exempt = {
      ...carla,
      flsaStatus: "exempt",
      exemptionBasis: "administrative",
      payType: "salary",
      payRate: "60000",
    } as Employee;
    expect(exemptSalaryWarning(exempt, "2026-11-14")).toMatch(/70304/);
  });
});
