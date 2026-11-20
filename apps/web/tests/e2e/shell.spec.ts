import { expect, test } from "@playwright/test";
import { HARBOR_OWNER, HR_TAG, PHONE, signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("app shell", () => {
  test("shows flooring menus for a flooring company", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const label of ["Dashboard", "Sales", "Inventory", "Purchasing", "Meetings", "Reports"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /Summit Floor Co..*switch company/ })).toBeVisible();
  });

  test("HR host shows only HR menus", { tag: HR_TAG }, async ({ page }) => {
    await signInAs(page, HARBOR_OWNER);
    await expect(page).toHaveTitle(/HR Suite/);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "People" })).toBeVisible();
    for (const label of ["Sales", "Inventory", "Purchasing", "Installation", "Reports"]) {
      await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
    }
  });

  test("View as Sales hides purchasing and shows the banner", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Sales");
    await page.getByRole("option", { name: "View as Sales" }).click();
    await expect(page.getByRole("status")).toContainText("Viewing as Sales. Costs and margins are hidden.");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Purchasing" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Stop viewing as" }).click();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Purchasing" }),
    ).toBeVisible();
  });

  test("S1 a stored View as doesn't carry over to someone who may not view as (ADR 0051, 'GET /company')", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER);
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Sales");
    await page.getByRole("option", { name: "View as Sales" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Viewing as" })).toContainText("Viewing as Sales.");

    // The same tab, so sessionStorage keeps Dana's choice: Cole, the warehouse lead, signs in.
    await signInAs(page, { companyId: "summit", userId: "sm-usr-04", roleKey: "warehouse" });
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Inventory" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Viewing as" })).toHaveCount(0);
    expect(new URL(page.url()).pathname).not.toBe("/no-access");
    expect(await page.evaluate(() => sessionStorage.getItem("fp-view-as:summit"))).toBeNull();

    // The stale choice was cleared, so Dana starts as herself again.
    await signInAs(page, SUMMIT_OWNER);
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Purchasing" }),
    ).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Viewing as" })).toHaveCount(0);
  });

  test("switching company changes name and branding", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    const brand = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim());
    const summitBrand = await brand();
    await page.getByRole("button", { name: /Summit Floor Co..*switch company/ }).click();
    await page.getByRole("menuitem", { name: /Keystone Flooring Supply/ }).click();
    await expect(page.getByRole("button", { name: /Keystone Flooring Supply.*switch company/ })).toBeVisible();
    await expect.poll(brand).not.toBe(summitBrand);
  });
});

test.describe("app shell on a phone", () => {
  test.use(PHONE);

  test("opens the menu drawer", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "Inventory" })).toBeVisible();
  });
});
