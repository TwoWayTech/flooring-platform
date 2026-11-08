import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

const SUMMIT_MANAGER = { companyId: "summit", userId: "sm-usr-02", roleKey: "manager" } as const;

test.describe("settings: security roles", () => {
  test("locks the Owner role and greys out permissions outside the plan", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/roles");
    await page.getByRole("button", { name: /Locked Owner/ }).click();
    await expect(page.getByText(/The Owner role always holds everything in your plan/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save role" })).toHaveCount(0);

    await page.getByRole("button", { name: /^Manager/ }).click();
    const excluded = page.getByRole("checkbox", { name: "Delete customers, Not included in your plan" });
    await expect(excluded).toBeDisabled();
  });

  test("blocks granting a permission the editor does not hold", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/roles");
    await page.getByRole("button", { name: /^Manager/ }).click();
    await page.getByRole("checkbox", { name: "View security roles" }).check();
    await page.getByRole("checkbox", { name: "Manage security roles" }).check();
    await page.getByRole("button", { name: "Save role" }).click();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Role Manager saved")).toBeVisible();

    await signInAs(page, SUMMIT_MANAGER, "/settings/roles");
    await page.getByRole("button", { name: /^Sales/ }).click();
    const branding = page.getByRole("checkbox", { name: "Manage branding, You can only grant permissions you hold" });
    await expect(branding).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "View quotes" })).toBeEnabled();
  });

  test("an Owner removes a page from the Sales role, and Sales no longer sees it (spec A3)", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/roles");
    await page.getByRole("button", { name: /^Sales/ }).click();
    await expect(page.getByText("System", { exact: true }).first()).toBeVisible();
    await page.getByRole("checkbox", { name: "View products" }).uncheck();
    await page.getByRole("checkbox", { name: "View rolls" }).uncheck();
    await page.getByRole("button", { name: "Save role" }).click();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Role Sales saved")).toBeVisible();

    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Sales");
    await page.getByRole("option", { name: "View as Sales" }).click();
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Sales" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Inventory" })).toHaveCount(0);
    await page.goto("/inventory/rolls/sm-roll-0004");
    await expect(page.getByText("You don't have access to this page.")).toBeVisible();
  });

  test("resets a default role, duplicates a role and previews effective access", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/roles");
    await page.getByRole("button", { name: /^Warehouse/ }).click();
    await page.getByRole("checkbox", { name: "Cut rolls" }).uncheck();
    await page.getByRole("button", { name: "Save role" }).click();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Role Warehouse saved")).toBeVisible();
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByText("Role Warehouse reset to its default permissions")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Cut rolls" })).toBeChecked();

    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByRole("button", { name: /Copy of Warehouse/ })).toBeVisible();

    const preview = page.getByRole("combobox", { name: "Preview access for" });
    await preview.click();
    await page.getByRole("option", { name: "Installer" }).click();
    const pages = page.getByRole("region", { name: "Pages" });
    await expect(pages.getByText("Installation, allowed")).toBeAttached();
    await expect(pages.getByText("Purchasing, not allowed")).toBeAttached();
  });
});
