import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { clockEntries, employees, timeEntries, timesheets } from "@workspace/db/company";
import {
  addDays,
  clockedHoursText,
  dec,
  daysBetween,
  hoursTextProblem,
  hoursToWire,
  IMPORT_HANDLERS,
  needsTimesheet,
  overtimeRuleFor,
  overwritesNewerHours,
  planImport,
  splitOvertime,
  TIMESHEET_CHANGED_MESSAGE,
  timesheetFromWire,
  withClockedHoursText,
  workweekStartOf,
  type ClockEntry,
  type CompanyId,
  type Employee,
  type ImportWorld,
  type ImportTable,
  type PlannedRow,
  type ImportCounts,
  type Timesheet,
  type TimesheetEvent,
  type TimesheetWire,
} from "@workspace/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AccessService, type RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { NotificationService } from "../../core/notifications/notification.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { companyClock, notFound, refuse } from "../sales/sales-common";
import {
  auditHr,
  CLOSED_WEEK,
  holdersOf,
  inClosedPayPeriod,
  linkedUser,
  lockEmployee,
  lockTimesheet,
  lockTimesheets,
  refuseOwnEntry,
  requireLinkedDecider,
  sheetMakers,
  type TimesheetRow,
} from "./hr-common";
import {
  loadClockEntries,
  loadEmployees,
  loadHrRules,
  hoursText,
  loadTimesheets,
  personScope,
  selfCheck,
  type EmployeeRow,
  type IsSelf,
  type PersonScope,
} from "./hr-records";

/**
 * A week of hours as the form sends it: seven decimal strings (CLAUDE.md rule 6; ADR 0046), and the
 * seven the form started from, so a save over newer hours is refused (ADR 0051, 2026-11-16).
 */
export interface TimesheetFields {
  employeeId: string;
  weekStart: string;
  days: string[];
  expectedDays: string[];
}

/** A decision on submitted sheets; a rejection needs a reason. */
export type TimesheetDecision = { action: "approve" } | { action: "reject"; reason: string };

/** A closed punch, with a note when its hours were not added to the week (`clockOut`). */
export type ClockOutResult = ClockEntry & { note: string | null };

/** A template upload: a dry run unless `apply`; `own` limits it to the person's own rows. */
export interface UploadFields {
  table: ImportTable;
  fileName: string;
  apply: boolean;
  own: boolean;
}

/** Template columns are named by their field keys (`timesheetTemplate`), so each maps to itself. */
const TIMESHEET_MAPPING = Object.fromEntries(IMPORT_HANDLERS.timesheets.def.fields.map((f) => [f.key, f.key]));

const label = (name: string, weekStart: string) => `${name}, week of ${weekStart}`;

const EMPTY_WEEK: readonly string[] = ["0", "0", "0", "0", "0", "0", "0"];

/**
 * Timesheets and the clock on the API (hr.md "Timesheets"; ADR 0046). A week is draft, submitted,
 * approved or sent back; nobody decides their own sheet; an approved week is locked until it is
 * reopened, and a week in an approved pay period can't be reopened. Writes lock the employee
 * first, then the sheet, and write audit_log in the same transaction.
 */
@Injectable()
export class TimesheetsService {
  private readonly logger = new Logger("Timesheets");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly notifications: NotificationService,
    private readonly access: AccessService,
  ) {}

  /** The sheets the person's data scope covers (hr.md "Data scope", `ownOrReports`). */
  async list(tenant: TenantContext, access: RequestAccess): Promise<TimesheetWire[]> {
    const db = await this.tenancy.db(tenant);
    const [rows, scope] = await Promise.all([loadTimesheets(db, this.control.db), personScope(db, access)]);
    return rows.filter((row) => scope.sees(row.employeeId));
  }

  /** Clock punches: everyone's with company-wide scope, else only the person's own (hr.md, `byEmployee`). */
  async listClock(tenant: TenantContext, access: RequestAccess): Promise<ClockEntry[]> {
    const db = await this.tenancy.db(tenant);
    const [rows, scope] = await Promise.all([loadClockEntries(db), personScope(db, access)]);
    if (access.dataScope === "all") return rows;
    return rows.filter((row) => row.employeeId === scope.employeeId);
  }

  /**
   * Saves a week's hours (hr.md "Create or edit hours"): for someone who uses timesheets, valid
   * hours, a real workweek start that is not in the future. A submitted or approved week is
   * locked (blueprint-delta 2026-11-14: the approver must decide the hours that were sent). A save
   * made from hours that changed since the form opened is refused with nothing written (409
   * `timesheet_changed`; blueprint-delta 2026-11-16). The answer is read before the commit, so it
   * shows exactly the hours this save wrote, never those of a writer that was waiting on the lock.
   */
  async save(tenant: TenantContext, actor: Actor, input: TimesheetFields): Promise<TimesheetWire> {
    const problem = hoursTextProblem(input.days);
    if (problem) throw refuse(problem);
    const db = await this.tenancy.db(tenant);
    const [clock, rules] = await Promise.all([companyClock(this.control.db, tenant), loadHrRules(db)]);
    if (workweekStartOf(input.weekStart, rules.workweekStartDay) !== input.weekStart) {
      throw refuse("Choose the first day of the company's workweek.");
    }
    if (input.weekStart > clock.day) throw refuse("Hours can't be entered for a future week.");
    return db.transaction(async (tx) => {
      const scope = await personScope(tx, actor.access);
      const isSelf = await selfCheck(tx, actor);
      const employee = await this.lockForEdit(tx, actor.access, scope, isSelf, input.employeeId);
      if (!needsTimesheet(employee)) throw refuse("This person does not use timesheets.");
      const existing = await this.sheetOf(tx, employee.id, input.weekStart);
      if (existing?.status === "approved") throw refuse("This week is approved, so it is locked.");
      if (existing?.status === "submitted")
        throw refuse("This week waits for approval. Ask for it to be sent back first.");
      if (await weekClosed(tx, input.weekStart)) throw refuse(CLOSED_WEEK);
      // The audit keeps the hours this save replaces (fifth security review of PR #25).
      const previous = existing ? ((await this.daysOf(tx, [existing])).get(existing.id) ?? null) : null;
      // Never over hours saved since the form opened (an upload, the clock, another tab), compared by
      // value under the employee lock and the sheet's FOR UPDATE, so no writer of hours can slip in
      // between; a save of the stored hours is taken (hr.md "Create or edit hours"; ADR 0051, 2026-11-16).
      if (overwritesNewerHours(previous ?? EMPTY_WEEK, input.expectedDays, input.days)) {
        throw new ConflictException({ code: "timesheet_changed", message: TIMESHEET_CHANGED_MESSAGE });
      }
      const sheetId = await this.putSheet(
        tx,
        actor.access.userId,
        existing,
        {
          employeeId: employee.id,
          weekStart: input.weekStart,
          days: input.days.map((h) => hoursText(h)),
          source: existing?.source === "clock" ? "clock" : "form",
        },
        event(actor, new Date(), "saved"),
      );
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Saved timesheet hours",
        targetType: "timesheet",
        targetId: sheetId,
        targetLabel: label(employee.name, input.weekStart),
        before: previous ? { days: previous } : null,
        after: { days: input.days.map((h) => hoursText(h)) },
      });
      // Inside the transaction: My timesheet takes these hours as the ones its form started from, so
      // after the commit an upload or a clock-out waiting on the lock could put its own hours here,
      // and the next save would replace them unseen (ADR 0051, 2026-11-16, review round 1).
      return this.one(tx, sheetId);
    });
  }

  /** Sends a sheet for approval and tells the people who decide sheets, in the app (hr.md "To submitted"). */
  async submit(tenant: TenantContext, actor: Actor, id: string): Promise<TimesheetWire> {
    const db = await this.tenancy.db(tenant);
    const submitted = await db.transaction(async (tx) => {
      const scope = await personScope(tx, actor.access);
      const sheet = await lockTimesheet(tx, id, scope);
      const employee = await this.lockForEdit(tx, actor.access, scope, await selfCheck(tx, actor), sheet.employeeId);
      if (sheet.status === "approved" || sheet.status === "submitted") {
        throw refuse("This timesheet has already been submitted.");
      }
      if (await weekClosed(tx, sheet.weekStart)) throw refuse(CLOSED_WEEK);
      const now = new Date();
      await tx
        .update(timesheets)
        .set({
          status: "submitted",
          submittedAt: now,
          rejectionReason: null,
          history: [...sheet.history, event(actor, now, "submitted")],
          updatedAt: now,
        })
        .where(eq(timesheets.id, sheet.id));
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Submitted timesheet",
        targetType: "timesheet",
        targetId: sheet.id,
        targetLabel: label(employee.name, sheet.weekStart),
        before: { status: sheet.status },
        after: { status: "submitted" },
      });
      return { sheet, employee, at: now };
    });
    await this.tellApprovers(tenant, actor, db, submitted.sheet, submitted.employee, submitted.at);
    return this.one(db, id);
  }

  /**
   * Approves or rejects submitted sheets (hr.md "To approved or rejected"), all or none. Each must
   * be within the decider's data scope (404 otherwise; blueprint-delta 2026-11-14) and none may be
   * their own, by sign-in link or verified email (`selfCheck`). People are locked in employee-id
   * order, then the sheets, so two batches at once can't deadlock. A rejection needs a reason; hours never change. Each approval records its overtime
   * split by the company's rule and the work state (hr.md rules 7 and 8).
   */
  async decide(
    tenant: TenantContext,
    actor: Actor,
    ids: readonly string[],
    decision: TimesheetDecision,
  ): Promise<void> {
    const reason = decision.action === "reject" ? decision.reason.trim() : null;
    if (decision.action === "reject" && (reason ?? "").length < 3) {
      throw refuse("Say what needs correcting, so the employee can fix it.");
    }
    const db = await this.tenancy.db(tenant);
    const rules = await loadHrRules(db);
    const status = decision.action === "approve" ? "approved" : "rejected";
    const decided = await db.transaction(async (tx) => {
      const scope = await personScope(tx, actor.access);
      const isSelf = await selfCheck(tx, actor);
      const done: { sheet: TimesheetRow; employee: EmployeeRow }[] = [];
      for (const sheet of await lockTimesheets(tx, ids, scope)) {
        const employee = await lockEmployee(tx, sheet.employeeId);
        if (isSelf(employee.id)) throw refuse("Someone else must decide your own timesheet.");
        refuseOwnEntry(actor.access, sheetMakers(sheet), `${employee.name}'s hours`);
        if (sheet.status !== "submitted") throw refuse(`${employee.name}'s timesheet is not waiting for approval.`);
        // Paid weeks take no new decision (fourth security review of PR #25).
        if (await weekClosed(tx, sheet.weekStart)) {
          throw refuse(
            `${employee.name}'s week of ${sheet.weekStart} is in an approved pay period. Reopen the pay period first.`,
          );
        }
        done.push({ sheet, employee });
      }
      await requireLinkedDecider(tx, actor.access);
      const now = new Date();
      const days = await this.daysOf(
        tx,
        done.map(({ sheet }) => sheet),
      );
      for (const { sheet, employee } of done) {
        await tx
          .update(timesheets)
          .set({
            status,
            decidedById: actor.access.userId,
            decidedAt: now,
            rejectionReason: reason,
            history: [...sheet.history, event(actor, now, status, reason)],
            updatedAt: now,
          })
          .where(eq(timesheets.id, sheet.id));
        // Hours stay decimal strings through the overtime split (CLAUDE.md rule 6).
        const split = splitOvertime(
          days.get(sheet.id) ?? EMPTY_WEEK,
          overtimeRuleFor(employee.state, rules.overtimeRule),
        );
        await auditHr(this.auditLog, tenant, actor, tx, {
          action: status === "approved" ? "Approved timesheet" : "Rejected timesheet",
          targetType: "timesheet",
          targetId: sheet.id,
          targetLabel: label(employee.name, sheet.weekStart),
          before: { status: sheet.status },
          after:
            status === "approved"
              ? {
                  status,
                  // Hours travel as decimal strings, in the log too (CLAUDE.md rule 6).
                  regular: dec(split.regular).toFixed(2),
                  overtime: dec(split.overtime).toFixed(2),
                  doubleTime: dec(split.doubleTime).toFixed(2),
                }
              : { status, reason },
        });
      }
      return { done, at: now };
    });
    for (const { sheet, employee } of decided.done) {
      await this.tellEmployee(tenant, actor, db, sheet, employee.name, status, reason ?? "", decided.at);
    }
  }

  /**
   * Reopens an approved sheet with a reason, unless its week is in an approved or exported pay
   * period. Nobody reopens their own week (separation of duties; security review of PR #25).
   */
  async reopen(tenant: TenantContext, actor: Actor, id: string, reason: string): Promise<TimesheetWire> {
    const why = reason.trim();
    if (why.length < 3) throw refuse("Say why this timesheet is being reopened.");
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const scope = await personScope(tx, actor.access);
      const sheet = await lockTimesheet(tx, id, scope);
      const employee = await lockEmployee(tx, sheet.employeeId);
      if ((await selfCheck(tx, actor))(employee.id)) throw refuse("Someone else must reopen your own timesheet.");
      await requireLinkedDecider(tx, actor.access);
      if (sheet.status !== "approved") throw refuse("Only an approved timesheet can be reopened.");
      if (await weekClosed(tx, sheet.weekStart)) {
        throw refuse("This week is in an approved pay period. Reopen the pay period first.");
      }
      const now = new Date();
      await tx
        .update(timesheets)
        .set({
          status: "draft",
          decidedById: null,
          decidedAt: null,
          history: [...sheet.history, event(actor, now, "reopened", why)],
          updatedAt: now,
        })
        .where(eq(timesheets.id, sheet.id));
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Reopened timesheet",
        targetType: "timesheet",
        targetId: sheet.id,
        targetLabel: label(employee.name, sheet.weekStart),
        before: { status: "approved" },
        after: { status: "draft", reason: why },
      });
    });
    return this.one(db, id);
  }

  /**
   * Hours from the template (hr.md rule 22), with the same rows and checks as the import wizard.
   * A dry run writes nothing. Saving locks every person in reach, in employee-id order, and plans
   * again under the locks, then locks the sheets in id order (the order `decide` uses). Only people
   * the uploader's scope covers can match a row; an own upload refuses anyone else's. Rows for the
   * uploader's own employee need `hr.timesheet.edit` whatever the upload is called, and every
   * written week passes the checks of `save` again (security review of PR #25).
   */
  async upload(
    tenant: TenantContext,
    actor: Actor,
    input: UploadFields,
  ): Promise<{ rows: PlannedRow[]; counts: ImportCounts }> {
    const db = await this.tenancy.db(tenant);
    const [clock, rules] = await Promise.all([companyClock(this.control.db, tenant), loadHrRules(db)]);
    const plan = async (tx: CompanyDb) => {
      const scope = await personScope(tx, actor.access);
      if (input.own && !scope.employeeId) throw refuse("Your sign-in is not linked to an employee.");
      const people = (await loadEmployees(tx, this.control.db, tenant.companyId)).filter((e) => scope.sees(e.id));
      const sheets = await loadTimesheets(tx, this.control.db, { employeeIds: people.map((e) => e.id) });
      const result = planImport(
        IMPORT_HANDLERS.timesheets,
        { kind: "timesheets", table: input.table, fileName: input.fileName, mapping: TIMESHEET_MAPPING },
        {
          world: emptyWorld({ employees: people, timesheets: sheets.map(timesheetFromWire) }),
          companyId: tenant.companyId as CompanyId,
          today: clock.day,
          now: clock.now.toISOString().slice(0, 16),
          actorId: actor.access.userId,
          batch: { id: "upload", number: "this upload" },
          newId: () => uuidv7(),
          workweekStartDay: rules.workweekStartDay,
          ...(input.own ? { onlyEmployeeId: scope.employeeId ?? "" } : {}),
        },
      );
      const isSelf = await selfCheck(tx, actor);
      const ownRows = result.changes.some((change) => isSelf((change.after as Timesheet).employeeId));
      if (ownRows && !actor.access.permissions.has("hr.timesheet.edit")) {
        throw refuse("You can't upload your own hours. Leave your rows out, or ask someone else to enter them.");
      }
      // Hours for someone else come from a sign-in linked to its own employee (fifth security review of PR #25).
      if (input.apply && result.changes.some((change) => (change.after as Timesheet).employeeId !== scope.employeeId)) {
        await requireLinkedDecider(tx, actor.access);
      }
      return { result, people: new Map(people.map((e) => [e.id, e])) };
    };
    if (!input.apply) {
      const { result: dry } = await plan(db);
      return { rows: dry.rows, counts: dry.counts };
    }
    const saved = await db.transaction(async (tx) => {
      await tx
        .select({ id: employees.id })
        .from(employees)
        .where(isNull(employees.deletedAt))
        .orderBy(asc(employees.id))
        .for("update");
      const { result, people } = await plan(tx);
      if (result.counts.create + result.counts.update === 0) {
        throw refuse("Nothing to save: every row is blank or has errors.");
      }
      const weeks = result.changes.map((change) => change.after as Timesheet).sort((a, b) => a.id.localeCompare(b.id));
      for (const sheet of weeks) {
        const existing = await this.sheetById(tx, sheet.id);
        const days = hoursToWire(sheet.days);
        checkUploadedWeek(people.get(sheet.employeeId), existing, sheet, days, clock.day);
        if (await weekClosed(tx, sheet.weekStart)) throw refuse(CLOSED_WEEK);
        await this.putSheet(
          tx,
          actor.access.userId,
          existing,
          { employeeId: sheet.employeeId, weekStart: sheet.weekStart, days, source: "upload" },
          event(actor, new Date(), "uploaded", input.fileName),
        );
      }
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Uploaded timesheet hours",
        targetType: "timesheet",
        targetId: null,
        targetLabel: input.fileName,
        before: null,
        after: { days: result.counts.create + result.counts.update, sheets: result.changes.length },
      });
      return result;
    });
    return { rows: saved.rows, counts: saved.counts };
  }

  /** Clocks the signed-in person in (spec C2), when the company uses the clock. */
  async clockIn(tenant: TenantContext, actor: Actor): Promise<ClockEntry> {
    const db = await this.tenancy.db(tenant);
    const [clock, rules] = await Promise.all([companyClock(this.control.db, tenant), loadHrRules(db)]);
    if (!rules.clockEnabled) throw refuse("This company does not use the clock.");
    const id = await db.transaction(async (tx) => {
      const employee = await this.ownEmployee(tx, actor.access);
      // Someone who has left no longer clocks in (second security review of PR #25).
      if (employee.status === "terminated") throw refuse("Someone who has left can't clock in.");
      if (!needsTimesheet(employee)) throw refuse("This person does not use timesheets.");
      if (await this.openPunch(tx, employee.id)) throw refuse("You are already clocked in.");
      const [row] = await tx
        .insert(clockEntries)
        .values({ employeeId: employee.id, date: clock.day, inAt: clock.now, createdBy: actor.access.userId })
        .returning({ id: clockEntries.id });
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Clocked in",
        targetType: "clock_entry",
        targetId: row!.id,
        targetLabel: employee.name,
        before: null,
        after: { date: clock.day },
      });
      return row!.id;
    });
    return this.punch(db, id);
  }

  /**
   * Clocks out and adds the hours to that week's sheet (spec C2, ADR 0024): a draft or sent-back
   * sheet takes them; a submitted or approved one is left alone and the punch alone is kept. The
   * punch always closes, so the person can clock in again, but the hours are not added when the
   * week is in an approved pay period (paid hours stay as paid) or when they would put more than 24
   * hours on the day, as `save` would refuse; the audit entry and `note` say so, for HR to correct
   * (security reviews of PR #25: a refused clock-out left the punch open and blocked clock-in).
   */
  async clockOut(tenant: TenantContext, actor: Actor): Promise<ClockOutResult> {
    const db = await this.tenancy.db(tenant);
    const rules = await loadHrRules(db);
    // The company's clock setting decides clock-out as it does clock-in (employee-portal.md known
    // limits; ADR 0049). A punch left open while the clock is off closes once it is back on.
    if (!rules.clockEnabled) throw refuse("This company does not use the clock.");
    const { id, note } = await db.transaction(async (tx) => {
      const employee = await this.ownEmployee(tx, actor.access);
      const open = await this.openPunch(tx, employee.id);
      if (!open) throw refuse("You are not clocked in.");
      const now = new Date();
      await tx.update(clockEntries).set({ outAt: now, updatedAt: now }).where(eq(clockEntries.id, open.id));
      const hours = clockedHoursText(open.inAt.toISOString(), now.toISOString());
      const weekStart = workweekStartOf(open.date, rules.workweekStartDay);
      const sheet = await this.sheetOf(tx, employee.id, weekStart);
      let skipped: { reason: string; note: string } | null = null;
      if (sheet?.status === "approved" || sheet?.status === "submitted") {
        // The approver decides the hours that were sent, so a punch never changes them (fifth security review of PR #25).
        const state = sheet.status === "approved" ? "approved" : "waiting for approval";
        skipped = {
          reason: `week ${sheet.status}, hours not added; HR to correct`,
          note: `Your timesheet for the week of ${weekStart} is ${state}, so these hours were not added. Ask HR to correct your timesheet.`,
        };
      } else {
        const days = sheet ? ((await this.daysOf(tx, [sheet])).get(sheet.id) ?? []) : EMPTY_WEEK;
        const next = withClockedHoursText(days, daysBetween(weekStart, open.date), hours);
        if (await weekClosed(tx, weekStart)) {
          skipped = {
            reason: "closed pay period, hours not added; HR to correct",
            note: `The week of ${weekStart} is in an approved pay period, so these hours were not added. Ask HR to correct your timesheet.`,
          };
        } else if (hoursTextProblem(next)) {
          skipped = {
            reason: "punch over 24 hours, hours not added; HR to correct",
            note: `This punch would put more than 24 hours on ${open.date}, so its hours were not added. Ask HR to correct your timesheet.`,
          };
        } else {
          await this.putSheet(tx, actor.access.userId, sheet, {
            employeeId: employee.id,
            weekStart,
            days: next,
            source: "clock",
          });
        }
      }
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Clocked out",
        targetType: "clock_entry",
        targetId: open.id,
        targetLabel: employee.name,
        before: null,
        after: { date: open.date, hours, ...(skipped ? { hoursAdded: false, reason: skipped.reason } : {}) },
      });
      return { id: open.id, note: skipped?.note ?? null };
    });
    return { ...(await this.punch(db, id)), note };
  }

  /**
   * Locks the person whose hours are written: one's own needs `edit`, anyone else's `approve` and
   * scope. An employee whose email is the actor's counts as their own for the `edit` refusal only.
   */
  private async lockForEdit(
    tx: CompanyDb,
    access: RequestAccess,
    scope: PersonScope,
    isSelf: IsSelf,
    employeeId: string,
  ): Promise<EmployeeRow> {
    const linked = employeeId === scope.employeeId;
    if ((linked || isSelf(employeeId)) && !access.permissions.has("hr.timesheet.edit")) throw notFound("employee");
    if (linked) return lockEmployee(tx, employeeId);
    if (!access.permissions.has("hr.timesheet.approve")) throw notFound("employee");
    const employee = await lockEmployee(tx, employeeId, scope);
    // Hours for someone else come from a sign-in linked to its own employee (fifth security review of PR #25).
    await requireLinkedDecider(tx, access);
    return employee;
  }

  private async ownEmployee(tx: CompanyDb, access: RequestAccess): Promise<EmployeeRow> {
    const scope = await personScope(tx, access);
    if (!scope.employeeId) throw refuse("Your sign-in is not linked to an employee.");
    return lockEmployee(tx, scope.employeeId);
  }

  private async openPunch(tx: CompanyDb, employeeId: string) {
    const [row] = await tx
      .select()
      .from(clockEntries)
      .where(and(eq(clockEntries.employeeId, employeeId), isNull(clockEntries.outAt), isNull(clockEntries.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  private async sheetOf(tx: CompanyDb, employeeId: string, weekStart: string): Promise<TimesheetRow | null> {
    const [row] = await tx
      .select()
      .from(timesheets)
      .where(
        and(eq(timesheets.employeeId, employeeId), eq(timesheets.weekStart, weekStart), isNull(timesheets.deletedAt)),
      )
      .for("update");
    return row ?? null;
  }

  private async sheetById(tx: CompanyDb, id: string): Promise<TimesheetRow | null> {
    const [row] = await tx.select().from(timesheets).where(eq(timesheets.id, id)).for("update");
    return row ?? null;
  }

  /** The seven days of each sheet, as decimal strings in workweek order. */
  private async daysOf(tx: CompanyDb, sheets: readonly TimesheetRow[]): Promise<Map<string, string[]>> {
    if (sheets.length === 0) return new Map();
    const rows = await tx
      .select({ timesheetId: timeEntries.timesheetId, date: timeEntries.date, hours: timeEntries.hours })
      .from(timeEntries)
      .where(
        and(
          isNull(timeEntries.deletedAt),
          inArray(
            timeEntries.timesheetId,
            sheets.map((sheet) => sheet.id),
          ),
        ),
      );
    const byKey = new Map(rows.map((row) => [`${row.timesheetId}|${row.date}`, hoursText(row.hours)]));
    return new Map(
      sheets.map((sheet) => [
        sheet.id,
        Array.from({ length: 7 }, (_, i) => byKey.get(`${sheet.id}|${addDays(sheet.weekStart, i)}`) ?? "0"),
      ]),
    );
  }

  /**
   * Writes a week: a new draft sheet, or the stored one keeping its status and history, and one
   * time entry per day (time_entries, unique per sheet and date).
   */
  private async putSheet(
    tx: CompanyDb,
    by: string,
    existing: TimesheetRow | null,
    week: { employeeId: string; weekStart: string; days: readonly string[]; source: TimesheetRow["source"] },
    step?: TimesheetEvent,
  ): Promise<string> {
    let id: string;
    if (existing) {
      id = existing.id;
      await tx
        .update(timesheets)
        .set({
          source: week.source,
          ...(step ? { history: [...existing.history, step] } : {}),
          updatedAt: new Date(),
        })
        .where(eq(timesheets.id, id));
    } else {
      const [row] = await tx
        .insert(timesheets)
        .values({
          employeeId: week.employeeId,
          weekStart: week.weekStart,
          status: "draft",
          source: week.source,
          history: step ? [step] : [],
          createdBy: by,
        })
        .returning({ id: timesheets.id });
      id = row!.id;
    }
    await tx
      .insert(timeEntries)
      .values(
        week.days.map((hours, i) => ({
          timesheetId: id,
          date: addDays(week.weekStart, i),
          hours,
          createdBy: by,
        })),
      )
      .onConflictDoUpdate({
        target: [timeEntries.timesheetId, timeEntries.date],
        set: { hours: sql`excluded.hours`, updatedAt: new Date(), deletedAt: null },
      });
    return id;
  }

  /**
   * Tells the active people who may approve this person's sheet, in the app only (hr.md "Events"):
   * effective `hr.timesheet.approve` and a data scope that covers the employee (`holdersOf`).
   */
  private async tellApprovers(
    tenant: TenantContext,
    actor: Actor,
    db: CompanyDb,
    sheet: TimesheetRow,
    employee: EmployeeRow,
    at: Date,
  ): Promise<void> {
    const name = employee.name;
    try {
      const approvers = await holdersOf(db, this.control.db, this.access, tenant, "hr.timesheet.approve", employee);
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "timesheet.submitted",
        source: { type: "timesheet", id: sheet.id },
        version: at.toISOString(),
        to: [],
        inApp: approvers.map((person) => ({
          userId: person.id,
          title: `Timesheet from ${name} to approve`,
          href: "/hr/timesheets",
        })),
        values: { "employee.name": name, "timesheet.week": sheet.weekStart },
      });
    } catch {
      this.logger.warn("A timesheet was submitted, but the approvers could not be told.");
    }
  }

  /** Tells the person what happened to their sheet, by email and in the app (hr.md "Events"). */
  private async tellEmployee(
    tenant: TenantContext,
    actor: Actor,
    db: CompanyDb,
    sheet: TimesheetRow,
    name: string,
    decision: string,
    reason: string,
    at: Date,
  ): Promise<void> {
    try {
      const person = await linkedUser(db, this.control.db, sheet.employeeId);
      if (!person) return;
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "timesheet.decided",
        source: { type: "timesheet", id: sheet.id },
        version: at.toISOString(),
        to: [{ kind: "user", id: person.id, name, email: person.email }],
        inApp: [
          { userId: person.id, title: `Your timesheet for ${sheet.weekStart} was ${decision}`, href: "/my/timesheet" },
        ],
        values: {
          "employee.name": name,
          "timesheet.week": sheet.weekStart,
          "timesheet.decision": decision,
          "timesheet.reason": reason,
        },
      });
    } catch {
      this.logger.warn("A timesheet was decided, but the employee could not be told.");
    }
  }

  private async one(db: CompanyDb, id: string): Promise<TimesheetWire> {
    const [sheet] = await loadTimesheets(db, this.control.db, { ids: [id] });
    if (!sheet) throw notFound("timesheet");
    return sheet;
  }

  private async punch(db: CompanyDb, id: string): Promise<ClockEntry> {
    const entry = (await loadClockEntries(db)).find((row) => row.id === id);
    if (!entry) throw notFound("clock entry");
    return entry;
  }
}

/**
 * One step of a sheet's history, by the acting person's name and user id (hr.md "Timesheet"
 * `history`); the id lets a decision refuse whoever entered the hours (`sheetMakers`).
 */
function event(actor: Actor, at: Date, action: TimesheetEvent["action"], reason: string | null = null): TimesheetEvent {
  return {
    at: at.toISOString().slice(0, 16),
    by: actor.session.user.name,
    byUserId: actor.access.userId,
    action,
    reason,
  };
}

/** Whether an approved or exported pay period covers any day of the week from `weekStart`. */
function weekClosed(tx: CompanyDb, weekStart: string): Promise<boolean> {
  return inClosedPayPeriod(tx, weekStart, addDays(weekStart, 6));
}

/** The import world for the timesheet kind, which reads only employees and timesheets. */
function emptyWorld(hr: { employees: Employee[]; timesheets: Timesheet[] }): ImportWorld {
  return {
    customers: [],
    suppliers: [],
    supplierContacts: [],
    products: [],
    rolls: [],
    stockMovements: [],
    invoices: [],
    bills: [],
    employees: hr.employees,
    timesheets: hr.timesheets,
    timeOffEntries: [],
    timeOffPolicies: [],
    locations: [],
    users: [],
    payments: [],
    invoiceAdjustments: [],
    supplierPayments: [],
    reservations: [],
  };
}

/**
 * Refuses an uploaded week that `save` would refuse, checked again under the locks (security
 * review of PR #25): someone who does not use timesheets, a sheet of someone else, a future week,
 * a submitted or approved week, or hours outside 0 to 24 or with more than two decimals.
 */
function checkUploadedWeek(
  employee: Employee | undefined,
  existing: TimesheetRow | null,
  week: Pick<Timesheet, "employeeId" | "weekStart">,
  days: readonly string[],
  today: string,
): void {
  if (!employee || !needsTimesheet(employee)) throw refuse("This person does not use timesheets.");
  if (existing && (existing.employeeId !== week.employeeId || existing.weekStart !== week.weekStart)) {
    throw notFound("timesheet");
  }
  if (week.weekStart > today) throw refuse("Hours can't be entered for a future week.");
  if (existing?.status === "approved") throw refuse("This week is approved, so it is locked.");
  if (existing?.status === "submitted") throw refuse("This week waits for approval. Ask for it to be sent back first.");
  const problem = hoursTextProblem(days);
  if (problem) throw refuse(problem);
}
