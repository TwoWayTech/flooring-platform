import { expect, test, type Page } from "@playwright/test";
import { signInAs, SUMMIT_OWNER, type Persona } from "./helpers";

const SUMMIT_SALES: Persona = { companyId: "summit", userId: "sm-usr-03", roleKey: "sales" };

async function addProduct(page: Page, search: string) {
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByPlaceholder("Search by name, color or brand").fill(search);
  await page.getByRole("option").first().click();
}

const linesTable = (page: Page) => page.getByRole("region", { name: "Quote lines" });

test.describe("waste is internal only (spec B3)", () => {
  test("Sales see the billed quantity without a waste column", async ({ page }) => {
    await signInAs(page, SUMMIT_SALES, "/sales/quotes/new");
    await page.getByRole("button", { name: "Add room" }).click();
    await addProduct(page, "Shoreline Plank");
    await expect(linesTable(page).getByRole("columnheader", { name: "Quantity" })).toBeVisible();
    await expect(linesTable(page).getByRole("columnheader", { name: "Waste" })).toHaveCount(0);
    await expect(page.getByLabel(/waste percent/)).toHaveCount(0);
  });

  test("the company default per category starts new lines, and customer documents never show waste", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/documents");
    await page.getByLabel("Waste for LVP and LVT").fill("15");
    await page.getByRole("button", { name: /^Save / }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();

    await page.goto("/sales/quotes/new");
    await page.getByRole("button", { name: "Add room" }).click();
    await addProduct(page, "Shoreline Plank");
    await expect(linesTable(page).getByRole("columnheader", { name: "Waste" })).toBeVisible();
    await expect(page.getByLabel(/waste percent/).first()).toHaveValue("15");

    await page.goto("/sales/invoices/sm-inv-0150");
    await expect(page.getByRole("article")).toBeVisible();
    await expect(page.getByRole("article").getByText(/waste/i)).toHaveCount(0);
  });
});
