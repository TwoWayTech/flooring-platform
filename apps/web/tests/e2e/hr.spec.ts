import { expect, test } from "@playwright/test";
import { HARBOR_OWNER, HR_TAG, signInAs, SUMMIT_OWNER } from "./helpers";

const HARBOR_HR = { companyId: "harbor", userId: "hb-usr-02", roleKey: "hr" } as const;
const HARBOR_EMPLOYEE = { companyId: "harbor", userId: "hb-usr-03", roleKey: "employee" } as const;

test.describe("HR Suite", { tag: HR_TAG }, () => {
  test("HR host home is the HR dashboard", async ({ page }) => {
    await signInAs(page, HARBOR_OWNER);
    await expect(page.getByRole("heading", { name: "HR dashboard" })).toBeVisible();
    await expect(page.getByText("Headcount", { exact: true })).toBeVisible();
  });

  test("the HR manager sees pay rates", async ({ page }) => {
    await signInAs(page, HARBOR_HR, "/hr/employees");
    await expect(page.getByRole("button", { name: "Pay rate, column options" })).toBeVisible();
  });

  test("with the California pay rules switched off, everyone is on the federal rule and the screen says so", async ({
    page,
  }) => {
    // hr.payroll.california is off until a payroll review (ADR 0050); Harbor has California staff.
    await signInAs(page, HARBOR_HR, "/hr/timesheets");
    await expect(page.getByTestId("california-pay-note")).toContainText("California pay rules are off");
    await expect(page.getByText("Federal rule").first()).toBeVisible();
    await expect(page.getByText("California rule", { exact: true })).toHaveCount(0);
    await expect(page.locator("td[data-overtime]")).toHaveCount(0);
  });

  test("approves a time-off request", async ({ page }) => {
    await signInAs(page, HARBOR_HR, "/hr/time-off");
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByText(/^Time off approved for/)).toBeVisible();
  });

  test("an employee uses the portal, not the HR timesheet grid", async ({ page }) => {
    await signInAs(page, HARBOR_EMPLOYEE, "/hr/timesheets");
    await expect(page.getByRole("heading", { name: "Timesheets", exact: true })).toHaveCount(0);
  });
});

test.describe("HR module in the Flooring Suite", () => {
  test("pay rate is hidden from a role without HR's sensitive permission", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/hr/employees");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Manager");
    await page.getByRole("option", { name: "View as Manager" }).click();
    await expect(page.getByRole("button", { name: "Department, column options" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay rate, column options" })).toHaveCount(0);
  });
});
