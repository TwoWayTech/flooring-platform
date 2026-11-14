import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  attachments,
  expenses,
  locations,
  paymentAllocations,
  paymentsMade,
  recurringExpenses,
  supplierBills,
  suppliers,
} from "@workspace/db/company";
import type { StorageProvider } from "@workspace/providers";
import {
  cashAccountFor,
  dueRecurringDrafts,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  expenseCost,
  expensePosting,
  MAX_PROOF_FILES,
  expenseProblem,
  moneyString,
  needsExpenseApproval,
  nextNumber,
  separateDuties,
  supplierDueDate,
  type Expense,
  type ExpenseCategory,
  type PaymentMethod,
  type RecurringExpense,
} from "@workspace/shared";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { loadAccountingForPosting } from "../../core/ledger/accounting-settings";
import { LedgerService } from "../../core/ledger/ledger.service";
import { STORAGE } from "../../core/storage/storage.module";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { checkProofs, withStoredProofs, type ProofUpload } from "../sales/proof-files";
import { companyClock, notFound, refuse } from "../sales/sales-common";
import {
  loadExpenses,
  loadExpenseSettings,
  loadRecurringExpenses,
  locationBranches,
  seesExpense,
  seesPayroll,
} from "./expense-records";

/** The fields of an expense as the form sends them (finance-expenses.md "Recording an expense"). */
export interface ExpenseFields {
  date: string;
  supplierId: string | null;
  category: ExpenseCategory;
  locationId: string | null;
  amount: string;
  tax: string;
  paymentMethod: PaymentMethod;
  reference: string;
  note: string;
  settlement: "paid" | "on_account";
  asDraft: boolean;
}

/** A recurring expense template as the form sends it (spec rule 13). */
export type RecurringFields = Omit<RecurringExpense, "id">;

/** A decision on a pending expense. */
export type ExpenseReview = { action: "approve" } | { action: "reject"; reason: string };

/** Expense numbers are company-wide, so one lock serialises taking them (spec rule 11). */
const NUMBER_LOCK = sql`select pg_advisory_xact_lock(hashtext('finance:expense-number'))`;

type ExpenseRow = typeof expenses.$inferSelect;

const label = (row: Pick<ExpenseRow, "number" | "category">) =>
  `${row.number}, ${EXPENSE_CATEGORY_LABELS[row.category]}`;

/**
 * Expenses on the API (finance-expenses.md; ADR 0023, ADR 0040; P12 part 2). Leaving draft needs a
 * receipt; a large one waits for a second person; confirming posts a balanced entry through
 * LedgerService in the same transaction, and a pay-later expense raises its linked supplier bill.
 * A recorded expense is never edited: a void posts the reversal on the void day (rule 9).
 */
@Injectable()
export class ExpensesService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly books: LedgerService,
  ) {}

  /**
   * Every expense the person's data scope covers. Payroll months show only to holders of
   * `hr.payroll.view`, because at a small location they reveal pay (spec rule 9; CLAUDE.md rule 5).
   */
  async list(tenant: TenantContext, access: RequestAccess): Promise<Expense[]> {
    const db = await this.tenancy.db(tenant);
    const [rows, branches] = await Promise.all([loadExpenses(db, this.control.db), locationBranches(db)]);
    return rows.filter((row) => seesExpense(access, row, branches) && seesPayroll(access, row));
  }

  /**
   * The recurring templates the person's scope covers: all of them with company-wide scope, those
   * at a location in their own branch with branch scope, none with own scope (PR #20 reviews).
   */
  async listRecurring(tenant: TenantContext, access: RequestAccess): Promise<RecurringExpense[]> {
    const db = await this.tenancy.db(tenant);
    const [rows, branches] = await Promise.all([loadRecurringExpenses(db), locationBranches(db)]);
    if (access.dataScope === "all") return rows;
    // Own scope sees only its own expenses, so no template: they belong to the company (PR #20 review).
    if (access.dataScope === "own") return [];
    return rows.filter((row) => row.locationId !== null && branches.get(row.locationId) === access.branchId);
  }

  /**
   * Saves a new or draft expense, or records it (spec "Recording an expense", rules 3 to 6). A
   * draft needs nothing; recording runs `expenseProblem` with every receipt, waits for approval
   * above the company's rule (or when the recorder sees only their own records), else confirms.
   */
  async save(
    tenant: TenantContext,
    actor: Actor,
    id: string | null,
    input: ExpenseFields,
    files: readonly ProofUpload[],
  ): Promise<Expense> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const fields = normalise(input);
    await this.checkFields(db, fields, clock.day);
    await requireWritableAt(db, actor.access, fields.locationId);
    const before = id ? await this.draftInScope(db, actor.access, id) : null;
    // A draft may have no receipt yet; `expenseProblem` decides when one is needed (spec rule 3).
    const proofs = files.length === 0 ? [] : checkProofs(files, before ? await this.fileCount(db, before.id) : 0);
    const settingsRule = await loadExpenseSettings(db);
    const expenseId = before?.id ?? uuidv7();
    await withStoredProofs(this.storage, tenant.companyId, proofs, (attach) =>
      db.transaction(async (tx) => {
        await tx.execute(NUMBER_LOCK);
        const current = before ? await this.lockDraft(tx, before.id) : null;
        // Checked again under the lock: someone may have moved the draft since it was read.
        if (current) {
          const branches = await locationBranches(tx);
          const locked = {
            recordedById: current.recordedById,
            locationId: current.locationId,
            category: current.category,
          };
          if (!seesExpense(actor.access, locked, branches) || !seesPayroll(actor.access, locked))
            throw notFound("expense");
        }
        const now = new Date();
        const values = {
          ...fields,
          recordedById: actor.access.userId,
          recordedAt: now,
          rejectReason: null,
          status: "draft" as const,
        };
        let row: ExpenseRow;
        if (current) {
          [row] = (await tx
            .update(expenses)
            .set({ ...values, createdBy: current.createdBy ?? actor.access.userId, updatedAt: now })
            .where(eq(expenses.id, current.id))
            .returning()) as [ExpenseRow];
        } else {
          const used = await tx.select({ number: expenses.number }).from(expenses);
          const number = nextNumber(
            "EXP-",
            used.map((r) => r.number),
            1,
          );
          [row] = (await tx
            .insert(expenses)
            .values({ id: expenseId, number, ...values, createdBy: actor.access.userId })
            .returning()) as [ExpenseRow];
        }
        await attach(tx, "expense", row.id, actor.access.userId);
        // Counted again under the row lock, so two saves at once can't pass the limit together.
        const fileCount = await this.fileCount(tx, row.id);
        if (fileCount > MAX_PROOF_FILES) throw refuse(`An expense keeps at most ${MAX_PROOF_FILES} files.`);
        const previous = current ? editable(current) : null;
        if (input.asDraft) {
          await this.audit(tenant, actor, tx, "Saved expense draft", row, previous, editable(row));
          return;
        }
        const problem = expenseProblem(row, fileCount);
        if (problem) throw refuse(problem);
        const waits = needsExpenseApproval(settingsRule, row) || actor.access.dataScope === "own";
        if (waits) {
          await tx.update(expenses).set({ status: "pending" }).where(eq(expenses.id, row.id));
          await this.audit(tenant, actor, tx, "Recorded expense for approval", row, previous, editable(row));
          return;
        }
        const billId = await this.confirm(tx, row, null, actor.access.userId);
        await this.audit(tenant, actor, tx, "Recorded expense", row, previous, { ...editable(row), billId });
      }),
    );
    return (await loadExpenses(db, this.control.db, [expenseId]))[0]!;
  }

  /** Approves or rejects a pending expense; never by its recorder (spec rule 5). */
  async review(tenant: TenantContext, actor: Actor, id: string, decision: ExpenseReview): Promise<Expense> {
    const db = await this.tenancy.db(tenant);
    await this.inScope(db, actor.access, id);
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
      if (!row || row.deletedAt) throw notFound("expense");
      if (row.status !== "pending") throw refuse("This expense is not waiting for approval.");
      if (separateDuties(row.recordedById, actor.access.userId))
        throw refuse("Someone else must approve an expense you recorded.");
      if (decision.action === "approve") {
        const billId = await this.confirm(tx, row, actor.access.userId, actor.access.userId);
        await this.audit(
          tenant,
          actor,
          tx,
          "Approved expense",
          row,
          { status: "pending" },
          { status: "confirmed", billId },
        );
        return;
      }
      const reason = decision.reason.trim();
      if (reason.length < 3) throw refuse("Say why it is rejected.");
      await tx
        .update(expenses)
        .set({ status: "draft", rejectReason: reason, reviewedById: actor.access.userId, reviewedAt: new Date() })
        .where(eq(expenses.id, id));
      await this.audit(tenant, actor, tx, "Rejected expense", row, { status: "pending" }, { reason });
    });
    return (await loadExpenses(db, this.control.db, [id]))[0]!;
  }

  /**
   * Voids a pending or confirmed expense with a reason (spec rule 7). A confirmed one posts the
   * reversing entry on the void day. A pay-later one whose bill has any live supplier payment is
   * refused, a waiting one included (blueprint-delta 2026-11-14), and its bill is retired.
   */
  async void(tenant: TenantContext, actor: Actor, id: string, reason: string): Promise<Expense> {
    const why = reason.trim();
    if (why.length < 3) throw refuse("Say why this expense is being voided.");
    const db = await this.tenancy.db(tenant);
    await this.inScope(db, actor.access, id);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
      if (!row || row.deletedAt) throw notFound("expense");
      if (row.status !== "confirmed" && row.status !== "pending") throw refuse("This expense can't be voided.");
      if (row.billId) {
        // The same row lock a supplier payment takes, so the two can't pass each other (ADR 0042).
        await tx
          .select({ id: supplierBills.id })
          .from(supplierBills)
          .where(eq(supplierBills.id, row.billId))
          .for("update");
        const [paid] = await tx
          .select({ id: paymentsMade.id })
          .from(paymentAllocations)
          .innerJoin(paymentsMade, eq(paymentsMade.id, paymentAllocations.paymentId))
          .where(
            and(
              eq(paymentAllocations.billId, row.billId),
              isNull(paymentAllocations.deletedAt),
              isNull(paymentsMade.deletedAt),
              // Only a live payment blocks the void: a rejected or voided one paid nothing.
              inArray(paymentsMade.status, ["pending", "confirmed"]),
            ),
          )
          .limit(1);
        if (paid) throw refuse("This expense has a payment to its supplier, so it can't be voided.");
        await tx
          .update(supplierBills)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(supplierBills.id, row.billId));
      }
      if (row.status === "confirmed") {
        await this.books.reverse(
          tx,
          { sourceType: "expense", sourceId: row.id, event: "expense.confirmed" },
          clock.day,
          actor.access.userId,
        );
      }
      await tx
        .update(expenses)
        .set({ status: "voided", voidedById: actor.access.userId, voidedAt: new Date(), voidReason: why })
        .where(eq(expenses.id, id));
      await this.audit(
        tenant,
        actor,
        tx,
        "Voided expense",
        row,
        { status: row.status, billId: row.billId },
        { reason: why },
      );
    });
    return (await loadExpenses(db, this.control.db, [id]))[0]!;
  }

  /** Adds or edits a recurring template (spec rule 13), then raises any draft it already owes. */
  async saveRecurring(
    tenant: TenantContext,
    actor: Actor,
    id: string | null,
    input: RecurringFields,
  ): Promise<RecurringExpense> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await this.checkVendor(db, input.supplierId);
    if (input.locationId) await this.checkLocation(db, input.locationId);
    if (input.endsOn && input.endsOn < input.startsOn) throw refuse("The end date is before the start date.");
    // A sales tax payment is company-wide and carries no tax of its own (spec rule 8).
    const companyWide = input.category === "sales_tax_payment";
    const values = {
      ...input,
      locationId: companyWide ? null : input.locationId,
      tax: companyWide ? "0.00" : moneyString(input.tax || "0"),
      amount: moneyString(input.amount),
    };
    const savedId = id ?? uuidv7();
    await db.transaction(async (tx) => {
      if (id) {
        const [before] = await tx
          .select()
          .from(recurringExpenses)
          .where(and(eq(recurringExpenses.id, id), isNull(recurringExpenses.deletedAt)))
          .for("update");
        if (!before) throw notFound("recurring expense");
        await tx.update(recurringExpenses).set(values).where(eq(recurringExpenses.id, id));
        await this.auditRecurring(
          tenant,
          actor,
          tx,
          "Edited recurring expense",
          values.category,
          templateFields(before),
          values,
          id,
        );
      } else {
        await tx.insert(recurringExpenses).values({ id: savedId, ...values, createdBy: actor.access.userId });
        await this.auditRecurring(tenant, actor, tx, "Added recurring expense", values.category, null, values, savedId);
      }
    });
    await raiseRecurringDrafts(db, clock.day, this.auditLog);
    return (await loadRecurringExpenses(db, [savedId]))[0]!;
  }

  /** Confirms an expense in the caller's transaction: raises a pay-later bill, then posts (rules 6, 16). */
  private async confirm(tx: CompanyDb, row: ExpenseRow, reviewerId: string | null, by: string): Promise<string | null> {
    let billId: string | null = null;
    let dueAt: string | null = null;
    if (row.settlement === "on_account") {
      const [supplier] = await tx
        .select({ id: suppliers.id, terms: suppliers.terms })
        .from(suppliers)
        .where(and(eq(suppliers.id, row.supplierId ?? ""), isNull(suppliers.deletedAt)));
      if (!supplier) throw refuse("Choose the vendor.");
      dueAt = supplierDueDate(row.date, supplier.terms);
      billId = uuidv7();
      // The bill carries the payable the expense posted; it posts nothing itself (ADR 0041).
      await tx.insert(supplierBills).values({
        id: billId,
        number: row.number,
        supplierId: supplier.id,
        issuedAt: row.date,
        dueAt,
        total: moneyString(expenseCost(row)),
        createdBy: by,
      });
    }
    await tx
      .update(expenses)
      .set({
        status: "confirmed",
        billId,
        dueAt,
        reviewedById: reviewerId,
        reviewedAt: reviewerId ? new Date() : null,
      })
      .where(eq(expenses.id, row.id));
    const cash = cashAccountFor(await loadAccountingForPosting(tx), row.paymentMethod);
    await this.books.post(tx, expensePosting(row, cash), by);
    return billId;
  }

  /** Refuses fields no expense may hold, whatever its status (spec rules 3, 9, 10; blueprint-delta). */
  private async checkFields(db: CompanyDb, fields: ReturnType<typeof normalise>, today: string): Promise<void> {
    // Payroll is not a category people pick (spec rule 9).
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(fields.category)) throw refuse("Choose a category.");
    if (fields.date && fields.date > today) throw refuse("An expense can't be dated in the future.");
    if (fields.supplierId) await this.checkVendor(db, fields.supplierId);
    if (fields.locationId) await this.checkLocation(db, fields.locationId);
  }

  /**
   * An expense's vendor is an active supplier of services or expenses, never a goods-only one
   * (spec rule 10, checked here and not only on the screen; PR #20 review).
   */
  private async checkVendor(db: CompanyDb, supplierId: string): Promise<void> {
    const [row] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.id, supplierId),
          isNull(suppliers.deletedAt),
          eq(suppliers.status, "active"),
          ne(suppliers.type, "goods"),
        ),
      );
    if (!row) throw refuse("Choose an active vendor of services.");
  }

  private async checkLocation(db: CompanyDb, locationId: string): Promise<void> {
    const [row] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.id, locationId), isNull(locations.deletedAt)));
    if (!row) throw refuse("Choose the location.");
  }

  /** An expense the person's data scope covers, or 404 (so its existence is not revealed). */
  private async inScope(db: CompanyDb, access: RequestAccess, id: string): Promise<Expense> {
    const [expense] = await loadExpenses(db, this.control.db, [id]);
    if (!expense || !seesExpense(access, expense, await locationBranches(db)) || !seesPayroll(access, expense)) {
      throw notFound("expense");
    }
    return expense;
  }

  /** A draft in scope; a recorded expense is never edited (spec "Expense status"). */
  private async draftInScope(db: CompanyDb, access: RequestAccess, id: string): Promise<Expense> {
    const expense = await this.inScope(db, access, id);
    if (expense.status !== "draft") throw refuse("A recorded expense can't be edited. Void it and enter it again.");
    return expense;
  }

  /** Locks a draft for the save, checking again that it is still a draft. */
  private async lockDraft(tx: CompanyDb, id: string): Promise<ExpenseRow> {
    const [row] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!row || row.deletedAt) throw notFound("expense");
    if (row.status !== "draft") throw refuse("A recorded expense can't be edited. Void it and enter it again.");
    return row;
  }

  /** How many receipts an expense keeps, the ones attached in this transaction included. */
  private async fileCount(db: CompanyDb, id: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(attachments)
      .where(and(eq(attachments.ownerType, "expense"), eq(attachments.ownerId, id), isNull(attachments.deletedAt)));
    return row?.count ?? 0;
  }

  private audit(
    tenant: TenantContext,
    actor: Actor,
    tx: CompanyDb,
    action: string,
    row: ExpenseRow,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.auditLog.record(
      tenant,
      actor.audit,
      { category: "data", action, targetType: "expense", targetId: row.id, targetLabel: label(row), before, after },
      tx,
    );
  }

  private auditRecurring(
    tenant: TenantContext,
    actor: Actor,
    tx: CompanyDb,
    action: string,
    category: ExpenseCategory,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    id: string,
  ): Promise<void> {
    return this.auditLog.record(
      tenant,
      actor.audit,
      {
        category: "data",
        action,
        targetType: "recurring_expense",
        targetId: id,
        targetLabel: EXPENSE_CATEGORY_LABELS[category],
        before,
        after,
      },
      tx,
    );
  }
}

/**
 * Refuses to write an expense where the person's scope can't see it (PR #20 security review):
 * branch scope only at a location in their own branch; a company-wide expense, such as a sales
 * tax payment, needs company-wide scope. Own scope always waits for a second person instead.
 */
async function requireWritableAt(db: CompanyDb, access: RequestAccess, locationId: string | null): Promise<void> {
  if (access.dataScope !== "branch") return;
  const branches = await locationBranches(db);
  if (locationId === null || branches.get(locationId) !== access.branchId) {
    throw new ForbiddenException({ code: "forbidden", message: "Choose a location in your own branch." });
  }
}

/** The fields a person edits on a recurring template, for its audit entries (CLAUDE.md rule 10). */
function templateFields(row: typeof recurringExpenses.$inferSelect) {
  const {
    supplierId,
    category,
    locationId,
    amount,
    tax,
    paymentMethod,
    frequency,
    dayOfMonth,
    startsOn,
    endsOn,
    active,
    note,
  } = row;
  return {
    supplierId,
    category,
    locationId,
    amount,
    tax,
    paymentMethod,
    frequency,
    dayOfMonth,
    startsOn,
    endsOn,
    active,
    note,
  };
}

/** The fields a person edits on an expense, for its audit entries (CLAUDE.md rule 10). */
function editable(row: ExpenseRow) {
  const { date, supplierId, category, locationId, amount, tax, paymentMethod, settlement, reference, note } = row;
  return { date, supplierId, category, locationId, amount, tax, paymentMethod, settlement, reference, note };
}

/** The form's fields as stored: a sales tax payment is company-wide with no tax (spec rule 8). */
function normalise(input: ExpenseFields) {
  const companyWide = input.category === "sales_tax_payment";
  return {
    date: input.date,
    supplierId: input.supplierId,
    category: input.category,
    locationId: companyWide ? null : input.locationId,
    amount: input.amount,
    tax: companyWide ? "0.00" : input.tax || "0.00",
    paymentMethod: input.paymentMethod,
    reference: input.reference.trim(),
    note: input.note.trim(),
    settlement: input.settlement,
    dueAt: null,
  };
}

/**
 * Raises the drafts recurring templates owe through the company's day (spec rule 13): one per
 * template and period, safe to repeat, at most twelve per template. Each draft waits for a person
 * to finish it with the actual amount and receipt. Raised drafts have no creator, so the list
 * shows "Recurring expense"; the template's creator holds the recorder column until then.
 */
export async function raiseRecurringDrafts(db: CompanyDb, today: string, auditLog: AuditService): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(NUMBER_LOCK);
    const templates = await tx.select().from(recurringExpenses).where(isNull(recurringExpenses.deletedAt));
    const used = await tx
      .select({ recurringId: expenses.recurringId, period: expenses.period, number: expenses.number })
      .from(expenses);
    const byId = new Map(templates.map((row) => [row.id, row]));
    const due = dueRecurringDrafts(templates, used, today);
    const numbers = used.map((row) => row.number);
    let raised = 0;
    for (const { template, period, date } of due) {
      const owner = byId.get(template.id)?.createdBy;
      if (!owner) continue;
      const number = nextNumber("EXP-", numbers, 1);
      numbers.push(number);
      const id = uuidv7();
      await tx.insert(expenses).values({
        id,
        number,
        date,
        supplierId: template.supplierId,
        category: template.category,
        locationId: template.locationId,
        amount: template.amount,
        tax: template.tax,
        paymentMethod: template.paymentMethod,
        reference: "",
        note: template.note,
        status: "draft",
        settlement: "paid",
        recurringId: template.id,
        period,
        recordedById: owner,
        recordedAt: new Date(),
        createdBy: null,
      });
      // The system raised it, on behalf of no person (CLAUDE.md rule 10).
      await auditLog.recordSystem(tx, "Recurring expense", {
        category: "data",
        action: "Raised recurring expense draft",
        targetType: "expense",
        targetId: id,
        targetLabel: `${number}, ${EXPENSE_CATEGORY_LABELS[template.category]}`,
        after: { amount: template.amount, period },
      });
      raised += 1;
    }
    return raised;
  });
}
