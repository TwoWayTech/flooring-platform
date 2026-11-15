import { expect, test, type Page } from "@playwright/test";
import { MANAGER_EMAIL, nextCode, OWNER_EMAIL, signInAndEnrolOwner, signInAs } from "./accounts";
import {
  allowSeededCeilingKey,
  removePlatformAdmin,
  resetAuthState,
  restoreCeilingRow,
  setPlatformAdmin,
  snapshotCeilingRow,
  type CeilingRowSnapshot,
} from "@workspace/db/testing";

/**
 * The permission this spec unticks and puts back. No other api spec changes "View sample checkout":
 * platform-support.spec.ts only checks that its box is disabled for the support role.
 */
const KEY = "retail.sample.view";
const BOX = "View sample checkout";
const SUMMIT = "Summit Floor Co.";

/** The control database the API uses (global-setup.ts checks it is set). */
const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "";

/** The "Permissions in effect" number the preview shows for the chosen role. */
async function permissionsInEffect(page: Page): Promise<number> {
  const text = await page.getByText("Permissions in effect").locator("xpath=following-sibling::dd").innerText();
  return Number(text);
}

// Platform admin part 1 on the real API (docs/specs/platform-admin.md; critic A6). The owner
// account is made a platform admin through the database, the console change is undone through the
// database (and reset to the seeded state first, after a stopped run), and the platform_admins row
// is removed afterwards. Global setup resets the owner's MFA and clears a leftover admin row at the
// start of every run.
test.describe("platform admin console (api mode)", () => {
  let before: CeilingRowSnapshot | null = null;

  test.beforeAll(async () => {
    // login.spec.ts, which runs first, enrols the owner's authenticator app; this test enrols its own.
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
    await setPlatformAdmin(CONTROL_URL, OWNER_EMAIL, "owner");
    // A run stopped before its afterAll leaves the box unticked, and re-seeding keeps that row.
    await allowSeededCeilingKey(CONTROL_URL, SUMMIT, KEY);
  });

  test.afterAll(async () => {
    if (before) await restoreCeilingRow(CONTROL_URL, before);
    await removePlatformAdmin(CONTROL_URL, OWNER_EMAIL);
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
  });

  test("an admin lists companies, opens Summit, unticks a permission and saves it after a step-up", async ({
    page,
  }) => {
    const secret = await signInAndEnrolOwner(page);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
    const row = page.getByRole("row", { name: /Summit Floor Co\./ });
    await expect(row).toContainText("Flooring Pro");
    await row.click();
    await expect(page).toHaveURL(/\/admin\/companies\/[0-9a-f-]{36}$/);
    const tenantId = page.url().split("/").pop() ?? "";
    await expect(page.getByRole("heading", { name: SUMMIT })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: BOX })).toBeChecked();

    // Taken before the save, so the afterAll puts the row back even if the save half-worked.
    before = await snapshotCeilingRow(CONTROL_URL, tenantId, KEY);
    const permissions = await permissionsInEffect(page);
    await page.getByRole("checkbox", { name: BOX }).uncheck();
    await expect.poll(() => permissionsInEffect(page)).toBe(permissions - 1);

    await page.getByRole("button", { name: "Save access" }).click();
    await page.getByLabel("Authenticator code").fill("000000");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("That code is not right.")).toBeVisible();
    await page.getByLabel("Authenticator code").fill(nextCode(secret));
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(`Access saved for ${SUMMIT}. It applies at once.`)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("checkbox", { name: BOX })).not.toBeChecked();

    // Import and the database page have not moved to the API, so in api mode they are not found,
    // not just missing from the tabs (spec "Screens"; review A7).
    for (const view of ["import", "database"]) {
      const response = await page.goto(`/admin/companies/${tenantId}/${view}`);
      expect({ view, status: response?.status() }).toEqual({ view, status: 404 });
      await expect(page.getByText("This page could not be found.")).toBeVisible();
    }
  });

  test("a company user who is not a platform admin is sent from /admin to /", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);
    const response = await page.goto("/admin");
    // The layout's redirect, before the home page sends a persona on to its own home.
    expect(response?.request().redirectedFrom()?.url()).toMatch(/\/admin$/);
    expect(new URL(response?.url() ?? "about:blank").pathname).toBe("/");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Companies" })).toHaveCount(0);
  });
});
