import { describe, expect, it } from "vitest";
import { validateEnv } from "../src/core/config/env";

const key = Buffer.alloc(32, 7).toString("base64");
const base = {
  CONTROL_DATABASE_URL: "postgres://u:p@localhost:5432/control",
  CONNECTION_ENCRYPTION_KEY: key,
  TENANT_DB_ADMIN_URL: "postgres://u:p@localhost:5432/postgres",
  BETTER_AUTH_SECRET: "test-only-secret-that-is-at-least-32-chars",
};

describe("validateEnv", () => {
  it("applies defaults and splits the allowed origins", () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: "http://localhost:3000, https://app.example.com" });
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3000", "https://app.example.com"]);
    expect(env.providers.storage.STORAGE_PROVIDER).toBe("memory");
  });

  it("refuses to start without the control database or with a short key, naming only the variable", () => {
    expect(() => validateEnv({ CONNECTION_ENCRYPTION_KEY: key })).toThrow(/CONTROL_DATABASE_URL/);
    expect(() => validateEnv({ ...base, CONNECTION_ENCRYPTION_KEY: "c2hvcnQ=" })).toThrow(/CONNECTION_ENCRYPTION_KEY/);
    expect(() => validateEnv({ ...base, CONNECTION_ENCRYPTION_KEY: "c2hvcnQ=" })).not.toThrow(/c2hvcnQ/);
  });

  it("needs a Better Auth secret of at least 32 characters and splits the allowed sign-in hosts", () => {
    expect(() => validateEnv({ ...base, BETTER_AUTH_SECRET: undefined })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => validateEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(validateEnv(base).AUTH_ALLOWED_HOSTS).toEqual(["localhost:*"]);
    expect(validateEnv({ ...base, AUTH_ALLOWED_HOSTS: "a.example.com, *.vercel.app" }).AUTH_ALLOWED_HOSTS).toEqual([
      "a.example.com",
      "*.vercel.app",
    ]);
  });

  it("checks the provider settings too", () => {
    expect(() => validateEnv({ ...base, EMAIL_PROVIDER: "resend" })).toThrow(/RESEND_API_KEY/);
  });
});
