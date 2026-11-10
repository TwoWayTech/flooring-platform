import { expect, test, type Page } from "@playwright/test";
import { signInAs, SUMMIT_OWNER, sendAndAccept } from "./helpers";

async function pickState(page: Page, name: string) {
  await page.getByLabel("State").click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function addFromPicker(page: Page, button: string, search: string) {
  await page.getByRole("button", { name: button }).click();
  await page.getByPlaceholder("Search by name, color or brand").fill(search);
  await page.getByRole("option").first().click();
}

/** The summary's total, as displayed. */
async function summaryTotal(page: Page) {
  const row = page
    .getByRole("region", { name: "Summary" })
    .locator("div", { hasText: /^Total/ })
    .first();
  return (await row.locator("dd").innerText()).trim();
}

test.describe("quote builder", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("job-site state changes labor tax, and the quote becomes an invoice with a PDF", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await page.getByLabel("Customer").click();
    await page.getByRole("option").first().click();

    await page.getByRole("button", { name: "Add room" }).click();
    await expect(page.getByLabel("Room 1 width in ft")).toHaveValue("12");
    await addFromPicker(page, "Add product", "Shoreline Plank");
    await addFromPicker(page, "Add labor or service", "Hard surface installation");
    await expect(page.getByText("Installation labor, not taxed, from Room 1")).toBeVisible();

    await pickState(page, "New Jersey");
    await expect(page.getByText(/Installation labor is taxed in New Jersey/)).toBeVisible();
    await expect(page.getByText("Installation labor, taxed, from Room 1")).toBeVisible();
    const njTotal = await summaryTotal(page);

    await pickState(page, "Colorado");
    await expect(page.getByText(/Installation labor is not taxed in Colorado/)).toBeVisible();
    const coTotal = await summaryTotal(page);
    expect(coTotal).not.toBe(njTotal);

    await sendAndAccept(page);
    await page.getByRole("button", { name: "Convert to invoice" }).click();
    await expect(page).toHaveURL(/\/sales\/invoices\//);
    await expect(page.getByText(/^Invoice INV-\d+$/).first()).toBeVisible();
    await expect(page.getByRole("article")).toContainText(coTotal);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^INV-\d+\.pdf$/);
  });

  test("resizing a room re-measures its lines", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await page.getByRole("button", { name: "Add room" }).click();
    await addFromPicker(page, "Add labor or service", "Hard surface installation");
    await expect(page.getByText("144.00 sq ft").first()).toBeVisible();
    await page.getByLabel("Room 1 width in ft").fill("20");
    await page.getByLabel("Room 1 length in ft").focus();
    await expect(page.getByText("240.00 sq ft").first()).toBeVisible();
  });
});
