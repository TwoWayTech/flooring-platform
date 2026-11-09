import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

const SUMMIT_INSTALLER = { companyId: "summit", userId: "sm-usr-05", roleKey: "installer" } as const;

test.describe("installation", () => {
  test("opens a job card with costing for the Owner", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/installation");
    await expect(page.getByRole("rowheader", { name: /Pinecrest Installs LLC/ })).toBeVisible();
    await page
      .getByRole("button", { name: /^Open job J-/ })
      .first()
      .click();
    const card = page.getByRole("dialog");
    await expect(card.getByRole("heading", { name: /^Job J-\d+/ })).toBeVisible();
    await expect(card.getByText("Job margin")).toBeVisible();
    await expect(card.getByRole("heading", { name: "Materials" })).toBeVisible();
  });

  test("an installer sees only their own jobs and no margin", async ({ page }) => {
    await signInAs(page, SUMMIT_INSTALLER, "/installation");
    const jobs = page.getByRole("button", { name: /^Open job J-/ });
    const count = await jobs.count();
    for (let i = 0; i < count; i++) {
      await jobs.nth(i).click();
      await expect(page.getByRole("dialog")).toContainText("North crew");
      await expect(page.getByRole("dialog").getByText("Job margin")).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("installation complete moves the invoice forward (spec B6)", () => {
  test("signing off a job makes the held balance due and marks Installed", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales/invoices/sm-inv-0171");
    const summary = page.getByRole("heading", { name: /^Invoice INV-/ }).locator("../..");
    await expect(summary.getByText("After installation")).toBeVisible();
    await summary.getByRole("link", { name: /^J-4020/ }).click();
    const card = page.getByRole("dialog", { name: /Job J-4020/ });
    await card.getByLabel("Customer signs as").fill("Pat Homeowner");
    await card.getByRole("button", { name: "Record sign-off" }).click();
    await expect(card.getByText(/Signed off by Pat Homeowner/)).toBeVisible();
    await card.getByRole("link", { name: "View invoice" }).click();
    await expect(summary.getByText("After installation")).toHaveCount(0);
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline.getByText("Installed").locator("..")).toContainText("Pat Homeowner");
  });
});
