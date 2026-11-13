import {
  permissionsForModules,
  PRODUCT_MODULES,
  PRODUCT_ROLES,
  roleTemplate,
  type DefaultRoleKey,
  type ProductKey,
} from "@workspace/shared";
import { eq } from "drizzle-orm";
import type { CompanyDb } from "./client";
import { rolePermissions, roles, userProfiles, userRoles } from "./company";

/** The permission keys a company of these products can ever hold: every key of their modules. */
export function productPermissions(products: readonly ProductKey[]) {
  return permissionsForModules([...new Set(products.flatMap((product) => PRODUCT_MODULES[product]))]);
}

/**
 * The first rows of a new company database (P10): the default roles of its products, each limited
 * to the products' permissions, and the owner's profile holding the Owner role. Default roles are
 * system roles copied from packages/shared (spec "Default roles"). Safe to run again: existing
 * roles, profiles and role links are kept, never overwritten.
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
    const [ownerRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, "owner"));
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
  const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
  const permissions = template.permissions.filter((permission) => allowed.has(permission));
  if (permissions.length === 0) return;
  await tx
    .insert(rolePermissions)
    .values(permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })))
    .onConflictDoNothing();
}
