import { parseArgs } from "node:util";
import type { ProductKey } from "@workspace/shared";
import { createProviders } from "@workspace/providers";
import { migrateControl, openControlDb, provisionTenant } from "../src";
import { scriptEnv } from "./env";

const USAGE = `Usage: pnpm db:provision-tenant --slug summit2 --name "Summit Floor Co." --legal-name "Summit Floor Co. LLC"
  --state TX --time-zone America/Chicago --products flooring --owner-name "Pat Owner" --owner-email pat@example.test
  [--city Austin] [--reuse-owner: make an existing account the owner]`;

const PRODUCTS: readonly ProductKey[] = ["flooring", "hr"];

/** The products named on the command line, checked against the products the platform sells. */
function productList(value: string): ProductKey[] {
  const keys = value.split(",").map((key) => key.trim());
  const unknown = keys.filter((key) => !(PRODUCTS as readonly string[]).includes(key));
  if (unknown.length > 0) throw new Error(`Unknown product(s): ${unknown.join(", ")}. Use flooring and/or hr.`);
  return keys as ProductKey[];
}

/**
 * Creates one company with its own database (blueprint p13, P9). The provider comes from
 * DB_PROVIDER (local: the docker-compose server). Prints the ids, never a connection string.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      slug: { type: "string" },
      name: { type: "string" },
      "legal-name": { type: "string" },
      state: { type: "string" },
      city: { type: "string" },
      "time-zone": { type: "string" },
      products: { type: "string" },
      "owner-name": { type: "string" },
      "owner-email": { type: "string" },
      "reuse-owner": { type: "boolean" },
    },
  });
  const required = [
    "slug",
    "name",
    "legal-name",
    "state",
    "time-zone",
    "products",
    "owner-name",
    "owner-email",
  ] as const;
  const missing = required.filter((key) => !values[key]);
  if (missing.length > 0) throw new Error(`Missing --${missing.join(", --")}.\n${USAGE}`);
  const env = scriptEnv();
  const { database } = createProviders({
    ...process.env,
    DB_PROVIDER: env.provider,
    TENANT_DB_ADMIN_URL: env.adminUrl,
  });
  await migrateControl(env.controlUrl);
  const control = openControlDb(env.controlUrl, { max: 1 });
  try {
    const result = await provisionTenant(control.db, database, env.encryptionKey, env.provider, {
      slug: values.slug as string,
      name: values.name as string,
      legalName: values["legal-name"] as string,
      state: (values.state as string).toUpperCase(),
      city: values.city,
      timeZone: values["time-zone"] as string,
      products: productList(values.products as string),
      owner: { name: values["owner-name"] as string, email: values["owner-email"] as string },
      reuseExistingOwner: values["reuse-owner"] === true,
    });
    console.log(`${result.resumed ? "Finished" : "Created"} company ${values.slug} (tenant ${result.tenantId}).`);
    console.log(`Owner user ${result.ownerUserId} has no password yet; invitation acceptance comes later (STATUS).`);
  } finally {
    await control.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
