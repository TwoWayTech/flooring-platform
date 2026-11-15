import { expect, test, type Page } from "@playwright/test";
import { STATUS_ACTION_MESSAGES } from "@workspace/shared";
import { FLOW_TAG, signInAsPlatformAdmin, skipIfFeatureOff } from "./helpers";

const SUMMIT = "Summit Floor Co.";

/** The panel of facts on a company's pages: where the status and phase pills show. */
function facts(page: Page) {
  return page.locator("dl").filter({ hasText: "Members" });
}

/** Fills the reason in the open dialog and presses its button (the demo saves at once, with no code). */
async function giveReasonAndContinue(page: Page, reason: string, button = "Continue") {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: button, exact: true }).click();
}

// Platform admin part 2 in demo mode (docs/specs/platform-admin.md, "Part 2", "Demo mode"): plans
// as data and a company's status in the console and its audit log. The demo keeps both in the
// browser, so a company's own side never changes. tests/e2e-api/platform-billing.spec.ts runs the
// same actions on the real API.
test.describe("platform admin: plans and company status (demo)", () => {
  skipIfFeatureOff("admin.billing");

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test(
    "lists the plans, creates, edits, retires and restores one, and finds each in the audit log",
    { tag: FLOW_TAG },
    async ({ page }) => {
      const created = "Starting a pilot plan for the spring offer";
      const edited = "Renaming the pilot plan after review";
      const retired = "Pilot is over, no new subscriptions";
      const restored = "Pilot is running again this season";
      await signInAsPlatformAdmin(page, "/admin/plans");
      await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
      for (const plan of ["Flooring Pro", "Flooring Wholesale", "HR Standard"]) {
        const row = page.getByRole("row", { name: new RegExp(plan) });
        await expect(row).toContainText("$0.00");
      }

      await page.getByRole("button", { name: "New plan" }).click();
      const form = page.getByRole("dialog", { name: "New plan" });
      await form.getByLabel("Key").fill("e2e-starter");
      await form.getByRole("combobox", { name: "Product" }).click();
      await page.getByRole("option", { name: "Flooring Suite" }).click();
      await form.getByLabel("Name").fill("E2E Starter");
      await form.getByLabel("Monthly price").fill("49.00");
      await form.getByLabel("Yearly price").fill("490.00");
      await form.getByRole("switch", { name: "Core module" }).click();
      await form.getByRole("switch", { name: "Retail module" }).click();
      await form.getByLabel("User limit").fill("5");
      await form.getByLabel("Branch limit").fill("1");
      await giveReasonAndContinue(page, created);
      await expect(page.getByText("Plan created.")).toBeVisible();
      const starter = page.getByRole("row", { name: /E2E Starter/ });
      await expect(starter).toContainText("$49.00");
      await expect(starter).toContainText("$490.00");
      await expect(starter).toContainText("Active");

      await page.getByRole("button", { name: "Edit plan E2E Starter" }).click();
      await page.getByRole("dialog").getByLabel("Name").fill("E2E Starter Plus");
      await giveReasonAndContinue(page, edited);
      await expect(page.getByText("Plan saved.")).toBeVisible();
      await expect(page.getByRole("row", { name: /E2E Starter Plus/ })).toBeVisible();

      await page.getByRole("button", { name: "Retire plan E2E Starter Plus" }).click();
      await giveReasonAndContinue(page, retired, "Retire");
      await expect(page.getByText("Plan retired.")).toBeVisible();
      await expect(page.getByRole("row", { name: /E2E Starter Plus/ })).toContainText("Retired");

      await page.getByRole("button", { name: "Restore plan E2E Starter Plus" }).click();
      await giveReasonAndContinue(page, restored, "Restore");
      await expect(page.getByText("Plan restored.")).toBeVisible();
      await expect(page.getByRole("row", { name: /E2E Starter Plus/ })).toContainText("Active");

      await page.getByRole("navigation", { name: "Platform" }).getByRole("link", { name: "Audit log" }).click();
      await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
      const entries: readonly [string, string][] = [
        ["Created plan", created],
        ["Changed plan", edited],
        ["Retired plan", retired],
        ["Restored plan", restored],
      ];
      for (const [action, reason] of entries) {
        const row = page.getByRole("row", { name: new RegExp(reason) });
        await expect(row).toContainText(action);
        await expect(row).toContainText("No company");
      }
    },
  );

  test("a plan in use keeps its modules and limits, and an edit that changes nothing saves nothing", async ({
    page,
  }) => {
    await signInAsPlatformAdmin(page, "/admin/plans");
    await page.getByRole("button", { name: "Edit plan Flooring Pro" }).click();
    const dialog = page.getByRole("dialog", { name: "Change Flooring Pro" });
    await expect(dialog.getByText(/In use by \d+ compan(y|ies)/)).toBeVisible();
    await expect(dialog.getByRole("switch", { name: "Core module" })).toBeDisabled();
    await expect(dialog.getByLabel("User limit")).toBeDisabled();
    await expect(dialog.getByLabel("Branch limit")).toBeDisabled();
    await dialog.getByLabel("Reason").fill("Looking at the plan, no change");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Nothing changed, so nothing was saved.")).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test("a plan form with a bad key names the field and asks for no code", async ({ page }) => {
    await signInAsPlatformAdmin(page, "/admin/plans");
    await page.getByRole("button", { name: "New plan" }).click();
    const form = page.getByRole("dialog", { name: "New plan" });
    await form.getByLabel("Key").fill("Not A Key");
    await form.getByRole("button", { name: "Continue" }).click();
    await expect(form.getByLabel("Key")).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByText(/Enter a key of 2 to 40 lowercase letters/)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
  });

  test(
    "suspends, reinstates and cancels a company, and each change reaches the audit log",
    { tag: FLOW_TAG },
    async ({ page }) => {
      const suspended = "Payment dispute, pausing access";
      const reinstated = "Dispute settled, access back";
      const cancelled = "The owner closed the business";
      await signInAsPlatformAdmin(page, "/admin");
      await page.getByRole("row", { name: /Summit Floor Co\./ }).click();
      await page.getByRole("link", { name: "Status" }).click();
      await expect(page.getByRole("heading", { name: SUMMIT })).toBeVisible();
      await expect(facts(page).getByText("Active", { exact: true })).toBeVisible();
      await expect(facts(page).getByText("Full use", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Suspend", exact: true }).click();
      await giveReasonAndContinue(page, suspended);
      await expect(page.getByText(`${SUMMIT} is suspended.`)).toBeVisible();
      await expect(facts(page).getByText("Suspended", { exact: true })).toBeVisible();
      await expect(facts(page).getByText("Read-only", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Suspend", exact: true })).toBeDisabled();

      await page.getByRole("button", { name: "Reinstate", exact: true }).click();
      await giveReasonAndContinue(page, reinstated);
      await expect(facts(page).getByText("Active", { exact: true })).toBeVisible();
      await expect(facts(page).getByText("Full use", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Reason").fill(cancelled);
      await dialog.getByLabel(`Type ${SUMMIT} to confirm`).fill("summit floor co.");
      await dialog.getByRole("button", { name: "Continue" }).click();
      await expect(dialog.getByText(STATUS_ACTION_MESSAGES.confirmName)).toBeVisible();
      await expect(dialog.getByLabel(`Type ${SUMMIT} to confirm`)).toBeFocused();
      await dialog.getByLabel(`Type ${SUMMIT} to confirm`).fill(SUMMIT);
      await dialog.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText(`${SUMMIT} is cancelled. Nothing was deleted.`)).toBeVisible();
      await expect(facts(page).getByText("Cancelled", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Reinstate", exact: true }).click();
      await giveReasonAndContinue(page, "Owner came back, restoring the account");
      await expect(facts(page).getByText("Active", { exact: true })).toBeVisible();

      await page.getByRole("navigation", { name: "Platform" }).getByRole("link", { name: "Audit log" }).click();
      const entries: readonly [string, string][] = [
        ["Suspended company", suspended],
        ["Reinstated company", reinstated],
        ["Cancelled company", cancelled],
      ];
      for (const [action, reason] of entries) {
        const row = page.getByRole("row", { name: new RegExp(reason) });
        await expect(row).toContainText(action);
        await expect(row).toContainText(SUMMIT);
      }
    },
  );
});
