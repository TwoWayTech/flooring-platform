import { defineConfig, devices } from "@playwright/test";

const LOCAL = "http://localhost:3000";

/**
 * Each product is its own Playwright project with its own address. Set E2E_FLOORING_URL and
 * E2E_HR_URL to test a deployment; unset, both use a local production server (`pnpm build` first),
 * where `?product=hr` stands in for the HR host. HR tests carry the @hr tag; every other test is a
 * Flooring test. E2E_WORKERS sets the worker count (default 2, kind to a laptop's memory).
 */
const flooringURL = process.env.E2E_FLOORING_URL ?? LOCAL;
const hrURL = process.env.E2E_HR_URL ?? LOCAL;
const usesLocal = flooringURL === LOCAL || hrURL === LOCAL;
/** A deployment is slower and less predictable than the local server, so remote runs retry and wait longer. */
const remote = flooringURL !== LOCAL || hrURL !== LOCAL;

const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

/** End-to-end tests for the spec's acceptance checks (spec section 6), per product. */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  expect: { timeout: remote ? 30_000 : 15_000 },
  timeout: remote ? 180_000 : 60_000,
  retries: remote ? 2 : process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    navigationTimeout: remote ? 90_000 : undefined,
    // Locally the installed Chrome avoids a 200 MB browser download; CI uses Playwright's own build.
    channel: process.env.CI ? undefined : "chrome",
  },
  projects: [
    { name: "flooring", use: { ...desktop, baseURL: flooringURL }, grepInvert: /@hr/ },
    { name: "hr", use: { ...desktop, baseURL: hrURL }, grep: /@hr/ },
  ],
  webServer: usesLocal
    ? { command: "pnpm start", url: `${LOCAL}/login`, reuseExistingServer: true, timeout: 120_000 }
    : undefined,
});
