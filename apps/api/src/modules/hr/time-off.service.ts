import { Inject, Injectable, Logger } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { employees, ptoRequests, timeOffEntries, timeOffPolicies } from "@workspace/db/company";
import {
  approvedHoursInYear,
  californiaPolicyProblem,
  dec,
  pendingHours,
  timeOffBalance,
  timeOffRequestProblem,
  type PtoRequest,
  type TimeOffEntry,
  type TimeOffPolicy,
} from "@workspace/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
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
  holdersOf,
  inClosedPayPeriod,
  linkedUser,
  lockEmployee,
  lockRequest,
  refuseOwnEntry,
  requireLinkedDecider,
  type RequestRow,
} from "./hr-common";

/** Why time off on paid days can't change (fifth security review of PR #25). */
const CLOSED_DAYS =
  "These days are in an approved pay period, so their time off can't change. Reopen the pay period first.";
import {
  hoursText,
  loadPolicies,
  loadPtoRequests,
  loadTimeOffEntries,
  personScope,
  policyView,
  selfCheck,
  type EmployeeRow,
  type IsSelf,
  type PersonScope,
} from "./hr-records";

/** A time-off request as the form sends it. */
export interface TimeOffFields {
  employeeId: string;
  policyId: string;
  start: string;
  end: string;
  hours: string;
  note: string;
}

/** A decision on a pending request; a decline needs a reason. */
export type TimeOffDecision = { action: "approve" } | { action: "deny"; reason: string };

/** A manual change to a balance, with the reason that stays on its history. */
export interface AdjustmentFields {
  employeeId: string;
  policyId: string;
  hours: string;
  note: string;
}

/** A policy as Settings → HR sends it. */
export type PolicyFields = Omit<TimeOffPolicy, "id">;

type PolicyRow = typeof timeOffPolicies.$inferSelect;

const label = (name: string, start: string) => `${name}, ${start}`;

/**
 * Time off on the API (hr.md "Time off"; ADR 0046): policies, the append-only ledger and requests.
 * Approving posts a `used` line, cancelling an approved request gives the hours back with an
 * `adjustment`; nobody decides or adjusts their own time off, by sign-in link or verified email. Writes lock the employee first,
 * so two requests at once can't both spend the same balance. Accrual is posted with pay periods.
 */
@Injectable()
export class TimeOffService {
  private readonly logger = new Logger("TimeOff");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly notifications: NotificationService,
    private readonly access: AccessService,
  ) {}

  /** Every policy; they are company-wide reference data (hr.md "Data scope"). */
  async listPolicies(tenant: TenantContext): Promise<TimeOffPolicy[]> {
    return loadPolicies(await this.tenancy.db(tenant));
  }

  /** The ledger lines the person's data scope covers (`ownOrReports`). */
  async listEntries(tenant: TenantContext, access: RequestAccess): Promise<TimeOffEntry[]> {
    const db = await this.tenancy.db(tenant);
    const [rows, scope] = await Promise.all([loadTimeOffEntries(db), personScope(db, access)]);
    return rows.filter((row) => scope.sees(row.employeeId));
  }

  /** The requests the person's data scope covers (`ownOrReports`). */
  async listRequests(tenant: TenantContext, access: RequestAccess): Promise<PtoRequest[]> {
    const db = await this.tenancy.db(tenant);
    const [rows, scope] = await Promise.all([loadPtoRequests(db, this.control.db), personScope(db, access)]);
    return rows.filter((row) => scope.sees(row.employeeId));
  }

  /**
   * Asks for time off (hr.md rule 11 through `timeOffRequestProblem`): one's own with
   * `hr.pto.request`, someone else's in scope with `hr.pto.approve`. Tells the approvers.
   */
  async request(tenant: TenantContext, actor: Actor, input: TimeOffFields): Promise<PtoRequest> {
    const db = await this.tenancy.db(tenant);
    const made = await db.transaction(async (tx) => {
      const scope = await personScope(tx, actor.access);
      const isSelf = await selfCheck(tx, actor);
      const employee = await this.lockFor(tx, actor.access, scope, isSelf, input.employeeId);
      const policy = await this.policy(tx, input.policyId);
      const [entries, requests] = await Promise.all([
        loadTimeOffEntries(tx, [employee.id]),
        loadPtoRequests(tx, this.control.db, { employeeIds: [employee.id] }),
      ]);
      const problem = timeOffRequestProblem({
        employee,
        policy,
        start: input.start,
        end: input.end,
        hours: input.hours,
        balance: timeOffBalance(entries, employee.id, policy.id),
        pending: pendingHours(requests, employee.id, policy.id),
        approvedThisYear: approvedHoursInYear(requests, employee.id, policy.id, input.start.slice(0, 4)),
      });
      if (problem) throw refuse(problem);
      if (await inClosedPayPeriod(tx, input.start, input.end)) throw refuse(CLOSED_DAYS);
      const [row] = await tx
        .insert(ptoRequests)
        .values({
          employeeId: employee.id,
          policyId: policy.id,
          start: input.start,
          end: input.end,
          hours: input.hours,
          kind: policy.kind,
          status: "pending",
          note: input.note.trim(),
          createdBy: actor.access.userId,
        })
        .returning();
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Requested time off",
        targetType: "pto_request",
        targetId: row!.id,
        targetLabel: label(employee.name, input.start),
        before: null,
        after: { policy: policy.name, start: input.start, end: input.end, hours: hoursText(input.hours) },
      });
      return { row: row!, employee, policy };
    });
    await this.tellApprovers(tenant, actor, db, made.row, made.employee, made.policy.name);
    return this.one(db, made.row.id);
  }

  /**
   * Approves or declines a pending request (hr.md "To approved", "To denied"): within the decider's
   * scope (blueprint-delta 2026-11-14), never their own; a decline needs a reason. Approving re-checks
   * the request rule against the balance now (`checkStillFits`) and posts
   * a `used` line of negative hours dated the first day.
   */
  async decide(tenant: TenantContext, actor: Actor, id: string, decision: TimeOffDecision): Promise<PtoRequest> {
    const reason = decision.action === "deny" ? decision.reason.trim() : null;
    if (decision.action === "deny" && (reason ?? "").length < 3) throw refuse("Say why, so the employee knows.");
    const db = await this.tenancy.db(tenant);
    const status = decision.action === "approve" ? "approved" : "denied";
    const decided = await db.transaction(async (tx) => {
      const scope = await personScope(tx, actor.access);
      const request = await lockRequest(tx, id, scope);
      const employee = await lockEmployee(tx, request.employeeId);
      if ((await selfCheck(tx, actor))(employee.id)) throw refuse("Someone else must decide your own time off.");
      // Whoever asked for it on the employee's behalf doesn't also decide it (maker-checker).
      refuseOwnEntry(actor.access, new Set(request.createdBy ? [request.createdBy] : []), "time off");
      await requireLinkedDecider(tx, actor.access);
      if (request.status !== "pending") throw refuse("This request has already been decided.");
      if (await inClosedPayPeriod(tx, request.start, request.end)) throw refuse(CLOSED_DAYS);
      if (status === "approved") await this.checkStillFits(tx, employee, request);
      const now = new Date();
      await tx
        .update(ptoRequests)
        .set({ status, decidedById: actor.access.userId, decidedAt: now, decisionReason: reason, updatedAt: now })
        .where(eq(ptoRequests.id, request.id));
      if (status === "approved") {
        await tx.insert(timeOffEntries).values({
          employeeId: request.employeeId,
          policyId: request.policyId,
          date: request.start,
          kind: "used",
          hours: dec(request.hours).negated().toString(),
          note: "Time off taken",
          requestId: request.id,
          createdBy: actor.access.userId,
        });
      }
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: status === "approved" ? "Approved time off" : "Declined time off",
        targetType: "pto_request",
        targetId: request.id,
        targetLabel: label(employee.name, request.start),
        before: { status: "pending" },
        after: reason ? { status, reason } : { status },
      });
      return { request, employee };
    });
    await this.tellEmployee(tenant, actor, db, decided.request, decided.employee.name, status, reason ?? "");
    return this.one(db, id);
  }

  /**
   * Cancels a pending or approved request (hr.md "To cancelled"); one that has started can't be.
   * An approved one gives its hours back with an `adjustment` dated today.
   */
  async cancel(tenant: TenantContext, actor: Actor, id: string): Promise<PtoRequest> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const scope = await personScope(tx, actor.access);
      const request = await lockRequest(tx, id, scope);
      const employee = await this.lockFor(tx, actor.access, scope, await selfCheck(tx, actor), request.employeeId);
      if (request.status !== "pending" && request.status !== "approved") {
        throw refuse("This request can't be cancelled.");
      }
      if (request.status === "approved" && request.start < clock.day) {
        throw refuse("Time off that has started can't be cancelled.");
      }
      if (request.status === "approved" && (await inClosedPayPeriod(tx, request.start, request.end))) {
        throw refuse(CLOSED_DAYS);
      }
      if (request.status === "approved") {
        await tx.insert(timeOffEntries).values({
          employeeId: request.employeeId,
          policyId: request.policyId,
          date: clock.day,
          kind: "adjustment",
          hours: hoursText(request.hours),
          note: "Cancelled time off returned",
          requestId: request.id,
          createdBy: actor.access.userId,
        });
      }
      await tx
        .update(ptoRequests)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(ptoRequests.id, request.id));
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Cancelled time off",
        targetType: "pto_request",
        targetId: request.id,
        targetLabel: label(employee.name, request.start),
        before: { status: request.status },
        after: { status: "cancelled" },
      });
    });
    return this.one(db, id);
  }

  /**
   * A manual change to someone's balance with a reason (hr.md `adjustTimeOff`; ADR 0024: every
   * change is a ledger line). Within scope, and never one's own balance (blueprint-delta 2026-11-14).
   */
  async adjust(tenant: TenantContext, actor: Actor, input: AdjustmentFields): Promise<TimeOffEntry> {
    const note = input.note.trim();
    if (note.length < 3) throw refuse("Give a reason; it stays on the balance history.");
    if (dec(input.hours).isZero()) throw refuse("Enter the hours to add or take away.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const entryId = await db.transaction(async (tx) => {
      const scope = await personScope(tx, actor.access);
      const employee = await lockEmployee(tx, input.employeeId, scope);
      if ((await selfCheck(tx, actor))(employee.id)) throw refuse("Someone else must adjust your own balance.");
      await requireLinkedDecider(tx, actor.access);
      const policy = await this.policy(tx, input.policyId);
      const [row] = await tx
        .insert(timeOffEntries)
        .values({
          employeeId: employee.id,
          policyId: policy.id,
          date: clock.day,
          kind: "adjustment",
          hours: input.hours,
          note,
          requestId: null,
          createdBy: actor.access.userId,
        })
        .returning({ id: timeOffEntries.id });
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Adjusted time-off balance",
        targetType: "employee",
        targetId: employee.id,
        targetLabel: employee.name,
        before: null,
        after: { policy: policy.name, hours: hoursText(input.hours), note },
      });
      return row!.id;
    });
    const entries = await loadTimeOffEntries(db, [input.employeeId]);
    return entries.find((entry) => entry.id === entryId)!;
  }

  /**
   * Adds or edits a policy (Settings → HR). With a non-terminated California employee, a vacation
   * or personal policy may not limit carryover (hr.md rule 13). Audited as a settings change.
   */
  async savePolicy(
    tenant: TenantContext,
    actor: Actor,
    id: string | null,
    input: PolicyFields,
  ): Promise<TimeOffPolicy> {
    const name = input.name.trim();
    if (!name) throw refuse("Give the policy a name.");
    const db = await this.tenancy.db(tenant);
    const policyId = await db.transaction(async (tx) => {
      const [california] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.state, "CA"), ne(employees.status, "terminated"), isNull(employees.deletedAt)))
        .limit(1);
      const problem = california ? californiaPolicyProblem(input) : null;
      if (problem) throw refuse(problem);
      const values = {
        name,
        kind: input.kind,
        paid: input.paid,
        accrualMethod: input.accrualMethod,
        accrualRate: input.accrualRate,
        capHours: input.capHours || null,
        annualUseLimitHours: input.annualUseLimitHours || null,
        carryoverHours: input.carryoverHours || null,
        waitingPeriodDays: input.waitingPeriodDays,
        allowNegative: input.allowNegative,
      };
      let before: PolicyRow | null = null;
      let row: PolicyRow;
      if (id) {
        [before] = await tx.select().from(timeOffPolicies).where(eq(timeOffPolicies.id, id)).for("update");
        if (!before || before.deletedAt) throw notFound("policy");
        [row] = (await tx
          .update(timeOffPolicies)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(timeOffPolicies.id, id))
          .returning()) as [PolicyRow];
      } else {
        [row] = (await tx
          .insert(timeOffPolicies)
          .values({ ...values, createdBy: actor.access.userId })
          .returning()) as [PolicyRow];
      }
      await auditHr(this.auditLog, tenant, actor, tx, {
        category: "settings",
        action: before ? "Edited time-off policy" : "Added time-off policy",
        targetType: "time_off_policy",
        targetId: row.id,
        targetLabel: row.name,
        before: before ? { ...policyView(before) } : null,
        after: { ...policyView(row) },
      });
      return row.id;
    });
    return (await loadPolicies(db, [policyId]))[0]!;
  }

  /**
   * Locks the person a request is about: one's own needs `hr.pto.request`, anyone else's
   * `hr.pto.approve` and scope. An employee whose email is the actor's counts as their own for
   * the `hr.pto.request` refusal only.
   */
  private async lockFor(
    tx: CompanyDb,
    access: RequestAccess,
    scope: PersonScope,
    isSelf: IsSelf,
    employeeId: string,
  ): Promise<EmployeeRow> {
    const linked = employeeId === scope.employeeId;
    if ((linked || isSelf(employeeId)) && !access.permissions.has("hr.pto.request")) throw notFound("employee");
    if (linked) return lockEmployee(tx, employeeId);
    if (!access.permissions.has("hr.pto.approve")) throw notFound("employee");
    const employee = await lockEmployee(tx, employeeId, scope);
    // Time off for someone else comes from a sign-in linked to its own employee (fifth security review of PR #25).
    await requireLinkedDecider(tx, access);
    return employee;
  }

  /**
   * Re-runs the request rule (hr.md rule 11, `timeOffRequestProblem`) at approval, under the
   * employee lock, with this request left out of the pending hours: the balance may have dropped
   * since it was asked for, for example by an adjustment (second security review of PR #25).
   */
  private async checkStillFits(tx: CompanyDb, employee: EmployeeRow, request: RequestRow): Promise<void> {
    const policy = await this.policy(tx, request.policyId);
    const [entries, requests] = await Promise.all([
      loadTimeOffEntries(tx, [employee.id]),
      loadPtoRequests(tx, this.control.db, { employeeIds: [employee.id] }),
    ]);
    const others = requests.filter((row) => row.id !== request.id);
    const problem = timeOffRequestProblem({
      employee,
      policy,
      start: request.start,
      end: request.end,
      hours: hoursText(request.hours),
      balance: timeOffBalance(entries, employee.id, policy.id),
      pending: pendingHours(others, employee.id, policy.id),
      approvedThisYear: approvedHoursInYear(others, employee.id, policy.id, request.start.slice(0, 4)),
    });
    if (problem) throw refuse(problem);
  }

  private async policy(tx: CompanyDb, id: string): Promise<TimeOffPolicy> {
    const [policy] = await loadPolicies(tx, [id]);
    if (!policy) throw refuse("Choose a type of time off.");
    return policy;
  }

  /**
   * Tells the active people who may decide this person's request, by email and in the app (hr.md
   * "Events"): effective `hr.pto.approve` and a data scope that covers the employee (`holdersOf`).
   */
  private async tellApprovers(
    tenant: TenantContext,
    actor: Actor,
    db: CompanyDb,
    request: RequestRow,
    employee: EmployeeRow,
    kind: string,
  ): Promise<void> {
    const name = employee.name;
    try {
      const approvers = await holdersOf(db, this.control.db, this.access, tenant, "hr.pto.approve", employee);
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "timeoff.requested",
        source: { type: "timeoff", id: request.id },
        to: approvers.map((person) => ({
          kind: "user" as const,
          id: person.id,
          name: person.name,
          email: person.email,
        })),
        inApp: approvers.map((person) => ({
          userId: person.id,
          title: `Time off request from ${name}`,
          href: "/hr/time-off",
        })),
        values: {
          "employee.name": name,
          "timeoff.kind": kind,
          "timeoff.start": request.start,
          "timeoff.end": request.end,
        },
      });
    } catch {
      this.logger.warn("Time off was requested, but the approvers could not be told.");
    }
  }

  /** Tells the person what happened to their request, by email and in the app (hr.md "Events"). */
  private async tellEmployee(
    tenant: TenantContext,
    actor: Actor,
    db: CompanyDb,
    request: RequestRow,
    name: string,
    decision: string,
    reason: string,
  ): Promise<void> {
    try {
      const person = await linkedUser(db, this.control.db, request.employeeId);
      if (!person) return;
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "timeoff.decided",
        source: { type: "timeoff", id: request.id },
        to: [{ kind: "user", id: person.id, name, email: person.email }],
        inApp: [
          { userId: person.id, title: `Your time off from ${request.start} was ${decision}`, href: "/my/time-off" },
        ],
        values: {
          "employee.name": name,
          "timeoff.start": request.start,
          "timeoff.end": request.end,
          "timeoff.decision": decision,
          "timeoff.reason": reason,
        },
      });
    } catch {
      this.logger.warn("Time off was decided, but the employee could not be told.");
    }
  }

  private async one(db: CompanyDb, id: string): Promise<PtoRequest> {
    const [request] = await loadPtoRequests(db, this.control.db, { ids: [id] });
    if (!request) throw notFound("request");
    return request;
  }
}
