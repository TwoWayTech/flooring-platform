import { expect, test, type Page } from "@playwright/test";
import { HARBOR_OWNER, HR_TAG, PHONE, signInAs, SUMMIT_OWNER, type Persona } from "./helpers";
import { FLOORING_SCREENS, HR_SCREENS } from "./screens";

/** Fails when the page scrolls sideways (CLAUDE.md rule 6: responsive from 375 px). */
async function expectNoSidewaysScroll(page: Page, persona: Persona, path: string) {
  await signInAs(page, persona, path);
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("phone layout", () => {
  test.use(PHONE);
  for (const path of FLOORING_SCREENS) {
    test(`${path} has no horizontal page scroll`, ({ page }) => expectNoSidewaysScroll(page, SUMMIT_OWNER, path));
  }
});

test.describe("phone layout, HR Suite", { tag: HR_TAG }, () => {
  test.use(PHONE);
  for (const path of HR_SCREENS) {
    test(`${path} has no horizontal page scroll`, ({ page }) => expectNoSidewaysScroll(page, HARBOR_OWNER, path));
  }
});
