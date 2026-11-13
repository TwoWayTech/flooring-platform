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

/**
 * Emails every active platform admin that a company's migration failed and the company is now in
 * maintenance mode (owner decision, 2026-11-13). One email per admin, so no admin sees another's
 * address. The email carries only the error code: the full text can name a database host or user,
 * so it stays in tenant_databases.last_error and platform_audit_log (PR #10 review).
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
  const name = company ? `${company.name} (${company.slug})` : failure.tenantId;
  const recipients = await platformAdminEmails(control);
  for (const to of recipients) {
    await email.send({
      from,
      to: [to],
      subject: `Migration failed: ${name} is in maintenance mode`,
      text: [
        `The company database of ${name} failed to migrate, so the company is in maintenance mode.`,
        'Its people see an "under maintenance" message and cannot read or change anything.',
        "",
        `Error code: ${failure.code ?? "none"}. The full error is in tenant_databases.last_error and platform_audit_log.`,
        "",
        "Fix the cause and run the migration again (pnpm db:migrate). A successful run ends maintenance mode.",
      ].join("\n"),
      idempotencyKey: `migration-failed|${failure.tenantId}|${to}|${new Date().toISOString().slice(0, 13)}`,
    });
  }
  return recipients.length;
}
