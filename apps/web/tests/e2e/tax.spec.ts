import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

/** The note under the quote's tax line. */
const taxNote = (page: import("@playwright/test").Page) => page.getByText(/\(example\)\.|Not collected in/).first();

test.describe("default tax rates (spec A5)", () => {
  test("fills tax from county, state or company default and says where it came from", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await expect(taxNote(page)).toContainText("Default rate for Colorado (example)");

    await page.getByLabel("County").fill("El Paso");
    await page.getByLabel("County").blur();
    await expect(taxNote(page)).toContainText("Colorado Springs combined rate (example)");

    await page.locator("#site-state").click();
    await page.getByRole("option", { name: "Wyoming" }).click();
    await expect(taxNote(page)).toContainText("Company default rate (example)");

    await page.locator("#site-state").click();
    await page.getByRole("option", { name: "Oregon" }).click();
    await expect(taxNote(page)).toContainText("Not collected in Oregon");
  });

  test("an Owner changes tax on one quote with a reason, and the change is audited", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/sm-quo-0288");
    await page.getByRole("button", { name: "Change tax" }).click();
    await page.getByLabel("Rate").fill("0");
    await page.getByLabel("Reason").fill("Church project, exempt by letter");
    await page.getByRole("button", { name: "Use this rate" }).click();
    await expect(page.getByText(/Changed by Dana Whitfield: Church project, exempt by letter/)).toBeVisible();
    await page.getByRole("button", { name: /^Save quote/ }).click();
    await expect(page.getByText(/Quote .* saved/)).toBeVisible();

    await page.goto("/settings/audit");
    await expect(page.getByRole("cell", { name: "Changed tax on a document" })).toBeVisible();
  });

  test("Sales cannot change tax on a document", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Sales");
    await page.getByRole("option", { name: "View as Sales" }).click();
    await expect(page.getByRole("button", { name: "Add room" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change tax" })).toHaveCount(0);
  });

  test("settings hold the company default and county rates with dates", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/localization?tab=tax");
    await expect(page.getByLabel("Company default rate in percent")).toHaveValue("4");
    await expect(page.getByLabel("Colorado Springs combined rate in percent")).toHaveValue("8.25");
    await expect(page.getByLabel("Colorado valid from")).toBeVisible();
  });
});
