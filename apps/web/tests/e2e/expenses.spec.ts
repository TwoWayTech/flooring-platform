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
    await page.getByRole("button", { name: "Revenue", exact: true }).first().click();
    await expect(page.getByRole("dialog").getByRole("link").first()).toBeVisible();
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
});
