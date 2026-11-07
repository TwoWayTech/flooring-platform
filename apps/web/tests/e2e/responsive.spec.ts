import { expect, test } from "@playwright/test";
import { HARBOR_OWNER, signInAs, SUMMIT_OWNER } from "./helpers";
import { FLOORING_SCREENS, HR_SCREENS } from "./screens";

/** Every screen at phone width (CLAUDE.md rule 6: responsive from 375 px, no sideways page scroll). */
test.describe("phone layout @phone", () => {
  const screens = [
    ...FLOORING_SCREENS.map((path) => ({ persona: SUMMIT_OWNER, path, name: path })),
    ...HR_SCREENS.map((path) => ({ persona: HARBOR_OWNER, path, name: `HR ${path}` })),
  ];
  for (const { persona, path, name } of screens) {
    test(`${name} has no horizontal page scroll @phone`, async ({ page }) => {
      await signInAs(page, persona, path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
