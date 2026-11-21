import {
  adjustmentProblem,
  commissionDecisions,
  commissionLines,
  commissionStatementRows,
  commissionTotals,
  CREDIT_NOTE_PREFIX,
  dec,
  FIRST_CREDIT_NOTE,
  monthEnded,
  moneyString,
  nextNumber,
  roundMoney,
  statementKey,
  sum,
  type CommissionAssignment,
  type CommissionInputs,
  type CommissionPlan,
  type CommissionStatement,
  type Invoice,
} from "@workspace/shared";
import type {
  CommissionAdjustmentInput,
  CommissionStatementRow,
  CreditNoteInput,
  PlanAssignmentInput,
} from "../contract";
import { DemoRuleError } from "./admin-rules";
import { inAppFor, notify } from "./notification-actions";
import type { ActionContext } from "./payment-actions";
import { applyScope } from "./scope";
import type { ScopeSubject } from "./scope";

/** Everything the commission engine reads, straight from the company's records. */
export function commissionInputs(ctx: ActionContext): CommissionInputs {
  const { db } = ctx;
  const users = db.list("users");
  const employees = db.list("employees");
  const statements = db.list("commissionStatements");
  const decisions = commissionDecisions(db.list("commissionAdjustments"));
  return {
    plans: db.list("commissionPlans"),
    assignments: db.list("commissionAssignments"),
    invoices: db.list("invoices"),
    payments: db.list("payments"),
    adjustments: db.list("invoiceAdjustments"),
    // The API pays the override to the manager on the line's confirmed day (ADR 0048). Demo data
    // keeps no manager history, so every day reads today's manager and the date is not needed.
    managerOf: (userId) => {
      const self = users.find((u) => u.id === userId);
      const managerId = employees.find((e) => e.id === self?.employeeId)?.managerId;
      return users.find((u) => u.employeeId === managerId)?.id ?? null;
    },
    frozen: new Set(statements.filter((s) => s.status !== "draft").map((s) => statementKey(s.userId, s.month))),
    decisions,
    today: ctx.today,
  };
}

/** Every person's statements for the last twelve months, with the status of each (spec C1, ADR 0025). */
export function statementRows(ctx: ActionContext): CommissionStatementRow[] {
  const inputs = commissionInputs(ctx);
  const users = ctx.db.list("users");
  return commissionStatementRows({
    inputs,
    lines: commissionLines(inputs),
    statements: ctx.db.list("commissionStatements"),
    adjustments: ctx.db.list("commissionAdjustments"),
    nameOf: (userId) => users.find((u) => u.id === userId)?.name ?? "Former employee",
  });
}

/** Commission for a date range per person the viewer may see, for Sales → Team (ADR 0025). */
export async function teamCommission(ctx: ActionContext, subject: ScopeSubject, range: { from: string; to: string }) {
  await ctx.assertCan(["sales.commission.view"]);
  const lines = commissionLines(commissionInputs(ctx));
  const paid = new Set(
    ctx.db
      .list("commissionStatements")
      .filter((s) => s.status === "paid")
      .map((s) => statementKey(s.userId, s.month)),
  );
  const totals = commissionTotals(lines, paid, range);
  const invoices = applyScope(ctx.db, "invoices", ctx.db.list("invoices"), subject);
  const visible = subject.scope === "all" ? null : new Set([subject.user.id, ...invoices.map((i) => i.salesRepId)]);
  return [...totals.entries()].filter(([userId]) => !visible || visible.has(userId));
}

/**
 * Approves a month's statement (ADR 0025): only after the month ends, with no line waiting for
 * review, and never by the person it pays. Approved means frozen; later changes go on an open month.
 */
export async function approveStatement(
  ctx: ActionContext,
  userId: string,
  month: string,
): Promise<CommissionStatement> {
  await ctx.assertCan(["hr.commission.approve"]);
  if (userId === ctx.actor.id) throw new DemoRuleError("Someone else must approve your own statement.");
  if (!monthEnded(month, ctx.today)) throw new DemoRuleError("A statement can be approved once its month has ended.");
  const row = statementRows(ctx).find((r) => r.userId === userId && r.month === month);
  if (!row) throw new DemoRuleError("This statement no longer exists.");
  if (row.status !== "draft") throw new DemoRuleError("This statement is already approved.");
  if (row.needsReview) throw new DemoRuleError("Accept or waive the reversals waiting for review first.");
  const statement: CommissionStatement = {
    id: ctx.newId("cst"),
    userId,
    month,
    status: "approved",
    approvedBy: ctx.actor.name,
    approvedAt: ctx.now,
    payPeriodId: null,
  };
  ctx.db.put("commissionStatements", statement);
  const user = ctx.db.get("users", userId);
  if (user) {
    notify(ctx, {
      key: "commission.ready",
      source: { type: "commission", id: statement.id, href: "/my/commission" },
      values: { "employee.name": user.name, "statement.month": month },
      to: [{ kind: "user", id: user.id, name: user.name, email: user.email }],
      inApp: inAppFor([user], `Your commission statement for ${month} is ready`),
    });
  }
  ctx.audit({
    category: "data",
    action: "Approved commission statement",
    target: `${row.name}, ${month}`,
    before: "draft",
    after: `payable ${row.payable}`,
  });
  return statement;
}

/** A manual change to an open statement, with a reason (spec C1). A deduction names its invoice (ADR 0025). */
export async function addCommissionAdjustment(ctx: ActionContext, input: CommissionAdjustmentInput) {
  await ctx.assertCan(["hr.commission.adjust"]);
  const problem = adjustmentProblem(input.amount, input.reason, input.invoiceId);
  if (problem) throw new DemoRuleError(problem);
  const closed = ctx.db
    .list("commissionStatements")
    .some((s) => s.userId === input.userId && s.month === input.month && s.status !== "draft");
  if (closed) throw new DemoRuleError("This statement is approved. Put the change on the next open statement.");
  ctx.db.put("commissionAdjustments", {
    id: ctx.newId("cadj"),
    userId: input.userId,
    month: input.month,
    amount: moneyString(input.amount),
    invoiceId: input.invoiceId,
    reason: input.reason.trim(),
    byName: ctx.actor.name,
    at: ctx.now,
    decides: null,
  });
  ctx.audit({
    category: "data",
    action: "Adjusted commission statement",
    target: `${ctx.db.get("users", input.userId)?.name}, ${input.month}`,
    before: null,
    after: `${input.amount}: ${input.reason.trim()}`,
  });
}

/** Accepts or waives a reversal outside its window, with a reason (ADR 0025). */
export async function decideReversal(
  ctx: ActionContext,
  input: { userId: string; month: string; lineId: string; outcome: "applied" | "waived"; reason: string },
) {
  await ctx.assertCan(["hr.commission.approve"]);
  if (input.reason.trim().length < 3) throw new DemoRuleError("Give a reason; it stays on the statement.");
  ctx.db.put("commissionAdjustments", {
    id: ctx.newId("cadj"),
    userId: input.userId,
    month: input.month,
    amount: "0.00",
    invoiceId: null,
    reason: input.reason.trim(),
    byName: ctx.actor.name,
    at: ctx.now,
    decides: { lineId: input.lineId, outcome: input.outcome },
  });
  ctx.audit({
    category: "data",
    action: input.outcome === "applied" ? "Accepted commission reversal" : "Waived commission reversal",
    target: `${ctx.db.get("users", input.userId)?.name}, ${input.month}`,
    before: "needs review",
    after: input.reason.trim(),
  });
}

/**
 * Saves a plan (ADR 0025). A plan already used by an approved statement is never edited: the change
 * becomes a new version from today, current assignments move to it and must be signed again.
 */
export async function saveCommissionPlan(ctx: ActionContext, plan: CommissionPlan): Promise<CommissionPlan> {
  await ctx.assertCan(["hr.commission.manage"]);
  if (!plan.name.trim()) throw new DemoRuleError("Give the plan a name.");
  const before = ctx.db.get("commissionPlans", plan.id);
  const used =
    before &&
    ctx.db
      .list("commissionStatements")
      .some(
        (s) =>
          s.status !== "draft" &&
          ctx.db.list("commissionAssignments").some((a) => a.userId === s.userId && a.planId === before.id),
      );
  if (!before || !used) {
    const saved = ctx.db.put("commissionPlans", { ...plan, id: before?.id ?? ctx.newId("plan") });
    ctx.audit({
      category: "data",
      action: before ? "Edited commission plan" : "Added commission plan",
      target: plan.name,
      before: before?.baseRatePct ?? null,
      after: plan.baseRatePct,
    });
    return saved;
  }
  const version: CommissionPlan = {
    ...plan,
    id: ctx.newId("plan"),
    version: before.version + 1,
    status: "active",
    effectiveFrom: ctx.today,
    effectiveTo: null,
  };
  const dayBefore = new Date(Date.parse(ctx.today) - 86_400_000).toISOString().slice(0, 10);
  ctx.db.put("commissionPlans", { ...before, status: "retired", effectiveTo: dayBefore });
  ctx.db.put("commissionPlans", version);
  for (const a of ctx.db.list("commissionAssignments").filter((x) => x.planId === before.id && !x.effectiveTo)) {
    ctx.db.put("commissionAssignments", { ...a, effectiveTo: dayBefore });
    ctx.db.put("commissionAssignments", {
      ...a,
      id: ctx.newId("casg"),
      planId: version.id,
      effectiveFrom: ctx.today,
      effectiveTo: null,
      acknowledgement: null,
    });
  }
  ctx.audit({
    category: "data",
    action: "Published new version of commission plan",
    target: plan.name,
    before: `v${before.version}`,
    after: `v${version.version}`,
  });
  return version;
}

/** Puts someone on a plan from a date, ending any plan they are on (spec C1). */
export async function assignPlan(ctx: ActionContext, input: PlanAssignmentInput): Promise<CommissionAssignment> {
  await ctx.assertCan(["hr.commission.manage"]);
  const plan = ctx.db.get("commissionPlans", input.planId);
  if (!plan) throw new DemoRuleError("Choose a plan.");
  const dayBefore = new Date(Date.parse(input.effectiveFrom) - 86_400_000).toISOString().slice(0, 10);
  for (const a of ctx.db.list("commissionAssignments").filter((x) => x.userId === input.userId && !x.effectiveTo)) {
    if (a.effectiveFrom >= input.effectiveFrom) ctx.db.remove("commissionAssignments", a.id);
    else ctx.db.put("commissionAssignments", { ...a, effectiveTo: dayBefore });
  }
  const saved = ctx.db.put("commissionAssignments", {
    id: ctx.newId("casg"),
    userId: input.userId,
    planId: plan.id,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    monthlyTargetOverride: input.monthlyTargetOverride || null,
    acknowledgement: null,
  });
  ctx.audit({
    category: "data",
    action: "Assigned commission plan",
    target: ctx.db.get("users", input.userId)?.name ?? "",
    before: null,
    after: plan.name,
  });
  return saved;
}

/**
 * The rep signs their plan; a typed name stands in for e-signature in the demo (Labor Code 2751,
 * ADR 0025). `shown` is the plan the screen showed: a plan that has changed since is refused, as
 * the API does (ADR 0049).
 */
export async function acknowledgePlan(
  ctx: ActionContext,
  assignmentId: string,
  signedName: string,
  shown: CommissionPlan,
) {
  const assignment = ctx.db.get("commissionAssignments", assignmentId);
  if (!assignment || assignment.userId !== ctx.actor.id) throw new DemoRuleError("This plan is not assigned to you.");
  const current = ctx.db.get("commissionPlans", assignment.planId);
  if (!current || shown.id !== current.id || shown.version !== current.version) {
    throw new DemoRuleError("Your plan has changed since you opened it. Read the new terms, then sign again.");
  }
  if (signedName.trim().toLowerCase() !== ctx.actor.name.toLowerCase())
    throw new DemoRuleError("Type your full name exactly as shown to sign.");
  ctx.db.put("commissionAssignments", {
    ...assignment,
    acknowledgement: { signedName: signedName.trim(), signedAt: ctx.now },
  });
  ctx.audit({
    category: "data",
    action: "Signed commission plan",
    target: ctx.actor.name,
    before: "unsigned",
    after: "signed",
  });
}

/** Shares an invoice between up to two reps (ADR 0025); locked from the first confirmed payment. */
export async function setCommissionSplit(
  ctx: ActionContext,
  invoiceId: string,
  split: { userId: string; pct: string }[],
) {
  await ctx.assertCan(["hr.commission.manage", "sales.invoice.edit"]);
  const invoice = ctx.db.get("invoices", invoiceId);
  if (!invoice) throw new DemoRuleError("This invoice no longer exists.");
  if (split.length > 2) throw new DemoRuleError("An invoice can be shared between two people at most.");
  if (!sum(split.map((s) => s.pct)).eq(100)) throw new DemoRuleError("The shares must add up to 100%.");
  if (ctx.db.list("payments").some((p) => p.invoiceId === invoiceId && p.status === "confirmed")) {
    throw new DemoRuleError("A confirmed payment has been recorded, so the split is locked.");
  }
  ctx.db.put("invoices", { ...invoice, commissionSplit: split });
  ctx.audit({
    category: "data",
    action: "Changed commission split",
    target: invoice.number,
    before: null,
    after: split.map((s) => `${s.pct}%`).join(" / "),
  });
}

/**
 * Issues a credit note for part of an invoice (plan K-11). It carries the invoice's tax and cost
 * in proportion, becomes customer credit, and reverses commission through the clawback rules.
 */
export async function issueCreditNote(ctx: ActionContext, invoiceId: string, input: CreditNoteInput): Promise<Invoice> {
  await ctx.assertCan(["sales.invoice.void"]);
  const invoice = ctx.db.get("invoices", invoiceId);
  if (!invoice) throw new DemoRuleError("This invoice no longer exists.");
  if (invoice.voidedAt || invoice.isReturn) throw new DemoRuleError("A credit note needs a live invoice.");
  if (input.reason.trim().length < 3) throw new DemoRuleError("Give a reason; it stays on the credit note.");
  const amount = dec(input.subtotal || 0);
  const already = sum(
    ctx.db
      .list("invoices")
      .filter((i) => i.creditForInvoiceId === invoiceId && !i.voidedAt)
      .map((i) => i.subtotal),
  );
  if (amount.lte(0) || amount.plus(already).gt(invoice.subtotal))
    throw new DemoRuleError("Enter an amount up to what is left on this invoice before tax.");
  const share = (field: "tax" | "cost") => roundMoney(dec(invoice[field]).times(amount).dividedBy(invoice.subtotal));
  const tax = share("tax");
  const credit: Invoice = {
    ...invoice,
    id: ctx.newId("inv"),
    // Every invoice number counts, as on the API: a note never takes a number an invoice holds (sales.md rule 22).
    number: nextNumber(
      CREDIT_NOTE_PREFIX,
      ctx.db.list("invoices").map((i) => i.number),
      FIRST_CREDIT_NOTE,
    ),
    quoteId: null,
    isReturn: true,
    creditForInvoiceId: invoice.id,
    issuedAt: ctx.today,
    createdAt: ctx.now,
    dueAt: ctx.today,
    sentAt: ctx.today,
    refundedAt: null,
    depositPct: "0",
    commissionSplit: invoice.commissionSplit,
    subtotal: moneyString(amount),
    tax: moneyString(tax),
    cost: moneyString(share("cost")),
    total: moneyString(amount.plus(tax)),
    lines: [],
  };
  ctx.db.put("invoices", credit);
  ctx.audit({
    category: "data",
    action: "Issued credit note",
    target: `${credit.number} for ${invoice.number}`,
    before: null,
    after: `${credit.total}: ${input.reason.trim()}`,
  });
  return credit;
}
