import { expect, test } from "@playwright/test";
import { HARBOR_OWNER, HR_TAG, signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("presenter guide", () => {
  test("lists the demo steps, links to each screen and stays open after a reload", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/");
    await page.getByRole("button", { name: "Presenter guide" }).click();
    const guide = page.getByRole("complementary", { name: "Demo steps" });
    await expect(guide.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("aria-current", "step");

    await guide.getByRole("link", { name: /Quote a job/ }).click();
    await expect(page).toHaveURL(/\/sales\/quotes\/new$/);
    await expect(guide.getByRole("link", { name: /Quote a job/ })).toHaveAttribute("aria-current", "step");
    await expect(guide.getByText("tax follows the job-site state")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("complementary", { name: "Demo steps" })).toBeVisible();
  });

  test("greys out steps the viewed role cannot open", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("presenter guide");
    await page.getByRole("option", { name: "Show presenter guide" }).click();
    const guide = page.getByRole("complementary", { name: "Demo steps" });
    await expect(guide.getByRole("link", { name: /Security roles/ })).toBeVisible();

    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search or run a command").fill("View as Sales");
    await page.getByRole("option", { name: "View as Sales" }).click();
    await expect(guide.getByRole("link", { name: /Security roles/ })).toHaveCount(0);
    await expect(guide.getByText("Not open to this role").first()).toBeVisible();
  });

  test("the HR Suite has its own steps", { tag: HR_TAG }, async ({ page }) => {
    await signInAs(page, HARBOR_OWNER, "/");
    await page.getByRole("button", { name: "Presenter guide" }).click();
    const guide = page.getByRole("complementary", { name: "Demo steps" });
    await expect(guide.getByRole("link", { name: /Timesheets/ })).toBeVisible();
    await expect(guide.getByRole("link", { name: /Cut a roll/ })).toHaveCount(0);
  });
});
