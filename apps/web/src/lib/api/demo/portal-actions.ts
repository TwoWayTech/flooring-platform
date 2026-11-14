import {
  earnedInYear,
  needsTimesheet,
  ownPayLine,
  ownStatements,
  pendingHours,
  portalVisibility,
  teamOutView,
  timeOffBalance,
  workweekStartOf,
  type CompanySettings,
  type Employee,
} from "@workspace/shared";
import type { MyPayRow, MyPortal, MyVisibility } from "../contract";
import { statementRows } from "./commission-actions";
import { ensureCurrentPeriod } from "./pay-actions";
import type { ActionContext } from "./payment-actions";
import { myClock } from "./timesheet-actions";

/** What this person may see (employee-portal.md rule 1): the shared rule the API applies too (ADR 0049). */
export function visibilityFor(employee: Employee | null, hr: CompanySettings["hr"], onPlan: boolean): MyVisibility {
  return portalVisibility(employee, hr, onPlan);
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
          return line ? [{ period, line: ownPayLine(line, visible.commission) }] : [];
        })
        .sort((a, b) => b.period.start.localeCompare(a.period.start))
    : [];
  const statements = visible.commission ? ownStatements(statementRows(ctx), ctx.actor.id) : [];
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
    earnedThisYear: earnedInYear(pay, year),
    statements,
    assignment,
    plan: assignment ? (db.get("commissionPlans", assignment.planId) ?? null) : null,
    contractorPayments: db.list("contractorPayments").filter((c) => c.employeeId === id),
    teamOut: visible.teamCalendar
      ? db
          .list("ptoRequests")
          .filter((r) => r.status === "approved")
          .map(teamOutView)
      : [],
    teamNames: visible.teamCalendar ? db.list("employees").map((e) => ({ id: e.id, name: e.name })) : [],
  };
}
