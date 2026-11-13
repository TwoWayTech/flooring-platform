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
  /** Signs Better Auth cookies and tokens. At least 32 characters; generate with `npx auth secret`. */
  BETTER_AUTH_SECRET: z.string().min(32, "Must be at least 32 characters."),
  /**
   * Web hosts that serve the sign-in page, comma-separated. Better Auth builds verification links
   * and checks origins from them (ADR 0029). Wildcards such as `localhost:*` are for development only.
   */
  AUTH_ALLOWED_HOSTS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean),
    ),
  /** Shown by /health so a deploy can be checked; set by the image build. */
  APP_VERSION: z.string().default("dev"),
});

/** The sign-in hosts used outside production when AUTH_ALLOWED_HOSTS is unset. */
const DEV_ALLOWED_HOSTS = ["localhost:*"];

/**
 * Production must list its exact sign-in hosts. The API trusts the forwarded host, so a wildcard
 * such as `*.vercel.app` would let anyone with a matching host receive our verification (and later
 * reset) links, and a missing value would trust `localhost:*`.
 */
function allowedHostsIssues(env: z.infer<typeof apiEnvSchema>): string[] {
  if (env.NODE_ENV !== "production") return [];
  if (env.AUTH_ALLOWED_HOSTS.length === 0) return ["AUTH_ALLOWED_HOSTS: Required in production."];
  return env.AUTH_ALLOWED_HOSTS.some((host) => host.includes("*"))
    ? ["AUTH_ALLOWED_HOSTS: Wildcards are not allowed in production."]
    : [];
}

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
    ...(parsed.success ? allowedHostsIssues(parsed.data) : []),
    ...providerEnvIssues(env),
  ];
  if (!parsed.success || problems.length > 0) throw new Error(`Invalid API environment. ${problems.join("; ")}`);
  const allowedHosts = parsed.data.AUTH_ALLOWED_HOSTS;
  return {
    ...parsed.data,
    AUTH_ALLOWED_HOSTS: allowedHosts.length > 0 ? allowedHosts : DEV_ALLOWED_HOSTS,
    providers: parseProviderEnv(env),
  };
}
