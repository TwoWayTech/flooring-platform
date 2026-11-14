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
import { auditHr, lockEmployee, requireLinkedDecider } from "./hr-common";
import { loadEmployees, personScope, selfCheck, workFactsOnly, type EmployeeRow } from "./hr-records";

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
 * interceptor; it, the pay type and the salaried hours are kept as stored when someone without the
 * key saves (CLAUDE.md rule 5). Nobody changes their own pay facts.
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
    const seesContact = actor.access.permissions.has("hr.employee.view");
    await db.transaction(async (tx) => {
      const before = id ? await lockEmployee(tx, id) : null;
      const own = before !== null && (await selfCheck(tx, actor))(before.id);
      // Without hr.employee.view the saver never saw the contact fields, so the stored ones stay
      // (like the pay fields; second security review of PR #25). The birthday is not on the form.
      const contact: ContactFields =
        before && !seesContact
          ? { email: before.email, phone: before.phone, emergencyContact: before.emergencyContact }
          : { email: input.email.trim(), phone: input.phone.trim(), emergencyContact: input.emergencyContact };
      // Without the key the stored rate, pay type and salaried hours stay, and a new person starts
      // at a zero rate (hr.md "Who uses it"; CLAUDE.md rule 5; security review of PR #25).
      const keep = !seesPay && before !== null;
      const pay: PayFacts = {
        payRate: seesPay && input.payRate !== undefined ? input.payRate : (before?.payRate ?? "0.00"),
        payType: keep ? before.payType : input.payType,
        workerType: input.workerType,
        flsaStatus: input.workerType === "1099" ? "not_applicable" : input.flsaStatus,
        // A California salary covers 40 hours (Labor Code 515), whoever saves.
        salaryHoursPerWeek: input.state === "CA" ? 40 : keep ? before.salaryHoursPerWeek : input.salaryHoursPerWeek,
      };
      const values: EmployeeValues = {
        name,
        title: input.title.trim(),
        department: input.department.trim(),
        ...pay,
        state: input.state,
        ...contact,
        hiredAt: input.hiredAt,
        status: input.status,
        managerId: input.managerId,
        exemptionBasis: pay.flsaStatus === "exempt" ? input.exemptionBasis : null,
        commissionVisible: input.commissionVisible,
        homeLocationId: input.homeLocationId,
      };
      checkSelfEdit(actor, before, own, values);
      // A sign-in linked to no employee can't be checked for self-dealing by the link, so only an
      // Owner changes pay facts from one (third security review of PR #25; ADR 0046).
      if (before && payFactsChanged(before, pay)) await requireLinkedDecider(tx, actor.access);
      await this.checkManager(tx, employeeId, input.managerId);
      if (input.homeLocationId) await this.checkLocation(tx, input.homeLocationId);
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
    return this.one(db, tenant, actor, employeeId);
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
      if ((await selfCheck(tx, actor))(employee.id)) throw refuse("Someone else must tick your own checklist.");
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
    return this.one(db, tenant, actor, employeeId);
  }

  /**
   * Starts offboarding (hr.md "People"): the person is marked as having left and gets the
   * offboarding checklist. Nothing happens when a checklist already exists.
   */
  async startOffboarding(tenant: TenantContext, actor: Actor, employeeId: string): Promise<Employee> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const employee = await lockEmployee(tx, employeeId);
      if ((await selfCheck(tx, actor))(employee.id)) throw refuse("Someone else must start your own offboarding.");
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
    return this.one(db, tenant, actor, employeeId);
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
        // Nobody adds to their own personnel file (third security review of PR #25).
        if ((await selfCheck(tx, actor))(employee.id))
          throw refuse("Someone else must add documents to your own file.");
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
    return this.one(db, tenant, actor, employeeId);
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

  /** The saved person as the answer: work facts only for a writer without hr.employee.view, as `list` shows them. */
  private async one(db: CompanyDb, tenant: TenantContext, actor: Actor, id: string): Promise<Employee> {
    const [employee] = await loadEmployees(db, this.control.db, tenant.companyId, [id]);
    if (!employee) throw notFound("employee");
    return actor.access.permissions.has("hr.employee.view") ? employee : workFactsOnly(employee);
  }
}

/** A person's contact fields as a save stores them. */
type ContactFields = Pick<EmployeeRow, "email" | "phone" | "emergencyContact">;

/** An email compared the way `selfCheck` matches it: trimmed and case-insensitive. */
const emailKey = (email: string) => email.trim().toLowerCase();

/** The stored fields a save writes, normalised (trimmed, effective pay facts). */
type EmployeeValues = Omit<
  EmployeeRow,
  "id" | "createdAt" | "updatedAt" | "createdBy" | "deletedAt" | "externalId" | "birthDate"
>;

/**
 * What a person may change on their own record: only the phone and the emergency contact
 * (employee-portal.md rule 9, `MyProfilePatch`). Everything else, the name and title included,
 * is someone else's to change (third security review of PR #25).
 */
const OWN_EDITABLE: ReadonlySet<keyof EmployeeValues> = new Set(["phone", "emergencyContact"]);

/** Whether a field differs from the stored value, compared so an unchanged re-save is no change. */
function fieldChanged(key: keyof EmployeeValues, before: EmployeeRow, after: EmployeeValues): boolean {
  if (key === "payRate") return dec(after.payRate).cmp(before.payRate) !== 0;
  if (key === "email") return emailKey(after.email) !== emailKey(before.email);
  const was = before[key];
  const now = after[key];
  if (typeof was === "string" && typeof now === "string") return was.trim() !== now.trim();
  return JSON.stringify(was ?? null) !== JSON.stringify(now ?? null);
}

/**
 * Refuses the edits that would let someone act on their own record (separation of duties,
 * blueprint "Security"; second and third security reviews of PR #25):
 * - On their own record (`own`, by sign-in link or verified email) only the fields in
 *   `OWN_EDITABLE` may differ from the stored ones: an allowlist, so the pay facts, email, status,
 *   work state, hire date, manager and any field added later are someone else's.
 * - Nobody puts their own verified email on a record that is not already theirs, so no second
 *   "self" record is made.
 * - Only a company-wide data scope changes a manager, because a manager decides `branch` scope
 *   (hr.md "Data scope", `ownOrReports`).
 */
function checkSelfEdit(actor: Actor, before: EmployeeRow | null, own: boolean, values: EmployeeValues): void {
  const sessionEmail = emailKey(actor.session.user.email);
  if (before && own) {
    const keys = Object.keys(values) as (keyof EmployeeValues)[];
    if (keys.some((key) => !OWN_EDITABLE.has(key) && fieldChanged(key, before, values))) {
      throw refuse("On your own record you can change only your phone and emergency contact. Ask HR for the rest.");
    }
  } else if (sessionEmail && emailKey(values.email) === sessionEmail) {
    throw refuse("Your own sign-in email can only be on your own record.");
  }
  const managerChanged = before ? values.managerId !== before.managerId : values.managerId !== null;
  if (managerChanged && actor.access.dataScope !== "all") {
    throw refuse("Only someone who sees everyone's records can change a manager.");
  }
}

/** What decides a person's pay: their rate, pay type, worker type, overtime status and salaried hours. */
type PayFacts = Pick<EmployeeRow, "payRate" | "payType" | "workerType" | "flsaStatus" | "salaryHoursPerWeek">;

/**
 * Whether a save changes any pay fact: refused on one's own record (`checkSelfEdit`) and, from a
 * sign-in linked to no employee, to everyone but an Owner (`requireLinkedDecider`).
 */
function payFactsChanged(before: EmployeeRow, after: PayFacts): boolean {
  return (
    dec(after.payRate).cmp(before.payRate) !== 0 ||
    after.payType !== before.payType ||
    after.workerType !== before.workerType ||
    after.flsaStatus !== before.flsaStatus ||
    after.salaryHoursPerWeek !== before.salaryHoursPerWeek
  );
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
