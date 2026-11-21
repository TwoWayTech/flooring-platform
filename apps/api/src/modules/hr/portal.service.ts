import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { clockEntries, commissionAssignments, commissionPlans, employees, settings } from "@workspace/db/company";
import {
  addDays,
  earnedInYear,
  featureOn,
  hideMarginBase,
  needsTimesheet,
  ownPayLine,
  ownStatements,
  pendingHours,
  portalVisibility,
  quantityString,
  teamOutView,
  timeOffBalance,
  workweekStartOf,
  type CommissionAssignment,
  type CommissionPlan,
  type CommissionStatementRow,
  type ContractorPayment,
  type Employee,
  type HrSettings,
  type PayPeriod,
  type PayPeriodLine,
  type PortalSwitches,
  type PortalVisibility,
  type PtoRequest,
  type TimeOffPolicy,
  type TimesheetWire,
} from "@workspace/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { instantOf } from "../sales/invoice-records";
import { companyClock, notFound, refuse } from "../sales/sales-common";
import { loadCommissionAssignments, loadCommissionBook, loadCommissionPlans } from "./commission-records";
import { auditHr, lockEmployee, PAYROLL_LOCK } from "./hr-common";
import {
  loadEmployees,
  loadPolicies,
  loadPtoRequests,
  loadTimeOffEntries,
  loadTimesheets,
  viewerEmployeeId,
} from "./hr-records";
import { loadContractorPayments, loadPayPeriods } from "./pay-records";

/** How far back the team calendar reaches: absences that ended within this many days, and later ones. */
const TEAM_WINDOW_DAYS = 92;

/** The signed-in person's own record as the portal sends it: never with the pay rate, which travels as `ownPayRate`. */
export type OwnEmployee = Omit<Employee, "payRate">;

/** The plan terms a signature acknowledges: the ones the portal showed the rep (ADR 0049). */
export interface SignedTerms {
  signedName: string;
  planId: string;
  planVersion: number;
  planUpdatedAt: string;
}

/** One pay period on My pay: the period's dates and status, never anyone else's line or exclusion. */
export interface PortalPayRow {
  period: PayPeriod;
  line: PayPeriodLine;
}

/** Everything the portal shows, for the signed-in person only (employee-portal.md "MyPortal"; ADR 0049). */
export interface PortalView {
  employee: OwnEmployee | null;
  /**
   * The signed-in person's own pay rate, or null. Owner decision 2026-11-14 (ADR 0049): the company
   * setting alone shows a person their own rate. The global sensitive-field interceptor strips
   * `payRate` by name from every response without `hr.employee.view_sensitive`, so the own rate
   * travels under this name, which is not reserved, and only here: it is read from the employee
   * linked to the verified session, never from input, and `employee` never carries `payRate`.
   * Rates anywhere else in this response (a pay line's base rate) are still stripped.
   */
  ownPayRate: string | null;
  visible: PortalVisibility;
  weekStart: string;
  weekStartDay: number;
  timesheets: TimesheetWire[];
  usesTimesheet: boolean;
  clock: { clockedInAt: string | null };
  balances: { policy: TimeOffPolicy; hours: string; pending: string }[];
  requests: PtoRequest[];
  pay: PortalPayRow[];
  earnedThisYear: string;
  statements: CommissionStatementRow[];
  assignment: CommissionAssignment | null;
  plan: CommissionPlan | null;
  contractorPayments: ContractorPayment[];
  teamOut: PtoRequest[];
  teamNames: { id: string; name: string }[];
}

/** What a person may change on their own record (employee-portal.md rule 9, `MyProfilePatch`). */
export interface OwnProfileFields {
  phone: string;
  emergencyContact: Employee["emergencyContact"];
}

/** The portal's reading of Settings → HR: every switch off unless saved on, and the workweek when designated. */
interface PortalSettings {
  switches: PortalSwitches;
  /** 0 Sunday to 6 Saturday, or null when the company never designated its workweek (ADR 0024). */
  workweekStartDay: number | null;
}

/** The person's portal facts that decide visibility, worked out once per request. */
interface PortalBasis {
  employee: Employee | null;
  assignment: CommissionAssignment | null;
  visible: PortalVisibility;
  usesTimesheet: boolean;
  settings: PortalSettings;
}

/**
 * The employee portal on the API (employee-portal.md; ADR 0049). The person is always the one in the
 * verified session: their user id, and the employee linked to their sign-in (user_profiles.employee_id),
 * never an id from the request. Every area the company or a switch hides comes back empty, and the
 * spec's known limits are closed here: the pay rate goes only to someone who may see it, other people's
 * pay lines and exclusions never leave, the team calendar says only that someone is out, and plan
 * terms and statements stay on the server when commission is hidden.
 */
@Injectable()
export class PortalService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
  ) {}

  /** The signed-in person's portal (`myPortal`). An unlinked person gets an overview with nothing in it. */
  async portal(tenant: TenantContext, access: RequestAccess): Promise<PortalView> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const basis = await this.basis(db, tenant, access);
    const { employee, visible, usesTimesheet } = basis;
    const id = employee?.id ?? null;
    const w2 = employee?.workerType === "w2";
    const timeOff = w2 && featureOn("hr.time-off");
    const weekStartDay = basis.settings.workweekStartDay ?? 0;
    const [timesheets, clockedInAt, timeOffView, pay, statements, plan, contractorPayments, team] = await Promise.all([
      id && w2 && featureOn("hr.timesheets") ? loadTimesheets(db, this.control.db, { employeeIds: [id] }) : [],
      id && w2 ? openPunchAt(db, id) : null,
      id && timeOff ? this.timeOff(db, id) : { balances: [], requests: [] },
      id && visible.pay ? this.pay(db, id, visible.commission) : [],
      visible.commission ? this.statements(db, access, clock.zone, clock.day) : [],
      visible.commission && basis.assignment ? loadCommissionPlans(db, [basis.assignment.planId]) : [],
      id && employee?.workerType === "1099" && featureOn("hr.pay-periods")
        ? loadContractorPayments(db).then((rows) => rows.filter((row) => row.employeeId === id))
        : [],
      visible.teamCalendar ? this.team(db, clock.day) : { teamOut: [], teamNames: [] },
    ]);
    return {
      employee: employee ? ownEmployee(employee) : null,
      ownPayRate: employee && visible.rates ? employee.payRate : null,
      visible,
      weekStart: workweekStartOf(clock.day, weekStartDay),
      weekStartDay,
      timesheets,
      usesTimesheet,
      clock: { clockedInAt },
      ...timeOffView,
      pay,
      earnedThisYear: earnedInYear(pay, clock.day.slice(0, 4)),
      statements,
      assignment: visible.commission ? basis.assignment : null,
      plan: plan[0] ?? null,
      contractorPayments,
      ...team,
    };
  }

  /**
   * Changes the signed-in person's phone and emergency contact (employee-portal.md rule 9), nothing
   * else, on the employee linked to their sign-in. Locks the employee and writes "Updated own
   * profile" in the same transaction; a save that changes nothing writes nothing.
   */
  async updateProfile(tenant: TenantContext, actor: Actor, input: OwnProfileFields): Promise<OwnEmployee> {
    const db = await this.tenancy.db(tenant);
    const phone = input.phone.trim();
    const emergencyContact = tidyContact(input.emergencyContact);
    const employeeId = await db.transaction(async (tx) => {
      const linked = await viewerEmployeeId(tx, actor.access.userId);
      if (!linked) throw refuse("Your sign-in is not linked to an employee record.");
      const before = await lockEmployee(tx, linked);
      const contactChanged = JSON.stringify(before.emergencyContact ?? null) !== JSON.stringify(emergencyContact);
      if (before.phone === phone && !contactChanged) return before.id;
      await tx
        .update(employees)
        .set({ phone, emergencyContact, updatedAt: new Date() })
        .where(eq(employees.id, before.id));
      // The emergency contact is someone else's personal data, so the entry says only that it changed.
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Updated own profile",
        targetType: "employee",
        targetId: before.id,
        targetLabel: before.name,
        before: { phone: before.phone },
        after: { phone, emergencyContactChanged: contactChanged },
      });
      return before.id;
    });
    const basis = await this.basis(db, tenant, actor.access);
    if (!basis.employee || basis.employee.id !== employeeId) throw notFound("employee");
    return ownEmployee(basis.employee);
  }

  /**
   * The rep signs their own plan by typing their name (commissions.md rule 15; ADR 0049): the
   * assignment must be the signed-in user's, running and unsigned, and My commission must be shown
   * to them, because a signature acknowledges terms the person has read. The name must be the
   * account's, ignoring case and surrounding spaces. Takes the payroll lock first, as a plan edit
   * that clears signatures does, and the request names the terms it read (plan id, version and
   * when it last changed): unless they are the assignment's current plan as it stands, it is a 409,
   * so a signature never lands on terms the rep did not see (second security review of PR #28).
   */
  async signPlan(tenant: TenantContext, actor: Actor, assignmentId: string, terms: SignedTerms): Promise<void> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      await tx.execute(PAYROLL_LOCK);
      const [row] = await tx
        .select()
        .from(commissionAssignments)
        .where(eq(commissionAssignments.id, assignmentId))
        .for("update");
      // Someone else's assignment reads as missing, so its existence is not revealed.
      if (!row || row.deletedAt || row.userId !== actor.access.userId) throw notFound("plan assignment");
      if (row.effectiveTo !== null) throw refuse("This plan assignment has ended, so there is nothing to sign.");
      const basis = await this.basis(tx, tenant, actor.access);
      if (!basis.visible.commission || basis.assignment?.id !== row.id) {
        throw refuse("Commission is not shown here. Ask HR for a copy of your plan to sign.");
      }
      if (row.acknowledgedAt) throw refuse("You have already signed this plan.");
      const [plan] = await tx
        .select({ id: commissionPlans.id, version: commissionPlans.version, updatedAt: commissionPlans.updatedAt })
        .from(commissionPlans)
        .where(eq(commissionPlans.id, row.planId));
      const same =
        plan !== undefined &&
        terms.planId === plan.id &&
        terms.planVersion === plan.version &&
        terms.planUpdatedAt === plan.updatedAt.toISOString();
      if (!same) {
        throw new ConflictException({
          code: "plan_changed",
          message: "Your plan has changed since you opened it. Read the new terms, then sign again.",
        });
      }
      const typed = terms.signedName.trim();
      if (!typed || typed.toLowerCase() !== actor.session.user.name.trim().toLowerCase()) {
        throw refuse("Type your full name exactly as it appears on your account.");
      }
      const now = new Date();
      await tx
        .update(commissionAssignments)
        .set({ acknowledgedName: typed, acknowledgedAt: now, updatedAt: now })
        .where(eq(commissionAssignments.id, row.id));
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Signed commission plan",
        targetType: "commission_assignment",
        targetId: row.id,
        targetLabel: actor.session.user.name,
        before: { signed: false },
        after: { signed: true, planId: row.planId, planVersion: plan!.version },
      });
    });
  }

  /**
   * Who the person is to the portal and what they may see (employee-portal.md rule 1), narrowed on
   * the server (ADR 0049): pay needs the pay-periods switch; commission needs the Flooring Suite
   * (`core`) and the commissions switch; one's own rate needs a linked employee and the company
   * setting, nothing more (owner decision 2026-11-14; anyone else's rate still needs
   * `hr.employee.view_sensitive`, CLAUDE.md rule 5); the team calendar needs a linked employee and
   * the time-off switch; the clock needs both clock switches and a designated workweek.
   */
  private async basis(db: CompanyDb, tenant: TenantContext, access: RequestAccess): Promise<PortalBasis> {
    const commissionsOn = featureOn("hr.commissions") && access.modules.includes("core");
    const [linked, portalSettings, assignments] = await Promise.all([
      viewerEmployeeId(db, access.userId),
      loadPortalSettings(db),
      commissionsOn ? loadCommissionAssignments(db) : [],
    ]);
    const [employee] = linked ? await loadEmployees(db, this.control.db, tenant.companyId, [linked]) : [];
    const assignment = assignments.find((a) => a.userId === access.userId && a.effectiveTo === null) ?? null;
    const own = portalVisibility(employee ?? null, portalSettings.switches, assignment !== null);
    const designated = portalSettings.workweekStartDay !== null;
    const usesTimesheet = !!employee && needsTimesheet(employee) && featureOn("hr.timesheets") && designated;
    const visible: PortalVisibility = {
      pay: own.pay && featureOn("hr.pay-periods"),
      commission: own.commission && commissionsOn,
      rates: own.rates && !!employee,
      teamCalendar: own.teamCalendar && !!employee && featureOn("hr.time-off"),
      clock: own.clock && usesTimesheet && featureOn("hr.clock"),
    };
    return { employee: employee ?? null, assignment, visible, usesTimesheet, settings: portalSettings };
  }

  /** Own balances per policy (rule 6) and own requests, newest first. */
  private async timeOff(db: CompanyDb, employeeId: string) {
    const [policies, entries, requests] = await Promise.all([
      loadPolicies(db),
      loadTimeOffEntries(db, [employeeId]),
      loadPtoRequests(db, this.control.db, { employeeIds: [employeeId] }),
    ]);
    return {
      balances: policies.map((policy) => ({
        policy,
        hours: quantityString(timeOffBalance(entries, employeeId, policy.id)),
        pending: quantityString(pendingHours(requests, employeeId, policy.id)),
      })),
      requests,
    };
  }

  /**
   * My pay (rules 3 and 4): only approved or exported runs, which hold a stored line for the person,
   * newest first. The period travels without anyone else's lines or exclusions, and the line goes
   * through `ownPayLine`, so hidden commission leaves it. Rates in the line are stripped on the way
   * out without view_sensitive (CLAUDE.md rule 5).
   */
  private async pay(db: CompanyDb, employeeId: string, showCommission: boolean): Promise<PortalPayRow[]> {
    const periods = await loadPayPeriods(db, this.control.db);
    return periods.flatMap((period) => {
      if (period.status !== "approved" && period.status !== "exported") return [];
      const line = period.lines.find((l) => l.employeeId === employeeId);
      if (!line) return [];
      return [{ period: { ...period, excluded: [], lines: [] }, line: ownPayLine(line, showCommission) }];
    });
  }

  /**
   * Own statements (rule 7) from the shared engine. A margin plan's base is margin dollars, hidden
   * without `sales.margin.view_sensitive` as on HR → Commissions (CLAUDE.md rule 5; ADR 0049).
   */
  private async statements(
    db: CompanyDb,
    access: RequestAccess,
    zone: string,
    day: string,
  ): Promise<CommissionStatementRow[]> {
    const book = await loadCommissionBook(db, this.control.db, zone, day);
    const rows = access.permissions.has("sales.margin.view_sensitive") ? book.rows : hideMarginBase(book.rows);
    return ownStatements(rows, access.userId);
  }

  /**
   * Colleagues' approved time off as "out" (rule 10), with the names of only the people in it: people
   * who have not left, and absences ending no more than `TEAM_WINDOW_DAYS` ago (PR #28 security review).
   */
  private async team(db: CompanyDb, today: string): Promise<Pick<PortalView, "teamOut" | "teamNames">> {
    const people = await db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(and(isNull(employees.deletedAt), ne(employees.status, "terminated")));
    const since = addDays(today, -TEAM_WINDOW_DAYS);
    const requests = await loadPtoRequests(db, this.control.db, { employeeIds: people.map((person) => person.id) });
    const teamOut = requests.filter((r) => r.status === "approved" && r.end >= since).map(teamOutView);
    const out = new Set(teamOut.map((r) => r.employeeId));
    return { teamOut, teamNames: people.filter((person) => out.has(person.id)) };
  }
}

/** The person's own record without the pay rate, which travels only as `ownPayRate` (employee-portal.md rule 9; ADR 0049). */
function ownEmployee(employee: Employee): OwnEmployee {
  const own: OwnEmployee & { payRate?: string } = { ...employee };
  delete own.payRate;
  return own;
}

/** An emergency contact trimmed; one with every field blank is none. */
function tidyContact(contact: Employee["emergencyContact"]): Employee["emergencyContact"] {
  if (!contact) return null;
  const tidy = { name: contact.name.trim(), phone: contact.phone.trim(), relation: contact.relation.trim() };
  return tidy.name || tidy.phone || tidy.relation ? tidy : null;
}

/** When the person clocked in, from their open punch, or null. */
async function openPunchAt(db: CompanyDb, employeeId: string): Promise<string | null> {
  const [row] = await db
    .select({ inAt: clockEntries.inAt })
    .from(clockEntries)
    .where(and(eq(clockEntries.employeeId, employeeId), isNull(clockEntries.outAt), isNull(clockEntries.deletedAt)))
    .limit(1);
  return row ? instantOf(row.inAt) : null;
}

/**
 * Settings → HR as the portal reads it. Unlike hours (`loadHrRules`, 409 without settings), the
 * overview never fails: a switch not saved as on is off, the safest reading, and a workweek never
 * designated leaves timesheets and the clock out (ADR 0024, 0049).
 */
async function loadPortalSettings(db: CompanyDb): Promise<PortalSettings> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.group, "hr"), isNull(settings.deletedAt)));
  const hr = (row?.value ?? {}) as Partial<HrSettings>;
  const day = hr.workweekStartDay;
  return {
    switches: {
      showPayToEmployees: hr.showPayToEmployees === true,
      showCommissionToEmployees: hr.showCommissionToEmployees === true,
      showRatesToEmployees: hr.showRatesToEmployees === true,
      showTeamCalendarToEmployees: hr.showTeamCalendarToEmployees === true,
      clockEnabled: hr.clockEnabled === true,
    },
    workweekStartDay: typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6 ? day : null,
  };
}
