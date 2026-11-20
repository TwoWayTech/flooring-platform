import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, signInAs } from "./accounts";
import { assertSameCompanyDay, companyToday, PDF_PROOF } from "./flows/kit";

/**
 * The company's day on the web (ADR 0051, "The company's day on the web", 2026-11-20). The browser
 * runs on Kiritimati (UTC+14), on the far side of the date line from Summit's Denver, so for most of
 * Denver's day the browser is already on Denver's tomorrow. A new expense must still default to
 * Denver's today, the day `GET /company`'s `company.timeZone` gives, and the API must accept it:
 * before, the form defaulted to the browser's day and the API refused it as "in the future". From
 * midnight to 03:00 in Denver (04:00 in summer) Kiritimati is on the same day, so a run then proves
 * nothing new; the annotation records both days. The unit tests (`company-day.test.ts`) fix the clock.
 */
test.use({ timezoneId: "Pacific/Kiritimati" });

test.describe("the company's day (api mode)", () => {
  test("a browser across the date line defaults a new expense to the company's day, which the API records", async ({
    page,
  }) => {
    const start = companyToday();
    await signInAs(page, MANAGER_EMAIL);

    const browserDay = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
    test.info().annotations.push({ type: "days", description: `company ${start}, browser ${browserDay}` });

    await page.goto("/finance?view=expenses");
    await page.getByRole("button", { name: "New expense" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue(start);

    await dialog.getByLabel("Location").click();
    await page.getByRole("option", { name: "Denver Central" }).click();
    await dialog.getByLabel("Amount before tax").fill("12.75");
    await page.locator('input[type="file"]').setInputFiles(PDF_PROOF);
    await dialog.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByText(/^Expense EXP-\d+ recorded$/)).toBeVisible();
    assertSameCompanyDay(start);
  });
});
