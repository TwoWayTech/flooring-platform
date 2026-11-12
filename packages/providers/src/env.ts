import { z } from "zod";

const required = z.string().min(1);

const database = z.discriminatedUnion("DB_PROVIDER", [
  z.object({ DB_PROVIDER: z.literal("postgres"), TENANT_DB_ADMIN_URL: required }),
  z.object({
    DB_PROVIDER: z.literal("neon"),
    NEON_API_KEY: required,
    NEON_REGION: z
      .string()
      .regex(/^aws-us-|^azure-.*us/, "Company databases must be in a US region.")
      .default("aws-us-east-2"),
  }),
  z.object({ DB_PROVIDER: z.literal("noop") }),
]);

const storage = z.discriminatedUnion("STORAGE_PROVIDER", [
  z.object({
    STORAGE_PROVIDER: z.enum(["r2", "s3"]),
    S3_BUCKET: required,
    S3_REGION: required,
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: required,
    S3_SECRET_ACCESS_KEY: required,
  }),
  z.object({ STORAGE_PROVIDER: z.literal("memory") }),
]);

const email = z.discriminatedUnion("EMAIL_PROVIDER", [
  z.object({ EMAIL_PROVIDER: z.literal("resend"), RESEND_API_KEY: required, EMAIL_FROM: required }),
  z.object({ EMAIL_PROVIDER: z.literal("memory") }),
]);

/**
 * The provider choices, all from environment variables (blueprint "Provider portability", rule
 * 6). Each choice lists the settings it needs, so a missing key fails at start-up, not mid-request.
 */
export const providerEnvSchema = z.object({ database, storage, email });

/** Parsed provider settings. */
export type ProviderEnv = z.infer<typeof providerEnvSchema>;

function sections(env: Record<string, string | undefined>) {
  const withDefaults = {
    ...env,
    DB_PROVIDER: env.DB_PROVIDER ?? "postgres",
    STORAGE_PROVIDER: env.STORAGE_PROVIDER ?? "memory",
    EMAIL_PROVIDER: env.EMAIL_PROVIDER ?? "memory",
  };
  return { database: withDefaults, storage: withDefaults, email: withDefaults };
}

/** Reads and checks the provider settings from an environment object such as process.env. */
export function parseProviderEnv(env: Record<string, string | undefined>): ProviderEnv {
  return providerEnvSchema.parse(sections(env));
}

/** What is wrong with the provider settings, as `VARIABLE: problem` lines that never include a value. */
export function providerEnvIssues(env: Record<string, string | undefined>): string[] {
  const result = providerEnvSchema.safeParse(sections(env));
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.at(-1)?.toString()}: ${issue.message}`);
}
