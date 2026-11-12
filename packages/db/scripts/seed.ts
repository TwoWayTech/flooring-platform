import { createProviders } from "@workspace/providers";
import { seedTestCompany } from "../src/seed";
import { scriptEnv } from "./env";

/** Seeds the test company (Summit Floor Co.) into the control database and its own company database. */
async function main(): Promise<void> {
  const env = scriptEnv();
  const { database } = createProviders({
    ...process.env,
    DB_PROVIDER: env.provider,
    TENANT_DB_ADMIN_URL: env.adminUrl,
  });
  const tenantId = await seedTestCompany({
    controlUrl: env.controlUrl,
    encryptionKey: env.encryptionKey,
    provisioner: database,
    provider: env.provider,
    userPassword: env.userPassword,
  });
  if (!env.userPassword) console.log("SEED_USER_PASSWORD is not set, so the seeded users have no password.");
  console.log(`Seeded Summit Floor Co. (tenant ${tenantId}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
