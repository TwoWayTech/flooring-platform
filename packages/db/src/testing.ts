import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { decodeMemberRoles, type CompanyId, type ProductKey } from "@workspace/shared";
import { openControlDb, type ControlDb } from "./client";
import {
  account,
  authAttempts,
  member,
  passkey,
  planLimits,
  planModules,
  platformAdmins,
  plans,
  rateLimit,
  session,
  supportAccessGrants,
  tenantDatabases,
  tenantPermissionCeiling,
  tenantSubscriptions,
  tenants,
  twoFactor,
  user,
  userInvitations,
} from "./control";
import { provisionTenant, type ProvisionedTenant } from "./provision-tenant";
import { loadDemoCompany } from "./seed/fixtures";
import { companyDatabaseName, PostgresServerProvisioner } from "@workspace/providers";

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

/** The one company the standing helpers may change: the seeded Summit Floor Co. (ADR 0054, safest option 17). */
const STANDING_TEST_SLUG = "summit";

/**
 * Throws unless the slug is the seeded Summit's, so a standing helper never changes a real
 * company's maintenance flag, periods or support grants (ADR 0054, safest option 17). An unknown company
 * (no slug) is refused too.
 */
function refuseOtherCompanies(helper: string, slug: string | undefined): void {
  if (slug !== STANDING_TEST_SLUG) {
    throw new Error(`${helper} only touches the seeded company with the slug ${STANDING_TEST_SLUG}.`);
  }
}

async function tenantIdOf(db: ControlDb, slug: string): Promise<string> {
  const [found] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
  if (!found) throw new Error(`No company with the slug ${slug}.`);
  return found.id;
}

/**
 * Reads the facts company standing is made of (maintenance flag and the live rows' period dates),
 * so a test can put them back. Tests only: it refuses any slug but `summit`.
 */
export async function readStandingFacts(controlUrl: string, slug: string): Promise<StandingSnapshot> {
  refuseOtherCompanies("readStandingFacts", slug);
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
 * status, so `status_changed_at` and its trigger are untouched. Tests only: it refuses a snapshot
 * of any company but Summit, and changes only that company's rows.
 */
export async function restoreStandingFacts(controlUrl: string, snapshot: StandingSnapshot): Promise<void> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [owner] = await handle.db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, snapshot.tenantId));
    refuseOtherCompanies("restoreStandingFacts", owner?.slug);
    await handle.db.transaction(async (tx) => {
      await tx
        .update(tenants)
        .set({ maintenanceMode: snapshot.maintenanceMode, maintenanceReason: snapshot.maintenanceReason })
        .where(eq(tenants.id, snapshot.tenantId));
      for (const row of snapshot.subscriptions) {
        await tx
          .update(tenantSubscriptions)
          .set({ currentPeriodStart: row.currentPeriodStart, currentPeriodEnd: row.currentPeriodEnd })
          .where(and(eq(tenantSubscriptions.id, row.id), eq(tenantSubscriptions.tenantId, snapshot.tenantId)));
      }
    });
  } finally {
    await handle.close();
  }
}

/** Turns maintenance on for a company with the reason `move`, or off with null. Tests only: it refuses any slug but `summit`. */
export async function setMaintenance(controlUrl: string, slug: string, reason: "move" | null): Promise<void> {
  refuseOtherCompanies("setMaintenance", slug);
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
 * reaches payment overdue, read only or locked by moving the end. Tests only: it refuses any slug but `summit`.
 */
export async function setPeriodEnd(controlUrl: string, slug: string, end: Date): Promise<void> {
  refuseOtherCompanies("setPeriodEnd", slug);
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
 * would be. Returns the grant's id. Tests only: it refuses any slug but `summit`.
 */
export async function insertSupportGrant(
  controlUrl: string,
  input: { slug: string; reason: string; hours: number },
): Promise<string> {
  refuseOtherCompanies("insertSupportGrant", input.slug);
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
  refuseOtherCompanies("clearTestStanding", slug);
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

/** What a test needs to know about a company's status: the stored text and when it last changed. */
export interface StatusFacts {
  tenantId: string;
  status: string;
  statusChangedAt: Date;
}

/**
 * Reads a company's stored status and its `status_changed_at`, and changes nothing. Tests only: it
 * refuses any slug but `summit` (docs/specs/platform-admin.md, part 2).
 */
export async function readStatusFacts(controlUrl: string, slug: string): Promise<StatusFacts> {
  refuseOtherCompanies("readStatusFacts", slug);
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [row] = await handle.db
      .select({ tenantId: tenants.id, status: tenants.status, statusChangedAt: tenants.statusChangedAt })
      .from(tenants)
      .where(eq(tenants.slug, slug));
    if (!row) throw new Error(`No company with the slug ${slug}.`);
    return row;
  } finally {
    await handle.close();
  }
}

/**
 * Puts the seeded Summit Floor Co. back in use after a run that crashed between a suspend or a
 * cancel and its reinstate: a `suspended` or `cancelled` status becomes `active` by a plain update
 * (the control trigger stamps `status_changed_at` itself and stays on), and `trial`, `active` and
 * `past_due` are left alone. It never touches a subscription row, refuses any other slug and
 * returns what it changed. Tests only.
 */
export async function clearTestStatus(controlUrl: string, slug: string): Promise<string[]> {
  refuseOtherCompanies("clearTestStatus", slug);
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [row] = await handle.db
      .select({ id: tenants.id, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.slug, slug));
    if (!row) throw new Error(`No company with the slug ${slug}.`);
    if (row.status !== "suspended" && row.status !== "cancelled") return [];
    await handle.db.update(tenants).set({ status: "active" }).where(eq(tenants.id, row.id));
    return [`status ${row.status} set back to active`];
  } finally {
    await handle.close();
  }
}

/** The key prefix of every plan a browser test creates; `removeTestPlans` touches no other key. */
const TEST_PLAN_KEY_PREFIX = "e2e-";

/**
 * Hard-deletes the plans a browser test created (keys starting `e2e-`) with their module and
 * limit rows, in one transaction. A plan that any subscription row names, deleted rows included,
 * is never removed: the call throws first and removes nothing. The audit rows stay (the log is
 * append-only). Returns the keys removed. Tests only.
 */
export async function removeTestPlans(controlUrl: string): Promise<string[]> {
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    return await handle.db.transaction(async (tx) => {
      const found = await tx
        .select({ id: plans.id, key: plans.key })
        .from(plans)
        .where(like(plans.key, `${TEST_PLAN_KEY_PREFIX}%`));
      if (found.length === 0) return [];
      const ids = found.map((plan) => plan.id);
      const used = await tx
        .select({ planId: tenantSubscriptions.planId })
        .from(tenantSubscriptions)
        .where(inArray(tenantSubscriptions.planId, ids));
      if (used.length > 0) {
        const keys = found.filter((plan) => used.some((row) => row.planId === plan.id)).map((plan) => plan.key);
        throw new Error(`A test plan is named by a subscription and is not removed: ${keys.join(", ")}.`);
      }
      await tx.delete(planLimits).where(inArray(planLimits.planId, ids));
      await tx.delete(planModules).where(inArray(planModules.planId, ids));
      await tx.delete(plans).where(inArray(plans.id, ids));
      return found.map((plan) => plan.key);
    });
  } finally {
    await handle.close();
  }
}

/** The slug of every fresh test company: `e2efresh` and 6 to 12 lowercase letters or digits. Tests only. */
export const FRESH_SLUG = /^e2efresh[a-z0-9]{6,12}$/;

/** The Owner's email of a fresh test company, on a reserved example domain no real person uses. Tests only. */
export const FRESH_EMAIL = /^owner\.[a-z0-9]+@fresh\.e2e\.example$/;

/** How long an invitation link works: the product's 7 days (`INVITATION_DAYS` in apps/api invitation-rules.ts). */
const TEST_INVITATION_DAYS = 7;

/**
 * The youngest company a sweep may retire. A sweep is a clean-up of runs that were killed, so a
 * shorter threshold could retire the company of a run still going on the same database.
 */
const MIN_SWEEP_AGE_MS = 10 * 60_000;

/** The hosts a fresh-company helper may reach: this machine only. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

/** Every demo company, so the helpers can refuse each one's slug and people (compile-time complete). */
const DEMO_COMPANIES: Record<CompanyId, true> = { summit: true, keystone: true, harbor: true };

/**
 * The local server a fresh test company lives on, always given by the caller and never read from
 * the environment, so no helper falls back to a default database. Tests only.
 */
export interface FreshTestServer {
  /** The control database the API under test uses. */
  controlUrl: string;
  /** A superuser login on the same local server, used only to create and drop the company's database. */
  adminUrl: string;
  /** The CONNECTION_ENCRYPTION_KEY the API under test decrypts company database URLs with. */
  encryptionKey: string;
}

/** What a fresh test company is made with. */
export interface FreshTestCompany {
  /** Matches FRESH_SLUG. */
  slug: string;
  /** Matches FRESH_EMAIL. */
  ownerEmail: string;
  products: readonly ProductKey[];
}

/** The invented name, place and Owner of every fresh test company; the Denver zone matches the e2e browser. */
const FRESH_COMPANY = {
  name: "Fresh Test Floors",
  legalName: "Fresh Test Floors LLC",
  state: "CO",
  city: "Denver",
  timeZone: "America/Denver",
  ownerName: "Avery Fresh",
} as const;

let demoNames: { slugs: ReadonlySet<string>; emails: ReadonlySet<string> } | undefined;

/** The demo companies' slugs and their people's emails, read once from the fixtures the seed writes from. */
function demoCompanyNames(): { slugs: ReadonlySet<string>; emails: ReadonlySet<string> } {
  if (!demoNames) {
    const ids = Object.keys(DEMO_COMPANIES) as CompanyId[];
    const emails = ids.flatMap((id) => loadDemoCompany(id).fixtures.users.map((person) => person.email.toLowerCase()));
    demoNames = { slugs: new Set(ids), emails: new Set(emails) };
  }
  return demoNames;
}

/**
 * Throws unless a database URL is on this machine. The URL itself is never put in the message,
 * because it holds a password. A `host` or `hostaddr` option would override the URL's host, so
 * either one is refused too.
 */
function refuseRemoteDatabase(helper: string, label: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${helper}: ${label} is not a database URL.`);
  }
  const overridden = [...parsed.searchParams.keys()].some((key) => key === "host" || key === "hostaddr");
  if (!LOCAL_HOSTS.has(parsed.hostname) || overridden) {
    throw new Error(`${helper} only works on a database on this machine (localhost or 127.0.0.1); ${label} is not.`);
  }
}

/**
 * The guard every fresh-company helper runs before it connects anywhere: plain PostgreSQL only
 * (DB_PROVIDER unset or `postgres`), every URL on this machine, a slug and an Owner email that
 * match the fresh patterns, and never a demo company or one of its people. Tests only.
 */
function refuseUnsafeFresh(
  helper: string,
  input: { urls: Record<string, string>; slug?: string; email?: string },
): void {
  const provider = process.env.DB_PROVIDER;
  if (provider && provider !== "postgres") {
    throw new Error(`${helper} only works with DB_PROVIDER unset or postgres.`);
  }
  for (const [label, url] of Object.entries(input.urls)) refuseRemoteDatabase(helper, label, url);
  if (input.slug !== undefined) {
    if (demoCompanyNames().slugs.has(input.slug)) {
      throw new Error(`${helper} never touches the demo company ${input.slug}.`);
    }
    if (!FRESH_SLUG.test(input.slug)) throw new Error(`${helper} only touches companies whose slug matches e2efresh….`);
  }
  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (demoCompanyNames().emails.has(email)) throw new Error(`${helper} never touches a seeded user.`);
    if (!FRESH_EMAIL.test(email))
      throw new Error(`${helper} only takes an Owner email like owner.<run>@fresh.e2e.example.`);
  }
}

/** The SHA-256 of an invitation token, as `user_invitations.token_hash` stores it (`tokenHash` in apps/api invitation-rules.ts). */
function invitationTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Provisions a fresh test company the real way (`provisionTenant` with the local server's
 * provisioner), as the provisioning script would, with the invented "Fresh Test Floors" and its
 * Owner "Avery Fresh". Like provisioning today, the Owner gets no password and no invitation (gap
 * G4): `inviteTestOwner` stands in for the missing invitation. It never migrates the control
 * database. Tests only: it refuses any slug, email, host or provider the fresh guard refuses.
 */
export async function provisionTestCompany(
  server: FreshTestServer,
  company: FreshTestCompany,
): Promise<ProvisionedTenant> {
  refuseUnsafeFresh("provisionTestCompany", {
    urls: { controlUrl: server.controlUrl, adminUrl: server.adminUrl },
    slug: company.slug,
    email: company.ownerEmail,
  });
  if (!server.encryptionKey) throw new Error("provisionTestCompany needs the API's encryption key.");
  const handle = openControlDb(server.controlUrl, { max: 1 });
  try {
    return await provisionTenant(
      handle.db,
      new PostgresServerProvisioner(server.adminUrl),
      server.encryptionKey,
      "postgres",
      {
        slug: company.slug,
        name: FRESH_COMPANY.name,
        legalName: FRESH_COMPANY.legalName,
        state: FRESH_COMPANY.state,
        city: FRESH_COMPANY.city,
        timeZone: FRESH_COMPANY.timeZone,
        products: company.products,
        owner: { name: FRESH_COMPANY.ownerName, email: company.ownerEmail },
      },
    );
  } finally {
    await handle.close();
  }
}

/**
 * The user id of a fresh test company's Owner. Throws unless the company has exactly one Owner,
 * whose email matches FRESH_EMAIL and who belongs to no other company, so a helper never acts on
 * anyone outside the run that made the company.
 */
async function freshOwner(helper: string, db: ControlDb, tenantId: string): Promise<{ userId: string }> {
  const people = await db
    .select({ userId: member.userId, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, tenantId));
  const owners = people.filter((person) => decodeMemberRoles(person.role).includes("owner"));
  if (owners.length !== 1) throw new Error(`${helper}: a fresh test company has exactly one Owner; this one does not.`);
  const [owner] = owners;
  refuseUnsafeFresh(helper, { urls: {}, email: owner.email });
  const elsewhere = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, owner.userId), ne(member.organizationId, tenantId)));
  if (elsewhere.length > 0)
    throw new Error(`${helper}: the fresh Owner belongs to another company; nothing was changed.`);
  return { userId: owner.userId };
}

/**
 * Inserts the invitation that provisioning should send a fresh company's Owner and doesn't yet
 * (gap G4; STATUS: "owner invitations at provisioning come with the platform-admin screens (P17)"):
 * one `user_invitations` row holding only the token's SHA-256, valid for the product's 7 days, as
 * `UsersService.invite` writes one. Returns the token for the accept link; it is never logged.
 * The Owner then sets a password through the product's own accept page, so no helper writes a
 * credential. Refuses when an open invitation exists. Tests only.
 */
export async function inviteTestOwner(controlUrl: string, slug: string): Promise<string> {
  refuseUnsafeFresh("inviteTestOwner", { urls: { controlUrl }, slug });
  const handle = openControlDb(controlUrl, { max: 1 });
  try {
    const [company] = await handle.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)));
    if (!company) throw new Error(`No live fresh company ${slug}.`);
    const owner = await freshOwner("inviteTestOwner", handle.db, company.id);
    const open = await handle.db
      .select({ id: userInvitations.id })
      .from(userInvitations)
      .where(
        and(
          eq(userInvitations.tenantId, company.id),
          eq(userInvitations.userId, owner.userId),
          isNull(userInvitations.acceptedAt),
          isNull(userInvitations.revokedAt),
        ),
      );
    if (open.length > 0) throw new Error("The fresh Owner already has an open invitation.");
    const token = randomBytes(32).toString("base64url");
    await handle.db.insert(userInvitations).values({
      tenantId: company.id,
      userId: owner.userId,
      tokenHash: invitationTokenHash(token),
      expiresAt: new Date(Date.now() + TEST_INVITATION_DAYS * 86_400_000),
      createdBy: owner.userId,
    });
    return token;
  } finally {
    await handle.close();
  }
}

/**
 * Retires a fresh test company so the shared e2e database stays usable: in one control
 * transaction it sets `tenant_databases.deleted_at` (the only column `migrateAllCompanies` reads,
 * so `pnpm db:migrate` skips the company) and `tenants.deleted_at`, revokes open invitations, and
 * removes the Owner's session, two_factor, passkey and credential account rows; then it drops the
 * company's database. User and member rows stay, because audit rows name them. Safe to run again,
 * and a slug with no company only has its database dropped if there is one. Tests only.
 */
export async function retireTestCompany(
  server: Pick<FreshTestServer, "controlUrl" | "adminUrl">,
  slug: string,
): Promise<void> {
  refuseUnsafeFresh("retireTestCompany", { urls: { controlUrl: server.controlUrl, adminUrl: server.adminUrl }, slug });
  const handle = openControlDb(server.controlUrl, { max: 1 });
  try {
    await handle.db.transaction(async (tx) => {
      const [company] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
      if (!company) return;
      const owner = await freshOwner("retireTestCompany", tx, company.id);
      const now = new Date();
      await tx
        .update(tenantDatabases)
        .set({ deletedAt: now })
        .where(and(eq(tenantDatabases.tenantId, company.id), isNull(tenantDatabases.deletedAt)));
      await tx
        .update(tenants)
        .set({ deletedAt: now })
        .where(and(eq(tenants.id, company.id), isNull(tenants.deletedAt)));
      await tx
        .update(userInvitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(userInvitations.tenantId, company.id),
            isNull(userInvitations.acceptedAt),
            isNull(userInvitations.revokedAt),
          ),
        );
      await tx.delete(session).where(eq(session.userId, owner.userId));
      await tx.delete(twoFactor).where(eq(twoFactor.userId, owner.userId));
      await tx.delete(passkey).where(eq(passkey.userId, owner.userId));
      await tx.delete(account).where(and(eq(account.userId, owner.userId), eq(account.providerId, "credential")));
    });
  } finally {
    await handle.close();
  }
  await new PostgresServerProvisioner(server.adminUrl).drop(companyDatabaseName(slug));
}

/**
 * Retires every fresh test company older than `olderThanMs` that is still live in either
 * `tenants` or `tenant_databases`: the leftovers of runs that were killed before their own
 * clean-up. Slugs that start with `e2efresh` but don't match FRESH_SLUG were not made by these
 * helpers and are left alone. Refuses a threshold under 10 minutes, so it never retires a company a
 * run on the same database is still using. Returns the slugs retired. Tests only.
 */
export async function sweepTestCompanies(
  server: Pick<FreshTestServer, "controlUrl" | "adminUrl">,
  olderThanMs: number,
): Promise<string[]> {
  refuseUnsafeFresh("sweepTestCompanies", { urls: { controlUrl: server.controlUrl, adminUrl: server.adminUrl } });
  if (!(olderThanMs >= MIN_SWEEP_AGE_MS))
    throw new Error("sweepTestCompanies needs a threshold of 10 minutes or more.");
  const handle = openControlDb(server.controlUrl, { max: 1 });
  let rows: { slug: string }[];
  try {
    rows = await handle.db
      .select({ slug: tenants.slug })
      .from(tenants)
      .leftJoin(tenantDatabases, eq(tenantDatabases.tenantId, tenants.id))
      .where(
        and(
          like(tenants.slug, "e2efresh%"),
          lt(tenants.createdAt, new Date(Date.now() - olderThanMs)),
          or(isNull(tenants.deletedAt), and(isNotNull(tenantDatabases.id), isNull(tenantDatabases.deletedAt))),
        ),
      );
  } finally {
    await handle.close();
  }
  const slugs = [...new Set(rows.map((row) => row.slug))].filter((slug) => FRESH_SLUG.test(slug)).sort();
  for (const slug of slugs) await retireTestCompany(server, slug);
  return slugs;
}
