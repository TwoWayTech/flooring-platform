import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

const brandVar = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim().toLowerCase());

test.describe("settings: branding", () => {
  test("a new brand color applies across the shell at once", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, SUMMIT_OWNER, "/settings/branding");
    const before = await brandVar(page);
    await page.getByLabel("Brand color", { exact: true }).fill("#7A3E9D");
    await expect(page.getByText(/Passes WCAG AA/)).toBeVisible();
    await page.getByRole("button", { name: "Save branding" }).click();
    await expect(page.getByText("Branding saved")).toBeVisible();
    await expect.poll(() => brandVar(page)).not.toBe(before);

    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect.poll(() => brandVar(page)).not.toBe(before);
  });

  test("blocks a color too light to read", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/branding");
    await page.getByLabel("Brand color", { exact: true }).fill("#F5F0A0");
    await expect(page.getByText("This color is too light to read against panels. Pick a deeper shade.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save branding" })).toBeDisabled();
  });
});
