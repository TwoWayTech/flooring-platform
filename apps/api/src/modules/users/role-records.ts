import type { CompanyDb, ControlDb } from "@workspace/db";
import { rolePermissions, roles, userRoles } from "@workspace/db/company";
import { member } from "@workspace/db/control";
import { memberRoleValue, type CompanyId, type DataScope, type PermissionKey, type Role } from "@workspace/shared";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";

/** A company role with its live permission keys, as the users and roles services work with it. */
export interface RoleRecord {
  id: string;
  key: string;
  name: string;
  description: string;
  dataScope: DataScope;
  system: boolean;
  owner: boolean;
  permissions: PermissionKey[];
}

/** Every live role of the company with its live permission keys, by name. */
export async function loadRoles(db: CompanyDb): Promise<RoleRecord[]> {
  const rows = await db.select().from(roles).where(isNull(roles.deletedAt)).orderBy(roles.name);
  if (rows.length === 0) return [];
  const keys = await db
    .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(
      and(
        inArray(
          rolePermissions.roleId,
          rows.map((row) => row.id),
        ),
        isNull(rolePermissions.deletedAt),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    dataScope: row.dataScope,
    system: row.system,
    owner: row.owner,
    permissions: keys.filter((key) => key.roleId === row.id).map((key) => key.key as PermissionKey),
  }));
}

/** A role as the screens read it (packages/shared `Role`). The company id is the tenant id in api mode. */
export function roleView(role: RoleRecord, companyId: string): Role {
  return { ...role, companyId: companyId as CompanyId };
}

/** The ids of the live roles each user holds, by user id. */
export async function heldRoles(db: CompanyDb, userIds?: readonly string[]): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ userId: userRoles.userId, roleId: userRoles.roleId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        isNull(userRoles.deletedAt),
        isNull(roles.deletedAt),
        userIds ? inArray(userRoles.userId, [...userIds]) : undefined,
      ),
    );
  const held = new Map<string, string[]>();
  for (const row of rows) held.set(row.userId, [...(held.get(row.userId) ?? []), row.roleId]);
  return held;
}

/**
 * Gives a user exactly these roles: links to other roles are soft-deleted, and wanted links are
 * added or brought back (the unique index keeps one row per user and role).
 */
export async function setUserRoles(tx: CompanyDb, userId: string, roleIds: readonly string[], by: string) {
  await tx
    .update(userRoles)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(userRoles.userId, userId),
        isNull(userRoles.deletedAt),
        roleIds.length > 0 ? notInArray(userRoles.roleId, [...roleIds]) : undefined,
      ),
    );
  for (const roleId of roleIds) {
    await tx
      .insert(userRoles)
      .values({ userId, roleId, createdBy: by })
      .onConflictDoUpdate({ target: [userRoles.userId, userRoles.roleId], set: { deletedAt: null } });
  }
}

/**
 * Gives a role exactly these permission keys: removed keys are soft-deleted, new or returning keys
 * are added or brought back.
 */
export async function setRolePermissions(tx: CompanyDb, roleId: string, keys: readonly string[], by: string) {
  await tx
    .update(rolePermissions)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(rolePermissions.roleId, roleId),
        isNull(rolePermissions.deletedAt),
        keys.length > 0 ? notInArray(rolePermissions.permissionKey, [...keys]) : undefined,
      ),
    );
  for (const permissionKey of keys) {
    await tx
      .insert(rolePermissions)
      .values({ roleId, permissionKey, createdBy: by })
      .onConflictDoUpdate({
        target: [rolePermissions.roleId, rolePermissions.permissionKey],
        set: { deletedAt: null },
      });
  }
}

/**
 * Writes Better Auth's `member.role` for these users from the roles they hold now: their role keys
 * plus the `mfa` marker when a role needs MFA by content (packages/shared `memberRoleValue`), so
 * sign-in decides on MFA before any company database is open (ADR 0029, part 2).
 */
export async function syncMemberRoles(
  control: ControlDb,
  companyId: string,
  held: ReadonlyMap<string, readonly string[]>,
  allRoles: readonly RoleRecord[],
): Promise<void> {
  for (const [userId, roleIds] of held) {
    const value = memberRoleValue(allRoles.filter((role) => roleIds.includes(role.id)));
    await control
      .update(member)
      .set({ role: value })
      .where(and(eq(member.userId, userId), eq(member.organizationId, companyId)));
  }
}
