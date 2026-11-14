import { describe, expect, it } from "vitest";
import {
  bonusesInRun,
  contractorPaymentPosting,
  DEFAULT_ACCOUNTS,
  payableEmployees,
  payrollPosting,
  payRunBlockers,
  postingProblem,
  reversedLines,
  totals,
  weekEndsIn,
  type Bonus,
  type Employee,
  type Timesheet,
} from "../src";

const sides = (lines: { account: string; debit: string; credit: string; locationId: string | null }[]) =>
  lines.map((entry) => [entry.account, entry.debit, entry.credit, entry.locationId]);

const run = { sourceId: "run-1", period: { start: "2026-10-19", end: "2026-11-01" } };

/** Payroll postings (hr.md "Pay periods"; ADR 0047). */
describe("payroll postings", () => {
  it("adds Contract Labor to the default chart, as an expense next to Wages", () => {
    expect(DEFAULT_ACCOUNTS.find((a) => a.key === "contract_labor")).toMatchObject({ code: "6050", type: "expense" });
    expect(new Set(DEFAULT_ACCOUNTS.map((a) => a.code)).size).toBe(DEFAULT_ACCOUNTS.length);
  });

  it("debits Wages per home location and credits Accrued Payroll for the total, dated the period's end", () => {
    const draft = payrollPosting(run, [
      { grossPay: "1225.00", locationId: "loc-b" },
      { grossPay: "800.10", locationId: "loc-a" },
      { grossPay: "99.90", locationId: "loc-a" },
      { grossPay: "500.00", locationId: null },
    ]);
    expect(draft).toMatchObject({
      event: "payroll.approved",
      sourceType: "pay_period",
      sourceId: "run-1",
      date: "2026-11-01",
    });
    expect(sides(draft.lines)).toEqual([
      ["wages", "500.00", "0.00", null],
      ["wages", "900.00", "0.00", "loc-a"],
      ["wages", "1225.00", "0.00", "loc-b"],
      ["accrued_payroll", "0.00", "2625.00", null],
    ]);
    expect(postingProblem(draft.lines)).toBeNull();
    // Each person's pay is folded into their location, so the ledger lists no one's pay.
    expect(draft.memo).not.toMatch(/\d{3}\.\d{2}/);
  });

  it("leaves out people with no pay and posts nothing for a run with none", () => {
    const draft = payrollPosting(run, [
      { grossPay: "0.00", locationId: "loc-a" },
      { grossPay: "250.00", locationId: "loc-a" },
    ]);
    expect(sides(draft.lines)).toEqual([
      ["wages", "250.00", "0.00", "loc-a"],
      ["accrued_payroll", "0.00", "250.00", null],
    ]);
    expect(payrollPosting(run, [{ grossPay: "0.00", locationId: null }]).lines).toEqual([]);
    expect(payrollPosting(run, []).lines).toEqual([]);
  });

  it("balances for every mix of amounts and locations, and its reversal balances too", () => {
    const locations = [null, "loc-a", "loc-b", "loc-c"];
    for (let n = 1; n <= 40; n++) {
      const lines = Array.from({ length: n }, (_, i) => {
        const cents = (i * 7919 + n * 104729) % 500000;
        return {
          grossPay: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
          locationId: locations[(i + n) % locations.length]!,
        };
      });
      const draft = payrollPosting(run, lines);
      expect(postingProblem(draft.lines), `case ${n}`).toBeNull();
      expect(postingProblem(reversedLines(draft.lines)), `reversal ${n}`).toBeNull();
      const sums = totals(draft.lines);
      expect(sums.debit.eq(sums.credit)).toBe(true);
    }
  });

  it("pays a contractor from the bank account for the method, into Contract Labor", () => {
    const payment = { id: "cp-1", amount: "436.34", description: "Placement fee" };
    for (const cash of ["cash", "bank:0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"] as const) {
      const draft = contractorPaymentPosting(payment, "2026-11-14", cash);
      expect(draft).toMatchObject({
        event: "contractor_payment.paid",
        sourceType: "contractor_payment",
        sourceId: "cp-1",
        date: "2026-11-14",
      });
      expect(sides(draft.lines)).toEqual([
        ["contract_labor", "436.34", "0.00", null],
        [cash, "0.00", "436.34", null],
      ]);
      expect(postingProblem(draft.lines)).toBeNull();
      expect(postingProblem(reversedLines(draft.lines))).toBeNull();
    }
    expect(contractorPaymentPosting({ ...payment, amount: "0.00" }, "2026-11-14", "cash").lines).toEqual([]);
  });
});

const person = (patch: Partial<Employee>) =>
  ({
    id: "e1",
    name: "Pat",
    workerType: "w2",
    payType: "hourly",
    payRate: "20.00",
    state: "TX",
    flsaStatus: "non_exempt",
    status: "active",
    hiredAt: "2024-01-01",
    salaryHoursPerWeek: 40,
    ...patch,
  }) as Employee;

/** Who is in a run and what stops it (hr.md rule 15 and "Pay periods"). */
describe("pay runs", () => {
  const period = { start: "2026-10-19", end: "2026-11-01" };

  it("pays W-2 people hired by the period's end who have not left", () => {
    const people = [
      person({ id: "a" }),
      person({ id: "b", workerType: "1099", flsaStatus: "not_applicable" }),
      person({ id: "c", status: "terminated" }),
      person({ id: "d", hiredAt: "2026-11-02" }),
      person({ id: "e", status: "on_leave" }),
    ];
    expect(payableEmployees(people, period).map((e) => e.id)).toEqual(["a", "e"]);
  });

  it("blocks on every week ending in the period that is not approved, unless the person is left out", () => {
    expect(weekEndsIn(period, 1)).toEqual(["2026-10-25", "2026-11-01"]);
    const people = [person({ id: "a" }), person({ id: "b" }), person({ id: "x", flsaStatus: "exempt" })];
    const sheets: Pick<Timesheet, "employeeId" | "weekStart" | "status">[] = [
      { employeeId: "a", weekStart: "2026-10-19", status: "approved" },
      { employeeId: "a", weekStart: "2026-10-26", status: "submitted" },
      { employeeId: "b", weekStart: "2026-10-19", status: "approved" },
      { employeeId: "b", weekStart: "2026-10-26", status: "approved" },
    ];
    expect(payRunBlockers(period, people, sheets, new Set(), 1)).toEqual([
      { employeeId: "a", employeeName: "Pat", weekStart: "2026-10-26", status: "submitted" },
    ]);
    expect(payRunBlockers(period, people, sheets, new Set(["a"]), 1)).toEqual([]);
    // A missing sheet blocks, unless the week ended before the hire date.
    const late = person({ id: "n", hiredAt: "2026-10-26" });
    expect(payRunBlockers(period, [late], [], new Set(), 1)).toEqual([
      { employeeId: "n", employeeName: "Pat", weekStart: "2026-10-26", status: "missing" },
    ]);
  });

  it("joins a bonus to the run where its own period ends", () => {
    const bonus = (id: string, periodEnd: string) =>
      ({ id, employeeId: "a", amount: "100.00", kind: "production", periodStart: "2026-10-01", periodEnd }) as Bonus;
    const list = [bonus("in", "2026-11-01"), bonus("before", "2026-10-18"), bonus("after", "2026-11-02")];
    expect(bonusesInRun(list, "a", period).map((b) => b.id)).toEqual(["in"]);
    expect(bonusesInRun(list, "b", period)).toEqual([]);
  });
});
