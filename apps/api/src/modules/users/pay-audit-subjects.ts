import type { CompanyDb } from "@workspace/db";
import { auditLog, bonuses, commissionAdjustments, commissionStatements, employees } from "@workspace/db/company";
import { isPaySensitiveAudit, type PayAuditSubject } from "@workspace/shared";
import { and, inArray, isNull } from "drizzle-orm";
import { validate as isUuid } from "uuid";
import { employeesByUser, paidEmployee } from "../hr/commission-records";

/** A stored audit_log row. */
type AuditRow = typeof auditLog.$inferSelect;

/**
 * The subject of a pay-sensitive entry about no single person, or whose person can't be found: the
 * strictest, readable only with company-wide scope (`payAuditDetailsVisible`).
 */
export const COMPANY_SUBJECT: PayAuditSubject = { kind: "company" };

/** The ids among these that are UUIDs, so a hand-written target id never breaks a uuid query. */
const uuidsOf = (ids: readonly (string | null | undefined)[]) => [
  ...new Set(ids.flatMap((id) => (id && isUuid(id) ? [id] : []))),
];

/** The `employeeId` an exclusion entry names in its after, else its before (pay-periods.service.ts `exclude`). */
function excludedEmployee(row: AuditRow): string | null {
  for (const side of [row.after, row.before]) {
    const value = (side ?? {}) as { employeeId?: unknown };
    if (typeof value.employeeId === "string") return value.employeeId;
  }
  return null;
}

/** Each bonus's employee by bonus id, a voided (soft-deleted) bonus too. */
async function bonusEmployees(db: CompanyDb, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: bonuses.id, employeeId: bonuses.employeeId })
    .from(bonuses)
    .where(inArray(bonuses.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row.employeeId]));
}

/**
 * The employee a commission statement entry is about, by its target id. "Adjusted commission
 * statement" and the reversal decisions target the adjustment row (commissions.service.ts `adjust`,
 * `decide`), other entries the statement itself. The person is the employee the month's statement
 * pays (`paidEmployee`: stored at approval, else the rep's sign-in link today).
 */
async function statementEmployees(db: CompanyDb, ids: readonly string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const statementColumns = {
    id: commissionStatements.id,
    userId: commissionStatements.userId,
    month: commissionStatements.month,
    employeeId: commissionStatements.employeeId,
  };
  const [adjustments, statements, links] = await Promise.all([
    db
      .select({
        id: commissionAdjustments.id,
        userId: commissionAdjustments.userId,
        month: commissionAdjustments.month,
      })
      .from(commissionAdjustments)
      .where(inArray(commissionAdjustments.id, [...ids])),
    db
      .select(statementColumns)
      .from(commissionStatements)
      .where(inArray(commissionStatements.id, [...ids])),
    employeesByUser(db),
  ]);
  const reps = [...new Set(adjustments.map((a) => a.userId))];
  const monthsOfReps = reps.length
    ? await db
        .select(statementColumns)
        .from(commissionStatements)
        .where(and(inArray(commissionStatements.userId, reps), isNull(commissionStatements.deletedAt)))
    : [];
  const key = (userId: string, month: string) => `${userId}|${month}`;
  const byMonth = new Map(monthsOfReps.map((s) => [key(s.userId, s.month), s.employeeId]));
  return new Map([
    ...adjustments.map((a) => {
      const employeeId = byMonth.get(key(a.userId, a.month)) ?? null;
      return [a.id, paidEmployee({ userId: a.userId, employeeId }, links)] as const;
    }),
    ...statements.map((s) => [s.id, paidEmployee(s, links)] as const),
  ]);
}

/**
 * The employee each pay-sensitive entry is about, by audit id (owner decision 2026-11-15; ADR 0048
 * "Audit visibility"), read in a few batched queries: a bonus entry by its bonus's employee, a
 * pay-run exclusion by the `employeeId` it carries, a commission statement entry by the employee
 * that month's statement pays. Anything else (commission plan terms) is about no single person.
 */
async function employeeOfEntry(db: CompanyDb, rows: readonly AuditRow[]): Promise<Map<string, string>> {
  const targetsOf = (type: string) => uuidsOf(rows.filter((row) => row.targetType === type).map((r) => r.targetId));
  const [ofBonus, ofStatement] = await Promise.all([
    bonusEmployees(db, targetsOf("bonus")),
    statementEmployees(db, targetsOf("commission_statement")),
  ]);
  const out = new Map<string, string>();
  for (const row of rows) {
    const target = row.targetId ?? "";
    const employeeId =
      row.targetType === "pay_period"
        ? excludedEmployee(row)
        : row.targetType === "bonus"
          ? ofBonus.get(target)
          : row.targetType === "commission_statement"
            ? ofStatement.get(target)
            : null;
    if (employeeId) out.set(row.id, employeeId);
  }
  return out;
}

/**
 * Whom each pay-sensitive audit entry is about, by audit id, for `payAuditDetailsVisible` (owner
 * decision 2026-11-15; ADR 0048 "Audit visibility"): a person, with their manager today for the HR
 * person scope (`seesPersonRecords`), or the company. An entry about no single person (plan terms),
 * or whose person can't be found among live employees, is the company's, so only company-wide scope
 * reads it (safest). Entries that are not pay-sensitive get none: every audit viewer reads them.
 */
export async function loadPayAuditSubjects(
  db: CompanyDb,
  rows: readonly AuditRow[],
): Promise<Map<string, PayAuditSubject>> {
  const sensitive = rows.filter((row) => isPaySensitiveAudit(row.action));
  if (sensitive.length === 0) return new Map();
  const employeeOf = await employeeOfEntry(db, sensitive);
  const ids = uuidsOf([...employeeOf.values()]);
  const people = ids.length
    ? await db
        .select({ id: employees.id, managerId: employees.managerId })
        .from(employees)
        .where(and(inArray(employees.id, ids), isNull(employees.deletedAt)))
    : [];
  const managerOf = new Map(people.map((p) => [p.id, p.managerId]));
  return new Map(
    sensitive.map((row) => {
      const id = employeeOf.get(row.id);
      const subject: PayAuditSubject =
        id && managerOf.has(id) ? { kind: "person", id, managerId: managerOf.get(id) ?? null } : COMPANY_SUBJECT;
      return [row.id, subject];
    }),
  );
}
