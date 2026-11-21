import { expect, test } from "@playwright/test";
import { resetAuthState } from "@workspace/db/testing";
import { PLATFORM_ADMIN_EMAIL, signInAndEnrol } from "./accounts";

/** The control database the API uses (global-setup.ts checks it is set). */
const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "";

// The platform admin `pnpm db:seed` writes for local testing (ADR 0065). Until the admin host
// exists (owner question 1) a platform admin signs in through their home company, Summit, where
// they are an Employee (docs/specs/platform-admin.md, "Sign-in and the platform session"). Platform
// admins require MFA, so the account enrols an authenticator app; its sign-in state is reset around
// the test. platform-admin.spec.ts still makes Dana an admin for its own tests.
test.describe("seeded platform admin (api mode)", () => {
  test.beforeAll(() => resetAuthState(CONTROL_URL, [PLATFORM_ADMIN_EMAIL]));
  test.afterAll(() => resetAuthState(CONTROL_URL, [PLATFORM_ADMIN_EMAIL]));

  test("signs in through Summit, enrols an authenticator and lists both seeded companies in /admin", async ({
    page,
  }) => {
    await signInAndEnrol(page, PLATFORM_ADMIN_EMAIL);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Summit Floor Co\./ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Harbor Staffing Co\./ })).toBeVisible();
  });
});
