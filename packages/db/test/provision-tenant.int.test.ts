import { randomBytes } from "node:crypto";
import { companyDatabaseName, PostgresServerProvisioner, type DatabaseProvisioner } from "@workspace/providers";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, migrateControl, openCompanyDb, openControlDb, provisionTenant, type NewCompany } from "../src";
import { branches } from "../src/company";
import { member, organization, tenantBranding, tenantDatabases, tenantProducts, tenants, user } from "../src/control";
import { adminUrl, scratchDatabase } from "../src/testing";

const encryptionKey = randomBytes(32).toString("base64");
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
});
