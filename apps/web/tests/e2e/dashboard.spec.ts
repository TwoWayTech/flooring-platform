import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  dateShift,
  defaultNumberSettings,
  formatNumber,
  last12Months,
  marginPct,
  monthlyPnl,
  shiftDates,
  sum,
  type CompanyFixtures,
} from "@workspace/shared";
import { signInAs, SUMMIT_OWNER } from "./helpers";

/** The Owner's 12-month figures computed straight from the fixtures, as the dashboard should show them. */
function expectedFigures() {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../packages/shared/fixtures/summit.json", import.meta.url)), "utf8"),
  ) as CompanyFixtures;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const f = shiftDates(raw, dateShift(raw.anchorDate, today));
  const months = monthlyPnl(last12Months(today), f.invoices, f.expenses);
  const revenue = sum(months.map((m) => m.revenue));
  const cogs = sum(months.map((m) => m.cogs));
  const settings = defaultNumberSettings();
  return {
    revenue: formatNumber(revenue, "money", settings, { compact: true }),
    margin: formatNumber(marginPct(revenue, cogs), "percent", settings),
  };
}

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("key figures match the fixtures", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    const expected = expectedFigures();
    // The 12-month totals sit in the revenue panel; the card row above follows the period (spec E1).
    const figures = page.getByRole("region", { name: /last 12 months/ }).locator("dl");
    await expect(figures).toContainText(expected.revenue);
    await expect(figures).toContainText(expected.margin);
    await expect(page.getByText("overdue invoices")).toBeVisible();
  });

  test("View as Sales shows no margin", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    await expect(page.getByText("Gross margin").first()).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Sales");
    await page.getByRole("option", { name: "View as Sales" }).click();
    await expect(page.getByRole("heading", { name: "Your revenue, last 12 months" })).toBeVisible();
    await expect(page.getByText("Gross margin")).toHaveCount(0);
  });

  test("shows the table view of the chart", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    await page.getByRole("button", { name: "Show table" }).click();
    await expect(page.getByRole("columnheader", { name: "Gross margin" })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(13);
  });

  test("one period selector drives the cards; best sellers have their own filters", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    const filters = page.getByRole("group", { name: "Dashboard filters" });
    await expect(page.getByText(/vs previous period|No earlier period/).first()).toBeVisible();
    await filters.getByLabel("Period").click();
    await page.getByRole("option", { name: "Year to date" }).click();
    await expect(page.getByRole("region", { name: "Employee of the year" })).toBeVisible();
    const best = page.getByRole("region", { name: "Best sellers" });
    await best.getByRole("button", { name: "Quantity" }).click();
    await best.getByRole("button", { name: "Show best sellers as a table" }).click();
    await expect(best.getByRole("columnheader", { name: "Quantity" })).toBeVisible();
  });

  test("Sales → Team shows commission earned, paid and pending", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales?view=team");
    for (const name of ["Paid revenue", "Commission earned", "Commission pending"]) {
      await expect(page.getByRole("button", { name: `${name}, column options` })).toBeVisible();
    }
    await expect(page.locator("tbody tr").first()).toBeVisible();
  });
});
