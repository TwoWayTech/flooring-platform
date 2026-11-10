import {
  dec,
  moneyString,
  needsTimesheet,
  pendingHours,
  sum,
  timeOffBalance,
  workweekStartOf,
  type CompanySettings,
  type Employee,
  type PayPeriodLine,
} from "@workspace/shared";
import type { MyPayRow, MyPortal, MyVisibility } from "../contract";
import { statementRows } from "./commission-actions";
import { ensureCurrentPeriod } from "./pay-actions";
import type { ActionContext } from "./payment-actions";
import { myClock } from "./timesheet-actions";

/** What this person may see (spec C1): the company's switches plus the per-employee commission override. */
export function visibilityFor(employee: Employee | null, hr: CompanySettings["hr"], onPlan: boolean): MyVisibility {
  return {
    pay: !!employee && employee.workerType === "w2" && hr.showPayToEmployees,
    // ADR 0025 finding 7: the switch hides the page; a rep on a plan still signs the plan.
    commission: onPlan && (employee?.commissionVisible ?? hr.showCommissionToEmployees),
    rates: hr.showRatesToEmployees,
    teamCalendar: hr.showTeamCalendarToEmployees,
    clock: hr.clockEnabled && !!employee && needsTimesheet(employee),
  };
}

/** A pay line as the employee sees it: with commission hidden, its line and true-up leave the total (ADR 0024). */
function ownLine(line: PayPeriodLine, showCommission: boolean): PayPeriodLine {
  if (showCommission) return line;
  const gross = dec(line.grossPay).minus(line.commissionPay).minus(line.overtimeTrueUp);
  return { ...line, commissionPay: "0.00", overtimeTrueUp: "0.00", grossPay: moneyString(gross) };
}

/** Everything the portal shows, for the signed-in person only (spec C2). Hidden areas come back empty. */
export async function myPortal(ctx: ActionContext): Promise<MyPortal> {
  await ctx.assertCan(["hr.portal.view"]);
  const { db } = ctx;
  const id = ctx.actor.employeeId;
  const employee = id ? (db.get("employees", id) ?? null) : null;
  const assignment = db.list("commissionAssignments").find((a) => a.userId === ctx.actor.id && !a.effectiveTo) ?? null;
  const visible = visibilityFor(employee, db.settings.hr, assignment !== null);
  const policies = db.list("timeOffPolicies");
  const requests = db.list("ptoRequests").filter((r) => r.employeeId === id);
  const entries = db.list("timeOffEntries");
  const year = ctx.today.slice(0, 4);
  const periods = ensureCurrentPeriod(ctx);
  const pay: MyPayRow[] = visible.pay
    ? periods
        .flatMap((period) => {
          const line = period.lines.find((l) => l.employeeId === id);
          return line ? [{ period, line: ownLine(line, visible.commission) }] : [];
        })
        .sort((a, b) => b.period.start.localeCompare(a.period.start))
    : [];
  const statements = visible.commission
    ? statementRows(ctx)
        .filter((s) => s.userId === ctx.actor.id && (s.lines.length > 0 || s.status !== "draft"))
        .reverse()
    : [];
  const weekStart = workweekStartOf(ctx.today, db.settings.hr.workweekStartDay);
  return {
    employee,
    visible,
    weekStart,
    weekStartDay: db.settings.hr.workweekStartDay,
    timesheets: db
      .list("timesheets")
      .filter((s) => s.employeeId === id)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    usesTimesheet: !!employee && needsTimesheet(employee),
    clock: myClock(ctx),
    balances:
      employee?.workerType === "w2"
        ? policies.map((policy) => ({
            policy,
            hours: timeOffBalance(entries, employee.id, policy.id).toString(),
            pending: pendingHours(requests, employee.id, policy.id).toString(),
          }))
        : [],
    requests: requests.sort((a, b) => b.start.localeCompare(a.start)),
    pay,
    earnedThisYear: moneyString(sum(pay.filter((p) => p.period.payDate.startsWith(year)).map((p) => p.line.grossPay))),
    statements,
    assignment,
    plan: assignment ? (db.get("commissionPlans", assignment.planId) ?? null) : null,
    contractorPayments: db.list("contractorPayments").filter((c) => c.employeeId === id),
    teamOut: visible.teamCalendar
      ? db
          .list("ptoRequests")
          .filter((r) => r.status === "approved")
          .map((r) => ({ ...r, kind: "vacation" as const, note: "", decisionReason: null }))
      : [],
    teamNames: visible.teamCalendar ? db.list("employees").map((e) => ({ id: e.id, name: e.name })) : [],
  };
}
