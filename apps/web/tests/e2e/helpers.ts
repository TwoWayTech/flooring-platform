import { expect, type Page } from "@playwright/test";

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
  await expect(page.getByRole("button", { name: "Search or run a command (Ctrl K)" })).toBeVisible();
}
