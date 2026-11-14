import type { CompanyDb, ControlDb } from "@workspace/db";
import { expenses, locations, recurringExpenses, settings } from "@workspace/db/company";
import { scopeAllows, type Expense, type ExpenseSettings, type RecurringExpense } from "@workspace/shared";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { fileRows, filesByOwner, loadNames, minuteOf } from "../sales/invoice-records";

/** Who a raised recurring draft is recorded by until a person saves it (spec rule 13). */
export const RECURRING_RECORDER = "Recurring expense";

/** The company's expense approval rule (spec rule 4), read from `settings.expenses`; off when never saved. */
export async function loadExpenseSettings(db: CompanyDb): Promise<ExpenseSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "expenses"));
  const value = row?.value as Partial<ExpenseSettings> | undefined;
  return {
    approvalRequired: value?.approvalRequired === true,
    approvalThreshold: typeof value?.approvalThreshold === "string" ? value.approvalThreshold : "",
  };
}

/** Which branch each location belongs to, for data scope. */
export async function locationBranches(db: CompanyDb): Promise<Map<string, string | null>> {
  const rows = await db.select({ id: locations.id, branchId: locations.branchId }).from(locations);
  return new Map(rows.map((row) => [row.id, row.branchId]));
}

/**
 * Whether the person's data scope covers an expense (blueprint-delta 2026-11-14): own by its
 * recorder, branch by its location's branch, or all. A company-wide expense has no branch, so
 * only company-wide scope or its recorder sees it.
 */
export function seesExpense(
  access: Pick<RequestAccess, "dataScope" | "userId" | "branchId">,
  expense: Pick<Expense, "recordedById" | "locationId">,
  branches: ReadonlyMap<string, string | null>,
): boolean {
  return scopeAllows(
    access.dataScope,
    { userId: access.userId, branchId: access.branchId },
    {
      ownerUserId: expense.recordedById,
      branchId: expense.locationId ? (branches.get(expense.locationId) ?? null) : null,
    },
  );
}

/** Expenses with their receipts and the names of who recorded, reviewed and voided them, newest first. */
export async function loadExpenses(db: CompanyDb, control: ControlDb, ids?: readonly string[]): Promise<Expense[]> {
  const rows = await db
    .select()
    .from(expenses)
    .where(and(isNull(expenses.deletedAt), ids ? inArray(expenses.id, [...ids]) : undefined))
    .orderBy(desc(expenses.date), desc(expenses.number));
  const fileList = rows.length === 0 ? [] : await fileRows(db, "expense", ids ?? rows.map((row) => row.id));
  const names = await loadNames(control, [
    ...rows.flatMap((row) => [row.recordedById, row.reviewedById, row.voidedById]),
    ...fileList.map((row) => row.createdBy),
  ]);
  const files = filesByOwner(fileList, names);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "") : null);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    date: row.date,
    supplierId: row.supplierId,
    category: row.category,
    locationId: row.locationId,
    amount: row.amount,
    tax: row.tax,
    paymentMethod: row.paymentMethod,
    reference: row.reference,
    files: files.get(row.id) ?? [],
    note: row.note,
    status: row.status,
    settlement: row.settlement,
    dueAt: row.dueAt,
    billId: row.billId,
    recurringId: row.recurringId,
    period: row.period,
    recordedById: row.recordedById,
    // A raised draft has no creator until a person saves it (spec rule 13).
    recordedBy: row.createdBy === null && row.recurringId ? RECURRING_RECORDER : (names.get(row.recordedById) ?? ""),
    recordedAt: minuteOf(row.recordedAt),
    reviewedBy: nameOf(row.reviewedById),
    reviewedAt: row.reviewedAt ? minuteOf(row.reviewedAt) : null,
    rejectReason: row.rejectReason,
    voidedBy: nameOf(row.voidedById),
    voidedAt: row.voidedAt ? minuteOf(row.voidedAt) : null,
    voidReason: row.voidReason,
  }));
}

/** The recurring expense templates, as the screens show them. */
export async function loadRecurringExpenses(db: CompanyDb, ids?: readonly string[]): Promise<RecurringExpense[]> {
  const rows = await db
    .select()
    .from(recurringExpenses)
    .where(and(isNull(recurringExpenses.deletedAt), ids ? inArray(recurringExpenses.id, [...ids]) : undefined))
    .orderBy(recurringExpenses.createdAt);
  return rows.map((row) => ({
    id: row.id,
    supplierId: row.supplierId,
    category: row.category,
    locationId: row.locationId,
    amount: row.amount,
    tax: row.tax,
    paymentMethod: row.paymentMethod,
    frequency: row.frequency,
    dayOfMonth: row.dayOfMonth,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    active: row.active,
    note: row.note,
  }));
}
