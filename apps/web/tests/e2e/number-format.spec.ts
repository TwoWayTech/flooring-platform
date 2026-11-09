import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("settings: number format", () => {
  test("money decimals change the display, not the totals, and hover shows the full value", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales?view=invoices");
    await page.getByPlaceholder("Search invoices and customers").fill("INV-1150");
    // Find the Total column by its header, so added columns do not move the check.
    const headers = await page.locator("thead th").allTextContents();
    const total = page
      .getByRole("row", { name: /INV-1150/ })
      .getByRole("cell")
      .nth(headers.findIndex((h) => h.trim() === "Total"));
    await expect(total).toHaveText("$5,036.99");

    await page.goto("/settings/number-format");
    const fewer = page.getByRole("button", { name: "Fewer decimals for Money (prices, totals, balances)" });
    await fewer.click();
    await fewer.click();
    await page.getByRole("button", { name: "Save number format" }).click();
    await expect(page.getByText("Number format saved")).toBeVisible();

    await page.goto("/sales?view=invoices");
    await page.getByPlaceholder("Search invoices and customers").fill("INV-1150");
    // The search is written to the address; hover after that re-render, or it closes the tooltip.
    await expect(page).toHaveURL(/INV-1150/);
    await expect(total).toHaveText("$5,037");
    await total.getByText("$5,037").hover();
    await expect(page.getByRole("tooltip")).toContainText("$5,036.99");

    await page.goto("/sales/invoices/sm-inv-0150");
    await expect(page.getByText("Balance due").locator("..")).toContainText("$0");
  });
});
