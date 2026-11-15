import { and, eq, inArray, sql } from "drizzle-orm";
import { openControlDb, type ControlDb } from "./client";
import {
  authAttempts,
  passkey,
  platformAdmins,
  rateLimit,
  session,
  supportAccessGrants,
  tenantPermissionCeiling,
  tenants,
  twoFactor,
  user,
} from "./control";
import { PostgresServerProvisioner } from "@workspace/providers";

/** The superuser login on the local or CI PostgreSQL. */
export const adminUrl = process.env.TENANT_DB_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

/**
 * Throwaway databases for integration tests in any package (`@workspace/db/testing`), made by the
 * real provisioner, so a test never touches the developer's control or company databases. Drop
 * them in afterAll.
 */
export async function scratchDatabase(label: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const provisioner = new PostgresServerProvisioner(adminUrl);
  const created = await provisioner.create({ tenantId: label, slug: `test_${label}_${process.pid}` });
  return { url: created.connectionUrl, drop: () => provisioner.drop(created.providerRef) };
}

export { totpCode, totpSecretFromUri } from "./totp";

/**
 * Puts the given users back to "no MFA, no failed attempts" in a control database and clears the
 * per-IP rate limits, so browser tests of sign-in start the same way on every run. Tests only:
 * never point it at a real company's data.
 */
export async function resetAuthState(controlUrl: string, emails: readonly string[]): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const subjects = emails.map((email) => email.trim().toLowerCase());
    const users = await handle.db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.email, [...emails]));
    const ids = users.map((row) => row.id);
    if (ids.length > 0) {
      await handle.db.delete(twoFactor).where(inArray(twoFactor.userId, ids));
      await handle.db.delete(passkey).where(inArray(passkey.userId, ids));
      await handle.db.delete(session).where(inArray(session.userId, ids));
      await handle.db.update(user).set({ twoFactorEnabled: false }).where(inArray(user.id, ids));
    }
    if (subjects.length > 0) await handle.db.delete(authAttempts).where(inArray(authAttempts.subject, subjects));
    await handle.db.delete(rateLimit);
  } finally {
    await handle.close();
  }
}

/**
 * Moves a company's `status_changed_at` back in time, so tests can reach the end of a life-cycle
 * period. The control trigger refuses such writes (migration 0003), so it is switched off for this
 * one update, inside one transaction. Tests only: never point it at a real company.
 */
export async function backdateStatusChange(control: ControlDb, tenantId: string, at: Date): Promise<void> {
  await control.transaction(async (tx) => {
    await tx.execute(sql`alter table tenants disable trigger tenants_status_changed`);
    await tx.update(tenants).set({ statusChangedAt: at }).where(eq(tenants.id, tenantId));
    await tx.execute(sql`alter table tenants enable trigger tenants_status_changed`);
  });
}

/** Removes the platform_admins row of a user, e.g. a leftover of a run that crashed. Tests only. */
export async function removePlatformAdmin(controlUrl: string, email: string): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [found] = await handle.db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (found) await handle.db.delete(platformAdmins).where(eq(platformAdmins.userId, found.id));
  } finally {
    await handle.close();
  }
}

/**
 * Hard-deletes every support grant a user asked for as a platform admin. Tests only: it exists so
 * the one-open-grant and 10-in-24-hours limits of `POST /platform/support-grants` never block a
 * later run on a shared local database (ADR 0053). The `support.requested` audit rows stay.
 */
export async function removeSupportGrants(controlUrl: string, email: string): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [found] = await handle.db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (found) await handle.db.delete(supportAccessGrants).where(eq(supportAccessGrants.adminUserId, found.id));
  } finally {
    await handle.close();
  }
}

/** Makes a seeded user an active platform admin with `role`, replacing any earlier row. Tests only. */
export async function setPlatformAdmin(controlUrl: string, email: string, role: "owner" | "support"): Promise<void> {
  await removePlatformAdmin(controlUrl, email);
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [found] = await handle.db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!found) throw new Error(`No user ${email} to make a platform admin.`);
    await handle.db.insert(platformAdmins).values({ userId: found.id, role, active: true });
  } finally {
    await handle.close();
  }
}

/** A permission-ceiling row as it was before a test, so the test can put it back. */
export interface CeilingRowSnapshot {
  tenantId: string;
  key: string;
  existed: boolean;
  allowed: boolean;
  deleted: boolean;
}

/** Reads one ceiling row of a company, or notes that there is none. Tests only. */
export async function snapshotCeilingRow(
  controlUrl: string,
  tenantId: string,
  key: string,
): Promise<CeilingRowSnapshot> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [row] = await handle.db
      .select({ allowed: tenantPermissionCeiling.allowed, deletedAt: tenantPermissionCeiling.deletedAt })
      .from(tenantPermissionCeiling)
      .where(and(eq(tenantPermissionCeiling.tenantId, tenantId), eq(tenantPermissionCeiling.permissionKey, key)));
    return { tenantId, key, existed: !!row, allowed: row?.allowed ?? false, deleted: !!row?.deletedAt };
  } finally {
    await handle.close();
  }
}

/**
 * Puts a seeded company's ceiling row for `key` back to the seeded state (allowed, not deleted),
 * so a run that was stopped before its own clean-up doesn't leave the next run on a changed
 * ceiling: re-seeding never overwrites an existing row. Throws when the row isn't there. Tests only.
 */
export async function allowSeededCeilingKey(controlUrl: string, companyName: string, key: string): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [company] = await handle.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.name, companyName));
    if (!company) throw new Error(`No seeded company ${companyName}.`);
    const updated = await handle.db
      .update(tenantPermissionCeiling)
      .set({ allowed: true, deletedAt: null })
      .where(and(eq(tenantPermissionCeiling.tenantId, company.id), eq(tenantPermissionCeiling.permissionKey, key)))
      .returning({ id: tenantPermissionCeiling.id });
    if (updated.length === 0) throw new Error(`${companyName} has no seeded ceiling row for ${key}.`);
  } finally {
    await handle.close();
  }
}

/** Puts a ceiling row back exactly as the snapshot found it. Tests only. */
export async function restoreCeilingRow(controlUrl: string, snapshot: CeilingRowSnapshot): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const where = and(
      eq(tenantPermissionCeiling.tenantId, snapshot.tenantId),
      eq(tenantPermissionCeiling.permissionKey, snapshot.key),
    );
    if (!snapshot.existed) await handle.db.delete(tenantPermissionCeiling).where(where);
    else
      await handle.db
        .update(tenantPermissionCeiling)
        .set({ allowed: snapshot.allowed, deletedAt: snapshot.deleted ? new Date() : null })
        .where(where);
  } finally {
    await handle.close();
  }
}
