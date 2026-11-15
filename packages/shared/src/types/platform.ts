import type { PermissionKey } from "../permissions/catalog";
import type { CompanyPhase, LifecycleStatus, LifecycleSubscription } from "../permissions/company-lifecycle";
import type { RoleTemplate } from "../permissions/roles";
import type { ModuleKey, ProductKey } from "../products";
import type { Branding } from "./company";

/**
 * The roles a `platform_admins` row may hold (docs/specs/platform-admin.md, "Who uses it"). Both
 * read every /platform page; only `owner` changes a company's access.
 */
export type PlatformAdminRole = "owner" | "support";

/** The platform admin using the console, as `GET /platform/me` answers. */
export interface PlatformMe {
  userId: string;
  name: string;
  email: string;
  role: PlatformAdminRole;
}

/** Why a company is in maintenance (`tenants.maintenance_reason`). */
export type CompanyMaintenanceReason = "migration_failed" | "move";

/** A company's maintenance switch as the console shows it. */
export interface PlatformMaintenance {
  on: boolean;
  reason: CompanyMaintenanceReason | null;
}

/** The state of a company's own database (`tenant_databases.status`). */
export type CompanyDatabaseState = "provisioning" | "ready" | "migrating" | "failed" | "read_only";

/**
 * A company database as the console shows it. It never carries the error text: `last_error` holds
 * the driver's message, which can quote company data (spec "Fields"; review A1). `status` and
 * `schemaVersion` are null when the company has no database row yet.
 */
export interface PlatformDatabaseStatus {
  status: CompanyDatabaseState | null;
  schemaVersion: string | null;
  hasError: boolean;
}

/**
 * One company in the console's list (spec "PlatformCompanySummary"). Read from the control
 * database only. `userLimit` and `branchLimit` are null for a trial with no plan; `members` counts
 * sign-ins with a membership, not seats in use.
 */
export interface PlatformCompanySummary {
  /** The company's UUID (`tenants.id`), not the demo's `CompanyId`. */
  id: string;
  slug: string;
  name: string;
  city: string;
  state: string;
  products: ProductKey[];
  status: LifecycleStatus;
  /** ISO moment of the last status change. */
  statusChangedAt: string;
  phase: CompanyPhase;
  maintenance: PlatformMaintenance;
  plan: string;
  modules: ModuleKey[];
  userLimit: number | null;
  branchLimit: number | null;
  members: number;
  database: PlatformDatabaseStatus;
}

/** One subscription row that is not deleted, as the company detail shows it. */
export interface PlatformSubscription {
  id: string;
  planKey: string;
  planName: string;
  product: ProductKey;
  interval: "monthly" | "yearly";
  /** A decimal string (CLAUDE.md rule 6). */
  price: string;
  /** ISO moments. */
  currentPeriodStart: string;
  currentPeriodEnd: string;
  status: LifecycleSubscription["status"];
  userLimitOverride: number | null;
  branchLimitOverride: number | null;
}

/** One company in full (spec "PlatformCompany"): the summary plus its profile, ceiling and subscriptions. */
export interface PlatformCompany extends PlatformCompanySummary {
  legalName: string;
  timeZone: string;
  region: string;
  /** ISO moment. */
  createdAt: string;
  /** The allowed permission keys. */
  ceiling: PermissionKey[];
  subscriptions: PlatformSubscription[];
}

/**
 * A change of company access (spec "PlatformAccessPatch"). `modules` and `ceiling` are complete
 * lists among the modules and keys the company's products offer and that are visible (rule 18). A
 * field left out leaves that part unchanged.
 */
export interface PlatformAccessPatch {
  modules?: ModuleKey[];
  ceiling?: PermissionKey[];
  userLimit?: number;
  branchLimit?: number;
}

/** A company's branding as the console shows it, without logo storage keys. */
export type PlatformBranding = Omit<Branding, "logoDataUrl">;

/**
 * A company's directory as the console sees it, restricted (spec "PlatformDirectory"; owner
 * question 3): the default role templates of its products and no users, because a company's users
 * and custom roles need support access, which opens nothing yet. No company database is read.
 */
export interface PlatformDirectory {
  roles: RoleTemplate[];
  /** Always empty. */
  users: [];
  /** Null when the company has no branding row. */
  branding: PlatformBranding | null;
  restricted: true;
}
