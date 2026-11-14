import { ConflictException } from "@nestjs/common";
import type { CompanyDb, ControlDb } from "@workspace/db";
import {
  clockEntries,
  employeeChecklistItems,
  employees,
  ptoRequests,
  settings,
  timeEntries,
  timeOffEntries,
  timeOffPolicies,
  timesheets,
  userProfiles,
} from "@workspace/db/company";
import {
  addDays,
  dec,
  seesPersonRecords,
  type ChecklistItem,
  type ClockEntry,
  type CompanyId,
  type CompanySettings,
  type Employee,
  type OvertimeRule,
  type PtoRequest,
  type TimeOffEntry,
  type TimeOffPolicy,
  type TimesheetWire,
} from "@workspace/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import type { Actor } from "../../core/access/request-actor";
import { fileRows, filesByOwner, loadNames, minuteOf } from "../sales/invoice-records";

/** A stored employee row. */
export type EmployeeRow = typeof employees.$inferSelect;

/** The company's HR rules the API needs, from Settings → HR and Settings → Localization → Payroll (CLAUDE.md rule 12). */
export interface HrRules {
  /** 0 Sunday to 6 Saturday: the designated workweek (hr.md rule 6). */
  workweekStartDay: number;
  /** Clock in and out in the portal (spec C2). */
  clockEnabled: boolean;
  /**
   * The company's overtime rule; a California work state overrides it (hr.md rule 7) only while the
   * California pay rules are switched on, and off everyone is on the federal rule (ADR 0050).
   */
  overtimeRule: OvertimeRule;
}

/**
 * The company's HR rules from its settings rows. A company that never saved Settings → HR or the
 * payroll rule can't file hours, because the workweek must be designated (ADR 0024): 409.
 */
export async function loadHrRules(db: CompanyDb): Promise<HrRules> {
  const rows = await db
    .select({ group: settings.group, value: settings.value })
    .from(settings)
    .where(and(inArray(settings.group, ["hr", "localization"]), isNull(settings.deletedAt)));
  const hr = rows.find((row) => row.group === "hr")?.value as Partial<CompanySettings["hr"]> | undefined;
  const localization = rows.find((row) => row.group === "localization")?.value as
    Partial<CompanySettings["localization"]> | undefined;
  const rule = localization?.payroll?.overtimeRule;
  const day = hr?.workweekStartDay;
  if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6 || !rule) {
    throw new ConflictException({
      code: "settings_missing",
      message: "Finish Settings → HR and the payroll rule in Settings → Localization first.",
    });
  }
  return { workweekStartDay: day, clockEnabled: hr?.clockEnabled === true, overtimeRule: rule };
}

/** Hours as the screens read them: a decimal string without trailing zeros (`8.000` → `8`). */
export function hoursText(value: string): string {
  return dec(value).toString();
}

/** An optional stored quantity as the screens read it: empty when there is none. */
function optionalHours(value: string | null): string {
  return value === null ? "" : hoursText(value);
}

/**
 * The live employee linked to the signed-in person in this company, or null (user_profiles.employee_id).
 * A link to a soft-deleted employee counts as no link, so it neither widens data scope nor passes
 * `requireLinkedDecider` (fifth security review of PR #25).
 */
export async function viewerEmployeeId(db: CompanyDb, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ employeeId: userProfiles.employeeId })
    .from(userProfiles)
    .innerJoin(employees, and(eq(employees.id, userProfiles.employeeId), isNull(employees.deletedAt)))
    .where(and(eq(userProfiles.userId, userId), isNull(userProfiles.deletedAt)));
  return row?.employeeId ?? null;
}

/** Whether an employee is the acting person's own; see `selfCheck`. */
export type IsSelf = (employeeId: string) => boolean;

/**
 * Which employees count as the acting person's own, for refusals only (separation of duties;
 * security review of PR #25): the employee linked to their sign-in (user_profiles.employee_id), and
 * any employee whose email is the session's verified email, compared trimmed and case-insensitive.
 * A sign-in that was never linked therefore can't approve, adjust, reopen or pay itself. Never use
 * this to widen what someone sees or may do: data scope stays on the link alone (`personScope`).
 */
export async function selfCheck(db: CompanyDb, actor: Pick<Actor, "access" | "session">): Promise<IsSelf> {
  const email = actor.session.user.email.trim().toLowerCase();
  const [linked, byEmail] = await Promise.all([
    viewerEmployeeId(db, actor.access.userId),
    email
      ? db
          .select({ id: employees.id })
          .from(employees)
          .where(sql`lower(trim(${employees.email})) = ${email}`)
      : Promise.resolve([]),
  ]);
  const own = new Set(byEmail.map((row) => row.id));
  if (linked) own.add(linked);
  return (employeeId) => own.has(employeeId);
}

/** Whose HR records a person sees: their own employee and, by data scope, everyone or their direct reports. */
export interface PersonScope {
  /** The viewer's own employee, or null when their sign-in is not linked to one. */
  employeeId: string | null;
  /** Whether the viewer's data scope covers this employee's timesheets, time off and balances. */
  sees(employeeId: string): boolean;
}

/**
 * The person's HR data scope (hr.md "Data scope", `ownOrReports`, via `seesPersonRecords` in
 * packages/shared): read in the caller's transaction for writes, so a manager change is seen.
 */
export async function personScope(db: CompanyDb, access: RequestAccess): Promise<PersonScope> {
  const [own, rows] = await Promise.all([
    viewerEmployeeId(db, access.userId),
    db.select({ id: employees.id, managerId: employees.managerId }).from(employees).where(isNull(employees.deletedAt)),
  ]);
  const managers = new Map(rows.map((row) => [row.id, row.managerId]));
  return {
    employeeId: own,
    sees: (employeeId) =>
      managers.has(employeeId) &&
      seesPersonRecords(access.dataScope, own, { id: employeeId, managerId: managers.get(employeeId) ?? null }),
  };
}

/** Employees with their documents and checklists, by name. */
export async function loadEmployees(
  db: CompanyDb,
  control: ControlDb,
  companyId: string,
  ids?: readonly string[],
): Promise<Employee[]> {
  const rows = await db
    .select()
    .from(employees)
    .where(and(isNull(employees.deletedAt), ids ? inArray(employees.id, [...ids]) : undefined))
    .orderBy(asc(employees.name));
  if (rows.length === 0) return [];
  const owners = rows.map((row) => row.id);
  const [fileList, items] = await Promise.all([
    fileRows(db, "employee", owners),
    db
      .select()
      .from(employeeChecklistItems)
      .where(and(isNull(employeeChecklistItems.deletedAt), inArray(employeeChecklistItems.employeeId, owners)))
      .orderBy(asc(employeeChecklistItems.position)),
  ]);
  const files = filesByOwner(
    fileList,
    await loadNames(
      control,
      fileList.map((row) => row.createdBy),
    ),
  );
  const listOf = (employeeId: string, list: "onboarding" | "offboarding"): ChecklistItem[] =>
    items
      .filter((item) => item.employeeId === employeeId && item.list === list)
      .map((item) => ({ id: item.id, label: item.label, doneAt: item.doneAt ? minuteOf(item.doneAt) : null }));
  return rows.map((row) => ({
    id: row.id,
    companyId: companyId as CompanyId,
    name: row.name,
    title: row.title,
    department: row.department,
    workerType: row.workerType,
    payType: row.payType,
    payRate: row.payRate,
    state: row.state,
    email: row.email,
    phone: row.phone,
    hiredAt: row.hiredAt,
    status: row.status,
    managerId: row.managerId,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    flsaStatus: row.flsaStatus,
    exemptionBasis: row.exemptionBasis,
    salaryHoursPerWeek: row.salaryHoursPerWeek,
    commissionVisible: row.commissionVisible,
    homeLocationId: row.homeLocationId,
    birthDate: row.birthDate,
    emergencyContact: row.emergencyContact,
    documents: files.get(row.id) ?? [],
    onboarding: listOf(row.id, "onboarding"),
    offboarding: listOf(row.id, "offboarding"),
  }));
}

/**
 * An employee as someone without `hr.employee.view` sees them next to timesheets and time off: the
 * work facts the screens need (name, manager, worker type, work state, hire date), with contact,
 * birthday, documents and checklists left out unless it is their own record (blueprint-delta
 * 2026-11-14; hr.md edge case "DemoStore.list(employees) has no permission check").
 */
export function workFactsOnly(employee: Employee): Employee {
  return {
    ...employee,
    email: "",
    phone: "",
    birthDate: null,
    emergencyContact: null,
    documents: [],
    onboarding: [],
    offboarding: [],
  };
}

/** Which timesheets a loader reads; none means all. */
export interface SheetFilter {
  ids?: readonly string[];
  employeeIds?: readonly string[];
}

/** Timesheets with their seven days of hours as decimal strings, newest week first; deciders by name. */
export async function loadTimesheets(
  db: CompanyDb,
  control: ControlDb,
  filter: SheetFilter = {},
): Promise<TimesheetWire[]> {
  const rows = await db
    .select()
    .from(timesheets)
    .where(
      and(
        isNull(timesheets.deletedAt),
        filter.ids ? inArray(timesheets.id, [...filter.ids]) : undefined,
        filter.employeeIds ? inArray(timesheets.employeeId, [...filter.employeeIds]) : undefined,
      ),
    )
    .orderBy(desc(timesheets.weekStart), asc(timesheets.id));
  if (rows.length === 0) return [];
  const [entries, names] = await Promise.all([
    db
      .select({ timesheetId: timeEntries.timesheetId, date: timeEntries.date, hours: timeEntries.hours })
      .from(timeEntries)
      .where(
        and(
          isNull(timeEntries.deletedAt),
          inArray(
            timeEntries.timesheetId,
            rows.map((row) => row.id),
          ),
        ),
      ),
    loadNames(
      control,
      rows.map((row) => row.decidedById),
    ),
  ]);
  const hours = new Map(entries.map((entry) => [`${entry.timesheetId}|${entry.date}`, hoursText(entry.hours)]));
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    weekStart: row.weekStart,
    // Hours are stored as numeric(14,3) per day and travel as decimal strings (CLAUDE.md rule 6; ADR 0046).
    days: Array.from({ length: 7 }, (_, i) => hours.get(`${row.id}|${addDays(row.weekStart, i)}`) ?? "0"),
    status: row.status,
    submittedAt: row.submittedAt ? minuteOf(row.submittedAt) : null,
    decidedBy: row.decidedById ? (names.get(row.decidedById) ?? "") : null,
    decidedAt: row.decidedAt ? minuteOf(row.decidedAt) : null,
    rejectionReason: row.rejectionReason,
    source: row.source,
    history: row.history,
  }));
}

/** Clock punches, newest first. */
export async function loadClockEntries(db: CompanyDb): Promise<ClockEntry[]> {
  const rows = await db
    .select()
    .from(clockEntries)
    .where(isNull(clockEntries.deletedAt))
    .orderBy(desc(clockEntries.inAt));
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    date: row.date,
    inAt: minuteOf(row.inAt),
    outAt: row.outAt ? minuteOf(row.outAt) : null,
  }));
}

/** A stored time-off policy as the screens read it. */
export function policyView(row: typeof timeOffPolicies.$inferSelect): TimeOffPolicy {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    paid: row.paid,
    accrualMethod: row.accrualMethod,
    accrualRate: hoursText(row.accrualRate),
    capHours: optionalHours(row.capHours),
    annualUseLimitHours: optionalHours(row.annualUseLimitHours),
    carryoverHours: optionalHours(row.carryoverHours),
    waitingPeriodDays: row.waitingPeriodDays,
    allowNegative: row.allowNegative,
  };
}

/** The time-off policies, by name. */
export async function loadPolicies(db: CompanyDb, ids?: readonly string[]): Promise<TimeOffPolicy[]> {
  const rows = await db
    .select()
    .from(timeOffPolicies)
    .where(and(isNull(timeOffPolicies.deletedAt), ids ? inArray(timeOffPolicies.id, [...ids]) : undefined))
    .orderBy(asc(timeOffPolicies.name));
  return rows.map(policyView);
}

/** The time-off ledger, oldest first; a balance is the sum of its lines (hr.md rule 10). */
export async function loadTimeOffEntries(db: CompanyDb, employeeIds?: readonly string[]): Promise<TimeOffEntry[]> {
  const rows = await db
    .select()
    .from(timeOffEntries)
    .where(employeeIds ? inArray(timeOffEntries.employeeId, [...employeeIds]) : undefined)
    .orderBy(asc(timeOffEntries.date), asc(timeOffEntries.id));
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    policyId: row.policyId,
    date: row.date,
    kind: row.kind,
    hours: hoursText(row.hours),
    note: row.note,
    requestId: row.requestId,
    payPeriodId: row.payPeriodId,
  }));
}

/** Which requests a loader reads; none means all. */
export interface RequestFilter {
  ids?: readonly string[];
  employeeIds?: readonly string[];
}

/** Time-off requests, newest first day first; deciders by name. */
export async function loadPtoRequests(
  db: CompanyDb,
  control: ControlDb,
  filter: RequestFilter = {},
): Promise<PtoRequest[]> {
  const rows = await db
    .select()
    .from(ptoRequests)
    .where(
      and(
        isNull(ptoRequests.deletedAt),
        filter.ids ? inArray(ptoRequests.id, [...filter.ids]) : undefined,
        filter.employeeIds ? inArray(ptoRequests.employeeId, [...filter.employeeIds]) : undefined,
      ),
    )
    .orderBy(desc(ptoRequests.start), asc(ptoRequests.id));
  const names = await loadNames(
    control,
    rows.map((row) => row.decidedById),
  );
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    policyId: row.policyId,
    start: row.start,
    end: row.end,
    hours: hoursText(row.hours),
    kind: row.kind,
    status: row.status,
    note: row.note,
    decidedBy: row.decidedById ? (names.get(row.decidedById) ?? "") : null,
    decidedAt: row.decidedAt ? minuteOf(row.decidedAt) : null,
    decisionReason: row.decisionReason,
  }));
}
