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

  test("receives a transfer in transit, then starts a new one", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory?view=transfers");
    const travelling = page.getByRole("row", { name: /TR-1003/ });
    await expect(travelling.getByText("In transit")).toBeVisible();
    await travelling.getByRole("button", { name: "Receive" }).click();
    await expect(travelling.getByText("Received")).toBeVisible();

    await page.getByRole("button", { name: "New transfer" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Add boxed goods").click();
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
