import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrationErrorCode } from "@workspace/shared";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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

/**
 * A company whose migration failed, as the platform admins' alert and the migrate script name it
 * (docs/specs/platform-admin.md, "pnpm db:migrate when a company fails (packages/db)"; ADR 0053).
 * It never holds the error text: the driver's message can quote a company's own rows, so it stays
 * in tenant_databases.last_error.
 */
export interface CompanyMigrationFailure {
  tenantId: string;
  /** The SQLSTATE or system error code when there is one, safe to put in an email. */
  code: string | null;
  /** True when tenant_databases.last_error now holds this failure's text (its transaction committed and the claimed status still held). */
  recorded: boolean;
  /** True when the company is in maintenance mode now: turned on for this failure, already on (a move), or turned on by the fallback. */
  maintenance: boolean;
  /** True when the database is read-only, so without maintenance it still serves reads on a half-migrated schema. */
  readOnly: boolean;
}

/** Options for a rollout. */
export interface MigrateAllOptions {
  /**
   * Called once when a company fails, after the failure was recorded or the fallback ran; the
   * flags say where the company stands. The migrate script emails the platform admins from here.
   * A failing alert never hides the migration error.
   */
  onFailure?: (failure: CompanyMigrationFailure) => Promise<void>;
}

/**
 * Thrown when a company fails; the companies after it were not touched. The message carries the
 * error code, and the error text only when it could not be written to last_error, so a CI or
 * deploy log keeps the text only when it is nowhere else (blueprint p29, "logs without personal
 * data"; ADR 0053). The original error is the `cause`.
 */
export class MigrationStoppedError extends Error {
  constructor(
    readonly tenantId: string,
    readonly migrated: CompanyMigrationResult[],
    cause: unknown,
    readonly code: string | null,
    readonly recorded: boolean,
  ) {
    const stopped = `Migration stopped at company ${tenantId} (error code ${code ?? "none"})`;
    super(
      recorded
        ? `${stopped}. The full error is in tenant_databases.last_error.`
        : `${stopped}: ${errorText(cause)}. It could not be written to tenant_databases.last_error.`,
      { cause },
    );
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
 * serves no reads or writes on an old schema (owner decision, 2026-11-13). Its last_error, the
 * maintenance mode and a `company.migration_failed` audit row holding only `{ maintenanceMode,
 * code }` are written in one control transaction (docs/specs/platform-admin.md, "How pnpm
 * db:migrate handles a failure"; ADR 0053). When that transaction fails, maintenance mode is still
 * turned on alone, because stopping the company is safer than letting a read-only database serve a
 * half-migrated schema. `onFailure` and the thrown error say where the company stands, and the
 * error text reaches the log only when it could not be saved. A later successful run takes the
 * company out of maintenance, but only when a failed migration put it there; a move between
 * providers keeps its own maintenance mode.
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
    let version: string;
    try {
      version = await migrateCompany(decryptSecret(company.encryptedUrl, encryptionKey));
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
    } catch (error) {
      const code = errorCode(error);
      const outcome = await recordMigrationFailure(control, company, readOnly, code, errorText(error));
      // A failing alert never hides the migration error.
      await options
        .onFailure?.({ tenantId: company.tenantId, code, readOnly, ...outcome })
        .catch((alertError: unknown) => {
          console.error(`The alert for company ${company.tenantId} failed: ${errorText(alertError)}`);
        });
      throw new MigrationStoppedError(company.tenantId, migrated, error, code, outcome.recorded);
    }
    // Outside the try: a control-database error here must not report a migrated company as failed.
    await endMigrationMaintenance(control, company, version);
    migrated.push({ tenantId: company.tenantId, version });
  }
  return migrated;
}

/** The tenant_databases row a rollout works on. */
interface DatabaseRef {
  id: string;
  tenantId: string;
}

/** Longest error text kept in last_error (and, only when it can't be kept there, printed by the CLI). */
const MAX_ERROR_LENGTH = 500;

/** An error as short text, capped so a long driver message never floods the log or an email. */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}

/**
 * The SQLSTATE or system error code of an error or its cause, or null. Each link of the `cause`
 * chain is checked with the shared `migrationErrorCode`, the one pattern the console reads back.
 */
function errorCode(error: unknown): string | null {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    const code = migrationErrorCode((current as { code?: unknown }).code);
    if (code) return code;
  }
  return null;
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

/** Where a failed company stands once the failure is handled, before the alert and the thrown error. */
interface FailureOutcome {
  recorded: boolean;
  maintenance: boolean;
}

/**
 * Records a failed migration (docs/specs/platform-admin.md, "How pnpm db:migrate handles a
 * failure"; ADR 0053). In one control transaction: last_error (and `failed`, unless read-only),
 * conditional on the status the claim returned; maintenance mode; and a `company.migration_failed`
 * audit row holding only `{ maintenanceMode, code }`, never the text, because the driver's message
 * can quote company data. When that transaction fails, maintenance mode is turned on alone and no
 * audit row is written (owner question); it leaves no stuck state, because the next successful run
 * ends a `migration_failed` maintenance as usual.
 */
async function recordMigrationFailure(
  control: ControlDb,
  database: DatabaseRef,
  readOnly: boolean,
  code: string | null,
  message: string,
): Promise<FailureOutcome> {
  try {
    return await control.transaction(async (tx) => {
      const written = await tx
        .update(tenantDatabases)
        .set({ ...(readOnly ? {} : { status: "failed" as const }), lastError: message })
        .where(
          and(eq(tenantDatabases.id, database.id), eq(tenantDatabases.status, readOnly ? "read_only" : "migrating")),
        )
        .returning({ id: tenantDatabases.id });
      const maintenance = await turnMaintenanceOn(tx, database.tenantId);
      await tx.insert(platformAuditLog).values({
        tenantId: database.tenantId,
        action: "company.migration_failed",
        targetType: "tenant_database",
        targetId: database.id,
        after: { maintenanceMode: maintenance, code },
      });
      return { recorded: written.length > 0, maintenance };
    });
  } catch (writeError) {
    console.error(`Could not record the failed migration of company ${database.tenantId}: ${errorText(writeError)}`);
    // Safer to stop the company than let a read-only database serve a half-migrated schema (ADR 0053).
    const maintenance = await turnMaintenanceOn(control, database.tenantId).catch((fallbackError: unknown) => {
      console.error(`Could not put company ${database.tenantId} in maintenance: ${errorText(fallbackError)}`);
      return false;
    });
    return { recorded: false, maintenance };
  }
}

/**
 * Turns a company's maintenance mode on and says whether it is on now (owner decision,
 * 2026-11-13). A company already in maintenance keeps its reason, such as a move's or a manual
 * null, as before part 3; only one that was off gets `migration_failed`, so only that one is ended
 * by the next successful run.
 */
async function turnMaintenanceOn(db: ControlDb, tenantId: string): Promise<boolean> {
  const [row] = await db
    .update(tenants)
    .set({
      maintenanceMode: true,
      maintenanceReason: sql`case when ${tenants.maintenanceMode} then ${tenants.maintenanceReason} else 'migration_failed' end`,
    })
    .where(eq(tenants.id, tenantId))
    .returning({ on: tenants.maintenanceMode });
  return row?.on === true;
}

/** Ends the maintenance mode a failed migration started, once the company is up to date, and logs it. */
async function endMigrationMaintenance(control: ControlDb, database: DatabaseRef, version: string): Promise<void> {
  await control.transaction(async (tx) => {
    const [ended] = await tx
      .update(tenants)
      .set({ maintenanceMode: false, maintenanceReason: null })
      .where(and(eq(tenants.id, database.tenantId), eq(tenants.maintenanceReason, "migration_failed")))
      .returning({ id: tenants.id });
    if (!ended) return;
    await tx.insert(platformAuditLog).values({
      tenantId: database.tenantId,
      action: "company.migration_recovered",
      targetType: "tenant_database",
      targetId: database.id,
      after: { maintenanceMode: false, version },
    });
  });
}
