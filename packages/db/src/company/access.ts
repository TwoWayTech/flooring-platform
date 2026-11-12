import type { DataScope, UserStatus } from "@workspace/shared";
import { boolean, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, business, userRef } from "../columns";
import { employees } from "./hr";
import { branches, locations } from "./organization";

/**
 * A role in this company (blueprint "Users, roles and super-admin access"). The Owner role is
 * locked; system roles can be copied, not deleted. Data scope sits on the role and a user gets
 * the widest of their roles (data-model.md, Organization and access).
 */
export const roles = pgTable(
  "roles",
  {
    ...business(),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    dataScope: text().$type<DataScope>().notNull(),
    system: boolean().notNull().default(false),
    owner: boolean().notNull().default(false),
  },
  (table) => [uniqueIndex("roles_key_uidx").on(table.key)],
);

/** One permission key a role holds (`module.resource.action`, packages/shared permissions catalog). */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    ...business(),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
    permissionKey: text().notNull(),
  },
  (table) => [uniqueIndex("role_permissions_uidx").on(table.roleId, table.permissionKey)],
);

/**
 * A person's profile in this company. The person (name, email, MFA) is a control-database user;
 * this row holds what only this company knows about them.
 */
export const userProfiles = pgTable(
  "user_profiles",
  {
    ...business(),
    userId: userRef().notNull(),
    title: text().notNull().default(""),
    branchId: uuid().references(() => branches.id),
    status: text().$type<UserStatus>().notNull().default("invited"),
    employeeId: uuid().references(() => employees.id),
    defaultLocationId: uuid().references(() => locations.id),
    lastLoginAt: at(),
  },
  (table) => [uniqueIndex("user_profiles_user_uidx").on(table.userId)],
);

/** A role given to a user; a user may hold several, capped by the ceiling (blueprint role rule 4). */
export const userRoles = pgTable(
  "user_roles",
  {
    ...business(),
    userId: userRef().notNull(),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
  },
  (table) => [uniqueIndex("user_roles_uidx").on(table.userId, table.roleId)],
);
