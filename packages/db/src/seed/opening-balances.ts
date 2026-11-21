import {
  addDays,
  billLedger,
  boxedStock,
  customerCredit,
  dec,
  DEFAULT_ACCOUNTS,
  ledgerIndex,
  moneyString,
  openingBalancePosting,
  postingProblem,
  receivedValue,
  roundMoney,
  rollValue,
  sum,
  unbilledReceipts,
  type CompanyFixtures,
  type Dec,
  type OpeningAmount,
  type OpeningBalances,
  type PostingDraft,
} from "@workspace/shared";
import { inArray } from "drizzle-orm";
import type { CompanyDb } from "../client";
import { journalEntries, journalLines, ledgerAccounts } from "../company";
import { seedId, type DemoCompany } from "./fixtures";
import { userOf } from "./values";

/** The memo of the seed's opening-balance entry (ADR 0062). */
export const OPENING_MEMO = "Opening balances (seed)";

/** Opening cash is rounded up to a whole multiple of this, so it reads as a bank balance (ADR 0062). */
const CASH_STEP = dec(10000);

/** The seed's opening-balance entry's id, and its source id: stable, so seeding twice posts once. */
export function openingEntryId(companyId: string): string {
  return seedId(`${companyId}:opening-balances`);
}

/** Adds amounts by a key, leaving out keys whose total is zero, each rounded to cents. */
function byKey<T>(items: readonly T[], key: (item: T) => string, amount: (item: T) => Dec): Map<string, string> {
  const totals = new Map<string, Dec>();
  for (const item of items) totals.set(key(item), (totals.get(key(item)) ?? dec(0)).plus(amount(item)));
  return new Map(
    [...totals.entries()].filter(([, total]) => !roundMoney(total).isZero()).map(([k, v]) => [k, moneyString(v)]),
  );
}

function perCustomer(totals: ReadonlyMap<string, string>): OpeningAmount[] {
  return [...totals.entries()].map(([customerId, amount]) => ({ customerId: seedId(customerId), amount }));
}

/**
 * Stock on hand at cost per warehouse, as the stock screens value it (`inventoryValuation`: each
 * roll's remaining area at its own cost, boxed goods at their average cost). Each warehouse is
 * rounded to cents and any cent the rounding loses goes to the first one, so the lines add up to
 * the company's rounded stock value exactly.
 */
function stockByWarehouse(fixtures: CompanyFixtures): OpeningAmount[] {
  const cost = new Map(fixtures.products.map((product) => [product.id, product.cost]));
  const values = new Map<string, Dec>();
  const add = (locationId: string, value: Dec) =>
    values.set(locationId, (values.get(locationId) ?? dec(0)).plus(value));
  for (const roll of fixtures.rolls) if (dec(roll.remainingLengthFt).gt(0)) add(roll.locationId, rollValue(roll));
  for (const location of fixtures.locations) {
    for (const [productId, quantity] of boxedStock(fixtures.stockMovements, location.id)) {
      add(location.id, quantity.times(cost.get(productId) ?? 0));
    }
  }
  const lines = [...values.entries()]
    .filter(([, value]) => !roundMoney(value).isZero())
    .map(([locationId, value]) => ({ locationId, value: roundMoney(value) }));
  const lost = roundMoney(sum([...values.values()])).minus(sum(lines.map((line) => line.value)));
  return lines.map((line, index) => ({
    locationId: seedId(line.locationId),
    amount: moneyString(index === 0 ? line.value.plus(lost) : line.value),
  }));
}

/** Rounds up to the next whole CASH_STEP; zero stays zero. */
function roundedUp(amount: Dec): Dec {
  return amount.div(CASH_STEP).ceil().times(CASH_STEP);
}

/** The opening balances and the day the books open, or null when the seed holds nothing to open. */
export interface SeedOpening {
  date: string;
  balances: OpeningBalances;
}

/**
 * What a demo company holds and owes when its books open (ADR 0062), worked out from its fixtures
 * with the same rules the screens use, so each balance-sheet account matches its documents:
 * - receivables: each invoice's balance (`invoiceLedger`: total less confirmed payments, credits
 *   and write-offs), per customer; customer credit as `customerCredit` works it out;
 * - retainage: what contract invoices and subcontract bills withheld and did not release;
 * - payables: each bill's balance (`billLedger`); goods received not billed: the receipts no bill
 *   covers, at the order's cost (`receivedValue`), which a later bill clears;
 * - stock: its value at cost per warehouse;
 * - cash: a bank balance that covers everything the seed owes (payables, goods received not billed,
 *   retainage payable, customer credit and approved contractor payments), rounded up to the next
 *   $10,000, so paying every seeded debt never takes Cash below zero. The fixtures hold no bank
 *   balance, and the net of the other figures would make Opening Balance Equity meaningless.
 * The books open the day before the earliest document still open on that day, or the day before
 * the fixtures' anchor date when none is.
 */
export function seedOpening(fixtures: CompanyFixtures): SeedOpening | null {
  const today = fixtures.anchorDate;
  const ledgers = ledgerIndex(
    fixtures.invoices,
    { payments: fixtures.payments, adjustments: fixtures.invoiceAdjustments },
    today,
  );
  const openInvoices = fixtures.invoices.filter((invoice) => dec(ledgers.get(invoice.id)!.balance).gt(0));
  const receivables = byKey(
    openInvoices,
    (invoice) => invoice.customerId,
    (invoice) => dec(ledgers.get(invoice.id)!.balance),
  );
  const credit = new Map(
    fixtures.customers
      .map(
        (customer) =>
          [
            customer.id,
            customerCredit(customer.id, fixtures.invoices, ledgers, fixtures.invoiceAdjustments, fixtures.refunds),
          ] as const,
      )
      .filter(([, amount]) => amount.gt(0))
      .map(([id, amount]) => [id, moneyString(amount)]),
  );
  const heldInvoices = fixtures.invoices.filter(
    (invoice) =>
      !invoice.voidedAt &&
      dec(invoice.retainageWithheld ?? 0)
        .minus(invoice.retainageReleased ?? 0)
        .gt(0),
  );
  const retainageReceivable = byKey(
    heldInvoices,
    (invoice) => invoice.customerId,
    (invoice) => dec(invoice.retainageWithheld ?? 0).minus(invoice.retainageReleased ?? 0),
  );
  const billBalances = fixtures.bills.map((bill) => ({
    bill,
    balance: dec(billLedger(bill, fixtures.supplierPayments, today).balance),
  }));
  const openBills = billBalances.filter((entry) => entry.balance.gt(0)).map((entry) => entry.bill);
  const unbilled = fixtures.purchaseOrders.map((po) => ({
    po,
    receipts: unbilledReceipts(po, fixtures.receipts, fixtures.bills),
  }));
  const receivedNotBilled = sum(unbilled.map((entry) => receivedValue(entry.po, entry.receipts)));
  const heldBills = fixtures.bills.filter((bill) =>
    dec(bill.retainageWithheld ?? 0)
      .minus(bill.retainageReleased ?? 0)
      .gt(0),
  );
  const retainagePayable = sum(
    heldBills.map((bill) => dec(bill.retainageWithheld ?? 0).minus(bill.retainageReleased ?? 0)),
  );
  const payables = sum(billBalances.map((entry) => entry.balance));
  const contractorsOwed = fixtures.contractorPayments.filter((payment) => payment.status === "approved");
  const owed = sum([
    payables,
    receivedNotBilled,
    retainagePayable,
    ...credit.values(),
    ...contractorsOwed.map((payment) => payment.amount),
  ]);
  const balances: OpeningBalances = {
    cash: moneyString(roundedUp(owed)),
    receivables: perCustomer(receivables),
    retainageReceivable: perCustomer(retainageReceivable),
    inventory: stockByWarehouse(fixtures),
    payables: moneyString(payables),
    receivedNotBilled: moneyString(receivedNotBilled),
    retainagePayable: moneyString(retainagePayable),
    customerCredit: perCustomer(credit),
  };
  const opened = [
    ...openInvoices.map((invoice) => invoice.issuedAt),
    ...heldInvoices.map((invoice) => invoice.issuedAt),
    ...openBills.map((bill) => bill.issuedAt),
    ...heldBills.map((bill) => bill.issuedAt),
    ...unbilled.flatMap((entry) => entry.receipts.map((receipt) => receipt.receivedAt)),
    ...contractorsOwed.map((payment) => payment.date),
  ].map((day) => day.slice(0, 10));
  const earliest = opened.sort()[0] ?? today;
  const draft = openingBalancePosting({ id: "", date: addDays(earliest, -1), memo: OPENING_MEMO }, balances);
  return draft.lines.length === 0 ? null : { date: draft.date, balances };
}

/**
 * Makes the default chart of accounts in a seeded company, as the ledger's first posting does
 * (LedgerService.accounts), with stable ids, and returns each account's id by key. Accounts the
 * ledger already made keep their ids.
 */
async function seedAccounts(tx: CompanyDb, companyId: string): Promise<Map<string, string>> {
  await tx
    .insert(ledgerAccounts)
    .values(DEFAULT_ACCOUNTS.map((account) => ({ id: seedId(`${companyId}:account:${account.key}`), ...account })))
    .onConflictDoNothing({ target: ledgerAccounts.key });
  const rows = await tx
    .select({ id: ledgerAccounts.id, key: ledgerAccounts.key })
    .from(ledgerAccounts)
    .where(
      inArray(
        ledgerAccounts.key,
        DEFAULT_ACCOUNTS.map((account) => account.key),
      ),
    );
  return new Map(rows.flatMap((row) => (row.key ? [[row.key, row.id] as const] : [])));
}

/**
 * Posts the demo company's opening balances as one balanced journal entry (ADR 0062; CLAUDE.md
 * rule 10), in the seed's transaction. The seed cannot reach the API's LedgerService, so it builds
 * the entry with the same shared posting rule (`openingBalancePosting`), refuses it with the same
 * check (`postingProblem`) and writes it the way the ledger does; the database's triggers check the
 * balance and the open period again. The entry's stable id makes it post once: a second seed finds
 * it and writes nothing. Its date is before every seeded document still open, so later postings on
 * those documents move balances that already hold them.
 */
export async function seedOpeningBalances(tx: CompanyDb, { company, fixtures }: DemoCompany): Promise<void> {
  const opening = seedOpening(fixtures);
  if (!opening) return;
  const id = openingEntryId(company.id);
  const draft: PostingDraft = openingBalancePosting({ id, date: opening.date, memo: OPENING_MEMO }, opening.balances);
  const problem = postingProblem(draft.lines);
  if (problem) throw new Error(`Opening balances for ${company.id}: ${problem}`);
  const accounts = await seedAccounts(tx, company.id);
  const by = userOf(fixtures.users.find((user) => user.roleIds.some((role) => role.endsWith("-owner")))?.id);
  const [posted] = await tx
    .insert(journalEntries)
    .values({
      id,
      date: draft.date,
      event: draft.event,
      sourceType: draft.sourceType,
      sourceId: draft.sourceId,
      sourceNumber: draft.sourceNumber,
      memo: draft.memo,
      createdBy: by,
    })
    .onConflictDoNothing()
    .returning({ id: journalEntries.id });
  if (!posted) return;
  await tx.insert(journalLines).values(
    draft.lines.map((line, index) => {
      const accountId = accounts.get(line.account);
      if (!accountId) throw new Error(`Opening balances for ${company.id}: no ${line.account} account.`);
      return {
        id: seedId(`${company.id}:opening-balances:line:${index}`),
        entryId: id,
        accountId,
        debit: line.debit,
        credit: line.credit,
        locationId: line.locationId,
        customerId: line.customerId,
        createdBy: by,
      };
    }),
  );
}
