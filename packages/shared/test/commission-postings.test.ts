import { describe, expect, it } from "vitest";
import {
  assignmentChanges,
  commissionLines,
  commissionPlanProblem,
  commissionStatementPosting,
  commissionStatementRows,
  DEFAULT_ACCOUNTS,
  frozenThrough,
  hideMarginBase,
  monthEnd,
  payrollPosting,
  postingProblem,
  reversalDecisionProblem,
  reversedLines,
  statementApprovalProblem,
  totals,
  type CommissionInputs,
  type CommissionPlan,
  type CommissionStatement,
  type CommissionStatementRow,
  type Invoice,
  type Payment,
} from "../src";

const sides = (lines: { account: string; debit: string; credit: string; locationId: string | null }[]) =>
  lines.map((entry) => [entry.account, entry.debit, entry.credit, entry.locationId]);

const statement = { id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c", month: "2026-10" };

/** Commission postings (commissions.md rule 11; ADR 0048). */
describe("commission postings", () => {
  it("adds Commissions to the default chart, as an expense next to Wages and Contract Labor", () => {
    expect(DEFAULT_ACCOUNTS.find((a) => a.key === "commissions_expense")).toMatchObject({
      code: "6060",
      name: "Commissions",
      type: "expense",
    });
    expect(new Set(DEFAULT_ACCOUNTS.map((a) => a.code)).size).toBe(DEFAULT_ACCOUNTS.length);
  });

  it("accrues an approved statement's payable: debit Commissions at the home location, credit Accrued Payroll, dated the month's end", () => {
    const draft = commissionStatementPosting(statement, "1234.56", "loc-a");
    expect(draft).toMatchObject({
      event: "commission.approved",
      sourceType: "commission_statement",
      sourceId: statement.id,
      sourceNumber: "CS 2026-10",
      date: "2026-10-31",
      memo: "Commission statement CS-2e3f4a5c, 2026-10",
    });
    expect(sides(draft.lines)).toEqual([
      ["commissions_expense", "1234.56", "0.00", "loc-a"],
      ["accrued_payroll", "0.00", "1234.56", null],
    ]);
    expect(postingProblem(draft.lines)).toBeNull();
    expect(postingProblem(reversedLines(draft.lines))).toBeNull();
    // The memo names the statement, never the person or the amount.
    expect(draft.memo).not.toMatch(/1234/);
  });

  it("posts nothing for a statement with nothing to pay", () => {
    expect(commissionStatementPosting(statement, "0.00", null).lines).toEqual([]);
  });

  it("dates by the month's last day, leap years included", () => {
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
  });

  it("leaves accrued commission out of the run's Wages, so it is expensed once", () => {
    const run = { sourceId: "run-1", period: { start: "2026-11-02", end: "2026-11-15" } };
    const draft = payrollPosting(run, [
      { grossPay: "2500.00", commissionPay: "900.00", locationId: "loc-a" },
      { grossPay: "1000.00", locationId: "loc-a" },
      // A gross pulled below the commission by deductions never posts a negative wage.
      { grossPay: "100.00", commissionPay: "150.00", locationId: "loc-b" },
    ]);
    expect(sides(draft.lines)).toEqual([
      ["wages", "2600.00", "0.00", "loc-a"],
      ["accrued_payroll", "0.00", "2600.00", null],
    ]);
    const statementEntry = commissionStatementPosting(statement, "900.00", "loc-a");
    const all = [...statementEntry.lines, ...draft.lines];
    const sums = totals(all);
    expect(sums.debit.eq(sums.credit)).toBe(true);
    // Accrued Payroll ends at the gross the provider pays: 2600.00 of wages plus 900.00 of commission.
    const accrued = all.filter((l) => l.account === "accrued_payroll").reduce((t, l) => t + Number(l.credit), 0);
    expect(accrued).toBe(3500);
  });
});

const plan = (patch: Partial<CommissionPlan> = {}): CommissionPlan => ({
  id: "p",
  name: "Test",
  version: 1,
  status: "active",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  basis: "paid_revenue",
  baseRatePct: "5",
  monthlyTarget: "100000",
  tierMode: "marginal",
  tiers: [],
  overridePct: "0",
  draw: { kind: "none", monthlyAmount: "0" },
  clawbackDays: 90,
  ...patch,
});

const invoice = (id: string, patch: Partial<Invoice> = {}): Invoice =>
  ({
    id,
    salesRepId: "dana",
    voidedAt: null,
    isReturn: false,
    creditForInvoiceId: null,
    issuedAt: "2026-08-01",
    subtotal: "1000.00",
    cost: "600.00",
    total: "1000.00",
    ...patch,
  }) as Invoice;

const payment = (id: string, invoiceId: string, date: string): Payment =>
  ({
    id,
    invoiceId,
    amount: "1000.00",
    status: "confirmed",
    recordedAt: `${date}T10:00`,
    reviewedAt: null,
    voidedAt: null,
  }) as Payment;

function rowsFor(
  over: Partial<CommissionInputs> = {},
  statements: CommissionStatement[] = [],
): CommissionStatementRow[] {
  const inputs: CommissionInputs = {
    plans: [plan()],
    assignments: [
      {
        id: "a1",
        userId: "dana",
        planId: "p",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        monthlyTargetOverride: null,
        acknowledgement: null,
      },
    ],
    invoices: [invoice("i1"), invoice("i2")],
    payments: [payment("pay-1", "i1", "2026-08-10"), payment("pay-2", "i2", "2026-09-10")],
    adjustments: [],
    managerOf: () => null,
    frozen: new Set(),
    today: "2026-11-14",
    ...over,
  };
  return commissionStatementRows({
    inputs,
    lines: commissionLines(inputs),
    statements,
    adjustments: [],
    nameOf: () => "Dana",
  });
}

const stored = (month: string, status: CommissionStatement["status"]): CommissionStatement => ({
  id: `s-${month}`,
  userId: "dana",
  month,
  status,
  approvedBy: "HR",
  approvedAt: `${month}-28T10:00`,
  payPeriodId: null,
});

/** Statement rules the API and the demo share (commissions.md rules 9 to 14; ADR 0048). */
describe("commission statements", () => {
  it("builds a row per month for everyone on a plan, with figures and status", () => {
    const rows = rowsFor({}, [stored("2026-08", "paid")]);
    expect(rows).toHaveLength(12);
    const august = rows.find((r) => r.month === "2026-08")!;
    expect(august).toMatchObject({ earned: "50.00", payable: "50.00", status: "paid", name: "Dana", monthEnded: true });
    expect(rows.find((r) => r.month === "2026-11")).toMatchObject({ status: "draft", monthEnded: false });
  });

  it("approves only an ended, open month with no review waiting, and earlier months first", () => {
    const rows = rowsFor();
    expect(statementApprovalProblem(rows, "dana", "2026-11", "2026-11-14")).toMatch(/month has ended/);
    expect(statementApprovalProblem(rows, "dana", "2026-09", "2026-11-14")).toMatch(/2026-08 first/);
    expect(statementApprovalProblem(rows, "dana", "2026-08", "2026-11-14")).toBeNull();
    expect(statementApprovalProblem(rows, "nobody", "2026-08", "2026-11-14")).toMatch(/no longer exists/);
    const approved = rowsFor({}, [stored("2026-08", "approved")]);
    expect(statementApprovalProblem(approved, "dana", "2026-08", "2026-11-14")).toMatch(/already approved/);
    expect(statementApprovalProblem(approved, "dana", "2026-09", "2026-11-14")).toBeNull();
  });

  it("freezes every month up to the latest approved or paid one", () => {
    expect(frozenThrough([stored("2026-07", "paid"), stored("2026-09", "approved")], "dana")).toBe("2026-09");
    expect(frozenThrough([stored("2026-07", "paid")], "luis")).toBeNull();
  });

  it("decides only a reversal waiting for review on that statement", () => {
    const row = rowsFor()[0]!;
    const waiting = {
      ...row,
      lines: [{ ...row.lines[0]!, id: "rv-x", kind: "reversal" as const, reversalState: "needs_review" as const }],
    };
    expect(reversalDecisionProblem(waiting, "rv-x")).toBeNull();
    expect(reversalDecisionProblem(waiting, "rv-other")).toMatch(/not waiting/);
    expect(reversalDecisionProblem(undefined, "rv-x")).toMatch(/not waiting/);
    const applied = { ...waiting, lines: [{ ...waiting.lines[0]!, reversalState: "applied" as const }] };
    expect(reversalDecisionProblem(applied, "rv-x")).toMatch(/not waiting/);
  });

  it("hides the base of margin plan lines, which is margin dollars, and keeps paid revenue bases", () => {
    const margin = plan({ id: "m", basis: "gross_margin" });
    const rows = rowsFor({
      plans: [plan(), margin],
      assignments: [
        {
          id: "a1",
          userId: "dana",
          planId: "m",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          monthlyTargetOverride: null,
          acknowledgement: null,
        },
      ],
    });
    const lines = rows.flatMap((r) => r.lines);
    expect(lines.length).toBeGreaterThan(0);
    // 40% margin on 1000.00 collected.
    expect(lines[0]!.base).toBe("400.00");
    const hidden = hideMarginBase(rows, [plan(), margin]).flatMap((r) => r.lines);
    expect(hidden.every((l) => l.base === null)).toBe(true);
    expect(hidden[0]!.commission).toBe(lines[0]!.commission);
    const revenue = hideMarginBase(rowsFor(), [plan(), margin]).flatMap((r) => r.lines);
    expect(revenue.every((l) => l.base !== null)).toBe(true);
  });

  it("checks a plan's terms", () => {
    const ok = plan({ tiers: [{ fromPctOfTarget: "100", ratePct: "6" }] });
    expect(commissionPlanProblem(ok)).toBeNull();
    expect(commissionPlanProblem({ ...ok, name: " " })).toMatch(/name/);
    expect(commissionPlanProblem({ ...ok, baseRatePct: "101" })).toMatch(/base rate/);
    expect(commissionPlanProblem({ ...ok, baseRatePct: "-1" })).toMatch(/base rate/);
    expect(commissionPlanProblem({ ...ok, monthlyTarget: "10.555" })).toMatch(/target/);
    expect(
      commissionPlanProblem({
        ...ok,
        tiers: [
          { fromPctOfTarget: "100", ratePct: "6" },
          { fromPctOfTarget: "100.0", ratePct: "7" },
        ],
      }),
    ).toMatch(/same point/);
    expect(commissionPlanProblem({ ...ok, draw: { kind: "none", monthlyAmount: "500" } })).toMatch(/no draw/);
    expect(commissionPlanProblem({ ...ok, draw: { kind: "recoverable", monthlyAmount: "500" } })).toBeNull();
    expect(commissionPlanProblem({ ...ok, clawbackDays: 1.5 })).toMatch(/clawback/);
  });

  it("ends a running assignment the day before a new one and replaces one starting on or after it", () => {
    const existing = [
      { id: "old", userId: "dana", effectiveFrom: "2025-01-01", effectiveTo: null },
      { id: "closed", userId: "dana", effectiveFrom: "2024-01-01", effectiveTo: "2024-12-31" },
      { id: "later", userId: "dana", effectiveFrom: "2026-12-01", effectiveTo: null },
      { id: "other", userId: "luis", effectiveFrom: "2025-01-01", effectiveTo: null },
    ];
    expect(assignmentChanges(existing, "dana", "2026-11-01")).toEqual({
      end: [{ id: "old", effectiveTo: "2026-10-31" }],
      remove: ["later"],
    });
  });
});
