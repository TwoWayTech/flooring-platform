# ADR 0023: Expenses, shared costs and location profit in the business report

Date: 2026-11-10. Status: proposed (waiting for the owner's OK on the Phase 0 plan).

## Context

Feature batch 3, Batch F (spec F1 and F2, client note 8, assumption F-1) adds recorded expenses with a location, recurring expenses, a rule for sharing company-wide costs, and one business report that replaces four others.

Today `Expense` (`packages/shared/src/types/purchasing.ts`) holds only a date, a category, a description and an amount, and `monthlyPnl` in `packages/shared/src/analytics.ts` subtracts those from invoice subtotals less invoice cost. Four facts in the code shape this decision. `Invoice.locationId` is the warehouse the goods ship from, and showrooms never hold stock (`types/locations.ts`), while Summit has two showrooms and Keystone one (`scripts/fixtures/locations.ts`). `Employee` has no location (`types/hr.ts`), and no gross pay calculation exists yet. The seeded `payroll` expense is the largest category, at 42% of gross margin against 34.5% for all the others combined (`scripts/fixtures/purchasing.ts`), and the spec's new category list has no payroll. The demo has no double-entry journal: `ledger.ts` computes a balance per invoice.

## What we learned

"(snippet)" means the claim comes from a search result extract and the page itself was not opened. The Sources section lists which is which.

### The blueprint's posting rules (`docs/blueprint/blueprint.pdf`, pages 24, 25, 34 and 48)

- Every financial event posts a double-entry journal automatically, and users never see debits and credits (page 24). An invoice debits Accounts Receivable and credits Sales and Sales Tax Payable (page 24), and a deposit credits Customer Deposits, a liability (page 25).
- **Expense entered:** debit the expense account, credit Cash / Bank or Accounts Payable, so an expense can be paid now or owed. **Supplier payment:** debit Accounts Payable, credit Cash / Bank (page 25).
- **Payroll export (gross pay):** debit Wages Expense, credit Accrued Payroll. The default expense accounts are Wages, Rent, Utilities, Vehicles and Other Expenses, and a company can rename and add accounts (page 25).
- Posted invoices, bills and payments are immutable: reverse, never edit (page 34). The document and its balanced journal commit in one transaction, voids post reversals, closed periods refuse postings, and tests must show debits equal credits and a trial balance of zero (page 48).
- **Gaps in the blueprint:** there is no row for paying sales tax to the state, so Sales Tax Payable only ever grows, and no row for writing off a bad debt.

### QuickBooks

- An expense is a cost already paid, and a cost to be paid later is entered as a bill. An expense has a payee, payment account, date, optional method, optional reference, category, amount and tax, and a receipt can be attached ([Enter and manage expenses](https://quickbooks.intuit.com/learn-support/en-us/help-article/cash-drawer/enter-manage-expenses-quickbooks-online/L1XojuBAW_US_en_US)). Receipts can also be uploaded or emailed, then wait in a For review list ([Upload receipts](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-transactions/upload-receipts-bills-quickbooks-online/L862MmZHn_US_en_US), snippet).
- Recurring templates come in three types. Scheduled ones run by themselves and suit fixed amounts such as rent. Reminder ones follow a schedule but wait for a person, and suit utility bills that need editing. Unscheduled ones are saved for reuse ([Recurring transactions](https://quickbooks.intuit.com/learn-support/en-global/help-article/recurring-transactions/create-recurring-transactions-quickbooks-online/L3WoKX2R8_ROW_en)). The spec's "draft to confirm" is the Reminder type.
- Location tracking needs the Plus or Advanced plan ([Location tracking](https://quickbooks.intuit.com/learn-support/en-us/help-article/track-location/set-use-location-tracking/L2raFkEBC_US_en_US)). A location applies to a whole transaction and a class to each line, and reports summarise income and expenses by class or location ([Intuit blog](https://quickbooks.intuit.com/au/blog/product-update/using-classes-and-locations-in-quickbooks-online/)). Class tracking can warn when a transaction has no class ([Turn on class tracking](https://quickbooks.intuit.com/learn-support/en-us/help-article/class-list/turn-class-tracking-quickbooks-online/L1uqOta7C_US_en_US)).
- One expense cannot be split across locations in Online. Staff confirmed this in 2022, and the workaround is a manual journal entry or a shared "all" location ([Intuit community](https://quickbooks.intuit.com/learn-support/en-us/banking/how-to-split-a-bank-transaction-expense-to-multiple-locations/00/516705)). I looked for a built-in allocation rule in the Advanced plan and Intuit Enterprise Suite and found no Intuit document either way, so that is not verified.
- Sales tax paid to the state is recorded from the Sales Tax centre, to bring sales tax payable back to zero ([Record tax payment](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-sales-taxes/file-sales-tax-return-record-tax-payment-online/L7ZeSlAr1_US_en_US)). The Desktop article says not to use Write Checks or Pay Bills for it ([Pay sales tax](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-sales-taxes/pay-sales-tax/L6rrxxRES_US_en_US), snippet).
- A profit and loss report can switch between accrual and cash, and the difference is the date used ([Intuit community](https://quickbooks.intuit.com/learn-support/en-us/account-management/cash-vs-accrual-when-running-a-profit-and-loss-for-the-same/00/887049), snippet).

### Odoo

- Analytic distribution is set per line on an invoice or bill, and one line can be split between accounts by percentage ([Analytic accounting 19.0](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/analytic_accounting.html)). Each plan must total 100%. Distribution models apply a split automatically by account prefix, partner, product, product category or company, and the documented example splits utilities 60/30/10 across departments ([Analytic accounting 20.0](https://www.odoo.com/documentation/20.0/applications/finance/accounting/reporting/analytic_accounting.html)). The page does not say how this interacts with the general ledger, so that is not verified.
- Only an approved expense can be posted, and posting creates the journal entry ([Post expenses 19.0](https://www.odoo.com/documentation/19.0/applications/finance/expenses/post_expenses.html)). A confirmed vendor bill gets a number and a journal entry and cannot be edited unless it is reset to draft ([Vendor bills 18.0](https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills.html)).

### How shared overhead is split

US Cost Accounting Standards bind government contractors, not flooring retailers, but they are the clearest public statement of the principle. Costs go directly to segments as far as practical, and the rest follow a causal or beneficial relationship ([48 CFR 9904.403-40](https://www.law.cornell.edu/cfr/text/48/9904.403-40)). The preferred base is a measure of activity, with square feet for space-related functions, and a residual is spread by an average of payroll, revenue and asset shares ([48 CFR 9904.403-50](https://www.law.cornell.edu/cfr/text/48/9904.403-50)). Costs pooled together should have a similar relationship to what they serve ([48 CFR 9904.418-50](https://www.law.cornell.edu/cfr/text/48/9904.418-50)). A textbook lists number of segments, share of revenue and share of square footage as the common formulas ([OpenStax 10.4](https://openstax.org/books/principles-managerial-accounting/pages/10-4-evaluate-and-determine-whether-to-keep-or-discontinue-a-segment-or-product)).

| Method | Suits | Pitfalls |
|---|---|---|
| Revenue share | Costs with no physical driver, such as accounting fees and software | Charges the most to the best performer, a location with no sales carries nothing, and the base moves when a past month's invoices change (our reasoning) |
| Floor area | Rent and other occupancy costs ([9904.403-50](https://www.law.cornell.edu/cfr/text/48/9904.403-50)) | Warehouse and showroom space do not cost the same, and areas must be kept up to date (our reasoning) |
| Equal | A few similar locations | Ignores size (our reasoning) |
| Fixed percentages | An agreed split ([Odoo 20.0](https://www.odoo.com/documentation/20.0/applications/finance/accounting/reporting/analytic_accounting.html)) | Goes stale, and must be revisited when a location opens or closes (our reasoning) |

- Any method can mislead: a segment with a positive contribution can look unprofitable because of its allocated common costs ([OpenStax 10.4](https://openstax.org/books/principles-managerial-accounting/pages/10-4-evaluate-and-determine-whether-to-keep-or-discontinue-a-segment-or-product)). Managers cannot control allocated costs ([OpenStax 9.4](https://openstax.org/books/principles-managerial-accounting/pages/9-4-describe-the-effects-of-various-decisions-on-performance-evaluation-of-responsibility-centers), snippet). Retailers therefore report a store-level measure before corporate costs ([DXL 10-K](https://www.sec.gov/Archives/edgar/data/813298/000095017025042703/dxlg-20250201.htm), [Kura Sushi 10-K](https://www.sec.gov/Archives/edgar/data/1772177/000156459019044555/krus-10k_20190831.htm), snippets).
- Do not change the driver after a location has a bad month, and do not allocate a cost that belongs to one location ([Paycove](https://www.paycove.io/learn/cost-allocation)).
- Rounding can lose pennies ([Fowler, Money](https://martinfowler.com/eaaCatalog/money.html)). The largest remainder method makes rounded shares add up to the total ([Math.Apportionment](https://hackage.haskell.org/package/apportionment-0.0.0.4/docs/Math-Apportionment.html), snippet), and Dinero's `allocate` hands out the leftover units as evenly as possible ([Dinero docs](https://v2.dinerojs.com/docs/api/mutations/allocate), snippet).

### Sales tax and the basis of the report

- Sales tax imposed on the buyer that you must collect and turn over is generally not income, while tax imposed on you as the seller is included in gross receipts. You do not deduct tax you collected, sales tax you pay is part of the cost of what you bought, and federal income tax is not deductible ([IRS Pub 334](https://www.irs.gov/publications/p334)).
- A person who collects tax holds it in trust for the state ([Tex. Tax Code 111.016](https://texas.public.law/statutes/tex._tax_code_section_111.016)). Texas lets a seller report sales tax on a cash or accrual basis if done consistently ([STAR ruling](https://star.comptroller.texas.gov/view/9010L1049C07), snippet). I did not survey other states.
- Under US GAAP, a company may elect to exclude collected sales taxes from revenue ([Journal of Accountancy](https://www.journalofaccountancy.com/issues/2016/jul/fasb-issues-revenue-recognition-changes-practical-expedients/)). Taxes on total gross receipts and on inventory procurement fall outside that election ([Deloitte 6.7](https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-6-step-3-determine-transaction/6-7-sales-taxes-similar-taxes), snippet).
- Accrual matches income and expenses in the same period, a business with necessary inventory uses accrual for purchases and sales, and the method must be consistent ([IRS Pub 538](https://www.irs.gov/publications/p538)). The SBA contrasts accrual and cash, and lists receivables, payables, available cash and payroll among the records to keep ([SBA](https://www.sba.gov/counseling/manage-your-business/)).
- Expense records should show the payee, amount, proof of payment, date and what was bought, and a combination of documents may be needed ([IRS records](https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep)).

## Decision

- **Expense:** `number` (EXP-0001), `date`, `supplierId`, `category`, `locationId` (null means company-wide), `amount` (before tax), `tax`, `paymentMethod`, `reference`, `files`, `note`, `status`, `settlement` (paid, on_account), `dueAt`, `billId`, `recurringId`, `period`, plus recorder, reviewer and void fields as on `Payment`. The cost is `amount + tax`, always derived, because US sales tax on a purchase is part of its cost.
- **Categories** are the spec's twelve (rent, electricity, water, internet and phone, supplies, maintenance and repairs, fuel and vehicles, insurance, taxes and licences, marketing, professional fees, other), plus `sales_tax_payment`. Picking `sales_tax_payment` forces company-wide, clears the tax field and excludes the record from every cost total.
- **Statuses:** draft, pending, confirmed, rejected, voided, following `PaymentStatus`. Draft needs no receipt and is never posted. Leaving draft needs at least one file: a receipt, statement or lease all count. With approval off, or at or below the threshold, the expense confirms at once; above it, it waits as pending for someone other than the recorder. A rejection needs a reason and sends the expense back to draft. `CompanySettings.expenses` has the same `approvalRequired` and `approvalThreshold` as payments, so the same form is reused. A confirmed expense is never edited: it is voided with a reason and entered again.
- **Pay later.** The form asks Paid already (default) or Pay later, with a due date from the supplier's terms. Pay later creates a linked bill with no purchase order, a kind the import already makes (ADR 0019), so existing supplier payments, aging and "you owe suppliers" work with no new logic.
- **RecurringExpense:** `supplierId`, `category`, `locationId`, estimated `amount` and `tax`, `paymentMethod`, `frequency` (monthly, quarterly, yearly), `dayOfMonth` (clamped to the month's last day), `startsOn`, `endsOn`, `active`, `note`. `dueRecurringDrafts(templates, expenses, today)` makes one draft per template and period, is safe to repeat (the key is template plus period, and it stays used after a void), and catches up at most twelve periods. The report states how many drafts it leaves out and their estimated value.

**Posting.** `packages/shared/src/journal.ts` derives lines from documents and stores nothing (ADR 0013), and a test proves debits equal credits for every expense state. A share of a company-wide cost is a report dimension and never a journal entry; the debit line carries `locationId`. Rent maps to Rent; electricity, water, internet and phone to Utilities; fuel and vehicles to Vehicles; other to Other Expenses; and the rest to new accounts Supplies, Repairs and Maintenance, Insurance, Taxes and Licences, Marketing, and Professional Fees.

| Event | Debit | Credit |
|---|---|---|
| Expense confirmed | Category account, full cost | Cash or Bank when paid; Accounts Payable when pay later |
| Pay-later expense paid | Accounts Payable | Cash or Bank |
| Sales tax payment | Sales Tax Payable | Cash or Bank |
| Void | Reverse of the above, on the void date | |

**Which location a figure belongs to, and the sharing rule.**
- New `Quote.soldAtLocationId` and `Invoice.soldAtLocationId`, editable on the quote, defaulting to a showroom in the rep's branch if there is one, else the fulfilling warehouse. Revenue, cost of goods and write-offs follow it, so margin is never split between two places. Fixtures draw no new random numbers: homeowner customers go to the branch's showroom when it has one, and dealers and contractors to the warehouse.
- New `Employee.homeLocationId` (nullable), set from the linked user where there is one. Gross pay and commissions go to it. New `Location.floorAreaSqFt`, in Settings under Warehouses and showrooms.
- `CompanySettings.sharedCosts` is `{ rule, categoryRules, fixedPct }`. `rule` defaults to revenue (F-1 stands), `categoryRules` is empty by default, and `fixedPct` must total exactly 100 on save. The split uses the month of the cost, so January plus February always equals the two-month report.

```
For each confirmed company-wide cost of T cents, in month m:
  weight(i) = revenue: max(0, net revenue of i in m, in cents)  | floor_area: area of i, in hundredths of a sq ft
              equal: 1  | fixed: percentage of i, in hundredths
  W = sum of weight(i) over the company's locations. If W = 0, use floor_area; if that is also 0, use equal.
  base(i) = floor(T * weight(i) / W);  rest(i) = (T * weight(i)) mod W;  left = T - sum of base(i)
  share(i) = base(i) + 1 for the `left` locations with the largest rest(i), ties by location id ascending;
             otherwise share(i) = base(i)
Profit before shared(i) = revenue(i) - cost of goods(i) - direct expenses(i) - people(i) - bad debts(i)
Net profit(i)           = Profit before shared(i) - sum of share(i) over the period's company-wide costs
```

A company-wide cost is an expense with no location, or one employee's pay or commission for a month when that employee has no home location. Net revenue is before tax, after returns, and placed by `soldAtLocationId`. Every value is a whole number, so nothing depends on dividing to a fixed precision, and `left` is below the number of locations with a non-zero rest, so a location with weight 0 never receives a cent. Each invoice and write-off has one location, each cost is either direct to one location or fully split, and each split adds up to its cost. So location profits add up exactly to company profit under any period, and a property test on random records holds the report to it. The drill-down names the rule actually used, including a fallback. A company with no locations shows no location section.

**The business report** is one function, `businessReport()`, that feeds the screen, CSV and PDF. Net profit is labelled "before income tax".

| Section | Basis | Date that places a record in the period |
|---|---|---|
| Summary: revenue to net profit; Profit by location; Revenue and margin; Expenses | Accrual | Invoice date; expense date; pay month; write-off date |
| Summary: cash in and out; Cash section | Cash | Date of confirmed payment, expense paid or refund completed |
| Customers owe; you owe suppliers | Balance at period end, or today if earlier | Records dated up to that day, with overdue measured at that day |
| Purchases by supplier | Accrual | Goods receipt date, at order cost (the blueprint's Inventory debit), with received-not-billed as a memo |
| Taxes | Liability | Invoice date for tax charged; payment date for tax paid |
| People costs | Accrual | Month worked; commission month |
| Stock on hand | Today only | Not moved by the period picker, and labelled so, because average cost is stored only as its current value |

- **Operating expenses** are confirmed expenses, people costs and bad debts written off. People costs have one source per company and month: HR gross pay and commissions where they exist, or else a seeded or imported payroll expense, never both.
- **Taxes** shows five lines: sales tax charged to customers, net of credit notes; sales tax paid to the state; still owed at period end, the running difference of those two; taxes that are costs (the taxes and licences category); and sales tax paid on purchases as a memo, already inside the expense lines.
- **Cash paid out** is supplier payments, paid expenses including sales tax payments, and customer refunds. It is labelled as excluding wages, which the payroll provider pays (C-1).
- **Filters.** Location applies wherever a figure has a location, and sections without one say so. Salesperson applies to revenue, cost and margin, and the Summary then stops at gross profit. Vendor company applies to Expenses and Purchases. Category becomes two filters, product category and expense category.
- **Permissions.** `reports.financial.view` opens the report. Cost of goods, gross profit and net profit need `sales.margin.view_sensitive`, people costs need `hr.employee.view_sensitive`, and stock value needs `inventory.product.view_sensitive`. Sections a person cannot see are hidden, not shown as zero.
- **Migration and fixtures.** `at` becomes `date`. Old categories map to new ones (utilities to electricity, vehicles to fuel and vehicles, software to other). Seeded rent and utilities are split into direct records with the function above, so monthly totals and the dashboard do not change, and marketing, insurance and software stay company-wide. Seeded expenses get invented vendors and placeholder receipts, as seeded payments did (ADR 0013), and no new random draws.

## Where the research changes the spec

1. **"Sales tax collected vs taxes paid" compares unlike things (F2).** Collected tax is a liability, and paying it to the state is not a cost. Revenue already leaves that tax out, so a remittance entered as a taxes and licences expense would take money off profit that was never counted in it, and net profit would be understated by the whole remittance. Recommendation: the `sales_tax_payment` category and the five-line Taxes section.
2. **The `tax` field on an expense (F1).** In the US it is part of the cost, not a recoverable amount. Recommendation: count `amount + tax` as the cost and show tax as a memo only.
3. **Showrooms would earn nothing (F2).** Invoices point only at the warehouse that ships, so every showroom would show costs and no revenue, and a revenue-share rule would never charge it a shared cost. Recommendation: add `soldAtLocationId`.
4. **People costs are outside net profit (F2).** They sit in their own section, and Profit by location has no column for them, while the seeded payroll is the largest cost. Recommendation: include them in operating expenses and add a location column.
5. **Paid now or owed (F1).** The blueprint needs both, and the spec has only a payment method. Recommendation: Pay later, through a linked bill.
6. **The blueprint is incomplete.** Recommendation: add posting rows for a sales tax payment and a bad debt write-off, and the six new expense accounts. Write-offs must count in the report, or the change in customers owe will not reconcile to profit.
7. **One rule for all shared costs (F1).** Occupancy costs have a causal base and accounting fees do not. Recommendation: keep revenue as the default and allow an optional rule per category. F-1 needs no change.
8. **Shared costs can mislead an owner (F2).** Recommendation: add a "Profit before shared costs" column beside net profit.
9. **Filters, balances and stock against the period (F2).** "Category" means two different things, no single filter applies to every section, and today's balances beside an old period would mislead. Recommendation: the filter rules above, balances at period end, and stock labelled as today.
10. **Mandatory receipt (F1).** A generated draft cannot have one yet, and the IRS accepts a combination of documents. Recommendation: require a file when leaving draft, and accept a statement or lease.

## Consequences

- `LedgerService` implements the rows above, commits document and journal together, and carries `location_id` on journal lines.
- Shares must be frozen when a period closes, in an `expense_allocations` table, because a revenue share changes when an old invoice is voided. The demo derives them live. The sharing settings need effective dates, so changing the rule cannot rewrite closed months.
- Net profit in the demo leaves out the employer's Social Security and Medicare at 6.2% and 1.45% ([IRS Topic 751](https://www.irs.gov/taxtopics/tc751)), because C-1 keeps gross pay only. The real build should take those and benefits from the payroll provider.
- Where a state imposes the tax on the seller, the amount belongs in gross receipts ([IRS Pub 334](https://www.irs.gov/publications/p334)), so the real build needs a per-jurisdiction flag. The filing basis per state registration also needs a setting.
- Recurring drafts move to a scheduled job, with a unique constraint on template and period.
- An expense posts wholly on its date, so a yearly insurance premium lands in one month. The real build should be able to spread prepaid costs, a topic IRS Pub 538 treats under "Expenses Paid in Advance" ([IRS Pub 538](https://www.irs.gov/publications/p538), heading seen only).

## Sources

Opened and read:
- Intuit: [Enter and manage expenses](https://quickbooks.intuit.com/learn-support/en-us/help-article/cash-drawer/enter-manage-expenses-quickbooks-online/L1XojuBAW_US_en_US), [Recurring transactions](https://quickbooks.intuit.com/learn-support/en-global/help-article/recurring-transactions/create-recurring-transactions-quickbooks-online/L3WoKX2R8_ROW_en), [Location tracking](https://quickbooks.intuit.com/learn-support/en-us/help-article/track-location/set-use-location-tracking/L2raFkEBC_US_en_US), [classes and locations blog](https://quickbooks.intuit.com/au/blog/product-update/using-classes-and-locations-in-quickbooks-online/), [Turn on class tracking](https://quickbooks.intuit.com/learn-support/en-us/help-article/class-list/turn-class-tracking-quickbooks-online/L1uqOta7C_US_en_US), [Record sales tax payments](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-sales-taxes/file-sales-tax-return-record-tax-payment-online/L7ZeSlAr1_US_en_US), [community: split an expense by location](https://quickbooks.intuit.com/learn-support/en-us/banking/how-to-split-a-bank-transaction-expense-to-multiple-locations/00/516705)
- Odoo: [Analytic accounting 19.0](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/analytic_accounting.html), [Analytic accounting 20.0](https://www.odoo.com/documentation/20.0/applications/finance/accounting/reporting/analytic_accounting.html), [Post expenses 19.0](https://www.odoo.com/documentation/19.0/applications/finance/expenses/post_expenses.html), [Vendor bills 18.0](https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills.html) (end of the page only)
- Cost allocation: [48 CFR 9904.403-40](https://www.law.cornell.edu/cfr/text/48/9904.403-40), [9904.403-50](https://www.law.cornell.edu/cfr/text/48/9904.403-50), [9904.418-50](https://www.law.cornell.edu/cfr/text/48/9904.418-50), [OpenStax 10.4](https://openstax.org/books/principles-managerial-accounting/pages/10-4-evaluate-and-determine-whether-to-keep-or-discontinue-a-segment-or-product), [Paycove](https://www.paycove.io/learn/cost-allocation), [Fowler: Money](https://martinfowler.com/eaaCatalog/money.html)
- Tax and accounting: [IRS Pub 334](https://www.irs.gov/publications/p334), [IRS Pub 538](https://www.irs.gov/publications/p538), [IRS records](https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep), [IRS Topic 751](https://www.irs.gov/taxtopics/tc751), [Tex. Tax Code 111.016](https://texas.public.law/statutes/tex._tax_code_section_111.016), [Journal of Accountancy](https://www.journalofaccountancy.com/issues/2016/jul/fasb-issues-revenue-recognition-changes-practical-expedients/), [SBA](https://www.sba.gov/counseling/manage-your-business/)
- Blueprint pages 24, 25, 34 and 48 (`docs/blueprint/blueprint.pdf`)

Seen only as a search snippet, not opened:
- Intuit: [Upload receipts](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-transactions/upload-receipts-bills-quickbooks-online/L862MmZHn_US_en_US), [Pay sales tax (Desktop)](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-sales-taxes/pay-sales-tax/L6rrxxRES_US_en_US), [community: cash vs accrual](https://quickbooks.intuit.com/learn-support/en-us/account-management/cash-vs-accrual-when-running-a-profit-and-loss-for-the-same/00/887049)
- Cost allocation: [OpenStax 9.4](https://openstax.org/books/principles-managerial-accounting/pages/9-4-describe-the-effects-of-various-decisions-on-performance-evaluation-of-responsibility-centers), [DXL 10-K](https://www.sec.gov/Archives/edgar/data/813298/000095017025042703/dxlg-20250201.htm), [Kura Sushi 10-K](https://www.sec.gov/Archives/edgar/data/1772177/000156459019044555/krus-10k_20190831.htm), [Math.Apportionment](https://hackage.haskell.org/package/apportionment-0.0.0.4/docs/Math-Apportionment.html), [Dinero allocate](https://v2.dinerojs.com/docs/api/mutations/allocate)
- Tax: [Deloitte DART 6.7](https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-6-step-3-determine-transaction/6-7-sales-taxes-similar-taxes) and [Texas STAR ruling 9010L1049C07](https://star.comptroller.texas.gov/view/9010L1049C07) (neither page rendered when opened)
