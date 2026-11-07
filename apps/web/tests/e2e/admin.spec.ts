import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("super-admin", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("removing a permission from the ceiling hides it for that company at once", async ({ page }) => {
    await page.goto("/login?product=flooring");
    await page.getByRole("button", { name: /Platform admin \(you\)/ }).click();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Sign in as platform admin" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("row", { name: /Summit Floor Co\./ }).click();

    await page.getByRole("checkbox", { name: "View sensitive margins" }).uncheck();
    await expect(page.getByRole("region", { name: "Effective access preview" })).toBeVisible();
    await page.getByRole("button", { name: "Save access" }).click();
    await expect(page.getByText(/Access saved for Summit Floor Co\./)).toBeVisible();

    await signInAs(page, SUMMIT_OWNER, "/");
    await expect(page.getByText("Receivables")).toBeVisible();
    await expect(page.getByText("Gross margin")).toHaveCount(0);

    await page.goto("/settings/roles");
    await page.getByRole("button", { name: /^Accountant/ }).click();
    await expect(
      page.getByRole("checkbox", { name: "View sensitive margins, Not included in your plan" }),
    ).toBeDisabled();
  });
});
