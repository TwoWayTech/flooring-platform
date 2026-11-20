import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

/**
 * Sign-in and security in the demo (ADR 0060): passkeys are simulated, with no browser prompt, and
 * any password confirms. The page is reached from the avatar menu.
 */
test.describe("sign-in and security (demo)", () => {
  test("adds, renames and removes a simulated passkey", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    await page.getByRole("button", { name: "Account: Dana Whitfield" }).click();
    await page.getByRole("menuitem", { name: "Sign-in and security" }).click();
    await expect(page).toHaveURL(/\/account\/security$/);
    await expect(page.getByRole("heading", { name: "Sign-in and security" })).toBeVisible();
    await expect(page.getByText("No passkeys yet.")).toBeVisible();

    await page.getByRole("button", { name: "Add a passkey" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Enter your password.");
    await page.getByLabel("Your password").fill("anything");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Demo: no real passkey is made, and no prompt opens.")).toBeVisible();
    await page.getByLabel("Passkey name").fill("Work laptop");
    await page.getByRole("button", { name: "Create passkey" }).click();
    const list = page.getByRole("list", { name: "Your passkeys" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("Work laptop");

    await page.getByRole("button", { name: "Rename Work laptop" }).click();
    await page.getByLabel("Passkey name").fill(" ");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Enter a name, such as the device it is on.");
    await page.getByLabel("Passkey name").fill("Office laptop");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(list).toContainText("Office laptop");

    await page.getByRole("button", { name: "Remove Office laptop" }).click();
    await page.getByRole("button", { name: "Remove passkey" }).click();
    await expect(page.getByText("No passkeys yet.")).toBeVisible();
  });
});
