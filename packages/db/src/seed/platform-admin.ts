import { encodeMemberRoles } from "@workspace/shared";
import { eq } from "drizzle-orm";
import { openCompanyDb, type ControlDb } from "../client";
import { userProfiles, userRoles } from "../company";
import { account, member, platformAdmins, tenantDatabases, user } from "../control";
import { decryptSecret } from "../crypto";
import { seededTenantId } from "./control";
import { loadDemoCompany, seedId } from "./fixtures";

/**
 * The invented platform admin `pnpm db:seed` writes for local testing (ADR 0065): a person of
 * the platform team on a reserved example domain no real person uses, not one of Summit's people.
 */
export const SEED_PLATFORM_ADMIN = {
  email: "platform.admin@platform.example",
  name: "Platform Admin",
  role: "owner",
  /** The home company they sign in through until the admin host exists (owner question 1). */
  homeCompany: "summit",
  /** The least-privileged system role that can sign in: own timesheets, time off and meetings. */
  homeRoleKey: "employee",
} as const;

/** The control-database user id of the seeded platform admin. */
export const seededPlatformAdminId = seedId("user:platform-admin");

/**
 * Writes the seeded platform admin: a verified Better Auth user, a password credential when a
 * hash is given, an active `owner` row in platform_admins, and a membership of the home company
 * with its Employee role. No MFA secret: platform admins must use MFA, so they enrol at their
 * first sign-in like any MFA role (blueprint p27). There is no admin host yet, so a platform
 * admin signs in through a company they belong to (docs/specs/platform-admin.md, "Sign-in and the
 * platform session"). The home company must already be seeded. Stable ids and no overwrites, so a
 * second run keeps what is there.
 */
export async function seedPlatformAdmin(
  control: ControlDb,
  encryptionKey: string,
  passwordHash: string | undefined,
): Promise<string> {
  const userId = seededPlatformAdminId;
  const home = loadDemoCompany(SEED_PLATFORM_ADMIN.homeCompany);
  const homeTenantId = seededTenantId(home.company.id);
  const role = home.fixtures.roles.find((candidate) => candidate.key === SEED_PLATFORM_ADMIN.homeRoleKey);
  if (!role) throw new Error(`${home.company.name} has no ${SEED_PLATFORM_ADMIN.homeRoleKey} role.`);
  const [database] = await control
    .select({ encryptedUrl: tenantDatabases.encryptedUrl })
    .from(tenantDatabases)
    .where(eq(tenantDatabases.tenantId, homeTenantId));
  if (!database) throw new Error(`Seed ${home.company.name} before the platform admin: it is their home company.`);

  await control.transaction(async (tx) => {
    await tx
      .insert(user)
      .values({ id: userId, name: SEED_PLATFORM_ADMIN.name, email: SEED_PLATFORM_ADMIN.email, emailVerified: true })
      .onConflictDoNothing();
    if (passwordHash) {
      await tx
        .insert(account)
        .values({
          id: seedId("account:platform-admin"),
          accountId: userId,
          providerId: "credential",
          userId,
          password: passwordHash,
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
    }
    await tx
      .insert(platformAdmins)
      .values({ id: seedId("platform-admin:owner"), userId, role: SEED_PLATFORM_ADMIN.role, active: true })
      .onConflictDoNothing();
    await tx
      .insert(member)
      .values({
        id: seedId("member:platform-admin"),
        organizationId: homeTenantId,
        userId,
        role: encodeMemberRoles([role.key]),
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  });

  // The home company's own side of the membership: a profile and the Employee role.
  const company = openCompanyDb(decryptSecret(database.encryptedUrl, encryptionKey), { max: 1 });
  try {
    await company.db.transaction(async (tx) => {
      await tx
        .insert(userProfiles)
        .values({
          id: seedId("profile:platform-admin"),
          userId,
          title: "Platform admin",
          branchId: seedId(home.company.branches[0].id),
          status: "active",
          defaultLocationId: null,
        })
        .onConflictDoNothing();
      await tx
        .insert(userRoles)
        .values({ id: seedId(`platform-admin:${role.id}`), userId, roleId: seedId(role.id) })
        .onConflictDoNothing();
    });
  } finally {
    await company.close();
  }
  return userId;
}
