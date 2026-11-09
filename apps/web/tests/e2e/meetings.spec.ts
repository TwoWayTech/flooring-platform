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

test.describe("meetings calendar (spec F)", () => {
  test("drags a repeating meeting an hour later for this event only, and Undo puts it back", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    const meeting = page.getByRole("button", { name: /^Weekly sales huddle, / }).first();
    const before = (await meeting.getAttribute("aria-label"))!;
    const box = (await meeting.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 8 + 24, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2, box.y + 8 + 48, { steps: 4 });
    await page.mouse.up();
    const ask = page.getByRole("dialog", { name: "Move a repeating meeting" });
    await ask.getByLabel("This event").check();
    await ask.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("Weekly sales huddle moved")).toBeVisible();
    await expect(page.getByRole("button", { name: before })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Move undone")).toBeVisible();
    await expect(page.getByRole("button", { name: before })).toBeVisible();
  });

  test("reschedules from the form, and shows month and agenda views", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await page.getByRole("button", { name: /^Weekly sales huddle, / }).first().click();
    const drawer = page.getByRole("dialog", { name: "Weekly sales huddle" });
    await drawer.getByLabel("Start").fill("16:00");
    await drawer.getByRole("button", { name: "Move meeting" }).click();
    await page.getByRole("dialog", { name: "Move a repeating meeting" }).getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("Weekly sales huddle moved")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Weekly sales huddle, 4:00 PM/ })).toBeVisible();

    await page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Month" }).click();
    await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
    await page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Agenda" }).click();
    await expect(page.getByText(/^Next 30 days from/)).toBeVisible();
  });
});
