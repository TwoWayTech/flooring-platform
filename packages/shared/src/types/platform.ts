import type { PermissionKey } from "../permissions/catalog";
import type { CompanyPhase, LifecycleStatus, LifecycleSubscription } from "../permissions/company-lifecycle";
import type { RoleTemplate } from "../permissions/roles";
import type { ModuleKey, ProductKey } from "../products";
import type { Branding } from "./company";

/**
 * The roles a `platform_admins` row may hold (docs/specs/platform-admin.md, "Who uses it"). Both
 * use the console; only `owner` changes a company's access, sees every admin's support requests
 * and sees the audit log's addresses (spec "Who may call what (part 3)"; `platform/admin-roles.ts`).
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

/**
 * The six actions `platform_audit_log` holds (docs/specs/platform-admin.md, "GET /platform/audit",
 * The six actions). `PLATFORM_AUDIT_ACTIONS` in `platform/audit-details.ts` lists them at run time.
 */
export type PlatformAuditAction =
  | "company.access_changed"
  | "support.requested"
  | "support.approved"
  | "support.revoked"
  | "company.migration_failed"
  | "company.migration_recovered";

/**
 * A support grant's status, derived from its dates and never stored (spec "Support requests",
 * Status; ADR 0013 style). `supportGrantStatus` in `platform/support-grants.ts` derives it.
 */
export type SupportGrantStatus = "pending" | "approved" | "revoked" | "expired";

/**
 * The filters and cursor of one page of the platform audit log (spec "GET /platform/audit", Query).
 * `before` is the `id` of the last entry of the previous page.
 */
export interface PlatformAuditQuery {
  companyId?: string;
  action?: PlatformAuditAction;
  before?: string;
  limit?: number;
}

/**
 * Who made an audit entry (spec "PlatformAuditActor"). The kind comes from the action, never from
 * today's `platform_admins` rows, and company people are never named or identified.
 */
export type PlatformAuditActor =
  /** A platform admin; `name` reads "Former admin" when the user row is gone. */
  | { kind: "platform_admin"; userId: string; name: string }
  /** The company's Owner, with no id and no name: the console shows no company people. */
  | { kind: "company_user" }
  /** The migration runner (`pnpm db:migrate`). */
  | { kind: "system" }
  /** An action this build doesn't know, or a platform-admin action with no actor. */
  | { kind: "unknown" };

/** A limit before and after a change of company access; each side is null when it had no limit. */
export interface PlatformAuditLimitChange {
  from: number | null;
  to: number | null;
}

/**
 * What an audit entry may show, per action (spec "Redaction (deny by default)"). An entry whose
 * stored fields don't fit its action's allow-list exactly is `hidden`; migration failures only ever
 * carry their error code, never the driver's text.
 */
export type PlatformAuditDetails =
  | {
      kind: "access_changed";
      modulesSwitchedOn: string[];
      modulesSwitchedOff: string[];
      keysAdded: string[];
      keysRemoved: string[];
      userLimit: PlatformAuditLimitChange | null;
      branchLimit: PlatformAuditLimitChange | null;
      /** How many `tenant_module_overrides` rows the save wrote. */
      overrideRows: number;
      /** How many subscription rows' limit overrides the save wrote. */
      limitRows: number;
    }
  | { kind: "support_requested"; reason: string; expiresAt: string }
  | { kind: "support_decided"; decision: "approved" | "revoked" }
  | { kind: "migration_failed"; code: string | null }
  | { kind: "migration_recovered"; version: string | null }
  | { kind: "hidden" };

/** One entry of the platform audit log as the console shows it (spec "PlatformAuditView"). */
export interface PlatformAuditView {
  /** The entry's UUID, which is also the cursor of the next page. */
  id: string;
  /** ISO moment. */
  at: string;
  /** The stored action when it fits `object.verb`, else "unknown". */
  action: string;
  /** Null when the entry has no company or the company row is gone. */
  company: { id: string; name: string } | null;
  actor: PlatformAuditActor;
  /** The stored target type when it fits its pattern, else "unknown". */
  targetType: string;
  /** The stored target id when it is a UUID, else null. */
  targetId: string | null;
  details: PlatformAuditDetails;
  /** Owner role only, and only on a platform admin's own entries; the key is absent otherwise. */
  network?: { ip: string | null; userAgent: string | null };
}

/** One page of the platform audit log (named Result, not Page, so the screen can be PlatformAuditPage). */
export interface PlatformAuditResult {
  entries: PlatformAuditView[];
  /** The id to pass as `before` for the next page, or null on the last page. */
  nextCursor: string | null;
}

/**
 * A support-access request as the console lists it (spec "PlatformSupportGrant"). It never carries
 * the approver: `approved_by` is a company user, and the console names no company people.
 */
export interface PlatformSupportGrant {
  id: string;
  company: { id: string; name: string };
  /** The admin who asked; `name` reads "Former admin" when the user row is gone. */
  admin: { userId: string; name: string };
  /** True when the caller asked. */
  mine: boolean;
  reason: string;
  /** ISO moments. */
  requestedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
  status: SupportGrantStatus;
}

/** A platform admin's request for support access (spec "POST /platform/support-grants", Body). */
export interface SupportRequestInput {
  companyId: string;
  reason: string;
  hours: number;
}
