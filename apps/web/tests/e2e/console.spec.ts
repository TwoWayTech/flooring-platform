import { expect, test, type Page } from "@playwright/test";
import { HARBOR_OWNER, signInAs, signInAsPlatformAdmin, SUMMIT_OWNER } from "./helpers";
import { ADMIN_SCREENS, FLOORING_SCREENS, HR_SCREENS } from "./screens";

/** Records console errors and uncaught exceptions, the "no console errors" bar of spec section 6. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => errors.push(error.message.slice(0, 300)));
  return errors;
}

const SCREENS = [
  ...FLOORING_SCREENS.map((path) => ({ name: path, open: (page: Page) => signInAs(page, SUMMIT_OWNER, path) })),
  ...HR_SCREENS.map((path) => ({ name: `HR ${path}`, open: (page: Page) => signInAs(page, HARBOR_OWNER, path) })),
  ...ADMIN_SCREENS.map((path) => ({ name: path, open: (page: Page) => signInAsPlatformAdmin(page, path) })),
];

test.describe("no console errors", () => {
  // A saved theme is the case that differs between server and browser, so it catches hydration mismatches.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  });

  for (const screen of SCREENS) {
    test(screen.name, async ({ page }) => {
      const errors = collectErrors(page);
      await screen.open(page);
      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
    });
  }
});
