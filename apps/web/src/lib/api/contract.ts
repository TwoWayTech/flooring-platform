import type {
  AuditEntry,
  Branding,
  Company,
  CompanyFixtures,
  CompanyId,
  Bill,
  CutResult,
  PoLine,
  PurchaseOrder,
  Invoice,
  Quote,
  CompanySettings,
  Transfer,
  TransferInput,
  Location,
  ModuleKey,
  PermissionKey,
  Role,
  User,
} from "@workspace/shared";

/** Record collections a company holds; each maps to a resource endpoint in docs/api-contract.md. */
export type Collections = Omit<CompanyFixtures, "companyId" | "anchorDate" | "settings">;
/** Name of a record collection, e.g. "invoices". */
export type CollectionName = keyof Collections;
/** One record of a collection. */
export type ItemOf<K extends CollectionName> = Collections[K][number];

/**
 * Who the API answers for. With `viewAsRoleId` set, data scope follows that role's first active
 * user, so "View as Sales" shows what a Sales user would see (spec "App shell").
 */
export interface Viewer {
  userId: string;
  viewAsRoleId: string | null;
}

/** A super-admin change to a company's access (spec "Super-admin"). */
export interface CompanyAccessPatch {
  modules?: ModuleKey[];
  ceiling?: PermissionKey[];
  userLimit?: number;
  branchLimit?: number;
}

/** A company as seen from outside it: who can sign in, and how it looks. */
export interface CompanyDirectory {
  roles: Role[];
  users: User[];
  branding: Branding;
}

/** Fields for inviting a user (spec "Settings: Users"). */
export interface InviteUserInput {
  name: string;
  email: string;
  title: string;
  roleIds: string[];
  branchId: string;
}

/** What a person may change on their own profile (spec A1: default warehouse). */
export type ProfilePatch = Partial<Pick<User, "defaultLocationId">>;

/** Fields an admin may change on a user. Users are disabled, never deleted. */
export type UserPatch = Partial<Pick<User, "roleIds" | "status" | "mfaEnrolled" | "branchId" | "title">>;

/** What changed, for the audit log (blueprint "Audit log": who, when, before and after). */
export interface AuditInput {
  category: AuditEntry["category"];
  action: string;
  target: string;
  before: string | null;
  after: string | null;
}

/**
 * The interface every screen uses for data (CLAUDE.md rule 1). The demo implementation is
 * DemoStore; a real HTTP client can replace it without touching screens. The tenant comes
 * from the session, as it would on a real server.
 */
export interface ApiClient {
  /** Opens a company's data for the signed-in viewer; company-scoped calls read from it. */
  openCompany(companyId: CompanyId, viewer: Viewer): Promise<void>;
  /** Changes the viewer, e.g. when "View as role" is switched. */
  setViewer(viewer: Viewer): void;
  /** Subscribes to data changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Today's date (YYYY-MM-DD) as the data sees it. */
  today(): string;
  /** Restores every company to the generated fixtures. */
  resetDemo(): Promise<void>;
  /**
   * Messages the data layer has for the person once, such as saved demo changes from an older
   * version that had to be reset (docs/specs/feature-batch-02-plan.md, 2.3). Reading clears them.
   */
  takeNotices(): string[];

  /** All companies on the platform (super-admin). */
  listCompanies(): Promise<Company[]>;
  /** Changes a company's products, modules, ceiling or limits; audited in both logs. */
  updateCompanyAccess(companyId: CompanyId, patch: CompanyAccessPatch): Promise<Company>;
  /** Roles, users and branding of any company, read-only (login personas, super-admin "Company access"). */
  listCompanyDirectory(companyId: CompanyId): Promise<CompanyDirectory>;

  /** The open company's record (modules, ceiling, limits). */
  getCompany(): Promise<Company>;
  /** The open company's settings. */
  getSettings(): Promise<CompanySettings>;
  /** Replaces one settings section and audits the change. */
  updateSettings<K extends keyof CompanySettings>(section: K, value: CompanySettings[K]): Promise<CompanySettings>;

  /** Restores one settings section to the company's original values and audits it. */
  resetSettings(section: keyof CompanySettings): Promise<CompanySettings>;

  /** Records of a collection, limited to the viewer's data scope. */
  list<K extends CollectionName>(collection: K): Promise<Collections[K]>;
  /** One record by id, or undefined when it does not exist or is outside the viewer's scope. */
  get<K extends CollectionName>(collection: K, id: string): Promise<ItemOf<K> | undefined>;
  /** Creates or replaces a record. Screens call domain methods; this backs them. */
  save<K extends CollectionName>(collection: K, item: ItemOf<K>, audit?: AuditInput): Promise<ItemOf<K>>;

  /** Invites a user; fails when the seat limit is reached (spec "Settings: Users"). */
  inviteUser(input: InviteUserInput): Promise<User>;
  /** Changes a user's roles, status, MFA or branch and audits it. */
  updateUser(userId: string, patch: UserPatch): Promise<User>;
  /** Creates or updates a role and audits the before and after permissions. */
  saveRole(role: Role): Promise<Role>;
  /**
   * Puts a default role back to its shipped permissions, scope and description (spec A3). The
   * Owner role is locked, and the granter must hold every permission the reset adds. Audited.
   */
  resetRole(roleId: string): Promise<Role>;
  /** Deletes a non-system role that no user holds. */
  deleteRole(roleId: string): Promise<void>;
  /**
   * Cuts a length from a roll as the signed-in user (spec "Inventory and roll detail"); a
   * leftover under 12 ft becomes a remnant. Audited.
   */
  cutRoll(rollId: string, lengthFt: string, reference: string): Promise<CutResult>;
  /** Saves a quote; a new quote gets the next number from the company's quote prefix. Audited. */
  saveQuote(quote: Quote): Promise<Quote>;
  /**
   * Converts a quote into an invoice dated today (spec "Quote builder → invoice"): totals are
   * recomputed under the job site's tax rule, and the quote is marked invoiced. Audited.
   */
  convertQuoteToInvoice(quoteId: string): Promise<Invoice>;
  /** Creates a purchase order with the next number; it starts as sent to the supplier. Audited. */
  createPurchaseOrder(input: {
    supplierId: string;
    expectedAt: string;
    locationId: string;
    lines: PoLine[];
  }): Promise<PurchaseOrder>;
  /** Receives a purchase order into its warehouse: cartons go into the ledger, broadloom arrives as rolls. Audited. */
  receivePurchaseOrder(poId: string): Promise<PurchaseOrder>;
  /** Enters the supplier's bill for a received purchase order. Audited. */
  billPurchaseOrder(poId: string, billNumber: string): Promise<Bill>;
  /** Pays a bill's open balance in full. Audited. */
  payBill(billId: string): Promise<Bill>;
  /**
   * Starts a transfer between two warehouses (spec A1): boxed stock leaves the sender at once and
   * rolls are marked in transit. Needs inventory.transfer.create. Audited.
   */
  createTransfer(input: TransferInput): Promise<Transfer>;
  /** Receives a transfer at its destination. Needs inventory.transfer.receive. Audited. */
  receiveTransfer(transferId: string): Promise<Transfer>;
  /**
   * Creates or changes a warehouse or showroom (spec A1). Exactly one warehouse is the company
   * default, and a location holding stock cannot become a showroom. Needs settings.locations.manage. Audited.
   */
  saveLocation(location: Location): Promise<Location>;
  /** Changes the signed-in person's own profile, such as their default warehouse. Audited. */
  updateMyProfile(patch: ProfilePatch): Promise<User>;
  /** Appends an entry to the open company's audit log as the signed-in user. */
  recordAudit(entry: AuditInput): Promise<void>;
}
