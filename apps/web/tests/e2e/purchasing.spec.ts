import { expect, test } from "@playwright/test";
import { signInAs, SUMMIT_OWNER } from "./helpers";

test.describe("purchasing", () => {
  test("orders, receives, bills and pays", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
    await page.getByRole("button", { name: "New purchase order" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add product" }).click();
    await page.getByRole("option").first().click();
    await dialog.getByRole("button", { name: "Create purchase order" }).click();
    const created = page.getByText(/^Purchase order PO-\d+ created$/);
    await expect(created).toBeVisible();
    const number = (await created.innerText()).split(" ")[2]!;

    await page.getByPlaceholder("Search purchase orders").fill(number);
    await page.getByRole("row", { name: new RegExp(number) }).click();
    await page.getByRole("button", { name: "Receive into stock" }).click();
    await expect(page.getByText(`${number} received into stock`)).toBeVisible();
    await page.getByLabel("Supplier's bill number").fill("TEST-1001");
    await page.getByRole("button", { name: "Enter bill" }).click();
    await expect(page.getByText("Bill TEST-1001 entered")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/purchasing?view=bills");
    await expect(page.getByRole("region", { name: "Payables aging" })).toBeVisible();
    await page.getByPlaceholder("Search bills").fill("TEST-1001");
    await page
      .getByRole("row", { name: /TEST-1001/ })
      .getByRole("button", { name: "Pay" })
      .click();
    await expect(page.getByText("Bill TEST-1001 paid")).toBeVisible();
    await expect(page.getByRole("row", { name: /TEST-1001/ })).toContainText("Paid");
  });
});
