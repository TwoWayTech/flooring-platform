import { expect, test } from "@playwright/test";
import { SUMMIT_OWNER, signInAs, skipIfFeatureOff } from "./helpers";

test.describe("email and notification centre (spec A4)", () => {
  test.beforeEach(() => skipIfFeatureOff("settings.notifications"));

  test("an event can be switched off and its template edited, with a preview", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/notifications");
    await expect(page.getByText("This demo never sends real email.")).toBeVisible();
    await page.getByRole("button", { name: "Edit template for Invoice sent" }).click();
    const sheet = page.getByRole("dialog", { name: "Invoice sent" });
    await sheet.getByLabel("Subject").fill("Invoice {{ invoice.number }} is ready");
    await expect(sheet.getByText("Invoice INV-1221 is ready")).toBeVisible();
    await sheet.getByLabel("Subject").fill("{{ invoice.secret }}");
    await expect(sheet.getByRole("alert")).toContainText("no {{ invoice.secret }}");
    await expect(sheet.getByRole("button", { name: "Save template" })).toBeDisabled();
    await sheet.getByLabel("Subject").fill("Invoice {{ invoice.number }} is ready");
    await sheet.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template saved")).toBeVisible();
    await page.getByRole("switch", { name: "Quote sent on" }).click();
    await expect(page.getByRole("switch", { name: "Quote sent on" })).not.toBeChecked();
  });

  test("marking an invoice sent puts a message in the Outbox with its attachment", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/sales?view=invoices&sales-invoices.f.state=Open");
    await page.getByRole("row").nth(1).click();
    await page.waitForURL(/invoices\//);
    const sent = page.getByRole("button", { name: "Update status" });
    await sent.click();
    const mark = page.getByRole("menuitem", { name: "Mark as sent" });
    test.skip((await mark.count()) === 0, "This invoice was already sent");
    await mark.click();
    await page.goto("/settings/outbox");
    await expect(page.getByRole("cell", { name: "Invoice sent" }).first()).toBeVisible();
    await page.getByRole("cell", { name: "Invoice sent" }).first().click();
    const sheet = page.getByRole("dialog").first();
    await expect(sheet.getByRole("list", { name: "Attachments" })).toContainText(".pdf");
    await sheet.getByRole("button", { name: "Simulate bounce" }).click();
    await expect(page.getByText("Marked as bounced")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Failed" }).first()).toBeVisible();
  });
});
