import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { resetAuthState } from "@workspace/db/testing";
import {
  customerCredit,
  dec,
  invoiceLedger,
  moneyString,
  sum,
  type AuditEntry,
  type CompanyAnswer,
  type Contract,
  type Customer,
  type Expense,
  type Invoice,
  type InvoiceAdjustment,
  type Location,
  type Payment,
  type Quote,
  type Refund,
  type Roll,
} from "@workspace/shared";
import type { CommissionData, StockHold } from "@/lib/api/contract";
import { strippableNames } from "../../../../api/test/support/strippable";
import { ACCOUNTANT_EMAIL, EMPLOYEE_EMAIL, HR_EMAIL, OWNER_EMAIL, SALES_EMAIL, WAREHOUSE_EMAIL } from "../accounts";
import { openBusinessReport, openMyPortal, postAs, readAs } from "../flows/checks";
import { choose, companyToday, flowTest, runId, waitForAnswer, type Persona } from "../flows/kit";
import { assertThrowawayDb, checkOnly } from "./opt-in";
import {
  noteCoverage,
  openAndSettle,
  openScreen,
  settle,
  signInFresh,
  watchBodies,
  watchProxy,
  type ProxyLog,
} from "./page-walk";

/** Everyone the walk signs in; their sign-in state is reset before each sign-in and after the walk. */
const WALKERS = [OWNER_EMAIL, HR_EMAIL, SALES_EMAIL, WAREHOUSE_EMAIL, ACCOUNTANT_EMAIL, EMPLOYEE_EMAIL];

/** Summit's seeded salesperson the Owner offers a share of the commission to (a DemoStore name in api mode). */
const SECOND_REP = "Evan Shaw";

/** The job site of the run's quote: a Denver address, where Summit's sales tax applies. */
const JOB_SITE = { street: "1200 Larimer St", city: "Denver", state: "CO", zip: "80204" };

/** The amount before tax the Owner credits on screen. */
const CREDIT = "50.00";

/** The documents the shared ledger derives an invoice's state and a customer's credit from (ADR 0013). */
interface SalesDocs {
  invoices: Invoice[];
  payments: Payment[];
  adjustments: InvoiceAdjustment[];
  refunds: Refund[];
}

/** Reads, as the person, the documents the shared ledger works from. */
async function salesDocs(request: APIRequestContext): Promise<SalesDocs> {
  const [invoices, payments, adjustments, refunds] = await Promise.all([
    readAs<Invoice[]>(request, "/invoices"),
    readAs<Payment[]>(request, "/payments"),
    readAs<InvoiceAdjustment[]>(request, "/invoice-adjustments"),
    readAs<Refund[]>(request, "/refunds"),
  ]);
  return { invoices, payments, adjustments, refunds };
}

/** An invoice's derived state and its customer's credit, by the shared ledger over what the API answered. */
function derived(docs: SalesDocs, invoice: Invoice) {
  const today = companyToday();
  const own = docs.invoices.filter((row) => row.customerId === invoice.customerId);
  const ledgers = new Map(own.map((row) => [row.id, invoiceLedger(row, docs, today)]));
  const ledger = ledgers.get(invoice.id);
  if (!ledger) throw new Error(`GET /invoices doesn't list ${invoice.number}`);
  const credit = customerCredit(invoice.customerId, docs.invoices, ledgers, docs.adjustments, docs.refunds);
  return { ledger, credit: moneyString(credit) };
}

/**
 * Leaves the run's invoice in a final state through the product's own route: what is left before
 * tax goes on one more credit note, so the balance reaches 0 and, since a note settles its own
 * invoice first, the customer keeps no credit. Safe to repeat: with nothing left the API answers 400.
 */
async function creditTheRest(request: APIRequestContext, invoice: Invoice): Promise<APIResponse> {
  const invoices = await readAs<Invoice[]>(request, "/invoices");
  const notes = invoices.filter((row) => row.creditForInvoiceId === invoice.id && !row.voidedAt);
  const rest = moneyString(dec(invoice.subtotal).minus(sum(notes.map((note) => note.subtotal))));
  return request.post(`/api-proxy/invoices/${invoice.id}/credit-notes`, {
    data: { subtotal: rest, reason: "Closing the demo-script walk's invoice" },
  });
}

/** Whether the page asked the API for a route since the log was last cleared. */
function asked(log: ProxyLog, route: string): boolean {
  return log.answers.some((answer) => answer.route === route);
}

/** The MUST_STRIP names in every answer a walk was given, as `<route>: <name>`. */
function strippedNamesSeen(answers: { route: string; body: unknown }[]): string[] {
  return [
    ...new Set(answers.flatMap(({ route, body }) => [...strippableNames(body)].map((name) => `${route}: ${name}`))),
  ].sort();
}

/** The person's own user id, as the session names it (GET /auth/context). */
async function userIdOf(persona: Persona): Promise<string> {
  return (await readAs<{ user: { id: string } }>(persona.request, "/auth/context")).user.id;
}

// No traces: every persona types the seeded password at sign-in, and the check keeps no password
// in its artifacts (ADR 0058, S-7). Playwright allows `trace` only at the top of a file.
flowTest.use({ trace: "off" });

// The demo script on Summit in api mode (whole-product check DS; plan section 5.4; ADR 0058). Each
// step opens its screen as the script's persona, waits for the screen's own /api-proxy read to
// answer 200, and checks the screen is open with its key element; how each page reads its data
// (API, or mixed with DemoStore: gap G5) is noted from page-coverage.json. Step 4 runs on the walk's
// own customer, quote and invoice, made through the proxy and closed by credit notes; no seeded
// document is touched. Steps the cross-module flows cover are cited, not repeated (session log).
// The gaps are pinned as they behave today. Opt-in (`WHOLE_CHECK=1`).
flowTest.describe("the demo script on Summit in api mode (whole-product check DS)", { tag: "@check" }, () => {
  checkOnly();
  flowTest.describe.configure({ timeout: 240_000 });

  flowTest.afterAll(async () => {
    await resetAuthState(assertThrowawayDb().controlUrl, WALKERS);
  });

  flowTest(
    "DS-1, DS-4, DS-6, DS-8, DS-9, DS-13, DS-19 and the Owner's gap G15 and the closed G17, G18 and bell and Outbox",
    async ({ personas }) => {
      const run = runId();
      const startedAt = Date.now();
      const dana = await signInFresh(personas, assertThrowawayDb(), OWNER_EMAIL, "owner");
      const { page } = dana;
      const log = watchProxy(page);

      await flowTest.step("DS-1: the dashboard with Needs attention", async () => {
        await openScreen<Invoice[]>(dana, "/", /^\/api-proxy\/invoices$/);
        await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Needs attention" })).toBeVisible();
      });

      await flowTest.step("DS-4: her own invoice gets a commission split and a partial credit note", async () => {
        const locations = await readAs<Location[]>(dana.request, "/locations");
        const denver = locations.find((location) => location.name === "Denver Central");
        if (!denver) throw new Error("GET /locations has no Denver Central");
        const customer = await postAs<Customer>(dana.request, "/customers", { name: `Demo Script ${run}` });
        const quote = await postAs<Quote>(dana.request, "/quotes", {
          customerId: customer.id,
          locationId: denver.id,
          jobSite: JOB_SITE,
          rooms: [],
          lines: [
            {
              id: "draft-1",
              description: `Design consultation ${run}`,
              category: "service",
              unit: "each",
              quantity: "1",
              unitPrice: "400.00",
              unitCost: "0",
            },
          ],
          depositPct: "0",
          taxOverride: null,
          notes: "",
        });
        const sent = await postAs<Quote>(dana.request, `/quotes/${quote.id}/status`, {
          action: "send",
          expiresAt: "2099-01-01",
        });
        // Accepting names the total the customer saw (ADR 0061, decision 7).
        await postAs<Quote>(dana.request, `/quotes/${quote.id}/status`, {
          action: "accept",
          expectedTotal: sent.total,
        });
        const invoice = await postAs<Invoice>(dana.request, `/quotes/${quote.id}/invoice`);
        personas.onCleanup("credit the rest of the walk's invoice", () => creditTheRest(dana.request, invoice));

        await openScreen<Invoice[]>(dana, `/sales/invoices/${invoice.id}`, /^\/api-proxy\/invoices$/);
        await expect(page.getByText(invoice.number).first()).toBeVisible();

        // Finding F-t closed (2026-11-20): the dialog's people come from GET /company, so a share with
        // a second rep saves under the API's own id.
        const people = (await readAs<CompanyAnswer>(dana.request, "/company")).people;
        const second = people.find((person) => person.name === SECOND_REP);
        expect(second, `${SECOND_REP} is in the company's directory`).toBeDefined();
        await page.getByRole("button", { name: "Update status" }).click();
        await page.getByRole("menuitem", { name: "Commission split" }).click();
        const split = page.getByRole("dialog", { name: `Commission split on ${invoice.number}` });
        await choose(page, split.getByLabel("Share with"), SECOND_REP);
        const saved = waitForAnswer<Invoice>(page, "PUT", /^\/api-proxy\/invoices\/[^/]+\/commission-split$/);
        await split.getByRole("button", { name: "Save split" }).click();
        await saved;
        await expect(split).toBeHidden();
        const afterSplit = (await readAs<Invoice[]>(dana.request, "/invoices")).find((row) => row.id === invoice.id);
        const shares = afterSplit?.commissionSplit ?? [];
        expect(shares.map((share) => share.userId)).toContain(second?.id);
        expect(shares.reduce((total, share) => total.plus(share.pct), dec(0)).toString()).toBe("100");

        await page.getByRole("button", { name: "Update status" }).click();
        await page.getByRole("menuitem", { name: "Issue credit note" }).click();
        const dialog = page.getByRole("dialog", { name: `Issue a credit note for ${invoice.number}` });
        await dialog.getByLabel("Amount before tax").fill(CREDIT);
        await dialog.getByLabel("Reason").fill(`Demo script ${run}`);
        const issued = waitForAnswer<Invoice>(page, "POST", /^\/api-proxy\/invoices\/[^/]+\/credit-notes$/);
        await dialog.getByRole("button", { name: "Issue credit note" }).click();
        const note = await issued;
        await expect(page.getByText(`Credit note ${note.number} issued`)).toBeVisible();

        const tax = moneyString(dec(invoice.tax).times(CREDIT).dividedBy(invoice.subtotal));
        expect(note).toMatchObject({
          isReturn: true,
          creditForInvoiceId: invoice.id,
          customerId: customer.id,
          subtotal: CREDIT,
          tax,
          total: moneyString(dec(CREDIT).plus(tax)),
        });
        // The note settles its own invoice first (ADR 0039), so the balance drops and no credit is left.
        const after = derived(await salesDocs(dana.request), invoice);
        expect(after.ledger).toMatchObject({
          credited: note.total,
          balance: moneyString(dec(invoice.total).minus(note.total)),
        });
        expect(after.credit).toBe("0.00");

        expect((await creditTheRest(dana.request, invoice)).status(), "the rest credited").toBe(201);
        const closed = derived(await salesDocs(dana.request), invoice);
        expect(closed.ledger).toMatchObject({ balance: "0.00", credited: invoice.total });
        expect(closed.credit).toBe("0.00");
      });

      await flowTest.step("DS-6: Customers and receivables", async () => {
        await openScreen<Customer[]>(dana, "/sales?view=customers", /^\/api-proxy\/customers$/);
        await expect(page.getByRole("tab", { name: "Customers and receivables", selected: true })).toBeVisible();
        await expect(page.getByText("Receivables", { exact: true }).first()).toBeVisible();
      });

      await flowTest.step("DS-8: the contracts register, CTR-1001 read only, CTR-1005 awaiting signature", async () => {
        const contracts = await openScreen<Contract[]>(dana, "/contracts", /^\/api-proxy\/contracts$/);
        // A customer project shows its schedule, change orders and lien waivers; a subcontract its insurance.
        for (const [number, panels] of [
          ["CTR-1001", ["Schedule of values", "Change orders", "Lien waivers"]],
          ["CTR-1005", ["Schedule of values", "Insurance"]],
        ] as const) {
          const contract = contracts.find((row) => row.number === number);
          if (!contract) throw new Error(`GET /contracts has no ${number}`);
          await page.goto("/contracts");
          await settle(page);
          if (number === "CTR-1005")
            await expect(page.getByRole("row").filter({ hasText: number })).toContainText("Sent for signature");
          await page.getByText(number).first().click();
          await expect(page).toHaveURL(new RegExp(`/contracts/${contract.id}$`));
          expect(await settle(page)).toBe("open");
          noteCoverage(`/contracts/${contract.id}`);
          for (const panel of panels)
            await expect(page.getByRole("heading", { name: panel, exact: true })).toBeVisible();
        }
      });

      await flowTest.step("DS-9: expenses, and Manage recurring opened read only", async () => {
        await openScreen<Expense[]>(dana, "/finance?view=expenses", /^\/api-proxy\/expenses$/);
        log.clear();
        await page.getByRole("button", { name: "Manage recurring" }).click();
        await expect(page.getByRole("dialog", { name: "Recurring expenses" })).toBeVisible();
        await page.keyboard.press("Escape");
        expect(log.writes).toEqual([]);
      });

      await flowTest.step("DS-13: Sales → Team", async () => {
        await openScreen(dana, "/sales?view=team", /^\/api-proxy\/commission-totals$/);
        await expect(page.getByRole("tab", { name: "Team", selected: true })).toBeVisible();
      });

      await flowTest.step("DS-19: the audit log holds the walk's credit note", async () => {
        const audit = await openScreen<AuditEntry[]>(dana, "/settings/audit", /^\/api-proxy\/audit$/);
        // `at` is the UTC minute with no zone mark (finding F-r), so it is read as UTC.
        const since = Math.floor(startedAt / 60_000) * 60_000;
        const ours = audit.filter(
          (entry) => entry.action === "Issued credit note" && Date.parse(`${entry.at}Z`) >= since,
        );
        expect(ours.length, "the walk's two credit notes are audited").toBeGreaterThanOrEqual(2);
        await expect(page.getByText("Issued credit note").first()).toBeVisible();
      });

      await flowTest.step(
        "DS-17 and DS-18: Number format and Branding read the API (G17 and G18 closed; their saves are settings.spec.ts E1 and settings-branding.spec.ts, which restore Summit)",
        async () => {
          for (const href of ["/settings/number-format", "/settings/branding"]) {
            log.clear();
            expect(await openAndSettle(page, href)).toBe("open");
            noteCoverage(href);
            expect(asked(log, "GET /settings"), `${href} read GET /settings`).toBe(true);
          }
        },
      );

      await flowTest.step("DS-GB: the Outbox and the bell read the API (GB closed, PR #65)", async () => {
        log.clear();
        expect(await openAndSettle(page, "/outbox")).toBe("open");
        noteCoverage("/outbox");
        await page.getByRole("button", { name: /^Notifications/ }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        expect(asked(log, "GET /outbox"), "the Outbox screen asked GET /outbox").toBe(true);
        expect(asked(log, "GET /notifications"), "the bell asked GET /notifications").toBe(true);
        await page.keyboard.press("Escape");
      });

      await flowTest.step(
        "DS-15: View as is not offered in api mode, since the API answers only for the signed-in person (G15 closed by PR #50)",
        async () => {
          await page.goto("/");
          await settle(page);
          await expect(page.getByRole("navigation").first()).toBeVisible();
          await expect(page.getByRole("button", { name: "View as", exact: true })).toHaveCount(0);
        },
      );
    },
  );

  flowTest("DS-12: HR → Pay periods and Commissions, read only (Tamara)", async ({ personas }) => {
    const tamara = await signInFresh(personas, assertThrowawayDb(), HR_EMAIL, "hr");
    const { page } = tamara;
    const log = watchProxy(page);
    await openScreen(tamara, "/hr/pay-periods", /^\/api-proxy\/pay-periods$/);
    await expect(page.getByRole("tab", { name: "Gross pay", selected: true })).toBeVisible();
    await openScreen<CommissionData>(tamara, "/hr/commissions", /^\/api-proxy\/commissions$/);
    for (const tab of ["Plans", "People on plans", "Statements"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByRole("tab", { name: tab, exact: true, selected: true })).toBeVisible();
    }
    // Read only: opening Pay periods may open the current period (the page-gate matrix's reviewed write).
    expect(log.writes.filter((write) => write !== "POST /pay-periods")).toEqual([]);
  });

  flowTest(
    "DS-P1: a salesperson sees her own customers and quotes, with no cost or margin (Priya)",
    async ({ personas }) => {
      const priya = await signInFresh(personas, assertThrowawayDb(), SALES_EMAIL, "sales");
      const bodies = watchBodies(priya.page);
      const me = await userIdOf(priya);
      const customers = await openScreen<Customer[]>(priya, "/sales?view=customers", /^\/api-proxy\/customers$/);
      const quotes = await openScreen<Quote[]>(priya, "/sales?view=quotes", /^\/api-proxy\/quotes$/);
      expect(customers.length).toBeGreaterThan(0);
      expect(quotes.length).toBeGreaterThan(0);
      expect(customers.filter((customer) => customer.salesRepId !== me)).toEqual([]);
      expect(quotes.filter((quote) => quote.salesRepId !== me)).toEqual([]);
      expect(strippedNamesSeen(await bodies.read())).toEqual([]);
    },
  );

  flowTest("DS-P2: the warehouse sees rolls and Ready to cut, with no cost (Cole)", async ({ personas }) => {
    const cole = await signInFresh(personas, assertThrowawayDb(), WAREHOUSE_EMAIL, "warehouse");
    const bodies = watchBodies(cole.page);
    const rolls = await openScreen<Roll[]>(cole, "/inventory?view=rolls", /^\/api-proxy\/rolls$/);
    await expect(cole.page.getByRole("tab", { name: "Rolls and remnants", selected: true })).toBeVisible();
    await openScreen<StockHold[]>(cole, "/inventory?view=ready", /^\/api-proxy\/stock-holds$/);
    await expect(cole.page.getByRole("tab", { name: "Ready to cut", selected: true })).toBeVisible();
    expect(rolls.length).toBeGreaterThan(0);
    expect(strippedNamesSeen(await bodies.read())).toEqual([]);
  });

  flowTest("DS-P3: the bookkeeper sees expenses to approve and the Business report (Grace)", async ({ personas }) => {
    const grace = await signInFresh(personas, assertThrowawayDb(), ACCOUNTANT_EMAIL, "accountant");
    const { page } = grace;
    const expenses = await openScreen<Expense[]>(grace, "/finance?view=expenses", /^\/api-proxy\/expenses$/);
    const waiting = expenses.find((expense) => expense.status === "pending");
    if (!waiting) throw new Error("GET /expenses holds no expense waiting for approval");
    await page.getByPlaceholder("Search expenses").fill(waiting.number);
    await expect(page.getByRole("row").filter({ hasText: waiting.number })).toContainText("Waiting for approval");
    await openBusinessReport(page);
    expect(await settle(page)).toBe("open");
    noteCoverage("/reports");
  });

  flowTest("DS-P4: an employee's My portal (Bri)", async ({ personas }) => {
    const bri = await signInFresh(personas, assertThrowawayDb(), EMPLOYEE_EMAIL, "employee");
    const portal = await openMyPortal(bri.page, "/my");
    expect(await settle(bri.page)).toBe("open");
    noteCoverage("/my");
    expect(portal.employee).not.toBeNull();
    // The overview's card, not the portal's tab of the same name.
    await expect(bri.page.getByRole("main").getByRole("link", { name: /^My timesheet \S/ })).toBeVisible();
  });
});
