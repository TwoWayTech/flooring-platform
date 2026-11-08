import { expect, test } from "@playwright/test";
import { HARBOR_OWNER, HR_TAG, signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("meetings", () => {
  test("shows this week's recurring meetings with attendees and the reminder", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await page.getByRole("button", { name: /Weekly sales huddle/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Weekly sales huddle" })).toBeVisible();
    await expect(drawer.getByText(/^Reminder \d+ minutes before$/)).toBeVisible();
    await expect(drawer.getByText("Every week")).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Attendees" })).toBeVisible();
  });

  test("schedules a weekly meeting with a supplier that repeats next week", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await page.getByRole("button", { name: "New meeting" }).click();
    await page.getByLabel("Title").fill("Sample room refresh");
    await page.getByLabel("Supplier").click();
    await page.getByRole("option").nth(1).click();
    await page.getByLabel("Repeats").click();
    await page.getByRole("option", { name: "Every week" }).click();
    await page.getByRole("button", { name: "Schedule meeting" }).click();
    await expect(page.getByText("Meeting Sample room refresh scheduled")).toBeVisible();

    await page.getByRole("button", { name: "Next week" }).click();
    await page.getByRole("button", { name: /Sample room refresh/ }).click();
    await expect(page.getByRole("dialog").getByText("(supplier)")).toBeVisible();
  });

  test("the HR Suite has its own meetings", { tag: HR_TAG }, async ({ page }) => {
    await signInAs(page, HARBOR_OWNER, "/meetings");
    await expect(page.getByRole("button", { name: /Weekly recruiter standup/ })).toBeVisible();
  });
});
