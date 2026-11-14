import { Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { employeeChecklistItems, employees, locations, userProfiles } from "@workspace/db/company";
import type { StorageProvider } from "@workspace/providers";
import {
  dec,
  featureOn,
  isStateCode,
  OFFBOARDING_STEPS,
  ONBOARDING_STEPS,
  SENSITIVE,
  type Employee,
} from "@workspace/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { STORAGE } from "../../core/storage/storage.module";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { checkProofs, withStoredProofs, type ProofUpload } from "../sales/proof-files";
import { notFound, refuse } from "../sales/sales-common";
import { auditHr, lockEmployee } from "./hr-common";
import { loadEmployees, personScope, viewerEmployeeId, workFactsOnly, type EmployeeRow } from "./hr-records";

/** A person's HR record as the form sends it (hr.md "Employee"). No Social Security or bank fields exist. */
export interface EmployeeFields {
  name: string;
  title: string;
  department: string;
  workerType: Employee["workerType"];
  payType: Employee["payType"];
  /** Taken only from holders of hr.employee.view_sensitive (CLAUDE.md rule 5). */
  payRate?: string | undefined;
  state: string;
  email: string;
  phone: string;
  hiredAt: string;
  status: Employee["status"];
  managerId: string | null;
  flsaStatus: Employee["flsaStatus"];
  exemptionBasis: Employee["exemptionBasis"];
  salaryHoursPerWeek: number;
  commissionVisible: boolean | null;
  homeLocationId: string | null;
  emergencyContact: Employee["emergencyContact"];
  /** The member of this company whose sign-in is this person; null unlinks, absent keeps the link. */
  userId?: string | null | undefined;
}

/**
 * People on the API (hr.md "People"; ADR 0046): the register, onboarding and offboarding
 * checklists, documents and the sign-in link. Every write locks the employee and writes audit_log
 * in the same transaction. The pay rate is stripped from responses by the sensitive-fields
 * interceptor and kept as stored when someone without the key saves (CLAUDE.md rule 5).
 */
@Injectable()
export class PeopleService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
  ) {}

  /**
   * The people the person may read. `hr.employee.view` reads every record (hr.md "Data scope":
   * employees have no filter). Someone who reaches HR only through timesheets, time off or the
   * settings sees the people their data scope covers, with personal details left out except on
   * their own record (hr.md edge case "A real API must narrow this").
   */
  async list(tenant: TenantContext, access: RequestAccess): Promise<Employee[]> {
    const db = await this.tenancy.db(tenant);
    const all = await loadEmployees(db, this.control.db, tenant.companyId);
    if (access.permissions.has("hr.employee.view") && featureOn("hr.employees")) return all;
    const scope = await personScope(db, access);
    return all
      .filter((employee) => scope.sees(employee.id))
      .map((employee) => (employee.id === scope.employeeId ? employee : workFactsOnly(employee)));
  }

  /**
   * Adds or edits a person (hr.md rule 2). A 1099 worker is outside overtime law; a W-2 worker is
   * exempt or non-exempt; only an exempt person has an exemption basis; a California salary
   * covers 40 hours (Labor Code 515). A new person gets the onboarding checklist.
   */
  async save(tenant: TenantContext, actor: Actor, id: string | null, input: EmployeeFields): Promise<Employee> {
    const name = input.name.trim();
    if (!name) throw refuse("Enter the person's name.");
    if (!isStateCode(input.state)) throw refuse("Choose the work state, such as CO.");
    if (input.workerType === "w2" && input.flsaStatus === "not_applicable") {
      throw refuse("Choose whether this W-2 worker is exempt or non-exempt.");
    }
    const db = await this.tenancy.db(tenant);
    const employeeId = id ?? uuidv7();
    const seesPay = actor.access.permissions.has(SENSITIVE.payRate);
    await db.transaction(async (tx) => {
      const before = id ? await lockEmployee(tx, id) : null;
      // Without the key the stored rate stays, and a new person starts at zero (hr.md "Who uses it").
      const payRate = seesPay && input.payRate !== undefined ? input.payRate : (before?.payRate ?? "0.00");
      // Nobody sets their own pay (separation of duties, blueprint "Security"; blueprint-delta 2026-11-14).
      if (
        before &&
        dec(payRate).cmp(before.payRate) !== 0 &&
        before.id === (await viewerEmployeeId(tx, actor.access.userId))
      ) {
        throw refuse("Someone else must change your own pay rate.");
      }
      await this.checkManager(tx, employeeId, input.managerId);
      if (input.homeLocationId) await this.checkLocation(tx, input.homeLocationId);
      const flsaStatus = input.workerType === "1099" ? "not_applicable" : input.flsaStatus;
      const values = {
        name,
        title: input.title.trim(),
        department: input.department.trim(),
        workerType: input.workerType,
        payType: input.payType,
        payRate,
        state: input.state,
        email: input.email.trim(),
        phone: input.phone.trim(),
        hiredAt: input.hiredAt,
        status: input.status,
        managerId: input.managerId,
        flsaStatus,
        exemptionBasis: flsaStatus === "exempt" ? input.exemptionBasis : null,
        salaryHoursPerWeek: input.state === "CA" ? 40 : input.salaryHoursPerWeek,
        commissionVisible: input.commissionVisible,
        homeLocationId: input.homeLocationId,
        emergencyContact: input.emergencyContact,
      };
      let row: EmployeeRow;
      if (before) {
        [row] = (await tx
          .update(employees)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(employees.id, before.id))
          .returning()) as [EmployeeRow];
      } else {
        [row] = (await tx
          .insert(employees)
          .values({ id: employeeId, ...values, createdBy: actor.access.userId })
          .returning()) as [EmployeeRow];
        await this.addChecklist(tx, row.id, "onboarding", ONBOARDING_STEPS, actor.access.userId);
      }
      const link = input.userId === undefined ? {} : { userId: await this.link(tx, actor, row.id, input.userId) };
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: before ? "Edited employee" : "Added employee",
        targetType: "employee",
        targetId: row.id,
        targetLabel: row.name,
        before: before ? editable(before) : null,
        // The rate itself never goes into the log, only whether it changed (CLAUDE.md rule 5).
        after: {
          ...editable(row),
          ...link,
          ...(seesPay && before ? { payRateChanged: before.payRate !== row.payRate } : {}),
        },
      });
    });
    return this.one(db, tenant, employeeId);
  }

  /** Ticks or unticks one checklist step (hr.md "People"). */
  async setChecklistItem(
    tenant: TenantContext,
    actor: Actor,
    employeeId: string,
    input: { list: "onboarding" | "offboarding"; itemId: string; done: boolean },
  ): Promise<Employee> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const employee = await lockEmployee(tx, employeeId);
      const [item] = await tx
        .select()
        .from(employeeChecklistItems)
        .where(
          and(
            eq(employeeChecklistItems.id, input.itemId),
            eq(employeeChecklistItems.employeeId, employee.id),
            eq(employeeChecklistItems.list, input.list),
            isNull(employeeChecklistItems.deletedAt),
          ),
        );
      if (!item) throw notFound("checklist step");
      await tx
        .update(employeeChecklistItems)
        .set({ doneAt: input.done ? new Date() : null, updatedAt: new Date() })
        .where(eq(employeeChecklistItems.id, item.id));
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: input.done ? "Completed checklist step" : "Reopened checklist step",
        targetType: "employee",
        targetId: employee.id,
        targetLabel: employee.name,
        before: { list: input.list, step: item.label, done: item.doneAt !== null },
        after: { list: input.list, step: item.label, done: input.done },
      });
    });
    return this.one(db, tenant, employeeId);
  }

  /**
   * Starts offboarding (hr.md "People"): the person is marked as having left and gets the
   * offboarding checklist. Nothing happens when a checklist already exists.
   */
  async startOffboarding(tenant: TenantContext, actor: Actor, employeeId: string): Promise<Employee> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const employee = await lockEmployee(tx, employeeId);
      const [existing] = await tx
        .select({ id: employeeChecklistItems.id })
        .from(employeeChecklistItems)
        .where(
          and(
            eq(employeeChecklistItems.employeeId, employee.id),
            eq(employeeChecklistItems.list, "offboarding"),
            isNull(employeeChecklistItems.deletedAt),
          ),
        )
        .limit(1);
      if (existing) return;
      await tx
        .update(employees)
        .set({ status: "terminated", updatedAt: new Date() })
        .where(eq(employees.id, employee.id));
      await this.addChecklist(tx, employee.id, "offboarding", OFFBOARDING_STEPS, actor.access.userId);
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Started offboarding",
        targetType: "employee",
        targetId: employee.id,
        targetLabel: employee.name,
        before: { status: employee.status },
        after: { status: "terminated" },
      });
    });
    return this.one(db, tenant, employeeId);
  }

  /**
   * Adds documents to a person's file (hr.md "Employee" `documents`). They follow the proof-file
   * rules (real type by first bytes, 5 MB, at most three per upload); a person's file has no total
   * cap, because it grows over a career (blueprint-delta 2026-11-14).
   */
  async addDocuments(
    tenant: TenantContext,
    actor: Actor,
    employeeId: string,
    files: readonly ProofUpload[],
  ): Promise<Employee> {
    if (files.length === 0) throw refuse("Choose at least one file.");
    const db = await this.tenancy.db(tenant);
    const proofs = checkProofs(files);
    await withStoredProofs(this.storage, tenant.companyId, proofs, (attach) =>
      db.transaction(async (tx) => {
        const employee = await lockEmployee(tx, employeeId);
        await attach(tx, "employee", employee.id, actor.access.userId);
        await auditHr(this.auditLog, tenant, actor, tx, {
          action: "Added employee documents",
          targetType: "employee",
          targetId: employee.id,
          targetLabel: employee.name,
          before: null,
          after: { files: proofs.map((file) => file.name) },
        });
      }),
    );
    return this.one(db, tenant, employeeId);
  }

  /** A manager must be another live employee, and the chain may not loop back to this person. */
  private async checkManager(tx: CompanyDb, employeeId: string, managerId: string | null): Promise<void> {
    if (!managerId) return;
    if (managerId === employeeId) throw refuse("Someone can't be their own manager.");
    const rows = await tx
      .select({ id: employees.id, managerId: employees.managerId })
      .from(employees)
      .where(isNull(employees.deletedAt));
    const managers = new Map(rows.map((row) => [row.id, row.managerId]));
    if (!managers.has(managerId)) throw refuse("Choose the manager from the list.");
    const seen = new Set<string>();
    for (let at: string | null = managerId; at; at = managers.get(at) ?? null) {
      if (at === employeeId) throw refuse("This manager reports to this person, so the chain would loop.");
      if (seen.has(at)) break;
      seen.add(at);
    }
  }

  private async checkLocation(tx: CompanyDb, locationId: string): Promise<void> {
    const [row] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.id, locationId), isNull(locations.deletedAt)));
    if (!row) throw refuse("Choose the home location from the list.");
  }

  /**
   * Links a member's sign-in to this person, or unlinks it (null). The member must belong to this
   * company and not be linked to someone else. Nobody changes the link of their own sign-in, since
   * the link decides whose records are "own" and whose approvals are refused (hr.md rules).
   */
  private async link(tx: CompanyDb, actor: Actor, employeeId: string, userId: string | null): Promise<string | null> {
    const current = await tx
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(and(eq(userProfiles.employeeId, employeeId), isNull(userProfiles.deletedAt)));
    if (userId === actor.access.userId || current.some((row) => row.userId === actor.access.userId)) {
      throw refuse("Someone else must link or unlink your own sign-in.");
    }
    if (userId) {
      const [profile] = await tx
        .select({ id: userProfiles.id, employeeId: userProfiles.employeeId })
        .from(userProfiles)
        .where(and(eq(userProfiles.userId, userId), isNull(userProfiles.deletedAt)))
        .for("update");
      if (!profile) throw refuse("Choose a member of this company.");
      if (profile.employeeId && profile.employeeId !== employeeId) {
        throw refuse("This sign-in is already linked to another person.");
      }
    }
    await tx
      .update(userProfiles)
      .set({ employeeId: null, updatedAt: new Date() })
      .where(
        and(
          eq(userProfiles.employeeId, employeeId),
          userId ? ne(userProfiles.userId, userId) : undefined,
          isNull(userProfiles.deletedAt),
        ),
      );
    if (userId) {
      await tx
        .update(userProfiles)
        .set({ employeeId, updatedAt: new Date() })
        .where(and(eq(userProfiles.userId, userId), isNull(userProfiles.deletedAt)));
    }
    return userId;
  }

  private async addChecklist(
    tx: CompanyDb,
    employeeId: string,
    list: "onboarding" | "offboarding",
    labels: readonly string[],
    by: string,
  ): Promise<void> {
    await tx
      .insert(employeeChecklistItems)
      .values(labels.map((label, i) => ({ employeeId, list, position: i + 1, label, createdBy: by })));
  }

  private async one(db: CompanyDb, tenant: TenantContext, id: string): Promise<Employee> {
    const [employee] = await loadEmployees(db, this.control.db, tenant.companyId, [id]);
    if (!employee) throw notFound("employee");
    return employee;
  }
}

/** The fields a person edits, for audit entries: never the pay rate (CLAUDE.md rule 5). */
function editable(row: EmployeeRow) {
  const {
    name,
    title,
    department,
    workerType,
    payType,
    state,
    email,
    phone,
    hiredAt,
    status,
    managerId,
    flsaStatus,
    exemptionBasis,
    salaryHoursPerWeek,
    commissionVisible,
    homeLocationId,
  } = row;
  return {
    name,
    title,
    department,
    workerType,
    payType,
    state,
    email,
    phone,
    hiredAt,
    status,
    managerId,
    flsaStatus,
    exemptionBasis,
    salaryHoursPerWeek,
    commissionVisible,
    homeLocationId,
  };
}
