import {
  addDays,
  californiaPolicyProblem,
  dec,
  pendingHours,
  timeOffBalance,
  timeOffProblem,
  type PtoRequest,
  type TimeOffEntry,
  type TimeOffPolicy,
} from "@workspace/shared";
import type { TimeOffAdjustment, TimeOffDecision, TimeOffInput } from "../contract";
import { DemoRuleError } from "./admin-rules";
import { inAppFor, notify, usersWith } from "./notification-actions";
import type { ActionContext } from "./payment-actions";

const nameOf = (ctx: ActionContext, employeeId: string) => ctx.db.get("employees", employeeId)?.name ?? "Employee";

function postEntry(ctx: ActionContext, entry: Omit<TimeOffEntry, "id" | "payPeriodId"> & { payPeriodId?: string }) {
  ctx.db.put("timeOffEntries", { ...entry, id: ctx.newId("tof"), payPeriodId: entry.payPeriodId ?? null });
}

/**
 * Requests time off (spec C1, C2). Refused when the balance won't cover it, before the policy's
 * waiting period ends, past its yearly use limit, or for a partial unpaid day of an exempt person,
 * which could not lawfully reduce their salary (29 CFR 541.602, ADR 0024).
 */
export async function requestTimeOff(ctx: ActionContext, input: TimeOffInput): Promise<PtoRequest> {
  const own = input.employeeId === ctx.actor.employeeId;
  await ctx.assertCan(own ? ["hr.pto.request"] : ["hr.pto.approve"]);
  const employee = ctx.db.get("employees", input.employeeId);
  const policy = ctx.db.get("timeOffPolicies", input.policyId);
  if (!employee || !policy) throw new DemoRuleError("Choose a person and a type of time off.");
  if (employee.workerType === "1099") throw new DemoRuleError("Contractors do not take time off through this system.");
  const entries = ctx.db.list("timeOffEntries");
  const requests = ctx.db.list("ptoRequests");
  const problem = timeOffProblem({
    start: input.start,
    end: input.end,
    hours: input.hours,
    policy,
    balance: timeOffBalance(entries, employee.id, policy.id),
    pending: pendingHours(requests, employee.id, policy.id),
  });
  if (problem) throw new DemoRuleError(problem);
  if (addDays(employee.hiredAt, policy.waitingPeriodDays) > input.start) {
    throw new DemoRuleError(`${policy.name} can be used after ${policy.waitingPeriodDays} days of employment.`);
  }
  if (policy.annualUseLimitHours) {
    const year = input.start.slice(0, 4);
    const used = requests
      .filter(
        (r) =>
          r.employeeId === employee.id &&
          r.policyId === policy.id &&
          r.status === "approved" &&
          r.start.startsWith(year),
      )
      .reduce((total, r) => total.plus(r.hours), dec(0));
    if (used.plus(input.hours).gt(policy.annualUseLimitHours)) {
      throw new DemoRuleError(`${policy.name} is limited to ${policy.annualUseLimitHours} hours a year.`);
    }
  }
  const days = Math.max(1, Math.round((Date.parse(input.end) - Date.parse(input.start)) / 86_400_000) + 1);
  if (
    employee.flsaStatus === "exempt" &&
    !policy.paid &&
    dec(input.hours)
      .mod(8 * days)
      .gt(0)
  ) {
    throw new DemoRuleError("Unpaid leave for an exempt employee must be in full days.");
  }
  const request: PtoRequest = {
    id: ctx.newId("pto"),
    employeeId: employee.id,
    policyId: policy.id,
    start: input.start,
    end: input.end,
    hours: input.hours,
    kind: policy.kind,
    status: "pending",
    note: input.note.trim(),
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
  };
  ctx.db.put("ptoRequests", request);
  const approvers = await usersWith(ctx, "hr.pto.approve");
  notify(ctx, {
    key: "timeoff.requested",
    source: { type: "timeoff", id: request.id, href: "/hr/time-off" },
    values: {
      "employee.name": employee.name,
      "timeoff.kind": policy.name,
      "timeoff.start": request.start,
      "timeoff.end": request.end,
    },
    to: approvers.map((u) => ({ kind: "user" as const, id: u.id, name: u.name, email: u.email })),
    inApp: inAppFor(approvers, `Time off request from ${employee.name}`),
  });
  ctx.audit({
    category: "data",
    action: "Requested time off",
    target: `${employee.name}, ${request.start}`,
    before: null,
    after: `${request.hours} h ${policy.name}`,
  });
  return request;
}

/** Approves or declines a request (spec C1). Approving posts the hours to the ledger; a decline needs a reason. */
export async function decideTimeOff(ctx: ActionContext, id: string, decision: TimeOffDecision): Promise<PtoRequest> {
  await ctx.assertCan(["hr.pto.approve"]);
  const request = ctx.db.get("ptoRequests", id);
  if (!request) throw new DemoRuleError("This request no longer exists.");
  if (request.status !== "pending") throw new DemoRuleError("This request has already been decided.");
  if (request.employeeId === ctx.actor.employeeId)
    throw new DemoRuleError("Someone else must decide your own time off.");
  if (decision.action === "deny" && decision.reason.trim().length < 3)
    throw new DemoRuleError("Say why, so the employee knows.");
  const status = decision.action === "approve" ? "approved" : "denied";
  const reason = decision.action === "deny" ? decision.reason.trim() : null;
  const saved = ctx.db.put("ptoRequests", {
    ...request,
    status,
    decidedBy: ctx.actor.name,
    decidedAt: ctx.now,
    decisionReason: reason,
  });
  if (status === "approved") {
    postEntry(ctx, {
      employeeId: request.employeeId,
      policyId: request.policyId,
      date: request.start,
      kind: "used",
      hours: dec(request.hours).negated().toString(),
      note: "Time off taken",
      requestId: request.id,
    });
  }
  const user = ctx.db.list("users").find((u) => u.employeeId === request.employeeId);
  const name = nameOf(ctx, request.employeeId);
  if (user) {
    notify(ctx, {
      key: "timeoff.decided",
      source: { type: "timeoff", id: request.id, href: "/my/time-off" },
      values: {
        "employee.name": name,
        "timeoff.start": request.start,
        "timeoff.end": request.end,
        "timeoff.decision": status,
        "timeoff.reason": reason ?? "",
      },
      to: [{ kind: "user", id: user.id, name, email: user.email }],
      inApp: inAppFor([user], `Your time off from ${request.start} was ${status}`),
    });
  }
  ctx.audit({
    category: "data",
    action: status === "approved" ? "Approved time off" : "Declined time off",
    target: `${name}, ${request.start}`,
    before: "pending",
    after: reason ? `declined: ${reason}` : status,
  });
  return saved;
}

/** Cancels a request; if it was approved, its hours go back on the balance (ADR 0024). */
export async function cancelTimeOff(ctx: ActionContext, id: string): Promise<PtoRequest> {
  const request = ctx.db.get("ptoRequests", id);
  if (!request) throw new DemoRuleError("This request no longer exists.");
  await ctx.assertCan(request.employeeId === ctx.actor.employeeId ? ["hr.pto.request"] : ["hr.pto.approve"]);
  if (request.status !== "pending" && request.status !== "approved")
    throw new DemoRuleError("This request can't be cancelled.");
  if (request.status === "approved" && request.start < ctx.today)
    throw new DemoRuleError("Time off that has started can't be cancelled.");
  if (request.status === "approved") {
    postEntry(ctx, {
      employeeId: request.employeeId,
      policyId: request.policyId,
      date: ctx.today,
      kind: "adjustment",
      hours: request.hours,
      note: "Cancelled time off returned",
      requestId: request.id,
    });
  }
  const saved = ctx.db.put("ptoRequests", { ...request, status: "cancelled" });
  ctx.audit({
    category: "data",
    action: "Cancelled time off",
    target: `${nameOf(ctx, request.employeeId)}, ${request.start}`,
    before: request.status,
    after: "cancelled",
  });
  return saved;
}

/** A manual change to a balance, with a reason (ADR 0024: every change is a ledger line). */
export async function adjustTimeOff(ctx: ActionContext, input: TimeOffAdjustment) {
  await ctx.assertCan(["hr.pto.approve"]);
  if (input.note.trim().length < 3) throw new DemoRuleError("Give a reason; it stays on the balance history.");
  if (!/^-?\d+(\.\d{1,2})?$/.test(input.hours.trim()) || dec(input.hours).isZero())
    throw new DemoRuleError("Enter the hours to add or take away.");
  const policy = ctx.db.get("timeOffPolicies", input.policyId);
  if (!policy) throw new DemoRuleError("Choose a type of time off.");
  postEntry(ctx, {
    employeeId: input.employeeId,
    policyId: policy.id,
    date: ctx.today,
    kind: "adjustment",
    hours: input.hours.trim(),
    note: input.note.trim(),
    requestId: null,
  });
  ctx.audit({
    category: "data",
    action: "Adjusted time-off balance",
    target: nameOf(ctx, input.employeeId),
    before: policy.name,
    after: `${input.hours} h: ${input.note.trim()}`,
  });
}

/** Adds or edits a policy (Settings → HR). A company with California staff gets the California guards (ADR 0024). */
export async function saveTimeOffPolicy(ctx: ActionContext, policy: TimeOffPolicy): Promise<TimeOffPolicy> {
  await ctx.assertCan(["settings.hr.manage"]);
  if (!policy.name.trim()) throw new DemoRuleError("Give the policy a name.");
  const hasCalifornia = ctx.db.list("employees").some((e) => e.state === "CA" && e.status !== "terminated");
  const problem = hasCalifornia ? californiaPolicyProblem(policy) : null;
  if (problem) throw new DemoRuleError(problem);
  const before = ctx.db.get("timeOffPolicies", policy.id);
  const saved = ctx.db.put("timeOffPolicies", { ...policy, id: before?.id ?? ctx.newId("pol") });
  ctx.audit({
    category: "settings",
    action: before ? "Edited time-off policy" : "Added time-off policy",
    target: policy.name,
    before: before?.capHours ?? null,
    after: policy.capHours,
  });
  return saved;
}
