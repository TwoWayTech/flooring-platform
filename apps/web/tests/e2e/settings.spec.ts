import { expect, test, type Page } from "@playwright/test";
import { featureOn } from "@workspace/shared";
import { HARBOR_OWNER, signInAs, SUMMIT_OWNER, type Persona } from "./helpers";

/** Keystone Flooring Supply's Owner, as invoice-lifecycle.spec.ts signs in: Keystone has a CAD rate. */
const KEYSTONE_OWNER: Persona = { companyId: "keystone", userId: "ks-usr-01", roleKey: "owner" };

/** Saves the Payments page, confirming the step-up with any six digits when the switch asks for one. */
async function savePayments(page: Page) {
  await page.getByRole("button", { name: "Save payments" }).click();
  if (!featureOn("auth.step-up")) return;
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  await dialog.getByLabel("Authenticator code").fill("123456");
  await dialog.getByRole("button", { name: "Confirm" }).click();
}

/** Confirms the open step-up dialog with any six digits, when the switch asks for one. */
async function confirmCode(page: Page) {
  if (!featureOn("auth.step-up")) return;
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Authenticator code").fill("123456");
  await dialog.getByRole("button", { name: "Confirm" }).click();
}

/** Whether the audit log has a row with `action` naming `target`. */
async function expectAuditRow(page: Page, action: string, target: string) {
  await page.goto("/settings/audit");
  await expect(page.getByRole("row").filter({ hasText: action }).filter({ hasText: target }).first()).toBeVisible();
}

test.describe("settings that stay easy to read (spec A4)", () => {
  test("groups the settings home and finds any setting by search", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings");
    for (const group of ["Company", "People and access", "Sales and documents", "Tax and localization"]) {
      await expect(page.getByRole("heading", { name: group, exact: true })).toBeVisible();
    }
    await page.getByLabel("Find a setting").fill("late fee");
    await page
      .getByRole("list", { name: "Matching settings" })
      .getByRole("link", { name: "Late fee per month" })
      .click();
    await expect(page).toHaveURL(/\/settings\/documents/);
    await expect(page.getByRole("heading", { name: "Sales and documents" })).toBeVisible();
  });

  test("marks changed fields, keeps a sticky Save / Discard bar and resets to default", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/documents");
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);
    await page.getByLabel("Late fee per month").fill("2");
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    await expect(bar).toContainText("1 unsaved change");
    await expect(page.getByText("Changed", { exact: true })).toBeVisible();
    await bar.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByLabel("Late fee per month")).toHaveValue("1.5");

    await page.getByLabel("Quote number prefix").fill("QT-");
    await page.getByRole("button", { name: "Save documents" }).click();
    await expect(page.getByText("Documents saved")).toBeVisible();
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByLabel("Quote number prefix")).toHaveValue("Q-");
    await page.getByRole("button", { name: "Save documents" }).click();

    await page.goto("/settings/audit");
    await expect(page.getByRole("cell", { name: "Changed localization and tax" }).first()).toBeVisible();
  });
});

test.describe("settings saves that are refused (ADR 0059 D16)", () => {
  test("S1 Payments says why a refused amount wasn't saved before any step-up, then asks for one", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/payments");
    const threshold = page.getByLabel("Only above this amount");
    await threshold.fill("12.");
    // The shared rule runs before the step-up, so a refused amount never costs a code (review round 1).
    await page.getByRole("button", { name: "Save payments" }).click();
    await expect(
      page.getByText("Enter the payment approval amount as a number such as 1000.00, or leave it empty."),
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toBeHidden();
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toContainText("1 unsaved change");

    await threshold.fill("1200");
    await savePayments(page);
    await expect(page.getByText("Payments saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Only above this amount")).toHaveValue("1200");

    await page.goto("/settings/audit");
    await expect(page.getByRole("row").filter({ hasText: "Changed payments" }).first()).toBeVisible();
  });
});

test.describe("settings saved one tab at a time (ADR 0059, part 2a)", () => {
  /** Whether the audit log has a row with `action` naming `target`. */
  async function expectAuditRow(page: Page, action: string, target: string) {
    await page.goto("/settings/audit");
    await expect(page.getByRole("row").filter({ hasText: action }).filter({ hasText: target }).first()).toBeVisible();
  }

  test("S2 Sales and documents says why a percent wasn't saved, saves on its own, and names the tab in the audit log", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/documents");
    const lateFee = page.getByLabel("Late fee per month");
    await lateFee.fill("12.");
    await page.getByRole("button", { name: "Save documents" }).click();
    await expect(page.getByText("Enter the late fee per month as a percent such as 1.5, from 0 to 100.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toContainText("1 unsaved change");

    // Review round 1: the inputs stop at the longest text the shared rule takes, and an invoice
    // prefix in the credit notes' CR- series is refused with its own words.
    await expect(page.getByLabel("Quote number prefix")).toHaveAttribute("maxlength", "10");
    await expect(lateFee).toHaveAttribute("maxlength", "12");
    await expect(page.getByLabel("Waste for Carpet", { exact: true })).toHaveAttribute("maxlength", "12");
    const invoicePrefix = page.getByLabel("Invoice number prefix");
    await lateFee.fill("1.75");
    await invoicePrefix.fill("cr-");
    await page.getByRole("button", { name: "Save documents" }).click();
    await expect(
      page.getByText("Credit notes are numbered CR-; choose a prefix that doesn't start with CR-."),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toContainText("2 unsaved changes");

    await invoicePrefix.fill("INV-");
    await page.getByRole("button", { name: "Save documents" }).click();
    await expect(page.getByText("Documents saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Late fee per month")).toHaveValue("1.75");

    await expectAuditRow(page, "Changed localization and tax", "Sales and documents");
  });

  test("S3 Payroll rules and Currency save on their own and name their tab in the audit log", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/localization?tab=payroll");
    await page.getByLabel("Holiday calendar").click();
    await page.getByRole("option", { name: "Wyoming", exact: true }).click();
    await page.getByRole("button", { name: "Save payroll rules" }).click();
    await expect(page.getByText("Payroll rules saved")).toBeVisible();
    await expectAuditRow(page, "Changed localization and tax", "Payroll rules");

    await signInAs(page, KEYSTONE_OWNER, "/settings/localization?tab=currency");
    await page.getByLabel("per 1 USD").fill("1.3900");
    await page.getByRole("button", { name: "Save currency" }).click();
    if (featureOn("auth.step-up")) {
      const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
      await dialog.getByLabel("Authenticator code").fill("123456");
      await dialog.getByRole("button", { name: "Confirm" }).click();
    }
    await expect(page.getByText("Currency saved")).toBeVisible();
    await expectAuditRow(page, "Changed localization and tax", "Currency");
  });
});

test.describe("Region and Currency (ADR 0059, part 2b)", () => {
  test("S4 Region: the time zone is read only, a date format change saves without a code, a states change asks for one", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/localization?tab=region");
    const zone = page.getByLabel("Time zone");
    await expect(zone).toBeDisabled();
    await expect(zone).toHaveValue(/America\/Denver/);

    await page.getByLabel("Date format").click();
    await page.getByRole("option", { name: /^\d{4}-\d{2}-\d{2}$/ }).click();
    await page.getByRole("button", { name: "Save region" }).click();
    const saved = page.getByText("Region saved");
    await expect(saved).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect(saved).toBeHidden();

    await page.getByRole("checkbox", { name: "Wyoming", exact: true }).click();
    await page.getByRole("button", { name: "Save region" }).click();
    await confirmCode(page);
    await expect(page.getByText("Region saved")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Wyoming", exact: true })).not.toBeChecked();

    await expectAuditRow(page, "Changed localization and tax", "Region");
  });

  test("S5 Currency: a refused rate says why before any code; a changed rate saves", async ({ page }) => {
    await signInAs(page, KEYSTONE_OWNER, "/settings/localization?tab=currency");
    const rate = page.getByLabel("per 1 USD");
    await rate.fill("0");
    await page.getByRole("button", { name: "Save currency" }).click();
    const toast = page.getByText("Enter the rate for CAD as a number above 0 with up to 8 decimals, such as 1.3870.");
    await expect(toast).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toContainText("1 unsaved change");
    await page.mouse.move(0, 0);
    await expect(toast).toBeHidden();

    // The input stops at the longest rate the shared rule takes (D23).
    await expect(rate).toHaveAttribute("maxlength", "19");
    await rate.fill("1.3950");
    await page.getByRole("button", { name: "Save currency" }).click();
    await confirmCode(page);
    await expect(page.getByText("Currency saved")).toBeVisible();
    await expectAuditRow(page, "Changed localization and tax", "Currency");
  });

  test("S6 a role without the sales tax key can't change the states of operation, and is told why before any code", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/roles");
    await page.getByRole("button", { name: /^Purchasing/ }).click();
    await page.getByRole("checkbox", { name: "Manage localization" }).check();
    await page.getByRole("button", { name: "Save role" }).click();
    await confirmCode(page);
    await expect(page.getByText("Role Purchasing saved")).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Purchasing");
    await page.getByRole("option", { name: "View as Purchasing" }).click();

    await page.goto("/settings/localization?tab=region");
    await page.getByRole("checkbox", { name: "Wyoming", exact: true }).click();
    await page.getByRole("button", { name: "Save region" }).click();
    const toast = page.getByText(
      "Changing the states of operation changes where sales tax is collected, so it also needs the sales tax permission.",
    );
    await expect(toast).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    await expect(bar).toContainText("1 unsaved change");
    await page.mouse.move(0, 0);
    await expect(toast).toBeHidden();
    await bar.getByRole("button", { name: "Discard" }).click();

    await page.getByLabel("Date format").click();
    await page.getByRole("option", { name: /^\d{4}-\d{2}-\d{2}$/ }).click();
    await page.getByRole("button", { name: "Save region" }).click();
    await expect(page.getByText("Region saved")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
  });
});

test.describe("Sales tax (ADR 0059, part 3a)", () => {
  /** The browser's own day, which the demo dates a save with (DemoStore's today). */
  function browserDay(page: Page): Promise<string> {
    return page.evaluate(() => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    });
  }

  test("S7 Sales tax: a changed rate is a new version from today; the dates are read only", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/localization?tab=tax");
    const validFrom = page.getByLabel("Colorado valid from");
    await expect(validFrom).toBeDisabled();
    const today = await browserDay(page);
    const started = await validFrom.inputValue();
    expect(started).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(started).not.toBe(today);
    await page.getByLabel("Colorado rate in percent").fill("8.5");
    await page.getByRole("button", { name: "Save sales tax" }).click();
    await confirmCode(page);
    await expect(page.getByText("Sales tax saved")).toBeVisible();
    // Right away: the form remounts with what the save stored (D27).
    await expect(validFrom).toHaveValue(today);
    await expect(validFrom).toBeDisabled();
    await expectAuditRow(page, "Changed localization and tax", "Sales tax");
    await page.goto("/sales/quotes/new");
    await page.getByRole("button", { name: "Add room" }).click();
    await page.getByRole("button", { name: "Add labor or service" }).click();
    await page.getByPlaceholder("Search by name, color or brand").fill("Hard surface installation");
    await page.getByRole("option").first().click();
    await expect(page.getByText(/Default rate for Colorado \(example\)/)).toBeVisible();
  });

  test("S8 Sales tax says why a rate is refused before any code", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/localization?tab=tax");
    await page.getByLabel("Colorado rate in percent").fill("8.123456");
    await page.getByRole("button", { name: "Save sales tax" }).click();
    await expect(
      page.getByText("Enter the rate for Colorado as a percent below 100 with up to 4 decimals, such as 8.25."),
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toContainText("1 unsaved change");
  });
});

test.describe("HR Suite settings", () => {
  test("shows only the groups an HR company uses @hr", async ({ page }) => {
    await signInAs(page, HARBOR_OWNER, "/settings");
    await expect(page.getByRole("heading", { name: "People and access", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inventory and warehouses", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sales and documents", exact: true })).toHaveCount(0);
  });
});
