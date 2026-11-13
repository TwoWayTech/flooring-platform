import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { openCompanyDb, openControlDb, type ControlDb } from "./client";
import { platformAuditLog, tenantDatabases, tenants, type TenantDatabaseStatus } from "./control";
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

/** A company whose migration failed, as the platform admins' alert names it. */
export interface CompanyMigrationFailure {
  tenantId: string;
  error: string;
}

/** Options for a rollout. */
export interface MigrateAllOptions {
  /**
   * Called once when a company fails, after it is in maintenance mode and the failure is logged.
   * The migrate script emails the platform admins from here. A failing alert never hides the
   * migration error.
   */
  onFailure?: (failure: CompanyMigrationFailure) => Promise<void>;
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
 * first rows exist (PR #8 review). A read-only database stays read-only throughout, its failure
 * recorded in last_error only, so no rollout, failed or interrupted, makes it writable.
 *
 * A company whose migration fails is put in maintenance mode (reason `migration_failed`), so it
 * serves no reads or writes on an old schema, and the failure goes to platform_audit_log (owner
 * decision, 2026-11-13). A later successful run takes it out of maintenance, but only when the
 * failed migration put it there; a move between providers keeps its own maintenance mode.
 */
export async function migrateAllCompanies(
  control: ControlDb,
  encryptionKey: string,
  options: MigrateAllOptions = {},
): Promise<CompanyMigrationResult[]> {
  const companies = await control
    .select()
    .from(tenantDatabases)
    .where(and(isNull(tenantDatabases.deletedAt), ne(tenantDatabases.status, "provisioning")))
    .orderBy(asc(tenantDatabases.createdAt));
  const migrated: CompanyMigrationResult[] = [];
  for (const company of companies) {
    const readOnly = await claimForMigration(control, company.id);
    if (readOnly === null) continue;
    try {
      const version = await migrateCompany(decryptSecret(company.encryptedUrl, encryptionKey));
      await control
        .update(tenantDatabases)
        .set({
          ...(readOnly ? {} : { status: "ready" as const }),
          schemaVersion: version,
          migratedAt: new Date(),
          lastError: null,
        })
        .where(
          and(eq(tenantDatabases.id, company.id), eq(tenantDatabases.status, readOnly ? "read_only" : "migrating")),
        );
      await endMigrationMaintenance(control, company.tenantId, version);
      migrated.push({ tenantId: company.tenantId, version });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await control
        .update(tenantDatabases)
        .set({
          ...(readOnly ? {} : { status: "failed" as const }),
          lastError: message,
        })
        .where(
          and(eq(tenantDatabases.id, company.id), eq(tenantDatabases.status, readOnly ? "read_only" : "migrating")),
        );
      await startMigrationMaintenance(control, company.tenantId, message);
      await options.onFailure?.({ tenantId: company.tenantId, error: message }).catch((alertError: unknown) => {
        console.error(`The alert for company ${company.tenantId} failed: ${String(alertError)}`);
      });
      throw new MigrationStoppedError(company.tenantId, migrated, error);
    }
  }
  return migrated;
}

/** Statuses migrate-all may move to `migrating`: live databases that are not read-only. */
const CLAIMABLE: TenantDatabaseStatus[] = ["ready", "failed", "migrating"];

/**
 * Claims a company database for this rollout, checking its status as it is now, not as listed at
 * the start (PR #8 review). Returns false when it was claimed as `migrating`; true when it is
 * read-only, which keeps its status and gets only its version and error fields updated; and null
 * when it is something else now (provisioning, or deleted), so it is skipped. Every later write is
 * conditional on the status this returns, so a status an operator sets meanwhile, such as
 * read-only, is never overwritten.
 */
async function claimForMigration(control: ControlDb, databaseId: string): Promise<boolean | null> {
  const [claimed] = await control
    .update(tenantDatabases)
    .set({ status: "migrating" })
    .where(and(eq(tenantDatabases.id, databaseId), inArray(tenantDatabases.status, CLAIMABLE)))
    .returning({ id: tenantDatabases.id });
  if (claimed) return false;
  const [current] = await control
    .select({ status: tenantDatabases.status })
    .from(tenantDatabases)
    .where(and(eq(tenantDatabases.id, databaseId), isNull(tenantDatabases.deletedAt)));
  return current?.status === "read_only" ? true : null;
}

/**
 * Puts a company whose migration failed in maintenance mode and logs it (owner decision,
 * 2026-11-13). A company already in maintenance for a move keeps that reason.
 */
async function startMigrationMaintenance(control: ControlDb, tenantId: string, error: string): Promise<void> {
  await control.transaction(async (tx) => {
    await tx
      .update(tenants)
      .set({ maintenanceMode: true, maintenanceReason: "migration_failed" })
      .where(and(eq(tenants.id, tenantId), eq(tenants.maintenanceMode, false)));
    await tx.insert(platformAuditLog).values({
      tenantId,
      action: "company.migration_failed",
      targetType: "tenant_database",
      targetId: tenantId,
      after: { maintenanceMode: true, error },
    });
  });
}

/** Ends the maintenance mode a failed migration started, once the company is up to date, and logs it. */
async function endMigrationMaintenance(control: ControlDb, tenantId: string, version: string): Promise<void> {
  await control.transaction(async (tx) => {
    const [ended] = await tx
      .update(tenants)
      .set({ maintenanceMode: false, maintenanceReason: null })
      .where(and(eq(tenants.id, tenantId), eq(tenants.maintenanceReason, "migration_failed")))
      .returning({ id: tenants.id });
    if (!ended) return;
    await tx.insert(platformAuditLog).values({
      tenantId,
      action: "company.migration_recovered",
      targetType: "tenant_database",
      targetId: tenantId,
      after: { maintenanceMode: false, version },
    });
  });
}
