import type { CompanyDb, ControlDb } from "@workspace/db";
import { employees, ptoRequests, rolePermissions, timesheets, userProfiles, userRoles } from "@workspace/db/company";
import { user } from "@workspace/db/control";
import type { AuditCategory, PermissionKey } from "@workspace/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { notFound } from "../sales/sales-common";
import type { EmployeeRow, PersonScope } from "./hr-records";

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
 * The active members whose roles hold a key (hr.md "Events": `usersWith` reads role permissions,
 * not the ceiling), for in-app notes and emails to approvers. Disabled or invited people get nothing.
 */
export async function holdersOf(db: CompanyDb, control: ControlDb, key: PermissionKey): Promise<Recipient[]> {
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
  return people(
    control,
    rows.map((row) => row.userId),
  );
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
