import { emailFor, parseProviderEnv } from "@workspace/providers";
import { alertMigrationFailure, migrateAllCompanies, migrateControl, openControlDb } from "../src";
import { scriptEnv } from "./env";
import { reportMigrationFailure } from "./migrate-report";

/** Sender for the alert when EMAIL_FROM is not set, which only the memory adapter allows; nothing is sent. */
const LOCAL_SENDER = "no-reply@localhost";

/**
 * Migrates the control database, then every company database, stopping at the first failure (blueprint p13).
 * A failed company goes into maintenance mode and every active platform admin gets an email (owner
 * decision, 2026-11-13); the script then exits with an error. It says whether the company is in
 * maintenance mode, and what to do by hand when it is not, even when the alert itself fails, and
 * prints the error text only when it could not be saved to tenant_databases.last_error
 * (docs/specs/platform-admin.md, "How pnpm db:migrate handles a failure"; ADR 0053).
 */
async function main(): Promise<void> {
  const env = scriptEnv();
  const emailEnv = parseProviderEnv({ ...process.env, DB_PROVIDER: "noop" }).email;
  const email = emailFor(emailEnv);
  const from = emailEnv.EMAIL_PROVIDER === "resend" ? emailEnv.EMAIL_FROM : LOCAL_SENDER;
  await migrateControl(env.controlUrl);
  console.log("Control database is up to date.");
  const control = openControlDb(env.controlUrl, { max: 1 });
  try {
    const results = await migrateAllCompanies(control.db, env.encryptionKey, {
      // Only Resend delivers; the memory adapter sends nothing.
      onFailure: (failure) =>
        reportMigrationFailure(failure, emailEnv.EMAIL_PROVIDER === "resend", () =>
          alertMigrationFailure(control.db, email, from, failure),
        ),
    });
    for (const result of results) console.log(`Company ${result.tenantId}: ${result.version}`);
    console.log(`${results.length} company database(s) up to date.`);
  } finally {
    await control.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
