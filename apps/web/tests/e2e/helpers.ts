import { devices, expect, test, type Page } from "@playwright/test";
import { featureOn, type FeatureKey } from "@workspace/shared";

/**
 * Skips the current describe or test while a feature's switch is off (spec section 0.6: a
 * feature switched off keeps its code, and its tests skip by themselves until it is back on).
 */
export function skipIfFeatureOff(key: FeatureKey) {
  test.skip(!featureOn(key), `${key} is switched off`);
}

/** A persona to sign in as, by company and role. */
export interface Persona {
  companyId: "summit" | "keystone" | "harbor";
  userId: string;
  roleKey: string;
}

/** Summit's Owner, the default presenter persona. */
export const SUMMIT_OWNER: Persona = { companyId: "summit", userId: "sm-usr-01", roleKey: "owner" };
/** Harbor Staffing's Owner on the HR host. */
export const HARBOR_OWNER: Persona = { companyId: "harbor", userId: "hb-usr-01", roleKey: "owner" };

/**
 * Signs in through the demo route handler and opens a page, skipping the login screen for tests
 * that are about other screens. HR personas use `?product=hr`, which stands in for the HR host.
 * Waits for the shell's top bar, so keyboard shortcuts are bound before a test uses them.
 */
export async function signInAs(page: Page, persona: Persona, path = "/") {
  const hr = persona.companyId === "harbor";
  await page.goto(hr ? "/login?product=hr" : "/login?product=flooring");
  const status = await page.evaluate(async (body) => {
    const response = await fetch("/api/demo/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "company", ...body }),
    });
    return response.status;
  }, persona);
  expect(status).toBe(200);
  await page.goto(path);
  await expect(page.getByRole("button", { name: "Search or run a command" })).toBeVisible();
}

/** Signs in as the platform admin (the "Platform admin (you)" card) and opens an admin page. */
export async function signInAsPlatformAdmin(page: Page, path = "/admin") {
  await page.goto("/login?product=flooring");
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/demo/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "platform" }),
    });
    return response.status;
  });
  expect(status).toBe(200);
  await page.goto(path);
}

const pixel = devices["Pixel 7"];

/**
 * A phone (375 px wide, the narrowest the spec asks for) for layout tests. Set it with `test.use(PHONE)` in a describe, so
 * both product projects run their own phone checks.
 */
export const PHONE = {
  viewport: { width: 375, height: 812 },
  userAgent: pixel.userAgent,
  deviceScaleFactor: pixel.deviceScaleFactor,
  isMobile: pixel.isMobile,
  hasTouch: pixel.hasTouch,
};

/** Sends the quote on screen and marks it accepted, the state Convert to invoice needs (audit U-20). */
export async function sendAndAccept(page: Page) {
  await page.getByRole("button", { name: "Send / mark pending" }).click();
  await page.getByRole("dialog", { name: "Send quote" }).getByRole("button", { name: "Mark as pending" }).click();
  await page.getByRole("button", { name: "Mark accepted" }).click();
  await expect(page.getByRole("button", { name: "Convert to invoice" })).toBeVisible();
}

/** Tag for tests that belong to the HR Suite project, which runs them on the HR host. */
export const HR_TAG = "@hr";

/** Tag for the few tests CI runs on every push to main and every pull request: sign-in, home, sign-out on both hosts. */
export const SMOKE_TAG = "@smoke";

/** Tag for the named end-to-end flows of feature batch 2, H; run them with `--grep @flow`. */
export const FLOW_TAG = "@flow";
