import { expect, test } from "@playwright/test";
import { resetAuthState } from "@workspace/db/testing";
import { HARBOR_OWNER_EMAIL, signInAndEnrol } from "./accounts";

/** The control database the API uses (global-setup.ts checks it is set). */
const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "";

// The HR Suite company `pnpm db:seed` writes for local testing (ADR 0065; click-through #67):
// docs/demo-script.md section 5 starts with Elena Brooks, Harbor's Owner, on the HR host. Her role
// requires MFA, so she enrols an authenticator app at first sign-in; her sign-in state is reset
// around the test, as global-setup.ts does for every seeded account.
test.describe("HR Suite company (api mode)", () => {
  test.beforeAll(() => resetAuthState(CONTROL_URL, [HARBOR_OWNER_EMAIL]));
  test.afterAll(() => resetAuthState(CONTROL_URL, [HARBOR_OWNER_EMAIL]));

  test("Harbor's Owner signs in on the HR host and opens Harbor Staffing Co.'s HR dashboard", async ({ page }) => {
    // On localhost `?product=hr` picks the HR host and a cookie remembers it for the sign-in.
    await page.goto("/login?product=hr");
    await signInAndEnrol(page, HARBOR_OWNER_EMAIL);
    await expect(page.getByRole("heading", { name: "HR dashboard" })).toBeVisible();
    await expect(page.getByText("Harbor Staffing Co.").first()).toBeVisible();
    await expect(page.getByText("Your company does not have this product.")).toHaveCount(0);
  });
});
