import type { ControlDb } from "../client";
import { account, platformAdmins, user } from "../control";
import { seedId } from "./fixtures";

/**
 * The invented platform admin `pnpm db:seed` writes for local testing (ADR 0065): a person of
 * the platform team, not of any company, on a reserved example domain no real person uses.
 */
export const SEED_PLATFORM_ADMIN = {
  email: "platform.admin@platform.example",
  name: "Platform Admin",
  role: "owner",
} as const;

/** The control-database user id of the seeded platform admin. */
export const seededPlatformAdminId = seedId("user:platform-admin");

/**
 * Writes the seeded platform admin: a verified Better Auth user, a password credential when a
 * hash is given, and an active `owner` row in platform_admins. No company membership and no MFA
 * secret: platform admins must use MFA, so they enrol at their first sign-in like any MFA role
 * (blueprint p27). Stable ids and no overwrites, so a second run keeps what is there.
 */
export async function seedPlatformAdmin(control: ControlDb, passwordHash: string | undefined): Promise<string> {
  const userId = seededPlatformAdminId;
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
  });
  return userId;
}
