import { expect, test } from "@playwright/test";
import { HARBOR_OWNER, HR_TAG, PHONE, signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("app shell", () => {
  test("shows flooring menus for a flooring company", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER);
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const label of ["Dashboard", "Sales", "Inventory", "Purchasing", "Installation", "Reports"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /Summit Floor Co..*switch company/ })).toBeVisible();
  });

  test("HR host shows only HR menus", { tag: HR_TAG }, async ({ page }) => {
    await signInAs(page, HARBOR_OWNER);
    await expect(page).toHaveTitle(/HR Suite/);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Employees" })).toBeVisible();
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
