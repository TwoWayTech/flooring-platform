import { expect, test, type Page } from "@playwright/test";
import {
  clearTestStatus,
  readStatusFacts,
  removePlatformAdmin,
  removeTestPlans,
  resetAuthState,
  setPlatformAdmin,
} from "@workspace/db/testing";
import { nextCode, OWNER_EMAIL, signInAndEnrolOwner } from "./accounts";

const SUMMIT = "Summit Floor Co.";

/** The control database the API uses (global-setup.ts checks it is set). */
const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "";

/** The panel of facts on a company's pages: where the status and phase pills show. */
function facts(page: Page) {
  return page.locator("dl").filter({ hasText: "Members" });
}

/** Answers the step-up dialog with the owner's next authenticator code. */
async function stepUp(page: Page, secret: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  await dialog.getByLabel("Authenticator code").fill(nextCode(secret));
  await dialog.getByRole("button", { name: "Confirm" }).click();
}

/** Opens Summit's Status tab from the company list, the way a person moves in the console. */
async function openSummitStatus(page: Page): Promise<void> {
  await page.goto("/admin");
  await page.getByRole("row", { name: /Summit Floor Co\./ }).click();
  await expect(page.getByRole("heading", { name: SUMMIT })).toBeVisible();
  await page.getByRole("link", { name: "Status" }).click();
  await expect(facts(page).getByText("Phase", { exact: true })).toBeVisible();
}

// Platform admin part 2 on the real API (docs/specs/platform-admin.md, "Part 2"; ADR 0056). The
// owner account is made an owner-role platform admin through the database, as platform-support.spec.ts
// does. The test creates and retires an `e2e-` plan, suspends and reinstates Summit, and afterAll puts
// Summit's status back to what it was and removes its plan, even when a step failed. The exact
// `status_changed_at` is not restored: for an active company it doesn't change the phase, and no
// helper switches the control trigger off. Each local run leaves four audit rows (the log is append-only).
test.describe("platform plans and company status (api mode)", () => {
  test.beforeAll(async () => {
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
    await removeTestPlans(CONTROL_URL);
    // global-setup.ts left Summit active; if it did not, nothing here is changed.
    expect((await readStatusFacts(CONTROL_URL, "summit")).status).toBe("active");
    await setPlatformAdmin(CONTROL_URL, OWNER_EMAIL, "owner");
  });

  test.afterAll(async () => {
    try {
      await clearTestStatus(CONTROL_URL, "summit");
      await removeTestPlans(CONTROL_URL);
    } finally {
      await removePlatformAdmin(CONTROL_URL, OWNER_EMAIL);
      await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
    }
    expect((await readStatusFacts(CONTROL_URL, "summit")).status).toBe("active");
  });

  test("an owner-role admin creates and retires a plan, suspends and reinstates Summit, and finds the suspension in the audit log", async ({
    page,
  }) => {
    const stamp = Date.now();
    const key = `e2e-plan-${stamp}`;
    const planName = `E2E Plan ${stamp}`;
    const planReason = `Adding a plan for a browser test ${stamp}`;
    const retireReason = `Retiring the browser test plan ${stamp}`;
    const suspendReason = `Pausing Summit for a browser test ${stamp}`;
    const reinstateReason = `Browser test is over, access back ${stamp}`;
    let secret = "";

    await test.step("sign in, enrol and read the seeded plan", async () => {
      secret = await signInAndEnrolOwner(page);
      await page.goto("/admin/plans");
      await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
      await expect(page.getByRole("row", { name: /Flooring Pro/ })).toContainText("Active");
    });

    await test.step("create a plan after a step-up", async () => {
      await page.getByRole("button", { name: "New plan" }).click();
      const form = page.getByRole("dialog", { name: "New plan" });
      await form.getByLabel("Key").fill(key);
      await form.getByRole("combobox", { name: "Product" }).click();
      await page.getByRole("option", { name: "Flooring Suite" }).click();
      await form.getByLabel("Name").fill(planName);
      await form.getByLabel("Monthly price").fill("49.00");
      await form.getByLabel("Yearly price").fill("490.00");
      await form.getByRole("switch", { name: "Core module" }).click();
      await form.getByLabel("User limit").fill("5");
      await form.getByLabel("Branch limit").fill("1");
      await form.getByLabel("Reason").fill(planReason);
      await form.getByRole("button", { name: "Continue" }).click();
      await stepUp(page, secret);
      await expect(page.getByText("Plan created.")).toBeVisible();
      const row = page.getByRole("row", { name: new RegExp(planName) });
      await expect(row).toContainText("$49.00");
      await expect(row).toContainText("$490.00");
      await expect(row).toContainText("Active");
    });

    await test.step("retire it after a step-up", async () => {
      await page.getByRole("button", { name: `Retire plan ${planName}` }).click();
      const dialog = page.getByRole("dialog", { name: `Retire ${planName}?` });
      await dialog.getByLabel("Reason").fill(retireReason);
      await dialog.getByRole("button", { name: "Retire", exact: true }).click();
      await stepUp(page, secret);
      await expect(page.getByText("Plan retired.")).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(planName) })).toContainText("Retired");
    });

    await test.step("suspend Summit after a step-up", async () => {
      await openSummitStatus(page);
      await expect(facts(page).getByText("Active", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Suspend", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Reason").fill(suspendReason);
      await dialog.getByRole("button", { name: "Continue" }).click();
      await stepUp(page, secret);
      await expect(page.getByText(`${SUMMIT} is suspended.`)).toBeVisible();
      await expect(facts(page).getByText("Suspended", { exact: true })).toBeVisible();
      await expect(facts(page).getByText("Read-only", { exact: true })).toBeVisible();
    });

    await test.step("the Owner's own billing page shows the suspension", async () => {
      await page.goto("/settings/billing");
      await expect(page.getByRole("status", { name: "Account notice" })).toContainText("Account suspended: read only");
    });

    await test.step("reinstate Summit after a step-up", async () => {
      await openSummitStatus(page);
      await page.getByRole("button", { name: "Reinstate", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Reason").fill(reinstateReason);
      await dialog.getByRole("button", { name: "Continue" }).click();
      await stepUp(page, secret);
      await expect(page.getByText(`${SUMMIT} is reinstated.`)).toBeVisible();
      await expect(facts(page).getByText("Active", { exact: true })).toBeVisible();
      await expect(facts(page).getByText("Full use", { exact: true })).toBeVisible();
    });

    await test.step("find the suspension in the audit log, with its reason and address", async () => {
      await page.goto("/admin/audit");
      await page.getByRole("combobox", { name: "Action" }).click();
      await page.getByRole("option", { name: "Suspended company" }).click();
      const row = page.getByRole("row", { name: new RegExp(suspendReason) });
      await expect(row).toContainText("Suspended company");
      await expect(row).toContainText(SUMMIT);
      await expect(page.getByRole("columnheader", { name: "Address and device" })).toBeVisible();
    });
  });
});
