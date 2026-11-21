import { expect } from "@playwright/test";
import { OWNER_EMAIL } from "./accounts";
import { flowTest, resetAuthAround } from "./flows/kit";

/**
 * Click-through #69 and #70 on the real product (api mode): the demo's own controls are gone (Reset
 * demo data in the account menu and the palette, the presenter-guide button, Settings → Connect a
 * database), the product cookie has a neutral name, and the account menu names the Owner once.
 */
flowTest.describe("no demo-only controls in the real product (api mode)", () => {
  resetAuthAround([OWNER_EMAIL]);

  flowTest("#69 the Owner sees no Reset demo data, presenter guide or Connect a database", async ({ personas }) => {
    const { page, context } = await personas.open(OWNER_EMAIL, { mfa: true });
    await page.goto("/settings");
    const settingsNav = page.getByRole("navigation", { name: "Settings" });
    await expect(settingsNav.getByRole("link", { name: "Data import" })).toBeVisible();
    await expect(settingsNav.getByRole("link", { name: "Connect a database" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Presenter guide" })).toHaveCount(0);

    await page.getByRole("button", { name: "Account: Dana Whitfield" }).click();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Reset demo data" })).toHaveCount(0);
    // #70: a job title that is also the role's name is shown once.
    await expect(page.getByRole("menu").getByText("Owner, Owner")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder("Search or run a command").fill("demo");
    await expect(page.getByRole("option", { name: "Reset demo data" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/settings/database");
    await expect(page.getByRole("heading", { name: "Connect a database" })).toHaveCount(0);
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("demo_product");
  });
});
