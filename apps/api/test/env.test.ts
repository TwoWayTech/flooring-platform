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

  it("needs exact sign-in hosts in production, without wildcards", () => {
    const production = { ...base, NODE_ENV: "production" };
    expect(() => validateEnv(production)).toThrow(/AUTH_ALLOWED_HOSTS: Required in production/);
    expect(() => validateEnv({ ...production, AUTH_ALLOWED_HOSTS: "app.example.com, *.vercel.app" })).toThrow(
      /AUTH_ALLOWED_HOSTS: Wildcards are not allowed/,
    );
    const complete = { ...production, AUTH_PROXY_SECRET: "s".repeat(32), PASSKEY_RP_ID: "example.com" };
    expect(validateEnv({ ...complete, AUTH_ALLOWED_HOSTS: "app.example.com" }).AUTH_ALLOWED_HOSTS).toEqual([
      "app.example.com",
    ]);
  });

  it("needs the proxy secret and the passkey domain in production (ADR 0029, part 2)", () => {
    const production = { ...base, NODE_ENV: "production", AUTH_ALLOWED_HOSTS: "app.example.com" };
    expect(() => validateEnv(production)).toThrow(/AUTH_PROXY_SECRET: Required in production/);
    expect(() => validateEnv(production)).toThrow(/PASSKEY_RP_ID: Required in production/);
    expect(() => validateEnv({ ...production, AUTH_PROXY_SECRET: "too-short", PASSKEY_RP_ID: "example.com" })).toThrow(
      /AUTH_PROXY_SECRET: Must be at least 32 characters/,
    );
  });

  it("checks the provider settings too", () => {
    expect(() => validateEnv({ ...base, EMAIL_PROVIDER: "resend" })).toThrow(/RESEND_API_KEY/);
  });
});
