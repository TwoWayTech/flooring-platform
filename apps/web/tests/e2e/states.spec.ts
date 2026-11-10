import { expect, test, type Page } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

const OFFLINE = "The server did not answer. Check the connection, then try again.";

async function setNetwork(page: Page, mode: "Normal" | "Slow" | "Offline") {
  const guide = page.getByRole("complementary", { name: "Demo steps" });
  if (!(await guide.isVisible())) await page.getByRole("button", { name: "Presenter guide" }).click();
  await guide.getByRole("group", { name: "Network" }).getByRole("button", { name: mode }).click();
  return guide;
}

test.describe("loading, error and empty states", () => {
  test("a slow network shows the skeleton, then the screen", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/");
    const guide = await setNetwork(page, "Slow");
    await guide.getByRole("link", { name: /Purchasing/ }).click();
    await expect(page.getByLabel("Loading purchasing")).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  });

  test("an offline screen explains the failure and recovers with Try again", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/");
    const guide = await setNetwork(page, "Offline");
    await guide.getByRole("link", { name: /Reports/ }).click();
    const alert = page.getByRole("alert").filter({ hasText: "This page could not load its data." });
    await expect(alert).toContainText(OFFLINE);

    await setNetwork(page, "Normal");
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("region", { name: "Business report", exact: true })).toBeVisible();
  });

  test("a save made offline says why it failed and keeps the form open", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await expect(page.getByRole("button", { name: /Weekly sales huddle/ })).toBeVisible();
    await setNetwork(page, "Offline");
    await page.getByRole("button", { name: "New meeting" }).click();
    await page.getByLabel("Title").fill("Offline test");
    await page.getByRole("button", { name: "Schedule meeting" }).click();
    await expect(page.getByText(OFFLINE)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "New meeting" })).toBeVisible();
  });
});
