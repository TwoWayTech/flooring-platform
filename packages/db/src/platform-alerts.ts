import type { EmailProvider } from "@workspace/providers";
import { and, eq, isNull } from "drizzle-orm";
import type { ControlDb } from "./client";
import { platformAdmins, tenants, user } from "./control";
import type { CompanyMigrationFailure } from "./migrate";

/** The email addresses of every active platform admin. */
async function platformAdminEmails(control: ControlDb): Promise<string[]> {
  const rows = await control
    .select({ email: user.email })
    .from(platformAdmins)
    .innerJoin(user, eq(user.id, platformAdmins.userId))
    .where(and(eq(platformAdmins.active, true), isNull(platformAdmins.deletedAt)));
  return rows.map((row) => row.email);
}

/** Where a company whose migration failed stands, as the alert and the migrate script word it. */
export type MigrationFailureStanding = "maintenance" | "serving_reads" | "unavailable";

/**
 * Where a failed company stands (docs/specs/platform-admin.md, "How pnpm db:migrate handles a
 * failure"; ADR 0053): in maintenance mode; out of it with a read-only database that still serves
 * reads on a half-migrated schema; or out of it with a database marked as not ready, so nobody can
 * open the company.
 */
export function failureStanding(
  failure: Pick<CompanyMigrationFailure, "maintenance" | "readOnly">,
): MigrationFailureStanding {
  if (failure.maintenance) return "maintenance";
  return failure.readOnly ? "serving_reads" : "unavailable";
}

/** How to turn maintenance on by hand, so the next successful run still ends it. */
const BY_HAND =
  "Turn maintenance mode on by hand (tenants.maintenance_mode = true, maintenance_reason = 'migration_failed', so the next successful run ends it).";

/** The first lines of the alert, by where the company stands. */
function standingLines(name: string, standing: MigrationFailureStanding): string[] {
  if (standing === "maintenance") {
    return [
      `The company database of ${name} failed to migrate, so the company is in maintenance mode.`,
      'Its people see an "under maintenance" message and cannot read or change anything.',
    ];
  }
  const failed = `The company database of ${name} failed to migrate and maintenance mode could not be turned on.`;
  return standing === "serving_reads"
    ? [failed, "The database is read-only, so its people may still read a half-updated database.", BY_HAND]
    : [failed, "The database is marked as not ready, so its people can't open the company until it is fixed.", BY_HAND];
}

/**
 * Emails every active platform admin that a company's migration failed and where the company
 * stands now (owner decision, 2026-11-13; ADR 0053): in maintenance mode, or NOT, with what to do
 * by hand. One email per admin, so no admin sees another's address. The email carries only the
 * error code: the full text can quote company data, so it stays in tenant_databases.last_error,
 * or, when it could not be saved there, only in the output of pnpm db:migrate (PR #10 review).
 */
export async function alertMigrationFailure(
  control: ControlDb,
  email: EmailProvider,
  from: string,
  failure: CompanyMigrationFailure,
): Promise<number> {
  const [company] = await control
    .select({ name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, failure.tenantId));
  // On one line, so a company name can never add a header (PR #10 review).
  const name = (company ? `${company.name} (${company.slug})` : failure.tenantId).replace(/[\r\n]+/g, " ");
  const standing = failureStanding(failure);
  const where = failure.recorded
    ? " The full error is in tenant_databases.last_error."
    : " The error text could not be saved; it is only in the output of pnpm db:migrate.";
  const recipients = await platformAdminEmails(control);
  let sent = 0;
  for (const to of recipients) {
    // One admin's failed send never stops the others (PR #10 review).
    try {
      await email.send({
        from,
        to: [to],
        subject: `Migration failed: ${name} ${standing === "maintenance" ? "is" : "is NOT"} in maintenance mode`,
        text: [
          ...standingLines(name, standing),
          "",
          `Error code: ${failure.code ?? "none"}.${where}`,
          "",
          "Fix the cause and run the migration again (pnpm db:migrate). A successful run ends maintenance mode.",
        ].join("\n"),
        idempotencyKey: `migration-failed|${failure.tenantId}|${to}|${new Date().toISOString().slice(0, 13)}`,
      });
      sent += 1;
    } catch {
      console.error("An alert email to a platform admin could not be sent.");
    }
  }
  return sent;
}
