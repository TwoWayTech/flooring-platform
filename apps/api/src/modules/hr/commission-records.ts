import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { CompanyDb, ControlDb } from "@workspace/db";
import {
  auditLog,
  commissionAdjustments,
  commissionAssignments,
  commissionPlans,
  commissionStatements,
  employeeManagerHistory,
  employees,
  journalEntries,
  journalLines,
  ledgerAccounts,
  userProfiles,
} from "@workspace/db/company";
import {
  commissionAllocations,
  commissionDecisions,
  commissionLines,
  commissionStatementRows,
  dec,
  featureOn,
  managerOn,
  managerSelfSetOn,
  moneyString,
  statementKey,
  sum,
  type CommissionAdjustment,
  type CommissionAssignment,
  type CommissionInputs,
  type CommissionLine,
  type CommissionPlan,
  type CommissionStatement,
  type CommissionStatementRow,
  type ManagerHistoryRow,
  type WeekAllocation,
} from "@workspace/shared";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { loadAdjustments, loadInvoices, loadNames, loadPayments, instantOf } from "../sales/invoice-records";
import { dayIn } from "../sales/sales-common";

/** A stored commission statement row. */
export type StatementRow = typeof commissionStatements.$inferSelect;

/**
 * Every commission route (commissions.md; ADR 0048): the `hr.commissions` switch (404 when off,
 * CLAUDE.md rule 13), a Flooring Suite company (commission is paid on sales, which live in `core`;
 * the HR Suite has no Commissions page, 404), and company-wide data scope, as payroll: commission is
 * pay, the default holders (Owner, HR manager) are company-wide, and a rep reads their own
 * statements in the portal, not here (403 otherwise).
 */
export function requireCommissions(access: RequestAccess): void {
  if (!featureOn("hr.commissions") || !access.modules.includes("core")) throw new NotFoundException();
  if (access.dataScope !== "all") {
    throw new ForbiddenException({ code: "forbidden", message: "Commission statements cover the whole company." });
  }
}

/** A rate as stored (numeric(18,8)) written as the screens type it: "5", not "5.00000000". */
const rateText = (value: string) => dec(value).toString();

/** Commission plans, every version, oldest first (commissions.md "CommissionPlan"). */
export async function loadCommissionPlans(db: CompanyDb, ids?: readonly string[]): Promise<CommissionPlan[]> {
  const rows = await db
    .select()
    .from(commissionPlans)
    .where(and(isNull(commissionPlans.deletedAt), ids ? inArray(commissionPlans.id, [...ids]) : undefined))
    .orderBy(asc(commissionPlans.name), asc(commissionPlans.version));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    basis: row.basis,
    baseRatePct: rateText(row.baseRatePct),
    monthlyTarget: moneyString(row.monthlyTarget),
    tierMode: row.tierMode,
    tiers: row.tiers,
    overridePct: rateText(row.overridePct),
    draw: { kind: row.draw.kind, monthlyAmount: moneyString(row.draw.monthlyAmount) },
    clawbackDays: row.clawbackDays,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** Who is on which plan and from when, with their simulated signature (commissions.md "CommissionAssignment"). */
export async function loadCommissionAssignments(db: CompanyDb): Promise<CommissionAssignment[]> {
  const rows = await db
    .select()
    .from(commissionAssignments)
    .where(isNull(commissionAssignments.deletedAt))
    .orderBy(asc(commissionAssignments.effectiveFrom), asc(commissionAssignments.id));
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    monthlyTargetOverride: row.monthlyTargetOverride === null ? null : moneyString(row.monthlyTargetOverride),
    acknowledgement:
      row.acknowledgedName && row.acknowledgedAt
        ? { signedName: row.acknowledgedName, signedAt: instantOf(row.acknowledgedAt) }
        : null,
  }));
}

/** Stored statements (approved or paid; a draft is never stored), approvers by name. */
export async function loadCommissionStatements(db: CompanyDb, control: ControlDb): Promise<CommissionStatement[]> {
  const rows = await db
    .select()
    .from(commissionStatements)
    .where(isNull(commissionStatements.deletedAt))
    .orderBy(asc(commissionStatements.month), asc(commissionStatements.id));
  const names = await loadNames(
    control,
    rows.map((row) => row.approvedById),
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    month: row.month,
    status: row.status,
    approvedBy: row.approvedById ? (names.get(row.approvedById) ?? "") : null,
    approvedAt: row.approvedAt ? instantOf(row.approvedAt) : null,
    payPeriodId: row.payPeriodId,
  }));
}

/** Statement adjustments and reversal decisions, oldest first, by name (commissions.md "CommissionAdjustment"). */
export async function loadCommissionAdjustments(db: CompanyDb, control: ControlDb): Promise<CommissionAdjustment[]> {
  const rows = await db
    .select()
    .from(commissionAdjustments)
    .where(isNull(commissionAdjustments.deletedAt))
    .orderBy(asc(commissionAdjustments.at), asc(commissionAdjustments.id));
  const names = await loadNames(
    control,
    rows.map((row) => row.byUserId),
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    month: row.month,
    amount: moneyString(row.amount),
    invoiceId: row.invoiceId,
    reason: row.reason,
    byName: names.get(row.byUserId) ?? "",
    at: instantOf(row.at),
    decides: row.decides ?? null,
  }));
}

/** Each member's live employee id, by user id (user_profiles.employee_id; a removed employee is no link). */
export async function employeesByUser(db: CompanyDb): Promise<Map<string, string>> {
  const rows = await db
    .select({ userId: userProfiles.userId, employeeId: userProfiles.employeeId })
    .from(userProfiles)
    .innerJoin(employees, and(eq(employees.id, userProfiles.employeeId), isNull(employees.deletedAt)))
    .where(isNull(userProfiles.deletedAt));
  return new Map(rows.flatMap((row) => (row.employeeId ? [[row.userId, row.employeeId] as const] : [])));
}

/** A history row as stored: when it was written and by whom, for the self-made manager guard. */
interface StoredManagerRow extends ManagerHistoryRow {
  createdBy: string | null;
  createdAt: Date;
}

/**
 * Who managed whom, for overrides (commissions.md; owner decision 2026-11-15, ADR 0048): today's
 * sign-in links both ways, each live employee's manager today, and each employee's dated manager
 * history (employee_manager_history), grouped by employee.
 */
interface ManagerChain {
  /** Each user's live employee today (`employeesByUser`). */
  links: Map<string, string>;
  /** Each linked live employee's user today. */
  userOfEmployee: Map<string, string>;
  /** Each live employee's manager today (`employees.manager_id`), for an employee with no history. */
  current: Map<string, string | null>;
  /** Each employee's history rows. */
  history: Map<string, StoredManagerRow[]>;
}

/** Reads the manager chain in one go: links, today's managers and every history row. */
async function loadManagerChain(db: CompanyDb): Promise<ManagerChain> {
  const [links, managers, rows] = await Promise.all([
    employeesByUser(db),
    db.select({ id: employees.id, managerId: employees.managerId }).from(employees).where(isNull(employees.deletedAt)),
    db
      .select({
        id: employeeManagerHistory.id,
        employeeId: employeeManagerHistory.employeeId,
        managerId: employeeManagerHistory.managerId,
        effectiveFrom: employeeManagerHistory.effectiveFrom,
        createdBy: employeeManagerHistory.createdBy,
        createdAt: employeeManagerHistory.createdAt,
      })
      .from(employeeManagerHistory),
  ]);
  const history = new Map<string, StoredManagerRow[]>();
  for (const row of rows) {
    // The UUID v7 id sorts in the order rows were recorded, so it breaks a same-day tie (`managerOn`).
    const own = history.get(row.employeeId) ?? [];
    own.push({
      employeeId: row.employeeId,
      managerId: row.managerId,
      effectiveFrom: row.effectiveFrom,
      recordedOrder: row.id,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    });
    history.set(row.employeeId, own);
  }
  return {
    links,
    userOfEmployee: new Map([...links.entries()].map(([userId, employeeId]) => [employeeId, userId])),
    current: new Map(managers.map((row) => [row.id, row.managerId])),
    history,
  };
}

/** The manager employee of a live employee on a day, from their history, else today's manager. */
function managerEmployeeOn(chain: ManagerChain, employeeId: string, date: string): string | null {
  return managerOn(chain.history.get(employeeId) ?? [], employeeId, date, chain.current.get(employeeId) ?? null);
}

/**
 * The company's day of a confirmed moment (`lineConfirmedAt`: an ISO instant in UTC, or a bare
 * day, read as it is). Manager changes are dated on the company's calendar (people.service.ts
 * `recordManager`), so a payment confirmed on a company's evening, already the next day in UTC, is
 * judged on the company's day it happened (first review of PR #32; ADR 0048).
 */
function companyDayOf(at: string, zone: string): string {
  if (at.length <= 10) return at;
  return dayIn(new Date(`${at.slice(0, 16)}:00Z`), zone);
}

/**
 * Each person's manager by user id when a line was confirmed, for overrides (commissions.md; owner
 * decision 2026-11-15, ADR 0048): user → today's linked employee → their manager on the company's
 * day of that moment (`companyDayOf`; `managerOn` over employee_manager_history; an employee with no
 * history reads today's `managerId`) → that manager's user today. Null when any link is missing.
 */
export async function loadManagerOf(
  db: CompanyDb,
  zone: string,
): Promise<(userId: string, at: string) => string | null> {
  const chain = await loadManagerChain(db);
  return (userId, at) => {
    const employeeId = chain.links.get(userId);
    if (!employeeId) return null;
    const managerId = managerEmployeeOn(chain, employeeId, companyDayOf(at, zone));
    return managerId ? (chain.userOfEmployee.get(managerId) ?? null) : null;
  };
}

/** One change of a person's manager, as the audit log recorded it. */
export interface ManagerChange {
  employeeId: string;
  actorUserId: string | null;
  at: Date;
}

/**
 * Every change of these people's manager, oldest first, read from "Added employee" and "Edited
 * employee" entries (append-only), which carry `managerId` before and after (people.service.ts
 * `save`). `managerId` decides who is paid an override (ADR 0048). People by user id, through
 * their linked employee.
 */
export async function managerChanges(db: CompanyDb, userIds: readonly string[]): Promise<ManagerChange[]> {
  const links = await employeesByUser(db);
  const employeeIds = [...new Set(userIds.flatMap((userId) => links.get(userId) ?? []))];
  if (employeeIds.length === 0) return [];
  const entries = await db
    .select({
      targetId: auditLog.targetId,
      actorUserId: auditLog.actorUserId,
      at: auditLog.at,
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
      ? [{ employeeId: entry.targetId, actorUserId: entry.actorUserId, at: entry.at }]
      : [],
  );
}

/**
 * Who set each history row's manager (ADR 0048 "Self-made manager"): a dated row is set by whoever
 * saved it (`created_by`, written by `recordManager`). A since-records-began row stands for the
 * manager the person had before the history began, so it is set by whoever made the last manager
 * change in the audit log before the person's first dated row was written (with no dated row, the
 * last one of all); its own `created_by` is the backfill's or the first editor's, who did not set it.
 */
function withSetters(rows: readonly StoredManagerRow[], changes: readonly ManagerChange[]): ManagerHistoryRow[] {
  const dated = rows.filter((row) => row.effectiveFrom !== null).map((row) => row.createdAt.getTime());
  const began = dated.length ? Math.min(...dated) : Infinity;
  const before = changes.filter((change) => change.at.getTime() < began).at(-1)?.actorUserId ?? null;
  return rows.map((row) => ({ ...row, setBy: row.effectiveFrom === null ? before : row.createdBy }));
}

/**
 * Whether the statement's own person set the manager who earns an override line (second security
 * review of PR #27, first review of PR #32; ADR 0048 "Self-made manager"): `(subjectUserId, at,
 * userId)` with the line's subject, its confirmed moment (`lineConfirmedAt`) and the statement's
 * person. It reads the subject's history row in force on that company day, as `loadManagerOf` did
 * (`managerSelfSetOn`), so a later move to another manager never clears the earlier days; someone
 * else setting that same manager again does. A subject with no history rows falls back to the
 * latest manager change in the audit log, as overrides then follow today's manager.
 */
export async function loadSelfSetManager(
  db: CompanyDb,
  zone: string,
  subjectUserIds: readonly string[],
): Promise<(subjectUserId: string, at: string, userId: string) => boolean> {
  const [chain, changes] = await Promise.all([loadManagerChain(db), managerChanges(db, subjectUserIds)]);
  const history = new Map(
    [...new Set(subjectUserIds.flatMap((userId) => chain.links.get(userId) ?? []))].map((employeeId) => [
      employeeId,
      withSetters(
        chain.history.get(employeeId) ?? [],
        changes.filter((change) => change.employeeId === employeeId),
      ),
    ]),
  );
  return (subjectUserId, at, userId) => {
    const employeeId = chain.links.get(subjectUserId);
    if (!employeeId) return false;
    const rows = history.get(employeeId) ?? [];
    if (rows.length === 0) {
      const latest = changes.filter((change) => change.employeeId === employeeId).at(-1);
      return latest !== undefined && latest.actorUserId === userId;
    }
    return managerSelfSetOn(rows, employeeId, companyDayOf(at, zone), userId);
  };
}

/**
 * The users who managed these people on any day from `from` to `to` (ADR 0048), by today's sign-in
 * links: the manager in force on `from`, and every manager a history row dated after it and on or
 * before `to` names. A row overtaken later the same day still counts, so the answer is never
 * narrower than the truth. It scans each person's history rows, not every day.
 */
export async function loadManagersBetween(
  db: CompanyDb,
  userIds: readonly string[],
  from: string,
  to: string,
): Promise<Set<string>> {
  const chain = await loadManagerChain(db);
  const managers = new Set<string>();
  for (const userId of userIds) {
    const employeeId = chain.links.get(userId);
    if (!employeeId) continue;
    const later = (chain.history.get(employeeId) ?? []).filter(
      (row) => row.effectiveFrom !== null && row.effectiveFrom > from && row.effectiveFrom <= to,
    );
    for (const managerId of [managerEmployeeOn(chain, employeeId, from), ...later.map((row) => row.managerId)]) {
      const managerUser = managerId ? chain.userOfEmployee.get(managerId) : undefined;
      if (managerUser) managers.add(managerUser);
    }
  }
  return managers;
}

/**
 * Everything the commission engine reads (`commissionLines`), from the company's records: plans,
 * assignments, invoices with their cost (never sent on; CLAUDE.md rule 5), payments, credit applied,
 * the manager chain for overrides (user, employee, their manager on the company's day the line was
 * confirmed, that employee's user; `loadManagerOf`), the frozen months and HR's reversal decisions.
 * `today` is the company's day.
 */
export async function loadCommissionInputs(
  db: CompanyDb,
  control: ControlDb,
  zone: string,
  today: string,
  statements: readonly CommissionStatement[],
  adjustments: readonly CommissionAdjustment[],
): Promise<CommissionInputs> {
  const [plans, assignments, invoices, payments, credits, managerOf] = await Promise.all([
    loadCommissionPlans(db),
    loadCommissionAssignments(db),
    loadInvoices(db, zone),
    loadPayments(db, control),
    loadAdjustments(db, control),
    loadManagerOf(db, zone),
  ]);
  return {
    plans,
    assignments,
    invoices,
    payments,
    adjustments: credits,
    managerOf,
    frozen: new Set(statements.filter((s) => s.status !== "draft").map((s) => statementKey(s.userId, s.month))),
    decisions: commissionDecisions(adjustments),
    today,
  };
}

/** The commission engine's view of the company: its inputs, lines, statements and adjustments. */
export interface CommissionBook {
  inputs: CommissionInputs;
  lines: CommissionLine[];
  statements: CommissionStatement[];
  adjustments: CommissionAdjustment[];
  /** Every person's statements for the last twelve months (`commissionStatementRows`). */
  rows: CommissionStatementRow[];
}

/**
 * Works out everyone's statements now (commissions.md rule 11), with the stored statements and
 * adjustments, the posted amounts of approved ones (`postedCommission`: approval freezes what is
 * paid, so an approved month shows the amount that posted) and people by name.
 */
export async function loadCommissionBook(
  db: CompanyDb,
  control: ControlDb,
  zone: string,
  today: string,
): Promise<CommissionBook> {
  const [statements, adjustments] = await Promise.all([
    loadCommissionStatements(db, control),
    loadCommissionAdjustments(db, control),
  ]);
  const inputs = await loadCommissionInputs(db, control, zone, today, statements, adjustments);
  const lines = commissionLines(inputs);
  const people = new Set([...inputs.assignments.map((a) => a.userId), ...lines.map((l) => l.userId)]);
  const [names, posted] = await Promise.all([
    loadNames(control, people),
    postedCommission(
      db,
      statements.map((s) => s.id),
    ),
  ]);
  const rows = commissionStatementRows({
    inputs,
    lines,
    statements,
    adjustments,
    nameOf: (userId) => names.get(userId) ?? "Former employee",
  }).map((row) => {
    if (!row.statementId || row.status === "draft") return row;
    // An approved statement pays what posted (none posted: nothing to pay); a paid one with no
    // entry is seeded history, shown as worked out.
    const frozen = posted.get(row.statementId) ?? (row.status === "approved" ? "0.00" : undefined);
    return frozen === undefined ? row : { ...row, payable: frozen };
  });
  return { inputs, lines, statements, adjustments, rows };
}

/**
 * What each approved statement posted to Accrued Payroll (`commissionStatementPosting`, ADR 0048),
 * by statement id. A statement whose entry is missing (seeded history, or nothing to pay) has none.
 * The pay run pays this amount, never one worked out again, so what is paid is what was accrued.
 */
export async function postedCommission(db: CompanyDb, statementIds: readonly string[]): Promise<Map<string, string>> {
  if (statementIds.length === 0) return new Map();
  const rows = await db
    .select({ sourceId: journalEntries.sourceId, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.sourceType, "commission_statement"),
        eq(journalEntries.event, "commission.approved"),
        eq(ledgerAccounts.key, "accrued_payroll"),
        inArray(journalEntries.sourceId, [...statementIds]),
      ),
    );
  const amounts = new Map<string, string[]>();
  for (const row of rows) amounts.set(row.sourceId, [...(amounts.get(row.sourceId) ?? []), row.credit]);
  return new Map([...amounts.entries()].map(([id, credits]) => [id, moneyString(sum(credits))]));
}

/** The commission a pay run pays one person (hr.md rule 19; ADR 0048). */
export interface RunCommission {
  /** What their statements posted when approved, added up. */
  amount: string;
  /** Those statements' lines by workweek, for the overtime true-up (hr.md rule 18). */
  allocations: WeekAllocation[];
  statementIds: string[];
}

/**
 * The employee an approved statement pays (owner decision 2026-11-15; ADR 0048 "Sign-in re-link"):
 * the one stored at approval (`commission_statements.employee_id`), so a later re-link never moves
 * the pay. A statement stored before that column with no employee falls back to the rep's sign-in
 * link today, as runs paid it before. Null when neither exists.
 */
export function paidEmployee(
  statement: Pick<StatementRow, "employeeId" | "userId">,
  links: ReadonlyMap<string, string>,
): string | null {
  return statement.employeeId ?? links.get(statement.userId) ?? null;
}

/**
 * The approved, unpaid statements a run pays, by employee (commissions.md "To paid"; ADR 0048):
 * those whose paid employee (`paidEmployee`: stored at approval, else today's link) is in the run,
 * that wait for a run (`pay_period_id` null) or already joined this one. Each pays what its approval
 * posted (`postedCommission`), so the run never pays a figure worked out again. Lines are worked out
 * only when some statement waits, for the true-up.
 */
export async function commissionForRun(
  db: CompanyDb,
  control: ControlDb,
  clock: { zone: string; day: string },
  employeeIds: readonly string[],
  periodId: string,
  weekStartDay: number,
): Promise<Map<string, RunCommission>> {
  if (employeeIds.length === 0) return new Map();
  const inRun = new Set(employeeIds);
  const links = await employeesByUser(db);
  // Only a statement with no stored employee is matched by today's link (legacy rows).
  const linkedUsers = [...links.entries()].flatMap(([userId, employeeId]) => (inRun.has(employeeId) ? [userId] : []));
  const candidates = await db
    .select()
    .from(commissionStatements)
    .where(
      and(
        isNull(commissionStatements.deletedAt),
        eq(commissionStatements.status, "approved"),
        or(
          inArray(commissionStatements.employeeId, [...inRun]),
          linkedUsers.length
            ? and(isNull(commissionStatements.employeeId), inArray(commissionStatements.userId, linkedUsers))
            : undefined,
        ),
        or(isNull(commissionStatements.payPeriodId), eq(commissionStatements.payPeriodId, periodId)),
      ),
    )
    .orderBy(asc(commissionStatements.id));
  const waiting = candidates.flatMap((statement) => {
    const employeeId = paidEmployee(statement, links);
    return employeeId && inRun.has(employeeId) ? [{ statement, employeeId }] : [];
  });
  if (waiting.length === 0) return new Map();
  const posted = await postedCommission(
    db,
    waiting.map((w) => w.statement.id),
  );
  const [statements, adjustments] = await Promise.all([
    loadCommissionStatements(db, control),
    loadCommissionAdjustments(db, control),
  ]);
  const lines = commissionLines(
    await loadCommissionInputs(db, control, clock.zone, clock.day, statements, adjustments),
  ).filter((l) => l.kind !== "reversal" || l.reversalState === "applied");
  const out = new Map<string, RunCommission>();
  for (const { statement, employeeId } of waiting) {
    const seen = out.get(employeeId) ?? { amount: "0.00", allocations: [], statementIds: [] };
    const own = lines.filter((l) => l.userId === statement.userId && l.month === statement.month);
    out.set(employeeId, {
      amount: moneyString(dec(seen.amount).plus(posted.get(statement.id) ?? 0)),
      allocations: [...seen.allocations, ...commissionAllocations(own, weekStartDay)],
      statementIds: [...seen.statementIds, statement.id],
    });
  }
  return out;
}

/** An approved statement that no pay run can pay, and why (ADR 0048). */
export interface StrandedCommission {
  statementId: string;
  userId: string;
  name: string;
  month: string;
  reason: string;
}

/**
 * Approved statements with something to pay that wait for a run no run will ever include
 * (commissions.md "To paid"; ADR 0048), judged on the employee the statement pays (`paidEmployee`:
 * stored at approval, else today's link): there is none, its record was removed, it is a 1099
 * contractor, or they have left. The pay-period review lists them for HR, who pays or settles them
 * outside the run; they are never marked paid silently.
 */
export async function strandedCommission(db: CompanyDb, control: ControlDb): Promise<StrandedCommission[]> {
  const waiting = await db
    .select({
      id: commissionStatements.id,
      userId: commissionStatements.userId,
      month: commissionStatements.month,
      employeeId: commissionStatements.employeeId,
    })
    .from(commissionStatements)
    .where(
      and(
        isNull(commissionStatements.deletedAt),
        eq(commissionStatements.status, "approved"),
        isNull(commissionStatements.payPeriodId),
      ),
    )
    .orderBy(asc(commissionStatements.month), asc(commissionStatements.id));
  if (waiting.length === 0) return [];
  const posted = await postedCommission(
    db,
    waiting.map((s) => s.id),
  );
  const links = await employeesByUser(db);
  const owing = waiting
    .filter((s) => dec(posted.get(s.id) ?? 0).gt(0))
    .map((s) => ({ ...s, paidTo: paidEmployee(s, links) }));
  if (owing.length === 0) return [];
  const paidTo = [...new Set(owing.flatMap((s) => s.paidTo ?? []))];
  const people = paidTo.length
    ? await db
        .select({
          id: employees.id,
          workerType: employees.workerType,
          status: employees.status,
          deletedAt: employees.deletedAt,
        })
        .from(employees)
        .where(inArray(employees.id, paidTo))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const names = await loadNames(
    control,
    owing.map((s) => s.userId),
  );
  return owing.flatMap((s) => {
    const employee = s.paidTo ? byId.get(s.paidTo) : undefined;
    const reason = !employee
      ? "Their sign-in is not linked to an employee."
      : employee.deletedAt
        ? "Their employee record was removed, so no pay run includes them."
        : employee.workerType !== "w2"
          ? "They are a 1099 contractor, and pay runs pay W-2 staff only."
          : employee.status === "terminated"
            ? "They have left, so no pay run includes them."
            : null;
    if (!reason) return [];
    return [
      { statementId: s.id, userId: s.userId, name: names.get(s.userId) ?? "Former employee", month: s.month, reason },
    ];
  });
}
