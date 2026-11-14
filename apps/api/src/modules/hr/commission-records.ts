import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { CompanyDb, ControlDb } from "@workspace/db";
import {
  commissionAdjustments,
  commissionAssignments,
  commissionPlans,
  commissionStatements,
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
  type WeekAllocation,
} from "@workspace/shared";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { loadAdjustments, loadInvoices, loadNames, loadPayments, minuteOf } from "../sales/invoice-records";

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
        ? { signedName: row.acknowledgedName, signedAt: minuteOf(row.acknowledgedAt) }
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
    approvedAt: row.approvedAt ? minuteOf(row.approvedAt) : null,
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
    at: minuteOf(row.at),
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

/**
 * Each person's manager by user id, for overrides (commissions.md): user → linked employee →
 * `managerId` → that employee's user. Null when any link is missing.
 */
export async function loadManagerOf(db: CompanyDb): Promise<(userId: string) => string | null> {
  const [links, managers] = await Promise.all([
    employeesByUser(db),
    db.select({ id: employees.id, managerId: employees.managerId }).from(employees).where(isNull(employees.deletedAt)),
  ]);
  const managerOfEmployee = new Map(managers.map((row) => [row.id, row.managerId]));
  const userOfEmployee = new Map([...links.entries()].map(([userId, employeeId]) => [employeeId, userId]));
  return (userId) => {
    const managerId = managerOfEmployee.get(links.get(userId) ?? "");
    return managerId ? (userOfEmployee.get(managerId) ?? null) : null;
  };
}

/**
 * Everything the commission engine reads (`commissionLines`), from the company's records: plans,
 * assignments, invoices with their cost (never sent on; CLAUDE.md rule 5), payments, credit applied,
 * the manager chain for overrides (user, employee, `managerId`, that employee's user), the frozen
 * months and HR's reversal decisions. `today` is the company's day.
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
    loadManagerOf(db),
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
 * The approved, unpaid statements a run pays, by employee (commissions.md "To paid"; ADR 0048):
 * the statements of the people in it that wait for a run (`pay_period_id` null) or already joined
 * this one. Each pays what its approval posted (`postedCommission`), so the run never pays a figure
 * worked out again. Lines are worked out only when some statement waits, for the true-up.
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
  const byUser = new Map(
    [...(await employeesByUser(db)).entries()].filter(([, employeeId]) => employeeIds.includes(employeeId)),
  );
  if (byUser.size === 0) return new Map();
  const waiting = await db
    .select()
    .from(commissionStatements)
    .where(
      and(
        isNull(commissionStatements.deletedAt),
        eq(commissionStatements.status, "approved"),
        inArray(commissionStatements.userId, [...byUser.keys()]),
        or(isNull(commissionStatements.payPeriodId), eq(commissionStatements.payPeriodId, periodId)),
      ),
    )
    .orderBy(asc(commissionStatements.id));
  if (waiting.length === 0) return new Map();
  const posted = await postedCommission(
    db,
    waiting.map((s) => s.id),
  );
  const [statements, adjustments] = await Promise.all([
    loadCommissionStatements(db, control),
    loadCommissionAdjustments(db, control),
  ]);
  const lines = commissionLines(
    await loadCommissionInputs(db, control, clock.zone, clock.day, statements, adjustments),
  ).filter((l) => l.kind !== "reversal" || l.reversalState === "applied");
  const out = new Map<string, RunCommission>();
  for (const statement of waiting) {
    const employeeId = byUser.get(statement.userId)!;
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
 * (commissions.md "To paid"; ADR 0048): the rep's sign-in is no longer linked to an employee, the
 * employee is a 1099 contractor, or they have left. The pay-period review lists them for HR, who
 * pays or settles them outside the run; they are never marked paid silently.
 */
export async function strandedCommission(db: CompanyDb, control: ControlDb): Promise<StrandedCommission[]> {
  const waiting = await db
    .select({ id: commissionStatements.id, userId: commissionStatements.userId, month: commissionStatements.month })
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
  const owing = waiting.filter((s) => dec(posted.get(s.id) ?? 0).gt(0));
  if (owing.length === 0) return [];
  const links = await employeesByUser(db);
  const linked = [...new Set(owing.flatMap((s) => links.get(s.userId) ?? []))];
  const people = linked.length
    ? await db
        .select({ id: employees.id, workerType: employees.workerType, status: employees.status })
        .from(employees)
        .where(inArray(employees.id, linked))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const names = await loadNames(
    control,
    owing.map((s) => s.userId),
  );
  return owing.flatMap((s) => {
    const employee = byId.get(links.get(s.userId) ?? "");
    const reason = !employee
      ? "Their sign-in is not linked to an employee."
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
