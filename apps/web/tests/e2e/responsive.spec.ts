import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

/** Screens checked at phone width (CLAUDE.md rule 6: responsive from 375 px, no sideways page scroll). */
const PAGES = [
  "/",
  "/inventory",
  "/inventory?view=rolls",
  "/inventory/rolls/sm-roll-0004",
  "/sales",
  "/sales?view=invoices",
  "/sales?view=customers",
  "/purchasing?view=orders",
  "/purchasing?view=bills",
  "/installation",
  "/reports",
  "/sales/quotes/sm-quo-0288",
  "/sales/quotes/new",
  "/sales/invoices/sm-inv-0150",
];

test.describe("phone layout @phone", () => {
  for (const path of PAGES) {
    test(`${path} has no horizontal page scroll @phone`, async ({ page }) => {
      await signInAs(page, SUMMIT_OWNER, path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
