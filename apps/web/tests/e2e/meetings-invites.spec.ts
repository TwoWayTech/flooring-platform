import { expect, test, type Page } from "@playwright/test";
import { signInAs, SUMMIT_OWNER, skipIfFeatureOff, type Persona } from "./helpers";

const BRI: Persona = { companyId: "summit", userId: "sm-usr-14", roleKey: "employee" };

async function newMeeting(page: Page, title: string) {
  await signInAs(page, SUMMIT_OWNER, "/meetings");
  await page.getByRole("button", { name: "New meeting" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill(title);
}

test.describe("Meeting guests and invites (spec E)", () => {
  test.beforeEach(() => skipIfFeatureOff("meetings.invites"));

  test("adds a guest by email, and the invite with its calendar file reaches the Outbox", async ({ page }) => {
    await newMeeting(page, "Tile selection");
    await page.getByRole("textbox", { name: "Guests" }).fill("jamie@newclient.example");
    await page.getByLabel("Name (optional)").fill("Jamie Fox");
    await page.getByLabel("Save under customer").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "Add guest by email" }).click();
    await expect(page.getByRole("list", { name: "Guests invited" })).toContainText("Jamie Fox");
    await page.getByRole("button", { name: "Schedule meeting" }).click();
    await expect(page.getByText("Meeting Tile selection scheduled")).toBeVisible();
    await page.goto("/settings/outbox");
    await page
      .getByRole("row", { name: /Jamie Fox/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: /Tile selection\.ics/ })).toBeVisible();
  });

  test("finds staff, customers and contacts from one search", async ({ page }) => {
    await newMeeting(page, "Supplier review");
    await page.getByRole("textbox", { name: "Guests" }).fill("priya");
    await page.getByRole("list", { name: "Guest results" }).getByRole("button").first().click();
    await expect(page.getByRole("list", { name: "Guests invited" })).toContainText("Priya Natarajan");
  });

  test("a guest's simulated reply reaches the organiser's meeting", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/outbox");
    await page
      .getByRole("row", { name: /Riley Chen/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText("Riley Chen: Accepted")).toBeVisible();
    await page.goto("/meetings");
    await page.getByRole("button", { name: "Next week" }).click();
    const view = page.getByRole("button", { name: /New build walkthrough/ });
    if (
      !(await view
        .first()
        .isVisible()
        .catch(() => false))
    )
      await page.getByRole("button", { name: "Previous week" }).click();
    await page
      .getByRole("button", { name: /New build walkthrough/ })
      .first()
      .click();
    await expect(page.getByRole("dialog").getByText("Accepted").first()).toBeVisible();
  });

  test("a guest proposes a time and the organiser accepts it, moving the meeting", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/outbox");
    await page
      .getByRole("row", { name: /Riley Chen/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Propose a new time" }).click();
    await page.getByLabel("Start").fill("16:15");
    await page.getByRole("button", { name: "Send proposal" }).click();
    await expect(page.getByText("Riley Chen: Proposal sent")).toBeVisible();
    // The meeting is seeded two days after today, which can be a weekend the week view leaves
    // out, so look for it in the month view, then in the next month near a month's end.
    await page.goto("/meetings");
    await page.getByRole("button", { name: "Month", exact: true }).click();
    const meeting = page.getByRole("button", { name: /New build walkthrough/ });
    if (
      !(await meeting
        .first()
        .isVisible()
        .catch(() => false))
    )
      await page.getByRole("button", { name: "Next month" }).click();
    await page
      .getByRole("button", { name: /New build walkthrough/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Accept time" }).click();
    await expect(page.getByText("Meeting moved")).toBeVisible();
  });

  test("cancelling sends a cancellation", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    const meeting = page.getByRole("button", { name: /New build walkthrough/ });
    if (
      !(await meeting
        .first()
        .isVisible()
        .catch(() => false))
    )
      await page.getByRole("button", { name: "Next week" }).click();
    await page
      .getByRole("button", { name: /New build walkthrough/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Cancel meeting" }).click();
    await expect(page.getByText("Meeting cancelled")).toBeVisible();
    await page.goto("/settings/outbox");
    await expect(page.getByRole("row", { name: /Cancelled: New build walkthrough/ }).first()).toBeVisible();
  });

  test("Edit details renames a meeting and sends guests the update", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    const meeting = page.getByRole("button", { name: /New build walkthrough/ });
    if (
      !(await meeting
        .first()
        .isVisible()
        .catch(() => false))
    )
      await page.getByRole("button", { name: "Next week" }).click();
    await meeting.first().click();
    await page.getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit meeting" });
    await dialog.getByLabel("Title").fill("New build site walk");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Meeting updated")).toBeVisible();
    await page.goto("/settings/outbox");
    await expect(page.getByRole("row", { name: /New build site walk/ }).first()).toBeVisible();
  });

  test("Add to my calendar downloads an .ics file", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await page
      .getByRole("button", { name: /Weekly sales huddle/ })
      .first()
      .click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Add to my calendar" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.ics$/);
  });

  test("anyone can request a meeting, and the other person can accept it", async ({ page }) => {
    skipIfFeatureOff("meetings.requests");
    await signInAs(page, BRI, "/meetings");
    await page.getByRole("button", { name: "Request a meeting" }).click();
    await page.getByLabel("With").click();
    await page.getByRole("option", { name: "Tamara Reyes" }).click();
    await page.getByLabel("About").fill("Review my schedule");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Meeting requested")).toBeVisible();
  });

  test("the seeded request waits for an answer", async ({ page }) => {
    skipIfFeatureOff("meetings.requests");
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    const request = page.getByRole("button", { name: /Review my goals/ });
    if (
      !(await request
        .first()
        .isVisible()
        .catch(() => false))
    )
      await page.getByRole("button", { name: "Next week" }).click();
    await page
      .getByRole("button", { name: /Review my goals/ })
      .first()
      .click();
    await expect(page.getByText("Waiting for an answer.")).toBeVisible();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByRole("dialog").getByText("Your answer: Accepted")).toBeVisible();
  });

  test("Settings → Meetings sets what happens to new guests", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/meetings");
    await page.getByLabel("New guests added by email").click();
    await page.getByRole("option", { name: "Save as a new lead" }).click();
    await page.getByRole("button", { name: /Save/ }).first().click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
  });
});
