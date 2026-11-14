import { expect, test } from "@playwright/test";
import { MANAGER_EMAIL, signInAs } from "./accounts";

/**
 * The employee portal on the real API (ADR 0049): the store manager's sign-in is linked to their
 * own employee record in Summit's seed, so My profile shows that record from `GET /me/portal` and
 * saves the phone through `PATCH /me/employee`. Summit hides rates and commission from employees,
 * so neither the pay rate nor My commission is offered. One sign-in keeps the run inside the
 * sign-in rate limit the other specs share.
 */
test.describe("employee portal (api mode)", () => {
  test("a person sees their own record, without the pay rate, and saves their phone", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);

    await page.goto("/my/profile");
    const tabs = page.getByRole("navigation", { name: "My portal" });
    await expect(tabs.getByRole("link", { name: "My profile" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "My commission" })).toHaveCount(0);
    await expect(page.getByRole("main").getByText("Luis Ortega", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Pay rate")).toHaveCount(0);

    await page.getByLabel("Phone", { exact: true }).fill("(303) 555-0142");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Phone", { exact: true })).toHaveValue("(303) 555-0142");
  });
});
