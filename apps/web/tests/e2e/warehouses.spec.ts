import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("warehouses and transfers (spec A1)", () => {
  test("lists warehouses and showrooms with the company default", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/locations");
    await expect(page.getByRole("heading", { name: "Warehouses and showrooms" })).toBeVisible();
    const denver = page.getByRole("row", { name: /Denver Central/ });
    await expect(denver.getByText("Warehouse")).toBeVisible();
    await expect(denver.getByText("Default")).toBeVisible();
    await expect(
      page.getByRole("row", { name: /Southgate Showroom/ }).getByText("Showroom", { exact: true }),
    ).toBeVisible();
  });

  test("refuses to turn a warehouse that holds stock into a showroom", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/locations");
    await page
      .getByRole("row", { name: /Colorado Springs/ })
      .first()
      .click();
    await page.getByRole("group", { name: "Type" }).getByRole("button", { name: "Showroom" }).click();
    await page.getByRole("button", { name: "Save location" }).click();
    await expect(page.getByRole("alert")).toHaveText(/holds stock\. Transfer it out/);
  });

  test("LNS1 a new showroom with no floor area is added and the Business report still opens with it", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/locations");
    await page.getByRole("button", { name: "Add location" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Annex Showroom");
    await dialog.getByRole("group", { name: "Type" }).getByRole("button", { name: "Showroom" }).click();
    await dialog.getByLabel("Street", { exact: true }).fill("1 Annex Way");
    await dialog.getByLabel("City", { exact: true }).fill("Denver");
    await dialog.getByLabel("State", { exact: true }).fill("CO");
    await dialog.getByLabel("ZIP").fill("80202");
    await dialog.getByRole("button", { name: "Save location" }).click();
    await expect(page.getByText("Annex Showroom saved")).toBeVisible();
    // The Branch cell, matched exactly: the City cell reads "Denver, CO".
    await expect(
      page.getByRole("row", { name: /Annex Showroom/ }).getByRole("cell", { name: "Denver", exact: true }),
    ).toBeVisible();
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Profit by location", exact: true })).toBeVisible();
    await expect(page.getByLabel("Annex Showroom", { exact: true })).toBeVisible();
  });

  test("LNS2 an edit keeps the branch read only, and another location's name is refused before anything is saved", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/locations");
    await page
      .getByRole("row", { name: /Southgate Showroom/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: "Branch" })).toBeDisabled();
    await dialog.getByLabel("Name", { exact: true }).fill("denver central");
    await dialog.getByRole("button", { name: "Save location" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Another location is already called Denver Central.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("row", { name: /Southgate Showroom/ })).toBeVisible();
  });

  test("receives a transfer in transit, then starts a new one", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory?view=transfers");
    const travelling = page.getByRole("row", { name: /TR-1003/ });
    await expect(travelling.getByText("In transit")).toBeVisible();
    await travelling.getByRole("button", { name: "Receive" }).click();
    await expect(travelling.getByText("Received")).toBeVisible();

    await page.getByRole("button", { name: "New transfer" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add boxed goods" }).click();
    await page.getByRole("option").first().click();
    await dialog.getByRole("button", { name: "Start transfer" }).click();
    await expect(page.getByRole("row", { name: /TR-1004/ }).getByText("In transit")).toBeVisible();
  });

  test("filters rolls by warehouse and shows the roll in transit", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory?view=rolls&warehouse=sm-loc-springs");
    await expect(page.getByRole("combobox", { name: "Warehouse" })).toHaveText("Colorado Springs");
    await expect(page.getByRole("cell", { name: "Denver Central" })).toHaveCount(0);
    await page.goto("/inventory/rolls/sm-roll-0043");
    await expect(page.getByText(/In transit to Colorado Springs on TR-1003/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Cut roll" })).toBeDisabled();
  });

  test("a new quote starts from the person's default warehouse", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await expect(page.getByLabel("Fulfilled from")).toHaveText("Denver Central");
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Your profile" }).click();
    await page.getByLabel("Default warehouse").click();
    await page.getByRole("option", { name: "Colorado Springs" }).click();
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.goto("/sales/quotes/new");
    await expect(page.getByLabel("Fulfilled from")).toHaveText("Colorado Springs");
  });
});
