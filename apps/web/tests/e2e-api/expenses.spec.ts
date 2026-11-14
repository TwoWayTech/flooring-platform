import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, signInAs } from "./accounts";

const pdf = {
  name: "receipt.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 receipt for the api test\n%%EOF\n"),
};

/**
 * Expenses on the real API (P12 part 2; ADR 0041): Summit's expenses, vendors and locations come
 * from its own database, and a recorded expense is saved, numbered and posted by apps/api. The
 * store manager sees the Denver branch and needs no MFA. One test signs in once, so the run stays
 * inside the sign-in rate limit the other specs share.
 */
test.describe("expenses (api mode)", () => {
  test("a manager sees the branch's expenses, saves a draft and records one with its receipt", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);

    await page.goto("/finance?view=expenses");
    await expect(page.getByRole("row", { name: /EXP-0001/ })).toContainText("Redrock Property Management");

    // A branch manager records at a location in their own branch (PR #20 security review).
    await page.getByRole("button", { name: "New expense" }).click();
    await page.getByRole("dialog").getByLabel("Location").click();
    await page.getByRole("option", { name: "Denver Central" }).click();
    await page.getByLabel("Amount before tax").fill("42.50");
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Attach the receipt, statement or lease.");
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible();

    await page.getByRole("button", { name: "New expense" }).click();
    await page.getByRole("dialog").getByLabel("Location").click();
    await page.getByRole("option", { name: "Denver Central" }).click();
    await page.getByLabel("Amount before tax").fill("37.25");
    await page.locator('input[type="file"]').setInputFiles(pdf);
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByText(/^Expense EXP-\d+ recorded$/)).toBeVisible();
  });
});
