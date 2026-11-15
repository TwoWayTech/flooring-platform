import { expect, test } from "@playwright/test";
import { HARBOR_OWNER, signInAs, signInAsPlatformAdmin, skipIfFeatureOff, SUMMIT_OWNER, type Persona } from "./helpers";

/** Summit's store manager in the demo: holds Users but never the Owner's Billing or support decisions. */
const SUMMIT_MANAGER: Persona = { companyId: "summit", userId: "sm-usr-02", roleKey: "manager" };

// Platform admin part 4 in demo mode (docs/specs/platform-admin.md, "Part 4", "Demo mode"). The demo
// never shows the maintenance, unavailable or suspended screens or the banner, because its standing
// is always full; unit markup tests and tests/e2e-api/company-standing.spec.ts cover those.
test.describe("the Owner's billing and support access (demo)", () => {
  skipIfFeatureOff("settings.billing");

  test("the Owner reads Billing: plan, period and limits, and no prices", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/billing");
    const settingsNav = page.getByRole("navigation", { name: "Settings" });
    await expect(settingsNav.getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Flooring Pro" })).toBeVisible();
    await expect(page.getByText("Billed monthly")).toBeVisible();
    await expect(page.getByText(/^Current period ends /)).toBeVisible();
    await expect(page.getByText("16", { exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("$");
    await expect(page.getByRole("status", { name: "Account notice" })).toHaveCount(0);

    await page.getByRole("link", { name: "See seats in use" }).click();
    await expect(page).toHaveURL(/\/settings\/users$/);
  });

  test("Billing is the Owner's only", async ({ page }) => {
    await signInAs(page, SUMMIT_MANAGER, "/settings");
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Billing" })).toHaveCount(
      0,
    );
    await page.goto("/settings/billing");
    await expect(page.getByText("You don't have access to this page.")).toBeVisible();
    await page.goto("/settings/users");
    await expect(page.getByRole("heading", { name: "Support access" })).toHaveCount(0);
  });

  test("Harbor's Owner reads Billing on the HR host @hr", async ({ page }) => {
    await signInAs(page, HARBOR_OWNER, "/settings/billing");
    await expect(page.getByRole("heading", { name: "HR Standard" })).toBeVisible();
  });

  test("the Owner approves and revokes a support request from the console", async ({ page }) => {
    const reason = `Checking the roles the Owner asked about ${Date.now()}`;

    await signInAsPlatformAdmin(page, "/admin/companies/summit/support");
    await page.getByRole("button", { name: "Ask for support access" }).click();
    const form = page.getByRole("dialog", { name: "Ask for support access" });
    await form.getByLabel("Reason").fill(reason);
    await form.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Support access requested.")).toBeVisible();

    await signInAs(page, SUMMIT_OWNER, "/settings/users");
    await expect(page.getByRole("heading", { name: "Support access" })).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(reason) });
    await expect(row).toContainText("Platform admin");
    await expect(row).toContainText("Pending");

    await page.getByRole("button", { name: "Approve support access for Platform admin" }).click();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Support access approved.")).toBeVisible();
    await expect(row).toContainText("Approved");

    await page.getByRole("button", { name: "Revoke support access for Platform admin" }).click();
    await page.getByRole("button", { name: "Revoke access" }).click();
    await expect(page.getByText("Support access revoked.")).toBeVisible();
    await expect(row).toContainText("Revoked");

    await signInAsPlatformAdmin(page, "/admin/companies/summit/support");
    await expect(page.getByRole("row", { name: new RegExp(reason) })).toContainText("Revoked");
    await page.goto("/admin/audit");
    for (const action of ["Support access approved", "Support access revoked"]) {
      await expect(page.getByRole("row").filter({ hasText: action })).toContainText("The company's Owner");
    }
  });
});
