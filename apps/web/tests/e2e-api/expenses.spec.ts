import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, seedPassword } from "./accounts";

const pdf = {
  name: "receipt.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 receipt for the api test\n%%EOF\n"),
};

/**
 * Expenses on the real API (P12 part 2; ADR 0041): Summit's expenses, vendors and locations come
 * from its own database, and a recorded expense is saved, numbered and posted by apps/api. The
 * store manager sees the expenses of the Denver branch and needs no MFA.
 */
test.describe("expenses (api mode)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER_EMAIL);
    await page.getByLabel("Password").fill(seedPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });

  test("a manager sees the branch's expenses with their vendors from the API", async ({ page }) => {
    await page.goto("/finance?view=expenses");
    await expect(page.getByRole("row", { name: /EXP-0001/ })).toContainText("Redrock Property Management");
  });

  test("won't record without a receipt, saves a draft, then records one with its receipt", async ({ page }) => {
    await page.goto("/finance?view=expenses");
    await page.getByRole("button", { name: "New expense" }).click();
    await page.getByRole("dialog").getByLabel("Location").click();
    await page.getByRole("option", { name: "Denver Central" }).click();
    await page.getByLabel("Amount before tax").fill("42.50");
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Attach the receipt, statement or lease.");
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible();

    await page.getByRole("button", { name: "New expense" }).click();
    // A branch manager records at a location in their own branch (PR #20 security review).
    await page.getByRole("dialog").getByLabel("Location").click();
    await page.getByRole("option", { name: "Denver Central" }).click();
    await page.getByLabel("Amount before tax").fill("37.25");
    await page.locator('input[type="file"]').setInputFiles(pdf);
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByText(/^Expense EXP-\d+ recorded$/)).toBeVisible();
  });
});
