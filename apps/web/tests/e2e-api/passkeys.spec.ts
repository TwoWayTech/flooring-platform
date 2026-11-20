import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { resetAuthState } from "@workspace/db/testing";
import { HR_EMAIL, seedPassword } from "./accounts";

/**
 * The passkey screens on the real API (ADR 0060), with Chromium's virtual authenticator (CDP
 * `WebAuthn`), which answers the browser's prompt with user verification, as a fingerprint would.
 * Summit's HR manager must use two-step sign-in; she enrols with a passkey, is then refused a
 * password-only sign-in (`passkey_required`) and signs in with the passkey, and manages her
 * passkeys on Sign-in and security. Her sign-in state is reset before and after, so the specs that
 * enrol her with an authenticator app still can.
 */

const HR_NAME = "Tamara Reyes";

function controlUrl(): string {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error("Set CONTROL_DATABASE_URL to the control database the API uses.");
  return url;
}

/** A platform authenticator that verifies the user (PIN or biometric) and answers at once. */
async function addAuthenticator(cdp: CDPSession): Promise<string> {
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}

async function passwordSignIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(HR_EMAIL);
  await page.getByLabel("Password").fill(seedPassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: `Account: ${HR_NAME}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

const EXPIRED_WORDS =
  "Your password check has run out. Confirm your password again, then add the passkey within 5 minutes.";

/**
 * Makes the next request for registration options answer as the API does once the password check
 * has run out (403 `password_confirmation_required`), without waiting the 5 minutes.
 */
async function expirePasswordCheckOnce(page: Page) {
  await page.route(
    "**/api/auth/passkey/generate-register-options",
    (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "password_confirmation_required", message: "raw" }),
      }),
    { times: 1 },
  );
}

/** The auth calls the page sends, in order, as "METHOD path". */
function recordAuthCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/auth/")) calls.push(`${request.method()} ${path.slice("/api/auth".length)}`);
  });
  return calls;
}

test.describe("passkeys (api mode)", () => {
  test.beforeAll(async () => resetAuthState(controlUrl(), [HR_EMAIL]));
  test.afterAll(async () => resetAuthState(controlUrl(), [HR_EMAIL]));

  test("enrol with a passkey, sign in with it, then rename, add and remove passkeys", async ({ page }) => {
    test.setTimeout(120_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const first = await addAuthenticator(cdp);
    const calls = recordAuthCalls(page);

    await test.step("a required user enrols with a passkey, after the password", async () => {
      await passwordSignIn(page);
      await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
      await page.getByRole("radio", { name: /^Passkey/ }).check();
      await page.getByLabel("Confirm your password").fill(`${seedPassword()}-wrong`);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveText(
        "That password is not right. Check it and try again.",
      );
      await page.getByLabel("Confirm your password").fill(seedPassword());
      await page.getByRole("button", { name: "Continue" }).click();
      // A device that cannot make a passkey is not a dead end: back to the choice, the app chosen.
      await page.getByRole("button", { name: "Use an authenticator app instead" }).click();
      await expect(page.getByRole("radio", { name: /^Authenticator app/ })).toBeChecked();
      await page.getByRole("radio", { name: /^Passkey/ }).check();
      await page.getByLabel("Confirm your password").fill(seedPassword());
      await page.getByRole("button", { name: "Continue" }).click();
      // A password check that ran out sends her back to the password, with the passkey still chosen.
      await expirePasswordCheckOnce(page);
      await page.getByRole("button", { name: "Create passkey" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveText(EXPIRED_WORDS);
      await expect(page.getByRole("radio", { name: /^Passkey/ })).toBeChecked();
      await page.getByLabel("Confirm your password").fill(seedPassword());
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByLabel("Passkey name").fill("Work laptop");
      await page.getByRole("button", { name: "Create passkey" }).click();
      await expect(page.getByText("Two-step sign-in is on. Next time, choose Sign in with a passkey")).toBeVisible();
      const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId: first });
      expect(credentials).toHaveLength(1);
      // The password was confirmed before registration began, and no new session was asked for.
      const verify = calls.lastIndexOf("POST /verify-password");
      const options = calls.lastIndexOf("GET /passkey/generate-register-options");
      expect(verify).toBeGreaterThanOrEqual(0);
      expect(options).toBeGreaterThan(verify);
      expect(calls.lastIndexOf("POST /passkey/verify-registration")).toBeGreaterThan(options);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    });

    await test.step("a password alone no longer signs her in; the passkey does", async () => {
      await signOut(page);
      await passwordSignIn(page);
      await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveText(
        "Your account uses a passkey for two-step sign-in. Sign in with your passkey.",
      );
      await page.getByRole("button", { name: "Sign in with a passkey" }).click();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    });

    const list = page.getByRole("list", { name: "Your passkeys" });

    await test.step("Sign-in and security lists it; the last factor cannot be removed", async () => {
      await page.getByRole("button", { name: `Account: ${HR_NAME}` }).click();
      await page.getByRole("menuitem", { name: "Sign-in and security" }).click();
      await expect(page.getByRole("heading", { name: "Sign-in and security" })).toBeVisible();
      await expect(page.getByText("Your role requires it.")).toBeVisible();
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await expect(list).toContainText("Work laptop");
      await page.getByRole("button", { name: "Remove Work laptop" }).click();
      await page.getByRole("button", { name: "Remove passkey" }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
        "Your role needs two-step sign-in, so you cannot remove your last passkey. Add another passkey first, then remove this one.",
      );
      await page.getByRole("button", { name: "Keep it" }).click();
    });

    await test.step("rename it", async () => {
      await page.getByRole("button", { name: "Rename Work laptop" }).click();
      await page.getByLabel("Passkey name").fill("Office laptop");
      await page.getByRole("button", { name: "Save name" }).click();
      await expect(list).toContainText("Office laptop");
    });

    await test.step("adding asks for the password first; the same device is refused in plain words", async () => {
      await page.getByRole("button", { name: "Add a passkey" }).click();
      await page.getByLabel("Your password").fill(seedPassword());
      await page.getByRole("button", { name: "Continue" }).click();
      await expirePasswordCheckOnce(page);
      await page.getByRole("button", { name: "Create passkey" }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(EXPIRED_WORDS);
      await page.getByLabel("Your password").fill(seedPassword());
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByLabel("Passkey name").fill("Second key");
      await page.getByRole("button", { name: "Create passkey" }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
        "This device already has a passkey for your account. Use it, or add one on another device.",
      );
    });

    await test.step("on another authenticator, the second passkey is added; then the first can go", async () => {
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: first });
      await addAuthenticator(cdp);
      await page.getByRole("button", { name: "Create passkey" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(list.getByRole("listitem")).toHaveCount(2);
      await page.getByRole("button", { name: "Remove Office laptop" }).click();
      await page.getByRole("button", { name: "Remove passkey" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await expect(list).toContainText("Second key");
    });
  });
});
