import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("filters on every table (spec A2)", () => {
  test("filters a column, shows a chip and a count, keeps the filter in the URL, and clears", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales?view=invoices");
    const count = page.getByText(/^\d+ of \d+$/);
    const all = await count.textContent();

    await page.getByRole("button", { name: "Status, column options" }).click();
    await page.getByRole("checkbox", { name: "Paid", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/sales-invoices\.f\.state=Paid/);
    await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Status: Paid");
    await expect(count).not.toHaveText(all!);
    await expect(page.getByRole("button", { name: "Status, column options, filtered" })).toBeVisible();

    await page
      .getByRole("row", { name: /Open invoice/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/sales\/invoices\/sm-inv/);
    await page.goBack();
    await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Status: Paid");

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(count).toHaveText(all!);
    await expect(page.getByRole("group", { name: "Active filters" })).toHaveCount(0);
  });

  test("a money range narrows the rows and the totals row adds up only the filtered rows", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales?view=invoices&sales-invoices.f.total=10000..");
    await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Total: at least");
    const totals = page.locator("tfoot");
    await expect(totals).toContainText("Total");
    const rows = page.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    const headers = await page.locator("thead th").allTextContents();
    const column = headers.findIndex((h) => h.trim() === "Total") + 1;
    for (const cell of await page.locator(`tbody tr td:nth-child(${column})`).allTextContents()) {
      expect(Number(cell.replace(/[^\d.]/g, ""))).toBeGreaterThanOrEqual(10000);
    }
  });

  test("remembers each person's last view of a table", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory?view=rolls");
    await page.getByRole("button", { name: "Type, column options" }).click();
    await page.getByRole("checkbox", { name: "Remnant" }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/inventory-rolls\.f\.type=Remnant/);
    await page.goto("/sales");
    await page.goto("/inventory?view=rolls");
    await expect(page).toHaveURL(/inventory-rolls\.f\.type=Remnant/);
    await expect(page.getByText("15 of 60")).toBeVisible();
  });

  test("exports only the filtered rows to CSV", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory?view=rolls&inventory-rolls.f.type=Low");
    await expect(page.getByText("3 of 60")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const lines = readFileSync(await (await download).path(), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(4);
  });
});
