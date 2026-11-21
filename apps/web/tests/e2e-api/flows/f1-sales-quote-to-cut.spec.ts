import { expect, type Locator, type Page } from "@playwright/test";
import {
  dec,
  depositAmount,
  moneyString,
  stockIssueAction,
  sum,
  type Customer,
  type Invoice,
  type Payment,
  type Quote,
  type Report,
  type Reservation,
  type Roll,
} from "@workspace/shared";
import type { StockHold } from "@/lib/api/contract";
import { FLOW_TAG } from "../../e2e/helpers";
import { ACCOUNTANT_EMAIL, SALES_EMAIL, WAREHOUSE_EMAIL } from "../accounts";
import {
  cellUnder,
  expectAuditRows,
  expectLedgerMoved,
  invoicePills,
  notifications,
  savePayment,
  trialBalance,
  type InAppNote,
  type PaymentOutcome,
} from "./checks";
import {
  addProduct,
  assertSameCompanyDay,
  companyToday,
  FIELDSTONE,
  flowTest,
  resetAuthAround,
  runId,
  shown,
  waitForAnswer,
} from "./kit";
import { CASH, movedBy } from "./ledger";

/**
 * Every payment the flow records counts at once: Grace's scope is all, and each amount is under
 * Summit's $1,000 approval threshold (payments.service.ts). Sales views payments but does not record
 * them (ADR 0061 decision 3).
 */
const COUNTS: PaymentOutcome = {
  status: "confirmed",
  why: "the accountant's payment under Summit's $1,000 threshold counts at once",
};

/** The quote's status pill in the page header. */
function quoteStatus(page: Page): Locator {
  return page.locator("header").getByText(/^(Draft|Pending|Accepted|Converted|Declined|Expired)$/);
}

/** How many of the person's in-app notes ask to verify a payment on this invoice. */
function toVerify(notes: readonly InAppNote[], invoiceId: string): number {
  return notes.filter((n) => n.eventKey === "payment.to_verify" && n.href === `/sales/invoices/${invoiceId}`).length;
}

/** Opens Payments received for This month, narrowed to the customer, and returns the answer and its table. */
async function paymentsReceived(page: Page, customer: string): Promise<{ report: Report; table: Locator }> {
  const answer = waitForAnswer<Report>(page, "GET", /^\/api-proxy\/reports\/payments$/, { range: "1m", customer });
  await page.goto("/reports?report=payments");
  await page.getByRole("combobox", { name: "Dates" }).click();
  await page.getByRole("option", { name: "This month", exact: true }).click();
  await page.getByLabel("Customer", { exact: true }).fill(customer);
  const report = await answer;
  const table = page.getByRole("region", { name: "Payments received table" });
  await expect(table).not.toHaveAttribute("aria-busy", "true");
  return { report, table };
}

/** The report's rows carrying a payment reference. */
function rowsWith(report: Report, reference: string): Record<string, string>[] {
  return report.rows.filter((row) => row.reference === reference);
}

/**
 * Flow F1 (mirrors demo spec H flow 1 and G3 flow 1; session log 2026-11-16-0200, "The seven
 * flows"): a salesperson adds a customer and a job site while quoting, the quote goes Draft →
 * Pending → Accepted → invoice with a roll on hold. Priya sees the invoice's payments but has no
 * Record payment (ADR 0061 decision 3): the accountant records the deposit and the final payment,
 * each counted at once; the warehouse cuts the roll; the accountant then voids the deposit. The
 * ledger, the bell, the stock, Payments received and the audit log are checked after each step, all
 * from the answers. Rule 5 is checked the other way too: Priya's quote request and its answer carry
 * no cost, and her summary shows no margin (B1, session log 2026-11-16-2320). A run that stops
 * midway is undone by two clean-ups, newest first: the deposit is voided, and the invoice is voided,
 * which releases its hold (refused once confirmed money stays on it). The final payment has none:
 * voiding it after a passing run would post after step 8. A complete run leaves them all refused as
 * already done (400), so its books stay as step 8 checked them.
 */
flowTest.describe("flow F1: sales from a new customer to the cut and a voided deposit", () => {
  resetAuthAround([ACCOUNTANT_EMAIL, SALES_EMAIL, WAREHOUSE_EMAIL]);

  flowTest(
    "quote to invoice, deposit and final payment recorded by the accountant, roll cut, deposit voided",
    { tag: FLOW_TAG },
    async ({ personas }) => {
      flowTest.setTimeout(180_000);
      const run = runId();
      const start = companyToday();
      const since = Date.now();
      const customerName = `E2E Flow Customer ${run}`;
      const depositRef = `E2E-F1-DEP-${run}`;
      const finalRef = `E2E-F1-FIN-${run}`;
      const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
      const priya = await personas.open(SALES_EMAIL);

      const [t0, n0] = await flowTest.step("0. Grace's books and bell before", () =>
        Promise.all([trialBalance(grace.request), notifications(grace.request)]),
      );

      const invoice = await flowTest.step("1. Priya builds the quote for a new customer and converts it", async () => {
        const { page } = priya;
        await page.goto("/sales/quotes/new");
        await page.getByLabel("Fulfilled from").click();
        await page.getByRole("option", { name: "Denver Central", exact: true }).click();

        await page.getByLabel("Customer", { exact: true }).click();
        await page.getByLabel("Search customers").fill(customerName);
        await page.getByRole("option", { name: `Add “${customerName}” as a new customer` }).click();
        const quick = page.getByRole("form", { name: "New customer" });
        await quick.getByLabel("Phone (optional)").fill("303-555-0191");
        const created = waitForAnswer<Customer>(page, "POST", /^\/api-proxy\/customers$/);
        await quick.getByRole("button", { name: "Add customer" }).click();
        const customer = await created;
        expect(customer.name).toBe(customerName);
        await expect(page.getByLabel("Customer", { exact: true })).toHaveText(customerName);

        // The job site is typed by hand: the address finder calls an outside service (session log
        // 2026-11-16-0200, "Left out, and why").
        await page.getByLabel("Job-site address").click();
        await page.getByRole("option", { name: "Add new address" }).click();
        const address = page.getByRole("dialog", { name: "Add new address" });
        await address.getByLabel("Street", { exact: true }).fill(`${run} Flow St`);
        await address.getByLabel("City", { exact: true }).fill("Denver");
        await address.getByLabel("State", { exact: true }).click();
        await page.getByRole("option", { name: "Colorado", exact: true }).click();
        await address.getByLabel("ZIP", { exact: true }).fill("80202");
        const savedAddress = waitForAnswer<Customer>(page, "PUT", new RegExp(`^/api-proxy/customers/${customer.id}$`));
        await address.getByRole("button", { name: "Save address" }).click();
        await savedAddress;
        await expect(address).toBeHidden();
        await expect(page.getByLabel("Job site street")).toHaveValue(`${run} Flow St`);

        await addProduct(page, FIELDSTONE);
        const quantity = page.getByLabel(`${FIELDSTONE.line} quantity`, { exact: true });
        await quantity.fill("15");
        await quantity.blur();
        await expect(quantity).toHaveValue("15");
        // A 60 % deposit, so the 40 % left once the deposit is voided reads Partly paid.
        await page.getByLabel("Deposit percent").fill("60");
        await page.getByLabel("Deposit percent").blur();

        const drafted = waitForAnswer<Quote>(page, "POST", /^\/api-proxy\/quotes$/);
        const sent = page.waitForRequest(
          (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api-proxy/quotes",
        );
        await page.getByRole("button", { name: "Save as draft" }).click();
        const quote = await drafted;
        // Rule 5 the other way: the browser sends no cost it was never given, and gets none back (B1).
        const request = (await sent).postDataJSON() as Quote;
        expect(request.lines.filter((line) => "unitCost" in line).length, "request lines carrying unitCost").toBe(0);
        expect(quote.lines.filter((line) => "unitCost" in line).length, "answer lines carrying unitCost").toBe(0);
        await expect(
          page
            .getByRole("region", { name: "Summary" })
            .locator("dt")
            .filter({ hasText: /^Margin$/ }),
        ).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`/sales/quotes/${quote.id}$`));
        await expect(quoteStatus(page)).toHaveText("Draft");
        await page.getByRole("button", { name: "Send / mark pending" }).click();
        await page.getByRole("dialog", { name: "Send quote" }).getByRole("button", { name: "Mark as pending" }).click();
        await expect(quoteStatus(page)).toHaveText("Pending");
        await page.getByRole("button", { name: "Mark accepted" }).click();
        await expect(quoteStatus(page)).toHaveText("Accepted");

        const converted = waitForAnswer<Invoice>(page, "POST", new RegExp(`^/api-proxy/quotes/${quote.id}/invoice$`));
        await page.getByRole("button", { name: "Convert to invoice" }).click();
        const made = await converted;
        personas.onCleanup(`void ${made.number}`, () =>
          grace.request.post(`/api-proxy/invoices/${made.id}/void`, { data: { reason: "e2e flow clean-up" } }),
        );
        expect(dec(made.depositPct).eq(60), `a 60 % deposit, not ${made.depositPct}`).toBe(true);
        await expect(page).toHaveURL(new RegExp(`/sales/invoices/${made.id}$`));
        await expect(invoicePills(page)).toHaveText(["Open"]);
        await expect(
          page.getByRole("region", { name: "Stock", exact: true }).getByText("Reserved", { exact: true }),
        ).toBeVisible();
        return made;
      });
      const deposit = depositAmount(invoice.total, invoice.depositPct);
      const rest = moneyString(dec(invoice.total).minus(deposit));

      const t1 = await flowTest.step("1. the ledger: the invoice posts receivable, sales and sales tax", async () => {
        const tb = await trialBalance(grace.request);
        expectLedgerMoved(t0, tb, {
          accounts_receivable: invoice.total,
          sales: dec(invoice.subtotal).negated(),
          sales_tax_payable: dec(invoice.tax).negated(),
        });
        return tb;
      });

      await flowTest.step("2. Priya sees the invoice's payments but cannot record one (ADR 0061)", async () => {
        const { page } = priya;
        await expect(page.getByRole("region", { name: "Payments" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Record payment", exact: true })).toHaveCount(0);
      });

      const paidDeposit = await flowTest.step("2. Grace records the deposit; it counts at once", async () => {
        const { page } = grace;
        await page.goto(`/sales/invoices/${invoice.id}`);
        await page.getByRole("button", { name: "Update status" }).click();
        await page.getByRole("menuitem", { name: "Record deposit" }).click();
        await expect(
          page.getByRole("dialog", { name: "Record deposit" }).getByLabel("Amount", { exact: true }),
        ).toHaveValue(deposit);
        const payment = await savePayment(page, invoice.number, depositRef, COUNTS);
        personas.onCleanup(`void ${payment.number}`, () =>
          grace.request.post(`/api-proxy/payments/${payment.id}/void`, { data: { reason: "e2e flow clean-up" } }),
        );
        expect(payment.kind).toBe("deposit");
        expect(payment.amount).toBe(deposit);
        await expect(invoicePills(page)).toHaveText(["Deposit paid"]);
        return payment;
      });

      const t3 = await flowTest.step(
        "3. the deposit posts, nobody is asked to verify it; Priya sees Deposit paid",
        async () => {
          const tb = await trialBalance(grace.request);
          expectLedgerMoved(t1, tb, { [CASH]: deposit, accounts_receivable: dec(deposit).negated() });
          expect(toVerify(n0, invoice.id), "no note for this invoice before").toBe(0);
          expect(toVerify(await notifications(grace.request), invoice.id), "no payment.to_verify note").toBe(0);
          await priya.page.reload();
          await expect(invoicePills(priya.page)).toHaveText(["Deposit paid"]);
          return tb;
        },
      );

      const { t4, cost, rollNumber } = await flowTest.step("4. Cole cuts the held roll", async () => {
        const cole = await personas.open(WAREHOUSE_EMAIL);
        const { page } = cole;
        const holdsAnswer = waitForAnswer<StockHold[]>(page, "GET", /^\/api-proxy\/stock-holds$/);
        const rollsAnswer = waitForAnswer<Roll[]>(page, "GET", /^\/api-proxy\/rolls$/);
        await page.goto("/inventory?view=ready");
        const hold = (await holdsAnswer).find((h) => h.invoiceId === invoice.id);
        const before = await rollsAnswer;
        if (!hold) throw new Error(`No stock hold for ${invoice.number}.`);
        expect(
          dec(hold.shortBy).isZero(),
          "Denver Central has no Fieldstone Sand Dune roll that fits; receive one through a purchase order into Denver Central",
        ).toBe(true);
        expect(hold.mayIssue, "the confirmed deposit makes the hold ready to cut").toBe(true);
        const parent = before.find((r) => r.id === hold.rollId);
        if (!parent) throw new Error(`The hold for ${invoice.number} is on no roll the page listed.`);

        await page.getByPlaceholder("Search invoices and customers").fill(customerName);
        const row = page.getByRole("row").filter({ hasText: invoice.number });
        const issued = waitForAnswer<Reservation>(
          page,
          "POST",
          new RegExp(`^/api-proxy/reservations/${hold.reservationId}/issue$`),
        );
        await row.getByRole("button", { name: "Cut", exact: true }).click();
        expect((await issued).status).toBe("issued");
        await expect(page.getByText(`Cut for ${invoice.number}`, { exact: true })).toBeVisible();
        await expect(row).toHaveCount(0);

        // The cut may leave a remnant: the parent's length now plus any new remnant's is what it had less the cut.
        const rollsAfter = waitForAnswer<Roll[]>(page, "GET", /^\/api-proxy\/rolls$/);
        await page.goto("/inventory?view=rolls");
        const after = await rollsAfter;
        const known = new Set(before.map((r) => r.id));
        const remnants = after.filter((r) => r.parentRollId === parent.id && !known.has(r.id));
        const left = after.find((r) => r.id === parent.id)?.remainingLengthFt ?? "0";
        const kept = sum([left, ...remnants.map((r) => r.remainingLengthFt)]);
        expect(
          kept.eq(dec(parent.remainingLengthFt).minus(hold.quantity)),
          `roll ${parent.rollNumber}: ${parent.remainingLengthFt} ft less the ${hold.quantity} ft cut, now ${left} ft plus remnants ${remnants.map((r) => r.remainingLengthFt).join(", ") || "none"}`,
        ).toBe(true);
        await page.getByPlaceholder("Search rolls, products, dye lots").fill(parent.rollNumber);
        const rollRow = page.getByRole("row", { name: `Open roll ${parent.rollNumber}`, exact: true });
        const table = page.locator("table").filter({ has: rollRow });
        await expect(await cellUnder(table, rollRow, "Remaining")).toHaveText(`${shown(left, "quantity")} ft`);

        // Cole may not see the roll's cost, so the cost of goods is read from the books: up, and only there.
        const tb = await trialBalance(grace.request);
        const goods = movedBy(t3, tb, "cost_of_goods_sold");
        expect(dec(goods).gt(0), "the cut posts its cost of goods").toBe(true);
        expectLedgerMoved(t3, tb, { cost_of_goods_sold: goods, inventory: dec(goods).negated() });
        return { t4: tb, cost: goods, rollNumber: parent.rollNumber };
      });

      const paidRest = await flowTest.step("5. Grace records the final payment; it counts at once", async () => {
        const { page } = grace;
        await page.goto(`/sales/invoices/${invoice.id}`);
        await page.getByRole("button", { name: "Record payment", exact: true }).click();
        await expect(
          page.getByRole("dialog", { name: "Record payment" }).getByLabel("Amount", { exact: true }),
        ).toHaveValue(rest);
        // No clean-up: it is confirmed at once, and voiding it would post entries after a passing run.
        const payment = await savePayment(page, invoice.number, finalRef, COUNTS);
        expect(payment.kind).toBe("payment");
        expect(payment.amount).toBe(rest);
        await expect(invoicePills(page)).toHaveText(["Paid"]);
        return payment;
      });

      const t6 = await flowTest.step(
        "6. the final payment posts; Priya sees Paid, and both are in Payments received",
        async () => {
          const tb = await trialBalance(grace.request);
          expectLedgerMoved(t4, tb, { [CASH]: rest, accounts_receivable: dec(rest).negated() });
          expect(toVerify(await notifications(grace.request), invoice.id), "still no payment.to_verify note").toBe(0);
          await priya.page.reload();
          await expect(invoicePills(priya.page)).toHaveText(["Paid"]);

          const { report, table } = await paymentsReceived(grace.page, customerName);
          for (const [reference, payment] of [
            [depositRef, paidDeposit],
            [finalRef, paidRest],
          ] as const) {
            expect(rowsWith(report, reference), `Payments received lists ${reference}`).toEqual([
              expect.objectContaining({ number: payment.number, invoice: invoice.number, amount: payment.amount }),
            ]);
            await expect(table.getByRole("row").filter({ hasText: reference })).toContainText(invoice.number);
          }
          return tb;
        },
      );

      const t7 = await flowTest.step("7. Grace voids the deposit (check bounced): Partly paid", async () => {
        const { page } = grace;
        await page.goto(`/sales/invoices/${invoice.id}`);
        await page.getByRole("button", { name: `Void ${paidDeposit.number}`, exact: true }).click();
        const dialog = page.getByRole("dialog", { name: `Void ${paidDeposit.number}` });
        await dialog.getByLabel("Reason").fill("e2e flow: check bounced");
        const voided = waitForAnswer<Payment>(page, "POST", new RegExp(`^/api-proxy/payments/${paidDeposit.id}/void$`));
        await dialog.getByRole("button", { name: "Void payment" }).click();
        expect((await voided).status).toBe("voided");
        await expect(invoicePills(page)).toHaveText(["Partly paid"]);
        const tb = await trialBalance(grace.request);
        expectLedgerMoved(t6, tb, { [CASH]: dec(deposit).negated(), accounts_receivable: deposit });

        const { report, table } = await paymentsReceived(page, customerName);
        expect(rowsWith(report, depositRef), "the voided deposit leaves Payments received").toEqual([]);
        expect(rowsWith(report, finalRef), "the final payment stays").toHaveLength(1);
        await expect(table.getByRole("row").filter({ hasText: finalRef })).toContainText(invoice.number);
        await expect(table.getByRole("row").filter({ hasText: depositRef })).toHaveCount(0);
        return tb;
      });

      await flowTest.step("8. the whole flow in the books", async () => {
        expectLedgerMoved(t0, t7, {
          accounts_receivable: deposit,
          [CASH]: rest,
          sales: dec(invoice.subtotal).negated(),
          sales_tax_payable: dec(invoice.tax).negated(),
          cost_of_goods_sold: cost,
          inventory: dec(cost).negated(),
        });
      });

      await flowTest.step("9. the audit log", async () => {
        await expectAuditRows(
          grace.page,
          invoice.number,
          [
            "Converted quote to invoice",
            "Recorded deposit",
            "Recorded payment",
            stockIssueAction(true, invoice.number, rollNumber),
            "Voided payment",
          ],
          since,
        );
      });
      assertSameCompanyDay(start);
    },
  );
});
