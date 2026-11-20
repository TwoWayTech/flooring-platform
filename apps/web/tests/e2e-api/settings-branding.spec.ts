import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { OWNER_EMAIL, SALES_EMAIL } from "./accounts";
import { auditBy, canonical, confirmStepUp, expectAuditRows, putWithStepUp, readAs } from "./flows/checks";
import { flowTest, resetAuthAround } from "./flows/kit";

/**
 * Summit's seeded branding (`packages/shared/fixtures/summit.json`, written to the control
 * `tenant_branding` row by `packages/db/src/seed/control.ts`), as `PUT /settings/branding` takes it
 * back. Written out, not imported, so this spec builds on code without part 6's shared rules.
 */
const SUMMIT_BRANDING = {
  displayName: "Summit Floor Co.",
  monogram: "SF",
  brandColor: "#2E8B7E",
  pattern: "herringbone",
  logoDataUrl: null,
  defaultTheme: "system",
};
const ACTION = "Changed branding";
const NAME_MESSAGE = "Enter a display name of up to 80 characters, on one line.";
const LOGO_MESSAGE = "Logos can't be uploaded yet. The monogram stands in for a logo.";

/** What these tests read of `GET /settings`, loosely, so the spec builds with or without part 6's types. */
type Read = { branding?: { displayName: string; brandColor: string; logoDataUrl: string | null } };

/** The shell's brand color variable, as the page paints it. */
function brandVar(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--brand").trim().toLowerCase(),
  );
}

/**
 * Puts Summit's branding back unless `GET /settings` already answers it: a PUT with a step-up.
 * Throws unless the API answered 200, so a refused restore fails the clean-up.
 */
async function healBranding(request: APIRequestContext, secret: string): Promise<APIResponse> {
  const read = await request.get("/api-proxy/settings");
  expect(read.status(), `GET /settings answered ${read.status()}: ${await read.text()}`).toBe(200);
  if (canonical(((await read.json()) as Read).branding) === canonical(SUMMIT_BRANDING)) return read;
  const response = await putWithStepUp(request, secret, "/settings/branding", SUMMIT_BRANDING);
  if (response.status() !== 200)
    throw new Error(`Putting branding back answered ${response.status()}: ${await response.text()}`);
  return response;
}

/**
 * Settings part 6 on the API (ADR 0059, part 6; spec settings-and-permissions.md, Real build,
 * "Settings on the API, part 6"): Settings → Branding reads and saves the control branding row
 * through `GET /settings` and `PUT /settings/branding`. A refused value shows the shared words before
 * any code; a valid save always asks for one; another person's shell follows; Sales can't save; the
 * API takes no logo. The test heals Summit's branding first, puts it back as its last step, and
 * registers a clean-up that repeats the restore and fails if the API refuses it.
 */
flowTest.describe("Settings part 6 on the API (api mode)", () => {
  resetAuthAround([OWNER_EMAIL, SALES_EMAIL]);

  flowTest(
    "BE1 Branding on the API: the rule's words before a code, a save after one, another person's shell follows, no logo",
    async ({ personas }) => {
      flowTest.setTimeout(180_000);
      const dana = await personas.open(OWNER_EMAIL, { mfa: true });
      const priya = await personas.open(SALES_EMAIL);
      personas.onCleanup("put branding back", () => healBranding(dana.request, dana.secret!));
      expect((await healBranding(dana.request, dana.secret!)).status()).toBe(200);
      const since = Date.now();
      const before = await auditBy(dana.request, ACTION, "Dana Whitfield", since);
      const brandingPuts: string[] = [];
      dana.page.on("request", (request) => {
        if (request.method() === "PUT" && new URL(request.url()).pathname === "/api-proxy/settings/branding")
          brandingPuts.push(request.url());
      });

      // 1. The page offers no logo upload in api mode: the monogram stands in.
      await dana.page.goto("/settings/branding");
      await expect(dana.page.getByText(LOGO_MESSAGE)).toBeVisible();
      await expect(dana.page.getByText("Upload logo")).toHaveCount(0);

      // 2. A blank display name shows the shared words; no code is asked and nothing is sent.
      const name = dana.page.getByLabel("Display name");
      await name.fill("   ");
      await dana.page.getByRole("button", { name: "Save branding" }).click();
      await expect(dana.page.getByText(NAME_MESSAGE)).toBeVisible();
      await expect(dana.page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
      expect(brandingPuts).toEqual([]);
      await name.fill(SUMMIT_BRANDING.displayName);

      // 3. A new brand color saves after a code, and the shell repaints at once.
      await dana.page.emulateMedia({ colorScheme: "light" });
      const painted = await brandVar(dana.page);
      await dana.page.getByLabel("Brand color", { exact: true }).fill("#7A3E9D");
      const saved = dana.page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          new URL(response.url()).pathname === "/api-proxy/settings/branding" &&
          response.status() === 200,
      );
      await dana.page.getByRole("button", { name: "Save branding" }).click();
      await expect(dana.page.getByRole("dialog", { name: "Confirm it is you" })).toBeVisible();
      await confirmStepUp(dana.page, dana.secret!);
      await saved;
      await expect(dana.page.getByText("Branding saved")).toBeVisible();
      await expect.poll(() => brandVar(dana.page)).not.toBe(painted);

      // 4. Priya reads the API's branding, and her shell paints it after a reload.
      const hers = await readAs<Read>(priya.request, "/settings");
      expect(hers.branding?.brandColor.toUpperCase()).toBe("#7A3E9D");
      expect(hers.branding?.logoDataUrl).toBeNull();
      await priya.page.emulateMedia({ colorScheme: "light" });
      await priya.page.goto("/");
      await expect.poll(() => brandVar(priya.page)).toBe(await brandVar(dana.page));

      // 5. What Sales isn't offered, the API refuses.
      const denied = await priya.request.put("/api-proxy/settings/branding", { data: SUMMIT_BRANDING });
      expect(denied.status()).toBe(403);
      expect((await denied.json()).code).toBe("forbidden");

      // 6. The API keeps no logo: a data URL is refused with words, before any code.
      const logo = await dana.request.put("/api-proxy/settings/branding", {
        data: { ...SUMMIT_BRANDING, logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" },
      });
      expect(logo.status()).toBe(400);
      expect(await logo.json()).toMatchObject({ code: "invalid_request", message: LOGO_MESSAGE });

      // 7. Put back; the save and the restore are audited as Dana, naming Branding.
      expect((await healBranding(dana.request, dana.secret!)).status()).toBe(200);
      expect(await auditBy(dana.request, ACTION, "Dana Whitfield", since)).toBe(before + 2);
      await expectAuditRows(dana.page, "Branding", [ACTION], since);
    },
  );
});
