import {
  addDays,
  daysBetween,
  hoursProblem,
  IMPORT_HANDLERS,
  needsTimesheet,
  planImport,
  workweekStartOf,
  type CompanyId,
  type Employee,
  type ImportRequest,
  type ImportTable,
  type Timesheet,
  type TimesheetEvent,
} from "@workspace/shared";
import type { MyClock, TimesheetDecision, TimesheetInput, TimesheetUploadResult } from "../contract";
import { DemoRuleError } from "./admin-rules";
import { inAppFor, notify, usersWith } from "./notification-actions";
import type { ActionContext } from "./payment-actions";

function needSheet(ctx: ActionContext, id: string): Timesheet {
  const sheet = ctx.db.get("timesheets", id);
  if (!sheet) throw new DemoRuleError("This timesheet no longer exists.");
  return sheet;
}

const nameOf = (ctx: ActionContext, employeeId: string) => ctx.db.get("employees", employeeId)?.name ?? "Employee";
const event = (ctx: ActionContext, action: TimesheetEvent["action"], reason: string | null = null): TimesheetEvent => ({
  at: ctx.now,
  by: ctx.actor.name,
  action,
  reason,
});

/** Own timesheet, or someone else's with the right to decide timesheets. */
async function assertMayEdit(ctx: ActionContext, employeeId: string) {
  if (employeeId === ctx.actor.employeeId) await ctx.assertCan(["hr.timesheet.edit"]);
  else await ctx.assertCan(["hr.timesheet.approve"]);
}

/** Saves a week's hours (spec C1, C2). A rejected sheet keeps its status until it is submitted again. */
export async function saveTimesheet(ctx: ActionContext, input: TimesheetInput): Promise<Timesheet> {
  await assertMayEdit(ctx, input.employeeId);
  const employee = ctx.db.get("employees", input.employeeId);
  if (!employee || !needsTimesheet(employee)) throw new DemoRuleError("This person does not use timesheets.");
  const problem = hoursProblem(input.days);
  if (problem) throw new DemoRuleError(problem);
  if (input.weekStart > ctx.today) throw new DemoRuleError("Hours can't be entered for a future week.");
  const existing = ctx.db
    .list("timesheets")
    .find((s) => s.employeeId === input.employeeId && s.weekStart === input.weekStart);
  if (existing?.status === "approved") throw new DemoRuleError("This week is approved, so it is locked.");
  const sheet: Timesheet = {
    id: existing?.id ?? ctx.newId("ts"),
    employeeId: input.employeeId,
    weekStart: input.weekStart,
    days: input.days,
    status: existing?.status ?? "draft",
    submittedAt: existing?.submittedAt ?? null,
    decidedBy: existing?.decidedBy ?? null,
    decidedAt: existing?.decidedAt ?? null,
    rejectionReason: existing?.rejectionReason ?? null,
    source: existing?.source === "clock" ? "clock" : "form",
    history: existing?.history ?? [],
  };
  return ctx.db.put("timesheets", sheet);
}

/** Sends a sheet for approval and tells the people who can decide it (spec C2). */
export async function submitTimesheet(ctx: ActionContext, id: string): Promise<Timesheet> {
  const sheet = needSheet(ctx, id);
  await assertMayEdit(ctx, sheet.employeeId);
  if (sheet.status === "approved" || sheet.status === "submitted") {
    throw new DemoRuleError("This timesheet has already been submitted.");
  }
  const saved = ctx.db.put("timesheets", {
    ...sheet,
    status: "submitted",
    submittedAt: ctx.now,
    rejectionReason: null,
    history: [...sheet.history, event(ctx, "submitted")],
  });
  const approvers = await usersWith(ctx, "hr.timesheet.approve");
  const name = nameOf(ctx, sheet.employeeId);
  notify(ctx, {
    key: "timesheet.submitted",
    source: { type: "timesheet", id: sheet.id, href: "/hr/timesheets" },
    values: { "employee.name": name, "timesheet.week": sheet.weekStart },
    to: [],
    inApp: inAppFor(approvers, `Timesheet from ${name} to approve`),
    version: ctx.now,
  });
  ctx.audit({
    category: "data",
    action: "Submitted timesheet",
    target: `${name}, week of ${sheet.weekStart}`,
    before: sheet.status,
    after: "submitted",
  });
  return saved;
}

/** Tells the person what happened to their sheet (spec A4). */
function notifyDecision(ctx: ActionContext, sheet: Timesheet, decision: string, reason: string) {
  const user = ctx.db.list("users").find((u) => u.employeeId === sheet.employeeId);
  if (!user) return;
  const name = nameOf(ctx, sheet.employeeId);
  notify(ctx, {
    key: "timesheet.decided",
    source: { type: "timesheet", id: sheet.id, href: "/my/timesheet" },
    values: {
      "employee.name": name,
      "timesheet.week": sheet.weekStart,
      "timesheet.decision": decision,
      "timesheet.reason": reason,
    },
    to: [{ kind: "user", id: user.id, name, email: user.email }],
    inApp: inAppFor([user], `Your timesheet for ${sheet.weekStart} was ${decision}`),
    version: ctx.now,
  });
}

/**
 * Approves or rejects submitted sheets (spec C1, ADR 0024). A rejection needs a reason and never
 * changes the hours; nobody decides their own sheet, the same two-person idea as payments.
 */
export async function decideTimesheets(ctx: ActionContext, ids: readonly string[], decision: TimesheetDecision) {
  await ctx.assertCan(["hr.timesheet.approve"]);
  if (decision.action === "reject" && decision.reason.trim().length < 3) {
    throw new DemoRuleError("Say what needs correcting, so the employee can fix it.");
  }
  const sheets = ids.map((id) => needSheet(ctx, id));
  if (sheets.some((s) => s.employeeId === ctx.actor.employeeId)) {
    throw new DemoRuleError("Someone else must decide your own timesheet.");
  }
  for (const sheet of sheets) {
    if (sheet.status !== "submitted")
      throw new DemoRuleError(`${nameOf(ctx, sheet.employeeId)}'s timesheet is not waiting for approval.`);
    const reason = decision.action === "reject" ? decision.reason.trim() : null;
    const status = decision.action === "approve" ? "approved" : "rejected";
    ctx.db.put("timesheets", {
      ...sheet,
      status,
      decidedBy: ctx.actor.name,
      decidedAt: ctx.now,
      rejectionReason: reason,
      history: [...sheet.history, event(ctx, status, reason)],
    });
    notifyDecision(ctx, sheet, status, reason ?? "");
    ctx.audit({
      category: "data",
      action: decision.action === "approve" ? "Approved timesheet" : "Rejected timesheet",
      target: `${nameOf(ctx, sheet.employeeId)}, week of ${sheet.weekStart}`,
      before: sheet.status,
      after: reason ? `rejected: ${reason}` : status,
    });
  }
}

/** Reopens an approved sheet with a reason, until its pay period is exported (ADR 0024). */
export async function reopenTimesheet(ctx: ActionContext, id: string, reason: string): Promise<Timesheet> {
  await ctx.assertCan(["hr.timesheet.approve"]);
  if (reason.trim().length < 3) throw new DemoRuleError("Say why this timesheet is being reopened.");
  const sheet = needSheet(ctx, id);
  if (sheet.status !== "approved") throw new DemoRuleError("Only an approved timesheet can be reopened.");
  const end = addDays(sheet.weekStart, 6);
  const locked = ctx.db
    .list("payPeriods")
    .some((p) => (p.status === "exported" || p.status === "approved") && p.start <= end && p.end >= sheet.weekStart);
  if (locked) throw new DemoRuleError("This week is in an approved pay period. Reopen the pay period first.");
  const saved = ctx.db.put("timesheets", {
    ...sheet,
    status: "draft",
    decidedBy: null,
    decidedAt: null,
    history: [...sheet.history, event(ctx, "reopened", reason.trim())],
  });
  ctx.audit({
    category: "data",
    action: "Reopened timesheet",
    target: `${nameOf(ctx, sheet.employeeId)}, week of ${sheet.weekStart}`,
    before: "approved",
    after: reason.trim(),
  });
  return saved;
}

const TIMESHEET_MAPPING = Object.fromEntries(IMPORT_HANDLERS.timesheets.def.fields.map((f) => [f.key, f.key]));

/**
 * Bulk hours from the template (spec C1, C2): the same rows and checks as the import wizard. With
 * `apply` false it is a dry run. In the portal only the signed-in person's rows go through.
 */
export async function uploadTimesheets(
  ctx: ActionContext,
  input: { table: ImportTable; fileName: string; apply: boolean; own: boolean },
): Promise<TimesheetUploadResult> {
  if (input.own) await ctx.assertCan(["hr.timesheet.edit"]);
  else await ctx.assertCan(["hr.timesheet.approve"]);
  const request: ImportRequest = {
    kind: "timesheets",
    table: input.table,
    fileName: input.fileName,
    mapping: TIMESHEET_MAPPING,
  };
  const { db } = ctx;
  const plan = planImport(IMPORT_HANDLERS.timesheets, request, {
    world: {
      customers: db.list("customers"),
      suppliers: db.list("suppliers"),
      supplierContacts: db.list("supplierContacts"),
      products: db.list("products"),
      rolls: db.list("rolls"),
      stockMovements: db.list("stockMovements"),
      invoices: db.list("invoices"),
      bills: db.list("bills"),
      employees: db.list("employees"),
      timesheets: db.list("timesheets"),
      timeOffEntries: db.list("timeOffEntries"),
      timeOffPolicies: db.list("timeOffPolicies"),
      locations: db.list("locations"),
      users: db.list("users"),
      payments: db.list("payments"),
      invoiceAdjustments: db.list("invoiceAdjustments"),
      supplierPayments: db.list("supplierPayments"),
      reservations: db.list("reservations"),
    },
    companyId: db.companyId as CompanyId,
    today: ctx.today,
    now: ctx.now,
    actorId: ctx.actor.id,
    batch: { id: "upload", number: "this upload" },
    newId: ctx.newId,
    workweekStartDay: db.settings.hr.workweekStartDay,
    onlyEmployeeId: input.own ? (ctx.actor.employeeId ?? "nobody") : undefined,
  });
  if (input.apply) {
    if (plan.counts.create + plan.counts.update === 0)
      throw new DemoRuleError("Nothing to save: every row is blank or has errors.");
    for (const change of plan.changes) db.put(change.collection, change.after as never);
    ctx.audit({
      category: "data",
      action: "Uploaded timesheet hours",
      target: input.fileName,
      before: null,
      after: `${plan.counts.create + plan.counts.update} days`,
    });
  }
  return { rows: plan.rows, counts: plan.counts };
}

function ownEmployee(ctx: ActionContext): Employee {
  const employee = ctx.actor.employeeId ? ctx.db.get("employees", ctx.actor.employeeId) : undefined;
  if (!employee) throw new DemoRuleError("Your sign-in is not linked to an employee.");
  return employee;
}

/** The open clock entry, if the person is clocked in. */
export function myClock(ctx: ActionContext): MyClock {
  const open = ctx.db.list("clockEntries").find((c) => c.employeeId === ctx.actor.employeeId && c.outAt === null);
  return { clockedInAt: open?.inAt ?? null };
}

/** Clocks in (spec C2); only when the company uses the clock. */
export async function clockIn(ctx: ActionContext) {
  await ctx.assertCan(["hr.portal.view"]);
  if (!ctx.db.settings.hr.clockEnabled) throw new DemoRuleError("This company does not use the clock.");
  const employee = ownEmployee(ctx);
  if (!needsTimesheet(employee)) throw new DemoRuleError("This person does not use timesheets.");
  if (myClock(ctx).clockedInAt) throw new DemoRuleError("You are already clocked in.");
  ctx.db.put("clockEntries", {
    id: ctx.newId("clk"),
    employeeId: employee.id,
    date: ctx.today,
    inAt: ctx.now,
    outAt: null,
  });
}

/** Clocks out and adds the hours to this week's draft timesheet (spec C2, ADR 0024). */
export async function clockOut(ctx: ActionContext) {
  await ctx.assertCan(["hr.portal.view"]);
  const employee = ownEmployee(ctx);
  const open = ctx.db.list("clockEntries").find((c) => c.employeeId === employee.id && c.outAt === null);
  if (!open) throw new DemoRuleError("You are not clocked in.");
  ctx.db.put("clockEntries", { ...open, outAt: ctx.now });
  const minutes = Math.max(0, (Date.parse(ctx.now) - Date.parse(open.inAt)) / 60_000);
  const hours = Math.round((minutes / 60) * 100) / 100;
  const weekStart = workweekStartOf(open.date, ctx.db.settings.hr.workweekStartDay);
  const sheet = ctx.db.list("timesheets").find((s) => s.employeeId === employee.id && s.weekStart === weekStart);
  const at = daysBetween(weekStart, open.date);
  if (sheet?.status === "approved" || sheet?.status === "submitted") return;
  const days = sheet?.days ?? [0, 0, 0, 0, 0, 0, 0];
  ctx.db.put("timesheets", {
    id: sheet?.id ?? ctx.newId("ts"),
    employeeId: employee.id,
    weekStart,
    days: days.map((h, i) => (i === at ? Math.round((h + hours) * 100) / 100 : h)),
    status: sheet?.status ?? "draft",
    submittedAt: sheet?.submittedAt ?? null,
    decidedBy: sheet?.decidedBy ?? null,
    decidedAt: sheet?.decidedAt ?? null,
    rejectionReason: sheet?.rejectionReason ?? null,
    source: "clock",
    history: sheet?.history ?? [],
  });
}
