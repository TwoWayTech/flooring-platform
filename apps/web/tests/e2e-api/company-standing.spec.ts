import { expect, test, type Page, type Request } from "@playwright/test";
import { STANDING_SCREENS, SUPPORT_READ_ONLY_MESSAGE } from "@workspace/shared";
import {
  insertSupportGrant,
  readStandingFacts,
  removeTestSupportAgent,
  resetAuthState,
  restoreStandingFacts,
  setMaintenance,
  setPeriodEnd,
  type StandingSnapshot,
} from "@workspace/db/testing";
import { MANAGER_EMAIL, nextCode, OWNER_EMAIL, signInAndEnrolOwner, signInAs } from "./accounts";

/** The control database the API uses (global-setup.ts checks it is set). */
const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "";
const DAY = 86_400_000;

/** The moment `days` days from now; negative is in the past. */
function inDays(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

/** Puts Summit back to full use: maintenance off and a period that ends in 30 days. */
async function baseline(): Promise<void> {
  await setMaintenance(CONTROL_URL, "summit", null);
  await setPeriodEnd(CONTROL_URL, "summit", inDays(30));
}

/** Opens a Settings page by its menu link, the way a person moves inside the open app. */
async function openSettingsPage(page: Page, name: string): Promise<void> {
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name }).click();
}

/**
 * Counts the page's open API requests from now on; `settled()` waits until none has been open for
 * 300 ms. The app reads again after a write or a page change, and since GET /company (ADR 0051) the
 * shell's own re-read starts further reads (the attention list's). A read still open when a step
 * puts Summit under maintenance behind the API's back would show the overlay before the step's click.
 */
function apiReads(page: Page): { settled: () => Promise<void> } {
  let open = 0;
  let quietSince = Date.now();
  const isApi = (request: Request) => request.url().includes("/api-proxy/");
  const ended = (request: Request) => {
    if (!isApi(request)) return;
    open -= 1;
    quietSince = Date.now();
  };
  page.on("request", (request) => {
    if (isApi(request)) open += 1;
  });
  page.on("requestfinished", ended);
  page.on("requestfailed", ended);
  return {
    settled: () =>
      expect
        .poll(() => open === 0 && Date.now() - quietSince >= 300, { message: "the app's reads have finished" })
        .toBe(true),
  };
}

// Platform admin part 4 on the real API (docs/specs/platform-admin.md, "Part 4"; ADR 0054). The
// tests change Summit's maintenance flag and period dates behind the API's back; each step that
// does puts the baseline back in its own finally, and afterAll asserts Summit equals its snapshot.
test.describe("company standing, billing and support access (api mode)", () => {
  let snapshot: StandingSnapshot;

  test.beforeAll(async () => {
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL, MANAGER_EMAIL]);
    await removeTestSupportAgent(CONTROL_URL);
    snapshot = await readStandingFacts(CONTROL_URL, "summit");
    await baseline();
  });

  test.afterAll(async () => {
    await restoreStandingFacts(CONTROL_URL, snapshot);
    await removeTestSupportAgent(CONTROL_URL);
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL, MANAGER_EMAIL]);
    expect(await readStandingFacts(CONTROL_URL, "summit")).toEqual(snapshot);
  });

  test("the Owner reads Billing, is warned when overdue and read only, decides support access, and keeps the open screen through maintenance", async ({
    page,
  }) => {
    const notice = page.getByRole("status", { name: "Account notice" });
    const reads = apiReads(page);
    let secret = "";

    await test.step("Billing shows the plan and no notice", async () => {
      secret = await signInAndEnrolOwner(page);
      await page.goto("/settings/billing");
      await expect(page.getByRole("heading", { name: "Flooring Pro" })).toBeVisible();
      await expect(page.getByText("Billed monthly")).toBeVisible();
      await expect(page.getByText(/^Current period ends /)).toBeVisible();
      await expect(notice).toHaveCount(0);
    });

    const reason = `Checking roles ${Date.now()}`;
    await insertSupportGrant(CONTROL_URL, { slug: "summit", reason, hours: 2 });

    await test.step("overdue: the page's notice, and the shell banner elsewhere", async () => {
      try {
        await setPeriodEnd(CONTROL_URL, "summit", inDays(-3));
        await page.goto("/settings/billing");
        await expect(notice).toHaveCount(1);
        await expect(notice).toContainText("Payment overdue");
        await expect(notice).toContainText("becomes read only on");
        await expect(page.getByText(/^Period ended /)).toBeVisible();

        await page.goto("/settings/users");
        await expect(notice).toContainText("Payment overdue");
        await expect(notice.getByRole("link", { name: "Open billing" })).toHaveAttribute("href", "/settings/billing");
      } finally {
        await baseline();
      }
    });

    await test.step("read only: the banner, and no support decisions", async () => {
      try {
        await setPeriodEnd(CONTROL_URL, "summit", inDays(-20));
        await page.goto("/settings/users");
        await expect(notice).toContainText("Plan ended: read only");
        await expect(notice).toContainText("It locks on");
        const row = page.getByRole("row", { name: new RegExp(reason) });
        await expect(row).toContainText("Test Support Agent");
        await expect(row).toContainText("Pending");
        await expect(page.getByRole("button", { name: /^(Approve|Revoke) support access/ })).toHaveCount(0);
        await expect(page.getByText(SUPPORT_READ_ONLY_MESSAGE)).toBeVisible();
      } finally {
        await baseline();
      }
    });

    await test.step("back in full use: approve with a step-up, then revoke", async () => {
      await page.goto("/settings/users");
      await expect(notice).toHaveCount(0);
      const row = page.getByRole("row", { name: new RegExp(reason) });
      await page.getByRole("button", { name: "Approve support access for Test Support Agent" }).click();
      await page.getByLabel("Authenticator code").fill(nextCode(secret));
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("Support access approved.")).toBeVisible();
      await expect(row).toContainText("Approved");
      await page.getByRole("button", { name: "Revoke support access for Test Support Agent" }).click();
      await page.getByRole("button", { name: "Revoke access" }).click();
      await expect(row).toContainText("Revoked");
    });

    await test.step("maintenance covers the open screen without remounting it, and lifting it brings the app back", async () => {
      const main = await page.locator("#main").elementHandle();
      expect(main).not.toBeNull();
      let billingReads = 0;
      let standingReads = 0;
      let failures = 0;
      page.on("request", (request) => {
        if (request.url().includes("/api-proxy/billing")) billingReads += 1;
        if (request.url().includes("/api-proxy/company/standing")) standingReads += 1;
      });
      page.on("response", (response) => {
        if (response.url().includes("/api-proxy/") && response.status() >= 400) failures += 1;
      });
      const overlay = page.getByRole("alertdialog", { name: "Under maintenance" });
      try {
        await reads.settled();
        await setMaintenance(CONTROL_URL, "summit", "move");
        await openSettingsPage(page, "Audit log");
        await expect(overlay).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

        // The overlay re-reads once per refusal, never in a loop (the plan's C1, C2).
        await page.waitForTimeout(3_000);
        expect(billingReads).toBeLessThanOrEqual(1);
        expect(standingReads).toBeLessThanOrEqual(failures);

        await overlay.getByRole("button", { name: "Try again" }).click();
        await expect(overlay).toBeVisible();

        await setMaintenance(CONTROL_URL, "summit", null);
        await overlay.getByRole("button", { name: "Try again" }).click();
        await expect(overlay).toHaveCount(0);
        await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

        expect(await main!.evaluate((element) => element.isConnected)).toBe(true);
        const card = page.getByRole("alert").filter({ hasText: "This page could not load its data." });
        await expect(card).toBeVisible();
        expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
        await card.getByRole("button", { name: "Try again" }).click();
        await expect(page.getByText("This page could not load its data.")).toHaveCount(0);
      } finally {
        await baseline();
      }
    });
  });

  test("a manager sees no billing and no support panel, and the maintenance and suspended screens replace the app", async ({
    page,
  }) => {
    const reads = apiReads(page);
    await test.step("no Billing and no support panel", async () => {
      await signInAs(page, MANAGER_EMAIL);
      await page.goto("/settings");
      await expect(
        page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Billing" }),
      ).toHaveCount(0);
      await page.goto("/settings/billing");
      await expect(page.getByText("You don't have access to this page.")).toBeVisible();
      await page.goto("/settings/users");
      await expect(page.getByRole("cell", { name: "Dana Whitfield" }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Support access" })).toHaveCount(0);
    });

    await test.step("maintenance covers the open screen", async () => {
      const overlay = page.getByRole("alertdialog", { name: "Under maintenance" });
      try {
        await reads.settled();
        await setMaintenance(CONTROL_URL, "summit", "move");
        await openSettingsPage(page, "Audit log");
        await expect(overlay).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
        await overlay.getByRole("button", { name: "Try again" }).click();
        await expect(overlay).toBeVisible();
        await setMaintenance(CONTROL_URL, "summit", null);
        await overlay.getByRole("button", { name: "Try again" }).click();
        await expect(overlay).toHaveCount(0);
      } finally {
        await baseline();
      }
    });

    await test.step("the maintenance page fits a phone", async () => {
      try {
        await page.setViewportSize({ width: 375, height: 800 });
        await setMaintenance(CONTROL_URL, "summit", "move");
        await page.goto("/");
        await expect(page.getByRole("heading", { name: STANDING_SCREENS.maintenance.title })).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      } finally {
        await baseline();
      }
    });

    await test.step("a lapsed account is suspended, and Sign out leaves", async () => {
      try {
        await setPeriodEnd(CONTROL_URL, "summit", inDays(-50));
        await page.goto("/");
        await expect(page.getByRole("heading", { name: STANDING_SCREENS.locked.title })).toBeVisible();
        await expect(page.getByText(STANDING_SCREENS.locked.body)).toBeVisible();
        await page.getByRole("button", { name: "Sign out" }).click();
        await expect(page).toHaveURL(/\/login/);
      } finally {
        await baseline();
      }
    });
  });
});
