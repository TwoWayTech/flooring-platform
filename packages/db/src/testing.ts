import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { openControlDb, type ControlDb } from "./client";
import {
  authAttempts,
  passkey,
  platformAdmins,
  rateLimit,
  session,
  supportAccessGrants,
  tenantPermissionCeiling,
  tenantSubscriptions,
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

/** The address and name of the test-only support requester, which can never sign in. */
const TEST_SUPPORT_AGENT = { email: "support-agent@e2e.invalid", name: "Test Support Agent" } as const;

/** What a test needs to put a company's standing facts back: its maintenance flag and period dates. */
export interface StandingSnapshot {
  tenantId: string;
  maintenanceMode: boolean;
  maintenanceReason: "migration_failed" | "move" | null;
  /** The company's live subscription rows, by id. */
  subscriptions: { id: string; currentPeriodStart: Date; currentPeriodEnd: Date }[];
}

async function tenantIdOf(db: ControlDb, slug: string): Promise<string> {
  const [found] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
  if (!found) throw new Error(`No company with the slug ${slug}.`);
  return found.id;
}

/**
 * Reads the facts company standing is made of (maintenance flag and the live rows' period dates),
 * so a test can put them back. Tests only: never point it at a real company.
 */
export async function readStandingFacts(controlUrl: string, slug: string): Promise<StandingSnapshot> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const tenantId = await tenantIdOf(handle.db, slug);
    const [tenant] = await handle.db
      .select({ mode: tenants.maintenanceMode, reason: tenants.maintenanceReason })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const rows = await handle.db
      .select({
        id: tenantSubscriptions.id,
        currentPeriodStart: tenantSubscriptions.currentPeriodStart,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      })
      .from(tenantSubscriptions)
      .where(and(eq(tenantSubscriptions.tenantId, tenantId), isNull(tenantSubscriptions.deletedAt)))
      .orderBy(asc(tenantSubscriptions.id));
    return {
      tenantId,
      maintenanceMode: tenant.mode,
      maintenanceReason: tenant.reason ?? null,
      subscriptions: rows,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Puts the facts of `readStandingFacts` back in one transaction. It never changes the company's
 * status, so `status_changed_at` and its trigger are untouched. Tests only: never point it at a real company.
 */
export async function restoreStandingFacts(controlUrl: string, snapshot: StandingSnapshot): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    await handle.db.transaction(async (tx) => {
      await tx
        .update(tenants)
        .set({ maintenanceMode: snapshot.maintenanceMode, maintenanceReason: snapshot.maintenanceReason })
        .where(eq(tenants.id, snapshot.tenantId));
      for (const row of snapshot.subscriptions) {
        await tx
          .update(tenantSubscriptions)
          .set({ currentPeriodStart: row.currentPeriodStart, currentPeriodEnd: row.currentPeriodEnd })
          .where(eq(tenantSubscriptions.id, row.id));
      }
    });
  } finally {
    await handle.close();
  }
}

/** Turns maintenance on for a company with the reason `move`, or off with null. Tests only: never point it at a real company. */
export async function setMaintenance(controlUrl: string, slug: string, reason: "move" | null): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const tenantId = await tenantIdOf(handle.db, slug);
    await handle.db
      .update(tenants)
      .set({ maintenanceMode: reason !== null, maintenanceReason: reason })
      .where(eq(tenants.id, tenantId));
  } finally {
    await handle.close();
  }
}

/**
 * Gives every live subscription row of a company a period of 30 days ending at `end`, so a test
 * reaches payment overdue, read only or locked by moving the end. Tests only: never point it at a real company.
 */
export async function setPeriodEnd(controlUrl: string, slug: string, end: Date): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const tenantId = await tenantIdOf(handle.db, slug);
    await handle.db
      .update(tenantSubscriptions)
      .set({ currentPeriodEnd: end, currentPeriodStart: new Date(end.getTime() - 30 * 86_400_000) })
      .where(and(eq(tenantSubscriptions.tenantId, tenantId), isNull(tenantSubscriptions.deletedAt)));
  } finally {
    await handle.close();
  }
}

/**
 * Upserts the test-only support requester: a control user with no account or password and an
 * unverified email on a reserved domain, so it can never sign in. Returns its id. Tests only: never
 * point it at a real company.
 */
export async function ensureTestSupportAgent(controlUrl: string): Promise<string> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [row] = await handle.db
      .insert(user)
      .values({ ...TEST_SUPPORT_AGENT, emailVerified: false })
      .onConflictDoUpdate({ target: user.email, set: { name: TEST_SUPPORT_AGENT.name, emailVerified: false } })
      .returning({ id: user.id });
    return row.id;
  } finally {
    await handle.close();
  }
}

/**
 * Inserts a pending support request by the test agent for a company, as a platform admin's request
 * would be. Returns the grant's id. Tests only: never point it at a real company.
 */
export async function insertSupportGrant(
  controlUrl: string,
  input: { slug: string; reason: string; hours: number },
): Promise<string> {
  const agentId = await ensureTestSupportAgent(controlUrl);
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const tenantId = await tenantIdOf(handle.db, input.slug);
    const [row] = await handle.db
      .insert(supportAccessGrants)
      .values({
        tenantId,
        adminUserId: agentId,
        reason: input.reason,
        expiresAt: new Date(Date.now() + input.hours * 3_600_000),
        createdBy: agentId,
      })
      .returning({ id: supportAccessGrants.id });
    return row.id;
  } finally {
    await handle.close();
  }
}

/** Deletes the test agent's grants and then the agent, e.g. after a run that crashed. Tests only. */
export async function removeTestSupportAgent(controlUrl: string): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [found] = await handle.db.select({ id: user.id }).from(user).where(eq(user.email, TEST_SUPPORT_AGENT.email));
    if (!found) return;
    await handle.db.delete(supportAccessGrants).where(eq(supportAccessGrants.adminUserId, found.id));
    await handle.db.delete(user).where(eq(user.id, found.id));
  } finally {
    await handle.close();
  }
}

/**
 * Puts the seeded Summit Floor Co. back in full use after a run that crashed or a stale seed: it
 * refuses any other slug, only moves toward full use, and returns what it changed. Maintenance goes
 * off only when its reason is `move`; when every live row has ended, those rows get a period of
 * 30 days starting now, the seed's own shape. Tests only.
 */
export async function clearTestStanding(controlUrl: string, slug: string): Promise<string[]> {
  if (slug !== "summit") throw new Error("clearTestStanding only touches the seeded company with the slug summit.");
  const changed: string[] = [];
  const snapshot = await readStandingFacts(controlUrl, slug);
  if (snapshot.maintenanceMode && snapshot.maintenanceReason === "move") {
    await setMaintenance(controlUrl, slug, null);
    changed.push("maintenance turned off");
  }
  const now = Date.now();
  const rows = snapshot.subscriptions;
  if (rows.length > 0 && rows.every((row) => row.currentPeriodEnd.getTime() <= now)) {
    const handle = openControlDb(controlUrl, { max: 1 });
    try {
      await handle.db
        .update(tenantSubscriptions)
        .set({ currentPeriodStart: new Date(now), currentPeriodEnd: new Date(now + 30 * 86_400_000) })
        .where(
          inArray(
            tenantSubscriptions.id,
            rows.map((row) => row.id),
          ),
        );
    } finally {
      await handle.close();
    }
    changed.push(`${rows.length} ended subscription row(s) given a new 30-day period`);
  }
  return changed;
}
