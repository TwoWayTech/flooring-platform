import {
  accrualFor,
  addDays,
  bonusesInRun,
  californiaPayNote,
  commissionAllocations,
  dec,
  grossPay,
  moneyString,
  payableEmployees,
  payFrequencyProblem,
  payRunBlockers,
  periodFor,
  timeOffBalance,
  type Employee,
  type PayPeriod,
  type PayPeriodLine,
} from "@workspace/shared";
import type { PayBlocker, PayPeriodReview, PayReviewRow } from "../contract";
import { DemoRuleError } from "./admin-rules";
import { statementRows } from "./commission-actions";
import type { ActionContext } from "./payment-actions";

function need(ctx: ActionContext, id: string): PayPeriod {
  const period = ctx.db.get("payPeriods", id);
  if (!period) throw new DemoRuleError("This pay period no longer exists.");
  return period;
}

/** Makes sure the period holding today exists, on the company's calendar (spec C1). */
export function ensureCurrentPeriod(ctx: ActionContext): PayPeriod[] {
  const { payFrequency: frequency, payPeriodAnchor: anchor } = ctx.db.settings.hr;
  const periods = ctx.db.list("payPeriods");
  const { start, end } = periodFor(ctx.today, frequency, anchor);
  if (periods.some((p) => p.start === start && p.frequency === frequency)) return periods;
  ctx.db.put("payPeriods", {
    id: ctx.newId("pp"),
    frequency,
    start,
    end,
    payDate: addDays(end, 5),
    status: "open",
    approvedBy: null,
    approvedAt: null,
    exportedAt: null,
    excluded: [],
    lines: [],
  });
  return ctx.db.list("payPeriods");
}

/** What pay-period review reads for a person: statements approved and not yet paid join this run. */
function lineFor(
  ctx: ActionContext,
  period: PayPeriod,
  employee: Employee,
  statements: ReturnType<typeof statementRows>,
): PayPeriodLine | null {
  const { db } = ctx;
  const user = db.list("users").find((u) => u.employeeId === employee.id);
  const own = statements.filter(
    (s) => s.userId === user?.id && s.status === "approved" && (s.payPeriodId === null || s.payPeriodId === period.id),
  );
  return grossPay({
    employee,
    period,
    sheets: db.list("timesheets").filter((s) => s.employeeId === employee.id),
    leave: db.list("ptoRequests").filter((r) => r.employeeId === employee.id),
    policies: db.list("timeOffPolicies"),
    companyRule: db.settings.localization.payroll.overtimeRule,
    commission: moneyString(own.reduce((t, s) => t.plus(s.payable), dec(0))),
    bonuses: bonusesInRun(db.list("bonuses"), employee.id, period),
    allocations: commissionAllocations(
      own.flatMap((s) => s.lines),
      db.settings.hr.workweekStartDay,
    ),
  });
}

/** Everyone W-2 who is paid in the period (hr.md rule 15). */
function payable(ctx: ActionContext, period: PayPeriod): Employee[] {
  return payableEmployees(ctx.db.list("employees"), period);
}

/** Workweeks ending in the period whose hours are not approved; each stops approval (ADR 0024). */
function blockersFor(ctx: ActionContext, period: PayPeriod, employees: readonly Employee[]): PayBlocker[] {
  const excluded = new Set(period.excluded.map((x) => x.employeeId));
  return payRunBlockers(period, employees, ctx.db.list("timesheets"), excluded, ctx.db.settings.hr.workweekStartDay);
}

/** One pay period to review (spec C1): stored lines once approved, otherwise worked out live. */
export async function reviewPayPeriod(ctx: ActionContext, id: string): Promise<PayPeriodReview> {
  await ctx.assertCan(["hr.payroll.view"]);
  const period = need(ctx, id);
  const statements = statementRows(ctx);
  const employees = ctx.db.list("employees");
  const inPeriod = payable(ctx, period);
  const rows: PayReviewRow[] = (
    period.lines.length > 0 ? period.lines : inPeriod.flatMap((e) => lineFor(ctx, period, e, statements) ?? [])
  ).map((line) => ({
    line,
    employee: employees.find((e) => e.id === line.employeeId)!,
    excludedReason: period.excluded.find((x) => x.employeeId === line.employeeId)?.reason ?? null,
  }));
  return {
    period,
    rows,
    blockers: period.lines.length > 0 ? [] : blockersFor(ctx, period, inPeriod),
    contractors: ctx.db.list("contractorPayments"),
    contractorNames: Object.fromEntries(employees.filter((e) => e.workerType === "1099").map((e) => [e.id, e.name])),
    // Only the run's W-2 people: overtime law does not reach contractors (ADR 0050).
    warnings: [californiaPayNote(inPeriod, ctx.db.settings.localization.payroll.overtimeRule)].flatMap(
      (note) => note ?? [],
    ),
  };
}

/** Leaves someone out of this run, or brings them back; leaving out needs a reason (ADR 0024). */
export async function setPayExclusion(ctx: ActionContext, id: string, employeeId: string, reason: string | null) {
  await ctx.assertCan(["hr.payroll.approve"]);
  const period = need(ctx, id);
  if (period.status === "approved" || period.status === "exported")
    throw new DemoRuleError("This pay period is already approved.");
  if (reason !== null && reason.trim().length < 3) throw new DemoRuleError("Say why this person is left out.");
  const others = period.excluded.filter((x) => x.employeeId !== employeeId);
  ctx.db.put("payPeriods", {
    ...period,
    status: "in_review",
    excluded: reason === null ? others : [...others, { employeeId, reason: reason.trim() }],
  });
}

/**
 * Approves a run (spec C1, ADR 0024): every workweek ending in it must be approved or the person
 * left out. The lines are frozen, approved commission statements join it, and hours-worked and
 * per-period accrual posts to the time-off ledger now.
 */
export async function approvePayPeriod(ctx: ActionContext, id: string): Promise<PayPeriod> {
  await ctx.assertCan(["hr.payroll.approve"]);
  const period = need(ctx, id);
  if (period.status === "approved" || period.status === "exported")
    throw new DemoRuleError("This pay period is already approved.");
  if (period.end >= ctx.today) throw new DemoRuleError("A pay period can be approved after it ends.");
  const problem = payFrequencyProblem(period.frequency, ctx.db.list("employees"));
  if (problem) throw new DemoRuleError(problem);
  const employees = payable(ctx, period);
  const blockers = blockersFor(ctx, period, employees);
  if (blockers.length > 0)
    throw new DemoRuleError(`${blockers.length} timesheets still need approval, or leave those people out.`);
  const statements = statementRows(ctx);
  const excluded = new Set(period.excluded.map((x) => x.employeeId));
  const lines = employees.filter((e) => !excluded.has(e.id)).flatMap((e) => lineFor(ctx, period, e, statements) ?? []);
  const saved = ctx.db.put("payPeriods", {
    ...period,
    status: "approved",
    lines,
    approvedBy: ctx.actor.name,
    approvedAt: ctx.now,
  });
  for (const s of statements.filter((x) => x.status === "approved" && x.payPeriodId === null && x.statementId)) {
    const record = ctx.db.get("commissionStatements", s.statementId!);
    if (record) ctx.db.put("commissionStatements", { ...record, payPeriodId: period.id });
  }
  postAccrual(ctx, saved);
  ctx.audit({
    category: "data",
    action: "Approved pay period",
    target: `${period.start} to ${period.end}`,
    before: period.status,
    after: `${lines.length} people`,
  });
  return saved;
}

/** Accrual for the run; a policy pauses at its cap instead of taking hours back (ADR 0024). */
function postAccrual(ctx: ActionContext, period: PayPeriod) {
  const policies = ctx.db
    .list("timeOffPolicies")
    .filter((p) => p.accrualMethod === "per_pay_period" || p.accrualMethod === "per_hour_worked");
  for (const line of period.lines) {
    for (const policy of policies) {
      const hours = accrualFor(
        policy,
        timeOffBalance(ctx.db.list("timeOffEntries"), line.employeeId, policy.id),
        line.hoursWorked,
      );
      if (hours.lte(0)) continue;
      ctx.db.put("timeOffEntries", {
        id: ctx.newId("tof"),
        employeeId: line.employeeId,
        policyId: policy.id,
        date: period.end,
        kind: "accrual",
        hours: hours.toDecimalPlaces(2).toString(),
        note: "Accrued with payroll",
        requestId: null,
        payPeriodId: period.id,
      });
    }
  }
}

/** Returns an approved run to review before export; its accrual and statements are released (ADR 0024). */
export async function reopenPayPeriod(ctx: ActionContext, id: string): Promise<PayPeriod> {
  await ctx.assertCan(["hr.payroll.approve"]);
  const period = need(ctx, id);
  if (period.status !== "approved") throw new DemoRuleError("Only an approved pay period can be reopened.");
  for (const e of ctx.db.list("timeOffEntries").filter((x) => x.payPeriodId === id))
    ctx.db.remove("timeOffEntries", e.id);
  for (const s of ctx.db.list("commissionStatements").filter((x) => x.payPeriodId === id))
    ctx.db.put("commissionStatements", { ...s, payPeriodId: null });
  const saved = ctx.db.put("payPeriods", {
    ...period,
    status: "in_review",
    lines: [],
    approvedBy: null,
    approvedAt: null,
  });
  ctx.audit({
    category: "data",
    action: "Reopened pay period",
    target: `${period.start} to ${period.end}`,
    before: "approved",
    after: "in review",
  });
  return saved;
}

/** Marks a run exported (spec C1): it locks, and its commission statements become paid. */
export async function exportPayPeriod(ctx: ActionContext, id: string): Promise<PayPeriod> {
  await ctx.assertCan(["hr.payroll.export"]);
  const period = need(ctx, id);
  if (period.status === "exported") return period;
  if (period.status !== "approved") throw new DemoRuleError("Approve the pay period before exporting it.");
  const saved = ctx.db.put("payPeriods", { ...period, status: "exported", exportedAt: ctx.now });
  for (const s of ctx.db.list("commissionStatements").filter((x) => x.payPeriodId === id))
    ctx.db.put("commissionStatements", { ...s, status: "paid" });
  ctx.audit({
    category: "data",
    action: "Exported pay period",
    target: `${period.start} to ${period.end}`,
    before: "approved",
    after: "exported",
  });
  return saved;
}
