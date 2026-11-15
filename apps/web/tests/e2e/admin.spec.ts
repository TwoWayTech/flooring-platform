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
    // Outside a company workspace the console has one date format, "MMM d, yyyy" (useFormatDate).
    await expect(page.getByText(/^since [A-Z][a-z]{2} \d{1,2}, \d{4}$/)).toBeVisible();

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

  test("the console's Support tab and audit log record a request and a saved change", async ({ page }) => {
    await page.goto("/login?product=flooring");
    await page.getByRole("button", { name: /Platform admin \(you\)/ }).click();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Sign in as platform admin" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("row", { name: /Summit Floor Co\./ }).click();

    await page.getByRole("checkbox", { name: "View sensitive margins" }).uncheck();
    await page.getByRole("button", { name: "Save access" }).click();
    await expect(page.getByText(/Access saved for Summit Floor Co\./)).toBeVisible();

    await page.getByRole("link", { name: "Support" }).click();
    const reason = `Checking the roles the Owner asked about ${Date.now()}`;
    await page.getByRole("button", { name: "Ask for support access" }).click();
    // Scoped to the form: the request table behind it has a "Reason, column options" button.
    const form = page.getByRole("dialog", { name: "Ask for support access" });
    await form.getByLabel("Reason").fill(reason);
    await form.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Support access requested.")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(reason) })).toContainText("Pending");
    await expect(page.getByRole("button", { name: "Ask for support access" })).toBeDisabled();

    await page.getByRole("navigation", { name: "Platform" }).getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    const summitRows = page.getByRole("row").filter({ hasText: "Summit Floor Co." });
    await expect(summitRows.filter({ hasText: "Changed company access" })).toBeVisible();
    await expect(summitRows.filter({ hasText: "Asked for support access" })).toBeVisible();

    await page.getByRole("combobox", { name: "Action" }).click();
    await page.getByRole("option", { name: "Asked for support access" }).click();
    await expect(page.getByRole("row", { name: /Asked for support access/ })).toHaveCount(1);
    await expect(page.getByRole("row", { name: /Changed company access/ })).toHaveCount(0);
    // Reasons and devices are free text, so the log has no export (spec part 3, C1).
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  });
});
