import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { HARBOR_OWNER, HR_TAG, signInAs, signInAsPlatformAdmin, SUMMIT_OWNER } from "./helpers";
import { ADMIN_SCREENS, FLOORING_SCREENS, HR_SCREENS } from "./screens";

/** WCAG 2.1 A and AA, the accessibility bar in CLAUDE.md rule 6 and spec Tier 3. */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const THEMES = ["light", "dark"] as const;

/** Picks the theme before the app loads, the way a person's saved choice would. */
async function useTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
}

/** Runs axe once the screen has its data and lists each violation with the elements it found. */
async function expectNoViolations(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-label^="Loading"]')).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const report = violations.map((v) => {
    const nodes = v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
    return `${v.id}: ${v.help}\n  ${nodes.join("\n  ")}`;
  });
  expect(report).toEqual([]);
}

for (const theme of THEMES) {
  test.describe(`accessibility, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => useTheme(page, theme));

    for (const path of FLOORING_SCREENS) {
      test(`${path}`, async ({ page }) => {
        await signInAs(page, SUMMIT_OWNER, path);
        await expectNoViolations(page);
      });
    }

    for (const path of HR_SCREENS) {
      test(`HR ${path}`, { tag: HR_TAG }, async ({ page }) => {
        await signInAs(page, HARBOR_OWNER, path);
        await expectNoViolations(page);
      });
    }

    for (const path of ADMIN_SCREENS) {
      test(`${path}`, async ({ page }) => {
        await signInAsPlatformAdmin(page, path);
        await expectNoViolations(page);
      });
    }

    test("login, flooring", async ({ page }) => {
      await page.goto("/login?product=flooring");
      await expectNoViolations(page);
    });

    test("login, hr", { tag: HR_TAG }, async ({ page }) => {
      await page.goto("/login?product=hr");
      await expectNoViolations(page);
    });
  });
}

test.describe("keyboard and motion", () => {
  for (const theme of THEMES) {
    test(`the presenter guide passes the same checks, ${theme} theme`, async ({ page }) => {
      await useTheme(page, theme);
      await signInAs(page, SUMMIT_OWNER, "/");
      await page.getByRole("button", { name: "Presenter guide", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "Demo steps" })).toBeVisible();
      await expectNoViolations(page);
    });
  }

  test("the skip link moves focus past the menus to the page", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("closing a dialog returns focus to the button that opened it", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    const open = page.getByRole("button", { name: "New meeting" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "New meeting" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
  });

  test("with reduced motion, CSS animations finish at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await page.getByRole("button", { name: "New meeting" }).click();
    const dialog = page.getByRole("dialog", { name: "New meeting" });
    const seconds = await dialog.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(seconds).toBeLessThan(0.001);
  });
});
