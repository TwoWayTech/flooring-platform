import { expect, test } from "@playwright/test";
import { HARBOR_OWNER, signInAs, SUMMIT_OWNER } from "./helpers";

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

test.describe("HR Suite settings", () => {
  test("shows only the groups an HR company uses @hr", async ({ page }) => {
    await signInAs(page, HARBOR_OWNER, "/settings");
    await expect(page.getByRole("heading", { name: "People and access", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inventory and warehouses", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sales and documents", exact: true })).toHaveCount(0);
  });
});
