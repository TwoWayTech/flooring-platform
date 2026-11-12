import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appendOnly, at, business, userRef } from "../columns";
import { tenants } from "./tenants";

/**
 * The permission ceiling: what a company's admins may hand out at most (blueprint "Users, roles
 * and super-admin access"). Effective permissions = role permissions ∩ ceiling ∩ enabled modules.
 */
export const tenantPermissionCeiling = pgTable(
  "tenant_permission_ceiling",
  {
    ...business(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    permissionKey: text().notNull(),
    allowed: boolean().notNull(),
  },
  (table) => [uniqueIndex("tenant_permission_ceiling_uidx").on(table.tenantId, table.permissionKey)],
);

/** Read-only, time-limited support access, approved by the company's Owner (blueprint role rule 6). */
export const supportAccessGrants = pgTable("support_access_grants", {
  ...business(),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id),
  adminUserId: userRef().notNull(),
  approvedBy: userRef(),
  approvedAt: at(),
  reason: text().notNull(),
  expiresAt: at().notNull(),
  revokedAt: at(),
});

/** The platform's own super-admin team (blueprint "Users, roles and super-admin access"). */
export const platformAdmins = pgTable(
  "platform_admins",
  {
    ...business(),
    userId: userRef().notNull(),
    role: text().$type<"owner" | "support">().notNull(),
    active: boolean().notNull().default(true),
  },
  (table) => [uniqueIndex("platform_admins_user_uidx").on(table.userId)],
);

/**
 * Everything the super-admin team does, append-only: nobody edits or deletes a row, admins
 * included (blueprint "Security": audit log). A company's own changes go to its audit_log.
 */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    ...appendOnly(),
    at: at().notNull().defaultNow(),
    actorUserId: userRef(),
    tenantId: uuid().references(() => tenants.id),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text(),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    userAgent: text(),
  },
  (table) => [index("platform_audit_log_tenant_idx").on(table.tenantId, table.at)],
);
