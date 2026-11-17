import { expect, test, type Page } from "@playwright/test";
import { featureOn } from "@workspace/shared";
import { HARBOR_OWNER, signInAs, SUMMIT_OWNER } from "./helpers";

/** Saves the Payments page, confirming the step-up with any six digits when the switch asks for one. */
async function savePayments(page: Page) {
  await page.getByRole("button", { name: "Save payments" }).click();
  if (!featureOn("auth.step-up")) return;
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  await dialog.getByLabel("Authenticator code").fill("123456");
  await dialog.getByRole("button", { name: "Confirm" }).click();
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

test.describe("HR Suite settings", () => {
  test("shows only the groups an HR company uses @hr", async ({ page }) => {
    await signInAs(page, HARBOR_OWNER, "/settings");
    await expect(page.getByRole("heading", { name: "People and access", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inventory and warehouses", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sales and documents", exact: true })).toHaveCount(0);
  });
});
