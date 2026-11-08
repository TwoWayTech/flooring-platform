import { expect, test, type Page } from "@playwright/test";
import { HR_TAG, PHONE } from "./helpers";

/** Each persona and the home it should land on (spec section 2: "Each persona lands on its allowed home"). */
const FLOORING_PERSONAS: [name: string, home: RegExp][] = [
  ["Dana Whitfield", /\/$/],
  ["Luis Ortega", /\/$/],
  ["Priya Natarajan", /\/$/],
  ["Cole Brennan", /\/$/],
  ["Marcus Bell", /\/installation$/],
  ["Grace Liu", /\/$/],
  ["Tamara Reyes", /\/hr$/],
];

const HR_PERSONAS: [name: string, home: RegExp][] = [
  ["Elena Brooks", /\/$/],
  ["Andre Wallace", /\/$/],
  ["Mia Chen", /\/hr\/timesheets$/],
];

async function signInThroughForm(page: Page, persona: string) {
  await page.getByRole("radio", { name: new RegExp(persona) }).click();
  await page.getByLabel("Authenticator code").fill("123456");
  await page.getByRole("button", { name: `Sign in as ${persona}` }).click();
}

test.describe("login", () => {
  for (const [persona, home] of FLOORING_PERSONAS) {
    test(`${persona} lands on their home`, async ({ page }) => {
      await page.goto("/login?product=flooring");
      await signInThroughForm(page, persona);
      await expect(page).toHaveURL(home);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    });
  }

  for (const [persona, home] of HR_PERSONAS) {
    test(`HR host: ${persona} lands on their home`, { tag: HR_TAG }, async ({ page }) => {
      await page.goto("/login?product=hr");
      await expect(page.getByText("HR Suite").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Harbor Staffing Co./ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Summit Floor Co./ })).toHaveCount(0);
      await signInThroughForm(page, persona);
      await expect(page).toHaveURL(home);
    });
  }

  test("rejects a code that is not six digits", async ({ page }) => {
    await page.goto("/login?product=flooring");
    await page.getByRole("radio", { name: /Dana Whitfield/ }).click();
    await page.getByLabel("Authenticator code").fill("12");
    await page.getByRole("button", { name: "Sign in as Dana Whitfield" }).click();
    await expect(page.getByText("Enter the 6-digit code from your authenticator app.")).toBeVisible();
  });

  test("signing out returns to the login page", async ({ page }) => {
    await page.goto("/login?product=flooring");
    await signInThroughForm(page, "Dana Whitfield");
    await page.getByRole("button", { name: "Account: Dana Whitfield" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("login on a phone", () => {
  test.use(PHONE);

  test("lays out on a phone", async ({ page }) => {
    await page.goto("/login?product=flooring");
    await expect(page.getByRole("radio", { name: /Dana Whitfield/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
