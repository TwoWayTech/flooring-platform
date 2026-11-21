import { createProviders } from "@workspace/providers";
import { SEED_PLATFORM_ADMIN, seedLocalTestData, seedTestCompany, type SeedOptions } from "../src/seed";
import { scriptEnv } from "./env";

/**
 * Seeds the test company (Summit Floor Co.) into the control database and its own company
 * database, then, for local testing only, the HR Suite company Harbor Staffing Co. and a platform
 * admin (ADR 0065). The second step refuses a control database that is not on this machine.
 */
async function main(): Promise<void> {
  const env = scriptEnv();
  const { database } = createProviders({
    ...process.env,
    DB_PROVIDER: env.provider,
    TENANT_DB_ADMIN_URL: env.adminUrl,
  });
  const options: SeedOptions = {
    controlUrl: env.controlUrl,
    encryptionKey: env.encryptionKey,
    provisioner: database,
    provider: env.provider,
    userPassword: env.userPassword,
  };
  const tenantId = await seedTestCompany(options);
  if (!env.userPassword) console.log("SEED_USER_PASSWORD is not set, so the seeded users have no password.");
  console.log(`Seeded Summit Floor Co. (tenant ${tenantId}).`);
  const local = await seedLocalTestData(options);
  console.log(`Seeded Harbor Staffing Co. (tenant ${local.harborTenantId}), for local testing only.`);
  console.log(`Seeded the platform admin ${SEED_PLATFORM_ADMIN.email}, for local testing only.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
