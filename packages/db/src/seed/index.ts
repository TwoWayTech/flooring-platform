import type { DatabaseProvisioner } from "@workspace/providers";
import { hashPassword } from "better-auth/crypto";
import { openCompanyDb, openControlDb } from "../client";
import { migrateControl } from "../migrate";
import { provisionCompany } from "../provision";
import { seedCompany } from "./company";
import { seedControl } from "./control";
import { loadDemoCompany } from "./fixtures";

export { seedId, loadDemoCompany } from "./fixtures";
export { seededTenantId, seededUserId } from "./control";

/** What the test-company seed needs. */
export interface SeedOptions {
  controlUrl: string;
  encryptionKey: string;
  provisioner: DatabaseProvisioner;
  /** The DB_PROVIDER name, stored beside the database so a later move knows where it lives. */
  provider: string;
  /** Password for every seeded user (SEED_USER_PASSWORD). Without it the users get no password. */
  userPassword?: string;
}

/**
 * Seeds the one test company, Summit Floor Co.: migrate the control database, write the company
 * there (with a password for every user when one is given), give it a database through the provisioner, migrate it and seed its foundation. Safe to
 * run again: ids are stable and existing rows are kept. Returns the tenant id.
 */
export async function seedTestCompany(options: SeedOptions): Promise<string> {
  const demo = loadDemoCompany("summit");
  await migrateControl(options.controlUrl);
  const control = openControlDb(options.controlUrl, { max: 1 });
  try {
    const passwordHash = options.userPassword ? await hashPassword(options.userPassword) : undefined;
    const tenantId = await seedControl(control.db, demo, passwordHash);
    const companyUrl = await provisionCompany(control.db, options.provisioner, options.encryptionKey, {
      tenantId,
      slug: demo.company.id,
      provider: options.provider,
    });
    const company = openCompanyDb(companyUrl, { max: 1 });
    try {
      await seedCompany(company.db, demo);
    } finally {
      await company.close();
    }
    return tenantId;
  } finally {
    await control.close();
  }
}
