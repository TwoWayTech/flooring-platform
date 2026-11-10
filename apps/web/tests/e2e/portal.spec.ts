import { expect, test } from "@playwright/test";
import { HR_TAG, signInAs, skipIfFeatureOff } from "./helpers";

const BRI = { companyId: "summit", userId: "sm-usr-14", roleKey: "employee" } as const;
const PRIYA = { companyId: "summit", userId: "sm-usr-03", roleKey: "sales" } as const;
const MIA = { companyId: "harbor", userId: "hb-usr-03", roleKey: "employee" } as const;
const TAMARA = { companyId: "summit", userId: "sm-usr-07", roleKey: "hr" } as const;

test.describe("Employee portal (spec C2)", () => {
  test("an employee lands on the portal and hidden items do not appear", async ({ page }) => {
    await signInAs(page, BRI, "/");
    await expect(page).toHaveURL(/\/my$/);
    const portal = page.getByRole("navigation", { name: "My portal" });
    await expect(portal.getByRole("link", { name: "My timesheet" })).toBeVisible();
    await expect(portal.getByRole("link", { name: "My pay" })).toBeVisible();
    await expect(portal.getByRole("link", { name: "My commission" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "HR", exact: true })).toHaveCount(0);
  });

  test("fills in a week and submits it; HR sees it to approve", async ({ page }) => {
    await signInAs(page, BRI, "/my/timesheet");
    await page.getByLabel("Mon").fill("8");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Timesheet submitted")).toBeVisible();
    await expect(page.getByLabel("Mon")).toBeDisabled();
    await signInAs(page, TAMARA, "/hr/timesheets?view=queue");
    await page.getByLabel("Search timesheets").fill("Bri Alvarez");
    await expect(page.getByRole("cell", { name: "Bri Alvarez" }).first()).toBeVisible();
  });

  test("requests time off and sees it waiting", async ({ page }) => {
    await signInAs(page, BRI, "/my/time-off");
    await expect(page.getByRole("heading", { name: "Balances" })).toBeVisible();
    await page.getByRole("button", { name: "Request time off" }).click();
    await page.getByLabel("Hours").fill("4");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Time-off request sent")).toBeVisible();
    await expect(page.getByText("Pending").first()).toBeVisible();
  });

  test("clocks in and out, and the hours reach the timesheet", async ({ page }) => {
    skipIfFeatureOff("hr.clock");
    await signInAs(page, BRI, "/my");
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByText("Clocked in", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clock out" }).click();
    await expect(page.getByText(/Clocked out/)).toBeVisible();
  });

  test("My pay carries the label and hides commission when HR has it off", async ({ page }) => {
    await signInAs(page, BRI, "/my/pay");
    await expect(
      page.getByText("Gross pay estimate. Taxes and net pay are calculated by your payroll provider."),
    ).toBeVisible();
    await expect(page.getByText("Earned to date this year")).toBeVisible();
    await expect(page.getByText(/commission/i)).toHaveCount(0);
  });

  test("a rep HR has made it visible for sees commission statements and base", async ({ page }) => {
    await signInAs(page, PRIYA, "/my/commission");
    await expect(page.getByText("Waiting to be paid")).toBeVisible();
    await expect(page.getByText("Payable").first()).toBeVisible();
    await signInAs(page, PRIYA, "/my");
    await expect(
      page.getByRole("navigation", { name: "My portal" }).getByRole("link", { name: "My commission" }),
    ).toBeVisible();
  });

  test("updates own contact details", async ({ page }) => {
    await signInAs(page, BRI, "/my/profile");
    await page.getByLabel("Phone", { exact: true }).fill("(303) 555-0100");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();
  });

  test("My documents opens a file", async ({ page }) => {
    await signInAs(page, BRI, "/my/documents");
    await page.getByRole("button", { name: "Offer letter.pdf" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("an employee cannot open HR pages", async ({ page }) => {
    await signInAs(page, BRI, "/hr/pay-periods");
    await expect(page.getByText("You don't have access to this page.")).toBeVisible();
  });
});

test.describe("Employee portal in the HR Suite", { tag: HR_TAG }, () => {
  test("Mia lands on the portal and sees only her own timesheet", async ({ page }) => {
    await signInAs(page, MIA, "/");
    await expect(page).toHaveURL(/\/my$/);
    await page.goto("/my/timesheet");
    await expect(page.getByLabel("Week", { exact: true })).toBeVisible();
    await expect(page.getByText("Team calendar")).toHaveCount(0);
  });
});
