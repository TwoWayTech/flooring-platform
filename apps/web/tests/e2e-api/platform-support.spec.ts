import { expect, test } from "@playwright/test";
import { SUPPORT_OPEN_MESSAGE } from "@workspace/shared";
import { removePlatformAdmin, removeSupportGrants, resetAuthState, setPlatformAdmin } from "@workspace/db/testing";
import { nextCode, OWNER_EMAIL, signInAndEnrolOwner } from "./accounts";

const SUMMIT = "Summit Floor Co.";

/** The control database the API uses (global-setup.ts checks it is set). */
const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "";

// Platform admin part 3 on the real API (docs/specs/platform-admin.md "Part 3"). The owner account
// is made a platform admin through the database; its grants are hard-deleted before and after, so
// the open-grant and 24-hour limits never block a later run. The support.requested audit row stays
// (the log is append-only; ADR 0052).
test.describe("platform support access and audit log (api mode)", () => {
  test.beforeAll(async () => {
    // Re-runs on a CI retry, so it starts from the same place every time.
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
    await removeSupportGrants(CONTROL_URL, OWNER_EMAIL);
    await setPlatformAdmin(CONTROL_URL, OWNER_EMAIL, "owner");
  });

  test.afterAll(async () => {
    await removeSupportGrants(CONTROL_URL, OWNER_EMAIL);
    await removePlatformAdmin(CONTROL_URL, OWNER_EMAIL);
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
  });

  test("an owner-role admin asks Summit for support access, finds it in the audit log, and as a support-role admin sees access read only", async ({
    page,
  }) => {
    const reason = `Checking the roles the Owner asked about ${Date.now()}`;
    let secret = "";

    await test.step("sign in and open Summit's Support tab", async () => {
      secret = await signInAndEnrolOwner(page);
      await page.goto("/admin");
      await page.getByRole("row", { name: new RegExp(SUMMIT.replace(".", "\\.")) }).click();
      await expect(page.getByRole("heading", { name: SUMMIT })).toBeVisible();
      await page.getByRole("link", { name: "Support" }).click();
    });

    await test.step("ask for support access after a step-up", async () => {
      await page.getByRole("button", { name: "Ask for support access" }).click();
      await page.getByLabel("Reason").fill(reason);
      await page.getByLabel("Hours").fill("2");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByLabel("Authenticator code").fill(nextCode(secret));
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("Support access requested.")).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(reason) })).toContainText("Pending");
      await expect(page.getByRole("button", { name: "Ask for support access" })).toBeDisabled();
      await expect(page.getByText(SUPPORT_OPEN_MESSAGE)).toBeVisible();
    });

    await test.step("find the request in the audit log as the owner role", async () => {
      await page.getByRole("navigation", { name: "Platform" }).getByRole("link", { name: "Audit log" }).click();
      await page.getByRole("combobox", { name: "Company" }).click();
      await page.getByRole("option", { name: SUMMIT }).click();
      await page.getByRole("combobox", { name: "Action" }).click();
      await page.getByRole("option", { name: "Asked for support access" }).click();
      const row = page.getByRole("row", { name: new RegExp(reason) });
      await expect(row).toContainText("Dana Whitfield");
      await expect(page.getByRole("columnheader", { name: "Address and device" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
    });

    await test.step("as the support role, the log has no address column and still shows its own reason", async () => {
      await setPlatformAdmin(CONTROL_URL, OWNER_EMAIL, "support");
      await page.goto("/admin/audit");
      await page.getByRole("combobox", { name: "Action" }).click();
      await page.getByRole("option", { name: "Asked for support access" }).click();
      await expect(page.getByRole("row", { name: new RegExp(reason) })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Address and device" })).toHaveCount(0);
    });

    await test.step("the Access tab is read only for the support role", async () => {
      await page.goto("/admin");
      await page.getByRole("row", { name: new RegExp(SUMMIT.replace(".", "\\.")) }).click();
      await expect(
        page.getByText("Read only: only the platform owner role can change a company's access."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Save access" })).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: /^View sample checkout/ })).toBeDisabled();
    });

    await test.step("the Support tab still lists the request", async () => {
      await page.getByRole("link", { name: "Support" }).click();
      await expect(page.getByRole("row", { name: new RegExp(reason) })).toContainText("Pending");
    });
  });
});
