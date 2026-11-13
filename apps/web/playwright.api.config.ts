import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the real sign-in (P8): a web build made with NEXT_PUBLIC_DATA_SOURCE=api,
 * apps/api, and the local PostgreSQL with Summit seeded. First build both apps
 * (`NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build` and `pnpm --filter api build`) and run
 * `pnpm db:seed` with SEED_USER_PASSWORD set; then `pnpm --filter web test:e2e:api`. The tests
 * sign in with SEED_USER_PASSWORD, and global-setup.ts resets the seeded accounts' MFA first. Local values come from the root .env and .env.local when they
 * exist.
 */
for (const file of ["../../.env", "../../.env.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
// The API needs a signing secret; a run without one gets a throwaway value.
process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString("base64url");

const LOCAL = "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e-api",
  globalSetup: "./tests/e2e-api/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 15_000 },
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: LOCAL,
    trace: "retain-on-failure",
    channel: process.env.CI ? undefined : "chrome",
  },
  projects: [{ name: "api", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: "pnpm --filter api start",
      url: "http://localhost:4000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    { command: "pnpm start", url: `${LOCAL}/login`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
