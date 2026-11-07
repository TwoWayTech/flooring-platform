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
});
