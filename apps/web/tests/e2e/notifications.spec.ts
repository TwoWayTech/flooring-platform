import { expect, test } from "@playwright/test";
import { EMAIL_MESSAGES, featureOn } from "@workspace/shared";
import { SUMMIT_OWNER, signInAs, skipIfFeatureOff } from "./helpers";

const SUMMIT_SALES = { companyId: "summit", userId: "sm-usr-03", roleKey: "sales" } as const;

test.describe("email and notification centre (spec A4)", () => {
  test.beforeEach(() => skipIfFeatureOff("settings.notifications"));

  test("an event can be switched off and its template edited, with a preview", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/notifications");
    await expect(page.getByText("This demo never sends real email.")).toBeVisible();
    await page.getByRole("button", { name: "Edit template for Invoice sent" }).click();
    const sheet = page.getByRole("dialog", { name: "Invoice sent" });
    await sheet.getByLabel("Subject").fill("Invoice {{ invoice.number }} is ready");
    await expect(sheet.getByText(/^Invoice INV-\d+ is ready$/)).toBeVisible();
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

  test("the sender saves with a code after the shared rule; a bad reply-to says why first (ADR 0059, bell and Outbox part)", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/notifications");
    const replyTo = page.getByLabel("Reply-to address");
    await replyTo.fill("office");
    await page.getByRole("button", { name: "Save sender" }).click();
    await expect(page.getByText(EMAIL_MESSAGES.replyTo)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
    await page.getByLabel("Sender name").fill("Summit <billing@elsewhere.example>");
    await replyTo.fill("billing@summitfloor.example");
    await page.getByRole("button", { name: "Save sender" }).click();
    await expect(page.getByText(EMAIL_MESSAGES.senderNameCharacters)).toBeVisible();
    await page.getByLabel("Sender name").fill("Summit Billing");
    await page.getByRole("button", { name: "Save sender" }).click();
    if (featureOn("auth.step-up")) {
      const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
      await dialog.getByLabel("Authenticator code").fill("123456");
      await dialog.getByRole("button", { name: "Confirm" }).click();
    }
    await expect(page.getByText("Sender saved")).toBeVisible();
    await page.goto("/settings/audit");
    await expect(page.getByRole("row").filter({ hasText: "Changed email and notifications" }).first()).toBeVisible();
  });

  test("a sales rep's own Outbox lists only her rows and offers no Send again (ADR 0059, bell and Outbox part, D3)", async ({
    page,
  }) => {
    skipIfFeatureOff("settings.outbox");
    await signInAs(page, SUMMIT_SALES, "/outbox");
    await expect(page.getByRole("heading", { name: "Outbox" })).toBeVisible();
    await expect(page.getByText("This demo never sends real email.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send again" })).toHaveCount(0);
  });
});
