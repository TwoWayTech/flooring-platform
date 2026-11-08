import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("customer picker and addresses (spec A6)", () => {
  test("adds a typed customer and a suggested address from the quote builder", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await page.getByLabel("Customer", { exact: true }).click();
    await page.getByLabel("Search customers").fill("Jordan Avery");
    await page.getByRole("option", { name: "Add “Jordan Avery” as a new customer" }).click();
    const form = page.getByRole("form", { name: "New customer" });
    await expect(form.getByLabel("Name")).toHaveValue("Jordan Avery");
    await form.getByLabel("Phone (optional)").fill("303-555-0144");
    await form.getByRole("button", { name: "Add customer" }).click();
    await expect(page.getByLabel("Customer", { exact: true })).toHaveText(/Jordan Avery/);

    await page.getByLabel("Job-site address").click();
    await page.getByRole("option", { name: "Add new address" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Find the address").fill("123 Main");
    await dialog.getByRole("option").first().click();
    await expect(dialog.getByLabel("Street")).toHaveValue("123 Main Street");
    await expect(dialog.getByLabel("County")).not.toHaveValue("");
    await dialog.getByRole("button", { name: "Save address" }).click();

    await expect(page.locator("#site-street")).toHaveValue("123 Main Street");
    await page.getByRole("button", { name: /^Save quote/ }).click();
    await expect(page.getByText(/Quote .* saved/)).toBeVisible();
  });

  test("marks a quick-added customer as incomplete until the profile is completed", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await page.getByLabel("Customer", { exact: true }).click();
    await page.getByLabel("Search customers").fill("Lena Quick");
    await page.getByRole("option", { name: "Add “Lena Quick” as a new customer" }).click();
    await page.getByRole("form", { name: "New customer" }).getByRole("button", { name: "Add customer" }).click();
    await expect(page.getByLabel("Customer", { exact: true })).toHaveText(/Lena Quick/);

    await page.goto("/sales?view=customers");
    await page.getByPlaceholder("Search customers").fill("Lena Quick");
    const row = page.getByRole("row", { name: /Lena Quick/ });
    await expect(row.getByText("New, profile incomplete")).toBeVisible();
    await row.click();
    await expect(page.getByText("No address yet. Add one to complete the profile.")).toBeVisible();
  });

  test("the company profile fills its address from a suggestion", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/company");
    await page.getByLabel("Find the company address").fill("Colorado Springs");
    await page.getByRole("option").first().click();
    await expect(page.getByLabel("City")).toHaveValue("Colorado Springs");
    await expect(page.getByLabel("County")).toHaveValue("El Paso");
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toBeVisible();
  });
});
