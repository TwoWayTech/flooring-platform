import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { REPRICE_ACCEPTED_WARNING, type CompanyFixtures } from "@workspace/shared";
import { signInAs, SUMMIT_OWNER } from "./helpers";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../packages/shared/fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;
/** A seeded accepted quote not yet invoiced. */
const ACCEPTED = summit.quotes.find((quote) => quote.status === "accepted" && !quote.invoiceId)!;

/** The status pill in the page header. */
const headerStatus = (page: Page) =>
  page.locator("header").getByText(/^(Draft|Pending|Accepted|Converted|Declined|Expired)$/);

test.describe("quote statuses (spec B1)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("a draft needs only a customer; sending checks the whole quote; accepted quotes convert", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/new");
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText("Choose a customer before saving the quote.")).toBeVisible();
    await expect(page.getByLabel("Customer", { exact: true })).toBeFocused();

    await page.getByLabel("Customer", { exact: true }).click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(page).toHaveURL(/\/sales\/quotes\/(?!new)/);
    await expect(headerStatus(page)).toHaveText("Draft");

    await page.getByLabel("Job site street").fill("");
    await page.getByLabel("Job site street").blur();
    await page.getByRole("button", { name: "Send / mark pending" }).click();
    await expect(page.getByText("Add at least one line.")).toBeVisible();
    await expect(page.getByText("Enter the job-site street.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add product" })).toBeFocused();

    await page.getByRole("button", { name: "Add product" }).click();
    await page.getByPlaceholder("Search by name, color or brand").fill("Shoreline Plank");
    await page.getByRole("option").first().click();
    await page.getByLabel("Job site street").fill("12 Aspen Way");
    await page.getByLabel("Job site street").blur();
    await expect(page.getByText("Add at least one line.")).toBeHidden();

    await page.getByRole("button", { name: "Send / mark pending" }).click();
    const dialog = page.getByRole("dialog", { name: "Send quote" });
    await expect(dialog.getByLabel("Valid until (optional)")).not.toHaveValue("");
    await dialog.getByRole("button", { name: "Mark as pending" }).click();
    await expect(headerStatus(page)).toHaveText("Pending");
    await expect(page.locator("header").getByText(/^Valid until/)).toBeVisible();

    await page.getByRole("button", { name: "Mark accepted" }).click();
    await expect(headerStatus(page)).toHaveText("Accepted");
    await page.getByRole("button", { name: "Convert to invoice" }).click();
    await expect(page).toHaveURL(/\/sales\/invoices\//);
    await page.goBack();
    await expect(headerStatus(page)).toHaveText("Converted");
    await expect(page.getByRole("button", { name: "Save quote" })).toHaveCount(0);
  });

  test("repricing an accepted quote warns, then sends it back to Pending; other edits keep it Accepted (ADR 0061, 7)", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, `/sales/quotes/${ACCEPTED.id}`);
    await expect(headerStatus(page)).toHaveText("Accepted");
    const warning = page.getByText(REPRICE_ACCEPTED_WARNING);
    await expect(warning).toHaveCount(0);

    // The job-site street does not price the quote: saved, it stays Accepted.
    await page.getByLabel("Job site street").fill("14 Aspen Way");
    await page.getByLabel("Job site street").blur();
    await expect(warning).toHaveCount(0);
    await page.getByRole("button", { name: "Save quote" }).click();
    await expect(page.getByText(/^Quote .+ saved$/)).toBeVisible();
    await expect(headerStatus(page)).toHaveText("Accepted");

    // A new deposit does: the screen warns before the save and offers no conversion.
    const deposit = page.getByLabel("Deposit percent");
    await deposit.fill(ACCEPTED.depositPct === "25" ? "30" : "25");
    await deposit.blur();
    await expect(warning).toBeVisible();
    await expect(page.getByRole("button", { name: "Convert to invoice" })).toHaveCount(0);
    await page.getByRole("button", { name: "Save quote" }).click();
    await expect(headerStatus(page)).toHaveText(/^(Pending|Expired)$/);
    await expect(warning).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Convert to invoice" })).toHaveCount(0);

    // Accepted again, it converts.
    await page.getByRole("button", { name: "Mark accepted" }).click();
    await expect(headerStatus(page)).toHaveText("Accepted");
    await expect(page.getByRole("button", { name: "Convert to invoice" })).toBeEnabled();
  });

  test("a pending quote past its expiry reads Expired and can be sent again", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/quotes/sm-quo-0002");
    await expect(headerStatus(page)).toHaveText("Expired");
    await page.getByRole("button", { name: "Send / mark pending" }).click();
    await page.getByRole("dialog", { name: "Send quote" }).getByRole("button", { name: "Mark as pending" }).click();
    await expect(headerStatus(page)).toHaveText("Pending");
  });

  test("the dashboard's Pending quotes figure opens the filtered list", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/");
    await page.getByRole("link", { name: "Pending quotes" }).click();
    await expect(page).toHaveURL(/sales-quotes\.f\.status=Pending/);
    await expect(page.getByRole("button", { name: /Remove Status/ })).toBeVisible();
    const statuses = await page
      .locator("tbody tr")
      .getByText(/^(Draft|Pending|Accepted|Converted|Declined|Expired)$/)
      .allTextContents();
    expect(statuses.length).toBeGreaterThan(0);
    expect(new Set(statuses)).toEqual(new Set(["Pending"]));
  });
});
