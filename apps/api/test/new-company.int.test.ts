import { DiscoveryModule } from "@nestjs/core";
import { auditLog, employees, invoices, meetings, payPeriods, userProfiles } from "@workspace/db/company";
import { userInvitations } from "@workspace/db/control";
import {
  addDays,
  API_LOCALIZATION_TABS,
  API_SETTINGS_SECTIONS,
  dec,
  DEFAULT_ACCOUNTS,
  invoiceLedger,
  planActions,
  PRODUCT_ROLES,
  type AuditEntry,
  type CompanyAnswer,
  type ContractBilling,
  type ContractorPayment,
  type Customer,
  type Employee,
  type Expense,
  type ImportBatchSummary,
  type ImportPreview,
  type ImportResult,
  type Meeting,
  type PayPeriod,
  type Report,
  type ReportOptions,
  type Role,
  type Supplier,
  type SupplierContact,
  type User,
} from "@workspace/shared";
import { asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "./support/company-day";
import { AuthHarness, isUuidV7, PASSWORD, SUMMIT_ID } from "./auth-harness";
import { BOOTSTRAP_ZONE, PAY_SCHEDULE, TILE } from "./support/company-bootstrap";
import { freshCalls, type LocalTime } from "./support/fresh-calls";
import { acceptInvitation, invitationTokenFor, inviteProvisionedOwner, provisionedOwner } from "./support/fresh-owner";
import { jsonNodes } from "./support/strippable";
import { balanceOf, entriesBySource, trialBalanceProblems } from "./support/ledger-read";
import { MoneyApi, moneyCalls, type Answer, type Call, type QuoteLine } from "./support/money-actions";
import {
  enterBill,
  moveMethod,
  paySupplier,
  payContractor,
  purchaseOrder,
  quotedInvoice,
  receive,
  recordExpense,
  recordPayment,
  saveBanks,
  tileCartons,
  tileLine,
  voidExpense,
  voidPayment,
  voidSupplierPayment,
} from "./support/money-ops";
import { startMoneyRun, type MoneyRun } from "./support/money-run";
import { idsFound, recordIds } from "./support/record-ids";
import { hasPathParameter, isWrite, routeCatalog } from "./support/route-catalog";
import { DOCUMENT_WRITES, QUERY_FOR } from "./support/route-lists";
import { enrolled, stepUp, type EnrolledPerson } from "./support/sign-in";
import { importFile, type ImportRow } from "./support/summit-tables";

/** A refusal as the API words it: status, code and message (MF-6). */
interface Expected {
  status: number;
  code: string;
  message: RegExp;
}

/** One write tried on a posted record (MI-7): the route it exercises, the call, who sends it, and the refusal. */
interface Attempt {
  route: string;
  call: Call;
  cookie: string;
  refused: Expected;
}

/** A 400 with the rule's words (docs/api-contract.md, ErrorBody). */
const invalid = (message: RegExp): Expected => ({ status: 400, code: "invalid_request", message });

/**
 * The money scenarios of the whole-product check (piece 2, part 2), each on a company of its own,
 * provisioned and bootstrapped like the money-integrity run: contracts and retainage (MI-4),
 * payroll (MI-5), immutability of posted documents (MI-7), a closed period (MI-8) and bank
 * accounts (MI-9). After each step every entry balances, the trial balance is zero and every
 * answer's money is a decimal string; at each checkpoint the control accounts equal the documents
 * (E3 to E12) and the journal matches them (E14). MI-6 (commissions) is covered by
 * commissions.int.test.ts's trial-balance deltas: its setup can't be reused here in under 60 lines.
 */
/**
 * One harness for the whole file (plan SH-2): Summit is seeded once, and every company of both
 * describes is provisioned on it. `DiscoveryModule` lets FA read the route catalog.
 */
const harness = new AuthHarness();
const api = new MoneyApi(harness);

beforeAll(async () => {
  await harness.start([DiscoveryModule]);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

describe("money scenarios on new companies (whole-product check; needs the local PostgreSQL)", () => {
  const runs: MoneyRun[] = [];
  /** Routes MI-4, MI-5 and MI-7 tried on posted records, for the coverage check at the end. */
  const tried = new Set<string>();

  afterAll(async () => {
    for (const run of runs) await run.db.close();
  });

  async function newRun(name: string): Promise<MoneyRun> {
    const run = await startMoneyRun(harness, api, name, 0);
    runs.push(run);
    return run;
  }

  /** Tries each write and expects its exact refusal (status, code and words); nothing posts. */
  async function expectRefusals(run: MoneyRun, attempts: readonly Attempt[]): Promise<void> {
    const before = (await entriesBySource(run.db.db)).length;
    const wrong: string[] = [];
    for (const attempt of attempts) {
      tried.add(attempt.route);
      const answer = await api.send(attempt.call, attempt.cookie);
      const body = answer.body as { code?: string; message?: string };
      const { status, code, message } = attempt.refused;
      if (answer.status !== status || body.code !== code || !message.test(body.message ?? "")) {
        wrong.push(`${attempt.route}: ${answer.status} ${JSON.stringify(answer.body)}`);
      }
    }
    expect(wrong, "writes on posted records answered otherwise").toEqual([]);
    expect((await entriesBySource(run.db.db)).length, "refused writes posted something").toBe(before);
  }

  /** A customer made by Sales and given a job site by the Owner. */
  async function customer(run: MoneyRun, name: string): Promise<string> {
    const made = await run.act<{ id: string }>(201, moneyCalls.customer(name), run.actors.sales);
    await run.act(200, moneyCalls.customerSite(made.id, name), run.owner);
    return made.id;
  }

  /** A supplier made by Purchasing. */
  async function supplier(run: MoneyRun, name: string, type: "goods" | "services"): Promise<string> {
    return (await run.act<{ id: string }>(201, moneyCalls.supplier(name, type), run.actors.purchasing)).id;
  }

  /** A contract drafted, sent and signed by the Owner, and its line ids by code. */
  async function activeContract(
    run: MoneyRun,
    input: Parameters<typeof moneyCalls.contract>[0],
  ): Promise<{ id: string; lines: Map<string, string> }> {
    const made = await run.act<{ id: string }>(201, moneyCalls.contract(input), run.owner);
    await run.act(201, moneyCalls.contractSend(made.id), run.owner);
    await run.act(201, moneyCalls.contractSign(made.id), run.owner);
    const lines = await api.read<{ id: string; code: string; contractId: string }[]>("/contract-lines", run.owner);
    return { id: made.id, lines: new Map(lines.filter((l) => l.contractId === made.id).map((l) => [l.code, l.id])) };
  }

  it("MI-4: contract billings, retainage and its release, a void, and a subcontract paid through its bill", async () => {
    const run = await newRun("mi4");
    let customerId = "";
    let subcontractor = "";
    await run.step("a customer by Sales and a subcontractor by Purchasing", async () => {
      customerId = await customer(run, "Dana Field");
      subcontractor = await supplier(run, "Crew Tile Co", "services");
    });
    let job = { id: "", lines: new Map<string, string>() };
    await run.step(
      "a customer contract at 10 % retainage: A1 material 1,000.00 and B1 labor 500.00, signed",
      async () => {
        job = await activeContract(run, {
          direction: "customer",
          customerId,
          supplierId: null,
          branchId: run.places.branches[0],
          locationId: run.places.warehouses[0],
          retainagePct: "10",
          lines: [
            { code: "A1", category: "material", scheduledValue: "1000.00", estimatedCost: "600.00" },
            { code: "B1", category: "labor", scheduledValue: "500.00", estimatedCost: "300.00" },
          ],
        });
      },
    );
    const a1 = job.lines.get("A1")!;
    const b1 = job.lines.get("B1")!;
    let first: ContractBilling | undefined;
    await run.step("billing 1: A1 400.00 completed", async () => {
      first = await run.act<ContractBilling>(
        201,
        moneyCalls.contractBilling(job.id, run.today, [[a1, "400.00"]]),
        run.owner,
      );
    });
    await run.checkAll("after billing 1");
    await run.step("billing 1's invoice is part paid in cash by the Owner", async () => {
      await recordPayment(run, first!.invoiceId!, "100.00", "cash", "owner");
    });
    const firstInvoice = run.books.invoices.find((invoice) => invoice.id === first!.invoiceId)!;
    expect(invoiceLedger(firstInvoice, run.books, run.today).state, "billing 1's invoice state as derived").toBe(
      "partial",
    );
    await run.step("billing 2: A1 700.00 and B1 250.00 completed", async () => {
      await run.act(
        201,
        moneyCalls.contractBilling(job.id, run.today, [
          [a1, "700.00"],
          [b1, "250.00"],
        ]),
        run.owner,
      );
    });
    await run.checkAll("after billing 2");
    let release: ContractBilling | undefined;
    await run.step("50.00 of retainage released on its own invoice", async () => {
      release = await run.act<ContractBilling>(201, moneyCalls.retainageRelease(job.id, "50.00"), run.owner);
    });
    await run.checkAll("after the release");
    await run.step("the release, the latest billing, is voided", async () => {
      await run.act(201, moneyCalls.contractBillingVoid(release!.id), run.actors.accountant.cookie);
    });
    await run.checkAll("after the void");
    // A lower cumulative figure is refused (contracts.md rule 5), so contractInvoicePosting's
    // negative path can't be reached through the API; only the shared posting tests cover it.
    await expectRefusals(run, [
      {
        route: "POST /contract-billings/:id/void",
        call: moneyCalls.contractBillingVoid(release!.id),
        cookie: run.actors.accountant.cookie,
        refused: invalid(/^This billing is already void\.$/),
      },
      {
        route: "PUT /contracts/:id",
        call: {
          ...moneyCalls.contract({
            direction: "customer",
            customerId,
            supplierId: null,
            branchId: run.places.branches[0],
            locationId: run.places.warehouses[0],
            retainagePct: "5",
            lines: [],
          }),
          verb: "put",
          path: `/contracts/${job.id}`,
        },
        cookie: run.owner,
        refused: invalid(/^Only a draft can be edited\. Use a change order instead\.$/),
      },
    ]);
    const lower = await api.send(moneyCalls.contractBilling(job.id, run.today, [[a1, "600.00"]]), run.owner);
    expect({ status: lower.status, body: lower.body }).toMatchObject({
      status: 400,
      body: { code: "invalid_request", message: expect.stringMatching(/less than zero/) },
    });

    let sub = { id: "", lines: new Map<string, string>() };
    await run.step("a subcontract at 5 % retainage: L1 labor 1,000.00, signed", async () => {
      sub = await activeContract(run, {
        direction: "subcontractor",
        customerId: null,
        supplierId: subcontractor,
        branchId: run.places.branches[0],
        locationId: run.places.warehouses[0],
        retainagePct: "5",
        lines: [{ code: "L1", category: "labor", scheduledValue: "1000.00", estimatedCost: "1000.00" }],
      });
    });
    let subBilling: ContractBilling | undefined;
    await run.step("subcontract billing: L1 600.00 completed, raising a bill", async () => {
      subBilling = await run.act<ContractBilling>(
        201,
        moneyCalls.contractBilling(sub.id, run.today, [[sub.lines.get("L1")!, "600.00"]]),
        run.owner,
      );
    });
    await run.step("the subcontract bill is paid 300.00 in cash by Purchasing", async () => {
      await paySupplier(run, subcontractor, "300.00", "cash", [subBilling!.billId!]);
    });
    await run.step("15.00 of the subcontract's retainage released", async () => {
      await run.act(201, moneyCalls.retainageRelease(sub.id, "15.00"), run.owner);
    });
    await run.checkAll("after the subcontract");
    expect(balanceOf(run.books.trial, "retainage_receivable").gt(0), "retainage is held").toBe(true);
    expect(balanceOf(run.books.trial, "retainage_payable").lt(0), "retainage is owed").toBe(true);
  }, 120_000);

  it("MI-5: a pay run approved, reopened and approved again, with a bonus, and a contractor paid then voided", async () => {
    const run = await newRun("mi5");
    // The last biweekly period that has ended, on Summit's schedule (hr settings).
    expect(PAY_SCHEDULE.frequency).toBe("biweekly");
    let start = PAY_SCHEDULE.anchor;
    while (addDays(start, 14) <= run.today) start = addDays(start, 14);
    const period = { start: addDays(start, -14), end: addDays(start, -1) };
    const people = await run.db.db
      .insert(employees)
      .values([
        {
          name: "Wes Hourly",
          workerType: "w2" as const,
          payType: "hourly" as const,
          payRate: "20.00",
          state: "CO",
          hiredAt: "2024-01-08",
          status: "active" as const,
          flsaStatus: "non_exempt" as const,
          homeLocationId: run.places.warehouses[0],
        },
        {
          name: "Sal Salaried",
          workerType: "w2" as const,
          payType: "salary" as const,
          payRate: "52000.00",
          state: "CO",
          hiredAt: "2024-01-08",
          status: "active" as const,
          flsaStatus: "exempt" as const,
          exemptionBasis: "administrative",
        },
        {
          name: "Cora Contract",
          workerType: "1099" as const,
          payType: "per_job" as const,
          payRate: "60.00",
          state: "CO",
          hiredAt: "2024-01-08",
          status: "active" as const,
          flsaStatus: "non_exempt" as const,
        },
      ])
      .returning();
    const [wes, , cora] = people;
    // HR must be linked to an employee record to change time or pay; Hal is hired today, so he is
    // in no past run and HR may approve it (separation of duties).
    const [hal] = await run.db.db
      .insert(employees)
      .values({
        name: "Hal HR",
        workerType: "w2" as const,
        payType: "hourly" as const,
        payRate: "25.00",
        state: "CO",
        hiredAt: run.today,
        status: "active" as const,
        flsaStatus: "non_exempt" as const,
      })
      .returning();
    await run.db.db
      .update(userProfiles)
      .set({ employeeId: hal!.id })
      .where(eq(userProfiles.userId, run.actors.hr.userId));
    const hr = run.actors.hr.cookie;
    let sheet = "";
    await run.step("HR enters and submits Wes's two weeks; the Owner approves them", async () => {
      const ids: string[] = [];
      for (const [weekStart, days] of [
        [period.start, ["8", "8", "8", "8", "8", "0", "0"]],
        [addDays(period.start, 7), ["8", "8", "8", "8", "0", "0", "0"]],
      ] as const) {
        const saved = await run.act<{ id: string }>(200, moneyCalls.timesheet(wes!.id, weekStart, days), hr);
        await run.act(201, moneyCalls.timesheetSubmit(saved.id), hr);
        ids.push(saved.id);
      }
      sheet = ids[0]!;
      await run.act(201, moneyCalls.timesheetsApprove(ids), run.owner);
    });
    let opened: PayPeriod | undefined;
    await run.step(`HR opens the ended period ${period.start} to ${period.end}`, async () => {
      opened = await run.act<PayPeriod>(201, moneyCalls.payPeriodOpen(period.start), hr);
    });
    let bonusId = "";
    await run.step("HR adds a 100.00 bonus for Wes", async () => {
      bonusId = (await run.act<{ id: string }>(201, moneyCalls.bonus(wes!.id, "100.00", period.start, period.end), hr))
        .id;
    });
    await run.step("the Owner approves the run (HR added the bonus, so someone else approves)", async () => {
      await run.act(201, moneyCalls.payPeriodApprove(opened!.id), run.owner);
    });
    await run.checkAll("after the approval");
    const accrued = balanceOf(run.books.trial, "accrued_payroll");
    expect(accrued.lt(0), "the run accrued its gross pay").toBe(true);
    await expectRefusals(run, [
      {
        route: "POST /pay-periods/:id/approve",
        call: moneyCalls.payPeriodApprove(opened!.id),
        cookie: run.owner,
        refused: invalid(/^This pay period is already approved\.$/),
      },
      {
        route: "POST /pay-periods/:id/exclusions",
        call: {
          verb: "post",
          path: `/pay-periods/${opened!.id}/exclusions`,
          body: { employeeId: wes!.id, reason: "Left early" },
        },
        cookie: hr,
        refused: invalid(/^This pay period is already approved\.$/),
      },
      {
        route: "POST /bonuses/:id/void",
        call: { verb: "post", path: `/bonuses/${bonusId}/void`, body: { reason: "Entered twice" } },
        cookie: hr,
        refused: invalid(/^The pay run for that period is approved\. Reopen it first\.$/),
      },
      {
        route: "PUT /timesheets",
        // The form starts from the stored hours, so the approval is what refuses it, not a stale form.
        call: moneyCalls.timesheet(
          wes!.id,
          period.start,
          ["9", "8", "8", "8", "8", "0", "0"],
          ["8", "8", "8", "8", "8", "0", "0"],
        ),
        cookie: hr,
        refused: invalid(/^This week is approved, so it is locked\.$/),
      },
      {
        route: "POST /timesheets/:id/reopen",
        call: { verb: "post", path: `/timesheets/${sheet}/reopen`, body: { reason: "Wrong hours" } },
        cookie: run.owner,
        refused: invalid(/^This week is in an approved pay period\. Reopen the pay period first\.$/),
      },
    ]);
    await run.step("HR reopens the run, which reverses its entry today", async () => {
      await run.act(201, moneyCalls.payPeriodReopen(opened!.id), hr);
    });
    await run.checkAll("after the reopen");
    expect(balanceOf(run.books.trial, "accrued_payroll").isZero(), "the reopen took the accrual back").toBe(true);
    await run.step("the Owner approves the run again", async () => {
      await run.act(201, moneyCalls.payPeriodApprove(opened!.id), run.owner);
    });
    await run.checkAll("after the second approval");
    expect(balanceOf(run.books.trial, "accrued_payroll").toFixed(2)).toBe(accrued.toFixed(2));
    let contractor: ContractorPayment | undefined;
    await run.step("HR records 1,200.00 for Cora; the Owner pays it by check", async () => {
      contractor = await run.act<ContractorPayment>(
        201,
        moneyCalls.contractorPayment(cora!.id, run.today, "1200.00"),
        hr,
      );
      await payContractor(run, contractor.id, "check");
    });
    await run.checkAll("after the contractor payment");
    await expectRefusals(run, [
      {
        route: "POST /contractor-payments/:id/pay",
        call: moneyCalls.contractorPay(contractor!.id, "check"),
        cookie: run.owner,
        refused: invalid(/^This payment is already paid\.$/),
      },
    ]);
    await run.step("HR voids Cora's payment", async () => {
      await run.act(201, moneyCalls.contractorVoid(contractor!.id), hr);
    });
    await run.checkAll("after the contractor void");
    // Pay-run entries are keyed by approval (payroll-postings.ts), so E14 checks them here: two
    // approvals dated the period's end, and one reversal of the first dated today.
    const runEntries = (await entriesBySource(run.db.db)).filter((entry) => entry.sourceType === "pay_period");
    const approvals = runEntries.filter((entry) => entry.event === "payroll.approved");
    const reversals = runEntries.filter((entry) => entry.event === "payroll.approved.reversed");
    expect(approvals.map((entry) => entry.date)).toEqual([period.end, period.end]);
    expect(reversals.map((entry) => [entry.date, entry.reversesId])).toEqual([[run.today, approvals[0]!.id]]);
  }, 120_000);

  it("MI-7: posted documents change only by reversal: edits and repeats are refused, voids post their reversal today", async () => {
    const run = await newRun("mi7");
    let goods = "";
    let services = "";
    let buyer = "";
    await run.step("a goods and a services supplier, and a customer", async () => {
      goods = await supplier(run, "Peak Tile", "goods");
      services = await supplier(run, "Front Range Services", "services");
      buyer = await customer(run, "Eli Marsh");
    });
    let poId = "";
    await run.step("a purchase order received and billed at value, and paid in cash", async () => {
      const order = await purchaseOrder(
        run,
        goods,
        run.places.warehouses[0],
        [{ productId: run.places.tile, description: "Slate Tile", quantity: tileCartons(10), unitCost: TILE.cost }],
        false,
      );
      poId = order.id;
      await receive(run, order, [
        {
          poLineId: order.lines[0]!.id,
          productId: run.places.tile,
          received: tileCartons(10),
          damaged: "0",
          rolls: [],
        },
      ]);
      const bill = await enterBill(run, order.id);
      await paySupplier(run, goods, bill.total, "cash", [bill.id]);
    });
    let invoiceId = "";
    let quoteId = "";
    await run.step("an invoice from a quote, paid in cash and confirmed at once", async () => {
      const invoice = await quotedInvoice(run, buyer, [tileLine(run.places.tile, tileCartons(2))]);
      invoiceId = invoice.id;
      quoteId = invoice.quoteId!;
      await recordPayment(run, invoice.id, invoice.total, "cash", "owner");
    });
    await run.step("an expense paid in cash", async () => {
      await recordExpense(run, {
        supplierId: services,
        category: "rent",
        locationId: null,
        amount: "300.00",
        tax: "",
        paymentMethod: "cash",
        settlement: "paid",
      });
    });
    await run.checkAll("after posting");
    const payment = run.books.payments.find((p) => p.invoiceId === invoiceId)!;
    const supplierPayment = run.books.supplierPayments[0]!;
    const expense = run.books.expenses[0]!;
    const quote = {
      verb: "put" as const,
      path: `/quotes/${quoteId}`,
      body: moneyCalls.quote(buyer, run.places.warehouses[0], [tileLine(run.places.tile, tileCartons(3))]).body,
    };
    await expectRefusals(run, [
      {
        route: "POST /payments/:id/review",
        call: moneyCalls.paymentReview(payment.id, true),
        cookie: run.actors.accountant.cookie,
        refused: invalid(/^Payment \S+ is not waiting for verification\.$/),
      },
      {
        route: "POST /supplier-payments/:id/review",
        call: moneyCalls.supplierPaymentReview(supplierPayment.id, true),
        cookie: run.owner,
        refused: invalid(/^This payment is not waiting for a check\.$/),
      },
      {
        route: "POST /expenses/:id/review",
        call: moneyCalls.expenseReview(expense.id, true),
        cookie: run.owner,
        refused: invalid(/^This expense is not waiting for approval\.$/),
      },
      {
        route: "PUT /expenses/:id",
        call: {
          ...moneyCalls.expense({
            date: run.today,
            supplierId: services,
            category: "rent",
            locationId: null,
            amount: "999.00",
            tax: "",
            paymentMethod: "cash",
            settlement: "paid",
          }),
          verb: "put",
          path: `/expenses/${expense.id}`,
        },
        cookie: run.actors.accountant.cookie,
        refused: invalid(/^A recorded expense can't be edited\. Void it and enter it again\.$/),
      },
      {
        route: "PUT /invoices/:id/commission-split",
        call: { verb: "put", path: `/invoices/${invoiceId}/commission-split`, body: { split: [] } },
        cookie: run.owner,
        refused: invalid(/^A confirmed payment has been recorded, so the split is locked\.$/),
      },
      {
        route: "PUT /quotes/:id",
        call: quote,
        cookie: run.owner,
        refused: { status: 409, code: "quote_closed", message: /^Quote \S+ is closed and can't be changed\.$/ },
      },
      {
        route: "POST /quotes/:id/status",
        call: moneyCalls.quoteStatus(quoteId, "accept"),
        cookie: run.owner,
        refused: {
          status: 409,
          code: "quote_state",
          message: /^Quote \S+ can't be changed that way in its current state\.$/,
        },
      },
      {
        route: "POST /purchase-orders/:id/order",
        call: moneyCalls.placeOrder(poId),
        cookie: run.actors.purchasing,
        refused: { status: 409, code: "not_draft", message: /^\S+ is not a draft\.$/ },
      },
      {
        route: "POST /purchase-orders/:id/cancel",
        call: { verb: "post", path: `/purchase-orders/${poId}/cancel`, body: { reason: "Not needed" } },
        cookie: run.actors.purchasing,
        refused: { status: 409, code: "has_receipts", message: /^\S+ has receipts and can't be cancelled\.$/ },
      },
    ]);
    // A state change that is allowed changes no money field and posts nothing.
    const before = await entriesBySource(run.db.db);
    await run.step("the invoice is marked sent", async () => {
      tried.add("POST /invoices/:id/sent");
      await run.act(201, { verb: "post", path: `/invoices/${invoiceId}/sent` }, run.owner);
    });
    expect(await entriesBySource(run.db.db)).toEqual(before);
    // Voids post their reversal; a second void is refused.
    await run.step("the payment, the supplier payment and the expense are voided", async () => {
      await voidPayment(run, payment.id);
      await voidSupplierPayment(run, supplierPayment.id);
      await voidExpense(run, expense.id);
    });
    await run.step("the invoice, now with nothing confirmed, is voided", async () => {
      await run.act(201, moneyCalls.voidInvoice(invoiceId), run.owner);
    });
    await run.checkAll("after the voids");
    await expectRefusals(run, [
      {
        route: "POST /payments/:id/void",
        call: moneyCalls.paymentVoid(payment.id),
        cookie: run.actors.accountant.cookie,
        refused: invalid(/^Payment \S+ is already voided\.$/),
      },
      {
        route: "POST /supplier-payments/:id/void",
        call: moneyCalls.supplierPaymentVoid(supplierPayment.id),
        cookie: run.actors.accountant.cookie,
        refused: invalid(/^This payment can't be voided\.$/),
      },
      {
        route: "POST /expenses/:id/void",
        call: moneyCalls.expenseVoid(expense.id),
        cookie: run.actors.accountant.cookie,
        refused: invalid(/^This expense can't be voided\.$/),
      },
      {
        route: "POST /invoices/:id/void",
        call: moneyCalls.voidInvoice(invoiceId),
        cookie: run.owner,
        refused: invalid(/^Invoice \S+ is already void\.$/),
      },
    ]);
  }, 120_000);

  it("MI-8: a closed period refuses a posting dated in it, and a void of an earlier posting reverses today", async () => {
    const run = await newRun("mi8");
    const yesterday = addDays(run.today, -1);
    let vendor = "";
    let first = "";
    await run.step("a services supplier, and an expense dated yesterday", async () => {
      vendor = await supplier(run, "Front Range Services", "services");
      first = (
        await recordExpense(run, {
          date: yesterday,
          supplierId: vendor,
          category: "rent",
          locationId: null,
          amount: "40.00",
          tax: "",
          paymentMethod: "cash",
          settlement: "paid",
        })
      ).id;
    });
    await run.step("the Owner closes the books through yesterday", async () => {
      await run.act(201, moneyCalls.periodClose(yesterday), run.owner);
    });
    const closed = await api.send(
      moneyCalls.expense({
        date: yesterday,
        supplierId: vendor,
        category: "rent",
        locationId: null,
        amount: "50.00",
        tax: "",
        paymentMethod: "cash",
        settlement: "paid",
      }),
      run.actors.accountant.cookie,
    );
    expect({ status: closed.status, body: closed.body }).toMatchObject({
      status: 409,
      body: { code: "period_closed", message: expect.stringMatching(new RegExp(`closed through ${yesterday}`)) },
    });
    await run.step("the first expense is voided: its reversal is dated today", async () => {
      await voidExpense(run, first);
    });
    await run.checkAll("after the void");
  }, 120_000);

  it("MI-9: each bank account holds its own payments, and a void goes back to the bank first posted to", async () => {
    const run = await newRun("mi9");
    await run.step("two bank accounts: A takes checks, B nothing yet", async () => {
      await saveBanks(run, [
        { name: "Bank A", methods: ["check"] },
        { name: "Bank B", methods: [] },
      ]);
    });
    const bank = (name: string) => run.books.accounting.bankAccounts.find((b) => b.name === name)!.key!;
    let buyer = "";
    await run.step("a customer", async () => {
      buyer = await customer(run, "Fay Quinn");
    });
    const payByCheck = async () => {
      const invoice = await quotedInvoice(run, buyer, [tileLine(run.places.tile, tileCartons(1))]);
      return recordPayment(run, invoice.id, invoice.total, "check", "owner");
    };
    let early = "";
    await run.step("two invoices paid by check into bank A", async () => {
      early = (await payByCheck()).id;
      await payByCheck();
    });
    await run.step("checks move to bank B", async () => {
      await moveMethod(run, "check", "Bank B");
    });
    let late = "";
    await run.step("a third invoice paid by check into bank B", async () => {
      late = (await payByCheck()).amount;
    });
    await run.step("the first check is voided, back to bank A", async () => {
      await voidPayment(run, early);
    });
    await run.checkAll("after the void");
    const second = run.books.payments.find(
      (p) => p.status === "confirmed" && run.memory.cashAt.get(p.id) === bank("Bank A"),
    )!;
    expect(balanceOf(run.books.trial, bank("Bank A")).toFixed(2)).toBe(dec(second.amount).toFixed(2));
    expect(balanceOf(run.books.trial, bank("Bank B")).toFixed(2)).toBe(dec(late).toFixed(2));
    expect(balanceOf(run.books.trial, "cash").isZero()).toBe(true);
  }, 120_000);

  it("MI-7 coverage: every write classed 'refused once posted' or 'state change only' was tried, or is listed with where it is covered", () => {
    const classed = Object.entries(DOCUMENT_WRITES)
      .filter(([, [kind]]) => kind === "refused once posted" || kind === "state change only")
      .map(([route]) => route)
      .sort();
    const untried = classed.filter((route) => !tried.has(route) && !NOT_TRIED_HERE[route]);
    expect(untried, "classed writes neither tried nor listed").toEqual([]);
    expect(
      Object.keys(NOT_TRIED_HERE).filter((route) => tried.has(route) || !classed.includes(route)),
      "stale entries",
    ).toEqual([]);
  });
});

/**
 * Writes classed "refused once posted" or "state change only" that MI-4, MI-5 and MI-7 don't try
 * on a posted record, each with where it is covered instead.
 */
const NOT_TRIED_HERE: Readonly<Record<string, string>> = {
  "POST /change-orders/:id/decision": "Nothing posts; covered by contracts.int.test.ts.",
  "POST /contracts/:id/close": "A life-cycle step that posts nothing; covered by contracts.int.test.ts.",
  "POST /contracts/:id/complete": "A life-cycle step that posts nothing; covered by contracts.int.test.ts.",
  "POST /contracts/:id/recall": "A life-cycle step that posts nothing; covered by contracts.int.test.ts.",
  "POST /contracts/:id/send": "Used by MI-4 on a draft (allowed); a life-cycle step that posts nothing.",
  "POST /contracts/:id/sign": "Used by MI-4 on a sent contract (allowed); a life-cycle step that posts nothing.",
  "POST /contracts/:id/terminate": "A life-cycle step that posts nothing; covered by contracts.int.test.ts.",
  "POST /pay-periods/:id/export": "Marks an approved run exported and posts nothing; covered by payroll.int.test.ts.",
  "POST /transfers/:id/receive": "Moves stock between warehouses and posts nothing; covered by inventory.int.test.ts.",
  "PUT /commission-plans/:id":
    "A used plan becomes a new version; covered by commissions.int.test.ts (MI-6 not built).",
};

/** A refusal as a GAP test pins it: the exact status, code and words (SH-11: a 5xx never matches). */
function expectRefused(answer: Answer, expected: Expected): void {
  const body = answer.body as { code?: string; message?: string } | null;
  expect({ status: answer.status, code: body?.code, message: body?.message }).toEqual({
    status: expected.status,
    code: expected.code,
    message: expect.stringMatching(expected.message),
  });
}

/** The 404 a record that isn't the company's gets: "This <what> no longer exists." (sales-common `notFound`). */
const notFound = (what: string): Expected => ({
  status: 404,
  code: "not_found",
  message: new RegExp(`^This ${what} no longer exists\\.$`),
});

/**
 * The first path segments of the routes that would set a company up: its locations, products and
 * settings (gaps G2 and G3). FA-5 pins which writes exist under them.
 */
const SETUP_ROOTS: ReadonlySet<string> = new Set([
  "branches",
  "locations",
  "products",
  "settings",
  "tax-rules",
  "warehouses",
]);

/**
 * The writes under SETUP_ROOTS today: every settings section and Localization tab (ADR 0059) and
 * the locations (part 4a). None adds a branch or a product (G3), so FA-5 fails when one appears.
 */
const SETUP_WRITES: readonly string[] = [
  "POST /locations",
  "PUT /locations/:id",
  "PUT /settings/accounting",
  ...API_SETTINGS_SECTIONS.map((section) => `PUT /settings/${section}`),
  ...API_LOCALIZATION_TABS.map((tab) => `PUT /settings/localization/${tab}`),
];

/** The money columns of a P&L row and of its totals (reports.md, Profit and loss). */
const PNL_MONEY = ["revenue", "cogs", "grossMargin", "expenses", "netIncome"] as const;

/** One of the P&L's money columns. */
type PnlMoney = (typeof PNL_MONEY)[number];

/** A P&L row's money columns, each to the cent, so `"40"` and `"40.00"` read the same. */
function pnlFigures(row: Readonly<Record<string, string>>): Record<PnlMoney, string> {
  const figures = PNL_MONEY.map((column) => [column, dec(row[column] ?? "0").toFixed(2)]);
  return Object.fromEntries(figures) as Record<PnlMoney, string>;
}

/** A measure visit with no product: the one quote line a company with no catalog could offer. */
const MEASURE_VISIT: QuoteLine = {
  description: "Measure visit",
  category: "service",
  unit: "each",
  quantity: "1",
  unitPrice: "75.00",
};

/**
 * A bare new company on the API (whole-product check, piece 4 (a); plan section 5.2): provisioned
 * the real way and given nothing else, so each demo-script step the API serves runs as a new
 * customer would meet it. A step a new company can't do yet is pinned as it behaves today, in a
 * test titled GAP-Gn naming the STATUS entry it waits for: an exact 4xx with its code and words,
 * never a 5xx. When someone fixes a gap, its test fails, and they replace it with the spec's
 * behaviour. The tests run in order on one company (`freshfl`); FA-12 runs on an HR Suite one.
 */
describe("a bare new company on the API (whole-product check FA; needs the local PostgreSQL)", () => {
  let company = { id: "", slug: "" };
  let owner: EnrolledPerson;
  let managerEmail = "";
  let supplierId = "";
  /** The company day, in the zone `provisionCompany` gives every company. */
  const today = todayIn(BOOTSTRAP_ZONE);
  /** Where the decimal sweep stood before FA, so FA's own answers are checked too (CLAUDE.md rule 6). */
  let decimalsBefore = 0;
  let summitIds: Set<string> | undefined;

  const send = (call: Call, cookie = owner.cookie) => api.send(call, cookie);
  const ok = <T>(status: number, call: Call, cookie = owner.cookie) => api.expect<T>(status, call, cookie);
  const read = <T>(path: string, cookie = owner.cookie) => api.read<T>(path, cookie);

  /** Checks a customers file, steps up and imports it with the dry run's actions, as the Import screen does. */
  async function importCustomers(rows: readonly ImportRow[]): Promise<ImportResult> {
    const file = importFile("customers", rows);
    const preview = await ok<ImportPreview>(200, freshCalls.importCheck(file));
    await stepUp(harness, owner);
    return ok<ImportResult>(201, freshCalls.importCommit(file, planActions(preview.rows)));
  }

  /** Every record id in Summit's database, read once: FA writes nothing there. */
  async function summitRecordIds(): Promise<Set<string>> {
    if (summitIds) return summitIds;
    const summit = await harness.companyDb(SUMMIT_ID);
    try {
      summitIds = await recordIds(summit.db);
    } finally {
      await summit.close();
    }
    return summitIds;
  }

  beforeAll(() => {
    decimalsBefore = api.decimalIssues.length;
  });

  it("FA-0, GAP-G4: the provisioned Owner can't sign in and was sent no invitation; through one put in its place they set a password, enrol MFA and invite a Manager (STATUS: owner invitations at provisioning come with the platform-admin screens, P17)", async () => {
    company = await harness.provisionCompany("freshfl");
    const provisioned = await provisionedOwner(harness, company.id);
    const signIn = await harness.post("/api/auth/sign-in/email").send({ email: provisioned.email, password: PASSWORD });
    expect({ status: signIn.status, body: signIn.body as unknown }).toEqual({
      status: 401,
      body: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    });
    const invitations = await harness.control.db
      .select({ id: userInvitations.id })
      .from(userInvitations)
      .where(eq(userInvitations.userId, provisioned.userId));
    expect(invitations, "provisioning wrote no invitation").toEqual([]);
    expect(
      harness.outbox.sent.filter((sent) => sent.to.includes(provisioned.email)),
      "nothing emailed",
    ).toEqual([]);
    // In its place, the row `UsersService.invite` would write; the Owner accepts it through the product.
    const invitation = await inviteProvisionedOwner(harness, company.id);
    await acceptInvitation(harness, invitation.token);
    owner = await enrolled(harness, invitation.email);
    const managerRole = (await read<Role[]>("/roles")).find((role) => role.key === "manager")!;
    managerEmail = `morgan.vale.${company.slug}@example.test`;
    const invite = freshCalls.invite("Morgan Vale", managerEmail, managerRole.id);
    expectRefused(await send(invite), {
      status: 403,
      code: "step_up_required",
      message: /^Confirm it's you with a code from your authenticator app, then try again\.$/,
    });
    await stepUp(harness, owner);
    expect(await ok<User>(201, invite)).toMatchObject({
      email: managerEmail,
      roleIds: [managerRole.id],
      status: "invited",
    });
    await acceptInvitation(harness, invitationTokenFor(harness, managerEmail));
    await harness.signIn(managerEmail);
    const users = await read<User[]>("/users");
    expect(users.map((user) => [user.email, user.status]).sort()).toEqual(
      [
        [provisioned.email, "active"],
        [managerEmail, "active"],
      ].sort(),
    );
  }, 60_000);

  it("FA-1: the session names the new company, its standing is full, and billing shows a trial with no plan", async () => {
    const named = { id: company.id, slug: company.slug, name: "freshfl" };
    expect(await read("/auth/context")).toMatchObject({ company: named, companies: [named], mfa: { state: "ok" } });
    expect(await read("/company/standing")).toEqual({ state: "full" });
    expect(await read("/billing")).toEqual({
      status: "trial",
      phase: "full",
      subscriptions: [],
      limits: { userLimit: null, branchLimit: null },
      notice: null,
    });
  }, 60_000);

  it("FA-2 (demo step 16): the nine default roles, the Owner's locked; a role change with a step-up is saved", async () => {
    const roles = await read<Role[]>("/roles");
    expect(roles.map((role) => role.key).sort()).toEqual([...PRODUCT_ROLES.flooring].sort());
    expect(roles.filter((role) => role.owner).map((role) => role.key)).toEqual(["owner"]);
    expect(
      roles.filter((role) => !role.system),
      "every role is shipped",
    ).toEqual([]);
    const ownerRole = roles.find((role) => role.owner)!;
    const managerRole = roles.find((role) => role.key === "manager")!;
    await stepUp(harness, owner);
    expectRefused(await send(freshCalls.roleSave(ownerRole, "Everything")), {
      status: 403,
      code: "owner_locked",
      message: /^The Owner role is locked\. It always holds everything in your plan\.$/,
    });
    const description = "Runs the showroom and the team";
    const sorted = (role: Role) => ({ ...role, permissions: [...role.permissions].sort() });
    const saved = await ok<Role>(200, freshCalls.roleSave(managerRole, description));
    expect(sorted(saved)).toEqual(sorted({ ...managerRole, description }));
    expect((await read<Role[]>("/roles")).find((role) => role.id === managerRole.id)?.description).toBe(description);
  }, 60_000);

  it("FA-3 (demo step 7): a supplier and its contact are saved, each in the audit log under the Owner", async () => {
    supplierId = (await ok<Supplier>(201, moneyCalls.supplier("Front Range Services", "services"))).id;
    const contact = await ok<SupplierContact>(
      201,
      freshCalls.supplierContact(supplierId, "Sky Ortega", "sky.ortega@example.test"),
    );
    expect(contact).toMatchObject({ supplierId, isPrimary: true, status: "active" });
    const audit = await read<AuditEntry[]>("/audit");
    expect(audit.map((entry) => [entry.action, entry.target, entry.actorName, entry.actorRole])).toEqual([
      ["Added supplier contact", "Sky Ortega, Front Range Services", "Owner", "Owner"],
      ["Added supplier", "Front Range Services", "Owner", "Owner"],
      ["Changed role", "Manager", "Owner", "Owner"],
      ["Invited user", managerEmail, "Owner", "Owner"],
    ]);
  }, 60_000);

  it("FA-4, GAP-G2 and GAP-G3 (demo steps 2 and 3): a customer added by hand waits for Settings → Localization and tax; one imported can't be quoted, because there is no warehouse (STATUS: Settings at provisioning; Settings → Locations moves to the API)", async () => {
    // Finding F-n: adding a customer reads the default terms from Localization; since 2026-11-20 the words name this step.
    expectRefused(await send(moneyCalls.customer("Avery Brook")), {
      status: 409,
      code: "settings_missing",
      message: /^Finish Settings → Localization and tax before adding customers\.$/,
    });
    // An import is the one way a customer comes in: on Due on receipt, with the Owner as rep (ADR 0057 S-9).
    const result = await importCustomers([{ name: "Avery Brook", email: "avery.brook@example.test" }]);
    expect(result.batch.counts).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    const customers = await read<Customer[]>("/customers");
    expect(customers.map((c) => [c.name, c.terms, c.salesRepId])).toEqual([
      ["Avery Brook", "due_on_receipt", owner.userId],
    ]);
    // The quote stops at the missing warehouse (G3) before it would read the missing settings (G2).
    expectRefused(await send(moneyCalls.quote(customers[0]!.id, uuidv7(), [MEASURE_VISIT])), {
      status: 400,
      code: "invalid_request",
      message: /^Fulfil the quote from a warehouse\.$/,
    });
  }, 60_000);

  it("FA-5, GAP-G3 (demo steps 5 and 7): no branches, locations or products; a location waits for a branch no route makes, a purchase order has nowhere to go, and products come only through the import (STATUS: Settings → Locations; ADR 0059 part 4a)", async () => {
    expect(await read("/locations")).toEqual([]);
    expect(await read("/products")).toEqual([]);
    expect((await read<CompanyAnswer>("/company")).company.branches).toEqual([]);
    // POST /locations exists since ADR 0059 part 4a, but a location belongs to a branch, and
    // provisioning makes none and no route adds one: only the demo seed writes branches.
    const warehouse = {
      name: "Main warehouse",
      kind: "warehouse",
      branchId: uuidv7(),
      address: { street: "40 Quarry Rd", city: "Austin", state: "TX", zip: "78701" },
      isDefault: true,
      displaySamples: 0,
    };
    expectRefused(await send({ verb: "post", path: "/locations", body: warehouse }), {
      status: 400,
      code: "invalid_request",
      message: /^Choose the branch this location belongs to.$/,
    });
    const tile = { productId: uuidv7(), description: "Porcelain tile", quantity: "200", unitCost: "2.1000" };
    expectRefused(await send(moneyCalls.purchaseOrder(supplierId, uuidv7(), [tile], true)), {
      status: 400,
      code: "invalid_request",
      message: /^Receive into a warehouse.$/,
    });
    const catalog = routeCatalog(harness.app);
    const setup = catalog.filter((route) => isWrite(route) && SETUP_ROOTS.has(route.path.split("/")[1] ?? ""));
    expect(
      setup.map((route) => route.name).sort(),
      "the writes under the setup paths: settings and locations, never a branch or a product",
    ).toEqual([...SETUP_WRITES].sort());
    expect(catalog.map((route) => route.name)).toContain("POST /imports");
  }, 60_000);

  it("FA-6 (demo step 9): a paid expense posts at once, and the first posting makes the chart of accounts", async () => {
    expect(await api.trialBalance(owner.cookie)).toEqual({
      through: null,
      rows: [],
      debit: "0.00",
      credit: "0.00",
      balanced: true,
    });
    // With no Settings → Expenses saved, no approval is needed (`loadExpenseSettings`), so it posts now.
    const expense = await ok<Expense>(
      201,
      moneyCalls.expense({
        date: today,
        supplierId,
        category: "rent",
        locationId: null,
        amount: "40.00",
        tax: "",
        paymentMethod: "cash",
        settlement: "paid",
      }),
    );
    expect(expense).toMatchObject({ number: "EXP-1", status: "confirmed", amount: "40.00", tax: "0.00" });
    const trial = await api.trialBalance(owner.cookie);
    expect(trialBalanceProblems(trial)).toEqual([]);
    expect(trial.rows.map((row) => row.key).sort()).toEqual(DEFAULT_ACCOUNTS.map((account) => account.key).sort());
    expect(trial.rows.filter((row) => !dec(row.balance).isZero()).map((row) => [row.key, row.balance])).toEqual([
      ["cash", "-40.00"],
      ["rent", "40.00"],
    ]);
  }, 60_000);

  it("FA-7 (demo step 11): a meeting is made, listed, and cancelled for everyone", async () => {
    const start: LocalTime = `${addDays(today, 7)}T10:00`;
    const made = await ok<Meeting>(201, freshCalls.meeting("Showroom walk-through", start));
    expect(made).toMatchObject({ start, status: "confirmed", timeZone: BOOTSTRAP_ZONE, ownerUserId: owner.userId });
    expect((await read<Meeting[]>("/meetings")).map((meeting) => meeting.id)).toEqual([made.id]);
    expect(await ok<Meeting>(201, freshCalls.meetingCancel(made.id))).toMatchObject({
      id: made.id,
      status: "cancelled",
      sequence: 1,
    });
    expect(await read("/meetings"), "a cancelled meeting is not listed").toEqual([]);
  }, 60_000);

  it("FA-8 (demo step 10): the reports open, the trial balance among them, and the P&L holds only the one expense", async () => {
    expect(await read<ReportOptions>("/reports/options")).toEqual({
      reports: ["business", "pnl", "sales", "payments", "trial-balance"],
      exports: ["business", "pnl", "sales", "payments", "trial-balance"],
      locations: [],
      salespeople: [],
      vendors: [{ id: supplierId, name: "Front Range Services" }],
    });
    const pnl = await read<Report>("/reports/pnl");
    const month = today.slice(0, 7);
    const zero = pnlFigures({});
    expect(pnl.rows).toHaveLength(12);
    expect(pnl.rows.at(-1)?.month).toBe(month);
    expect(pnl.rows.map((row) => [row.month, pnlFigures(row)])).toEqual(
      pnl.rows.map((row) => [
        row.month,
        row.month === month ? { ...zero, expenses: "40.00", netIncome: "-40.00" } : zero,
      ]),
    );
    expect(pnlFigures(pnl.totals ?? {})).toEqual({ ...zero, expenses: "40.00", netIncome: "-40.00" });
  }, 60_000);

  it("FA-9 (demo step 14): a customers file is checked, imported with a step-up and undone, and the books don't move", async () => {
    const books = await api.trialBalance(owner.cookie);
    const result = await importCustomers([{ name: "Riley Hart", email: "riley.hart@example.test" }]);
    expect(result.batch.counts).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    expect((await read<Customer[]>("/customers")).map((c) => c.name).sort()).toEqual(["Avery Brook", "Riley Hart"]);
    await stepUp(harness, owner);
    expect(await ok<ImportBatchSummary>(201, freshCalls.importUndo(result.batch.id))).toMatchObject({
      id: result.batch.id,
      undoneBy: "Owner",
    });
    expect((await read<Customer[]>("/customers")).map((c) => c.name)).toEqual(["Avery Brook"]);
    // Imports post nothing (ADR 0057 §2): the books are the same after the import and its undo.
    expect(await api.trialBalance(owner.cookie)).toEqual(books);
  }, 60_000);

  it("FA-10 (demo step 19): the audit log holds every write above, by the Owner, and nothing of Summit's", async () => {
    const db = await harness.companyDb(company.id);
    const rows = await db.db
      .select()
      .from(auditLog)
      .orderBy(asc(auditLog.at), asc(auditLog.id))
      .finally(() => db.close());
    expect(rows.map((row) => [row.action, row.targetLabel])).toEqual([
      ["Invited user", managerEmail],
      ["Changed role", "Manager"],
      ["Added supplier", "Front Range Services"],
      ["Added supplier contact", "Sky Ortega, Front Range Services"],
      ["Imported customer", "Avery Brook"],
      ["Imported customers", "IMP-1001, customers.csv"],
      ["Recorded expense", "EXP-1, Rent"],
      ["Scheduled meeting", "Showroom walk-through"],
      ["Cancelled meeting", "Showroom walk-through"],
      ["Imported customer", "Riley Hart"],
      ["Imported customers", "IMP-1002, customers.csv"],
      ["Removed imported customer", "Riley Hart"],
      ["Undid import", "IMP-1002, customers.csv"],
    ]);
    expect([...new Set(rows.map((row) => row.actorUserId))]).toEqual([owner.userId]);
    const summit = await summitRecordIds();
    expect(rows.filter((row) => row.targetId !== null && summit.has(row.targetId))).toEqual([]);
    expect(await read<AuditEntry[]>("/audit")).toHaveLength(rows.length);
  }, 60_000);

  it("FA-11, isolation: Summit's invoice, pay period and meeting are not found, and no list names a Summit record", async () => {
    const summit = await harness.companyDb(SUMMIT_ID);
    try {
      const [invoice] = await summit.db.select().from(invoices).orderBy(asc(invoices.id)).limit(1);
      const [period] = await summit.db
        .select({ id: payPeriods.id })
        .from(payPeriods)
        .orderBy(asc(payPeriods.id))
        .limit(1);
      const [meeting] = await summit.db.select({ id: meetings.id }).from(meetings).orderBy(asc(meetings.id)).limit(1);
      expectRefused(await send({ verb: "post", path: `/invoices/${invoice!.id}/sent` }), notFound("invoice"));
      expect(await summit.db.select().from(invoices).where(eq(invoices.id, invoice!.id))).toEqual([invoice]);
      expectRefused(await send(freshCalls.read(`/pay-periods/${period!.id}/review`)), notFound("pay period"));
      expectRefused(await send(freshCalls.read(`/meetings/${meeting!.id}/calendar.ics`)), notFound("meeting"));
    } finally {
      await summit.close();
    }
    const ids = await summitRecordIds();
    const reads = routeCatalog(harness.app).filter(
      (route) => route.level === "company" && route.method === "GET" && !hasPathParameter(route),
    );
    const refused: Record<string, string> = {};
    const named: string[] = [];
    let own = 0;
    for (const route of reads) {
      const query = QUERY_FOR[route.name];
      const answer = await send(freshCalls.read(query ? `${route.path}?${query}` : route.path));
      if (answer.status !== 200) {
        refused[route.name] = `${answer.status} ${(answer.body as { code?: string } | null)?.code ?? ""}`;
        continue;
      }
      named.push(...idsFound(answer.body, ids).map((found) => `${route.name}: ${found}`));
      own += [...jsonNodes(answer.body)].filter(
        (node) => typeof node.value === "string" && isUuidV7(node.value),
      ).length;
    }
    expect(refused, "every list answers on a company with nothing in it").toEqual({});
    expect(named, "Summit records in the new company's answers").toEqual([]);
    expect(own, "the sweep read the new company's own records").toBeGreaterThan(0);
    expect(api.decimalIssues.slice(decimalsBefore), "money in FA's answers").toEqual([]);
  }, 60_000);

  it("FA-12, GAP-G2 (HR Suite, demo section 5): an employee is added; the pay period the screen opens waits for Settings → HR; no time-off policies (STATUS: Settings at provisioning)", async () => {
    const hr = await harness.provisionCompany("freshhr", ["hr"]);
    const invitation = await inviteProvisionedOwner(harness, hr.id);
    await acceptInvitation(harness, invitation.token);
    const hrOwner = await enrolled(harness, invitation.email);
    const employee = await ok<Employee>(
      201,
      freshCalls.employee("Jordan Pike", "jordan.pike@example.test", "hr"),
      hrOwner.cookie,
    );
    expect(employee).toMatchObject({ companyId: hr.id, name: "Jordan Pike", status: "active", payRate: "31.75" });
    const listed = await ok<Employee[]>(200, freshCalls.read("/employees", "hr"), hrOwner.cookie);
    expect(listed.map((row) => row.id)).toEqual([employee.id]);
    expect(await ok(200, freshCalls.read("/pay-periods", "hr"), hrOwner.cookie)).toEqual([]);
    // The web's listPayPeriods opens the current period first and lists what there is when that is refused.
    expectRefused(await send(freshCalls.openCurrentPayPeriod("hr"), hrOwner.cookie), {
      status: 409,
      code: "settings_missing",
      message: /^Choose the pay frequency in Settings → HR first\.$/,
    });
    expect(await ok(200, freshCalls.read("/time-off-policies", "hr"), hrOwner.cookie)).toEqual([]);
  }, 60_000);
});
