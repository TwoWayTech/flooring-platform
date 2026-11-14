import { Inject, Injectable, Logger } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  auditLog,
  commissionAdjustments,
  commissionAssignments,
  commissionPlans,
  commissionStatements,
  invoiceCommissionSplits,
  invoices,
  userProfiles,
} from "@workspace/db/company";
import { user } from "@workspace/db/control";
import {
  addDays,
  adjustmentProblem,
  assignmentChanges,
  commissionPlanProblem,
  commissionStatementPosting,
  commissionTotals,
  dec,
  frozenThrough,
  hideMarginBase,
  last12Months,
  moneyString,
  monthEnd,
  reversalDecisionProblem,
  scopeAllows,
  statementApprovalProblem,
  statementKey,
  type CommissionAssignment,
  type CommissionPlan,
  type CommissionStatement,
  type CommissionStatementRow,
  type TeamCommission,
} from "@workspace/shared";
import { and, asc, eq, gte, inArray, isNotNull, isNull, max, ne, or } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { NotificationService } from "../../core/notifications/notification.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadNames } from "../sales/invoice-records";
import { companyClock, notFound, refuse } from "../sales/sales-common";
import {
  employeesByUser,
  loadCommissionAssignments,
  loadCommissionBook,
  loadCommissionPlans,
  loadManagerOf,
  type CommissionBook,
} from "./commission-records";
import { auditHr, databaseNow, lockEmployee, PAYROLL_LOCK, requireLinkedDecider } from "./hr-common";
import { selfCheck } from "./hr-records";

/** A person HR may put on a plan (the screens' `CommissionPerson`). */
export interface CommissionPerson {
  id: string;
  name: string;
  active: boolean;
}

/** An invoice as Commissions names it, never with its amounts or cost (the screens' `CommissionInvoiceRef`). */
export interface CommissionInvoiceRef {
  id: string;
  number: string;
  salesRepId: string;
  isReturn: boolean;
  voidedAt: string | null;
}

/** What HR → Commissions reads (the screens' `CommissionData`). */
export interface CommissionData {
  statements: CommissionStatementRow[];
  plans: CommissionPlan[];
  assignments: CommissionAssignment[];
  people: CommissionPerson[];
  invoices: CommissionInvoiceRef[];
}

/** A plan as the form sends it; version, status and dates are the server's (commissions.md rule 13). */
export type PlanFields = Pick<
  CommissionPlan,
  "name" | "basis" | "baseRatePct" | "monthlyTarget" | "tierMode" | "tiers" | "overridePct" | "draw" | "clawbackDays"
>;

/** A statement adjustment as the form sends it (commissions.md rule 12). */
export interface AdjustmentFields {
  userId: string;
  month: string;
  amount: string;
  invoiceId: string | null;
  reason: string;
}

/** HR's call on a reversal outside its window (commissions.md rule 9). */
export interface DecisionFields {
  userId: string;
  month: string;
  lineId: string;
  outcome: "applied" | "waived";
  reason: string;
}

/** Putting someone on a plan (commissions.md rule 14). */
export interface AssignmentFields {
  userId: string;
  planId: string;
  effectiveFrom: string;
  monthlyTargetOverride: string | null;
}

/** Whether a user is the acting person: by user id, or their linked employee is theirs (`selfCheck`). */
type IsSelfUser = (userId: string) => boolean;

/**
 * Commissions on the API (commissions.md; ADR 0048): statements worked out from confirmed payments
 * by the shared engine, approved (accruing the commission to Accrued Payroll), adjusted, reversals
 * decided, plans saved (a used plan gets a new version) and people put on plans. Every write takes
 * `PAYROLL_LOCK` first, because it changes what a statement or a pay run pays, then the rows it
 * changes, and writes audit_log in the same transaction with no amounts (CLAUDE.md rule 5).
 */
@Injectable()
export class CommissionsService {
  private readonly logger = new Logger("Commissions");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly books: LedgerService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Everything HR → Commissions shows: the last twelve months of statements, every plan version,
   * assignments, the company's members by name and invoice numbers. The base of a line on a gross
   * margin plan is margin dollars, so it is hidden without `sales.margin.view_sensitive`.
   */
  async data(tenant: TenantContext, access: RequestAccess): Promise<CommissionData> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const book = await loadCommissionBook(db, this.control.db, clock.zone, clock.day);
    const statements = access.permissions.has("sales.margin.view_sensitive") ? book.rows : hideMarginBase(book.rows);
    return {
      statements,
      plans: [...book.inputs.plans],
      assignments: [...book.inputs.assignments],
      people: await this.people(db),
      invoices: book.inputs.invoices.map(({ id, number, salesRepId, isReturn, voidedAt }) => ({
        id,
        number,
        salesRepId,
        isReturn,
        voidedAt,
      })),
    };
  }

  /**
   * Commission per person for a date range, for Sales → Team (commissions.md rule 17,
   * `teamCommission`): everyone for data scope `all`; otherwise the viewer, whole, and the reps on
   * the invoices their scope covers, counting only those invoices' lines, so a branch manager never
   * sees what a rep earned in another branch.
   */
  async totals(
    tenant: TenantContext,
    access: RequestAccess,
    range: { from: string; to: string },
  ): Promise<[string, TeamCommission][]> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const book = await loadCommissionBook(db, this.control.db, clock.zone, clock.day);
    const paid = new Set(
      book.statements.filter((s) => s.status === "paid").map((s) => statementKey(s.userId, s.month)),
    );
    if (access.dataScope === "all") return [...commissionTotals(book.lines, paid, range).entries()];
    const inScope = book.inputs.invoices.filter((i) =>
      scopeAllows(
        access.dataScope,
        { userId: access.userId, branchId: access.branchId },
        { ownerUserId: i.salesRepId, branchId: i.branchId },
      ),
    );
    const invoiceIds = new Set(inScope.map((i) => i.id));
    const reps = new Set(inScope.map((i) => i.salesRepId));
    const lines = book.lines.filter(
      (l) => l.userId === access.userId || (reps.has(l.userId) && invoiceIds.has(l.invoiceId)),
    );
    return [...commissionTotals(lines, paid, range).entries()];
  }

  /**
   * Approves a month's statement (commissions.md "To approved"; ADR 0048). The month has ended, the
   * statement is open, no reversal waits for review and every earlier month with commission is
   * approved (`statementApprovalProblem`). Nobody approves their own statement, the Owner included;
   * nobody approves one carrying an override on someone whose manager its own person set
   * (`selfMadeManager`), the Owner included; nobody but the Owner approves one whose plan,
   * assignment, adjustment, reversal decision or sale split they set (`checkApprover`), and the
   * approver's sign-in must be linked. The payable is
   * accrued (debit Commissions, credit Accrued Payroll) and is what the next pay run pays.
   */
  async approve(tenant: TenantContext, actor: Actor, userId: string, month: string): Promise<CommissionStatement> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const result = await db.transaction(async (tx) => {
      await tx.execute(PAYROLL_LOCK);
      await requireLinkedDecider(tx, actor.access);
      if ((await this.selfUsers(tx, actor))(userId)) throw refuse("Someone else must approve your own statement.");
      const [stored] = await tx
        .select()
        .from(commissionStatements)
        .where(and(eq(commissionStatements.userId, userId), eq(commissionStatements.month, month)))
        .for("update");
      if (stored && stored.status !== "draft") throw refuse("This statement is already approved.");
      const book = await loadCommissionBook(tx, this.control.db, clock.zone, clock.day);
      const problem = statementApprovalProblem(book.rows, userId, month, clock.day);
      if (problem) throw refuse(problem);
      const row = book.rows.find((r) => r.userId === userId && r.month === month)!;
      if (await this.selfMadeManager(tx, row)) {
        throw refuse(
          "This statement's own person set the manager of someone whose override is on it. Someone else must set that manager again first.",
        );
      }
      if (!actor.access.isOwner) await this.checkApprover(tx, actor.access.userId, row, book);
      const locationId = await this.payrollHome(tx, userId, row.payable);
      const now = await databaseNow(tx);
      const values = {
        status: "approved" as const,
        approvedById: actor.access.userId,
        approvedAt: now,
        updatedAt: now,
      };
      const [saved] = stored
        ? await tx.update(commissionStatements).set(values).where(eq(commissionStatements.id, stored.id)).returning()
        : await tx
            .insert(commissionStatements)
            .values({ userId, month, payPeriodId: null, createdBy: actor.access.userId, ...values })
            .returning();
      await this.books.post(
        tx,
        commissionStatementPosting({ id: saved!.id, month }, row.payable, locationId),
        actor.access.userId,
      );
      // No amount in the log: commission is pay (CLAUDE.md rule 5; ADR 0047 "Sensitive data and audit").
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Approved commission statement",
        targetType: "commission_statement",
        targetId: saved!.id,
        targetLabel: `${row.name}, ${month}`,
        before: { status: "draft" },
        after: { status: "approved", month },
      });
      return { saved: saved!, name: row.name };
    });
    await this.tellRep(tenant, actor, db, result.saved.id, userId, month);
    const names = await loadNames(this.control.db, [actor.access.userId]);
    return {
      id: result.saved.id,
      userId,
      month,
      status: "approved",
      approvedBy: names.get(actor.access.userId) ?? "",
      approvedAt: result.saved.approvedAt!.toISOString().slice(0, 16),
      payPeriodId: null,
    };
  }

  /**
   * Adds a manual change to an open statement (commissions.md rule 12, `adjustmentProblem`): never
   * one's own, on a month after the person's last approved one (`frozenThrough`), a deduction naming
   * an invoice of theirs. It posts nothing by itself; it nets into the statement, which posts when
   * approved (ADR 0048). Its maker may not approve that statement.
   */
  async adjust(tenant: TenantContext, actor: Actor, input: AdjustmentFields): Promise<void> {
    const problem = adjustmentProblem(input.amount, input.reason, input.invoiceId);
    if (problem) throw refuse(problem);
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      await this.openMonth(tx, actor, input.userId, input.month, clock.day);
      if (input.invoiceId) await this.repsInvoice(tx, input.invoiceId, input.userId);
      const amount = moneyString(input.amount);
      const now = await databaseNow(tx);
      const [row] = await tx
        .insert(commissionAdjustments)
        .values({
          userId: input.userId,
          month: input.month,
          amount,
          invoiceId: input.invoiceId,
          reason: input.reason.trim(),
          byUserId: actor.access.userId,
          at: now,
          createdBy: actor.access.userId,
        })
        .returning();
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Adjusted commission statement",
        targetType: "commission_statement",
        targetId: row!.id,
        targetLabel: `${await this.nameOf(input.userId)}, ${input.month}`,
        before: null,
        after: {
          month: input.month,
          kind: dec(amount).lt(0) ? "deduction" : "addition",
          invoiceId: input.invoiceId,
          reason: input.reason.trim(),
        },
      });
    });
  }

  /**
   * Accepts or waives a reversal that arrived after its window (commissions.md rule 9), with a
   * reason, as an adjustment of 0.00 that records the decision. Unlike the demo, the line must be a
   * reversal waiting for review on that very statement (edge case "`decideReversal` does not check
   * the line or month"), the month must be open, and nobody decides on their own statement.
   */
  async decide(tenant: TenantContext, actor: Actor, input: DecisionFields): Promise<void> {
    const reason = input.reason.trim();
    if (reason.length < 3) throw refuse("Give a reason; it stays on the statement.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      await this.openMonth(tx, actor, input.userId, input.month, clock.day);
      const book = await loadCommissionBook(tx, this.control.db, clock.zone, clock.day);
      const row = book.rows.find((r) => r.userId === input.userId && r.month === input.month);
      const problem = reversalDecisionProblem(row, input.lineId);
      if (problem) throw refuse(problem);
      const now = await databaseNow(tx);
      const [saved] = await tx
        .insert(commissionAdjustments)
        .values({
          userId: input.userId,
          month: input.month,
          amount: "0.00",
          invoiceId: null,
          reason,
          byUserId: actor.access.userId,
          at: now,
          decides: { lineId: input.lineId, outcome: input.outcome },
          createdBy: actor.access.userId,
        })
        .returning();
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: input.outcome === "applied" ? "Accepted commission reversal" : "Waived commission reversal",
        targetType: "commission_statement",
        targetId: saved!.id,
        targetLabel: `${row!.name}, ${input.month}`,
        before: { reversal: "needs review" },
        after: { reversal: input.outcome, lineId: input.lineId, reason },
      });
    });
  }

  /**
   * Adds a plan, or saves one (commissions.md rule 13). A new plan starts today as version 1. A plan
   * that an approved or paid statement may have used (any statement from its start onward) is never
   * edited: the change becomes a new version from today, the old one retires yesterday, and its
   * people move to the new version and must sign again. A plan edited in place is signed again too
   * (`resetSignatures`). Nobody changes a plan they are on.
   */
  async savePlan(tenant: TenantContext, actor: Actor, id: string | null, fields: PlanFields): Promise<CommissionPlan> {
    const problem = commissionPlanProblem(fields);
    if (problem) throw refuse(problem);
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const values = planValues(fields);
    const name = values.name;
    const savedId = await db.transaction(async (tx) => {
      await tx.execute(PAYROLL_LOCK);
      await requireLinkedDecider(tx, actor.access);
      if (!id) {
        await this.nameFree(tx, name, 1);
        const [row] = await tx
          .insert(commissionPlans)
          .values({
            ...values,
            version: 1,
            status: "active",
            effectiveFrom: clock.day,
            createdBy: actor.access.userId,
          })
          .returning();
        await this.auditPlan(tenant, actor, tx, "Added commission plan", row!.id, name, null, values);
        return row!.id;
      }
      const [before] = await tx.select().from(commissionPlans).where(eq(commissionPlans.id, id)).for("update");
      if (!before || before.deletedAt) throw notFound("commission plan");
      if (before.status !== "active") throw refuse("Only an active plan can be changed.");
      const onIt = await tx
        .select()
        .from(commissionAssignments)
        .where(
          and(
            eq(commissionAssignments.planId, before.id),
            isNull(commissionAssignments.deletedAt),
            or(isNull(commissionAssignments.effectiveTo), gte(commissionAssignments.effectiveTo, clock.day)),
          ),
        )
        .for("update");
      const isSelf = await this.selfUsers(tx, actor);
      if (onIt.some((a) => isSelf(a.userId))) throw refuse("Someone else must change a plan you are on.");
      // A manager is paid an override on their people's sales under this plan: changing it, or
      // starting an override on it, changes their own pay (ADR 0048, never one's own).
      if (dec(before.overridePct).gt(0) || dec(values.overridePct).gt(0)) {
        if (
          await this.paysActorOverride(
            tx,
            isSelf,
            onIt.map((a) => a.userId),
          )
        ) {
          throw refuse("Someone else must change a plan that pays you an override.");
        }
      }
      const [used] = await tx
        .select({ id: commissionStatements.id })
        .from(commissionStatements)
        .where(
          and(
            isNull(commissionStatements.deletedAt),
            inArray(commissionStatements.status, ["approved", "paid"]),
            gte(commissionStatements.month, before.effectiveFrom.slice(0, 7)),
          ),
        )
        .limit(1);
      const was = planAudit(before);
      if (!used) {
        if (name !== before.name) await this.nameFree(tx, name, before.version);
        await tx
          .update(commissionPlans)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(commissionPlans.id, before.id));
        await this.auditPlan(tenant, actor, tx, "Edited commission plan", before.id, name, was, values);
        await this.resetSignatures(tenant, actor, tx, before.id);
        return before.id;
      }
      return this.newVersion(tenant, actor, tx, before, values, onIt, clock.day);
    });
    const [plan] = await loadCommissionPlans(db, [savedId]);
    return plan!;
  }

  /**
   * Puts someone on a plan from a date (commissions.md rule 14): their other assignments end the day
   * before or are replaced (`assignmentChanges`), and the new one needs signing. Never one's own; a
   * member of the company who is not disabled; an active plan already in force on that day; and only
   * after the person's last approved month, so a frozen statement's plan never changes.
   */
  async assign(tenant: TenantContext, actor: Actor, input: AssignmentFields): Promise<CommissionAssignment> {
    const db = await this.tenancy.db(tenant);
    const id = await db.transaction(async (tx) => {
      await tx.execute(PAYROLL_LOCK);
      await requireLinkedDecider(tx, actor.access);
      const isSelf = await this.selfUsers(tx, actor);
      if (isSelf(input.userId)) throw refuse("Someone else must put you on a plan.");
      await this.member(tx, input.userId);
      const [plan] = await tx.select().from(commissionPlans).where(eq(commissionPlans.id, input.planId));
      if (!plan || plan.deletedAt) throw refuse("Choose a plan.");
      if (plan.status !== "active" || plan.effectiveTo) throw refuse("Choose an active plan.");
      if (dec(plan.overridePct).gt(0) && (await this.paysActorOverride(tx, isSelf, [input.userId]))) {
        throw refuse("Someone else must put your own people on a plan that pays you an override.");
      }
      if (input.effectiveFrom < plan.effectiveFrom) throw refuse(`This plan starts on ${plan.effectiveFrom}.`);
      const frozen = await this.frozenMonth(tx, input.userId);
      if (frozen && input.effectiveFrom <= monthEnd(frozen)) {
        throw refuse(`Start the plan after ${monthEnd(frozen)}, the end of the last approved statement.`);
      }
      const existing = await tx
        .select()
        .from(commissionAssignments)
        .where(and(eq(commissionAssignments.userId, input.userId), isNull(commissionAssignments.deletedAt)))
        .for("update");
      const changes = assignmentChanges(existing, input.userId, input.effectiveFrom);
      const now = new Date();
      for (const end of changes.end) {
        await tx
          .update(commissionAssignments)
          .set({ effectiveTo: end.effectiveTo, updatedAt: now })
          .where(eq(commissionAssignments.id, end.id));
      }
      if (changes.remove.length > 0) {
        await tx
          .update(commissionAssignments)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(commissionAssignments.id, changes.remove));
      }
      const [row] = await tx
        .insert(commissionAssignments)
        .values({
          userId: input.userId,
          planId: plan.id,
          effectiveFrom: input.effectiveFrom,
          monthlyTargetOverride: input.monthlyTargetOverride,
          createdBy: actor.access.userId,
        })
        .returning();
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Assigned commission plan",
        targetType: "commission_assignment",
        targetId: row!.id,
        targetLabel: await this.nameOf(input.userId),
        before: null,
        after: {
          planId: plan.id,
          plan: plan.name,
          effectiveFrom: input.effectiveFrom,
          ownTarget: input.monthlyTargetOverride !== null,
          ended: changes.end.map((e) => e.id),
          replaced: changes.remove,
        },
      });
      return row!.id;
    });
    const assignment = (await loadCommissionAssignments(db)).find((a) => a.id === id);
    return assignment!;
  }

  /** The users who count as the acting person: their own id, and anyone linked to their own employee. */
  private async selfUsers(tx: CompanyDb, actor: Actor): Promise<IsSelfUser> {
    const [isSelf, links] = await Promise.all([selfCheck(tx, actor), employeesByUser(tx)]);
    return (userId) => {
      if (userId === actor.access.userId) return true;
      const employeeId = links.get(userId);
      return employeeId !== undefined && isSelf(employeeId);
    };
  }

  /** Whether the acting person is the manager of any of these people, so paid an override on their sales. */
  private async paysActorOverride(tx: CompanyDb, isSelf: IsSelfUser, userIds: readonly string[]): Promise<boolean> {
    const managerOf = await loadManagerOf(tx);
    return userIds.some((userId) => {
      const manager = managerOf(userId);
      return manager !== null && isSelf(manager);
    });
  }

  /**
   * The common guards of a change to a statement's month (adjustment or decision): the payroll lock,
   * a linked sign-in, never one's own, a member of the company, a real month no later than this one,
   * and after the person's last approved month (`frozenThrough`; ADR 0048).
   */
  private async openMonth(tx: CompanyDb, actor: Actor, userId: string, month: string, today: string): Promise<void> {
    await tx.execute(PAYROLL_LOCK);
    await requireLinkedDecider(tx, actor.access);
    if ((await this.selfUsers(tx, actor))(userId)) throw refuse("Someone else must change your own statement.");
    await this.member(tx, userId);
    if (!last12Months(today).includes(month)) throw refuse("Choose one of the last twelve months.");
    const frozen = await this.frozenMonth(tx, userId);
    if (frozen && month <= frozen) {
      throw refuse("This statement is approved. Put the change on the next open statement.");
    }
  }

  /** The person's last approved or paid month, read under the payroll lock. */
  private async frozenMonth(tx: CompanyDb, userId: string): Promise<string | null> {
    const rows = await tx
      .select({
        userId: commissionStatements.userId,
        month: commissionStatements.month,
        status: commissionStatements.status,
      })
      .from(commissionStatements)
      .where(and(eq(commissionStatements.userId, userId), isNull(commissionStatements.deletedAt)));
    return frozenThrough(
      rows.map((row) => ({ ...row, id: "", approvedBy: null, approvedAt: null, payPeriodId: null })),
      userId,
    );
  }

  /** A member of this company (a profile that is not removed or disabled), or 400. */
  private async member(tx: CompanyDb, userId: string): Promise<void> {
    const [profile] = await tx
      .select({ status: userProfiles.status })
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, userId), isNull(userProfiles.deletedAt)));
    if (!profile || profile.status === "disabled") throw refuse("Choose someone in this company.");
  }

  /** A deduction names a live invoice of that person: theirs as rep or in its commission split. */
  private async repsInvoice(tx: CompanyDb, invoiceId: string, userId: string): Promise<void> {
    const [invoice] = await tx
      .select({ salesRepId: invoices.salesRepId, isReturn: invoices.isReturn, voidedAt: invoices.voidedAt })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)));
    if (!invoice || invoice.isReturn || invoice.voidedAt) throw refuse("Choose a live invoice.");
    if (invoice.salesRepId === userId) return;
    const [share] = await tx
      .select({ id: invoiceCommissionSplits.id })
      .from(invoiceCommissionSplits)
      .where(
        and(
          eq(invoiceCommissionSplits.invoiceId, invoiceId),
          eq(invoiceCommissionSplits.userId, userId),
          isNull(invoiceCommissionSplits.deletedAt),
        ),
      )
      .limit(1);
    if (!share) throw refuse("Choose an invoice this person sold.");
  }

  /**
   * Where approved commission is booked, and a check it can be paid (hr.md rule 19): a statement
   * that pays something needs the person's sign-in linked to a W-2 employee, since commission is
   * paid through a pay run; their home location carries the expense. Nothing to pay needs neither.
   */
  private async payrollHome(tx: CompanyDb, userId: string, payable: string): Promise<string | null> {
    if (!dec(payable).gt(0)) return null;
    const employeeId = (await employeesByUser(tx)).get(userId);
    if (!employeeId) {
      throw refuse("Link this person's sign-in to their employee record first: commission is paid through payroll.");
    }
    const employee = await lockEmployee(tx, employeeId);
    if (employee.workerType !== "w2") throw refuse("Commission is paid through payroll, which pays W-2 staff only.");
    return employee.homeLocationId;
  }

  /**
   * Separation of duties at approval (ADR 0048), waived for the Owner as in HR: nobody approves a
   * statement they shaped. That is an adjustment or reversal decision on it, the assignment or plan
   * behind any of its months' figures (rows they created, or "Assigned", "Edited" and "Published"
   * audit entries, which are append-only), the commission split of a sale in it (a live split they
   * set, or a "Changed commission split" entry, so setting and clearing one still counts), or the
   * manager or the sign-in link of its person or of anyone whose override is on it (`setManagerOf`,
   * `changedLinkOf`). The assignments
   * checked are the person's and those of everyone whose override is on the statement.
   */
  private async checkApprover(
    tx: CompanyDb,
    approverId: string,
    row: CommissionStatementRow,
    book: CommissionBook,
  ): Promise<void> {
    const [adjusted] = await tx
      .select({ id: commissionAdjustments.id })
      .from(commissionAdjustments)
      .where(
        and(
          eq(commissionAdjustments.userId, row.userId),
          eq(commissionAdjustments.month, row.month),
          eq(commissionAdjustments.byUserId, approverId),
          isNull(commissionAdjustments.deletedAt),
        ),
      )
      .limit(1);
    if (adjusted) throw refuse("Someone else must approve a statement you adjusted or decided a reversal on.");
    const first = `${row.month}-01`;
    const last = monthEnd(row.month);
    // The person's own assignments, and those of everyone whose override is on the statement: their
    // plan sets the override (second security review of PR #27).
    const people = new Set([row.userId, ...subjectsOf(row)]);
    const assignments = book.inputs.assignments.filter(
      (a) => people.has(a.userId) && a.effectiveFrom <= last && (!a.effectiveTo || a.effectiveTo >= first),
    );
    const planIds = [...new Set([...assignments.map((a) => a.planId), ...row.lines.map((l) => l.planId)])];
    const assignmentIds = assignments.map((a) => a.id);
    const [madeAssignment] = assignmentIds.length
      ? await tx
          .select({ id: commissionAssignments.id })
          .from(commissionAssignments)
          .where(and(inArray(commissionAssignments.id, assignmentIds), eq(commissionAssignments.createdBy, approverId)))
          .limit(1)
      : [];
    if (madeAssignment || (await this.changed(tx, approverId, "commission_assignment", assignmentIds))) {
      throw refuse("Someone else must approve a statement under a plan assignment you made.");
    }
    const [madePlan] = planIds.length
      ? await tx
          .select({ id: commissionPlans.id })
          .from(commissionPlans)
          .where(and(inArray(commissionPlans.id, planIds), eq(commissionPlans.createdBy, approverId)))
          .limit(1)
      : [];
    if (madePlan || (await this.changed(tx, approverId, "commission_plan", planIds))) {
      throw refuse("Someone else must approve a statement under a plan you added or changed.");
    }
    const invoiceIds = [...new Set(row.lines.map((l) => l.invoiceId))];
    const [split] = invoiceIds.length
      ? await tx
          .select({ id: invoiceCommissionSplits.id })
          .from(invoiceCommissionSplits)
          .where(
            and(
              inArray(invoiceCommissionSplits.invoiceId, invoiceIds),
              eq(invoiceCommissionSplits.createdBy, approverId),
              isNull(invoiceCommissionSplits.deletedAt),
            ),
          )
          .limit(1)
      : [];
    // A split set and then cleared leaves no live row, but its audit entry stays (append-only).
    const [splitChange] = invoiceIds.length
      ? await tx
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.targetType, "invoice"),
              eq(auditLog.action, "Changed commission split"),
              eq(auditLog.actorUserId, approverId),
              inArray(auditLog.targetId, invoiceIds),
            ),
          )
          .limit(1)
      : [];
    if (split || splitChange) {
      throw refuse("Someone else must approve a statement on a sale whose commission split you set.");
    }
    if (await this.setManagerOf(tx, approverId, row)) {
      throw refuse("Someone else must approve a statement whose override you shaped by setting a manager.");
    }
    if (await this.changedLinkOf(tx, approverId, row)) {
      throw refuse("Someone else must approve a statement whose person's sign-in link you changed.");
    }
  }

  /**
   * Whether the approver changed the sign-in link of the statement's person or of anyone whose
   * override is on it (third security review of PR #27; ADR 0048): commission is paid to the
   * employee the sign-in is linked to, so a re-link moves it to another employee. Read from "Added
   * employee" and "Edited employee" entries (append-only), which carry `userId` before and after
   * (people.service.ts `save`): an entry on an employee now linked to one of them, or naming one of
   * them as the old or new link. The window runs from the latest approval of another of the
   * person's statements by someone else, who saw the link as it then was; with none it is open-ended.
   */
  private async changedLinkOf(tx: CompanyDb, approverId: string, row: CommissionStatementRow): Promise<boolean> {
    const people = new Set([row.userId, ...subjectsOf(row)]);
    const links = await employeesByUser(tx);
    const employeeIds = new Set([...people].flatMap((userId) => links.get(userId) ?? []));
    const [latest] = await tx
      .select({ at: max(commissionStatements.approvedAt) })
      .from(commissionStatements)
      .where(
        and(
          eq(commissionStatements.userId, row.userId),
          ne(commissionStatements.month, row.month),
          inArray(commissionStatements.status, ["approved", "paid"]),
          ne(commissionStatements.approvedById, approverId),
          isNull(commissionStatements.deletedAt),
        ),
      );
    const entries = await tx
      .select({ targetId: auditLog.targetId, before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actorUserId, approverId),
          eq(auditLog.targetType, "employee"),
          inArray(auditLog.action, ["Added employee", "Edited employee"]),
          latest?.at ? gte(auditLog.at, latest.at) : undefined,
        ),
      );
    const linkIn = (value: unknown) => ((value ?? {}) as { userId?: string | null }).userId ?? null;
    return entries.some((entry) => {
      const was = linkIn(entry.before);
      const now = linkIn(entry.after);
      if (was === now) return false;
      return (
        (entry.targetId !== null && employeeIds.has(entry.targetId)) ||
        (was !== null && people.has(was)) ||
        (now !== null && people.has(now))
      );
    });
  }

  /**
   * Whether the approver set the manager of the statement's person or of anyone whose override is on
   * it (ADR 0048): `managerId` decides who is paid an override, so moving someone under a manager
   * shapes that manager's statement. Read from "Added employee" and "Edited employee" entries
   * (append-only), which carry `managerId` before and after (people.service.ts `save`).
   */
  private async setManagerOf(tx: CompanyDb, approverId: string, row: CommissionStatementRow): Promise<boolean> {
    const changes = await managerChanges(tx, [row.userId, ...subjectsOf(row)]);
    return changes.some((change) => change.actorUserId === approverId);
  }

  /**
   * Whether the statement's own person was the last to set the manager of anyone whose override is
   * on it (second security review of PR #27; ADR 0048): they made themselves, or someone, the one
   * paid. It binds every approver, the Owner too, until someone else sets that manager again (the
   * latest change is then theirs). Only the Owner may reorganise such people now, and nobody makes
   * themselves their manager (people.service.ts `checkCommissionPeople`), so this catches changes
   * made before those rules.
   */
  private async selfMadeManager(tx: CompanyDb, row: CommissionStatementRow): Promise<boolean> {
    const subjects = subjectsOf(row);
    if (subjects.length === 0) return false;
    const latest = new Map<string, string | null>();
    for (const change of await managerChanges(tx, subjects)) latest.set(change.employeeId, change.actorUserId);
    return [...latest.values()].some((actorUserId) => actorUserId === row.userId);
  }

  /** Whether the approver has an audit entry on any of these plans or assignments (append-only). */
  private async changed(
    tx: CompanyDb,
    approverId: string,
    targetType: "commission_assignment" | "commission_plan",
    ids: readonly string[],
  ): Promise<boolean> {
    if (ids.length === 0) return false;
    const [changed] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetType, targetType),
          inArray(auditLog.targetId, [...ids]),
          eq(auditLog.actorUserId, approverId),
        ),
      )
      .limit(1);
    return changed !== undefined;
  }

  /**
   * Publishes a new version of a used plan from today (commissions.md rule 13): the old one retires
   * yesterday; people still on it move to the new version from today, unsigned. An assignment that
   * starts later moves as it is. Returns the new version's id.
   */
  private async newVersion(
    tenant: TenantContext,
    actor: Actor,
    tx: CompanyDb,
    before: typeof commissionPlans.$inferSelect,
    values: ReturnType<typeof planValues>,
    onIt: readonly (typeof commissionAssignments.$inferSelect)[],
    today: string,
  ): Promise<string> {
    await this.nameFree(tx, values.name, before.version + 1);
    const yesterday = addDays(today, -1);
    const now = new Date();
    await tx
      .update(commissionPlans)
      .set({ status: "retired", effectiveTo: yesterday, updatedAt: now })
      .where(eq(commissionPlans.id, before.id));
    const [next] = await tx
      .insert(commissionPlans)
      .values({
        ...values,
        version: before.version + 1,
        status: "active",
        effectiveFrom: today,
        createdBy: actor.access.userId,
      })
      .returning();
    for (const a of onIt) {
      const reset = { planId: next!.id, acknowledgedName: null, acknowledgedAt: null, updatedAt: now };
      const label = await this.nameOf(a.userId);
      if (a.effectiveFrom >= today) {
        await tx.update(commissionAssignments).set(reset).where(eq(commissionAssignments.id, a.id));
        await this.auditMove(tenant, actor, tx, a.id, label, { planId: before.id }, { planId: next!.id });
        continue;
      }
      await tx
        .update(commissionAssignments)
        .set({ effectiveTo: yesterday, updatedAt: now })
        .where(eq(commissionAssignments.id, a.id));
      await this.auditMove(
        tenant,
        actor,
        tx,
        a.id,
        label,
        { planId: before.id, effectiveTo: a.effectiveTo },
        { planId: before.id, effectiveTo: yesterday },
      );
      const [moved] = await tx
        .insert(commissionAssignments)
        .values({
          userId: a.userId,
          planId: next!.id,
          effectiveFrom: today,
          effectiveTo: a.effectiveTo,
          monthlyTargetOverride: a.monthlyTargetOverride,
          createdBy: actor.access.userId,
        })
        .returning({ id: commissionAssignments.id });
      await this.auditMove(tenant, actor, tx, moved!.id, label, null, {
        planId: next!.id,
        effectiveFrom: today,
        effectiveTo: a.effectiveTo,
        ownTarget: a.monthlyTargetOverride !== null,
      });
    }
    await auditHr(this.auditLog, tenant, actor, tx, {
      action: "Published new version of commission plan",
      targetType: "commission_plan",
      targetId: next!.id,
      targetLabel: values.name,
      before: { planId: before.id, version: before.version },
      after: { version: before.version + 1, effectiveFrom: today, moved: onIt.length },
    });
    return next!.id;
  }

  /**
   * Audits one assignment a new plan version moved, ended or created (CLAUDE.md rule 10), with no
   * amount: the target only as whether the person has their own.
   */
  private auditMove(
    tenant: TenantContext,
    actor: Actor,
    tx: CompanyDb,
    assignmentId: string,
    label: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): Promise<void> {
    return auditHr(this.auditLog, tenant, actor, tx, {
      action: "Moved commission assignment to new plan version",
      targetType: "commission_assignment",
      targetId: assignmentId,
      targetLabel: label,
      before,
      after,
    });
  }

  /**
   * After a plan is edited in place, everyone who signed it signs again (commissions.md rule 13,
   * as a new version does; second security review of PR #27): a signature is for the terms read.
   * Each cleared signature is audited, with no amount.
   */
  private async resetSignatures(tenant: TenantContext, actor: Actor, tx: CompanyDb, planId: string): Promise<void> {
    const signed = await tx
      .update(commissionAssignments)
      .set({ acknowledgedName: null, acknowledgedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(commissionAssignments.planId, planId),
          isNull(commissionAssignments.deletedAt),
          isNotNull(commissionAssignments.acknowledgedAt),
        ),
      )
      .returning({ id: commissionAssignments.id, userId: commissionAssignments.userId });
    for (const a of signed) {
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Cleared commission plan signature after plan edit",
        targetType: "commission_assignment",
        targetId: a.id,
        targetLabel: await this.nameOf(a.userId),
        before: { signed: true },
        after: { signed: false, planId },
      });
    }
  }

  /** A plan name and version not taken yet (`commission_plans_version_uidx`). */
  private async nameFree(tx: CompanyDb, name: string, version: number): Promise<void> {
    const [taken] = await tx
      .select({ id: commissionPlans.id })
      .from(commissionPlans)
      .where(and(eq(commissionPlans.name, name), eq(commissionPlans.version, version)))
      .limit(1);
    if (taken) throw refuse("Another plan already has this name.");
  }

  private auditPlan(
    tenant: TenantContext,
    actor: Actor,
    tx: CompanyDb,
    action: string,
    id: string,
    name: string,
    before: Record<string, unknown> | null,
    after: ReturnType<typeof planValues>,
  ): Promise<void> {
    return auditHr(this.auditLog, tenant, actor, tx, {
      action,
      targetType: "commission_plan",
      targetId: id,
      targetLabel: name,
      before,
      after: { ...after },
    });
  }

  /** Members of the company by name, for the Assign picker. */
  private async people(db: CompanyDb): Promise<CommissionPerson[]> {
    const profiles = await db
      .select({ userId: userProfiles.userId, status: userProfiles.status })
      .from(userProfiles)
      .where(isNull(userProfiles.deletedAt));
    const names = await loadNames(
      this.control.db,
      profiles.map((p) => p.userId),
    );
    return profiles
      .map((p) => ({ id: p.userId, name: names.get(p.userId) ?? "", active: p.status !== "disabled" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async nameOf(userId: string): Promise<string> {
    return (await loadNames(this.control.db, [userId])).get(userId) ?? "Former employee";
  }

  /**
   * Tells the rep their statement is ready (commissions.md "Events", `commission.ready`): email and
   * in-app, restricted, with no amounts. After the commit; a failure never undoes the approval.
   */
  private async tellRep(
    tenant: TenantContext,
    actor: Actor,
    db: CompanyDb,
    statementId: string,
    userId: string,
    month: string,
  ): Promise<void> {
    try {
      const [profile] = await db
        .select({ status: userProfiles.status })
        .from(userProfiles)
        .where(and(eq(userProfiles.userId, userId), isNull(userProfiles.deletedAt)));
      if (profile?.status !== "active") return;
      const [person] = await this.control.db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId));
      if (!person) return;
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "commission.ready",
        source: { type: "commission", id: statementId },
        to: [{ kind: "user", id: person.id, name: person.name, email: person.email }],
        inApp: [
          { userId: person.id, title: `Your commission statement for ${month} is ready`, href: "/my/commission" },
        ],
        values: { "employee.name": person.name, "statement.month": month },
        restricted: true,
      });
    } catch {
      this.logger.warn("A commission statement was approved, but the rep could not be told.");
    }
  }
}

/** The people whose override is on a statement (`subjectUserId` of its override lines). */
function subjectsOf(row: CommissionStatementRow): string[] {
  return [...new Set(row.lines.flatMap((l) => (l.subjectUserId ? [l.subjectUserId] : [])))];
}

/** One change of a person's manager, as the audit log recorded it. */
interface ManagerChange {
  employeeId: string;
  actorUserId: string | null;
}

/**
 * Every change of these people's manager, oldest first, read from "Added employee" and "Edited
 * employee" entries (append-only), which carry `managerId` before and after (people.service.ts
 * `save`). `managerId` decides who is paid an override (ADR 0048). People by user id, through
 * their linked employee.
 */
async function managerChanges(tx: CompanyDb, userIds: readonly string[]): Promise<ManagerChange[]> {
  const links = await employeesByUser(tx);
  const employeeIds = [...new Set(userIds.flatMap((userId) => links.get(userId) ?? []))];
  if (employeeIds.length === 0) return [];
  const entries = await tx
    .select({
      targetId: auditLog.targetId,
      actorUserId: auditLog.actorUserId,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.targetType, "employee"),
        inArray(auditLog.targetId, employeeIds),
        inArray(auditLog.action, ["Added employee", "Edited employee"]),
      ),
    )
    .orderBy(asc(auditLog.at), asc(auditLog.id));
  const managerIn = (value: unknown) => ((value ?? {}) as { managerId?: string | null }).managerId ?? null;
  return entries.flatMap((entry) =>
    entry.targetId && managerIn(entry.before) !== managerIn(entry.after)
      ? [{ employeeId: entry.targetId, actorUserId: entry.actorUserId }]
      : [],
  );
}

/** A plan's saved fields, as the audit log and a new version take them. */
function planValues(plan: PlanFields) {
  return {
    name: plan.name.trim(),
    basis: plan.basis,
    baseRatePct: plan.baseRatePct,
    monthlyTarget: plan.monthlyTarget,
    tierMode: plan.tierMode,
    tiers: plan.tiers,
    overridePct: plan.overridePct,
    draw: plan.draw,
    clawbackDays: plan.clawbackDays,
  };
}

/** A stored plan's fields as the audit log records them before a change. */
function planAudit(row: typeof commissionPlans.$inferSelect): Record<string, unknown> {
  return {
    name: row.name,
    basis: row.basis,
    baseRatePct: dec(row.baseRatePct).toString(),
    monthlyTarget: moneyString(row.monthlyTarget),
    tierMode: row.tierMode,
    tiers: row.tiers,
    overridePct: dec(row.overridePct).toString(),
    draw: row.draw,
    clawbackDays: row.clawbackDays,
  };
}
