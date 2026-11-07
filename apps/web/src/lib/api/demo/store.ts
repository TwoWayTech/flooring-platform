import { format } from "date-fns";
import {
  canAssignRole,
  dateShift,
  escalations,
  shiftDates,
  type AuditEntry,
  type Company,
  type CompanyId,
  type CompanySettings,
  type PlatformFixtures,
  type Role,
  type User,
} from "@workspace/shared";
import { viewerAccess } from "../../access";
import type {
  ApiClient,
  AuditInput,
  CollectionName,
  CompanyAccessPatch,
  InviteUserInput,
  ItemOf,
  UserPatch,
  Viewer,
} from "../contract";
import { assertOwnerRemains, assertSeatAvailable, DemoRuleError, diffSummary, permissionDiff } from "./admin-rules";
import { CompanyDb } from "./company-db";
import { loadCompanyFixtures, loadPlatformFixtures } from "./fixtures";
import { applyScope, scopeSubject } from "./scope";
import { clearStored, readStored, writeStored } from "./storage";

const PLATFORM_KEY = "platform";
const SETTINGS_LABELS: Record<keyof CompanySettings, string> = {
  branding: "Branding",
  localization: "Localization and tax",
  numbers: "Number format",
  profile: "Company profile",
};

const nowStamp = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");
const newId = (companyId: string, kind: string) => `${companyId}-${kind}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * The demo implementation of ApiClient (spec section 1): generated fixtures plus a per-company
 * localStorage overlay. It enforces the same rules a real API would (seat limit, last Owner,
 * no privilege escalation, data scope) so screens cannot bypass them.
 */
export class DemoStore implements ApiClient {
  private readonly listeners = new Set<() => void>();
  private readonly dbs = new Map<CompanyId, CompanyDb>();
  private platform: PlatformFixtures | null = null;
  private current: CompanyDb | null = null;
  private viewer: Viewer | null = null;
  private readonly todayIso = format(new Date(), "yyyy-MM-dd");

  async openCompany(companyId: CompanyId, viewer: Viewer) {
    this.current = await this.db(companyId);
    this.viewer = viewer;
    this.emit();
  }

  setViewer(viewer: Viewer) {
    this.viewer = viewer;
    this.emit();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  today() {
    return this.todayIso;
  }

  async resetDemo() {
    clearStored();
    this.dbs.clear();
    this.platform = null;
    if (this.current) this.current = await this.db(this.current.companyId);
    this.emit();
  }

  async listCompanies() {
    const platform = await this.platformData();
    const changed = readStored<Record<string, Company>>(PLATFORM_KEY) ?? {};
    return platform.companies.map((c) => changed[c.id] ?? c);
  }

  async updateCompanyAccess(companyId: CompanyId, patch: CompanyAccessPatch) {
    const before = (await this.listCompanies()).find((c) => c.id === companyId)!;
    const after: Company = { ...before, ...patch };
    const changed = readStored<Record<string, Company>>(PLATFORM_KEY) ?? {};
    writeStored(PLATFORM_KEY, { ...changed, [companyId]: after });
    const db = await this.db(companyId);
    const { before: was, after: now } = diffSummary(before, after);
    this.appendAudit(
      db,
      { category: "ceiling", action: "Changed company access", target: before.name, before: was, after: now },
      {
        actorName: "Platform admin",
        actorRole: "Super-admin",
      },
    );
    this.emit();
    return after;
  }

  async listCompanyDirectory(companyId: CompanyId) {
    const db = await this.db(companyId);
    return { roles: db.list("roles"), users: db.list("users"), branding: db.settings.branding };
  }

  async getCompany() {
    const db = this.open();
    return (await this.listCompanies()).find((c) => c.id === db.companyId)!;
  }

  async getSettings() {
    return this.open().settings;
  }

  async updateSettings<K extends keyof CompanySettings>(section: K, value: CompanySettings[K]) {
    const db = this.open();
    const before = db.settings[section];
    db.settings = { ...db.settings, [section]: value };
    const diff = diffSummary(before, value);
    this.appendAudit(db, {
      category: "settings",
      action: `Changed ${SETTINGS_LABELS[section].toLowerCase()}`,
      target: SETTINGS_LABELS[section],
      ...diff,
    });
    this.emit();
    return db.settings;
  }

  async list<K extends CollectionName>(collection: K) {
    const db = this.open();
    return applyScope(db, collection, db.list(collection), this.subject(db));
  }

  async get<K extends CollectionName>(collection: K, id: string) {
    const visible = (await this.list(collection)) as { id: string }[];
    return visible.find((item) => item.id === id) as ItemOf<K> | undefined;
  }

  async save<K extends CollectionName>(collection: K, item: ItemOf<K>, audit?: AuditInput) {
    const db = this.open();
    db.put(collection, item);
    if (audit) this.appendAudit(db, audit);
    this.emit();
    return item;
  }

  async inviteUser(input: InviteUserInput) {
    const db = this.open();
    const company = await this.getCompany();
    assertSeatAvailable(db.list("users"), company.userLimit);
    const user: User = {
      id: newId(db.companyId, "usr"),
      companyId: db.companyId,
      ...input,
      status: "invited",
      mfaEnrolled: false,
      lastLoginAt: null,
      employeeId: null,
    };
    db.put("users", user);
    this.appendAudit(db, {
      category: "user",
      action: "Invited user",
      target: user.name,
      before: null,
      after: `${user.email}, ${this.roleNames(db, user.roleIds)}`,
    });
    this.emit();
    return user;
  }

  async updateUser(userId: string, patch: UserPatch) {
    const db = this.open();
    const before = db.get("users", userId)!;
    assertOwnerRemains(db.list("users"), db.list("roles"), userId, patch);
    if (patch.roleIds)
      await this.assertCanAssign(
        db,
        patch.roleIds.filter((id) => !before.roleIds.includes(id)),
      );
    const after = { ...before, ...patch };
    db.put("users", after);
    const describe = (u: User) => `${u.status}, ${this.roleNames(db, u.roleIds)}, MFA ${u.mfaEnrolled ? "on" : "off"}`;
    this.appendAudit(db, {
      category: patch.mfaEnrolled === false ? "security" : "user",
      action: "Changed user",
      target: before.name,
      before: describe(before),
      after: describe(after),
    });
    this.emit();
    return after;
  }

  async saveRole(role: Role) {
    const db = this.open();
    const before = db.get("roles", role.id);
    if (before?.owner) throw new DemoRuleError("The Owner role is locked. It always holds everything in your plan.");
    await this.assertCanGrant(db, role.permissions, before?.permissions ?? []);
    db.put("roles", role);
    const diff = permissionDiff(before?.permissions ?? [], role.permissions);
    this.appendAudit(db, {
      category: "role",
      action: before ? "Changed role" : "Created role",
      target: `Role: ${role.name}`,
      ...diff,
    });
    this.emit();
    return role;
  }

  async deleteRole(roleId: string) {
    const db = this.open();
    const role = db.get("roles", roleId)!;
    if (role.system) throw new DemoRuleError("Default roles can be copied but not deleted.");
    if (db.list("users").some((u) => u.roleIds.includes(roleId))) {
      throw new DemoRuleError("Users still hold this role. Move them to another role first.");
    }
    db.remove("roles", roleId);
    this.appendAudit(db, {
      category: "role",
      action: "Deleted role",
      target: `Role: ${role.name}`,
      before: `${role.permissions.length} permissions`,
      after: null,
    });
    this.emit();
  }

  async recordAudit(entry: AuditInput) {
    this.appendAudit(this.open(), entry);
    this.emit();
  }

  private async platformData(): Promise<PlatformFixtures> {
    if (!this.platform) {
      const fixtures = await loadPlatformFixtures();
      this.platform = shiftDates(fixtures, dateShift(fixtures.anchorDate, this.todayIso));
    }
    return this.platform;
  }

  private async db(companyId: CompanyId): Promise<CompanyDb> {
    let db = this.dbs.get(companyId);
    if (!db) {
      db = new CompanyDb(await loadCompanyFixtures(companyId), this.todayIso);
      this.dbs.set(companyId, db);
    }
    return db;
  }

  private open(): CompanyDb {
    if (!this.current || !this.viewer) throw new Error("No company is open. Sign in first.");
    return this.current;
  }

  private subject(db: CompanyDb) {
    return scopeSubject(db, this.viewer!);
  }

  /** The signed-in viewer's effective access in the open company. */
  private async granter(db: CompanyDb) {
    const self = db.get("users", this.viewer!.userId)!;
    const company = await this.getCompany();
    return { access: viewerAccess(company, db.list("roles"), self, this.viewer!.viewAsRoleId), company };
  }

  /** No privilege escalation (blueprint rule 2): every newly granted permission must be held by the granter. */
  private async assertCanGrant(db: CompanyDb, proposed: Role["permissions"], current: Role["permissions"]) {
    const { access } = await this.granter(db);
    const blocked = escalations(access, proposed, current);
    if (blocked.length > 0) {
      throw new DemoRuleError(`You can only grant permissions you hold. Not held: ${blocked.slice(0, 3).join(", ")}.`);
    }
  }

  /** Roles may be assigned only when their active permissions are all held, and only Owners make Owners. */
  private async assertCanAssign(db: CompanyDb, roleIds: readonly string[]) {
    const { access, company } = await this.granter(db);
    for (const id of roleIds) {
      const denial = canAssignRole(access, db.get("roles", id)!, company.ceiling, company.modules);
      if (denial === "owner_only") throw new DemoRuleError("Only an Owner can make someone an Owner.");
      if (denial === "not_held")
        throw new DemoRuleError("You can only assign roles whose permissions you hold yourself.");
    }
  }

  private roleNames(db: CompanyDb, roleIds: readonly string[]) {
    return roleIds.map((id) => db.get("roles", id)?.name ?? id).join(" + ");
  }

  private appendAudit(db: CompanyDb, entry: AuditInput, actor?: Pick<AuditEntry, "actorName" | "actorRole">) {
    const self =
      this.viewer && db.companyId === this.current?.companyId ? db.get("users", this.viewer.userId) : undefined;
    const by = actor ?? {
      actorName: self?.name ?? "Platform admin",
      actorRole: self ? this.roleNames(db, self.roleIds) : "Super-admin",
    };
    db.put("audit", { id: newId(db.companyId, "aud"), at: nowStamp(), ...by, ...entry });
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
