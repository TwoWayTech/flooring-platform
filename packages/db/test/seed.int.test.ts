import { randomBytes } from "node:crypto";
import { NoopProvisioner } from "@workspace/providers";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, migrateAllCompanies, openCompanyDb, openControlDb } from "../src";
import { roles, userProfiles } from "../src/company";
import { tenantDatabases, tenants, user } from "../src/control";
import { seedTestCompany } from "../src/seed";
import { scratchDatabase } from "./scratch-db";

const encryptionKey = randomBytes(32).toString("base64");

describe("test company seed", () => {
  const scratch: { url: string; drop: () => Promise<void> }[] = [];
  let tenantId = "";

  beforeAll(async () => {
    scratch.push(await scratchDatabase("seed_control"), await scratchDatabase("seed_company"));
    const options = {
      controlUrl: scratch[0].url,
      encryptionKey,
      provisioner: new NoopProvisioner(scratch[1].url),
      provider: "noop",
    };
    tenantId = await seedTestCompany(options);
    await seedTestCompany(options);
  });

  afterAll(async () => {
    for (const database of scratch) await database.drop();
  });

  it("writes the company, its people and its encrypted database once, even when run twice", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      expect(await control.db.select().from(tenants)).toHaveLength(1);
      expect((await control.db.select().from(user)).length).toBe(15);
      const [database] = await control.db.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, tenantId));
      expect(database.status).toBe("ready");
      expect(database.schemaVersion).toBe("0000_company_base");
      expect(database.encryptedUrl).not.toContain("postgres://");
      expect(decryptSecret(database.encryptedUrl, encryptionKey)).toBe(scratch[1].url);
    } finally {
      await control.close();
    }
  });

  it("seeds the company's roles with one locked Owner and a profile per user", async () => {
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      const seededRoles = await company.db.select().from(roles);
      expect(seededRoles.filter((role) => role.owner)).toHaveLength(1);
      expect(await company.db.select().from(userProfiles)).toHaveLength(15);
    } finally {
      await company.close();
    }
  });

  it("migrate-all brings every company to the newest version", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      expect(await migrateAllCompanies(control.db, encryptionKey)).toEqual([
        { tenantId, version: "0000_company_base" },
      ]);
    } finally {
      await control.close();
    }
  });
});
