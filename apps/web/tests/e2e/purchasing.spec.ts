import { expect, test, type Page } from "@playwright/test";
import { FLOW_TAG, PHONE, signInAs, SUMMIT_OWNER } from "./helpers";

const PDF = { name: "supplier-invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo\n") };
const LONG = "Weathered Pier Sand Dune Wide Plank Rigid Core with Attached Cork Pad";

/** Opens New purchase order for Tidewater Vinyl and adds the long-named plank. */
async function draftLongLine(page: Page) {
  await page.getByRole("button", { name: "New purchase order" }).click();
  const dialog = page.getByRole("dialog", { name: "New purchase order" });
  await dialog.getByRole("combobox", { name: "Supplier" }).click();
  await page.getByPlaceholder("Name, contact, phone or email").fill("Tidewater Vinyl");
  await page.getByRole("option", { name: /^Tidewater Vinyl/ }).click();
  await dialog.getByRole("button", { name: "Add product" }).click();
  await page.getByPlaceholder("Search by name, color or brand").fill("Attached Cork Pad");
  await page.getByRole("option").first().click();
  return dialog;
}

test.describe("purchasing (spec D1 to D3)", () => {
  // Spec D1 replaces "order, receive whole, bill, pay in full" with drafts, receipts, matched bills and supplier payments.
  test(
    "draft, order, partial receipt, bill with the supplier's file, and a supplier payment with proof (flow 2)",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
      const dialog = await draftLongLine(page);
      await dialog.getByLabel(/area in sq ft/).fill("500");
      await dialog.getByLabel(/area in sq ft/).blur();
      await expect(dialog.getByLabel(/area in sq ft/)).toHaveValue("513");
      await expect(dialog.getByText("≈ 18 cartons (28.50 sq ft each)")).toBeVisible();
      await dialog.getByRole("button", { name: "Save as draft" }).click();
      const saved = page.getByText(/^Draft PO-\d+ saved$/);
      await expect(saved).toBeVisible();
      const number = (await saved.innerText()).split(" ")[1]!;

      await page.getByPlaceholder("Search purchase orders").fill(number);
      await page.getByRole("row", { name: new RegExp(number) }).click();
      const drawer = page.getByRole("dialog", { name: new RegExp(number) });
      // The drawer is named by the order number and its status.
      const status = (label: string) => expect(page.getByRole("dialog", { name: `${number} ${label}` })).toBeVisible();
      await status("Draft");
      await drawer.getByRole("button", { name: "Place order" }).click();
      await status("Ordered");

      await drawer.getByRole("button", { name: "Receive" }).click();
      const receive = page.getByRole("dialog", { name: `Receive ${number}` });
      await receive.getByLabel(/Received in good condition/).fill("10");
      await receive.getByLabel(/Damaged/).fill("1");
      await receive.getByRole("button", { name: "Record receipt" }).click();
      await status("Partly received");

      await drawer.getByRole("button", { name: "Enter bill" }).click();
      const bill = page.getByRole("dialog", { name: `Enter bill for ${number}` });
      await bill.getByLabel("Supplier's bill number").fill("TV-E2E-1");
      await bill.locator("input[type=file]").setInputFiles(PDF);
      await bill.getByRole("button", { name: "Enter bill" }).click();
      await expect(page.getByText("Bill TV-E2E-1 entered")).toBeVisible();
      await page.keyboard.press("Escape");

      await page.goto("/purchasing?view=bills");
      await expect(page.getByRole("region", { name: "Payables" })).toContainText("Due in the next 7 days");
      await page.getByPlaceholder("Search bills").fill("TV-E2E-1");
      const row = page.getByRole("row", { name: /TV-E2E-1/ });
      await expect(row).toContainText("Matches");
      await row.getByRole("button", { name: "Pay" }).click();
      const pay = page.getByRole("dialog", { name: "Pay Tidewater Vinyl" });
      for (const box of await pay.getByRole("checkbox").all()) await box.uncheck();
      await pay.getByRole("checkbox", { name: /TV-E2E-1/ }).check();
      await pay.getByLabel("Amount").fill("100");
      await pay.getByLabel("Reference or transaction ID").fill("ACH-SUP-1");
      await expect(pay.getByRole("button", { name: "Save payment" })).toBeDisabled();
      await pay.locator("input[type=file]").setInputFiles({ ...PDF, name: "remittance.pdf" });
      await pay.getByRole("button", { name: "Save payment" }).click();
      await expect(page.getByText(/^SP-\d{4} recorded$/)).toBeVisible();
      await expect(row).toContainText("Partly paid");
    },
  );

  test("a long product name wraps and truncates without widening the page at 1440 px", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
    const dialog = await draftLongLine(page);
    await expect(dialog.getByText(LONG)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("purchasing at 1280 px (click-through #20 to #25)", () => {
  test.use({ viewport: { width: 1280, height: 529 } });

  test("Purchasing opened from the sidebar starts at the top", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/inventory");
    const toBottom = () =>
      page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return window.scrollY;
      });
    // The list loads after the page, so scroll again until there is something below the fold.
    await expect.poll(toBottom).toBeGreaterThan(0);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Purchasing", exact: true }).click();
    await expect(page).toHaveURL(/\/purchasing/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the new order dialog scrolls as a whole and keeps its lines readable on a short window", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
    const dialog = await draftLongLine(page);
    await expect(dialog.getByLabel(/area in sq ft/)).toHaveValue("28.5");
    const lines = dialog.getByRole("region", { name: "Order lines" });
    expect((await lines.boundingBox())!.height).toBeGreaterThan(90);
    expect(
      await lines.evaluate((el) => el.scrollHeight <= el.clientHeight),
      "the lines have no scroll of their own",
    ).toBe(true);
    const create = dialog.getByRole("button", { name: /Create purchase order|Mark as ordered by phone/ });
    await create.scrollIntoViewIfNeeded();
    await expect(create).toBeInViewport();
  });

  test("damage shows on the order and bill, the panel's lines fit, and a flagged bill asks to pay anyway", async ({
    page,
  }) => {
    await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
    const dialog = await draftLongLine(page);
    await dialog.getByLabel(/area in sq ft/).fill("2c");
    await dialog.getByLabel(/area in sq ft/).blur();
    await dialog.getByRole("button", { name: "Save as draft" }).click();
    const saved = page.getByText(/^Draft PO-\d+ saved$/);
    await expect(saved).toBeVisible();
    const number = (await saved.innerText()).split(" ")[1]!;
    await page.getByPlaceholder("Search purchase orders").fill(number);
    await page.getByRole("row", { name: new RegExp(number) }).click();
    const drawer = page.getByRole("dialog", { name: new RegExp(number) });
    await drawer.getByRole("button", { name: "Place order" }).click();

    await drawer.getByRole("button", { name: "Receive" }).click();
    const receive = page.getByRole("dialog", { name: `Receive ${number}` });
    await receive.getByLabel(/Received in good condition/).fill("28.5");
    await receive.getByLabel(/Damaged/).fill("1c");
    await receive.getByLabel(/Damaged/).blur();
    await receive.getByLabel("Damage note (optional)").fill("Crushed corner");
    await receive.getByRole("button", { name: "Record receipt" }).click();
    await expect(receive).toBeHidden();

    const lines = drawer.getByRole("region", { name: "Order lines" });
    await expect(lines).toContainText("1 carton damaged");
    await expect(drawer.getByRole("list", { name: "Damaged on arrival" })).toContainText("1 carton damaged");
    await expect(drawer.getByText("Note: Crushed corner")).toBeVisible();
    expect(await lines.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    await drawer.getByRole("button", { name: "Enter bill" }).click();
    const bill = page.getByRole("dialog", { name: `Enter bill for ${number}` });
    await expect(bill).toContainText("1 carton damaged");
    await bill.getByLabel("Supplier's bill number").fill("TV-E2E-FLAG");
    await bill.getByLabel("Bill total").fill("1.00");
    await bill.locator("input[type=file]").setInputFiles(PDF);
    await bill.getByRole("button", { name: "Enter bill" }).click();
    await expect(page.getByText("Bill TV-E2E-FLAG entered with a difference to check")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/purchasing?view=bills");
    await page.getByPlaceholder("Search bills").fill("TV-E2E-FLAG");
    const row = page.getByRole("row", { name: /TV-E2E-FLAG/ });
    await row.getByRole("button", { name: "Pay" }).click();
    const pay = page.getByRole("dialog", { name: "Pay Tidewater Vinyl" });
    const billBoxes = pay.getByRole("group", { name: "Bills" }).getByRole("checkbox");
    for (const box of await billBoxes.all()) await box.uncheck();
    await expect(pay.getByRole("alert")).toBeHidden();
    await pay.getByRole("checkbox", { name: /TV-E2E-FLAG/ }).check();
    await pay.getByLabel("Reference or transaction ID").fill("ACH-FLAG-1");
    await pay.locator("input[type=file]").setInputFiles({ ...PDF, name: "remittance.pdf" });
    await expect(pay.getByRole("alert")).toContainText("Bill TV-E2E-FLAG differs from the goods received");
    await expect(pay.getByRole("button", { name: "Save payment" })).toBeDisabled();
    await pay.getByRole("checkbox", { name: "Pay anyway" }).check();
    await expect(pay.getByRole("button", { name: "Save payment" })).toBeEnabled();
    // Changing the bills chosen clears Pay anyway, so the new choice is confirmed again.
    await pay.getByRole("checkbox", { name: /TV-E2E-FLAG/ }).uncheck();
    await pay.getByRole("checkbox", { name: /TV-E2E-FLAG/ }).check();
    await expect(pay.getByRole("checkbox", { name: "Pay anyway" })).not.toBeChecked();
    await expect(pay.getByRole("button", { name: "Save payment" })).toBeDisabled();
  });
});

test.describe("purchasing on a phone (spec D1)", () => {
  test.use(PHONE);
  test("the order lines scroll inside their box; the page never overflows at 390 px", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/purchasing?view=orders");
    const dialog = await draftLongLine(page);
    await expect(dialog.getByRole("region", { name: "Order lines" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
