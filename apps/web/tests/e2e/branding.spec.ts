import { expect, test, type Page } from "@playwright/test";
import { featureOn } from "@workspace/shared";
import { signInAs, SUMMIT_OWNER } from "./helpers";

const brandVar = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim().toLowerCase());

/** Saves Branding, confirming the step-up with any six digits when the switch asks for one (ADR 0059, part 6). */
async function saveBranding(page: Page) {
  await page.getByRole("button", { name: "Save branding" }).click();
  if (!featureOn("auth.step-up")) return;
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  await dialog.getByLabel("Authenticator code").fill("123456");
  await dialog.getByRole("button", { name: "Confirm" }).click();
}

test.describe("settings: branding", () => {
  test("a new brand color applies across the shell at once", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, SUMMIT_OWNER, "/settings/branding");
    const before = await brandVar(page);
    await page.getByLabel("Brand color", { exact: true }).fill("#7A3E9D");
    await expect(page.getByText(/Passes WCAG AA/)).toBeVisible();
    await saveBranding(page);
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

  test("BS1 a blank display name shows the shared words before any code, and the demo still offers a logo", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/branding");
    await expect(page.getByText("Upload logo")).toBeVisible();
    await page.getByLabel("Display name").fill("   ");
    await page.getByRole("button", { name: "Save branding" }).click();
    await expect(page.getByText("Enter a display name of up to 80 characters, on one line.")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
  });

  test("BS2 a saved branding change is audited", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/branding");
    await page.getByLabel("Monogram letters").fill("SC");
    await saveBranding(page);
    await expect(page.getByText("Branding saved")).toBeVisible();
    await page.goto("/settings/audit");
    await expect(
      page.getByRole("row").filter({ hasText: "Changed branding" }).filter({ hasText: "Branding" }).first(),
    ).toBeVisible();
  });
});
