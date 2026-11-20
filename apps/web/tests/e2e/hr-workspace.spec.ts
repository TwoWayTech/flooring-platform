import { expect, test, type Page } from "@playwright/test";
import { featureOn, HR_MESSAGES } from "@workspace/shared";
import { HARBOR_OWNER, HR_TAG, signInAs, SUMMIT_OWNER } from "./helpers";

const SUMMIT_HR = { companyId: "summit", userId: "sm-usr-07", roleKey: "hr" } as const;
const HARBOR_HR = { companyId: "harbor", userId: "hb-usr-02", roleKey: "hr" } as const;

/** Saves Settings → HR, confirming the step-up with any six digits when the switch asks for one (ADR 0059, part 5). */
async function saveHr(page: Page) {
  await page.getByRole("button", { name: "Save hr" }).click();
  if (!featureOn("auth.step-up")) return;
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  await dialog.getByLabel("Authenticator code").fill("123456");
  await dialog.getByRole("button", { name: "Confirm" }).click();
}

test.describe("HR workspace (spec C1)", () => {
  test("Home shows what needs action, and the people dates", async ({ page }) => {
    await signInAs(page, SUMMIT_HR, "/hr");
    await expect(page.getByRole("heading", { name: "Needs action" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Timesheets to approve/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Commission statements to approve/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming holidays" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Birthdays and anniversaries" })).toBeVisible();
  });

  test("a profile shows overtime status, balances, documents and the checklist", async ({ page }) => {
    await signInAs(page, SUMMIT_HR, "/hr/employees");
    await page.getByLabel("Search people").fill("Priya");
    await page.getByRole("row", { name: "Open Priya Natarajan" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Overtime status")).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Time-off balances" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Offer letter.pdf" })).toBeVisible();
    await expect(sheet.getByRole("heading", { name: /Onboarding/ })).toBeVisible();
  });

  test("adds a person", async ({ page }) => {
    await signInAs(page, SUMMIT_HR, "/hr/employees");
    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByLabel("Full name").fill("Jonah Test");
    await page.getByRole("button", { name: "Add person" }).last().click();
    await expect(page.getByText("Jonah Test added")).toBeVisible();
  });

  test("sends a timesheet back with a reason, and bulk approves the clean ones", async ({ page }) => {
    await signInAs(page, SUMMIT_HR, "/hr/timesheets?view=queue");
    const reject = page.getByRole("button", { name: "Send back" }).first();
    await expect(reject).toBeVisible();
    await reject.click();
    await page.getByRole("dialog").getByRole("textbox").fill("Friday is missing the afternoon");
    await page.getByRole("dialog").getByRole("button", { name: "Send back" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("checkbox", { name: /select all/i }).check();
    await page.getByRole("button", { name: "Approve selected" }).click();
    await expect(page.getByRole("dialog").getByText(/hours in total/)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/timesheets approved/)).toBeVisible();
  });

  test("uploads hours from the template and reports bad rows", async ({ page }) => {
    await signInAs(page, SUMMIT_HR, "/hr/timesheets");
    await page.getByRole("button", { name: "Upload hours" }).click();
    const today = new Date().toISOString().slice(0, 10);
    const csv = `employee_email,employee_external_id,employee_name,work_date,hours_worked,note\nnobody@example.com,,Nobody,${today},8,\n`;
    await page
      .getByLabel("Timesheet file")
      .setInputFiles({ name: "hours.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByText(/1 with errors/)).toBeVisible();
    await expect(page.getByText(/No employee matches this row/)).toBeVisible();
  });

  test("declining time off needs a reason; the team calendar shows who is out", async ({ page }) => {
    await signInAs(page, SUMMIT_HR, "/hr/time-off");
    await page.getByRole("button", { name: "Decline" }).first().click();
    await page.getByRole("dialog").getByRole("textbox").fill("Inventory week");
    await page.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("tab", { name: "Team calendar" }).click();
    await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
    await page.getByRole("tab", { name: "Balances" }).click();
    await expect(page.getByRole("button", { name: "Vacation, column options" })).toBeVisible();
  });

  test("approves a commission statement and shows the plans and signatures", async ({ page }) => {
    await signInAs(page, SUMMIT_HR, "/hr/commissions");
    await page
      .getByRole("row", { name: /^Open .*statement$/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Approve statement" }).click();
    await expect(page.getByText(/^Statement approved for/)).toBeVisible();
    await page.getByRole("tab", { name: "Plans", exact: true }).click();
    await expect(page.getByText("Showroom plan, version 1")).toBeVisible();
    await page.getByRole("tab", { name: "People on plans" }).click();
    await expect(page.getByText("Not signed").first()).toBeVisible();
  });

  test("an adjustment needs a reason, and a deduction needs its invoice", async ({ page }) => {
    await signInAs(page, SUMMIT_HR, "/hr/commissions");
    await page
      .getByRole("row", { name: /^Open .*statement$/ })
      .first()
      .click();
    // The reason goes to the audit log, so it asks for no amounts (owner decision 2026-11-14).
    await expect(page.getByLabel("Reason")).toHaveAccessibleDescription("Don't type amounts here.");
    await page.getByLabel("Amount").fill("-20");
    await page.getByLabel("Reason").fill("Return");
    await page.getByRole("button", { name: "Add adjustment" }).click();
    await expect(page.getByText("A deduction must name the invoice it relates to.")).toBeVisible();
    await page.getByLabel("Amount").fill("40");
    await page.getByLabel("Reason").fill("October spiff");
    await page.getByRole("button", { name: "Add adjustment" }).click();
    await expect(page.getByText("Adjustment added")).toBeVisible();
  });

  test("the pay period shows the label, stops on unapproved weeks and approves once they are left out", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/hr/pay-periods");
    await expect(page.getByTestId("gross-pay-label")).toHaveText(
      "Gross pay estimate. Taxes and net pay are calculated by your payroll provider.",
    );
    await expect(page.getByRole("heading", { name: /timesheets still need approval/ })).toBeVisible();
    await page.getByRole("button", { name: "Approve pay period" }).click();
    await expect(page.getByText(/timesheets still need approval, or leave those people out/)).toBeVisible();
    await page.getByRole("tab", { name: "Contractor payments" }).click();
    await expect(page.getByText(/Contractors are paid by job/)).toBeVisible();
  });

  test("Settings → HR changes what employees see", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/hr");
    await expect(page.getByRole("heading", { name: "Time-off policies" })).toBeVisible();
    await page.getByLabel("Show who is out to employees").check();
    await saveHr(page);
    await expect(page.getByText("HR saved")).toBeVisible();
  });

  test("Settings → HR keeps the pay frequency once pay periods exist, and says why", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/hr");
    await page.getByLabel("Pay frequency").click();
    await page.getByRole("option", { name: "Weekly" }).click();
    await saveHr(page);
    await expect(page.getByText(HR_MESSAGES.scheduleLocked)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Pay frequency")).toContainText("Every two weeks");
  });

  test("Settings → HR says why a holiday date listed twice is refused, before any code", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/hr");
    const first = page.getByRole("button", { name: /^Remove / }).first();
    const date = (await first.getAttribute("aria-label"))!.split(" ").at(-1)!;
    await page.getByLabel("Holiday date").fill(date);
    await page.getByLabel("Holiday name").fill("Again");
    await page.getByRole("button", { name: "Add holiday" }).click();
    await page.getByRole("button", { name: "Save hr" }).click();
    await expect(page.getByText(HR_MESSAGES.holidayTwice)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
  });

  test("Sales → Team links commission to the HR figures", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales?view=team");
    await expect(page.getByRole("button", { name: "Commission earned, column options" })).toBeVisible();
  });
});

test.describe("HR Suite workspace", { tag: HR_TAG }, () => {
  test("has People and Pay periods in the sidebar and no commission", async ({ page }) => {
    await signInAs(page, HARBOR_OWNER, "/");
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: "People" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Pay periods" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Commissions" })).toHaveCount(0);
  });

  test("the California guard refuses a carryover limit on vacation", async ({ page }) => {
    await signInAs(page, HARBOR_HR, "/settings/hr");
    await page.getByRole("button", { name: "Edit Vacation" }).click();
    await page.getByLabel("Carryover limit, hours").fill("40");
    await page.getByRole("button", { name: "Save policy" }).click();
    await expect(page.getByText(/California does not allow a carryover limit/)).toBeVisible();
  });
});
