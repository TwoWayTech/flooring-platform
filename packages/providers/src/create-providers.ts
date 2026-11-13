import { NeonProvisioner } from "./database/neon";
import { NoopProvisioner } from "./database/noop";
import { PostgresServerProvisioner } from "./database/postgres-server";
import type { DatabaseProvisioner } from "./database/types";
import { MemoryEmailProvider } from "./email/memory";
import { ResendEmailProvider } from "./email/resend";
import type { EmailProvider } from "./email/types";
import { parseProviderEnv, type ProviderEnv } from "./env";
import { MemoryStorageProvider } from "./storage/memory";
import { S3StorageProvider } from "./storage/s3";
import type { StorageProvider } from "./storage/types";

/** The outside services the API uses, each behind its interface. */
export interface Providers {
  database: DatabaseProvisioner;
  storage: StorageProvider;
  email: EmailProvider;
}

function databaseFor(env: ProviderEnv["database"]): DatabaseProvisioner {
  switch (env.DB_PROVIDER) {
    case "postgres":
      return new PostgresServerProvisioner(env.TENANT_DB_ADMIN_URL);
    case "neon":
      return new NeonProvisioner({ apiKey: env.NEON_API_KEY, region: env.NEON_REGION });
    case "noop":
      return new NoopProvisioner();
  }
}

function storageFor(env: ProviderEnv["storage"]): StorageProvider {
  if (env.STORAGE_PROVIDER === "memory") return new MemoryStorageProvider();
  return new S3StorageProvider({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
}

/** The email adapter EMAIL_PROVIDER asks for, for an app that needs only email. */
export function emailFor(env: ProviderEnv["email"]): EmailProvider {
  return env.EMAIL_PROVIDER === "memory" ? new MemoryEmailProvider() : new ResendEmailProvider(env.RESEND_API_KEY);
}

/** Builds the adapters the environment asks for (DB_PROVIDER, STORAGE_PROVIDER, EMAIL_PROVIDER). */
export function createProviders(env: Record<string, string | undefined>): Providers {
  const parsed = parseProviderEnv(env);
  return { database: databaseFor(parsed.database), storage: storageFor(parsed.storage), email: emailFor(parsed.email) };
}
