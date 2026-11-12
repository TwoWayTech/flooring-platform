import type { DatabaseProvisioner } from "@workspace/providers";
import { eq } from "drizzle-orm";
import type { ControlDb } from "./client";
import { tenantDatabases } from "./control";
import { decryptSecret, encryptSecret } from "./crypto";
import { migrateCompany } from "./migrate";

/** What provisioning needs to know about the company. */
export interface ProvisionCompanyInput {
  tenantId: string;
  slug: string;
  provider: string;
}

/**
 * Gives a company its own database and brings it to the current schema (blueprint p13, steps
 * 2, 3 and 5): create through the DatabaseProvisioner, store the connection string encrypted,
 * migrate, record the version. Running it again for a company that has a database only migrates.
 * Returns the plain connection URL for the caller's next step (seeding); it is never logged.
 */
export async function provisionCompany(
  control: ControlDb,
  provisioner: DatabaseProvisioner,
  encryptionKey: string,
  input: ProvisionCompanyInput,
): Promise<string> {
  const [existing] = await control.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, input.tenantId));
  const url = existing
    ? decryptSecret(existing.encryptedUrl, encryptionKey)
    : await createDatabase(control, provisioner, encryptionKey, input);
  const version = await migrateCompany(url);
  await control
    .update(tenantDatabases)
    .set({ status: "ready", schemaVersion: version, migratedAt: new Date(), lastError: null })
    .where(eq(tenantDatabases.tenantId, input.tenantId));
  return url;
}

async function createDatabase(
  control: ControlDb,
  provisioner: DatabaseProvisioner,
  encryptionKey: string,
  input: ProvisionCompanyInput,
): Promise<string> {
  const created = await provisioner.create({ tenantId: input.tenantId, slug: input.slug });
  await control.insert(tenantDatabases).values({
    tenantId: input.tenantId,
    provider: input.provider,
    providerRef: created.providerRef,
    encryptedUrl: encryptSecret(created.connectionUrl, encryptionKey),
    status: "provisioning",
  });
  return created.connectionUrl;
}
