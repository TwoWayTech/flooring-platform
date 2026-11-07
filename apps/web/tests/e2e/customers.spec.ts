import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("customers and receivables", () => {
  test("lists expiring certificates from the attention link and opens a statement", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales?view=customers&filter=certificates");
    await expect(page.getByText("2 of 2")).toBeVisible();
    await expect(page.getByText(/^Expires in \d+ days$/).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Receivables aging" })).toContainText("Over 90 days");

    await page.getByRole("row").nth(1).click();
    await expect(page.getByRole("heading", { name: "Statement" })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Credit limit")).toBeVisible();
  });

  test("hides credit limits when viewing as Sales", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales?view=customers");
    await expect(page.getByRole("button", { name: "Credit limit, column options" })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Sales");
    await page.getByRole("option", { name: "View as Sales" }).click();
    await expect(page.getByRole("button", { name: "Open balance, column options" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Credit limit, column options" })).toHaveCount(0);
  });
});
