import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { openCompanyDb, openControlDb, type ControlDb } from "./client";
import { tenantDatabases } from "./control";
import { decryptSecret } from "./crypto";

/** Where the generated SQL lives; one folder per database kind. */
export const MIGRATIONS = {
  control: fileURLToPath(new URL("../migrations/control", import.meta.url)),
  company: fileURLToPath(new URL("../migrations/company", import.meta.url)),
};

/** The tag of the newest migration in a folder, recorded as a company's schema version. */
export function latestVersion(folder: string): string {
  const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, "utf8")) as { entries: { tag: string }[] };
  const last = journal.entries.at(-1);
  if (!last) throw new Error(`No migrations in ${folder}.`);
  return last.tag;
}

/** Brings the control database up to date. */
export async function migrateControl(url: string): Promise<void> {
  const handle = openControlDb(url, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS.control });
  } finally {
    await handle.close();
  }
}

/** Brings one company database up to date and returns the schema version it now has. */
export async function migrateCompany(url: string): Promise<string> {
  const handle = openCompanyDb(url, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS.company });
    return latestVersion(MIGRATIONS.company);
  } finally {
    await handle.close();
  }
}

/** What happened to one company in a rollout. */
export interface CompanyMigrationResult {
  tenantId: string;
  version: string;
}

/** Thrown when a company fails; the companies after it were not touched. */
export class MigrationStoppedError extends Error {
  constructor(
    readonly tenantId: string,
    readonly migrated: CompanyMigrationResult[],
    cause: unknown,
  ) {
    super(`Migration stopped at company ${tenantId}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/**
 * Migrates every company database in turn and records each one's version (blueprint p13). The
 * first failure stops the rollout and is reported; companies after it stay on their previous
 * version until it is fixed, so no company is left half-way through a broken release.
 *
 * Databases still being provisioned are skipped: only provisioning marks them ready, after their
 * first rows exist (PR #8 review). A read-only database goes back to read-only after migrating,
 * never to ready, so a rollout never makes a read-only company writable.
 */
export async function migrateAllCompanies(
  control: ControlDb,
  encryptionKey: string,
): Promise<CompanyMigrationResult[]> {
  const companies = await control
    .select()
    .from(tenantDatabases)
    .where(and(isNull(tenantDatabases.deletedAt), ne(tenantDatabases.status, "provisioning")))
    .orderBy(asc(tenantDatabases.createdAt));
  const migrated: CompanyMigrationResult[] = [];
  for (const company of companies) {
    await control.update(tenantDatabases).set({ status: "migrating" }).where(eq(tenantDatabases.id, company.id));
    try {
      const version = await migrateCompany(decryptSecret(company.encryptedUrl, encryptionKey));
      await control
        .update(tenantDatabases)
        .set({
          status: company.status === "read_only" ? "read_only" : "ready",
          schemaVersion: version,
          migratedAt: new Date(),
          lastError: null,
        })
        .where(eq(tenantDatabases.id, company.id));
      migrated.push({ tenantId: company.tenantId, version });
    } catch (error) {
      await control
        .update(tenantDatabases)
        .set({ status: "failed", lastError: error instanceof Error ? error.message : String(error) })
        .where(eq(tenantDatabases.id, company.id));
      throw new MigrationStoppedError(company.tenantId, migrated, error);
    }
  }
  return migrated;
}
