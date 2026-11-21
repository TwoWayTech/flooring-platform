import { randomBytes } from "node:crypto";
import { NoopProvisioner } from "@workspace/providers";
import { decodeMemberRoles } from "@workspace/shared";
import { verifyPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, latestVersion, migrateAllCompanies, MIGRATIONS, openCompanyDb, openControlDb } from "../src";
import {
  contractorPayments,
  employees,
  meetings,
  payPeriods,
  ptoRequests,
  roles,
  settings,
  timeOffEntries,
  timesheets,
  userProfiles,
  userRoles,
} from "../src/company";
import {
  account,
  member,
  platformAdmins,
  products,
  tenantBranding,
  tenantDatabases,
  tenantProducts,
  tenants,
  user,
} from "../src/control";
import { isLocalDatabaseUrl } from "../src/local-url";
import {
  SEED_PLATFORM_ADMIN,
  seededPlatformAdminId,
  seededTenantId,
  seedLocalTestData,
  localSeedRefusal,
  seedTestCompany,
  type LocalSeedOptions,
  type SeedOptions,
} from "../src/seed";
import { loadDemoCompany } from "../src/seed/fixtures";
import { adminUrl as testAdminUrl, scratchDatabase } from "../src/testing";

const encryptionKey = randomBytes(32).toString("base64");
const userPassword = randomBytes(12).toString("base64url");
const harbor = loadDemoCompany("harbor");
const summit = loadDemoCompany("summit");
const HARBOR_ID = seededTenantId("harbor");

/** What the Employee role holds: the least-privileged system role that can sign in (ADR 0065). */
const EMPLOYEE_PERMISSIONS = [
  "hr.portal.view",
  "hr.pto.request",
  "hr.pto.view",
  "hr.timesheet.edit",
  "hr.timesheet.view",
  "meetings.meeting.create",
  "meetings.meeting.view",
];

/** Two companies seeded twice is four full seeds; a shared local server can be slow. */
const SEED_TIMEOUT_MS = 600_000;

// The local-only seed (ADR 0065): Summit as before, then Harbor Staffing Co. in its own database
// and a platform admin whose home company is Summit (as an Employee, since there is no admin host
// yet), each run twice to prove the seed is idempotent.
describe("local test seed: Harbor Staffing Co. and a platform admin", () => {
  const scratch: { url: string; drop: () => Promise<void> }[] = [];

  beforeAll(async () => {
    scratch.push(
      await scratchDatabase("lseed_control"),
      await scratchDatabase("lseed_summit"),
      await scratchDatabase("lseed_harbor"),
    );
    const base = { controlUrl: scratch[0].url, encryptionKey, provider: "noop", userPassword };
    const summitOptions: SeedOptions = { ...base, provisioner: new NoopProvisioner(scratch[1].url) };
    const harborOptions: LocalSeedOptions = {
      ...base,
      adminUrl: testAdminUrl,
      provisioner: new NoopProvisioner(scratch[2].url),
    };
    for (let run = 0; run < 2; run += 1) {
      await seedTestCompany(summitOptions);
      await seedLocalTestData(harborOptions);
    }
  }, SEED_TIMEOUT_MS);

  afterAll(async () => {
    for (const database of scratch) await database.drop();
  }, SEED_TIMEOUT_MS);

  it("writes both companies once, each with its own ready database, and Harbor has only HR Suite", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      const rows = await control.db.select().from(tenants);
      expect(rows.map((row) => row.name).sort()).toEqual(["Harbor Staffing Co.", "Summit Floor Co."]);
      const [database] = await control.db.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, HARBOR_ID));
      expect(database.status).toBe("ready");
      expect(database.schemaVersion).toBe(latestVersion(MIGRATIONS.company));
      expect(decryptSecret(database.encryptedUrl, encryptionKey)).toBe(scratch[2].url);
      const harborProducts = await control.db
        .select({ key: products.key })
        .from(tenantProducts)
        .innerJoin(products, eq(products.id, tenantProducts.productId))
        .where(eq(tenantProducts.tenantId, HARBOR_ID));
      expect(harborProducts).toEqual([{ key: "hr" }]);
      const [branding] = await control.db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, HARBOR_ID));
      expect(branding).toMatchObject({ displayName: "Harbor Staffing Co.", monogram: "HS", brandColor: "#1F6FA8" });
    } finally {
      await control.close();
    }
  });

  it("gives Harbor's people their roles and the seed password; Elena Brooks is the Owner", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      const members = await control.db.select().from(member).where(eq(member.organizationId, HARBOR_ID));
      expect(members).toHaveLength(harbor.fixtures.users.length);
      const [elena] = await control.db.select().from(user).where(eq(user.email, "elena.brooks@harborstaffing.example"));
      const elenaMember = members.find((row) => row.userId === elena.id);
      expect(decodeMemberRoles(elenaMember?.role ?? "")).toEqual(["owner"]);
      const [credential] = await control.db.select().from(account).where(eq(account.userId, elena.id));
      expect(await verifyPassword({ hash: credential.password ?? "", password: userPassword })).toBe(true);
      const everyone = await control.db.select().from(user);
      expect(everyone).toHaveLength(summit.fixtures.users.length + harbor.fixtures.users.length + 1);
    } finally {
      await control.close();
    }
  });

  it("seeds Harbor's HR data into its own database: people, timesheets, time off, pay periods, holidays and meetings", async () => {
    const { fixtures } = harbor;
    const company = openCompanyDb(scratch[2].url, { max: 1 });
    try {
      expect(await company.db.select().from(roles)).toHaveLength(fixtures.roles.length);
      expect(await company.db.select().from(userProfiles)).toHaveLength(fixtures.users.length);
      expect(await company.db.select().from(employees)).toHaveLength(fixtures.employees.length);
      expect(await company.db.select().from(timesheets)).toHaveLength(fixtures.timesheets.length);
      expect(await company.db.select().from(ptoRequests)).toHaveLength(fixtures.ptoRequests.length);
      expect(await company.db.select().from(timeOffEntries)).toHaveLength(fixtures.timeOffEntries.length);
      expect(await company.db.select().from(payPeriods)).toHaveLength(fixtures.payPeriods.length);
      expect(await company.db.select().from(contractorPayments)).toHaveLength(fixtures.contractorPayments.length);
      expect(await company.db.select().from(meetings)).toHaveLength(fixtures.meetings.length);
      const [hr] = await company.db.select().from(settings).where(eq(settings.group, "hr"));
      expect((hr.value as { holidays: unknown[] }).holidays).toHaveLength(fixtures.settings.hr.holidays.length);
    } finally {
      await company.close();
    }
  });

  it("keeps Summit's database free of Harbor's people; only the platform admin joins Summit's", async () => {
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      const profiles = await company.db.select().from(userProfiles);
      expect(profiles).toHaveLength(summit.fixtures.users.length + 1);
      expect(profiles.filter((profile) => profile.userId === seededPlatformAdminId)).toHaveLength(1);
    } finally {
      await company.close();
    }
  });

  it("writes one platform admin, an owner, with the seed password and no MFA secret", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      const admins = await control.db.select().from(platformAdmins);
      expect(admins).toEqual([expect.objectContaining({ userId: seededPlatformAdminId, role: "owner", active: true })]);
      const [admin] = await control.db.select().from(user).where(eq(user.id, seededPlatformAdminId));
      expect(admin).toMatchObject({
        email: SEED_PLATFORM_ADMIN.email,
        name: "Platform Admin",
        twoFactorEnabled: false,
      });
      const credentials = await control.db.select().from(account).where(eq(account.userId, seededPlatformAdminId));
      expect(credentials).toHaveLength(1);
      expect(await verifyPassword({ hash: credentials[0].password ?? "", password: userPassword })).toBe(true);
    } finally {
      await control.close();
    }
  });

  it("makes Summit the platform admin's home company, as an Employee and nothing more (no admin host yet)", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      const memberships = await control.db.select().from(member).where(eq(member.userId, seededPlatformAdminId));
      expect(memberships.map((row) => row.organizationId)).toEqual([seededTenantId("summit")]);
      expect(decodeMemberRoles(memberships[0].role ?? "")).toEqual(["employee"]);
    } finally {
      await control.close();
    }
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      const held = await company.db
        .select({ key: roles.key, dataScope: roles.dataScope })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, seededPlatformAdminId));
      expect(held).toEqual([{ key: "employee", dataScope: "own" }]);
      const [profile] = await company.db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, seededPlatformAdminId));
      expect(profile).toMatchObject({ status: "active", employeeId: null });
    } finally {
      await company.close();
    }
    // The Employee role reaches only one's own records: My portal's timesheet, time off and meetings.
    const employee = summit.fixtures.roles.find((role) => role.key === "employee");
    expect([...(employee?.permissions ?? [])].sort()).toEqual(EMPLOYEE_PERMISSIONS);
  });

  it("brings Harbor's database along when every company is migrated (pnpm db:migrate)", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      const results = await migrateAllCompanies(control.db, encryptionKey);
      expect(results.map((result) => result.tenantId)).toContain(HARBOR_ID);
      expect(results).toHaveLength(2);
    } finally {
      await control.close();
    }
  });
});

/** A database URL on this machine, for the side of a refusal test that should pass. */
const LOCAL_URL = "postgres://postgres:postgres@localhost:5432/control";

/**
 * URLs the local seed must refuse. testing.ts has no tests of its own for these, so every case is
 * here: other hosts, a look-alike host, IPv6 loopback (only localhost and 127.0.0.1 count), a
 * second `@` in the authority, and query options postgres.js reads over the URL's host.
 */
const NOT_LOCAL = [
  "postgres://postgres:postgres@db.example.com:5432/control",
  "postgres://postgres:postgres@10.0.0.5:5432/control",
  "postgres://postgres:postgres@localhost.evil.com:5432/control",
  "postgres://postgres:postgres@[::1]:5432/control",
  "postgres://u@evil.com@localhost/control",
  "postgres://postgres:postgres@localhost:5432/control?host=db.example.com",
  "postgres://postgres:postgres@localhost:5432/control?hostaddr=10.0.0.5",
  "postgres://postgres:postgres@localhost:5432/control#x",
  "not a url",
];

/** Runs the local seed with the given URLs and provider and expects a refusal before any provisioning. */
async function expectRefused(input: { controlUrl: string; adminUrl: string; provider: string }, words: RegExp) {
  // A provisioner that records any database the seed got as far as asking for.
  const provisioner = new NoopProvisioner("postgres://never@localhost/never");
  await expect(seedLocalTestData({ ...input, encryptionKey, provisioner, userPassword })).rejects.toThrow(words);
  expect(provisioner.created).toHaveLength(0);
}

describe("local test seed refuses anything not on this machine, before it connects", () => {
  it.each(NOT_LOCAL)("refuses the control database %s", async (controlUrl) => {
    await expectRefused(
      { controlUrl, adminUrl: LOCAL_URL, provider: "noop" },
      /only into databases on this machine \(localhost or 127\.0\.0\.1\); CONTROL_DATABASE_URL is not\./,
    );
  });

  it.each(NOT_LOCAL)("refuses the provisioning server %s", async (adminUrl) => {
    await expectRefused({ controlUrl: LOCAL_URL, adminUrl, provider: "postgres" }, /TENANT_DB_ADMIN_URL is not\./);
  });

  it("names both variables when neither is local", async () => {
    await expectRefused(
      { controlUrl: NOT_LOCAL[0], adminUrl: NOT_LOCAL[0], provider: "postgres" },
      /CONTROL_DATABASE_URL and TENANT_DB_ADMIN_URL are not\./,
    );
  });

  it.each(["neon", "supabase", ""])("refuses DB_PROVIDER %j", async (provider) => {
    await expectRefused(
      { controlUrl: LOCAL_URL, adminUrl: LOCAL_URL, provider },
      /only with DB_PROVIDER postgres or noop/,
    );
  });

  it("accepts localhost and 127.0.0.1 with postgres or noop", () => {
    expect(isLocalDatabaseUrl(LOCAL_URL)).toBe(true);
    expect(isLocalDatabaseUrl("postgres://postgres:postgres@127.0.0.1:5432/control?sslmode=disable")).toBe(true);
    for (const provider of ["postgres", "noop"]) {
      expect(
        localSeedRefusal({
          controlUrl: LOCAL_URL,
          adminUrl: LOCAL_URL,
          provider,
          encryptionKey,
          provisioner: new NoopProvisioner(),
        }),
      ).toBeNull();
    }
  });
});
