import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER, skipIfFeatureOff } from "./helpers";

test.describe("reports hub", () => {
  test("shows the P&L with totals and exports CSV and PDF", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports?report=pnl");
    await expect(page.getByRole("columnheader", { name: "Net income" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Total", exact: true })).toBeVisible();

    const csv = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    expect((await csv).suggestedFilename()).toMatch(/^pnl-\d{4}-\d{2}-\d{2}\.csv$/);

    const pdf = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).click();
    expect((await pdf).suggestedFilename()).toMatch(/^pnl-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  test("the P&L filters by Location, showrooms included, as the Business report does", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports?report=pnl");
    await expect(page.getByRole("combobox", { name: "Warehouse" })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Location" }).click();
    await expect(page.getByRole("option", { name: "All locations" })).toBeVisible();
    await page.getByRole("option", { name: "Southgate Showroom" }).click();
    await expect(page.getByRole("combobox", { name: "Location" })).toHaveText("Southgate Showroom");
    await expect(page.getByText(/Southgate Showroom\./)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Net income" })).toBeVisible();
  });

  test("the demo, which keeps no journal, never offers the Trial balance (ADR 0055 Trial balance)", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports?report=trial-balance");
    const nav = page.getByRole("navigation", { name: "Reports" }).getByRole("button");
    await expect(nav).toHaveText(["Business report", "Profit and loss", "Sales by category", "Payments received"]);
    // The address asks for a report the person may not open, so the Business report shows (rule 1).
    await expect(nav.filter({ hasText: "Business report" })).toHaveAttribute("aria-current", "page");
  });

  test("sales tax report reads the jurisdiction each invoice stored", async ({ page }) => {
    skipIfFeatureOff("reports.tax-jurisdiction");
    await signInAs(page, SUMMIT_OWNER, "/reports?report=tax");
    await expect(page.getByRole("cell", { name: "Denver combined" })).toBeVisible();
  });

  test("Sales sees only sales by category, without cost", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Sales");
    await page.getByRole("option", { name: "View as Sales" }).click();
    await expect(page.getByRole("navigation", { name: "Reports" }).getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("columnheader", { name: "Revenue" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Cost" })).toHaveCount(0);
  });

  test("View as Manager sees Sales by category and Payments received, not the Business report or P&L", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Manager");
    await page.getByRole("option", { name: "View as Manager" }).click();
    const nav = page.getByRole("navigation", { name: "Reports" }).getByRole("button");
    await expect(nav).toHaveText(["Sales by category", "Payments received"]);
    await page.goto("/reports?report=pnl");
    await expect(
      page.getByRole("navigation", { name: "Reports" }).getByRole("button", { name: "Sales by category" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("columnheader", { name: "Net income" })).toHaveCount(0);
  });
});
