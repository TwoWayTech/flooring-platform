import { describe, expect, it } from "vitest";
import {
  earnedInYear,
  ownPayLine,
  ownStatements,
  portalVisibility,
  teamOutView,
  type CommissionStatementRow,
  type Employee,
  type PayPeriodLine,
  type PortalSwitches,
  type PtoRequest,
} from "../src";

const person = (patch: Partial<Employee> = {}) =>
  ({ workerType: "w2", flsaStatus: "non_exempt", status: "active", commissionVisible: null, ...patch }) as Employee;

const allOn: PortalSwitches = {
  showPayToEmployees: true,
  showCommissionToEmployees: true,
  showRatesToEmployees: true,
  showTeamCalendarToEmployees: true,
  clockEnabled: true,
};
const allOff: PortalSwitches = {
  showPayToEmployees: false,
  showCommissionToEmployees: false,
  showRatesToEmployees: false,
  showTeamCalendarToEmployees: false,
  clockEnabled: false,
};

const line = (patch: Partial<PayPeriodLine> = {}) =>
  ({
    employeeId: "e1",
    grossPay: "1405.50",
    commissionPay: "230.00",
    overtimeTrueUp: "11.25",
    ...patch,
  }) as PayPeriodLine;

describe("employee portal rules (employee-portal.md, ADR 0049)", () => {
  it("rule 1: shows pay to W-2 people only, and the clock only to people who fill in timesheets", () => {
    expect(portalVisibility(person(), allOn, true)).toEqual({
      pay: true,
      commission: true,
      rates: true,
      teamCalendar: true,
      clock: true,
    });
    const contractor = portalVisibility(person({ workerType: "1099", flsaStatus: "not_applicable" }), allOn, false);
    expect(contractor).toMatchObject({ pay: false, commission: false, clock: false });
    expect(portalVisibility(person({ flsaStatus: "exempt" }), allOn, false).clock).toBe(false);
    expect(portalVisibility(person({ status: "terminated" }), allOn, false).clock).toBe(false);
    expect(portalVisibility(null, allOn, false)).toMatchObject({ pay: false, commission: false, clock: false });
    expect(portalVisibility(person(), allOff, true)).toEqual({
      pay: false,
      commission: false,
      rates: false,
      teamCalendar: false,
      clock: false,
    });
  });

  it("rule 1: the person's commission setting overrides the company's, and needs a plan", () => {
    expect(portalVisibility(person({ commissionVisible: true }), allOff, true).commission).toBe(true);
    expect(portalVisibility(person({ commissionVisible: false }), allOn, true).commission).toBe(false);
    expect(portalVisibility(person({ commissionVisible: true }), allOn, false).commission).toBe(false);
  });

  it("rule 3: hidden commission and its true-up leave the line and the total, in decimals", () => {
    expect(ownPayLine(line(), true)).toEqual(line());
    expect(ownPayLine(line(), false)).toMatchObject({
      commissionPay: "0.00",
      overtimeTrueUp: "0.00",
      grossPay: "1164.25",
    });
    expect(ownPayLine(line({ grossPay: "0.30", commissionPay: "0.10", overtimeTrueUp: "0.10" }), false).grossPay).toBe(
      "0.10",
    );
  });

  it("rule 5: earned this year adds the gross pay of rows paid in that year", () => {
    const rows = [
      { period: { payDate: "2026-01-05" }, line: { grossPay: "0.10" } },
      { period: { payDate: "2026-12-30" }, line: { grossPay: "0.20" } },
      { period: { payDate: "2025-12-31" }, line: { grossPay: "999.00" } },
    ];
    expect(earnedInYear(rows, "2026")).toBe("0.30");
    expect(earnedInYear([], "2026")).toBe("0.00");
  });

  it("rule 7: lists only the person's own statements with lines or past draft, newest first", () => {
    const row = (userId: string, month: string, status: CommissionStatementRow["status"], lines: number) =>
      ({ userId, month, status, lines: Array.from({ length: lines }, () => ({})) }) as CommissionStatementRow;
    const rows = [
      row("u1", "2026-08", "paid", 0),
      row("u2", "2026-09", "approved", 2),
      row("u1", "2026-09", "draft", 0),
      row("u1", "2026-10", "draft", 1),
    ];
    expect(ownStatements(rows, "u1").map((r) => r.month)).toEqual(["2026-10", "2026-08"]);
  });

  it("rule 10: the team calendar says someone is out, never why or for how long", () => {
    const request: PtoRequest = {
      id: "r1",
      employeeId: "e2",
      policyId: "sick-policy",
      start: "2026-11-02",
      end: "2026-11-03",
      hours: "16",
      kind: "sick",
      status: "approved",
      note: "Surgery",
      decidedBy: "Hana Hartley",
      decidedAt: "2026-10-30T09:00",
      decisionReason: "Get well",
    };
    expect(teamOutView(request)).toEqual({
      id: "r1",
      employeeId: "e2",
      policyId: "",
      start: "2026-11-02",
      end: "2026-11-03",
      hours: "",
      kind: "vacation",
      status: "approved",
      note: "",
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
    });
  });
});
