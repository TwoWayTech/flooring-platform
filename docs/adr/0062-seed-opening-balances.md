# ADR 0062: The dev seed posts opening balances

- **Status:** accepted, 2026-11-21, on branch `feat/db-seed-opening-balances`. Owner decision 1 of [ADR 0061](0061-owner-decisions-after-click-through.md); closes click-through finding #13 (major). Session log docs/sessions/2026-11-21-2030-a-seed-opening-balances.md.
- **Context:**
  - `pnpm db:seed` writes a year of Summit Floor Co.'s documents (about $2M of invoices, $243K still owed, $548K of stock) but no journal entry: seeded history "posts no journal entry, the ledger starts at go-live". So the trial balance started at Dr 0.00 / Cr 0.00 while the screens showed receivables, payables and stock.
  - Every posting after that is a change to balances the ledger never held. In the click-through, settling seeded documents left Cash $4,390.52 **credit**, Inventory $214.59 credit, and Accounts Receivable credited $1,500 for an invoice it never held, although every step balanced on its own.
  - The ledger's posting path is the API's `LedgerService`; `packages/db` (the seed) cannot depend on `apps/api`.

## Decision

1. **One opening-balance entry per seeded company**, posted by the seed in the same transaction as the documents (`seedOpeningBalances`, `packages/db/src/seed/opening-balances.ts`), last, after every module's rows. It is built by a shared posting rule, `openingBalancePosting` (`packages/shared/src/accounting/opening-postings.ts`):
   - **Debits** Cash; Accounts Receivable per customer; Retainage Receivable per customer; Inventory per warehouse.
   - **Credits** Accounts Payable; Goods Received Not Billed; Retainage Payable; Customer Credit per customer.
   - **The difference goes to a new account, Opening Balance Equity** (`opening_balance_equity`, code 3900, equity), so the entry balances. A figure of zero has no line; with nothing to open there is no entry.
   - Event `opening_balance.posted`, source type `opening_balance` (or `opening_balance_contract`, see 9), source number "Opening balances", memo **"Opening balances (seed)"**.
2. **Each figure is worked out from the fixtures with the same shared rules the screens use**, so every balance-sheet account matches its documents:
   - receivables: each invoice's balance (`invoiceLedger`: total less confirmed payments, applied credits and write-offs; void invoices and credit notes owe nothing);
   - customer credit: `customerCredit`;
   - retainage: what contract invoices and subcontract bills withheld and did not release;
   - payables: each bill's balance (`billLedger`);
   - goods received not billed: receipts no bill covers, at the order's cost (`unbilledReceipts`, `receivedValue`). This is what a later bill for them debits, so it must be there;
   - stock: `inventoryValuation`'s rule (each roll's remaining area at its own cost, boxed goods at average cost) per warehouse. Each warehouse is rounded to cents, and any cent the rounding loses goes to the first warehouse, so the lines add up to the rounded stock value exactly.
3. **Cash, the one figure the fixtures don't hold.** There is no seeded bank balance. The net of the other figures would put Opening Balance Equity at zero and mean nothing. So opening cash covers **everything the seed owes**: open bills, goods received not billed, retainage payable, customer credit and approved, unpaid contractor payments, **rounded up to the next whole $10,000**. Paying every seeded debt then never takes Cash below zero.
4. **Dated the day before the earliest document still open**: an open invoice or bill, an unbilled receipt, a contract document holding retainage, or an approved contractor payment. With none, it is the day before the fixtures' anchor date. Later postings on those documents then move balances the ledger already holds.
5. **The posting path.** The seed builds the draft with the shared rule, refuses it with the shared `postingProblem` (as `LedgerService.post` does), makes the default chart of accounts as `LedgerService.accounts` does (missing keys only, so existing accounts keep their ids), and writes the entry and its lines the way `LedgerService` writes them. The database's own triggers check the balance, the one-sided lines and the open period again.
6. **Idempotent.** The entry's id and source id are `seedId("<company>:opening-balances")`, its lines' ids are stable too, and the insert is `on conflict do nothing`. A second seed finds the entry and writes nothing. Figures come from the fixtures, not from the database, so re-seeding a database where people have since recorded payments is still right: their postings are changes from the fixtures' state.
7. **Opening Balance Equity joins the default chart** (`DEFAULT_ACCOUNTS`). It is a row in `ledger_accounts`, made by the first posting like every default account; no migration. Real companies get it too, with nothing on it, until the import module posts their opening balances (STATUS, "Opening balances").
8. **Harbor Staffing Co. (HR Suite)** has no receivables, bills or stock. The app never pays Accrued Payroll out (the payroll provider does), so no payroll liability is opened. Its entry is cash for its approved contractor payments ($10,000) against Opening Balance Equity. Paying them doesn't take Cash below zero.
9. **Trial balance sight (ADR 0055).** The opening entry reveals stock at cost like any stock posting (`SOURCE_SIGHT.opening_balance = "cost"`). Its Retainage Payable line is a share of what a subcontract cost, which only contract-cost holders see. So `trialBalanceFacts` now counts **a line on Retainage Payable as a contract posting, whatever its source** (`CONTRACT_ACCOUNT_KEYS`), the same way pay is caught by its accounts. Its Accounts Payable line can also hold a subcontract bill, which shows that bill's cost even with no retainage. So when an open or retaining bill is a subcontract bill (`holdsSubcontractBill`), the entry posts as **`opening_balance_contract`**, a contract source (`SOURCE_SIGHT` "contract"), and the trial balance needs contract cost sight. Summit owes one, so its entry is `opening_balance_contract`; Harbor's is `opening_balance`. Summit's Owner and Accountant hold `contracts.contract.view_sensitive`, so they keep the report. The Manager and Sales never had it.

Summit's entry, from the current fixtures, dated 2026-01-07:

| Account | Debit | Credit |
| --- | --- | --- |
| Cash and Bank | 130,000.00 | |
| Accounts Receivable (per customer) | 243,396.38 | |
| Retainage Receivable | 5,300.00 | |
| Inventory (2 warehouses) | 548,654.55 | |
| Accounts Payable | | 48,172.83 |
| Goods Received Not Billed | | 78,758.00 |
| Retainage Payable | | 370.00 |
| Opening Balance Equity | | 800,050.10 |

## Consequences

- From the first sign-in Summit's trial balance balances. Accounts Receivable equals the open invoice balances, Accounts Payable the open bills and Inventory the stock value. Recording a payment on a seeded invoice lowers receivables by what it settles, to the remaining balances and never below zero (`apps/api/test/opening-balances.int.test.ts`).
- The Business report and Profit and loss read documents, not the ledger, and are unchanged. The opening entry has no revenue or expense line either.
- The money-integrity (MI-*) and new-company (FA-*) checks run on freshly provisioned companies, which have no opening entry. Their chart gains one empty account, which the tests already derive from `DEFAULT_ACCOUNTS`, and they pass unchanged. `seed.int.test.ts` now expects the one opening entry where it expected none.
- The trial balance screen's footnote now says the books hold "the opening balances entry, if the company has one, for what it held and owed when it started using the app, and everything recorded since".
- **Left open:** Sales Tax Payable is not opened. What the seeded invoices collected less seeded sales tax payments is the sales tax report's figure, and it waits for the accountant (ADR 0061 decision 10). A sales tax payment recorded now can take that account into debit. Accrued Payroll is not opened (nothing pays it out in the app). Seeded pending expenses confirmed later reduce Cash, which the rounding margin and the receivables collected cover in practice, but are not counted in the cash figure. Making the default accounts skips existing keys only: a company that already added its own account with a default's code (3900, say) fails the unique code index, in the seed as in `LedgerService.accounts`; picking free codes for defaults is for the chart-of-accounts settings.
- **Alternatives:** one entry per document (thousands of entries; the owner chose one); Owner's Equity as the other side (mixes the opening position with the owners' later contributions); posting through `LedgerService` in an API-side seed step (the seed runs without the API, in CI and on a laptop, inside provisioning's prepare step); cash as the net of the other figures (Opening Balance Equity would be zero and Cash meaningless).
