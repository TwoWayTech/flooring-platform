import { eq, inArray, sql } from "drizzle-orm";
import { openControlDb, type ControlDb } from "./client";
import { authAttempts, passkey, rateLimit, session, tenants, twoFactor, user } from "./control";
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
