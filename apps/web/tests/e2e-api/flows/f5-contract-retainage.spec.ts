import { expect, type Locator, type Page } from "@playwright/test";
import {
  dec,
  sum,
  type Contract,
  type ContractBilling,
  type Customer,
  type Invoice,
  type Payment,
} from "@workspace/shared";
import { FLOW_TAG } from "../../e2e/helpers";
import { OWNER_EMAIL } from "../accounts";
import {
  expectAuditRows,
  expectLedgerMoved,
  invoicePills,
  savePayment,
  trialBalance,
  type PaymentOutcome,
} from "./checks";
import {
  assertSameCompanyDay,
  choose,
  companyToday,
  flowTest,
  resetAuthAround,
  runId,
  shown,
  waitForAnswer,
} from "./kit";
import { CASH } from "./ledger";

/**
 * The product bug that stops this flow in step 1 (session log 2026-11-16-0200, "For STATUS", B4; B2
 * is fixed, session log 2026-11-16-1651). Until it is fixed the flow is `fixme`, written to the
 * behaviour the spec asks for; a throwaway run that worked around it passed every later step
 * (session log 2026-11-16-0200, stage 5).
 */
const BLOCKED_BY = [
  {
    type: "issue",
    description:
      "api mode: the contract form sends the signed-in person's branch as the DemoStore user has it (R1), such as " +
      '"sm-br-denver", and POST /contracts refuses it with 400 "Invalid UUID" (`branchId` is a UUID), so nobody with ' +
      "a branch can save a new contract (contract-form-dialog.tsx `branchId: user.branchId`; api-methods.ts " +
      "`contractBody`). The API files a new contract under its creator's own branch anyway (contracts.service.ts " +
      "`newBranch`). B4, STATUS follow-up.",
  },
];

/** Every payment the Owner records here counts at once (payments.service.ts). */
const COUNTS: PaymentOutcome = {
  status: "confirmed",
  why: "the Owner's scope is all and the amount is under Summit's 1,000.00 approval threshold, so it counts when recorded",
};

/** A figure in the contract's Money panel (Invoiced, Paid, Retained, ...). */
function figure(page: Page, label: string): Locator {
  return page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
}

/** The invoice in the page's GET /invoices answer that a billing raised. */
function invoiceOf(invoices: readonly Invoice[], billing: ContractBilling): Invoice {
  const found = invoices.find((invoice) => invoice.id === billing.invoiceId);
  if (!found) throw new Error(`The contract page was not given billing ${billing.number}'s invoice.`);
  return found;
}

/** Pays the open invoice's whole balance from its page; it counts at once, so the invoice reads Paid. */
async function payInvoice(page: Page, invoice: Invoice, reference: string): Promise<Payment> {
  await expect(page).toHaveURL(new RegExp(`/sales/invoices/${invoice.id}$`));
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Record payment" }).getByLabel("Amount", { exact: true }),
    "the sheet offers the whole balance",
  ).toHaveValue(invoice.total);
  const payment = await savePayment(page, invoice.number, reference, COUNTS);
  expect(payment.amount).toBe(invoice.total);
  await expect(invoicePills(page)).toHaveText(["Paid"]);
  return payment;
}

/**
 * Flow F5 (mirrors demo flow G3-5; session log 2026-11-16-0200, "The seven flows"): the Owner
 * writes a customer contract with a milestone line and 5 % retainage, sends it and records its
 * simulated signature, posts the milestone (its invoice holds the retainage back), takes the
 * payment, marks the contract completed, releases the retainage on its own invoice and takes that
 * payment too. The ledger after each posting, the contract's figures and the audit log are checked
 * from the answers the screens got. It registers no clean-ups yet: while it is `fixme` it never
 * runs, so none could be proved. Once B4 is fixed, register what a stopped run must undo
 * (the contract and what it billed) with `personas.onCleanup`, as the other flows do.
 */
flowTest.describe("flow F5: contract billing with retainage, and its release", () => {
  resetAuthAround([OWNER_EMAIL]);

  flowTest.fixme(
    "a signed contract's milestone billing holds retainage back, is paid, and the released retainage is billed and paid",
    { tag: FLOW_TAG, annotation: BLOCKED_BY },
    async ({ personas }) => {
      flowTest.setTimeout(120_000);
      const run = runId();
      const start = companyToday();
      const since = Date.now();
      const customerName = `E2E Flow Contract Customer ${run}`;
      const title = `e2e-flow contract ${run}`;
      const owner = await personas.open(OWNER_EMAIL, { mfa: true });
      const { page } = owner;

      const t0 = await flowTest.step("0. the books before", () => trialBalance(owner.request));

      const contract = await flowTest.step(
        "1. the Owner writes the contract, sends it and records the signature",
        async () => {
          // Setup, not the journey: the contract form picks from the customers the API serves.
          const added = await owner.request.post("/api-proxy/customers", { data: { name: customerName } });
          expect(added.ok(), `POST /customers answered ${added.status()}: ${await added.text()}`).toBe(true);
          expect(((await added.json()) as Customer).name).toBe(customerName);

          await page.goto("/contracts");
          await page.getByRole("button", { name: "New contract" }).click();
          const form = page.getByRole("dialog", { name: "New contract" });
          await choose(page, form.getByLabel("With", { exact: true }), "Customer contract");
          await choose(page, form.getByLabel("Customer", { exact: true }), customerName);
          await choose(page, form.getByLabel("Type", { exact: true }), "Project contract");
          await form.getByLabel("Title", { exact: true }).fill(title);
          await form.getByLabel("Job site street", { exact: true }).fill(`${run} Contract Way`);
          await form.getByLabel("Job site city", { exact: true }).fill("Colorado Springs");
          await choose(page, form.getByLabel("Job site state", { exact: true }), "Colorado");
          await form.getByLabel("Job site ZIP", { exact: true }).fill("80903");
          await form.getByLabel("Retainage %", { exact: true }).fill("5");
          await form.getByLabel("Description", { exact: true }).fill("Final inspection");
          await choose(page, form.getByLabel("Billing", { exact: true }), "Bill as a milestone");
          await form.getByLabel("Value", { exact: true }).fill("800");
          const saved = waitForAnswer<Contract>(page, "POST", /^\/api-proxy\/contracts$/);
          await form.getByRole("button", { name: "Save contract" }).click();
          const made = await saved;
          await expect(page).toHaveURL(new RegExp(`/contracts/${made.id}$`));
          await expect(page.getByRole("heading", { level: 1, name: `${made.number}, ${title}` })).toBeVisible();

          const sent = waitForAnswer<Contract>(page, "POST", new RegExp(`^/api-proxy/contracts/${made.id}/send$`));
          await page.getByRole("button", { name: "Send for signature" }).click();
          expect((await sent).status).toBe("sent");
          await expect(page.getByText("Sent for signature", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Record signature" }).click();
          const sign = page.getByRole("dialog", { name: `Record signature on ${made.number}` });
          const signed = waitForAnswer<Contract>(page, "POST", new RegExp(`^/api-proxy/contracts/${made.id}/sign$`));
          await sign.getByRole("button", { name: "Record signature" }).click();
          expect((await signed).status, "the signature makes the contract active").toBe("active");
          await expect(sign).toBeHidden();
          await expect(page.getByText(/^Simulated signature: /)).toBeVisible();
          return made;
        },
      );

      const { billing, invoice } = await flowTest.step("2. Billing 1: the milestone, with 5 % held back", async () => {
        await page.getByRole("button", { name: "New billing" }).click();
        const dialog = page.getByRole("dialog", { name: `New billing on ${contract.number}` });
        await dialog.getByRole("checkbox", { name: "L1 complete" }).check();
        await expect(dialog.getByText(/^This billing:/)).toContainText(`of which ${shown("40", "money")}`);
        const posted = waitForAnswer<ContractBilling>(
          page,
          "POST",
          new RegExp(`^/api-proxy/contracts/${contract.id}/billings$`),
        );
        const reread = waitForAnswer<Invoice[]>(page, "GET", /^\/api-proxy\/invoices$/);
        await dialog.getByRole("button", { name: "Post billing" }).click();
        const made = await posted;
        await expect(page.getByText(`Billing ${made.number} posted`, { exact: true })).toBeVisible();
        expect(made.number).toBe(1);
        const raised = invoiceOf(await reread, made);
        expect(dec(raised.subtotal).eq(800), `the milestone bills 800.00, not ${raised.subtotal}`).toBe(true);
        expect(dec(raised.retainageWithheld ?? "0").eq(40), "5 % of 800.00 is held back").toBe(true);
        await expect(
          page.getByRole("row", { name: /^Billing 1,/ }).getByRole("link", { name: raised.number, exact: true }),
        ).toBeVisible();
        return { billing: made, invoice: raised };
      });

      const t1 = await flowTest.step(
        "2. the ledger: receivable, retainage receivable, sales and sales tax",
        async () => {
          const tb = await trialBalance(owner.request);
          // contract-postings.ts contractInvoicePosting (contracts.md rule 12): total = subtotal + tax − withheld.
          expectLedgerMoved(t0, tb, {
            accounts_receivable: invoice.total,
            retainage_receivable: invoice.retainageWithheld ?? "0",
            sales: dec(invoice.subtotal).negated(),
            sales_tax_payable: dec(invoice.tax).negated(),
          });
          return tb;
        },
      );

      const t2 = await flowTest.step("3. the Owner pays Billing 1's invoice; 40.00 stays retained", async () => {
        await page
          .getByRole("row", { name: /^Billing 1,/ })
          .getByRole("link", { name: invoice.number, exact: true })
          .click();
        await payInvoice(page, invoice, `E2E-F5-PAY-${run}`);
        const tb = await trialBalance(owner.request);
        expectLedgerMoved(t1, tb, { [CASH]: invoice.total, accounts_receivable: dec(invoice.total).negated() });

        await page.goto(`/contracts/${contract.id}`);
        await expect(figure(page, "Invoiced")).toHaveText(shown(billing.gross, "money"));
        await expect(figure(page, "Paid")).toHaveText(shown(invoice.total, "money"));
        await expect(figure(page, "Retained")).toHaveText(shown(billing.withheld, "money"));
        return tb;
      });

      const { release, released } = await flowTest.step(
        "4. the Owner marks it completed and releases the retainage",
        async () => {
          const completed = waitForAnswer<Contract>(
            page,
            "POST",
            new RegExp(`^/api-proxy/contracts/${contract.id}/complete$`),
          );
          await page.getByRole("button", { name: "Mark completed" }).click();
          expect((await completed).status).toBe("completed");
          await expect(page.getByText("Marked completed", { exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Mark completed" })).toBeHidden();

          await page.getByRole("button", { name: "Release retainage" }).click();
          const dialog = page.getByRole("dialog", { name: `Release retainage on ${contract.number}` });
          await expect(dialog.getByLabel("Amount", { exact: true }), "all that is held is offered").toHaveValue(
            billing.withheld,
          );
          const posted = waitForAnswer<ContractBilling>(
            page,
            "POST",
            new RegExp(`^/api-proxy/contracts/${contract.id}/retainage-releases$`),
          );
          const reread = waitForAnswer<Invoice[]>(page, "GET", /^\/api-proxy\/invoices$/);
          await dialog.getByRole("button", { name: "Release retainage" }).click();
          const made = await posted;
          await expect(page.getByText("Retainage released", { exact: true })).toBeVisible();
          expect(made.kind).toBe("release");
          expect(made.released).toBe(billing.withheld);
          const raised = invoiceOf(await reread, made);
          await expect(
            page.getByRole("row", { name: /^Release,/ }).getByRole("link", { name: raised.number, exact: true }),
          ).toBeVisible();
          return { release: made, released: raised };
        },
      );

      const t3 = await flowTest.step("4. the ledger: the retainage moves back to receivables", async () => {
        const tb = await trialBalance(owner.request);
        expectLedgerMoved(t2, tb, {
          accounts_receivable: released.total,
          retainage_receivable: dec(released.retainageReleased ?? "0").negated(),
          sales: dec(released.subtotal).negated(),
          sales_tax_payable: dec(released.tax).negated(),
        });
        expect(dec(released.retainageReleased ?? "0").eq(release.released)).toBe(true);
        return tb;
      });

      const t4 = await flowTest.step("5. the Owner pays the release invoice", async () => {
        await page
          .getByRole("row", { name: /^Release,/ })
          .getByRole("link", { name: released.number, exact: true })
          .click();
        await payInvoice(page, released, `E2E-F5-REL-${run}`);
        const tb = await trialBalance(owner.request);
        expectLedgerMoved(t3, tb, { [CASH]: released.total, accounts_receivable: dec(released.total).negated() });
        return tb;
      });

      await flowTest.step("6. the whole flow: receivables and retainage back to zero, nothing retained", async () => {
        expectLedgerMoved(t0, t4, {
          [CASH]: sum([invoice.total, released.total]),
          sales: sum([invoice.subtotal, released.subtotal]).negated(),
          sales_tax_payable: sum([invoice.tax, released.tax]).negated(),
        });
        await page.goto(`/contracts/${contract.id}`);
        await expect(figure(page, "Retained")).toHaveText(shown("0", "money"));
        await expect(figure(page, "Paid")).toHaveText(shown(sum([invoice.total, released.total]), "money"));
      });

      await flowTest.step("7. the audit log", async () => {
        await expectAuditRows(
          page,
          `${contract.number}, ${title}`,
          [
            "Added contract",
            "Sent contract for signature",
            "Recorded simulated signature",
            "Posted contract billing",
            "Completed contract",
            "Released retainage",
          ],
          since,
        );
        for (const raised of [invoice, released])
          await expectAuditRows(
            page,
            raised.number,
            ["Created invoice for a contract billing", "Recorded payment"],
            since,
          );
      });
      assertSameCompanyDay(start);
    },
  );
});
