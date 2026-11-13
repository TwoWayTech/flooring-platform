import {
  permissionsForModules,
  PRODUCT_MODULES,
  PRODUCT_ROLES,
  roleTemplate,
  type DefaultRoleKey,
  type ProductKey,
} from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { CompanyDb } from "./client";
import { rolePermissions, roles, userProfiles, userRoles } from "./company";

/** The permission keys a company of these products can ever hold: every key of their modules. */
export function productPermissions(products: readonly ProductKey[]) {
  return permissionsForModules([...new Set(products.flatMap((product) => PRODUCT_MODULES[product]))]);
}

/**
 * The first rows of a new company database (P10): the default roles of its products, each limited
 * to the products' permissions, and the owner's profile holding the Owner role. Default roles are
 * system roles copied from packages/shared (spec "Default roles"). Rows are written by the system,
 * so `created_by` is null.
 *
 * Only for a company being provisioned: provisionTenant runs it on a new or unfinished company.
 * Never run it on a live company, because it would add back default permissions an admin removed
 * from a system role. Running it again on an unfinished company keeps existing roles, profiles and
 * role links.
 */
export async function seedCompanyFoundation(
  company: CompanyDb,
  input: { products: readonly ProductKey[]; ownerUserId: string },
): Promise<void> {
  const allowed = new Set(productPermissions(input.products));
  const keys = [...new Set(input.products.flatMap((product) => PRODUCT_ROLES[product]))];
  await company.transaction(async (tx) => {
    for (const key of keys) await seedRole(tx, key, allowed);
    await tx.insert(userProfiles).values({ userId: input.ownerUserId, status: "invited" }).onConflictDoNothing();
    const [ownerRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.key, "owner"), isNull(roles.deletedAt)));
    if (!ownerRole) throw new Error("The company has no Owner role, so its owner cannot be set up.");
    await tx.insert(userRoles).values({ userId: input.ownerUserId, roleId: ownerRole.id }).onConflictDoNothing();
  });
}

async function seedRole(tx: CompanyDb, key: DefaultRoleKey, allowed: ReadonlySet<string>): Promise<void> {
  const template = roleTemplate(key);
  await tx
    .insert(roles)
    .values({
      key,
      name: template.name,
      description: template.description,
      dataScope: template.dataScope,
      system: true,
      owner: template.owner,
    })
    .onConflictDoNothing();
  const [role] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.key, key), isNull(roles.deletedAt)));
  if (!role) throw new Error(`The default role ${key} exists only as a deleted role; restore it by hand.`);
  const permissions = template.permissions.filter((permission) => allowed.has(permission));
  if (permissions.length === 0) return;
  await tx
    .insert(rolePermissions)
    .values(permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })))
    .onConflictDoNothing();
}
