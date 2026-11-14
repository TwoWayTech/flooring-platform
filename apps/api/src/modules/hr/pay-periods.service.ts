import { Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  auditLog,
  bonuses,
  commissionStatements,
  payPeriodExclusions,
  payPeriodLines,
  payPeriods,
  settings,
  timeOffEntries,
  userProfiles,
} from "@workspace/db/company";
import {
  accrualFor,
  addDays,
  bonusesInRun,
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
  type ContractorPayment,
  type Employee,
  type PayPeriod,
  type PayPeriodLine,
  type PayRunBlocker,
  type PtoRequest,
  type TimeOffPolicy,
  type Timesheet,
} from "@workspace/shared";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { companyClock, refuse } from "../sales/sales-common";
import { auditHr, lockEmployee, requireLinkedDecider } from "./hr-common";
import {
  loadEmployees,
  loadHrRules,
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
  contractors: ContractorPayment[];
  contractorNames: Record<string, string>;
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

/** Everything gross pay reads for the people of a run (hr.md rule 17). */
interface RunInputs {
  sheets: Timesheet[];
  requests: PtoRequest[];
  policies: TimeOffPolicy[];
  bonuses: Bonus[];
  overtimeRule: Awaited<ReturnType<typeof loadHrRules>>["overtimeRule"];
  workweekStartDay: number;
}

/**
 * Pay periods on the API (hr.md "Pay periods"; ADR 0047): opened on the company's pay schedule,
 * reviewed live from approved timesheets, approved time off and bonuses with the shared gross pay
 * rule, then approved (frozen lines, time-off accrual, the payroll accrual in the ledger), reopened
 * (reversed, never edited) or exported. Payroll is company-wide. Every write locks the period
 * first, then employees in id order, and writes audit_log in the same transaction.
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
   * the same period twice.
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
      const [existing] = await tx
        .select({ id: payPeriods.id })
        .from(payPeriods)
        .where(
          and(eq(payPeriods.start, start), eq(payPeriods.frequency, schedule.frequency), isNull(payPeriods.deletedAt)),
        );
      if (existing) return existing.id;
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
    const period = await loadPayPeriod(db, this.control.db, id);
    const people = await loadEmployees(db, this.control.db, tenant.companyId);
    const byId = new Map(people.map((e) => [e.id, e]));
    const excluded = new Map(period.excluded.map((x) => [x.employeeId, x.reason]));
    const frozen = period.status === "approved" || period.status === "exported";
    let lines: PayPeriodLine[];
    let blockers: PayRunBlocker[] = [];
    if (frozen) {
      lines = period.lines;
    } else {
      const payable = payableEmployees(people, period);
      const inputs = await this.inputs(db, payable);
      lines = payable.flatMap((e) => this.lineFor(e, period, inputs) ?? []);
      blockers = payRunBlockers(period, payable, inputs.sheets, new Set(excluded.keys()), inputs.workweekStartDay);
    }
    const contractors = await loadContractorPayments(db);
    return {
      period,
      rows: lines.flatMap((line) => {
        const employee = byId.get(line.employeeId);
        if (!employee) return [];
        return [{ line, employee: payrollPerson(employee), excludedReason: excluded.get(line.employeeId) ?? null }];
      }),
      blockers,
      contractors,
      contractorNames: Object.fromEntries(people.filter((e) => e.workerType === "1099").map((e) => [e.id, e.name])),
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
   * the staff (rule 16), and every workweek ending in it must be approved or its person left out.
   * Separation of duties, unless the approver is the Owner: nobody approves a run that pays them,
   * or one they shaped by leaving someone out, bringing them back or adding a bonus in it; and the
   * approver's sign-in must be linked to their employee. The lines are frozen, time off accrues
   * (rule 12) and the gross pay posts to Wages against Accrued Payroll, all in one transaction.
   */
  async approve(tenant: TenantContext, actor: Actor, id: string): Promise<PayPeriod> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const period = await lockPayPeriod(tx, id);
      if (period.status === "approved" || period.status === "exported") {
        throw refuse("This pay period is already approved.");
      }
      if (period.end >= clock.day) throw refuse("A pay period can be approved after it ends.");
      await requireLinkedDecider(tx, actor.access);
      const people = await loadEmployees(tx, this.control.db, tenant.companyId);
      const problem = payFrequencyProblem(period.frequency, people);
      if (problem) throw refuse(problem);
      const payable = payableEmployees(people, period);
      // Hours, time off and bonuses can't change under the run (they lock the employee first).
      for (const employeeId of payable.map((e) => e.id).sort()) await lockEmployee(tx, employeeId);
      const excluded = await this.excludedIds(tx, period.id);
      const inputs = await this.inputs(tx, payable);
      const blockers = payRunBlockers(period, payable, inputs.sheets, excluded, inputs.workweekStartDay);
      if (blockers.length > 0) {
        throw refuse(`${blockers.length} timesheets still need approval, or leave those people out.`);
      }
      const included = payable.filter((e) => !excluded.has(e.id));
      await this.checkApprover(tx, actor, period, included, inputs.bonuses);
      await this.checkCommission(tx, included);
      const lines = included.flatMap((e) => this.lineFor(e, period, inputs) ?? []);
      const now = new Date();
      await tx
        .update(payPeriods)
        .set({ status: "approved", approvedById: actor.access.userId, approvedAt: now, updatedAt: now })
        .where(eq(payPeriods.id, period.id));
      if (lines.length > 0) {
        await tx.insert(payPeriodLines).values(lines.map((line) => lineRow(period.id, line, actor.access.userId)));
      }
      await this.postAccrual(tx, period, lines, actor.access.userId);
      const homes = new Map(included.map((e) => [e.id, e.homeLocationId]));
      await this.books.post(
        tx,
        payrollPosting(
          { sourceId: runSourceId(period.id, now), period },
          lines.map((line) => ({ grossPay: line.grossPay, locationId: homes.get(line.employeeId) ?? null })),
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
      const period = await lockPayPeriod(tx, id);
      if (period.status === "exported") throw refuse("An exported pay period can't be reopened.");
      if (period.status !== "approved") throw refuse("Only an approved pay period can be reopened.");
      await requireLinkedDecider(tx, actor.access);
      if (period.approvedAt) {
        await this.books.reverse(
          tx,
          { sourceType: "pay_period", sourceId: runSourceId(period.id, period.approvedAt), event: "payroll.approved" },
          clock.day,
          actor.access.userId,
        );
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

  /** One person's gross pay in the run, by the shared rule; commission joins with the commissions task. */
  private lineFor(employee: Employee, period: Pick<PayPeriod, "start" | "end" | "frequency">, inputs: RunInputs) {
    return grossPay({
      employee,
      period,
      sheets: inputs.sheets.filter((s) => s.employeeId === employee.id),
      leave: inputs.requests.filter((r) => r.employeeId === employee.id),
      policies: inputs.policies,
      companyRule: inputs.overtimeRule,
      commission: "0.00",
      bonuses: bonusesInRun(inputs.bonuses, employee.id, period),
      allocations: [],
    });
  }

  /** Approved sheets and requests, policies, bonuses and the company's rules for these people. */
  private async inputs(db: CompanyDb, people: readonly Employee[]): Promise<RunInputs> {
    const ids = people.map((e) => e.id);
    const [rules, sheets, requests, policies, allBonuses] = await Promise.all([
      loadHrRules(db),
      ids.length ? loadTimesheets(db, this.control.db, { employeeIds: ids }) : Promise.resolve([]),
      ids.length ? loadPtoRequests(db, this.control.db, { employeeIds: ids }) : Promise.resolve([]),
      loadPolicies(db),
      loadBonuses(db, this.control.db),
    ]);
    return {
      sheets: sheets.map(timesheetFromWire),
      requests,
      policies,
      bonuses: allBonuses,
      overtimeRule: rules.overtimeRule,
      workweekStartDay: rules.workweekStartDay,
    };
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
   * nor added a bonus paid in it.
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
  }

  /**
   * Commission is paid through a run (hr.md rule 19), but commission statements move to the API
   * with the commissions task. Until then a run that would pay someone with an approved, unpaid
   * statement is refused rather than approved without it (ADR 0047).
   */
  private async checkCommission(tx: CompanyDb, included: readonly Employee[]): Promise<void> {
    if (included.length === 0) return;
    const [waiting] = await tx
      .select({ id: commissionStatements.id })
      .from(commissionStatements)
      .innerJoin(userProfiles, eq(userProfiles.userId, commissionStatements.userId))
      .where(
        and(
          eq(commissionStatements.status, "approved"),
          isNull(commissionStatements.payPeriodId),
          isNull(commissionStatements.deletedAt),
          isNull(userProfiles.deletedAt),
          inArray(
            userProfiles.employeeId,
            included.map((e) => e.id),
          ),
        ),
      )
      .limit(1);
    if (waiting) {
      throw refuse(
        "An approved commission statement waits for this run. Commission joins pay runs with the commissions update.",
      );
    }
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
