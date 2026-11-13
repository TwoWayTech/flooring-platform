import { emailFor, parseProviderEnv } from "@workspace/providers";
import { alertMigrationFailure, migrateAllCompanies, migrateControl, openControlDb } from "../src";
import { scriptEnv } from "./env";

/** Sender for the alert when EMAIL_FROM is not set, which only the memory adapter allows; nothing is sent. */
const LOCAL_SENDER = "no-reply@localhost";

/**
 * Migrates the control database, then every company database, stopping at the first failure (blueprint p13).
 * A failed company goes into maintenance mode and every active platform admin gets an email (owner
 * decision, 2026-11-13); the script then exits with an error.
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
      onFailure: async (failure) => {
        const alerted = await alertMigrationFailure(control.db, email, from, failure);
        // The memory adapter delivers nothing, so say so rather than claim admins were told (PR #10 review).
        const how = emailEnv.EMAIL_PROVIDER === "resend" ? "emailed" : "NOT emailed (EMAIL_PROVIDER is memory)";
        console.error(`Company ${failure.tenantId} is in maintenance mode; ${alerted} platform admin(s) ${how}.`);
      },
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
