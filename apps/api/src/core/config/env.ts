import { providerEnvIssues, parseProviderEnv, type ProviderEnv } from "@workspace/providers";
import { z } from "zod";

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Comma-separated web origins allowed to call the API with cookies. */
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  CONTROL_DATABASE_URL: z.string().url(),
  /** 32 bytes, base64: encrypts company connection strings (blueprint "Security": secrets). */
  CONNECTION_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "Must be 32 bytes, base64-encoded."),
  /** Shown by /health so a deploy can be checked; set by the image build. */
  APP_VERSION: z.string().default("dev"),
});

/** The API's settings after checking: its own plus the provider choices. */
export type ApiEnv = z.infer<typeof apiEnvSchema> & { providers: ProviderEnv };

/**
 * Checks every setting at start-up so a missing or wrong one stops the API before it serves a
 * request (docs/environment.md lists them). The error names the variables, never their values.
 */
export function validateEnv(raw: Record<string, unknown>): ApiEnv {
  const env = raw as Record<string, string | undefined>;
  const parsed = apiEnvSchema.safeParse(env);
  const problems = [
    ...(parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)),
    ...providerEnvIssues(env),
  ];
  if (!parsed.success || problems.length > 0) throw new Error(`Invalid API environment. ${problems.join("; ")}`);
  return { ...parsed.data, providers: parseProviderEnv(env) };
}
