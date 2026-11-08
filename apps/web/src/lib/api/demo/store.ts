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
  isDefaultRoleKey,
  permissionsForModules,
  PRODUCT_MODULES,
  roleTemplate,
  boxedStock,
  dec,
  locationName,
  receiveTransfer,
  startTransfer,
  validateTransfer,
  escalations,
  shiftDates,
  upgradeCompany,
  validateCut,
  type AuditEntry,
  type Company,
  type CompanyId,
  type CompanySettings,
  type PermissionKey,
  type PlatformFixtures,
  type PoLine,
  type Quote,
  type Role,
  type Location,
  type Transfer,
  type TransferInput,
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
  ProfilePatch,
  UserPatch,
  Viewer,
} from "../contract";
import { assertOwnerRemains, assertSeatAvailable, DemoRuleError, diffSummary, permissionDiff } from "./admin-rules";
import { CompanyDb } from "./company-db";
import { loadCompanyFixtures, loadPlatformFixtures } from "./fixtures";
import { applyScope, scopeSubject } from "./scope";
import { savePermissions, settingsPermissions } from "./permission-rules";
import { clearStored, readLegacy, readStored, removeLegacy, writeStored } from "./storage";

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
  private notices: string[] = [];

  async openCompany(companyId: CompanyId, viewer: Viewer) {
    this.current = await this.db(companyId);
    this.viewer = viewer;
    if (this.current.upgradeNotice && !this.notices.includes(this.current.upgradeNotice)) {
      this.notices.push(this.current.upgradeNotice);
    }
    this.emit();
  }

  takeNotices() {
    const pending = this.notices;
    this.notices = [];
    return pending;
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
    const changed = this.changedCompanies(platform.companies);
    return platform.companies.map((c) => changed[c.id] ?? c);
  }

  async updateCompanyAccess(companyId: CompanyId, patch: CompanyAccessPatch) {
    const before = (await this.listCompanies()).find((c) => c.id === companyId)!;
    const after: Company = { ...before, ...patch };
    writeStored(PLATFORM_KEY, { ...this.changedCompanies(), [companyId]: after });
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
    await this.assertCan(db, settingsPermissions(section));
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

  async getDefaultSettings() {
    return this.open().defaultSettings;
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
    await this.assertCan(db, savePermissions(collection));
    db.put(collection, item);
    if (audit) this.appendAudit(db, audit);
    this.emit();
    return item;
  }

  async inviteUser(input: InviteUserInput) {
    const db = this.open();
    await this.assertCan(db, ["settings.users.manage"]);
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
      defaultLocationId: null,
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
    await this.assertCan(db, ["settings.users.manage"]);
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
    await this.assertCan(db, ["settings.roles.manage"]);
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

  async resetRole(roleId: string) {
    const db = this.open();
    const role = db.get("roles", roleId);
    if (!role?.system || !isDefaultRoleKey(role.key)) throw new DemoRuleError("Only default roles can be reset.");
    const company = await this.getCompany();
    const offered = new Set(permissionsForModules(PRODUCT_MODULES[company.product]));
    const template = roleTemplate(role.key);
    return this.saveRole({
      ...role,
      name: template.name,
      description: template.description,
      dataScope: template.dataScope,
      permissions: template.permissions.filter((p) => offered.has(p)),
    });
  }

  async deleteRole(roleId: string) {
    const db = this.open();
    await this.assertCan(db, ["settings.roles.manage"]);
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
    await this.assertCan(db, ["inventory.roll.cut"]);
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
    await this.assertCan(db, [isNew ? "sales.quote.create" : "sales.quote.edit"]);
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
    await this.assertCan(db, ["sales.invoice.create"]);
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

  async createPurchaseOrder(input: { supplierId: string; expectedAt: string; locationId: string; lines: PoLine[] }) {
    const db = this.open();
    await this.assertCan(db, ["purchasing.order.create"]);
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
      locationId: input.locationId,
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
    await this.assertCan(db, ["purchasing.order.receive"]);
    const po = db.get("purchaseOrders", poId)!;
    const result = receivePurchaseOrder(po, db.list("products"), {
      at: nowStamp(),
      byUserId: this.viewer!.userId,
      movementId: () => newId(db.companyId, "mov"),
      newRollId: () => newId(db.companyId, "roll"),
      rollNumber: (p) => `${p.sku.slice(0, 2)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    });
    db.put("purchaseOrders", result.po);
    for (const m of result.movements) db.put("stockMovements", m);
    for (const r of result.rolls) db.put("rolls", r);
    this.appendAudit(db, {
      category: "data",
      action: "Received purchase order",
      target: po.number,
      before: po.status,
      after: `received into ${locationName(db.list("locations"), po.locationId)}, ${result.rolls.length} rolls`,
    });
    this.emit();
    return result.po;
  }

  async billPurchaseOrder(poId: string, billNumber: string) {
    const db = this.open();
    await this.assertCan(db, ["purchasing.bill.create"]);
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
    await this.assertCan(db, ["purchasing.payment.record"]);
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

  async createTransfer(input: TransferInput) {
    const db = this.open();
    await this.assertCan(db, ["inventory.transfer.create"]);
    const locations = db.list("locations");
    const problem = validateTransfer(input, locations, db.list("rolls"), db.list("stockMovements"));
    if (problem) throw new DemoRuleError(problem);
    const transfer: Transfer = {
      id: newId(db.companyId, "trf"),
      number: nextNumber(
        "TR-",
        db.list("transfers").map((t) => t.number),
        1001,
      ),
      fromId: input.fromId,
      toId: input.toId,
      status: "in_transit",
      lines: input.lines.map((l) => ({ ...l, id: newId(db.companyId, "trl") })),
      createdAt: nowStamp(),
      createdBy: this.viewer!.userId,
      receivedAt: null,
      receivedBy: null,
      note: input.note.trim(),
    };
    const ids = { movementId: () => newId(db.companyId, "mov"), at: transfer.createdAt, byUserId: transfer.createdBy };
    const sent = startTransfer(transfer, db.list("rolls"), ids);
    db.put("transfers", transfer);
    for (const m of sent.movements) db.put("stockMovements", m);
    for (const r of sent.rolls) db.put("rolls", r);
    this.appendAudit(db, {
      category: "data",
      action: "Started transfer",
      target: transfer.number,
      before: locationName(locations, transfer.fromId),
      after: `in transit to ${locationName(locations, transfer.toId)}, ${transfer.lines.length} items`,
    });
    this.emit();
    return transfer;
  }

  async receiveTransfer(transferId: string) {
    const db = this.open();
    await this.assertCan(db, ["inventory.transfer.receive"]);
    const transfer = db.get("transfers", transferId);
    if (!transfer) throw new DemoRuleError("This transfer no longer exists.");
    if (transfer.status !== "in_transit") throw new DemoRuleError(`${transfer.number} was already received.`);
    const ids = { movementId: () => newId(db.companyId, "mov"), at: nowStamp(), byUserId: this.viewer!.userId };
    const result = receiveTransfer(transfer, db.list("rolls"), ids);
    db.put("transfers", result.transfer);
    for (const m of result.movements) db.put("stockMovements", m);
    for (const r of result.rolls) db.put("rolls", r);
    this.appendAudit(db, {
      category: "data",
      action: "Received transfer",
      target: transfer.number,
      before: "in transit",
      after: `received at ${locationName(db.list("locations"), transfer.toId)}`,
    });
    this.emit();
    return result.transfer;
  }

  async saveLocation(location: Location) {
    const db = this.open();
    await this.assertCan(db, ["settings.locations.manage"]);
    const before = db.get("locations", location.id);
    const holdsStock =
      db.list("rolls").some((r) => r.locationId === location.id && dec(r.remainingLengthFt).gt(0)) ||
      [...boxedStock(db.list("stockMovements"), location.id).values()].some((q) => !q.isZero());
    if (location.kind === "showroom" && holdsStock) {
      throw new DemoRuleError(`${location.name} holds stock. Transfer it out before making it a showroom.`);
    }
    const others = db.list("locations").filter((l) => l.id !== location.id);
    if (location.kind === "showroom" && location.isDefault) {
      throw new DemoRuleError("The default must be a warehouse; showrooms hold no sellable stock.");
    }
    if (!location.isDefault && !others.some((l) => l.isDefault)) {
      throw new DemoRuleError("Keep one warehouse as the company default.");
    }
    const saved = { ...location, name: location.name.trim() };
    if (saved.isDefault)
      for (const l of others.filter((o) => o.isDefault)) db.put("locations", { ...l, isDefault: false });
    db.put("locations", saved);
    this.appendAudit(db, {
      category: "settings",
      action: before ? "Changed location" : "Added location",
      target: saved.name,
      before: before ? `${before.kind}${before.isDefault ? ", default" : ""}` : null,
      after: `${saved.kind}${saved.isDefault ? ", default" : ""}`,
    });
    this.emit();
    return saved;
  }

  async updateMyProfile(patch: ProfilePatch) {
    const db = this.open();
    const before = db.get("users", this.viewer!.userId)!;
    const locations = db.list("locations");
    if (patch.defaultLocationId && locations.find((l) => l.id === patch.defaultLocationId)?.kind !== "warehouse") {
      throw new DemoRuleError("Choose a warehouse; showrooms hold no sellable stock.");
    }
    const after = { ...before, ...patch };
    db.put("users", after);
    this.appendAudit(db, {
      category: "user",
      action: "Changed own profile",
      target: before.name,
      before: `default warehouse ${locationName(locations, before.defaultLocationId) || "company default"}`,
      after: `default warehouse ${locationName(locations, after.defaultLocationId) || "company default"}`,
    });
    this.emit();
    return after;
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

  /** Companies the super-admin changed, upgrading what an older demo saved. */
  private changedCompanies(fresh: readonly Company[] = this.platform?.companies ?? []): Record<string, Company> {
    const current = readStored<Record<string, Company>>(PLATFORM_KEY);
    if (current) return current;
    const legacy = readLegacy<Record<string, Company>>(PLATFORM_KEY);
    if (!legacy) return {};
    const upgraded = Object.fromEntries(
      Object.entries(legacy).map(([id, c]) => [
        id,
        upgradeCompany(
          c,
          fresh.find((f) => f.id === id),
        ),
      ]),
    );
    writeStored(PLATFORM_KEY, upgraded);
    removeLegacy(PLATFORM_KEY);
    return upgraded;
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

  /**
   * The save logic's own permission check (CLAUDE.md rule 2, spec section 0.4): the screen hides
   * what a role cannot do, and the store refuses it anyway. Passes when any listed key is held.
   */
  private async assertCan(db: CompanyDb, anyOf: readonly PermissionKey[]) {
    if (anyOf.length === 0) return;
    const { access } = await this.granter(db);
    if (anyOf.some((key) => access.permissions.has(key))) return;
    throw new DemoRuleError("Your role does not allow this. Ask an Owner to change your security role.");
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
