import type {
  AuditEntry,
  Branding,
  Company,
  CompanyFixtures,
  CompanyId,
  CompanySettings,
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
  /** Deletes a non-system role that no user holds. */
  deleteRole(roleId: string): Promise<void>;
  /** Appends an entry to the open company's audit log as the signed-in user. */
  recordAudit(entry: AuditInput): Promise<void>;
}
