import {
  dec,
  dueRecurringDrafts,
  EXPENSE_CATEGORY_LABELS,
  expenseCost,
  expenseProblem,
  featureOn,
  moneyString,
  needsExpenseApproval,
  nextNumber,
  supplierDueDate,
  type Bill,
  type Expense,
  type RecurringExpense,
} from "@workspace/shared";
import type { ExpenseDecision, ExpenseInput, RecurringExpenseInput } from "../contract";
import { DemoRuleError } from "./admin-rules";
import { describeFiles, storeFiles, type ActionContext } from "./payment-actions";

function need(ctx: ActionContext, id: string): Expense {
  const expense = ctx.db.get("expenses", id);
  if (!expense) throw new DemoRuleError("This expense no longer exists.");
  return expense;
}

const nextExpenseNumber = (ctx: ActionContext) =>
  nextNumber(
    "EXP-",
    ctx.db.list("expenses").map((e) => e.number),
    1,
  );

const log = (ctx: ActionContext, action: string, e: Expense, before: string | null, after: string | null) =>
  ctx.audit({ category: "data", action, target: `${e.number}, ${EXPENSE_CATEGORY_LABELS[e.category]}`, before, after });

/** Pay later (ADR 0023): a linked bill with no purchase order, so payables and supplier payments just work. */
function linkBill(ctx: ActionContext, expense: Expense): Expense {
  const supplier = ctx.db.get("suppliers", expense.supplierId ?? "");
  if (!supplier) throw new DemoRuleError("Choose the vendor.");
  const dueAt = expense.dueAt ?? supplierDueDate(expense.date, supplier.terms);
  const bill: Bill = {
    id: ctx.newId("bill"),
    number: expense.number,
    supplierId: supplier.id,
    poId: null,
    receiptIds: [],
    issuedAt: expense.date,
    dueAt,
    total: moneyString(expenseCost(expense)),
    matchIssues: [],
    files: expense.files,
  };
  ctx.db.put("bills", bill);
  return { ...expense, billId: bill.id, dueAt };
}

/** Confirms an expense: a pay-later one raises its bill. */
function confirm(ctx: ActionContext, expense: Expense, reviewer: string | null): Expense {
  const saved = expense.settlement === "on_account" ? linkBill(ctx, expense) : expense;
  return ctx.db.put("expenses", {
    ...saved,
    status: "confirmed",
    reviewedBy: reviewer,
    reviewedAt: reviewer ? ctx.now : null,
  });
}

function sharedFields(input: ExpenseInput) {
  const companyWide = input.category === "sales_tax_payment";
  return {
    date: input.date,
    supplierId: input.supplierId,
    category: input.category,
    // A sales tax payment is always company-wide and carries no tax of its own (ADR 0023).
    locationId: companyWide ? null : input.locationId,
    amount: input.amount,
    tax: companyWide ? "0.00" : input.tax || "0.00",
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    note: input.note,
    settlement: input.settlement,
    dueAt: input.settlement === "on_account" ? input.dueAt : null,
  };
}

/** Saves a draft, or records an expense: leaving draft needs a receipt, and a large one waits for approval (spec F1). */
export async function saveExpense(ctx: ActionContext, input: ExpenseInput, files: readonly File[]): Promise<Expense> {
  await ctx.assertCan(["finance.expense.create"]);
  const before = input.id ? need(ctx, input.id) : undefined;
  if (before && before.status !== "draft")
    throw new DemoRuleError("A recorded expense can't be edited. Void it and enter it again.");
  const id = before?.id ?? ctx.newId("exp");
  const metas = files.length ? await describeFiles(ctx, id, files, before?.files.length ?? 0) : [];
  if (metas.length) await storeFiles(ctx, metas, files);
  const draft: Expense = {
    id,
    number: before?.number ?? nextExpenseNumber(ctx),
    recurringId: before?.recurringId ?? null,
    period: before?.period ?? null,
    billId: null,
    status: "draft",
    files: [...(before?.files ?? []), ...metas],
    recordedById: ctx.actor.id,
    recordedBy: ctx.actor.name,
    recordedAt: ctx.now,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    ...sharedFields(input),
  };
  if (input.asDraft) {
    log(ctx, "Saved expense draft", draft, null, draft.amount);
    return ctx.db.put("expenses", draft);
  }
  const problem = expenseProblem(draft, draft.files.length);
  if (problem) throw new DemoRuleError(problem);
  if (needsExpenseApproval(ctx.db.settings.expenses, draft)) {
    log(ctx, "Recorded expense for approval", draft, null, draft.amount);
    return ctx.db.put("expenses", { ...draft, status: "pending" });
  }
  log(ctx, "Recorded expense", draft, null, draft.amount);
  return confirm(ctx, draft, null);
}

/** Approves or rejects an expense; nobody approves their own, and a rejection needs a reason (ADR 0023). */
export async function reviewExpense(ctx: ActionContext, id: string, decision: ExpenseDecision): Promise<Expense> {
  await ctx.assertCan(["finance.expense.approve"]);
  const expense = need(ctx, id);
  if (expense.status !== "pending") throw new DemoRuleError("This expense is not waiting for approval.");
  if (expense.recordedById === ctx.actor.id)
    throw new DemoRuleError("Someone else must approve an expense you recorded.");
  if (decision.action === "approve") {
    log(ctx, "Approved expense", expense, "pending", "confirmed");
    return confirm(ctx, expense, ctx.actor.name);
  }
  if (decision.reason.trim().length < 3) throw new DemoRuleError("Say why it is rejected.");
  log(ctx, "Rejected expense", expense, "pending", decision.reason.trim());
  return ctx.db.put("expenses", {
    ...expense,
    status: "draft",
    rejectReason: decision.reason.trim(),
    reviewedBy: ctx.actor.name,
    reviewedAt: ctx.now,
  });
}

/** Voids a confirmed expense with a reason; a pay-later one with payments can't be voided (ADR 0023). */
export async function voidExpense(ctx: ActionContext, id: string, reason: string): Promise<Expense> {
  await ctx.assertCan(["finance.expense.void"]);
  if (reason.trim().length < 3) throw new DemoRuleError("Say why this expense is being voided.");
  const expense = need(ctx, id);
  if (expense.status !== "confirmed" && expense.status !== "pending")
    throw new DemoRuleError("This expense can't be voided.");
  if (expense.billId) {
    const paid = ctx.db
      .list("supplierPayments")
      .some((p) => p.status === "confirmed" && p.allocations.some((a) => a.billId === expense.billId));
    if (paid) throw new DemoRuleError("This expense has been paid, so it can't be voided.");
    ctx.db.remove("bills", expense.billId);
  }
  log(ctx, "Voided expense", expense, expense.status, reason.trim());
  return ctx.db.put("expenses", {
    ...expense,
    status: "voided",
    voidedBy: ctx.actor.name,
    voidedAt: ctx.now,
    voidReason: reason.trim(),
  });
}

/** Adds or edits a recurring expense (spec F1). */
export async function saveRecurringExpense(
  ctx: ActionContext,
  input: RecurringExpenseInput,
): Promise<RecurringExpense> {
  await ctx.assertCan(["finance.expense.create"]);
  if (!input.supplierId) throw new DemoRuleError("Choose the vendor.");
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || dec(input.amount).lte(0))
    throw new DemoRuleError("Enter the estimated amount.");
  const before = input.id ? ctx.db.get("recurringExpenses", input.id) : undefined;
  const saved = ctx.db.put("recurringExpenses", { ...input, id: before?.id ?? ctx.newId("rex") });
  ctx.audit({
    category: "data",
    action: before ? "Edited recurring expense" : "Added recurring expense",
    target: EXPENSE_CATEGORY_LABELS[saved.category],
    before: before?.amount ?? null,
    after: saved.amount,
  });
  return saved;
}

/** Makes the drafts recurring expenses owe, each waiting for the actual amount (spec F1). Safe to run on every open. */
export function raiseRecurringDrafts(ctx: ActionContext) {
  if (!featureOn("finance.expenses")) return;
  for (const { template, period, date } of dueRecurringDrafts(
    ctx.db.list("recurringExpenses"),
    ctx.db.list("expenses"),
    ctx.today,
  )) {
    ctx.db.put("expenses", {
      id: ctx.newId("exp"),
      number: nextExpenseNumber(ctx),
      date,
      supplierId: template.supplierId,
      category: template.category,
      locationId: template.locationId,
      amount: template.amount,
      tax: template.tax,
      paymentMethod: template.paymentMethod,
      reference: "",
      files: [],
      note: template.note,
      status: "draft",
      settlement: "paid",
      dueAt: null,
      billId: null,
      recurringId: template.id,
      period,
      recordedById: ctx.actor.id,
      recordedBy: "Recurring expense",
      recordedAt: ctx.now,
      reviewedBy: null,
      reviewedAt: null,
      rejectReason: null,
      voidedBy: null,
      voidedAt: null,
      voidReason: null,
    });
  }
}
