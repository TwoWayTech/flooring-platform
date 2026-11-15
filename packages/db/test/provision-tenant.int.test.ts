import { randomBytes } from "node:crypto";
import {
  companyDatabaseName,
  MemoryEmailProvider,
  PostgresServerProvisioner,
  type DatabaseProvisioner,
} from "@workspace/providers";
import { v7 as uuidv7 } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationErrorCode, PRODUCT_ROLES } from "@workspace/shared";
import {
  alertMigrationFailure,
  decryptSecret,
  encryptSecret,
  migrateAllCompanies,
  migrateControl,
  MigrationStoppedError,
  openCompanyDb,
  openControlDb,
  productPermissions,
  provisionTenant,
  type CompanyMigrationFailure,
  type ControlDb,
  type NewCompany,
} from "../src";
import { auditLog, branches, rolePermissions, roles, userProfiles, userRoles } from "../src/company";
import {
  member,
  organization,
  platformAdmins,
  platformAuditLog,
  tenantBranding,
  tenantDatabases,
  tenantPermissionCeiling,
  tenantProducts,
  tenants,
  user,
} from "../src/control";
import { adminUrl, backdateStatusChange, scratchDatabase } from "../src/testing";

const encryptionKey = randomBytes(32).toString("base64");

/** Expects a query to be refused by the append-only trigger; Drizzle puts the database error in `cause`. */
async function expectRefused(query: PromiseLike<unknown>): Promise<void> {
  const error = await Promise.resolve(query).then(
    () => null,
    (failure: unknown) => failure,
  );
  const cause = (error as { cause?: { message?: string } } | null)?.cause?.message ?? "";
  expect(cause).toMatch(/append-only/);
}
/**
 * Makes one control write fail on purpose (ADR 0053 tests): a trigger function that raises, a
 * trigger refusing the `company.migration_failed` audit row, and one refusing to turn maintenance
 * on. Only on this file's scratch control database, and dropped in `finally`.
 */
const REFUSE_FUNCTION = sql.raw(
  "create or replace function test_refuse() returns trigger language plpgsql as $$ begin raise exception 'test: refused'; end $$",
);
const REFUSE_MIGRATION_AUDIT = sql.raw(
  "create trigger test_refuse_migration_audit before insert on platform_audit_log for each row when (new.action = 'company.migration_failed') execute function test_refuse()",
);
const REFUSE_MAINTENANCE = sql.raw(
  "create trigger test_refuse_maintenance before update on tenants for each row when (new.maintenance_mode and not old.maintenance_mode) execute function test_refuse()",
);

/** Drops the refusing triggers and their function, whichever of them exist. */
async function dropRefusals(db: ControlDb): Promise<void> {
  await db.execute(sql.raw("drop trigger if exists test_refuse_migration_audit on platform_audit_log"));
  await db.execute(sql.raw("drop trigger if exists test_refuse_maintenance on tenants"));
  await db.execute(sql.raw("drop function if exists test_refuse()"));
}

/** Runs a rollout that must fail, and returns the error and what `onFailure` was told. */
async function failedRollout(db: ControlDb, key: string) {
  const failures: CompanyMigrationFailure[] = [];
  const error = await migrateAllCompanies(db, key, {
    onFailure: async (failure) => {
      failures.push(failure);
    },
  }).then(
    () => null,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(MigrationStoppedError);
  return { error: error as MigrationStoppedError, failures };
}

/** Slugs unique to this run, so parallel or earlier runs never collide on the shared server. */
const run = `${process.pid}${randomBytes(2).toString("hex")}`.replace(/[^a-z0-9]/g, "");

function company(slug: string, overrides: Partial<NewCompany> = {}): NewCompany {
  return {
    slug,
    name: "Prairie Floors",
    legalName: "Prairie Floors LLC",
    state: "TX",
    timeZone: "America/Chicago",
    products: ["flooring"],
    owner: { name: "Pat Owner", email: `owner-${slug}@example.test` },
    ...overrides,
  };
}

describe("provisionTenant (P9, needs the local PostgreSQL)", () => {
  const provisioner = new PostgresServerProvisioner(adminUrl);
  const made: string[] = [];
  let control: { url: string; drop: () => Promise<void> };

  beforeAll(async () => {
    control = await scratchDatabase("provision_control");
    await migrateControl(control.url);
  }, 60_000);

  afterAll(async () => {
    for (const slug of made) await provisioner.drop(companyDatabaseName(slug));
    await control.drop();
  });

  /** Provisions through the real provisioner and remembers the database for clean-up. */
  async function provision(input: NewCompany, using: DatabaseProvisioner = provisioner) {
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const result = await provisionTenant(handle.db, using, encryptionKey, "postgres", input);
      made.push(input.slug);
      return result;
    } finally {
      await handle.close();
    }
  }

  it("creates the control rows and a migrated database of the company's own", async () => {
    const slug = `prairie${run}`;
    const result = await provision(company(slug));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const [tenant] = await handle.db.select().from(tenants).where(eq(tenants.id, result.tenantId));
      expect(tenant).toMatchObject({ slug, status: "trial", state: "TX" });
      expect(await handle.db.select().from(organization).where(eq(organization.id, result.tenantId))).toHaveLength(1);
      expect(
        await handle.db.select().from(tenantProducts).where(eq(tenantProducts.tenantId, result.tenantId)),
      ).toHaveLength(1);
      const [branding] = await handle.db
        .select()
        .from(tenantBranding)
        .where(eq(tenantBranding.tenantId, result.tenantId));
      expect(branding).toMatchObject({ displayName: "Prairie Floors", monogram: "PF", pattern: "herringbone" });
      const [owner] = await handle.db.select().from(user).where(eq(user.id, result.ownerUserId));
      expect(owner).toMatchObject({ email: `owner-${slug}@example.test`, emailVerified: false });
      const [membership] = await handle.db.select().from(member).where(eq(member.organizationId, result.tenantId));
      expect(membership).toMatchObject({ userId: result.ownerUserId, role: "owner" });
      const [database] = await handle.db
        .select()
        .from(tenantDatabases)
        .where(eq(tenantDatabases.tenantId, result.tenantId));
      expect(database.status).toBe("ready");
      expect(database.encryptedUrl).not.toContain("postgres://");
      const company = openCompanyDb(decryptSecret(database.encryptedUrl, encryptionKey), { max: 1 });
      try {
        expect(await company.db.select().from(branches)).toEqual([]);
      } finally {
        await company.close();
      }
    } finally {
      await handle.close();
    }
  });

  it("refuses a slug that is taken, reserved or not a valid name", async () => {
    const slug = `taken${run}`;
    await provision(company(slug));
    await expect(provision(company(slug))).rejects.toThrow(/already exists/);
    await expect(provision(company("www"))).rejects.toThrow(/reserved/);
    await expect(provision(company("Bad-Slug"))).rejects.toThrow(/Invalid slug/);
  });

  it("makes an existing account the owner only when asked to", async () => {
    const first = `first${run}`;
    await provision(company(first));
    const reused = company(`second${run}`, { owner: { name: "Pat Owner", email: `owner-${first}@example.test` } });
    await expect(provision(reused)).rejects.toThrow(/already has an account/);
    const result = await provision({ ...reused, reuseExistingOwner: true });
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const owners = await handle.db
        .select()
        .from(user)
        .where(eq(user.email, `owner-${first}@example.test`));
      expect(owners).toHaveLength(1);
      expect(owners[0].id).toBe(result.ownerUserId);
    } finally {
      await handle.close();
    }
  });

  it("refuses to finish an unfinished company for a different owner", async () => {
    const slug = `swap${run}`;
    const failing: DatabaseProvisioner = {
      create: () => Promise.reject(new Error("provider down")),
      drop: () => Promise.resolve(),
    };
    await expect(provision(company(slug), failing)).rejects.toThrow(/provider down/);
    const other = company(slug, { owner: { name: "Someone Else", email: `else-${slug}@example.test` } });
    await expect(provision(other)).rejects.toThrow(/different owner/);
    expect((await provision(company(slug))).resumed).toBe(true);
  });

  it("finishes a run that stopped after the control rows", async () => {
    const slug = `resume${run}`;
    const failing: DatabaseProvisioner = {
      create: () => Promise.reject(new Error("provider down")),
      drop: () => Promise.resolve(),
    };
    await expect(provision(company(slug), failing)).rejects.toThrow(/provider down/);
    const result = await provision(company(slug));
    expect(result.resumed).toBe(true);
    const handle = openControlDb(control.url, { max: 1 });
    try {
      expect(await handle.db.select().from(tenants).where(eq(tenants.slug, slug))).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  /** Opens the provisioned company database of a tenant, for checks behind the API. */
  async function companyOf(tenantId: string) {
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const [database] = await handle.db.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, tenantId));
      return openCompanyDb(decryptSecret(database.encryptedUrl, encryptionKey), { max: 1 });
    } finally {
      await handle.close();
    }
  }

  it("gives a new company its default roles, an owner with the Owner role, and a full ceiling (P10)", async () => {
    const result = await provision(company(`hrco${run}`, { products: ["hr"] }));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const ceiling = await handle.db
        .select({ key: tenantPermissionCeiling.permissionKey })
        .from(tenantPermissionCeiling)
        .where(eq(tenantPermissionCeiling.tenantId, result.tenantId));
      expect(ceiling.map((row) => row.key).sort()).toEqual([...productPermissions(["hr"])].sort());
    } finally {
      await handle.close();
    }
    const db = await companyOf(result.tenantId);
    try {
      const roleRows = await db.db.select().from(roles);
      expect(roleRows.map((row) => row.key).sort()).toEqual([...PRODUCT_ROLES.hr].sort());
      expect(roleRows.every((row) => row.system)).toBe(true);
      const allowed: ReadonlySet<string> = new Set(productPermissions(["hr"]));
      const held = await db.db.select({ key: rolePermissions.permissionKey }).from(rolePermissions);
      expect(held.every((row) => allowed.has(row.key))).toBe(true);
      const [profile] = await db.db.select().from(userProfiles).where(eq(userProfiles.userId, result.ownerUserId));
      expect(profile.status).toBe("invited");
      const [link] = await db.db
        .select({ key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, result.ownerUserId));
      expect(link.key).toBe("owner");
    } finally {
      await db.close();
    }
  });

  it("keeps audit_log append-only, even for the company login that owns the database (P10)", async () => {
    const result = await provision(company(`audit${run}`));
    const db = await companyOf(result.tenantId);
    try {
      const [row] = await db.db
        .insert(auditLog)
        .values({ category: "data", action: "Created", targetType: "test" })
        .returning();
      await expectRefused(db.db.update(auditLog).set({ action: "Changed" }).where(eq(auditLog.id, row.id)));
      await expectRefused(db.db.delete(auditLog).where(eq(auditLog.id, row.id)));
      await expectRefused(db.db.execute(sql`TRUNCATE audit_log`));
      expect(await db.db.select().from(auditLog)).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  it("finishes a company whose database never became ready, and refuses one that is ready", async () => {
    const slug = `unready${run}`;
    const first = await provision(company(slug));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      await handle.db
        .update(tenantDatabases)
        .set({ status: "provisioning" })
        .where(eq(tenantDatabases.tenantId, first.tenantId));
    } finally {
      await handle.close();
    }
    await expect(provision(company(slug, { products: ["hr"] }))).rejects.toThrow(/other products/);
    const again = await provision(company(slug));
    expect(again).toMatchObject({ tenantId: first.tenantId, resumed: true });
    await expect(provision(company(slug))).rejects.toThrow(/already exists/);
  });

  it("never resumes a live company that is migrating or whose migration failed (PR #8 review)", async () => {
    const slug = `live${run}`;
    const first = await provision(company(slug));
    for (const status of ["migrating", "failed", "read_only"] as const) {
      const handle = openControlDb(control.url, { max: 1 });
      try {
        await handle.db.update(tenantDatabases).set({ status }).where(eq(tenantDatabases.tenantId, first.tenantId));
      } finally {
        await handle.close();
      }
      await expect(provision(company(slug))).rejects.toThrow(/already exists/);
    }
  });

  it("leaves a provisioning database to provisioning and keeps a read-only one read-only in migrate-all (PR #8 review)", async () => {
    const unready = await provision(company(`skip${run}`));
    const readOnly = await provision(company(`keep${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const setStatus = (tenantId: string, status: "provisioning" | "read_only") =>
        handle.db.update(tenantDatabases).set({ status }).where(eq(tenantDatabases.tenantId, tenantId));
      await setStatus(unready.tenantId, "provisioning");
      await setStatus(readOnly.tenantId, "read_only");
      const results = await migrateAllCompanies(handle.db, encryptionKey);
      expect(results.map((result) => result.tenantId)).not.toContain(unready.tenantId);
      const statusOf = async (tenantId: string) =>
        (await handle.db.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, tenantId)))[0].status;
      expect(await statusOf(unready.tenantId)).toBe("provisioning");
      expect(await statusOf(readOnly.tenantId)).toBe("read_only");
    } finally {
      await handle.close();
    }
  });

  /**
   * Points a company's database at a wrong password with `status`, so its migration fails, and
   * returns how to put the URL back. The rollout stops at the first failing company in created_at
   * order, so every test that breaks one repairs it in `finally`.
   */
  async function breakDatabase(db: ControlDb, tenantId: string, status: "ready" | "read_only") {
    const [database] = await db.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, tenantId));
    const unreachable = decryptSecret(database.encryptedUrl, encryptionKey).replace(/:[^:@/]+@/, ":wrong-password@");
    await db
      .update(tenantDatabases)
      .set({ status, encryptedUrl: encryptSecret(unreachable, encryptionKey) })
      .where(eq(tenantDatabases.tenantId, tenantId));
    return {
      databaseId: database.id,
      restore: async () => {
        await db
          .update(tenantDatabases)
          .set({ encryptedUrl: database.encryptedUrl })
          .where(eq(tenantDatabases.tenantId, tenantId));
      },
    };
  }

  /** The platform audit rows of one company and action. */
  function logged(db: ControlDb, tenantId: string, action: string) {
    return db
      .select()
      .from(platformAuditLog)
      .where(and(eq(platformAuditLog.tenantId, tenantId), eq(platformAuditLog.action, action)));
  }

  async function tenantOf(db: ControlDb, tenantId: string) {
    return (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0];
  }

  async function databaseOf(db: ControlDb, tenantId: string) {
    return (await db.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, tenantId)))[0];
  }

  it("keeps a read-only database read-only when its migration fails, in maintenance until it recovers, with only the code in the audit row and the error (PR #8 review; owner decision 2026-11-13; ADR 0053)", async () => {
    const readOnly = await provision(company(`fail${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    const broken = await breakDatabase(handle.db, readOnly.tenantId, "read_only");
    try {
      const { error, failures } = await failedRollout(handle.db, encryptionKey);
      // The wrong password is refused with SQLSTATE 28P01 (invalid_password).
      expect(failures).toEqual([
        { tenantId: readOnly.tenantId, code: "28P01", recorded: true, maintenance: true, readOnly: true },
      ]);
      expect(migrationErrorCode(failures[0].code)).toBe(failures[0].code);
      const after = await databaseOf(handle.db, readOnly.tenantId);
      expect(after.status).toBe("read_only");
      const text = after.lastError ?? "";
      expect(text).not.toBe("");
      // The thrown error names the code, not the text, and keeps the original error as its cause.
      expect(error.message).toMatch(/Migration stopped/);
      expect(error.message).toContain("28P01");
      expect(error.message).not.toContain(text);
      expect(error.cause).toBeInstanceOf(Error);
      expect(text).toContain((error.cause as Error).message.slice(0, 100));
      expect(await tenantOf(handle.db, readOnly.tenantId)).toMatchObject({
        maintenanceMode: true,
        maintenanceReason: "migration_failed",
      });
      const [row, ...more] = await logged(handle.db, readOnly.tenantId, "company.migration_failed");
      expect(more).toEqual([]);
      expect(row).toMatchObject({ targetType: "tenant_database", targetId: broken.databaseId });
      expect(row.after).toEqual({ maintenanceMode: true, code: "28P01" });
      expect(JSON.stringify(row.after)).not.toContain(text);
      await broken.restore();
      await migrateAllCompanies(handle.db, encryptionKey);
      expect((await databaseOf(handle.db, readOnly.tenantId)).status).toBe("read_only");
      expect(await tenantOf(handle.db, readOnly.tenantId)).toMatchObject({
        maintenanceMode: false,
        maintenanceReason: null,
      });
      expect(await logged(handle.db, readOnly.tenantId, "company.migration_recovered")).toHaveLength(1);
    } finally {
      await broken.restore();
      await handle.close();
    }
  });

  it("falls back to maintenance mode when the failure can't be recorded (ADR 0053)", async () => {
    const target = await provision(company(`fback${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    const broken = await breakDatabase(handle.db, target.tenantId, "read_only");
    try {
      await handle.db.execute(REFUSE_FUNCTION);
      await handle.db.execute(REFUSE_MIGRATION_AUDIT);
      const { error, failures } = await failedRollout(handle.db, encryptionKey);
      // Not recorded, so the thrown error is the only place the migration's text is kept.
      expect(error.message).toContain((error.cause as Error).message.slice(0, 100));
      expect(error.message).not.toContain("test: refused");
      expect(failures).toEqual([
        { tenantId: target.tenantId, code: "28P01", recorded: false, maintenance: true, readOnly: true },
      ]);
      expect(await tenantOf(handle.db, target.tenantId)).toMatchObject({
        maintenanceMode: true,
        maintenanceReason: "migration_failed",
      });
      // The refused audit row rolled the whole transaction back, last_error included.
      expect(await databaseOf(handle.db, target.tenantId)).toMatchObject({ status: "read_only", lastError: null });
      expect(await logged(handle.db, target.tenantId, "company.migration_failed")).toEqual([]);
    } finally {
      await dropRefusals(handle.db);
      await broken.restore();
      await handle.db
        .update(tenants)
        .set({ maintenanceMode: false, maintenanceReason: null })
        .where(eq(tenants.id, target.tenantId));
      await handle.close();
    }
  });

  it("tells onFailure when neither the failure nor the fallback could be written (ADR 0053)", async () => {
    const target = await provision(company(`nowrite${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    const broken = await breakDatabase(handle.db, target.tenantId, "ready");
    try {
      await handle.db.execute(REFUSE_FUNCTION);
      await handle.db.execute(REFUSE_MIGRATION_AUDIT);
      await handle.db.execute(REFUSE_MAINTENANCE);
      const { failures } = await failedRollout(handle.db, encryptionKey);
      expect(failures).toEqual([
        { tenantId: target.tenantId, code: "28P01", recorded: false, maintenance: false, readOnly: false },
      ]);
      expect(await tenantOf(handle.db, target.tenantId)).toMatchObject({ maintenanceMode: false });
      // The claim stands, so nobody can open the company until a run gets through.
      expect(await databaseOf(handle.db, target.tenantId)).toMatchObject({ status: "migrating", lastError: null });
    } finally {
      await dropRefusals(handle.db);
      await broken.restore();
      await handle.db
        .update(tenantDatabases)
        .set({ status: "ready" })
        .where(eq(tenantDatabases.tenantId, target.tenantId));
      await handle.close();
    }
  });

  it("keeps a move's maintenance reason when a migration fails (ADR 0053)", async () => {
    const moving = await provision(company(`mvfail${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    const broken = await breakDatabase(handle.db, moving.tenantId, "ready");
    try {
      await handle.db
        .update(tenants)
        .set({ maintenanceMode: true, maintenanceReason: "move" })
        .where(eq(tenants.id, moving.tenantId));
      const { failures } = await failedRollout(handle.db, encryptionKey);
      expect(failures).toEqual([
        { tenantId: moving.tenantId, code: "28P01", recorded: true, maintenance: true, readOnly: false },
      ]);
      expect((await databaseOf(handle.db, moving.tenantId)).status).toBe("failed");
      expect(await tenantOf(handle.db, moving.tenantId)).toMatchObject({
        maintenanceMode: true,
        maintenanceReason: "move",
      });
      const [row] = await logged(handle.db, moving.tenantId, "company.migration_failed");
      expect(row.after).toEqual({ maintenanceMode: true, code: "28P01" });
      await broken.restore();
      await migrateAllCompanies(handle.db, encryptionKey);
      expect((await databaseOf(handle.db, moving.tenantId)).status).toBe("ready");
      expect(await tenantOf(handle.db, moving.tenantId)).toMatchObject({
        maintenanceMode: true,
        maintenanceReason: "move",
      });
      expect(await logged(handle.db, moving.tenantId, "company.migration_recovered")).toEqual([]);
    } finally {
      await broken.restore();
      await handle.db
        .update(tenants)
        .set({ maintenanceMode: false, maintenanceReason: null })
        .where(eq(tenants.id, moving.tenantId));
      await handle.close();
    }
  });

  it("keeps a move's maintenance mode after a successful migration (owner decision 2026-11-13)", async () => {
    const moving = await provision(company(`move${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      await handle.db
        .update(tenants)
        .set({ maintenanceMode: true, maintenanceReason: "move" })
        .where(eq(tenants.id, moving.tenantId));
      await migrateAllCompanies(handle.db, encryptionKey);
      const [after] = await handle.db.select().from(tenants).where(eq(tenants.id, moving.tenantId));
      expect(after).toMatchObject({ maintenanceMode: true, maintenanceReason: "move" });
    } finally {
      await handle.close();
    }
  });

  it("stamps status_changed_at on every status change and refuses any other write to it (control migration 0003)", async () => {
    const stamped = await provision(company(`stamp${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const old = new Date("2020-01-01T00:00:00Z");
      const read = async () => (await handle.db.select().from(tenants).where(eq(tenants.id, stamped.tenantId)))[0];
      await backdateStatusChange(handle.db, stamped.tenantId, old);
      await handle.db.update(tenants).set({ name: "Renamed" }).where(eq(tenants.id, stamped.tenantId));
      expect((await read()).statusChangedAt).toEqual(old);
      // A direct write, with or without the same status, cannot move the periods (PR #10 review).
      await handle.db
        .update(tenants)
        .set({ statusChangedAt: new Date(), status: (await read()).status })
        .where(eq(tenants.id, stamped.tenantId));
      expect((await read()).statusChangedAt).toEqual(old);
      await handle.db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, stamped.tenantId));
      expect((await read()).statusChangedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    } finally {
      await handle.close();
    }
  });

  it("emails every active platform admin with a known role, one email each, with only the code and where the company stands (owner decision 2026-11-13; ADR 0053)", async () => {
    const failed = await provision(company(`alrt${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const admins = [
        `admin-a-${run}@example.test`,
        `admin-b-${run}@example.test`,
        `admin-c-${run}@example.test`,
        `admin-d-${run}@example.test`,
      ];
      const ids: string[] = [];
      for (const [index, email] of admins.entries()) {
        const id = uuidv7();
        ids.push(id);
        await handle.db.insert(user).values({ id, name: "Platform Admin", email });
        await handle.db
          .insert(platformAdmins)
          .values({ userId: id, role: index === 0 ? "owner" : "support", active: index !== 2 });
      }
      // An active row with a role the console doesn't accept is no admin, so it gets no alert. The
      // column is free text, so the test writes the unknown role with plain SQL.
      await handle.db.execute(sql`update platform_admins set role = 'billing' where user_id = ${ids[3]}`);
      const alert = async (standing: Pick<CompanyMigrationFailure, "recorded" | "maintenance" | "readOnly">) => {
        const email = new MemoryEmailProvider();
        const count = await alertMigrationFailure(handle.db, email, "alerts@example.test", {
          tenantId: failed.tenantId,
          code: "42P01",
          ...standing,
        });
        return { count, sent: email.sent.filter((message) => message.subject.includes(`alrt${run}`)) };
      };
      const { count, sent } = await alert({ recorded: true, maintenance: true, readOnly: false });
      expect(count).toBeGreaterThanOrEqual(2);
      expect(sent.map((message) => message.to)).toEqual(expect.arrayContaining([[admins[0]], [admins[1]]]));
      expect(sent.flatMap((message) => message.to)).not.toContain(admins[2]);
      expect(sent.flatMap((message) => message.to)).not.toContain(admins[3]);
      expect(sent[0].subject).toMatch(/is in maintenance mode$/);
      expect(sent[0].text).toContain("42P01");
      expect(sent[0].text).toContain("tenant_databases.last_error");
      expect(sent[0].text).not.toContain("platform_audit_log");
      const servingReads = (await alert({ recorded: false, maintenance: false, readOnly: true })).sent[0];
      expect(servingReads.subject).toMatch(/is NOT in maintenance mode$/);
      expect(servingReads.text).toContain("may still read a half-updated database");
      expect(servingReads.text).toContain("Turn maintenance mode on by hand");
      expect(servingReads.text).toContain("only in the output of pnpm db:migrate");
      expect(servingReads.text).not.toContain("platform_audit_log");
      const unavailable = (await alert({ recorded: true, maintenance: false, readOnly: false })).sent[0];
      expect(unavailable.subject).toMatch(/is NOT in maintenance mode$/);
      expect(unavailable.text).toContain("can't open the company");
      expect(unavailable.text).toContain("Turn maintenance mode on by hand");
      expect(unavailable.text).toContain("tenant_databases.last_error");
    } finally {
      await handle.close();
    }
  });
});
