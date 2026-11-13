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
import { PRODUCT_ROLES } from "@workspace/shared";
import {
  alertMigrationFailure,
  decryptSecret,
  encryptSecret,
  migrateAllCompanies,
  migrateControl,
  openCompanyDb,
  openControlDb,
  productPermissions,
  provisionTenant,
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
import { adminUrl, scratchDatabase } from "../src/testing";

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

  it("keeps a read-only database read-only when its migration fails, in maintenance until it recovers (PR #8 review; owner decision 2026-11-13)", async () => {
    const readOnly = await provision(company(`fail${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const [database] = await handle.db
        .select()
        .from(tenantDatabases)
        .where(eq(tenantDatabases.tenantId, readOnly.tenantId));
      const unreachable = decryptSecret(database.encryptedUrl, encryptionKey).replace(/:[^:@/]+@/, ":wrong-password@");
      await handle.db
        .update(tenantDatabases)
        .set({ status: "read_only", encryptedUrl: encryptSecret(unreachable, encryptionKey) })
        .where(eq(tenantDatabases.tenantId, readOnly.tenantId));
      const failures: string[] = [];
      await expect(
        migrateAllCompanies(handle.db, encryptionKey, {
          onFailure: async (failure) => {
            failures.push(failure.tenantId);
          },
        }),
      ).rejects.toThrow(/Migration stopped/);
      expect(failures).toEqual([readOnly.tenantId]);
      const [after] = await handle.db
        .select()
        .from(tenantDatabases)
        .where(eq(tenantDatabases.tenantId, readOnly.tenantId));
      expect(after.status).toBe("read_only");
      expect(after.lastError).not.toBeNull();
      const tenantOf = async () => (await handle.db.select().from(tenants).where(eq(tenants.id, readOnly.tenantId)))[0];
      expect(await tenantOf()).toMatchObject({ maintenanceMode: true, maintenanceReason: "migration_failed" });
      const logged = (action: string) =>
        handle.db
          .select()
          .from(platformAuditLog)
          .where(and(eq(platformAuditLog.tenantId, readOnly.tenantId), eq(platformAuditLog.action, action)));
      expect(await logged("company.migration_failed")).toHaveLength(1);
      await handle.db
        .update(tenantDatabases)
        .set({ encryptedUrl: database.encryptedUrl })
        .where(eq(tenantDatabases.tenantId, readOnly.tenantId));
      await migrateAllCompanies(handle.db, encryptionKey);
      const [retried] = await handle.db
        .select()
        .from(tenantDatabases)
        .where(eq(tenantDatabases.tenantId, readOnly.tenantId));
      expect(retried.status).toBe("read_only");
      expect(await tenantOf()).toMatchObject({ maintenanceMode: false, maintenanceReason: null });
      expect(await logged("company.migration_recovered")).toHaveLength(1);
    } finally {
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

  it("stamps status_changed_at whenever the status changes, whoever writes it (control migration 0003)", async () => {
    const stamped = await provision(company(`stamp${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const old = new Date("2020-01-01T00:00:00Z");
      const read = async () => (await handle.db.select().from(tenants).where(eq(tenants.id, stamped.tenantId)))[0];
      await handle.db.update(tenants).set({ statusChangedAt: old }).where(eq(tenants.id, stamped.tenantId));
      await handle.db.update(tenants).set({ name: "Renamed" }).where(eq(tenants.id, stamped.tenantId));
      expect((await read()).statusChangedAt).toEqual(old);
      await handle.db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, stamped.tenantId));
      expect((await read()).statusChangedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    } finally {
      await handle.close();
    }
  });

  it("emails every active platform admin, one email each, when a migration fails (owner decision 2026-11-13)", async () => {
    const failed = await provision(company(`alrt${run}`));
    const handle = openControlDb(control.url, { max: 1 });
    try {
      const admins = [`admin-a-${run}@example.test`, `admin-b-${run}@example.test`, `admin-c-${run}@example.test`];
      for (const [index, email] of admins.entries()) {
        const id = uuidv7();
        await handle.db.insert(user).values({ id, name: "Platform Admin", email });
        await handle.db.insert(platformAdmins).values({ userId: id, role: "support", active: index < 2 });
      }
      const email = new MemoryEmailProvider();
      const count = await alertMigrationFailure(handle.db, email, "alerts@example.test", {
        tenantId: failed.tenantId,
        error: "relation does not exist",
      });
      const sent = email.sent.filter((message) => message.subject.includes(`alrt${run}`));
      expect(count).toBeGreaterThanOrEqual(2);
      expect(sent.map((message) => message.to)).toEqual(expect.arrayContaining([[admins[0]], [admins[1]]]));
      expect(sent.flatMap((message) => message.to)).not.toContain(admins[2]);
      expect(sent[0].text).toContain("relation does not exist");
    } finally {
      await handle.close();
    }
  });
});
