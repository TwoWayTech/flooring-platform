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
    await page.getByRole("button", { name: "Correct stock count" }).click();
    await page.getByLabel("Counted (ft)").fill("83");
    await page.getByLabel("Reason").fill("Yearly count");
    await page.getByRole("dialog").getByRole("button", { name: "Correct stock count" }).click();
    await expect(page.getByText(/Stock count corrected/)).toBeVisible();

    await page.goto("/settings/audit");
    await expect(page.getByRole("cell", { name: "Changed company profile" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Corrected stock count" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /ein: 84-1234567/ })).toBeVisible();
  });
});
