import {
  countsAsCost,
  dec,
  EXPENSE_ACCOUNTS,
  sum,
  type BusinessReport,
  type Dec,
  type Report,
} from "@workspace/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "../src/modules/sales/sales-common";
import { AuthHarness } from "./auth-harness";
import { BOOTSTRAP_ZONE } from "./support/company-bootstrap";
import { balanceOf, stateLikeColumns } from "./support/ledger-read";
import { MoneyApi } from "./support/money-actions";
import { rngOf } from "./support/money-model";
import { PRELUDE_EVENTS, runPrelude } from "./support/money-prelude";
import { startMoneyRun, type MoneyRun } from "./support/money-run";
import { drawStep } from "./support/money-steps";
import { STORED_STATE_COLUMNS, TIER_B_DEFAULT } from "./support/route-lists";

/** The long variant (tier C): five seeds of 80 random steps. */
const WHOLE_CHECK = process.env.WHOLE_CHECK === "1";

/** The seeds to run: MONEY_SEED replays one; MONEY_SEEDS lists several; otherwise one, or five with WHOLE_CHECK. */
const SEEDS: readonly number[] = process.env.MONEY_SEED
  ? [Number(process.env.MONEY_SEED)]
  : process.env.MONEY_SEEDS
    ? process.env.MONEY_SEEDS.split(",").map(Number)
    : WHOLE_CHECK
      ? [20261116, 20261117, 20261118, 20261119, 20261120]
      : [20261116];

/** Random steps after the prelude: 30 by default (tier B), 80 with WHOLE_CHECK, none when the CI gate turns tier B off. */
const STEPS = process.env.MONEY_STEPS ? Number(process.env.MONEY_STEPS) : WHOLE_CHECK ? 80 : TIER_B_DEFAULT ? 30 : 0;

/** Prints every step, so a replay can be compared line by line with the run it replays. */
const PRINT_STEPS = WHOLE_CHECK || process.env.MONEY_SEED !== undefined;

/** The expense accounts a P&L and a Business report count: every expense account but cost of goods and stock corrections. */
const OPERATING_ACCOUNTS = [
  ...new Set<string>([
    ...Object.values(EXPENSE_ACCOUNTS).filter((key) => key !== "sales_tax_payable"),
    "contract_labor",
    "commissions_expense",
    "bad_debt",
  ]),
];

/**
 * Money integrity on an API-only company (whole-product check, piece 2; docs/whole-product-check.md):
 * a company provisioned for the test, given settings and two products by direct inserts and nothing
 * else, so every money fact comes through the API. A fixed prelude makes every event kind happen,
 * then a seeded random tail runs; after every step every entry balances, the trial balance is
 * zero and every answer's money is a decimal string, and at checkpoints the control accounts
 * equal what the documents derive (E3 to E12), the journal matches the documents (E14) and no
 * balance is stored (E15). MI-2 then holds the reports against the ledger, figure by figure.
 */
describe("money integrity on an API-only company (whole-product check; needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const api = new MoneyApi(harness);
  const runs: MoneyRun[] = [];

  beforeAll(async () => {
    await harness.start();
  }, 120_000);

  afterAll(async () => {
    for (const run of runs) await run.db.close();
    await harness.stop();
  });

  /** A fresh company for one seed (see startMoneyRun), closed after the file. */
  async function newRun(seed: number): Promise<MoneyRun> {
    const run = await startMoneyRun(harness, api, `money${seed}`, seed);
    runs.push(run);
    return run;
  }

  it(
    "MI-1: a prelude of every event kind, then a seeded random tail, keeps the books equal to the documents",
    async () => {
      for (const seed of SEEDS) {
        const run = await newRun(seed);
        const cast = await runPrelude(run);
        await run.checkAll("after the prelude");
        const rng = rngOf(seed);
        for (let i = 1; i <= STEPS; i += 1) {
          const step = drawStep(run, rng);
          await run.step(
            `tail ${i}: ${step.kind}`,
            async () => run.describe(await step.run(run, cast, rng)),
            step.allowedRefusals,
          );
          if (i % 5 === 0) await run.checkAll(`after tail step ${i}`);
        }
        await run.checkAll("at the end");
        expect(
          PRELUDE_EVENTS.filter((kind) => (run.counts.get(kind) ?? 0) < 1),
          "event kinds that never happened",
        ).toEqual([]);
        expect(todayIn(BOOTSTRAP_ZONE), "the run crossed midnight in the company's time zone").toBe(run.today);
        const tally = [...run.counts].map(([kind, n]) => `${kind} ${n}`).join(", ");
        console.info(`money seed ${seed}: ${run.log.length} steps; ${tally}`);
        if (PRINT_STEPS) console.info(`money seed ${seed} steps:\n${run.log.join("\n")}`);
      }
    },
    WHOLE_CHECK ? 1_200_000 : 300_000,
  );

  it("E15: no money table stores a balance or a derived state, and no listing serves one", async () => {
    const run = runs[0]!;
    const found = await stateLikeColumns(run.db.db);
    expect(found, "state-like columns of money tables, against STORED_STATE_COLUMNS").toEqual(
      Object.keys(STORED_STATE_COLUMNS).sort(),
    );
    const derived = ["balance", "state", "paid", "overpaid", "unpaid", "owed"];
    for (const row of [...run.books.invoices, ...run.books.bills]) {
      expect(
        Object.keys(row).filter((key) => derived.includes(key)),
        `${row.number} carries a derived figure`,
      ).toEqual([]);
    }
  });

  it("MI-2 (E13): the reports agree with the ledger figure by figure, and differ from it only by design", async (context) => {
    const run = runs[0]!;
    const month = run.today.slice(0, 7);
    if (todayIn(BOOTSTRAP_ZONE).slice(0, 7) !== month) {
      context.skip("E13 skipped: the run crossed into a new month, so the month's figures mix two months.");
    }
    const books = await run.refresh();
    const ledgerRevenue = balanceOf(books.trial, "sales").plus(balanceOf(books.trial, "sales_returns")).negated();
    const ledgerOperating = sum(OPERATING_ACCOUNTS.map((key) => balanceOf(books.trial, key)));
    const inMonth = books.invoices.filter((i) => !i.voidedAt && i.issuedAt.startsWith(month));
    const costExpenses = books.expenses.filter((e) => countsAsCost(e) && e.date.startsWith(month));

    const pnl = await api.read<Report>("/reports/pnl", run.owner);
    const row = pnl.rows.find((candidate) => candidate.month === month)!;
    expect(row, "the P&L has this month").toBeDefined();
    const figure = (value: string | undefined): Dec => dec(value ?? "NaN");
    // R1: revenue equals the ledger's sales less returns.
    expect(figure(row.revenue).toFixed(2), "R1 P&L revenue").toBe(ledgerRevenue.toFixed(2));
    // R2: cost of goods is the invoices' cost at sale (ADR 0055), not the ledger's cost at issue.
    const signedCost = sum(inMonth.map((i) => (i.isReturn ? dec(i.cost).negated() : dec(i.cost))));
    expect(figure(row.cogs).toFixed(2), "R2 P&L cost of goods").toBe(signedCost.toFixed(2));
    // R3: expenses are amounts before tax; the ledger books amount plus tax, and write-offs (F-a).
    const amounts = sum(costExpenses.map((e) => e.amount));
    const taxes = sum(costExpenses.map((e) => e.tax || "0"));
    expect(figure(row.expenses).toFixed(2), "R3 P&L expenses").toBe(amounts.toFixed(2));
    const writtenOff = sum(books.adjustments.filter((a) => a.kind === "write_off").map((a) => a.amount));
    expect(ledgerOperating.minus(figure(row.expenses)).toFixed(2), "R3 ledger less P&L expenses (F-a)").toBe(
      taxes.plus(writtenOff).toFixed(2),
    );
    expect(taxes.gt(0) && writtenOff.gt(0), "the prelude made both differences happen").toBe(true);
    // R5: the P&L's own lines agree.
    expect(figure(row.grossMargin).toFixed(2), "R5 P&L gross").toBe(
      figure(row.revenue).minus(figure(row.cogs)).toFixed(2),
    );
    expect(figure(row.netIncome).toFixed(2), "R5 P&L net").toBe(
      figure(row.revenue).minus(figure(row.cogs)).minus(figure(row.expenses)).toFixed(2),
    );

    const business = await api.read<BusinessReport>(`/reports/business?from=${month}-01&to=${run.today}`, run.owner);
    const summary = business.sections.find((s) => s.key === "summary")!;
    const value = (id: string): Dec => dec(summary.rows.find((r) => r.id === id)?.values.now ?? "NaN");
    // R4: revenue and operating expenses (amount plus tax, write-offs included) equal the ledger.
    expect(value("revenue").toFixed(2), "R4 Business revenue").toBe(ledgerRevenue.toFixed(2));
    expect(value("opex").toFixed(2), "R4 Business operating expenses").toBe(ledgerOperating.toFixed(2));
    expect(value("cogs").toFixed(2), "R4 Business cost of goods (documents, as R2)").toBe(signedCost.toFixed(2));
    // R5: gross and net from the report's own lines.
    expect(value("gross").toFixed(2), "R5 Business gross").toBe(value("revenue").minus(value("cogs")).toFixed(2));
    expect(value("net").toFixed(2), "R5 Business net").toBe(value("gross").minus(value("opex")).toFixed(2));
    // R6: location profits add up to company profit (week-18 gate, R-GATE).
    const locations = business.sections.find((s) => s.key === "locations")!;
    expect(dec(locations.total!.values.net!).toFixed(2), "R6 locations net").toBe(value("net").toFixed(2));
    expect(dec(locations.total!.values.revenue!).toFixed(2), "R6 locations revenue").toBe(value("revenue").toFixed(2));
    // By design (ADR 0055): the ledger's cost of goods is cost at issue, the reports' cost at sale.
    const ledgerCogs = balanceOf(books.trial, "cost_of_goods_sold");
    await context.annotate(
      `By design: ledger cost of goods ${ledgerCogs.toFixed(2)} (at issue) vs reports ${signedCost.toFixed(2)} (at sale); ` +
        `ledger operating expenses ${ledgerOperating.toFixed(2)} vs P&L ${figure(row.expenses).toFixed(2)} ` +
        `(tax ${taxes.toFixed(2)}, write-offs ${writtenOff.toFixed(2)}).`,
    );
  });

  it("MI-3: every money, quantity and rate field of every answer was a decimal string", () => {
    expect(api.answered, "answers swept").toBeGreaterThan(100);
    expect(api.decimalIssues).toEqual([]);
  });
});
