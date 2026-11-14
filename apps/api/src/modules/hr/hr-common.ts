import type { CompanyDb, ControlDb } from "@workspace/db";
import { employees, ptoRequests, rolePermissions, timesheets, userProfiles, userRoles } from "@workspace/db/company";
import { user } from "@workspace/db/control";
import { seesPersonRecords, type AuditCategory, type Employee, type PermissionKey } from "@workspace/shared";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { AccessService, RequestAccess } from "../../core/access/access.service";
import type { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { notFound, refuse } from "../sales/sales-common";
import { viewerEmployeeId, type EmployeeRow, type PersonScope } from "./hr-records";

/** A stored timesheet row. */
export type TimesheetRow = typeof timesheets.$inferSelect;

/** A stored time-off request row. */
export type RequestRow = typeof ptoRequests.$inferSelect;

/**
 * Locks an employee row for a write in the caller's transaction. Every write about one person
 * (their sheets, clock and time off) takes this lock first, so two at once can't both pass a
 * balance or status check. A missing employee, or one outside `scope`, answers 404 (CLAUDE.md rule 3).
 */
export async function lockEmployee(tx: CompanyDb, id: string, scope?: PersonScope): Promise<EmployeeRow> {
  const [row] = await tx.select().from(employees).where(eq(employees.id, id)).for("update");
  if (!row || row.deletedAt || (scope && !scope.sees(row.id))) throw notFound("employee");
  return row;
}

/** Locks a timesheet after its employee, so the lock order is always person, then sheet. */
export async function lockTimesheet(tx: CompanyDb, id: string, scope: PersonScope): Promise<TimesheetRow> {
  const [peek] = await tx.select({ employeeId: timesheets.employeeId }).from(timesheets).where(eq(timesheets.id, id));
  if (!peek) throw notFound("timesheet");
  await lockEmployee(tx, peek.employeeId, scope).catch(() => {
    throw notFound("timesheet");
  });
  const [row] = await tx.select().from(timesheets).where(eq(timesheets.id, id)).for("update");
  if (!row || row.deletedAt) throw notFound("timesheet");
  return row;
}

/**
 * Locks several timesheets for a batch decision: every employee first, in employee-id order, then
 * the sheets in id order. One global order means two batches at once wait instead of deadlocking
 * (security review of PR #25). Any sheet missing or outside `scope` answers 404 for the batch.
 */
export async function lockTimesheets(
  tx: CompanyDb,
  ids: readonly string[],
  scope: PersonScope,
): Promise<TimesheetRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const peek = await tx
    .select({ id: timesheets.id, employeeId: timesheets.employeeId })
    .from(timesheets)
    .where(inArray(timesheets.id, unique));
  if (peek.length !== unique.length) throw notFound("timesheet");
  const people = [...new Set(peek.map((row) => row.employeeId))].sort();
  for (const employeeId of people) {
    await lockEmployee(tx, employeeId, scope).catch(() => {
      throw notFound("timesheet");
    });
  }
  const rows = await tx
    .select()
    .from(timesheets)
    .where(inArray(timesheets.id, unique))
    .orderBy(asc(timesheets.id))
    .for("update");
  if (rows.length !== unique.length || rows.some((row) => row.deletedAt)) throw notFound("timesheet");
  return rows;
}

/** Locks a time-off request after its employee; outside the person's scope it answers 404. */
export async function lockRequest(tx: CompanyDb, id: string, scope: PersonScope): Promise<RequestRow> {
  const [peek] = await tx
    .select({ employeeId: ptoRequests.employeeId })
    .from(ptoRequests)
    .where(eq(ptoRequests.id, id));
  if (!peek) throw notFound("request");
  await lockEmployee(tx, peek.employeeId, scope).catch(() => {
    throw notFound("request");
  });
  const [row] = await tx.select().from(ptoRequests).where(eq(ptoRequests.id, id)).for("update");
  if (!row || row.deletedAt) throw notFound("request");
  return row;
}

/**
 * Refuses a decision on someone else's time or pay from a sign-in linked to no employee
 * (user_profiles.employee_id null), unless the actor is the company Owner (third security review
 * of PR #25; ADR 0046). An unlinked sign-in is matched to its own record only by email, which may
 * differ, so it could otherwise approve its own hours, time off or pay, or change its own work
 * state or hire date. Covers timesheet decisions and reopens, time-off decisions, balance
 * adjustments and every employee write: add, edit, checklist, offboarding, documents and the
 * sign-in link (fourth security review of PR #25).
 */
export async function requireLinkedDecider(db: CompanyDb, access: RequestAccess): Promise<void> {
  if (access.isOwner || (await viewerEmployeeId(db, access.userId))) return;
  throw refuse(
    "Link your sign-in to your employee record before changing people's records, time or pay; an Owner can link it.",
  );
}

/** One HR audit entry in the caller's transaction (CLAUDE.md rule 10; hr.md "Events and audit entries"). */
export function auditHr(
  auditLog: AuditService,
  tenant: TenantContext,
  actor: Actor,
  tx: CompanyDb,
  entry: {
    action: string;
    targetType: "employee" | "timesheet" | "pto_request" | "time_off_policy" | "clock_entry";
    targetId: string | null;
    targetLabel: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    category?: AuditCategory;
  },
): Promise<void> {
  const { category = "data", ...rest } = entry;
  return auditLog.record(tenant, actor.audit, { category, ...rest }, tx);
}

/** A person to notify, from the control database (hr.md "Events"). */
export interface Recipient {
  id: string;
  name: string;
  email: string;
}

/**
 * The active members who may act on an employee's record and should hear about it (hr.md
 * "Events"): their effective permissions (role ∩ company ceiling ∩ enabled modules, by the engine
 * the guards use; CLAUDE.md rule 4) hold `key`, and their HR data scope covers the employee
 * (`seesPersonRecords`). The employee is never told to approve their own record, whether their
 * sign-in is linked or matches the employee's email (as `selfCheck` refuses both). Disabled or
 * invited people get nothing (security review of PR #25: role keys alone reached people out of scope).
 */
export async function holdersOf(
  db: CompanyDb,
  control: ControlDb,
  access: AccessService,
  tenant: TenantContext,
  key: PermissionKey,
  employee: Pick<Employee, "id" | "managerId" | "email">,
): Promise<Recipient[]> {
  const rows = await db
    .selectDistinct({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(userProfiles, eq(userProfiles.userId, userRoles.userId))
    .where(
      and(
        eq(rolePermissions.permissionKey, key),
        eq(userProfiles.status, "active"),
        isNull(userRoles.deletedAt),
        isNull(rolePermissions.deletedAt),
        isNull(userProfiles.deletedAt),
      ),
    );
  const candidates = await access.membersAccess(
    tenant,
    rows.map((row) => row.userId),
  );
  const allowed: string[] = [];
  for (const member of candidates) {
    if (member.disabled || !member.permissions.has(key)) continue;
    const own = await viewerEmployeeId(db, member.userId);
    if (own === employee.id || !seesPersonRecords(member.dataScope, own, employee)) continue;
    allowed.push(member.userId);
  }
  // A member whose sign-in email is the employee's counts as that person too (`selfCheck`).
  const email = employee.email.trim().toLowerCase();
  return (await people(control, allowed)).filter((person) => !email || person.email.trim().toLowerCase() !== email);
}

/** The active member linked to an employee, or null; a person with no sign-in gets no message. */
export async function linkedUser(db: CompanyDb, control: ControlDb, employeeId: string): Promise<Recipient | null> {
  const [row] = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(
      and(eq(userProfiles.employeeId, employeeId), eq(userProfiles.status, "active"), isNull(userProfiles.deletedAt)),
    );
  if (!row) return null;
  return (await people(control, [row.userId]))[0] ?? null;
}

async function people(control: ControlDb, ids: readonly string[]): Promise<Recipient[]> {
  if (ids.length === 0) return [];
  return control
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(inArray(user.id, [...ids]));
}
