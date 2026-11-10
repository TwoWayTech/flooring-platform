import { expect, test } from "@playwright/test";
import { signInAs, skipIfFeatureOff, SUMMIT_OWNER, type Persona } from "./helpers";

const GRACE: Persona = { companyId: "summit", userId: "sm-usr-06", roleKey: "accountant" };
const PDF = { name: "remit.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo\n") };

test.describe("suppliers directory (spec B1)", () => {
  test.beforeEach(() => skipIfFeatureOff("purchasing.suppliers"));

  test("opens a supplier with its contacts and adds one that lands on the page", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/purchasing?view=suppliers");
    await page.getByRole("row", { name: /Open Northline Mills/ }).click();
    const drawer = page.getByRole("dialog", { name: /Northline Mills/ });
    const contacts = drawer.getByRole("region", { name: "Contacts" });
    await expect(contacts.getByText("Primary")).toBeVisible();
    await expect(contacts.getByRole("link", { name: /^Call / }).first()).toBeVisible();
    await drawer.getByRole("button", { name: "Add contact" }).click();
    const form = page.getByRole("dialog", { name: "Add contact" });
    await form.getByLabel("Name").fill("Ivy Marsh");
    await form.getByRole("button", { name: "Save contact" }).click();
    await expect(form.getByRole("alert")).toContainText("email or a phone");
    await form.getByLabel("Email").fill("ivy@northlinemills.example");
    await form.getByRole("button", { name: "Save contact" }).click();
    await expect(contacts.getByText("Ivy Marsh")).toBeVisible();
  });
});

test.describe("purchase order form (spec B2)", () => {
  test.beforeEach(() => skipIfFeatureOff("purchasing.suppliers"));

  test("finds a supplier by a contact's name, adds a new supplier inline, and it is in the directory", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
    await page.getByRole("button", { name: "New purchase order" }).click();
    const dialog = page.getByRole("dialog", { name: "New purchase order" });
    await dialog.getByRole("combobox", { name: "Supplier" }).click();
    const search = page.getByPlaceholder("Name, contact, phone or email");
    await search.fill("Walkthrough Tile Supply");
    await page.getByRole("option", { name: /as a new supplier/ }).click();
    await page.getByRole("button", { name: "Add supplier" }).click();
    await expect(dialog.getByRole("combobox", { name: "Supplier" })).toContainText("Walkthrough Tile Supply");
    await dialog.getByRole("button", { name: "Add new contact" }).click();
    const form = page.getByRole("dialog", { name: "Add contact" });
    await form.getByLabel("Name").fill("Noor Haddad");
    await form.getByLabel("Email").fill("noor@walkthrough.example");
    await form.getByRole("button", { name: "Save contact" }).click();
    await expect(dialog.getByRole("combobox", { name: "Sales rep" })).toContainText("Noor Haddad");
    await page.keyboard.press("Escape");
    await page.goto("/purchasing?view=suppliers");
    const row = page.getByRole("row", { name: /Walkthrough Tile Supply/ });
    await expect(row).toContainText("Profile incomplete");
    await expect(row).toContainText("Noor Haddad");
  });
});

test.describe("payments to verify (audit U-04, U-15)", () => {
  test.beforeEach(() => skipIfFeatureOff("finance.payments-queue"));

  test("a supplier payment waits, shows on the bill, and a second person confirms it", async ({ page }) => {
    await signInAs(page, GRACE, "/purchasing?view=bills");
    const first = page
      .getByRole("row", { name: /Open bill/ })
      .filter({ hasText: "Open" })
      .first();
    const number = (await first.getByRole("cell").first().innerText()).trim();
    const row = page.getByRole("row", { name: new RegExp(number) });
    await row.getByRole("button", { name: "Pay" }).click();
    const pay = page.getByRole("dialog", { name: /^Pay / });
    await pay.getByLabel("Reference or transaction ID").fill("ACH-QUEUE-1");
    await pay.locator("input[type=file]").setInputFiles(PDF);
    await pay.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText(/waits for verification/)).toBeVisible();
    await expect(row).toContainText("Pending verification");
    await expect(row.getByRole("button", { name: "Pay" })).toHaveCount(0);

    await signInAs(page, SUMMIT_OWNER, "/finance?view=payments");
    const queued = page.getByRole("row", { name: new RegExp(number) });
    await queued.getByRole("button", { name: /^Confirm SP-/ }).click();
    await expect(page.getByText(/SP-\d+ confirmed/)).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(number) })).toHaveCount(0);
  });

  test("nobody confirms what they recorded", async ({ page }) => {
    await signInAs(page, GRACE, "/finance?view=payments");
    await expect(page.getByText("Someone else verifies it").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Confirm PAY-/ })).toHaveCount(0);
  });
});
