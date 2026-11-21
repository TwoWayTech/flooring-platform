import type { DatabaseProvisioner } from "@workspace/providers";
import type { CompanyId } from "@workspace/shared";
import { hashPassword } from "better-auth/crypto";
import { openCompanyDb, openControlDb } from "../client";
import { isLocalDatabaseUrl } from "../local-url";
import { migrateControl } from "../migrate";
import { provisionCompany } from "../provision";
import { seedCompany } from "./company";
import { seedControl } from "./control";
import { loadDemoCompany } from "./fixtures";
import { seedPlatformAdmin } from "./platform-admin";

export { seedId, loadDemoCompany } from "./fixtures";
export { ensureReferenceData, seededTenantId, seededUserId } from "./control";
export { SEED_PLATFORM_ADMIN, seededPlatformAdminId } from "./platform-admin";

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

/** What the local-only seed wrote: Harbor's tenant id and the platform admin's user id. */
export interface LocalSeedResult {
  harborTenantId: string;
  platformAdminUserId: string;
}

/**
 * Seeds one demo company: migrate the control database, write the company there (with a password
 * for every user when one is given), give it a database through the provisioner, migrate it and
 * seed it from the demo fixtures. Safe to run again: ids are stable and existing rows are kept.
 * Returns the tenant id.
 */
async function seedDemoCompany(options: SeedOptions, id: CompanyId): Promise<string> {
  const demo = loadDemoCompany(id);
  await migrateControl(options.controlUrl);
  const control = openControlDb(options.controlUrl, { max: 1 });
  try {
    const passwordHash = options.userPassword ? await hashPassword(options.userPassword) : undefined;
    const tenantId = await seedControl(control.db, demo, passwordHash);
    // Seeded as provisioning's prepare step, so the company is ready only once its rows exist (PR #8 review).
    await provisionCompany(
      control.db,
      options.provisioner,
      options.encryptionKey,
      { tenantId, slug: demo.company.id, provider: options.provider },
      async (companyUrl) => {
        const company = openCompanyDb(companyUrl, { max: 1 });
        try {
          await seedCompany(company.db, demo);
        } finally {
          await company.close();
        }
      },
    );
    return tenantId;
  } finally {
    await control.close();
  }
}

/**
 * Seeds the test company, Summit Floor Co., with its own database (see seedDemoCompany). Safe to
 * run again. Returns the tenant id.
 */
export async function seedTestCompany(options: SeedOptions): Promise<string> {
  return seedDemoCompany(options, "summit");
}

/**
 * The local-testing seed (ADR 0065): the HR Suite company Harbor Staffing Co. with its own
 * database and people, and an invented platform admin who belongs to no company. Refuses, before
 * it connects anywhere, a control database that is not on this machine, so it never reaches a
 * shared or production server. Safe to run again: ids are stable and existing rows are kept.
 */
export async function seedLocalTestData(options: SeedOptions): Promise<LocalSeedResult> {
  if (!isLocalDatabaseUrl(options.controlUrl)) {
    throw new Error(
      "Harbor Staffing Co. and the platform admin are seeded only into a control database on this machine " +
        "(localhost or 127.0.0.1); CONTROL_DATABASE_URL is not one.",
    );
  }
  const harborTenantId = await seedDemoCompany(options, "harbor");
  const control = openControlDb(options.controlUrl, { max: 1 });
  try {
    const passwordHash = options.userPassword ? await hashPassword(options.userPassword) : undefined;
    const platformAdminUserId = await seedPlatformAdmin(control.db, passwordHash);
    return { harborTenantId, platformAdminUserId };
  } finally {
    await control.close();
  }
}
