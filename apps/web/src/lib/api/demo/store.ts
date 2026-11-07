import { format } from "date-fns";
import {
  canAssignRole,
  balance,
  billFromPurchaseOrder,
  cutRoll,
  moneyString,
  poTotal,
  receivePurchaseOrder,
  invoiceFromQuote,
  nextNumber,
  dateShift,
  escalations,
  shiftDates,
  validateCut,
  type AuditEntry,
  type Company,
  type CompanyId,
  type CompanySettings,
  type PlatformFixtures,
  type PoLine,
  type Quote,
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

  async resetSettings(section: keyof CompanySettings) {
    return this.updateSettings(section, this.open().defaultSettings[section]);
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

  async cutRoll(rollId: string, lengthFt: string, reference: string) {
    const db = this.open();
    const roll = db.get("rolls", rollId);
    if (!roll) throw new DemoRuleError("This roll no longer exists.");
    const problem = validateCut(roll, lengthFt);
    if (problem) throw new DemoRuleError(problem);
    const result = cutRoll(
      roll,
      { lengthFt, at: nowStamp(), reference, byUserId: this.viewer!.userId },
      { cutId: newId(db.companyId, "cut"), remnantId: newId(db.companyId, "roll") },
    );
    db.put("rolls", result.roll);
    if (result.remnant) db.put("rolls", result.remnant);
    const after = result.remnant
      ? `0 ft, remnant ${result.remnant.rollNumber} of ${result.remnant.remainingLengthFt} ft`
      : `${result.roll.remainingLengthFt} ft`;
    this.appendAudit(db, {
      category: "data",
      action: `Cut ${lengthFt} ft`,
      target: `Roll ${roll.rollNumber}`,
      before: `${roll.remainingLengthFt} ft`,
      after,
    });
    this.emit();
    return result;
  }

  async saveQuote(quote: Quote) {
    const db = this.open();
    const isNew = !quote.number;
    const prefix = db.settings.localization.documents.quotePrefix;
    const saved = isNew
      ? {
          ...quote,
          id: quote.id || newId(db.companyId, "quo"),
          number: nextNumber(
            prefix,
            db.list("quotes").map((q) => q.number),
            2001,
          ),
        }
      : quote;
    db.put("quotes", saved);
    this.appendAudit(db, {
      category: "data",
      action: isNew ? "Created quote" : "Saved quote",
      target: saved.number,
      before: null,
      after: `total ${saved.total}`,
    });
    this.emit();
    return saved;
  }

  async convertQuoteToInvoice(quoteId: string) {
    const db = this.open();
    const quote = db.get("quotes", quoteId);
    if (!quote) throw new DemoRuleError("This quote no longer exists.");
    if (quote.invoiceId) throw new DemoRuleError(`This quote is already invoiced.`);
    if (quote.lines.length === 0) throw new DemoRuleError("Add at least one line before converting to an invoice.");
    const customer = db.get("customers", quote.customerId)!;
    const prefix = db.settings.localization.documents.invoicePrefix;
    const invoice = invoiceFromQuote(quote, customer, db.settings.localization.tax, {
      id: newId(db.companyId, "inv"),
      number: nextNumber(
        prefix,
        db.list("invoices").map((i) => i.number),
        1001,
      ),
      issuedAt: this.todayIso,
    });
    db.put("invoices", invoice);
    db.put("quotes", { ...quote, status: "invoiced", invoiceId: invoice.id, total: invoice.total });
    this.appendAudit(db, {
      category: "data",
      action: "Converted quote to invoice",
      target: quote.number,
      before: quote.status,
      after: invoice.number,
    });
    this.emit();
    return invoice;
  }

  async createPurchaseOrder(input: { supplierId: string; expectedAt: string; lines: PoLine[] }) {
    const db = this.open();
    if (input.lines.length === 0) throw new DemoRuleError("Add at least one line to the purchase order.");
    const prefix = db.settings.localization.documents.poPrefix;
    const po = {
      id: newId(db.companyId, "po"),
      number: nextNumber(
        prefix,
        db.list("purchaseOrders").map((p) => p.number),
        3001,
      ),
      supplierId: input.supplierId,
      status: "sent" as const,
      createdAt: this.todayIso,
      expectedAt: input.expectedAt,
      receivedAt: null,
      lines: input.lines,
      total: poTotal(input.lines),
    };
    db.put("purchaseOrders", po);
    this.appendAudit(db, {
      category: "data",
      action: "Created purchase order",
      target: po.number,
      before: null,
      after: `total ${po.total}`,
    });
    this.emit();
    return po;
  }

  async receivePurchaseOrder(poId: string) {
    const db = this.open();
    const po = db.get("purchaseOrders", poId)!;
    const result = receivePurchaseOrder(po, db.list("products"), {
      at: nowStamp(),
      newRollId: () => newId(db.companyId, "roll"),
      rollNumber: (p) => `${p.sku.slice(0, 2)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    });
    db.put("purchaseOrders", result.po);
    for (const p of result.products) db.put("products", p);
    for (const r of result.rolls) db.put("rolls", r);
    this.appendAudit(db, {
      category: "data",
      action: "Received purchase order",
      target: po.number,
      before: po.status,
      after: `received, ${result.rolls.length} rolls`,
    });
    this.emit();
    return result.po;
  }

  async billPurchaseOrder(poId: string, billNumber: string) {
    const db = this.open();
    const po = db.get("purchaseOrders", poId)!;
    const supplier = db.get("suppliers", po.supplierId)!;
    const bill = billFromPurchaseOrder(po, supplier, {
      id: newId(db.companyId, "bill"),
      number: billNumber,
      issuedAt: this.todayIso,
    });
    db.put("bills", bill);
    db.put("purchaseOrders", { ...po, status: "billed" });
    this.appendAudit(db, {
      category: "data",
      action: "Entered bill",
      target: `${bill.number} for ${po.number}`,
      before: null,
      after: `total ${bill.total}`,
    });
    this.emit();
    return bill;
  }

  async payBill(billId: string) {
    const db = this.open();
    const bill = db.get("bills", billId)!;
    const open = balance(bill);
    if (open.lte(0)) throw new DemoRuleError(`Bill ${bill.number} is already paid.`);
    const amount = moneyString(open);
    db.put("billPayments", {
      id: newId(db.companyId, "bpay"),
      billId,
      supplierId: bill.supplierId,
      at: this.todayIso,
      amount,
    });
    const paid = { ...bill, paid: bill.total };
    db.put("bills", paid);
    this.appendAudit(db, {
      category: "data",
      action: "Paid bill",
      target: bill.number,
      before: `${amount} open`,
      after: "paid",
    });
    this.emit();
    return paid;
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
