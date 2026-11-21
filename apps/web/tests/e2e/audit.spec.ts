import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("settings: company profile and audit log", () => {
  test("validates the profile and records every change in the audit log", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/company");
    await page.getByLabel("EIN").fill("12345");
    await page.getByLabel("Phone").focus();
    await expect(page.getByText("Enter the EIN as 12-3456789.")).toBeVisible();
    await page.getByLabel("EIN").fill("84-1234567");
    await expect(page.getByText("Enter the EIN as 12-3456789.")).toHaveCount(0);
    await page.getByRole("button", { name: "Save company profile" }).click();
    await expect(page.getByText("Company profile saved")).toBeVisible();

    await page.goto("/inventory/rolls/sm-roll-0004");
    await page.getByRole("button", { name: "Correct stock count" }).click();
    await page.getByLabel("Counted (ft)").fill("83");
    await page.getByLabel("Reason").fill("Yearly count");
    await page.getByRole("dialog").getByRole("button", { name: "Correct stock count" }).click();
    await expect(page.getByText(/Stock count corrected/)).toBeVisible();

    await page.goto("/settings/audit");
    await expect(page.getByRole("cell", { name: "Changed company profile" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Corrected stock count" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /ein: 84-1234567/ })).toBeVisible();
  });
});

test.describe("audit log: times in the company's zone (ADR 0064, click-through #57)", () => {
  // The browser is in Tokyo, so a time shown in the browser's zone or as UTC can't pass.
  test.use({ timezoneId: "Asia/Tokyo" });

  /** The hour Denver's clock shows now, as the audit log writes it ("7" for 07:56). */
  const denverHour = () =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", hour12: true })
      .format(new Date())
      .split(" ")[0]!;

  test("shows a new entry's time on Summit's Denver clock, in 12-hour time, with the zone named", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/company");
    await page.getByLabel("EIN").fill("84-7654321");
    const hours = [denverHour()];
    await page.getByRole("button", { name: "Save company profile" }).click();
    await expect(page.getByText("Company profile saved")).toBeVisible();
    hours.push(denverHour());

    await page.goto("/settings/audit");
    const row = page.getByRole("row").filter({ hasText: "ein: 84-7654321" }).first();
    const when = row.getByRole("cell", { name: /, \d{1,2}:\d{2} (AM|PM) (MST|MDT)$/ });
    await expect(when).toBeVisible();
    const hour = /, (\d{1,2}):/.exec(await when.innerText())?.[1];
    expect(hours).toContain(hour);
  });
});
