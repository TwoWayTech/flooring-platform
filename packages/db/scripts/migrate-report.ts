import { failureStanding, type CompanyMigrationFailure } from "../src";

/** The parts of a failed company that the migrate script's line depends on. */
export type ReportedFailure = Pick<CompanyMigrationFailure, "tenantId" | "maintenance" | "readOnly">;

/**
 * How the migrate script words the platform admins' alert: how many were emailed; NOT emailed when
 * the memory adapter delivers nothing, rather than claim admins were told (PR #10 review); or NOT
 * emailed because the alert itself failed (`sent` is null).
 */
export function alertPhrase(sent: number | null, delivers: boolean): string {
  if (sent === null) return "0 platform admin(s) NOT emailed (the alert failed)";
  return `${sent} platform admin(s) ${delivers ? "emailed" : "NOT emailed (EMAIL_PROVIDER is memory)"}`;
}

/**
 * The line pnpm db:migrate prints for a failed company (docs/specs/platform-admin.md, "How pnpm
 * db:migrate handles a failure"; ADR 0053): whether it is in maintenance mode and, when it is NOT,
 * whether its read-only database still serves reads and how to turn maintenance on by hand.
 */
export function failureLine(failure: ReportedFailure, alert: string): string {
  const standing = failureStanding(failure);
  if (standing === "maintenance") return `Company ${failure.tenantId} is in maintenance mode; ${alert}.`;
  const reads = standing === "serving_reads" ? " and its read-only database still serves reads" : "";
  return `Company ${failure.tenantId} is NOT in maintenance mode${reads}: turn it on by hand (tenants.maintenance_mode, reason migration_failed); ${alert}.`;
}

/**
 * Sends the alert, then prints where the company stands, even when the alert throws. Both writes
 * failing usually means the control database is unreachable, so the alert fails on its first query
 * too, and this line is then the only place that says the company is NOT in maintenance mode
 * (docs/specs/platform-admin.md, "Edge cases and known limits (part 3)"; AC34). The alert's error
 * still propagates, so migrateAllCompanies logs it.
 */
export async function reportMigrationFailure(
  failure: ReportedFailure,
  delivers: boolean,
  alert: () => Promise<number>,
  print: (line: string) => void = console.error,
): Promise<void> {
  let sent: number | null = null;
  try {
    sent = await alert();
  } finally {
    print(failureLine(failure, alertPhrase(sent, delivers)));
  }
}
