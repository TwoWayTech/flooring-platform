import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("settings: company profile and audit log", () => {
  test("validates the profile and records every change in the audit log", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/company");
    await page.getByLabel("EIN").fill("12345");
    await page.getByLabel("Phone").focus();
    await expect(page.getByText("Enter the EIN as 12-3456789.")).toBeVisible();
    await page.getByLabel("EIN").fill("84-1234567");
    await expect(page.getByText("Enter the EIN as 12-3456789.")).toHaveCount(0);
    await page.getByRole("button", { name: "Save company profile" }).click();
    await expect(page.getByText("Company profile saved")).toBeVisible();

    await page.goto("/inventory/rolls/sm-roll-0004");
    // A cut without an invoice is a stock adjustment (spec C1).
    await page.getByRole("button", { name: "Cut roll" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Adjustment" }).click();
    await page.getByLabel("Length to remove").fill("10");
    await page.getByRole("dialog").getByRole("button", { name: "Record adjustment" }).click();
    await expect(page.getByText(/^ADJ-\d{4} recorded$/)).toBeVisible();

    await page.goto("/settings/audit");
    await expect(page.getByRole("cell", { name: "Changed company profile" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Adjusted stock" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /ein: 84-1234567/ })).toBeVisible();
  });
});
