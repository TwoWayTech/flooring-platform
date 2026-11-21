import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER, skipIfFeatureOff, type Persona } from "./helpers";

const GRACE: Persona = { companyId: "summit", userId: "sm-usr-06", roleKey: "accountant" };
const pdf = {
  name: "receipt.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 receipt for the demo\n%%EOF\n"),
};

test.describe("Finance → Expenses (spec F1)", () => {
  test.beforeEach(() => skipIfFeatureOff("finance.expenses"));

  test("Manage recurring adds a recurring expense", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/finance?view=expenses");
    await page.getByRole("button", { name: "Manage recurring" }).click();
    await page.getByRole("button", { name: "New recurring expense" }).click();
    const dialog = page.getByRole("dialog", { name: "New recurring expense" });
    await dialog.getByLabel("Estimated amount").fill("250");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Recurring expense saved")).toBeVisible();
  });

  test("lists expenses with vendor, category, location and receipt", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/finance?view=expenses");
    await expect(page.getByRole("button", { name: "Location, column options" })).toBeVisible();
    await page
      .getByRole("row", { name: /^Open EXP-/ })
      .first()
      .click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Receipt.pdf" })).toBeVisible();
  });

  test("won't record an expense without a receipt, but saves a draft", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/finance?view=expenses");
    await page.getByRole("button", { name: "New expense" }).click();
    await page.getByLabel("Amount before tax").fill("120");
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Attach the receipt, statement or lease.");
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible();
  });

  test("Vendor and Location pick by typing a name and pressing Enter (click-through #38)", async ({ page }) => {
    await signInAs(page, GRACE, "/finance?view=expenses");
    await page.getByRole("button", { name: "New expense" }).click();
    const dialog = page.getByRole("dialog", { name: "New expense" });
    const vendor = dialog.getByRole("combobox", { name: "Vendor" });
    await vendor.focus();
    await page.keyboard.type("tidewell");
    await expect(page.getByRole("option", { name: "Tidewell Facility Services" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(vendor).toHaveText("Tidewell Facility Services");
    // A word inside the name finds it too.
    const location = dialog.getByRole("combobox", { name: "Location" });
    await location.focus();
    await page.keyboard.type("showroom");
    await page.keyboard.press("Enter");
    await expect(location).toHaveText("Southgate Showroom");
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("records an expense for a showroom with its receipt", async ({ page }) => {
    await signInAs(page, GRACE, "/finance?view=expenses");
    await page.getByRole("button", { name: "New expense" }).click();
    await page.getByRole("dialog").getByLabel("Location").click();
    await page.getByRole("option").nth(1).click();
    await page.getByLabel("Amount before tax").fill("120");
    await page.locator('input[type="file"]').setInputFiles(pdf);
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByText(/^Expense EXP-\d+ recorded$/)).toBeVisible();
  });

  test("an expense above the limit waits for someone else, who can approve it", async ({ page }) => {
    await signInAs(page, GRACE, "/finance?view=expenses");
    await page
      .getByRole("row", { name: /^Open EXP-/ })
      .filter({ hasText: "Waiting for approval" })
      .first()
      .click();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/EXP-\d+ approved/)).toBeVisible();
  });

  test("Pay later raises a supplier bill", async ({ page }) => {
    await signInAs(page, GRACE, "/finance?view=expenses");
    await page.getByRole("button", { name: "New expense" }).click();
    await page.getByLabel("Payment", { exact: true }).click();
    await page.getByRole("option", { name: "Pay later" }).click();
    await page.getByLabel("Amount before tax").fill("300");
    await page.locator('input[type="file"]').setInputFiles(pdf);
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByText(/^Expense EXP-\d+ recorded$/)).toBeVisible();
    await page.goto("/purchasing?view=bills");
    await expect(page.getByRole("row", { name: /EXP-\d+/ }).first()).toBeVisible();
  });

  test("voiding needs a reason", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/finance?view=expenses");
    await page
      .getByRole("row", { name: /^Open EXP-/ })
      .filter({ hasText: "Confirmed" })
      .first()
      .click();
    await page.getByRole("button", { name: "Void" }).click();
    await page.getByRole("dialog").last().getByRole("textbox").fill("Entered twice");
    await page.getByRole("button", { name: "Void expense" }).click();
    await expect(page.getByText(/Voided: Entered twice/)).toBeVisible();
  });

  test("Settings → Expenses sets approval and the sharing rule", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/expenses");
    await page.getByLabel("How company-wide costs are shared").click();
    await page.getByRole("option", { name: "Fixed percentages" }).click();
    await expect(page.getByText(/They must add up to 100/)).toBeVisible();
  });

  test("SCS1 Shared costs: a split that isn't 100 is refused with the API's words, a cleared share counts 0, a split of 100 saves (ADR 0059, part 4b)", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/expenses");
    await page.getByLabel("How company-wide costs are shared").click();
    await page.getByRole("option", { name: "Fixed percentages" }).click();
    await page.getByLabel("Denver Central percent").fill("60");
    await page.getByLabel("Colorado Springs percent").fill("30");
    const total = "The percentages add up to 90. They must add up to 100.";
    await expect(page.getByRole("alert").filter({ hasText: total })).toBeVisible();
    await page.getByRole("button", { name: "Save shared costs" }).click();
    await expect(page.getByText(total).last()).toBeVisible();
    // A cleared share is dropped, not sent blank: Denver alone then counts.
    await page.getByLabel("Colorado Springs percent").fill("");
    await expect(page.getByRole("alert").filter({ hasText: "add up to 60." })).toBeVisible();
    await page.getByLabel("Denver Central percent").fill("100");
    await expect(page.getByRole("alert").filter({ hasText: "add up to" })).toHaveCount(0);
    await page.getByRole("button", { name: "Save shared costs" }).click();
    await expect(page.getByText("Shared costs saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Denver Central percent")).toHaveValue("100");
    await expect(page.getByLabel("Colorado Springs percent")).toHaveValue("");
  });

  test("a location has a floor area in its settings", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/locations");
    await page
      .getByRole("row", { name: /^Edit / })
      .first()
      .click();
    await expect(page.getByLabel("Floor area, sq ft")).toBeVisible();
  });
});

test.describe("Business report (spec F2)", () => {
  test.beforeEach(() => skipIfFeatureOff("reports.business"));

  test("opens first, with every section and exports that match", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports");
    for (const title of [
      "Summary",
      "Profit by location",
      "Expenses by category",
      "Cash",
      "Taxes",
      "People costs",
      "Stock on hand",
    ]) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    const csv = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).first().click();
    expect((await csv).suggestedFilename()).toMatch(/^business-report-.*\.csv$/);
    const file = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).first().click();
    expect((await file).suggestedFilename()).toMatch(/^business-report-.*\.pdf$/);
  });

  test("drills from a figure to its records", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports");
    const revenue = page.getByRole("button", { name: "Revenue", exact: true }).first();
    const figure = (
      await page.getByRole("row").filter({ has: revenue }).first().getByRole("cell").first().innerText()
    ).trim();
    await revenue.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("link").first()).toBeVisible();
    // A total line under the records, equal to the figure clicked (click-through #40).
    const total = dialog.getByRole("listitem").last();
    await expect(total).toContainText(/^Total/);
    await expect(total).not.toContainText("records listed");
    await expect(total).toContainText(figure);
  });

  test("toggles a section between chart and table", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports");
    const panel = page.getByRole("group", { name: "Profit by location view" });
    await panel.getByRole("button", { name: "Table" }).click();
    await expect(page.getByRole("columnheader", { name: "Net profit" })).toBeVisible();
  });

  test("filtering to one salesperson stops the summary at gross profit", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports");
    await page.getByRole("combobox", { name: "Salesperson" }).click();
    await page.getByRole("option", { name: "Priya Natarajan" }).click();
    await expect(page.getByText(/stops at gross profit/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Profit by location" })).toHaveCount(0);
  });

  test("custom dates the report can't take are explained beside them, and the figures stay (ADR 0055 S8)", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/reports");
    await page.getByRole("combobox", { name: "Period" }).click();
    await page.getByRole("option", { name: "Custom dates" }).click();
    const exportCsv = page.getByRole("button", { name: "Export CSV" }).first();
    await expect(exportCsv).toBeEnabled();
    const from = page.getByLabel("From", { exact: true });
    await from.fill("2020-01-01");
    await expect(page.getByText(/^Choose a period of 366 days or less\./)).toBeVisible();
    await expect(from).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.getByText("This page could not load its data.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(exportCsv).toBeEnabled();
    await from.fill(await page.getByLabel("To", { exact: true }).inputValue());
    await expect(page.getByText(/^Choose a period of 366 days or less\./)).toHaveCount(0);
    await expect(from).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
  });
});
