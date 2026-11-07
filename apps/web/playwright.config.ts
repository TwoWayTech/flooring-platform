import { defineConfig, devices } from "@playwright/test";

/** Set E2E_BASE_URL to test a production build or a deployment instead of the local dev server. */
const external = process.env.E2E_BASE_URL;

/** End-to-end tests for the spec's acceptance checks (spec section 6), run against the dev server. */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 3,
  expect: { timeout: 15_000 },
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: external ?? "http://localhost:3000",
    trace: "retain-on-failure",
    // Locally the installed Chrome avoids a 200 MB browser download; CI uses Playwright's own build.
    channel: process.env.CI ? undefined : "chrome",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      grepInvert: /@phone/,
    },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, grep: /@phone/ },
  ],
  webServer: external
    ? undefined
    : { command: "pnpm dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
});
