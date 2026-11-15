import {
  migrationErrorCode,
  type CompanyDatabaseState,
  type CompanyMaintenanceReason,
  type PlatformDatabaseStatus,
} from "@workspace/shared";

/** A company database's state in words (`tenant_databases.status`). */
export const DATABASE_LABELS: Record<CompanyDatabaseState, string> = {
  provisioning: "Being set up",
  ready: "Ready",
  migrating: "Updating",
  failed: "Update failed",
  read_only: "Read-only",
};

/** Why a company is in maintenance, in words (`tenants.maintenance_reason`). */
export const MAINTENANCE_LABELS: Record<CompanyMaintenanceReason, string> = {
  migration_failed: "On, after a failed update",
  move: "On, while the data moves",
};

/**
 * What the last failed update left behind, in words (docs/specs/platform-admin.md, part 3,
 * "Database errors and maintenance"): its error code, never its text, which can quote the
 * company's data. Null when no error is recorded. The code passes the shared pattern again here, so
 * nothing but a code is ever shown.
 */
export function databaseErrorText(database: PlatformDatabaseStatus): string | null {
  if (!database.hasError) return null;
  const code = migrationErrorCode(database.errorCode);
  return code ? `Error code ${code}` : "No error code recorded";
}

/**
 * A company database in one line, for the companies list, its search and its CSV: the state, then
 * the error code when an error is recorded (spec part 3, "Database errors and maintenance"). Only
 * labels and codes, so no export can carry the error text.
 */
export function databaseText(database: PlatformDatabaseStatus): string {
  if (!database.status) return "No database";
  const label = DATABASE_LABELS[database.status];
  if (!database.hasError) return label;
  const code = migrationErrorCode(database.errorCode);
  return code ? `${label}, error ${code}` : `${label}, no error code recorded`;
}
