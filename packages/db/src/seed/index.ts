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
export { OPENING_MEMO, openingEntryId, seedOpening } from "./opening-balances";

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

/** What the local-only seed needs: the seed options plus the server the provisioner creates databases on. */
export interface LocalSeedOptions extends SeedOptions {
  /** TENANT_DB_ADMIN_URL: the superuser login the provisioner creates company databases with. */
  adminUrl: string;
}

/** The DB_PROVIDER values the local seed accepts: plain PostgreSQL on this machine, or no provisioning. */
const LOCAL_PROVIDERS: ReadonlySet<string> = new Set(["postgres", "noop"]);

/**
 * Why the local seed must not run with these options, or null when it may: the control database
 * and the provisioner's server must be on this machine and the provider plain PostgreSQL or noop.
 * The message names variables, never URLs, which hold passwords.
 */
export function localSeedRefusal(options: LocalSeedOptions): string | null {
  const notLocal = [
    isLocalDatabaseUrl(options.controlUrl) ? null : "CONTROL_DATABASE_URL",
    isLocalDatabaseUrl(options.adminUrl) ? null : "TENANT_DB_ADMIN_URL",
  ].filter((name) => name !== null);
  if (notLocal.length > 0) {
    return (
      "Harbor Staffing Co. and the platform admin are seeded only into databases on this machine " +
      `(localhost or 127.0.0.1); ${notLocal.join(" and ")} ${notLocal.length > 1 ? "are" : "is"} not.`
    );
  }
  if (!LOCAL_PROVIDERS.has(options.provider)) {
    return "Harbor Staffing Co. and the platform admin are seeded only with DB_PROVIDER postgres or noop.";
  }
  return null;
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
 * database and people, and an invented platform admin whose home company is Summit (an Employee
 * there), so they can sign in until the admin host exists. Run it after seedTestCompany. Refuses,
 * before it connects or writes anywhere, a control database or provisioning server that is not on
 * this machine and any provider but postgres or noop (`localSeedRefusal`), so it never reaches a
 * shared or production server. Any port on localhost passes: never run it through a tunnel or port
 * forward to a remote database (ADR 0065). Safe to run again: ids are stable and existing rows are kept.
 */
export async function seedLocalTestData(options: LocalSeedOptions): Promise<LocalSeedResult> {
  const refusal = localSeedRefusal(options);
  if (refusal) throw new Error(refusal);
  const harborTenantId = await seedDemoCompany(options, "harbor");
  const control = openControlDb(options.controlUrl, { max: 1 });
  try {
    const passwordHash = options.userPassword ? await hashPassword(options.userPassword) : undefined;
    const platformAdminUserId = await seedPlatformAdmin(control.db, options.encryptionKey, passwordHash);
    return { harborTenantId, platformAdminUserId };
  } finally {
    await control.close();
  }
}
