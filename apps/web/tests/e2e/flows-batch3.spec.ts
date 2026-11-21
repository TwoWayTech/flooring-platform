import { expect, test, type Page } from "@playwright/test";
import { addDays, mondayOf } from "@workspace/shared";
import { FLOW_TAG, signInAs, summitDay, SUMMIT_OWNER, type Persona } from "./helpers";

const PRIYA: Persona = { companyId: "summit", userId: "sm-usr-03", roleKey: "sales" };
const GRACE: Persona = { companyId: "summit", userId: "sm-usr-06", roleKey: "accountant" };
const COLE: Persona = { companyId: "summit", userId: "sm-usr-04", roleKey: "warehouse" };
const TAMARA: Persona = { companyId: "summit", userId: "sm-usr-07", roleKey: "hr" };
const BRI: Persona = { companyId: "summit", userId: "sm-usr-14", roleKey: "employee" };
const RENATA: Persona = { companyId: "summit", userId: "sm-usr-15", roleKey: "purchasing" };

const PDF = { name: "proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo proof\n%%EOF\n") };
/** Summit's day in Denver, the day its forms default to. */
const today = () => summitDay();

/** The gross pay cell of a person's row on the pay period page. */
const grossCell = (page: Page, name: string) =>
  page
    .getByRole("row", { name: new RegExp(name) })
    .getByRole("cell")
    .nth(9);

/** Opens the current pay period, which is the newest on the list. */
async function openCurrentPeriod(page: Page) {
  await page.goto("/hr/pay-periods");
  await page.getByLabel("Pay period").click();
  await page.getByRole("option").first().click();
  await expect(page.getByTestId("gross-pay-label")).toBeVisible();
}

test.describe("end-to-end flows (spec G3)", () => {
  test(
    "1. Sales: new customer, quote from a chosen warehouse, invoice, deposit with proof, cut from roll",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signInAs(page, PRIYA, "/sales/quotes/new");
      await page.getByLabel("Fulfilled from").click();
      await page.getByRole("option", { name: /Denver Central/ }).click();
      await page.getByLabel("Customer", { exact: true }).click();
      await page.getByLabel("Search customers").fill("Morgan Flow");
      await page.getByRole("option", { name: "Add “Morgan Flow” as a new customer" }).click();
      const form = page.getByRole("form", { name: "New customer" });
      await form.getByLabel("Phone (optional)").fill("303-555-0191");
      await form.getByRole("button", { name: "Add customer" }).click();
      await page.getByLabel("Job-site address").click();
      await page.getByRole("option", { name: "Add new address" }).click();
      const address = page.getByRole("dialog");
      await address.getByLabel("Find the address").fill("123 Main");
      await address.getByRole("option").first().click();
      await address.getByRole("button", { name: "Save address" }).click();
      await page.getByRole("button", { name: "Add product" }).click();
      await page.getByPlaceholder("Search by name, color or brand").fill("Fieldstone Sand Dune");
      await page.getByRole("option").first().click();
      await page.getByRole("button", { name: "Save as draft" }).click();
      await page.getByRole("button", { name: "Send / mark pending" }).click();
      await page.getByRole("dialog", { name: "Send quote" }).getByRole("button", { name: "Mark as pending" }).click();
      await page.getByRole("button", { name: "Mark accepted" }).click();
      await page.getByRole("button", { name: "Convert to invoice" }).click();
      await expect(page).toHaveURL(/\/sales\/invoices\//);
      const number = (await page.getByRole("heading", { level: 1 }).innerText()).match(/INV-\d+/)![0];
      const invoicePath = new URL(page.url()).pathname;
      // The default Sales role views payments but does not record them (ADR 0061 decision 3).
      await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);

      await signInAs(page, GRACE, invoicePath);
      await page.getByRole("button", { name: "Update status" }).click();
      await page.getByRole("menuitem", { name: "Record deposit" }).click();
      const sheet = page.getByRole("dialog", { name: /Record deposit/ });
      await sheet.getByLabel("Reference or transaction ID").fill("ACH-FLOW-1");
      await sheet.locator("input[type=file]").setInputFiles(PDF);
      await sheet.getByRole("button", { name: /^Save (payment|deposit)$/ }).click();
      const recorded = page.getByText(new RegExp(`^PAY-\\d+ recorded(; it waits for verification| on ${number})$`));
      await expect(recorded).toBeVisible();
      // Above the approval threshold even the accountant's deposit waits for a second person.
      if ((await recorded.innerText()).includes("waits")) {
        await signInAs(page, SUMMIT_OWNER, "/finance?view=payments");
        await page
          .getByRole("row", { name: new RegExp(number) })
          .getByRole("button", { name: /^Confirm PAY-/ })
          .click();
        await expect(page.getByText(/PAY-\d+ confirmed/)).toBeVisible();
      }

      await signInAs(page, COLE, "/inventory?view=ready");
      await page
        .getByRole("row", { name: new RegExp(number) })
        .first()
        .getByRole("button", { name: /^(Cut|Issue)$/ })
        .click();
      await page
        .getByRole("dialog", { name: /^(Cut|Issue) .+\?$/ })
        .getByRole("button", { name: /^(Cut|Issue) / })
        .click();
      await expect(page.getByText(new RegExp(`^(Cut|Issued) .+ for ${number}$`))).toBeVisible();
    },
  );

  test(
    "2. Purchasing: new supplier and rep inside a PO, order in sq ft, receive into two warehouses, bill, pay",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await signInAs(page, RENATA, "/purchasing?view=orders");
      await page.getByRole("button", { name: "New purchase order" }).click();
      const dialog = page.getByRole("dialog", { name: "New purchase order" });
      await dialog.getByRole("combobox", { name: "Supplier" }).click();
      await page.getByPlaceholder("Name, contact, phone or email").fill("Flow Tile Supply");
      await page.getByRole("option", { name: /as a new supplier/ }).click();
      await page.getByRole("button", { name: "Add supplier" }).click();
      await dialog.getByRole("button", { name: "Add new contact" }).click();
      const contact = page.getByRole("dialog", { name: "Add contact" });
      await contact.getByLabel("Name").fill("Sam Rivera");
      await contact.getByLabel("Email").fill("sam@flowtile.example");
      await contact.getByRole("button", { name: "Save contact" }).click();
      for (const search of ["Attached Cork Pad", "Fieldstone Sand Dune"]) {
        await dialog.getByRole("button", { name: "Add product" }).click();
        await page.getByPlaceholder("Search by name, color or brand").fill(search);
        await page.getByRole("option").first().click();
      }
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
      const places = receive.getByLabel("Received into", { exact: true });
      await places.first().click();
      await page.getByRole("option", { name: /Denver Central/ }).click();
      await places.last().click();
      await page.getByRole("option", { name: /Colorado Springs/ }).click();
      await receive.getByRole("button", { name: "Record receipt" }).click();
      await expect(page.getByRole("dialog", { name: `Receive ${number}` })).toBeHidden();

      await signInAs(page, GRACE, "/purchasing?view=orders");
      await page.getByPlaceholder("Search purchase orders").fill(number);
      await page.getByRole("row", { name: new RegExp(number) }).click();
      await page
        .getByRole("dialog", { name: new RegExp(number) })
        .getByRole("button", { name: "Enter bill" })
        .click();
      const bill = page.getByRole("dialog", { name: `Enter bill for ${number}` });
      await bill.getByLabel("Supplier's bill number").fill("FLOW-BILL-1");
      await bill.locator("input[type=file]").setInputFiles(PDF);
      await bill.getByRole("button", { name: "Enter bill" }).click();
      await expect(page.getByText("Bill FLOW-BILL-1 entered")).toBeVisible();
      await page.goto("/purchasing?view=bills");
      await page.getByPlaceholder("Search bills").fill("FLOW-BILL-1");
      await page
        .getByRole("row", { name: /FLOW-BILL-1/ })
        .getByRole("button", { name: "Pay" })
        .click();
      const pay = page.getByRole("dialog", { name: /^Pay / });
      await pay.getByLabel("Reference or transaction ID").fill("ACH-FLOW-2");
      await pay.locator("input[type=file]").setInputFiles(PDF);
      await pay.getByRole("button", { name: "Save payment" }).click();
      await expect(page.getByText(/SP-\d{4} recorded|waits for verification/).first()).toBeVisible();
    },
  );

  test(
    "3. Employee uploads a timesheet from the template, HR approves, the pay period shows gross pay",
    { tag: FLOW_TAG },
    async ({ page }) => {
      const monday = mondayOf(today());
      const csv = [
        "employee_email,employee_external_id,employee_name,work_date,hours_worked,note",
        ...[0, 1].map((d) => `bri.alvarez@summitfloor.example,,Bri Alvarez,${addDays(monday, d)},6.5,`),
      ].join("\n");
      await signInAs(page, BRI, "/my/timesheet");
      await page.getByRole("button", { name: "Upload" }).click();
      await page
        .getByLabel("Timesheet file")
        .setInputFiles({ name: "my-week.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await expect(page.getByRole("status")).toContainText("with errors");
      await page.getByRole("button", { name: "Save hours" }).click();
      // No reload: the unedited form takes the uploaded hours, so Submit sends them (ADR 0051,
      // 2026-11-16). Only Monday: Tuesday is a future day when the run is on a Monday.
      await expect(page.getByLabel("Mon", { exact: true })).toHaveValue("6.5");
      await page.getByRole("button", { name: "Submit" }).click();
      await expect(page.getByText("Timesheet submitted")).toBeVisible();

      await signInAs(page, TAMARA, "/hr/timesheets?view=queue");
      await page.getByLabel("Search timesheets").fill("Bri Alvarez");
      await page.getByRole("button", { name: "Approve", exact: true }).first().click();
      await expect(page.getByText("Timesheet approved for Bri Alvarez")).toBeVisible();

      await openCurrentPeriod(page);
      await expect(grossCell(page, "Bri Alvarez")).not.toHaveText("$0.00");
    },
  );

  test(
    "4. Employee requests time off, HR approves, the balance and pay update",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await signInAs(page, BRI, "/my/time-off");
      const balances = page.getByRole("region", { name: "Balances" });
      const before = await balances.getByRole("definition").first().innerText();
      await page.getByRole("button", { name: "Request time off" }).click();
      await page.getByRole("button", { name: "Send request" }).click();
      await expect(page.getByText("Time-off request sent")).toBeVisible();

      await signInAs(page, TAMARA, "/hr/time-off");
      await page.getByLabel("Search requests").fill("Bri Alvarez");
      await page.getByRole("button", { name: "Approve" }).first().click();
      await expect(page.getByText("Time off approved for Bri Alvarez")).toBeVisible();

      await openCurrentPeriod(page);
      await expect(
        page
          .getByRole("row", { name: /Bri Alvarez/ })
          .getByRole("cell")
          .nth(5),
      ).not.toHaveText("$0.00");

      await signInAs(page, BRI, "/my/time-off");
      await expect(page.getByRole("region", { name: "Balances" }).getByRole("definition").first()).not.toHaveText(
        before,
      );
    },
  );

  test(
    "5. Customer contract, milestone invoice with retainage, payment, retainage release",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await signInAs(page, SUMMIT_OWNER, "/contracts");
      await page.getByRole("button", { name: "New contract" }).click();
      const form = page.getByRole("dialog");
      await form.getByLabel("Title").fill("Flow contract");
      await form.getByLabel("Description").fill("Final inspection");
      await form.getByLabel("Billing").click();
      await page.getByRole("option", { name: "Bill as a milestone" }).click();
      await form.getByLabel("Value").fill("800");
      await form.getByRole("button", { name: "Save contract" }).click();
      await expect(page.getByRole("heading", { name: /Flow contract/ })).toBeVisible();
      await page.getByRole("button", { name: "Send for signature" }).click();
      await page.getByRole("button", { name: "Record signature" }).click();
      // The signer starts as the customer's contact person, or empty; type one so the flow never depends on it.
      await page.getByLabel("Signer's full name").fill("Avery Stone");
      await page.getByRole("dialog").getByRole("button", { name: "Record signature" }).click();
      await expect(page.getByText(/^Typed signature: Avery Stone/)).toBeVisible();

      await page.getByRole("button", { name: "New billing" }).click();
      await page.getByRole("checkbox", { name: "L1 complete" }).check();
      await expect(page.getByRole("dialog").getByText(/of which/)).toContainText("$40.00");
      await page.getByRole("button", { name: "Post billing" }).click();
      await expect(page.getByText(/^Billing 1 posted$/)).toBeVisible();
      const contract = page.url();
      await page
        .getByRole("row", { name: /Billing 1/ })
        .getByRole("link")
        .click();
      await expect(page).toHaveURL(/\/sales\/invoices\//);
      await page.getByRole("button", { name: "Record payment" }).click();
      const sheet = page.getByRole("dialog", { name: /Record payment/ });
      await sheet.getByLabel("Reference or transaction ID").fill("ACH-FLOW-5");
      await sheet.locator("input[type=file]").setInputFiles(PDF);
      await sheet.getByRole("button", { name: /^Save (payment|deposit)$/ }).click();
      await expect(sheet).toBeHidden();

      await page.goto(contract.replace(/^.*\/contracts/, "/contracts"));
      await page.getByRole("button", { name: "Mark completed" }).click();
      await page.getByRole("button", { name: "Release retainage" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Release retainage" }).click();
      await expect(page.getByText("Retainage released")).toBeVisible();
      await expect(page.getByRole("row", { name: /Release/ }).getByRole("link")).toBeVisible();
    },
  );

  test(
    "6. Meeting with a new guest by email, invite in the Outbox, simulated reply",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await signInAs(page, SUMMIT_OWNER, "/meetings");
      await page.getByRole("button", { name: "New meeting" }).click();
      await page.getByRole("dialog").getByLabel("Title").fill("Flow meeting");
      await page.getByRole("textbox", { name: "Guests" }).fill("casey@flowclient.example");
      await page.getByLabel("Name (optional)").fill("Casey Flow");
      await page.getByLabel("Save under customer").click();
      await page.getByRole("option").first().click();
      await page.getByRole("button", { name: "Add guest by email" }).click();
      await page.getByRole("button", { name: "Schedule meeting" }).click();
      await expect(page.getByText("Meeting Flow meeting scheduled")).toBeVisible();

      await page.goto("/settings/outbox");
      await page
        .getByRole("row", { name: /Casey Flow/ })
        .first()
        .click();
      await expect(page.getByRole("button", { name: /Flow meeting\.ics/ })).toBeVisible();
      await page.getByRole("button", { name: "Accept" }).click();
      await expect(page.getByText("Casey Flow: Accepted")).toBeVisible();
    },
  );

  test(
    "7. Expense for a showroom with a receipt shows in that location's profit",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await signInAs(page, GRACE, "/finance?view=expenses");
      await page.getByRole("button", { name: "New expense" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Location").click();
      await page
        .getByRole("option", { name: /Showroom|showroom/ })
        .first()
        .click();
      const place = (await dialog.getByLabel("Location").innerText()).trim();
      await dialog.getByLabel("Amount before tax").fill("432.10");
      await dialog.locator("input[type=file]").setInputFiles(PDF);
      await dialog.getByRole("button", { name: "Record expense" }).click();
      const done = page.getByText(/^Expense EXP-\d+ recorded$/);
      await expect(done).toBeVisible();
      const number = (await done.innerText()).split(" ")[1]!;

      await page.goto("/reports");
      await page.getByRole("combobox", { name: "Period" }).click();
      await page.getByRole("option", { name: "This month" }).click();
      await page
        .getByRole("group", { name: "Expenses by location view" })
        .getByRole("button", { name: "Table" })
        .click();
      await page.getByRole("region", { name: "Expenses by location" }).getByRole("button", { name: place }).click();
      await expect(page.getByRole("dialog").getByRole("link", { name: new RegExp(number) })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("region", { name: "Profit by location" })).toContainText(place);
    },
  );
});
