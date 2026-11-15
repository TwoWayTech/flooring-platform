import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  commissionAssignments,
  commissionPlans,
  commissionStatements,
  employeeChecklistItems,
  employeeManagerHistory,
  employees,
  locations,
  userProfiles,
} from "@workspace/db/company";
import type { StorageProvider } from "@workspace/providers";
import {
  californiaSalaryHours,
  dec,
  featureOn,
  isStateCode,
  OFFBOARDING_STEPS,
  ONBOARDING_STEPS,
  SENSITIVE,
  type Employee,
} from "@workspace/shared";
import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { STORAGE } from "../../core/storage/storage.module";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { checkProofs, withStoredProofs, type ProofUpload } from "../sales/proof-files";
import { companyClock, dayIn, notFound, refuse } from "../sales/sales-common";
import { auditHr, databaseNow, lockEmployee, PAYROLL_LOCK, requireLinkedDecider } from "./hr-common";
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
   * exempt or non-exempt; only an exempt person has an exemption basis; with the California pay
   * rules on, a California salary covers 40 hours (Labor Code 515; ADR 0050). A new person gets the
   * onboarding checklist. Setting or moving a manager adds to the dated manager history on the
   * company's day (`recordManager`), so overrides follow the manager on each sale's day.
   */
  async save(tenant: TenantContext, actor: Actor, id: string | null, input: EmployeeFields): Promise<Employee> {
    const name = input.name.trim();
    if (!name) throw refuse("Enter the person's name.");
    if (!isStateCode(input.state)) throw refuse("Choose the work state, such as CO.");
    if (input.workerType === "w2" && input.flsaStatus === "not_applicable") {
      throw refuse("Choose whether this W-2 worker is exempt or non-exempt.");
    }
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const employeeId = id ?? uuidv7();
    const seesPay = actor.access.permissions.has(SENSITIVE.payRate);
    const seesContact = actor.access.permissions.has("hr.employee.view");
    await linkedOnce(
      db.transaction(async (tx) => {
        // The payroll lock first, as every pay and commission approval takes it: a manager or sign-in
        // link changed here can't race a statement or pay-run approval reading them (third security
        // review of PR #27). Lock order PAYROLL_LOCK → employee → user_profiles.
        await tx.execute(PAYROLL_LOCK);
        const before = id ? await lockEmployee(tx, id) : null;
        const linkedBefore = before ? await linkedUsers(tx, before.id) : [];
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
          // A California salary covers 40 hours (Labor Code 515), whoever saves, while the California
          // pay rules are switched on (ADR 0050).
          salaryHoursPerWeek:
            californiaSalaryHours(input.state) ?? (keep ? before.salaryHoursPerWeek : input.salaryHoursPerWeek),
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
        // A sign-in linked to no employee is matched to its own record only by email, which may
        // differ, so it could change its own work state, hire date or status unseen: only an Owner
        // writes people from one (third and fourth security reviews of PR #25; ADR 0046).
        await requireLinkedDecider(tx, actor.access);
        await this.checkCommissionPeople(
          tx,
          actor,
          employeeId,
          linkedBefore,
          values.managerId,
          managerChanged(before, values),
          input.userId,
        );
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
        if (managerChanged(before, values)) {
          // The company's day by the database clock, read once the locks are held (ADR 0047).
          const today = dayIn(await databaseNow(tx), clock.zone);
          await recordManager(tx, row.id, before, values.managerId, today, actor.access.userId);
        }
        if (input.userId !== undefined) await this.link(tx, actor, row.id, input.userId);
        // The sign-in link before and after, on every entry: whose commission is paid to this person
        // follows it, so statement and pay-run approvals read link changes from here (third security
        // review of PR #27; ADR 0048).
        const linkedAfter = await linkedUsers(tx, row.id);
        await auditHr(this.auditLog, tenant, actor, tx, {
          action: before ? "Edited employee" : "Added employee",
          targetType: "employee",
          targetId: row.id,
          targetLabel: row.name,
          before: before ? { ...editable(before), userId: linkedBefore[0] ?? null } : null,
          // The rate itself never goes into the log, only whether it changed (CLAUDE.md rule 5).
          after: {
            ...editable(row),
            userId: linkedAfter[0] ?? null,
            ...(seesPay && before ? { payRateChanged: before.payRate !== row.payRate } : {}),
          },
        });
      }),
    );
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
      await requireLinkedDecider(tx, actor.access);
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
      await requireLinkedDecider(tx, actor.access);
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
        await requireLinkedDecider(tx, actor.access);
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

  /**
   * The commission rules on a person's manager and sign-in link (ADR 0048). A person's commission is
   * paid to the employee their sign-in is linked to, and their manager's user is paid an override on
   * their sales, so:
   * - only the Owner changes the manager of someone on a plan that pays their manager an override
   *   (second security review of PR #27); any assignment counts, past or future, the safest reading,
   *   kept when overrides moved to the manager on each line's day (owner decision 2026-11-15);
   * - only the Owner changes the sign-in link (link, unlink, or link another record to them) of
   *   someone with any commission assignment or approved or paid statement, or of a record that
   *   manages someone on an override plan, since a re-link moves override lines, those of approved
   *   and paid months included, to another user (`hasCommissionHistory`; third security review of
   *   PR #27, first review of PR #32);
   * - nobody, the Owner included, makes their own employee the manager of someone on an override
   *   plan: the override would pay the one who set it, and nobody could then approve it.
   */
  private async checkCommissionPeople(
    tx: CompanyDb,
    actor: Actor,
    employeeId: string,
    linked: readonly string[],
    managerId: string | null,
    managerMoved: boolean,
    linkTo: string | null | undefined,
  ): Promise<void> {
    const linkMoved =
      linkTo !== undefined && (linkTo ? linked.length !== 1 || linked[0] !== linkTo : linked.length > 0);
    if (!managerMoved && !linkMoved) return;
    const people = [...new Set([...linked, ...(linkTo ? [linkTo] : [])])];
    if (people.length === 0) return;
    const onOverride = managerMoved && (await hasOverridePlan(tx, people));
    if (!actor.access.isOwner) {
      if (onOverride) {
        throw refuse("This person earns their manager an override, so only the Owner can change their manager.");
      }
      if (linkMoved && (await hasCommissionHistory(tx, people, employeeId))) {
        throw refuse(
          "This person has commission plans, statements or overrides, so only the Owner can change their sign-in link.",
        );
      }
    }
    if (onOverride && managerId && (await selfCheck(tx, actor))(managerId)) {
      throw refuse("Nobody makes themselves the manager of someone whose sales pay them an override.");
    }
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
   * the link decides whose records are "own" and whose approvals are refused (hr.md rules). Like a
   * manager, the link decides data scope, so only a company-wide scope or the Owner changes it
   * (fourth security review of PR #25).
   */
  private async link(tx: CompanyDb, actor: Actor, employeeId: string, userId: string | null): Promise<string | null> {
    const current = await tx
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(and(eq(userProfiles.employeeId, employeeId), isNull(userProfiles.deletedAt)));
    if (userId === actor.access.userId || current.some((row) => row.userId === actor.access.userId)) {
      throw refuse("Someone else must link or unlink your own sign-in.");
    }
    const unchanged = userId ? current.length === 1 && current[0]!.userId === userId : current.length === 0;
    if (!unchanged && !actor.access.isOwner && actor.access.dataScope !== "all") {
      throw refuse("Only someone who sees everyone's records can change a sign-in link.");
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
  if (managerChanged(before, values) && actor.access.dataScope !== "all") {
    throw refuse("Only someone who sees everyone's records can change a manager.");
  }
}

/** Whether a save sets or moves the person's manager: a new person with one, or a different one. */
function managerChanged(before: EmployeeRow | null, values: EmployeeValues): boolean {
  return before ? values.managerId !== before.managerId : values.managerId !== null;
}

/**
 * Appends a manager change to the person's dated history (owner decision 2026-11-15; ADR 0048):
 * commission overrides go to the manager on each line's day (`managerOn` in packages/shared), so
 * the history must say who managed whom when. Called in the save's transaction, under its locks
 * (`PAYROLL_LOCK` → employee), so an approval never reads half a change.
 * - A new person's first row applies since records began, as nothing about them is earlier.
 * - A person with no row yet (added outside the app) first gets a since-records-began row with the
 *   manager they had, so the days before this change keep that manager.
 * - The change applies from `today`, the company's day. Several changes on one day each add a row;
 *   the one recorded last wins (UUID v7 ids sort in recorded order).
 */
async function recordManager(
  tx: CompanyDb,
  employeeId: string,
  before: EmployeeRow | null,
  managerId: string | null,
  today: string,
  by: string,
): Promise<void> {
  if (!before) {
    await tx.insert(employeeManagerHistory).values({ employeeId, managerId, effectiveFrom: null, createdBy: by });
    return;
  }
  const [recorded] = await tx
    .select({ id: employeeManagerHistory.id })
    .from(employeeManagerHistory)
    .where(eq(employeeManagerHistory.employeeId, employeeId))
    .limit(1);
  const rows = [
    ...(recorded ? [] : [{ employeeId, managerId: before.managerId, effectiveFrom: null, createdBy: by }]),
    { employeeId, managerId, effectiveFrom: today, createdBy: by },
  ];
  await tx.insert(employeeManagerHistory).values(rows);
}

/** What decides a person's pay: their rate, pay type, worker type, overtime status and salaried hours. */
type PayFacts = Pick<EmployeeRow, "payRate" | "payType" | "workerType" | "flsaStatus" | "salaryHoursPerWeek">;

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

/** The members whose sign-in is linked to this employee (user_profiles.employee_id), in a stable order. */
async function linkedUsers(tx: CompanyDb, employeeId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(and(eq(userProfiles.employeeId, employeeId), isNull(userProfiles.deletedAt)))
    .orderBy(asc(userProfiles.userId));
  return rows.map((row) => row.userId);
}

/** Whether any of these people has an assignment, past or future, to a plan that pays an override. */
async function hasOverridePlan(tx: CompanyDb, userIds: readonly string[]): Promise<boolean> {
  const [row] = await tx
    .select({ id: commissionAssignments.id })
    .from(commissionAssignments)
    .innerJoin(commissionPlans, eq(commissionPlans.id, commissionAssignments.planId))
    .where(
      and(
        inArray(commissionAssignments.userId, [...userIds]),
        isNull(commissionAssignments.deletedAt),
        isNull(commissionPlans.deletedAt),
        gt(commissionPlans.overridePct, "0"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Whether a re-link of this employee's sign-in would move commission between people (ADR 0048
 * "Sign-in re-link"): one of these people has an assignment to any plan, past or future, or any
 * approved or paid statement, or the employee manages someone on an override plan. Override lines
 * are worked out again on every read, through today's links, so a re-link moves them out of
 * approved and paid months too, where they could be paid a second time (first review of PR #32);
 * an approved statement already in a run still counts, as a reopen hands it back (fourth review of
 * PR #27).
 */
async function hasCommissionHistory(tx: CompanyDb, userIds: readonly string[], employeeId: string): Promise<boolean> {
  const [assigned] = await tx
    .select({ id: commissionAssignments.id })
    .from(commissionAssignments)
    .where(and(inArray(commissionAssignments.userId, [...userIds]), isNull(commissionAssignments.deletedAt)))
    .limit(1);
  if (assigned) return true;
  const [stored] = await tx
    .select({ id: commissionStatements.id })
    .from(commissionStatements)
    .where(
      and(
        inArray(commissionStatements.userId, [...userIds]),
        inArray(commissionStatements.status, ["approved", "paid"]),
        isNull(commissionStatements.deletedAt),
      ),
    )
    .limit(1);
  return stored !== undefined || (await managesOverridePeople(tx, employeeId));
}

/**
 * Whether this employee manages, or has managed by the dated history, anyone whose linked sign-in
 * has an assignment to a plan that pays an override (ADR 0048): the employee's own user is paid
 * those overrides, so its sign-in link decides who collects them.
 */
async function managesOverridePeople(tx: CompanyDb, employeeId: string): Promise<boolean> {
  const [today, past] = await Promise.all([
    tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.managerId, employeeId), isNull(employees.deletedAt))),
    tx
      .select({ id: employeeManagerHistory.employeeId })
      .from(employeeManagerHistory)
      .where(eq(employeeManagerHistory.managerId, employeeId)),
  ]);
  const reports = [...new Set([...today, ...past].map((row) => row.id))];
  if (reports.length === 0) return false;
  const users = await tx
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(and(inArray(userProfiles.employeeId, reports), isNull(userProfiles.deletedAt)));
  return users.length > 0 && hasOverridePlan(tx, [...new Set(users.map((row) => row.userId))]);
}

/** The partial unique index that allows one live sign-in per employee (migration 0004; ADR 0049). */
const ONE_SIGN_IN_PER_EMPLOYEE = "user_profiles_employee_uidx";

/**
 * Runs a save that may link a sign-in, turning a second live link to the same employee into a 409.
 * `link` already unlinks the others under the employee's lock, so this only answers a race that
 * gets past it, or data written outside the app, with a clear refusal instead of a 500.
 */
export async function linkedOnce<T>(save: Promise<T>): Promise<T> {
  try {
    return await save;
  } catch (error) {
    if (violates(error, ONE_SIGN_IN_PER_EMPLOYEE)) {
      throw new ConflictException({
        code: "employee_already_linked",
        message: "Another sign-in is already linked to this person. Reload and try again.",
      });
    }
    throw error;
  }
}

/** Whether a database error, or the error it wraps, is a unique violation (23505) of this index. */
function violates(error: unknown, constraint: string): boolean {
  for (let at: unknown = error; typeof at === "object" && at !== null;) {
    const fields = at as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (fields.code === "23505" && fields.constraint_name === constraint) return true;
    at = fields.cause;
  }
  return false;
}
