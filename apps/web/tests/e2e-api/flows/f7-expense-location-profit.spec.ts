import { expect, type Page } from "@playwright/test";
import { dec, EXPENSE_ACCOUNTS, expenseCost, type BusinessReport, type Expense } from "@workspace/shared";
import { FLOW_TAG } from "../../e2e/helpers";
import { ACCOUNTANT_EMAIL } from "../accounts";
import { cellUnder, expectAuditRows, expectLedgerMoved, openBusinessReport, trialBalance } from "./checks";
import {
  assertSameCompanyDay,
  companyToday,
  flowTest,
  PDF_PROOF,
  resetAuthAround,
  runId,
  shownMoney,
  waitForAnswer,
} from "./kit";
import { CASH } from "./ledger";

/** A showroom, as in demo flow G3-7: its own Profit by location row, apart from the warehouses F1 and F2 use. */
const LOCATION = "Summit Design Studio";

/** The location's row in the Business report's Profit by location section: its id and net profit. */
function locationProfit(report: BusinessReport): { id: string; net: string } {
  const row = report.sections.find((s) => s.key === "locations")?.rows.find((r) => r.label === LOCATION);
  const net = row?.values.net;
  if (!row || net === undefined) throw new Error(`Profit by location has no "${LOCATION}" row with a net profit.`);
  return { id: row.id, net };
}

/** Switches a Business report section with a chart to its table and returns the section's panel. */
async function sectionTable(page: Page, title: string) {
  await page
    .getByRole("group", { name: `${title} view` })
    .getByRole("button", { name: "Table" })
    .click();
  return page.getByRole("region", { name: title, exact: true }).first();
}

/**
 * Flow F7 (mirrors demo flow G3-7; plan-final.md section 1): the accountant records an expense with
 * its receipt for a showroom. The ledger moves the category's account and cash by its cost, the
 * Business report takes the cost off that location's net profit and drills down to the expense, and
 * the void puts the books and the profit back. Every amount comes from the answers the screens got.
 */
flowTest.describe("flow F7: expense to location profit and back", () => {
  resetAuthAround([ACCOUNTANT_EMAIL]);

  flowTest(
    "an expense with a receipt moves the ledger and the location's profit, and its void puts both back",
    { tag: FLOW_TAG },
    async ({ personas }) => {
      flowTest.setTimeout(90_000);
      const run = runId();
      const start = companyToday();
      const since = Date.now();
      const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
      const { page } = grace;

      const t0 = await flowTest.step("0. the books before", () => trialBalance(grace.request));
      const before = await flowTest.step("1. the Business report before, This month", async () =>
        locationProfit(await openBusinessReport(page)),
      );

      const expense = await flowTest.step("2. record the expense with its receipt", async () => {
        await page.goto("/finance?view=expenses");
        await page.getByRole("button", { name: "New expense" }).click();
        const dialog = page.getByRole("dialog", { name: "New expense" });
        await dialog.getByLabel("Location").click();
        await page.getByRole("option", { name: LOCATION, exact: true }).click();
        await dialog.getByLabel("Amount before tax").fill("432.10");
        await dialog.getByLabel("Reference", { exact: true }).fill(`e2e-flow-${run}`);
        await expect(dialog.getByLabel("Payment", { exact: true })).toHaveText("Paid already");
        await dialog.locator('input[type="file"]').setInputFiles(PDF_PROOF);
        const answer = waitForAnswer<Expense>(page, "POST", /^\/api-proxy\/expenses$/);
        await dialog.getByRole("button", { name: "Record expense" }).click();
        const saved = await answer;
        personas.onCleanup(`void ${saved.number}`, () =>
          grace.request.post(`/api-proxy/expenses/${saved.id}/void`, { data: { reason: "e2e flow clean-up" } }),
        );
        await expect(page.getByText(`Expense ${saved.number} recorded`, { exact: true })).toBeVisible();
        expect(
          saved.status,
          "Summit's expenses under its approval threshold post when recorded; a changed local threshold holds this one",
        ).toBe("confirmed");
        expect(saved.settlement).toBe("paid");
        expect(saved.locationId, `the expense is at ${LOCATION}`).toBe(before.id);
        expect(saved.files, "the receipt is stored with the expense").toHaveLength(1);
        return saved;
      });
      const cost = expenseCost(expense);

      await flowTest.step("2. the ledger: the category's account up by the cost, cash down by it", async () => {
        expectLedgerMoved(t0, await trialBalance(grace.request), {
          [EXPENSE_ACCOUNTS[expense.category]]: cost,
          [CASH]: cost.negated(),
        });
      });

      await flowTest.step("3. the Business report after: the cost comes off the location's profit", async () => {
        const after = locationProfit(await openBusinessReport(page));
        expect(
          dec(after.net).eq(dec(before.net).minus(cost)),
          `${LOCATION}: ${before.net} less ${cost} is ${after.net}`,
        ).toBe(true);
        const profit = await sectionTable(page, "Profit by location");
        const row = profit.getByRole("row", { name: new RegExp(`^${LOCATION}`) });
        await expect(await cellUnder(profit, row, "Net profit")).toHaveText(shownMoney(after.net));

        const spent = await sectionTable(page, "Expenses by location");
        await spent.getByRole("button", { name: LOCATION, exact: true }).click();
        const drill = page.getByRole("dialog", { name: LOCATION });
        await expect(drill.getByRole("link", { name: new RegExp(`^${expense.number},`) })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(drill).toBeHidden();
      });

      await flowTest.step("4. void the expense: the books and the profit are back", async () => {
        await page.goto("/finance?view=expenses");
        await page.getByPlaceholder("Search expenses").fill(expense.number);
        await page.getByRole("row", { name: `Open ${expense.number}`, exact: true }).click();
        await page.getByRole("button", { name: "Void", exact: true }).click();
        const reason = page.getByRole("dialog", { name: `Void ${expense.number}` });
        await reason.getByLabel("Reason").fill("e2e flow clean-up");
        const answer = waitForAnswer<Expense>(page, "POST", new RegExp(`^/api-proxy/expenses/${expense.id}/void$`));
        await reason.getByRole("button", { name: "Void expense" }).click();
        expect((await answer).status).toBe("voided");
        await expect(reason).toBeHidden();

        expectLedgerMoved(t0, await trialBalance(grace.request), {});
        const back = locationProfit(await openBusinessReport(page));
        expect(dec(back.net).eq(before.net), `${LOCATION}'s profit is back to ${before.net}, not ${back.net}`).toBe(
          true,
        );
      });

      await flowTest.step("5. the audit log", () =>
        expectAuditRows(page, expense.number, ["Recorded expense", "Voided expense"], since),
      );
      assertSameCompanyDay(start);
    },
  );
});
