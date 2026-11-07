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
    const figures = page.locator("dl").first();
    await expect(figures).toContainText(expected.revenue);
    await expect(figures).toContainText(expected.margin);
    await expect(page.getByText("overdue invoices")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's jobs" })).toBeVisible();
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
});
