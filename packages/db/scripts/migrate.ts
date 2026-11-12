import { migrateAllCompanies, migrateControl, openControlDb } from "../src";
import { scriptEnv } from "./env";

/** Migrates the control database, then every company database, stopping at the first failure (blueprint p13). */
async function main(): Promise<void> {
  const env = scriptEnv();
  await migrateControl(env.controlUrl);
  console.log("Control database is up to date.");
  const control = openControlDb(env.controlUrl, { max: 1 });
  try {
    const results = await migrateAllCompanies(control.db, env.encryptionKey);
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
