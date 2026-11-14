import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  auditLog,
  bonuses,
  commissionStatements,
  employees,
  payPeriodExclusions,
  payPeriodLines,
  payPeriods,
  settings,
  timeOffEntries,
} from "@workspace/db/company";
import {
  accrualFor,
  addDays,
  bonusesInRun,
  californiaPayNote,
  commissionShortfalls,
  grossPay,
  payableEmployees,
  payFrequencyProblem,
  payrollPosting,
  payRunBlockers,
  periodFor,
  sum,
  timeOffBalance,
  timesheetFromWire,
  type Bonus,
  type Dec,
  type ContractorPayment,
  type Employee,
  type PayPeriod,
  type PayPeriodLine,
  type OvertimeRule,
  type PayRunBlocker,
  type PtoRequest,
  type TimeOffPolicy,
  type Timesheet,
} from "@workspace/shared";
import { and, asc, eq, gte, inArray, isNull, lte, max, ne } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { companyClock, refuse, type CompanyClock } from "../sales/sales-common";
import {
  commissionForRun,
  strandedCommission,
  type RunCommission,
  type StrandedCommission,
} from "./commission-records";
import { auditHr, databaseNow, inClosedPayPeriod, lockEmployee, requireLinkedDecider, PAYROLL_LOCK } from "./hr-common";
import {
  loadEmployees,
  loadHrRules,
  storedOvertimeRule,
  loadPolicies,
  loadPtoRequests,
  loadTimeOffEntries,
  loadTimesheets,
  selfCheck,
} from "./hr-records";
import {
  lineRow,
  loadBonuses,
  loadContractorPayments,
  loadPayPeriod,
  loadPayPeriods,
  loadPaySchedule,
  lockPayPeriod,
  payrollPerson,
  type PayPeriodRow,
} from "./pay-records";

/** One person's line in a run, with whether they are left out (the screens' `PayReviewRow`). */
export interface PayReviewRow {
  line: PayPeriodLine;
  employee: Employee;
  excludedReason: string | null;
}

/** One pay period to review (hr.md "Pay periods"; the screens' `PayPeriodReview`). */
export interface PayReview {
  period: PayPeriod;
  rows: PayReviewRow[];
  blockers: PayRunBlocker[];
  /** Approved commission no run can pay (ADR 0048): shown to HR, never marked paid silently. */
  strandedCommission: StrandedCommission[];
  contractors: ContractorPayment[];
  contractorNames: Record<string, string>;
  /**
   * Notes HR reads before trusting the figures: California pay rules pending payroll review while
   * their switch is on, or switched off with California staff (ADR 0050).
   */
  warnings: string[];
}

/** Fixed namespace for the id of each approval's journal entry; changing it would orphan reversals. */
const RUN_NAMESPACE = "3a0b6e42-5c1d-4f7e-9b28-6d4c1e0f9a37";

/**
 * The journal source id of one approval of a run: the period and the moment it was approved, so a
 * run that is reopened and approved again posts a new entry, and a reopen finds the one to reverse
 * from the stored `approved_at` (ADR 0047). The ledger keeps one entry per source and event.
 */
function runSourceId(periodId: string, approvedAt: Date): string {
  return uuidv5(`${periodId}:${approvedAt.toISOString()}`, RUN_NAMESPACE);
}

const label = (period: Pick<PayPeriodRow, "start" | "end">) => `${period.start} to ${period.end}`;

/**
 * The employee fields an "Edited employee" entry carries that decide whether and how much a person is
 * paid. The sign-in link (`userId`) counts too: whose approved commission a run pays the person
 * follows it (third security review of PR #27; ADR 0048).
 */
const PAY_FACTS = [
  "payType",
  "workerType",
  "flsaStatus",
  "salaryHoursPerWeek",
  "status",
  "hiredAt",
  "state",
  "userId",
] as const;

/** Whether an "Edited employee" audit entry changed someone's pay facts or their rate. */
function changedPayFacts(entry: { before: unknown; after: unknown }): boolean {
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  if (after.payRateChanged === true) return true;
  return PAY_FACTS.some((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
}

/** Everything gross pay reads for the people of a run (hr.md rule 17). */
interface RunInputs {
  sheets: Timesheet[];
  requests: PtoRequest[];
  policies: TimeOffPolicy[];
  bonuses: Bonus[];
  overtimeRule: Awaited<ReturnType<typeof loadHrRules>>["overtimeRule"];
  workweekStartDay: number;
  /** Approved, unpaid commission statements by employee (ADR 0048). */
  commission: Map<string, RunCommission>;
}

/**
 * Pay periods on the API (hr.md "Pay periods"; ADR 0047): opened on the company's pay schedule,
 * reviewed live from approved timesheets, approved time off and bonuses with the shared gross pay
 * rule, then approved (frozen lines, time-off accrual, the payroll accrual in the ledger), reopened
 * (reversed, never edited) or exported. Payroll is company-wide. Every write locks the period
 * first (approve and reopen take `PAYROLL_LOCK` before it), then employees in id order, and writes
 * audit_log in the same transaction.
 */
@Injectable()
export class PayPeriodsService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly books: LedgerService,
  ) {}

  /** Every pay period, newest first. */
  async list(tenant: TenantContext): Promise<PayPeriod[]> {
    return loadPayPeriods(await this.tenancy.db(tenant), this.control.db);
  }

  /**
   * Opens the period holding a day (today unless given) on the company's pay schedule (hr.md rule
   * 14, `ensureCurrentPeriod`), unless one with that start and frequency exists: safe to repeat.
   * Its pay date is five days after it ends. The schedule row is locked, so two calls can't open
   * the same period twice. Anyone who reads payroll may open today's period (the screen does on
   * load); an earlier one takes `hr.payroll.approve`. A period may not overlap a live one, say after
   * the pay frequency changed, since a day must be paid once (first security review of PR #26).
   */
  async open(tenant: TenantContext, actor: Actor, day: string | null): Promise<PayPeriod> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const date = day ?? clock.day;
    if (date > clock.day) throw refuse("A pay period can be opened up to today.");
    const id = await db.transaction(async (tx) => {
      await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "hr")).for("update");
      const schedule = await loadPaySchedule(tx);
      const { start, end } = periodFor(date, schedule.frequency, schedule.anchor);
      const current = periodFor(clock.day, schedule.frequency, schedule.anchor);
      if (start !== current.start && !actor.access.permissions.has("hr.payroll.approve")) {
        throw new ForbiddenException({
          code: "forbidden",
          message: "Only someone who approves payroll can open an earlier pay period.",
        });
      }
      const [existing] = await tx
        .select({ id: payPeriods.id })
        .from(payPeriods)
        .where(
          and(eq(payPeriods.start, start), eq(payPeriods.frequency, schedule.frequency), isNull(payPeriods.deletedAt)),
        );
      if (existing) return existing.id;
      const [overlapping] = await tx
        .select({ id: payPeriods.id })
        .from(payPeriods)
        .where(and(isNull(payPeriods.deletedAt), lte(payPeriods.start, end), gte(payPeriods.end, start)))
        .limit(1);
      if (overlapping) throw refuse("Another pay period already covers some of these days.");
      const [row] = await tx
        .insert(payPeriods)
        .values({
          frequency: schedule.frequency,
          start,
          end,
          payDate: addDays(end, 5),
          status: "open",
          createdBy: actor.access.userId,
        })
        .returning();
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Opened pay period",
        targetType: "pay_period",
        targetId: row!.id,
        targetLabel: label(row!),
        before: null,
        after: { frequency: row!.frequency, start, end, status: "open" },
      });
      return row!.id;
    });
    return loadPayPeriod(db, this.control.db, id);
  }

  /**
   * One run to review (hr.md "Pay periods", `reviewPayPeriod`): the frozen lines once approved,
   * otherwise every payable person's line worked out now, with the weeks that block approval.
   * People are shown with their work facts and email only (`payrollPerson`).
   */
  async review(tenant: TenantContext, id: string): Promise<PayReview> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const period = await loadPayPeriod(db, this.control.db, id);
    const people = await loadEmployees(db, this.control.db, tenant.companyId);
    const byId = new Map(people.map((e) => [e.id, e]));
    const excluded = new Map(period.excluded.map((x) => [x.employeeId, x.reason]));
    const frozen = period.status === "approved" || period.status === "exported";
    let lines: PayPeriodLine[];
    let blockers: PayRunBlocker[] = [];
    let stranded: StrandedCommission[] = [];
    const payable = payableEmployees(people, period);
    let rule: OvertimeRule;
    if (frozen) {
      lines = period.lines;
      // A frozen run reads no hours, so a missing settings row must not stop its review.
      rule = await storedOvertimeRule(db);
    } else {
      const inputs = await this.inputs(db, clock, payable, period.id);
      rule = inputs.overtimeRule;
      lines = payable.flatMap((e) => this.lineFor(e, period, inputs) ?? []);
      blockers = payRunBlockers(period, payable, inputs.sheets, new Set(excluded.keys()), inputs.workweekStartDay);
      stranded = await strandedCommission(db, this.control.db);
    }
    const contractors = await loadContractorPayments(db);
    const paidIn = (e: Employee) => lines.some((line) => line.employeeId === e.id);
    return {
      period,
      rows: lines.flatMap((line) => {
        const employee = byId.get(line.employeeId);
        if (!employee) return [];
        return [{ line, employee: payrollPerson(employee), excludedReason: excluded.get(line.employeeId) ?? null }];
      }),
      blockers,
      strandedCommission: stranded,
      contractors,
      contractorNames: Object.fromEntries(people.filter((e) => e.workerType === "1099").map((e) => [e.id, e.name])),
      // The run's W-2 people only (overtime law does not reach contractors): those on its frozen
      // lines once approved, else today's payable people. The note follows the switch as it is now
      // (ADR 0050).
      warnings: [californiaPayNote(frozen ? people.filter((e) => paidIn(e)) : payable, rule)].flatMap(
        (note) => note ?? [],
      ),
    };
  }

  /**
   * Leaves someone out of a run with a reason, or brings them back with none (hr.md "To
   * in_review"). Not on an approved or exported run, never one's own line, and only for someone in
   * the run. Audited, unlike the demo (CLAUDE.md rule 10); the audit entry also marks who shaped the
   * run, who then may not approve it (`approve`).
   */
  async setExclusion(
    tenant: TenantContext,
    actor: Actor,
    id: string,
    employeeId: string,
    reason: string | null,
  ): Promise<PayPeriod> {
    const why = reason === null ? null : reason.trim();
    if (why !== null && why.length < 3) throw refuse("Say why this person is left out.");
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const period = await lockPayPeriod(tx, id);
      if (period.status === "approved" || period.status === "exported") {
        throw refuse("This pay period is already approved.");
      }
      const employee = await lockEmployee(tx, employeeId);
      if ((await selfCheck(tx, actor))(employee.id)) throw refuse("Someone else must leave you out or bring you back.");
      await requireLinkedDecider(tx, actor.access);
      const people = await loadEmployees(tx, this.control.db, tenant.companyId, [employee.id]);
      if (payableEmployees(people, period).length === 0) throw refuse("This person is not in this pay run.");
      const now = new Date();
      await tx
        .update(payPeriodExclusions)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(payPeriodExclusions.payPeriodId, period.id),
            eq(payPeriodExclusions.employeeId, employee.id),
            isNull(payPeriodExclusions.deletedAt),
          ),
        );
      if (why !== null) {
        await tx
          .insert(payPeriodExclusions)
          .values({ payPeriodId: period.id, employeeId: employee.id, reason: why, createdBy: actor.access.userId });
      }
      await tx.update(payPeriods).set({ status: "in_review", updatedAt: now }).where(eq(payPeriods.id, period.id));
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: why === null ? "Brought back into pay period" : "Left out of pay period",
        targetType: "pay_period",
        targetId: period.id,
        targetLabel: `${employee.name}, ${label(period)}`,
        before: { status: period.status },
        after: { status: "in_review", employeeId: employee.id, reason: why },
      });
    });
    return loadPayPeriod(db, this.control.db, id);
  }

  /**
   * Approves a run (hr.md "To approved"; ADR 0047). It must have ended, the pay frequency must suit
   * the staff (rule 16), every workweek ending in it must be approved or its person left out, and
   * no other approved run may cover its days. Separation of duties, unless the approver is the
   * Owner: nobody approves a run that pays them, or one they shaped by leaving someone out, bringing
   * them back, adding a bonus in it, adding a person in it or changing their pay facts, or changing
   * whether a time-off policy is paid since someone else last approved a run; and the
   * approver's sign-in must be linked to their employee. The lines are frozen, time off accrues
   * (rule 12) and the gross pay posts to Wages against Accrued Payroll, all in one transaction.
   */
  async approve(tenant: TenantContext, actor: Actor, id: string): Promise<PayPeriod> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      await tx.execute(PAYROLL_LOCK);
      const period = await lockPayPeriod(tx, id);
      if (period.status === "approved" || period.status === "exported") {
        throw refuse("This pay period is already approved.");
      }
      if (period.end >= clock.day) throw refuse("A pay period can be approved after it ends.");
      await requireLinkedDecider(tx, actor.access);
      const payable = await this.lockPayable(tx, tenant, period);
      // A day is paid once: no other approved or exported run may cover any of these days. Checked
      // under the payroll lock with the people locked, so no other approval can slip in between.
      if (await inClosedPayPeriod(tx, period.start, period.end, period.id)) {
        throw refuse("Another approved pay period covers some of these days.");
      }
      const excluded = await this.excludedIds(tx, period.id);
      const inputs = await this.inputs(tx, clock, payable, period.id);
      const blockers = payRunBlockers(period, payable, inputs.sheets, excluded, inputs.workweekStartDay);
      if (blockers.length > 0) {
        throw refuse(`${blockers.length} timesheets still need approval, or leave those people out.`);
      }
      const included = payable.filter((e) => !excluded.has(e.id));
      await this.checkApprover(tx, actor, period, included, inputs.bonuses);
      const lines = included.flatMap((e) => this.lineFor(e, period, inputs) ?? []);
      const short = commissionShortfalls(lines);
      if (short.length > 0) {
        const names = short.map((employeeId) => included.find((e) => e.id === employeeId)?.name ?? "Someone");
        throw refuse(
          `${names.join(", ")}: unpaid leave takes gross pay below the commission this run pays. Fix the leave, or leave them out so the commission waits for the next run.`,
        );
      }
      const now = await databaseNow(tx);
      await tx
        .update(payPeriods)
        .set({ status: "approved", approvedById: actor.access.userId, approvedAt: now, updatedAt: now })
        .where(eq(payPeriods.id, period.id));
      if (lines.length > 0) {
        await tx.insert(payPeriodLines).values(lines.map((line) => lineRow(period.id, line, actor.access.userId)));
      }
      await this.postAccrual(tx, period, lines, actor.access.userId);
      await this.payStatements(tenant, actor, tx, period, included, inputs.commission);
      const homes = new Map(included.map((e) => [e.id, e.homeLocationId]));
      await this.books.post(
        tx,
        payrollPosting(
          { sourceId: runSourceId(period.id, now), period },
          lines.map((line) => ({
            grossPay: line.grossPay,
            commissionPay: line.commissionPay,
            locationId: homes.get(line.employeeId) ?? null,
          })),
        ),
        actor.access.userId,
      );
      // No amounts in the log: gross pay is for holders of hr.payroll.view (CLAUDE.md rule 5).
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Approved pay period",
        targetType: "pay_period",
        targetId: period.id,
        targetLabel: label(period),
        before: { status: period.status },
        after: { status: "approved", people: lines.length },
      });
    });
    return loadPayPeriod(db, this.control.db, id);
  }

  /**
   * Returns an approved run to review before it is exported (hr.md "approved to in_review"). Nothing
   * is edited (CLAUDE.md rule 9): the payroll entry is reversed on today's date, each accrual it
   * posted is taken back by a negative accrual line, and the frozen lines are retired. An exported
   * run can't be reopened.
   */
  async reopen(tenant: TenantContext, actor: Actor, id: string): Promise<PayPeriod> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      await tx.execute(PAYROLL_LOCK);
      const period = await lockPayPeriod(tx, id);
      if (period.status === "exported") throw refuse("An exported pay period can't be reopened.");
      if (period.status !== "approved") throw refuse("Only an approved pay period can be reopened.");
      await requireLinkedDecider(tx, actor.access);
      // People whose accrual comes back are locked before the ledger's shared lock, as approve
      // locks them (third security review of PR #26).
      await this.lockAccrualPeople(tx, period.id);
      const reversed = period.approvedAt
        ? await this.books.reverse(
            tx,
            {
              sourceType: "pay_period",
              sourceId: runSourceId(period.id, period.approvedAt),
              event: "payroll.approved",
            },
            clock.day,
            actor.access.userId,
          )
        : null;
      // A run that paid something but has no entry was approved before the books started (seeded or
      // imported): reopening it would post nothing and leave the books apart from the record, so it
      // is refused, as contractor voids are (first security review of PR #26).
      if (reversed === null && (await this.frozenGross(tx, period.id)).gt(0)) {
        throw refuse("This pay period was approved before the books started, so it can't be reopened here.");
      }
      await this.takeBackAccrual(tx, period, clock.day, actor.access.userId);
      const now = new Date();
      await tx
        .update(payPeriodLines)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(payPeriodLines.payPeriodId, period.id), isNull(payPeriodLines.deletedAt)));
      await tx
        .update(payPeriods)
        .set({ status: "in_review", approvedById: null, approvedAt: null, updatedAt: now })
        .where(eq(payPeriods.id, period.id));
      await this.moveStatements(tenant, actor, tx, period, "released");
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Reopened pay period",
        targetType: "pay_period",
        targetId: period.id,
        targetLabel: label(period),
        before: { status: "approved" },
        after: { status: "in_review" },
      });
    });
    return loadPayPeriod(db, this.control.db, id);
  }

  /**
   * Marks an approved run exported (hr.md "To exported"): it is locked for good. The payroll files
   * are built from the review by the screen; they carry no bank or Social Security data, because
   * none is stored (CLAUDE.md rule 14). Exporting again changes nothing.
   */
  async export(tenant: TenantContext, actor: Actor, id: string): Promise<PayPeriod> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const period = await lockPayPeriod(tx, id);
      if (period.status === "exported") return;
      if (period.status !== "approved") throw refuse("Approve the pay period before exporting it.");
      const now = new Date();
      await tx
        .update(payPeriods)
        .set({ status: "exported", exportedAt: now, updatedAt: now })
        .where(eq(payPeriods.id, period.id));
      await this.moveStatements(tenant, actor, tx, period, "paid");
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Exported pay period",
        targetType: "pay_period",
        targetId: period.id,
        targetLabel: label(period),
        before: { status: "approved" },
        after: { status: "exported" },
      });
    });
    return loadPayPeriod(db, this.control.db, id);
  }

  /** One person's gross pay in the run, by the shared rule, with the commission their approved statements posted (ADR 0048). */
  private lineFor(employee: Employee, period: Pick<PayPeriod, "start" | "end" | "frequency">, inputs: RunInputs) {
    return grossPay({
      employee,
      period,
      sheets: inputs.sheets.filter((s) => s.employeeId === employee.id),
      leave: inputs.requests.filter((r) => r.employeeId === employee.id),
      policies: inputs.policies,
      companyRule: inputs.overtimeRule,
      commission: inputs.commission.get(employee.id)?.amount ?? "0.00",
      bonuses: bonusesInRun(inputs.bonuses, employee.id, period),
      allocations: inputs.commission.get(employee.id)?.allocations ?? [],
    });
  }

  /**
   * Approved sheets and requests, policies, bonuses, the company's rules and the commission waiting
   * for this run (approved, unpaid statements; ADR 0048) for these people.
   */
  private async inputs(
    db: CompanyDb,
    clock: CompanyClock,
    people: readonly Employee[],
    periodId: string,
  ): Promise<RunInputs> {
    const ids = people.map((e) => e.id);
    const [rules, sheets, requests, policies, allBonuses] = await Promise.all([
      loadHrRules(db),
      ids.length ? loadTimesheets(db, this.control.db, { employeeIds: ids }) : Promise.resolve([]),
      ids.length ? loadPtoRequests(db, this.control.db, { employeeIds: ids }) : Promise.resolve([]),
      loadPolicies(db),
      loadBonuses(db, this.control.db),
    ]);
    const commission = await commissionForRun(db, this.control.db, clock, ids, periodId, rules.workweekStartDay);
    return {
      sheets: sheets.map(timesheetFromWire),
      requests,
      policies,
      bonuses: allBonuses,
      overtimeRule: rules.overtimeRule,
      workweekStartDay: rules.workweekStartDay,
      commission,
    };
  }

  /**
   * Links the approved statements a run pays to it (commissions.md: `approvePayPeriod` sets
   * `payPeriodId`), for the people paid in it only: someone left out keeps theirs waiting for the
   * next run. Each link is audited without an amount (CLAUDE.md rule 10; ADR 0048).
   */
  private async payStatements(
    tenant: TenantContext,
    actor: Actor,
    tx: CompanyDb,
    period: PayPeriodRow,
    included: readonly Employee[],
    commission: ReadonlyMap<string, RunCommission>,
  ): Promise<void> {
    const ids = included.flatMap((e) => commission.get(e.id)?.statementIds ?? []);
    if (ids.length === 0) return;
    const rows = await tx
      .update(commissionStatements)
      .set({ payPeriodId: period.id, updatedAt: new Date() })
      .where(and(inArray(commissionStatements.id, ids), eq(commissionStatements.status, "approved")))
      .returning();
    for (const row of rows) {
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Added commission statement to pay period",
        targetType: "commission_statement",
        targetId: row.id,
        targetLabel: `${row.month}, ${label(period)}`,
        before: { payPeriodId: null },
        after: { payPeriodId: period.id },
      });
    }
  }

  /**
   * What reopening or exporting a run does to the statements it pays (commissions.md "To paid"):
   * a reopen releases them to wait for the next approval (`reopenPayPeriod` clears `payPeriodId`;
   * their accrual stays, since the statement is still approved), and an export marks them paid.
   */
  private async moveStatements(
    tenant: TenantContext,
    actor: Actor,
    tx: CompanyDb,
    period: PayPeriodRow,
    move: "released" | "paid",
  ): Promise<void> {
    const rows = await tx
      .update(commissionStatements)
      .set(move === "paid" ? { status: "paid", updatedAt: new Date() } : { payPeriodId: null, updatedAt: new Date() })
      .where(
        and(
          eq(commissionStatements.payPeriodId, period.id),
          eq(commissionStatements.status, "approved"),
          isNull(commissionStatements.deletedAt),
        ),
      )
      .returning();
    for (const row of rows) {
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: move === "paid" ? "Paid commission statement" : "Released commission statement from pay period",
        targetType: "commission_statement",
        targetId: row.id,
        targetLabel: `${row.month}, ${label(period)}`,
        before: move === "paid" ? { status: "approved" } : { payPeriodId: period.id },
        after: move === "paid" ? { status: "paid" } : { payPeriodId: null },
      });
    }
  }

  /**
   * The people a run pays, locked: everyone payable is locked in id order (so hours, time off,
   * bonuses and pay facts can't change under the run; they lock the employee first), then read
   * again, so the run is worked out from the locked rows only. Someone who became payable between
   * the two reads was not locked, so the approval is refused to be tried again (first security
   * review of PR #26). The pay frequency must suit the staff (hr.md rule 16).
   */
  private async lockPayable(tx: CompanyDb, tenant: TenantContext, period: PayPeriodRow): Promise<Employee[]> {
    const seen = payableEmployees(await loadEmployees(tx, this.control.db, tenant.companyId), period);
    const locked = new Set(seen.map((e) => e.id));
    for (const employeeId of [...locked].sort()) await lockEmployee(tx, employeeId);
    const people = await loadEmployees(tx, this.control.db, tenant.companyId);
    const problem = payFrequencyProblem(period.frequency, people);
    if (problem) throw refuse(problem);
    const payable = payableEmployees(people, period);
    if (payable.some((e) => !locked.has(e.id))) {
      throw refuse("Someone was added to this pay run while it was being approved. Try again.");
    }
    return payable;
  }

  private async excludedIds(tx: CompanyDb, periodId: string): Promise<Set<string>> {
    const rows = await tx
      .select({ employeeId: payPeriodExclusions.employeeId })
      .from(payPeriodExclusions)
      .where(and(eq(payPeriodExclusions.payPeriodId, periodId), isNull(payPeriodExclusions.deletedAt)));
    return new Set(rows.map((row) => row.employeeId));
  }

  /**
   * Separation of duties at approval (ADR 0047), waived for the Owner: no line for the approver's
   * own employee (by sign-in link or verified email, `selfCheck`), and the approver neither left
   * anyone out of nor brought anyone back into this run (its audit entries, which are append-only)
   * nor added a bonus paid in it, nor added or changed the pay of anyone in it (`setPayOfAnyone`).
   */
  private async checkApprover(
    tx: CompanyDb,
    actor: Actor,
    period: PayPeriodRow,
    included: readonly Employee[],
    allBonuses: readonly Bonus[],
  ): Promise<void> {
    if (actor.access.isOwner) return;
    const isSelf = await selfCheck(tx, actor);
    if (included.some((e) => isSelf(e.id))) throw refuse("Someone else must approve a pay run that pays you.");
    const [shaped] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetType, "pay_period"),
          eq(auditLog.targetId, period.id),
          eq(auditLog.actorUserId, actor.access.userId),
          inArray(auditLog.action, ["Left out of pay period", "Brought back into pay period"]),
        ),
      )
      .limit(1);
    const bonusIds = included.flatMap((e) => bonusesInRun(allBonuses, e.id, period).map((b) => b.id));
    const added = bonusIds.length
      ? await tx
          .select({ id: bonuses.id })
          .from(bonuses)
          .where(and(inArray(bonuses.id, bonusIds), eq(bonuses.createdBy, actor.access.userId)))
          .limit(1)
      : [];
    if (shaped || added.length > 0) {
      throw refuse("Someone else must approve a pay run you changed by leaving someone out or adding a bonus.");
    }
    if (await this.setPayOfAnyone(tx, actor.access.userId, included)) {
      throw refuse("Someone else must approve a pay run that pays a person whose pay you added or changed.");
    }
    if (await this.changedPaidLeave(tx, actor.access.userId)) {
      throw refuse("Someone else must approve the next pay run after you changed whether a time-off policy is paid.");
    }
  }

  /**
   * Whether the approver added a time-off policy, or changed whether one is paid or its kind, since
   * the company's latest approval by someone else (second security review of PR #26): paid leave is
   * part of gross pay (hr.md rule 17), so a policy change shapes every run that pays leave under it.
   * Company-wide and kept simple: the window opens at that approval, or is open-ended without one.
   * Both times come from the database clock (`databaseNow`, audit `clock_timestamp()`), and
   * `savePolicy` records the policy before and after.
   */
  private async changedPaidLeave(tx: CompanyDb, approverId: string): Promise<boolean> {
    const [latest] = await tx
      .select({ at: max(payPeriods.approvedAt) })
      .from(payPeriods)
      .where(
        and(
          isNull(payPeriods.deletedAt),
          inArray(payPeriods.status, ["approved", "exported"]),
          ne(payPeriods.approvedById, approverId),
        ),
      );
    const entries = await tx
      .select({ action: auditLog.action, before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actorUserId, approverId),
          eq(auditLog.targetType, "time_off_policy"),
          inArray(auditLog.action, ["Added time-off policy", "Edited time-off policy"]),
          latest?.at ? gte(auditLog.at, latest.at) : undefined,
        ),
      );
    return entries.some((entry) => {
      if (entry.action === "Added time-off policy") return true;
      const before = (entry.before ?? {}) as Record<string, unknown>;
      const after = (entry.after ?? {}) as Record<string, unknown>;
      return before.paid !== after.paid || before.kind !== after.kind;
    });
  }

  /**
   * Whether the approver added someone in the run, or changed what decides their pay, since that
   * person's pay was last approved (first security review of PR #26): otherwise an HR manager could
   * add a salaried person, who needs no timesheet, or raise a rate, and approve the run that pays
   * it. The window per person runs from the latest approval of a run with a live line for them, so
   * a change another approver has already paid out stops counting; for someone never paid in an
   * approved run it is open-ended. Audit entries are append-only, and "Edited employee" records the
   * pay facts before and after, with only whether the rate changed (people.service.ts `save`).
   */
  private async setPayOfAnyone(tx: CompanyDb, approverId: string, included: readonly Employee[]): Promise<boolean> {
    if (included.length === 0) return false;
    const ids = included.map((e) => e.id);
    const entries = await tx
      .select({
        targetId: auditLog.targetId,
        action: auditLog.action,
        at: auditLog.at,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actorUserId, approverId),
          eq(auditLog.targetType, "employee"),
          inArray(auditLog.targetId, ids),
          inArray(auditLog.action, ["Added employee", "Edited employee"]),
        ),
      );
    const relevant = entries.filter((entry) => entry.action === "Added employee" || changedPayFacts(entry));
    if (relevant.length === 0) return false;
    const paid = await tx
      .select({ employeeId: payPeriodLines.employeeId, approvedAt: max(payPeriods.approvedAt) })
      .from(payPeriodLines)
      .innerJoin(payPeriods, eq(payPeriods.id, payPeriodLines.payPeriodId))
      .where(
        and(
          isNull(payPeriodLines.deletedAt),
          isNull(payPeriods.deletedAt),
          inArray(payPeriods.status, ["approved", "exported"]),
          inArray(payPeriodLines.employeeId, ids),
        ),
      )
      .groupBy(payPeriodLines.employeeId);
    const since = new Map(paid.map((row) => [row.employeeId, row.approvedAt]));
    return relevant.some((entry) => {
      const last = entry.targetId ? since.get(entry.targetId) : null;
      // `approved_at` is the database clock to the millisecond and `at` reads back truncated to one,
      // so an entry in the same millisecond counts as after the approval: the safe side.
      return !last || entry.at >= last;
    });
  }

  /** The gross pay of a run's live frozen lines, added as decimals. */
  private async frozenGross(tx: CompanyDb, periodId: string): Promise<Dec> {
    const rows = await tx
      .select({ grossPay: payPeriodLines.grossPay })
      .from(payPeriodLines)
      .where(and(eq(payPeriodLines.payPeriodId, periodId), isNull(payPeriodLines.deletedAt)));
    return sum(rows.map((row) => row.grossPay));
  }

  /**
   * Time off earned with the run (hr.md rule 12, `accrualFor`): per pay period and per hour worked
   * only, dated the period's last day, rounded to two decimals and skipped at zero, and linked to the
   * period so a reopen can take it back. The employees are locked already.
   */
  private async postAccrual(tx: CompanyDb, period: PayPeriodRow, lines: readonly PayPeriodLine[], by: string) {
    const policies = (await loadPolicies(tx)).filter(
      (p) => p.accrualMethod === "per_pay_period" || p.accrualMethod === "per_hour_worked",
    );
    if (policies.length === 0 || lines.length === 0) return;
    const entries = await loadTimeOffEntries(
      tx,
      lines.map((line) => line.employeeId),
    );
    const rows = lines.flatMap((line) =>
      policies.flatMap((policy) => {
        const earned = accrualFor(policy, timeOffBalance(entries, line.employeeId, policy.id), line.hoursWorked);
        const hours = earned.toDecimalPlaces(2);
        if (hours.lte(0)) return [];
        return [
          {
            employeeId: line.employeeId,
            policyId: policy.id,
            date: period.end,
            kind: "accrual" as const,
            hours: hours.toString(),
            note: "Accrued with payroll",
            payPeriodId: period.id,
            createdBy: by,
          },
        ];
      }),
    );
    if (rows.length > 0) await tx.insert(timeOffEntries).values(rows);
  }

  /**
   * Takes back what a run accrued when it is reopened. The time-off ledger is append-only, so each
   * person's net accrual for the period, per policy, is answered by a negative accrual line dated the
   * reopen day and linked to the period, and the balance returns to what it was.
   */
  /** Locks, in id order, the people a period's accrual lines belong to. */
  private async lockAccrualPeople(tx: CompanyDb, periodId: string): Promise<void> {
    const rows = await tx
      .selectDistinct({ employeeId: timeOffEntries.employeeId })
      .from(timeOffEntries)
      .where(and(eq(timeOffEntries.payPeriodId, periodId), eq(timeOffEntries.kind, "accrual")));
    for (const employeeId of rows.map((row) => row.employeeId).sort()) {
      await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).for("update");
    }
  }

  private async takeBackAccrual(tx: CompanyDb, period: PayPeriodRow, day: string, by: string): Promise<void> {
    const rows = await tx
      .select()
      .from(timeOffEntries)
      .where(and(eq(timeOffEntries.payPeriodId, period.id), eq(timeOffEntries.kind, "accrual")))
      .orderBy(asc(timeOffEntries.id));
    const net = new Map<string, { employeeId: string; policyId: string; hours: string[] }>();
    for (const row of rows) {
      const key = `${row.employeeId}|${row.policyId}`;
      const entry = net.get(key) ?? { employeeId: row.employeeId, policyId: row.policyId, hours: [] };
      entry.hours.push(row.hours);
      net.set(key, entry);
    }
    // Balances move, so the people are locked after the period and in id order, as `approve` locks them.
    // A person removed since still gets their accrual taken back, so the lock skips the live check.
    for (const employeeId of [...new Set(rows.map((row) => row.employeeId))].sort()) {
      await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).for("update");
    }
    const back = [...net.values()].flatMap((entry) => {
      const total = sum(entry.hours);
      if (total.lte(0)) return [];
      return [
        {
          employeeId: entry.employeeId,
          policyId: entry.policyId,
          date: day,
          kind: "accrual" as const,
          hours: total.negated().toString(),
          note: "Accrual taken back: pay period reopened",
          payPeriodId: period.id,
          createdBy: by,
        },
      ];
    });
    if (back.length > 0) await tx.insert(timeOffEntries).values(back);
  }
}
