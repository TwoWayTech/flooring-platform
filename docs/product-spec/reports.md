# Reports

Written from the demo code, 2026-11-10.

## Purpose

The Reports page (`/reports`, `apps/web/src/features/reports/reports-page.tsx`, feature `reports.hub`) answers how the business is doing, from the documents themselves. Nothing is typed by hand and nothing is stored.

Four reports are on:

| Report | Feature key | Built by |
| --- | --- | --- |
| Business report (first and default) | `reports.business` | `businessReport` in `packages/shared/src/business-report.ts`, shown by `apps/web/src/features/reports/business-report.tsx` |
| Profit and loss | `reports.pnl` | `pnlReport` in `apps/web/src/features/reports/report-model.ts`, using `monthlyPnl` in `packages/shared/src/analytics.ts` |
| Sales by category | `reports.sales-category` | `salesByCategoryReport` in `report-model.ts`, using `salesByCategory` in `analytics.ts` |
| Payments received | `reports.payments` | `paymentsReport` in `report-model.ts` |

Four others are switched off, with their code kept. See rule 25.

## Who uses it

Default roles come from `packages/shared/src/permissions/roles.ts`. All keys are in the `core` module. The product is Flooring Suite only.

| Action | Permission key | Default roles | Enforced in |
| --- | --- | --- | --- |
| See the Reports menu and open the page | Any of `reports.sales.view`, `reports.financial.view` | Owner, Manager, Accountant, Sales | `apps/web/src/products/flooring.ts`, `apps/web/src/products/pages.ts`, `reports-page.tsx` (`NoAccess` when nothing is allowed) |
| Open the Business report | `reports.financial.view` | Owner, Manager, Accountant | `reports-page.tsx` (`hasBusiness`), `DemoStore.businessReport` in `apps/web/src/lib/api/demo/store.ts` |
| Export the Business report, CSV and PDF | `reports.financial.export` | Owner, Accountant | `business-report.tsx` (buttons only) |
| See Cost of goods, Gross profit, Operating expenses, Net profit, Profit by location and the Margin columns | `sales.margin.view_sensitive` | Owner, Manager, Accountant | `DemoStore.businessReport` passes `show.margin` |
| See People costs | `hr.employee.view_sensitive` | Owner. HR manager holds it but cannot open the report. | `DemoStore.businessReport` passes `show.people` |
| See Stock on hand | `inventory.product.view_sensitive` | Owner, Manager, Accountant. Purchasing holds it but cannot open the report. | `DemoStore.businessReport` passes `show.stock` |
| Open Profit and loss | `reports.financial.view` | Owner, Manager, Accountant | `reports-page.tsx` (`REPORTS`, `allowed`) |
| Export Profit and loss | `reports.financial.export` | Owner, Accountant | `reports-page.tsx` (buttons only) |
| Open Sales by category | `reports.sales.view` | Owner, Manager, Accountant, Sales | `reports-page.tsx` |
| Export Sales by category | `reports.sales.export` | Owner, Manager, Accountant | `reports-page.tsx` (buttons only) |
| See Cost and Margin on Sales by category | `inventory.product.view_sensitive` | Owner, Manager, Accountant | `reports-page.tsx` (`showCost`), `salesByCategoryReport` |
| Open Payments received | `reports.financial.view` | Owner, Manager, Accountant | `reports-page.tsx` |
| Export Payments received | `reports.financial.export` | Owner, Accountant | `reports-page.tsx` (buttons only) |

The keys `reports.tax.view`, `reports.tax.export`, `reports.inventory.view` and `reports.inventory.export` remain in the catalog and in roles. They open nothing while their reports are off, and they do not give the menu item. The Warehouse and Purchasing roles hold `reports.inventory.view` and see no Reports link.

## Workflows and status rules

None. No report has a status.

## Business rules

### 1. Which report opens

`ReportsPage` in `reports-page.tsx`. `?report=<key>` selects a report. The Business report shows when the person may see it and the address asks for it, asks for nothing, or asks for a report they may not open. Otherwise the first allowed report shows.

### 2. One calculation for screen, CSV and PDF

`businessReport(data, filters, show)` returns sections. The screen, the CSV and the PDF all print those same rows. It reads the company's whole record through `db.list`, not a screen's copy.

### 3. Period and comparison

`businessReport` in `business-report.ts`, using `daysBetween` and `addDays` in `packages/shared/src/dates.ts`.

```
length   = daysBetween(from, to)
previous = { from: addDays(from, -length - 1), to: addDays(from, -1) }
```

The presets are in `rangeFor` in `business-report.tsx`: This month, Last month (the default), This quarter, This year, Custom dates. Custom dates default to January 1 through today. This month, This quarter and This year end today.

### 4. Where revenue belongs

`soldAt` in `business-report.ts`. `soldAtLocationId` is optional on quotes and invoices.

```
soldAt(invoice) = invoice.soldAtLocationId ?? invoice.locationId
```

Revenue, cost of goods and write-offs follow it. Contract invoices set only `locationId` (`contractInvoice` in `packages/shared/src/contracts/documents.ts`), so they fall back to it.

### 5. Revenue and cost of goods

`figuresFor` and `lineMoney` in `business-report.ts`. `lineAmount` is in `packages/shared/src/documents.ts`. `roundMoney` rounds to cents, half up.

```
invoices in scope = not voided
                    and issuedAt in [from, to]
                    and soldAt in locationIds, when any are picked
                    and salesRepId matches, when picked

sign(i)      = i.isReturn ? -1 : 1
line revenue = lineAmount(line) * sign = roundMoney(quantity * unitPrice) * sign
line cost    = roundMoney(quantity * unitCost) * sign

revenue = sum of line revenue, for lines whose categoryOf(line) matches productCategory, when picked
cost    = sum of line cost, for the same lines

categoryOf(line) = the line product's category ?? line.category
```

A credit note issued in the app has no lines, so `salesLines` in `packages/shared/src/sales-lines.ts` counts it as one line for its subtotal and cost, under the category Credit notes. A product category filter leaves it out.

### 6. Expenses that count

`figuresFor` in `business-report.ts`, using `countsAsCost` and `expenseCost` in `packages/shared/src/expenses.ts`.

```
costExpenses = expenses where countsAsCost(e)
               and category !== "payroll"
               and date in [from, to]
               and category matches expenseCategory, when picked
               and supplierId matches, when picked

with a locationId:     direct[locationId] += expenseCost(e)
without a locationId:  spread(expenseCost(e), month of e.date)
```

`spread` splits the cost across every location with `weightsFor` and `shareByWeight` (`finance-expenses.md`, rules 14 and 15) and adds to `shared`. The revenue weights always use all non-void invoices in that month, whatever filters are on.

### 7. People costs

`peopleLines` in `business-report.ts`. There is one source per month.

```
for each pay period with status approved or exported and end in [from, to]:
  month = end.slice(0, 7); mark month as HR pay
  each line: amount = grossPay, locationId = employee.homeLocationId ?? null

for each expense with category payroll, status confirmed and date in [from, to]:
  if its month is not marked: amount = expenseCost(e), locationId = e.locationId

with a locationId:    people[locationId] += amount
without a locationId: spread(amount, month)
```

`grossPay` includes commission pay (`grossPay` in `packages/shared/src/hr/pay.ts`).

### 8. Bad debts

`figuresFor` in `business-report.ts`. Each invoice adjustment with `kind === "write_off"` and `at` in the period adds `amount` to `badDebts[soldAt(invoice)]`.

### 9. Operating expenses, gross and net

`bottomLine` in `business-report.ts`. `totalOf(map, ids)` sums every entry when no ids are given, otherwise those locations only.

```
opex  = totalOf(direct, ids) + totalOf(people, ids) + totalOf(badDebts, ids) + totalOf(shared, ids)
gross = revenue - cost
net   = gross - opex
```

Net profit is labelled "before income tax".

### 10. Change and percent

`changeText` and `pct` in `business-report.ts`. `toDecimalPlaces(1)` rounds half up.

```
change = before is zero ? "" : (now - before) / abs(before) * 100, to 1 decimal place
pct    = whole is zero ? "0" : part / whole * 100, to 1 decimal place
```

When the earlier period starts before the first invoice, every change is blank and the Summary says so.

```
earliest = the smallest invoice issuedAt, or today
partial  = previous.from < earliest
```

### 11. Cash

`cashFigures` in `business-report.ts`. It takes no filter except the dates.

```
received     = payments with status confirmed and date in the period
supplierPaid = supplier payments with status confirmed and date in the period
expensesPaid = expenses with status confirmed, settlement paid, category not payroll, date in the period
refunds      = refunds with status completed and date in the period

inTotal  = sum(received.amount)
outTotal = sum(supplierPaid.amount) + sum(expenseCost(expensesPaid)) + sum(refunds.amount)
```

`expensesPaid` includes sales tax payments.

### 12. Balances

`balancesAt` in `business-report.ts`, using `ledgerIndex` in `packages/shared/src/ledger.ts` and `billLedgerIndex` in `packages/shared/src/operations/purchasing.ts`. It takes no filter.

```
asOf (this period) = to < today ? to : today
asOf (before)      = previous.to

customers: invoices with issuedAt <= asOf
           payments with date <= asOf
           adjustments with at date <= asOf
  balance = max(total - confirmed payments - credits applied - write-offs, 0)
            0 for a void invoice or a return
  overdue = balance > 0 and dueAt is set and daysBetween(dueAt, asOf) > 0

suppliers: bills with issuedAt <= asOf
           supplier payments with date <= asOf
  balance = max(total - confirmed allocations, 0)
  overdue = balance > 0 and daysBetween(dueAt, asOf) > 0

Current = sum of balances > 0 that are not overdue
Overdue = sum of balances > 0 that are overdue
```

### 13. Section: Summary

Key `summary`. Columns: This period, Previous period, Change.

| Row | Formula | Shown when | Drill records |
| --- | --- | --- | --- |
| Revenue | `now.revenue` | Always | Invoices in scope, each with its signed subtotal |
| Cost of goods | `now.cost` | `show.margin` | Invoices in scope, each with its signed cost |
| Gross profit | `gross` | `show.margin` | None |
| Gross profit % | `pct(gross, revenue)`. Change is blank. | `show.margin` | None |
| Operating expenses | `opex` | `show.margin`, no salesperson filter | The cost expenses only |
| Net profit, before income tax | `net` | `show.margin`, no salesperson filter | None |
| Net profit % | `pct(net, revenue)`. Change is blank. | `show.margin`, no salesperson filter | None |
| Cash received | `inTotal` | No salesperson filter | The payments |
| Cash paid out, excluding wages | `outTotal` | No salesperson filter | None |
| Customers owe, current | Rule 12 | No salesperson filter | None |
| Customers owe, overdue | Rule 12 | No salesperson filter | None |
| You owe suppliers, current | Rule 12 | No salesperson filter | None |
| You owe suppliers, overdue | Rule 12 | No salesperson filter | None |

With a salesperson filter the note reads "Filtered to one salesperson, so the summary stops at gross profit."

### 14. Section: Profit by location

`profitByLocation` in `business-report.ts`. Key `locations`. Shown when `show.margin`, the company has locations and no salesperson filter is on. It lists the picked locations, or all. Chart column: Net profit.

```
own     = invoices in scope where soldAt(i) === location
revenue = sum(dec(i.subtotal) * sign(i))
cost    = sum(dec(i.cost) * sign(i))
direct  = direct[location] + people[location] + badDebts[location]
shared  = shared[location]
net     = revenue - cost - direct - shared
```

Columns: Revenue, Cost of goods, Direct expenses, Shared expenses, Net profit. The Total row sums each money column. The note names the rule actually used, including a fallback: "Shared expenses are split by revenue share." The unit test in `packages/shared/test/expenses.test.ts` holds that location profits add up exactly to company profit, with no filter on.

### 15. Sections: Revenue and margin

`revenueSections` in `business-report.ts`. Keys `revenue_category` and `revenue_rep`. Both are chart sections on Revenue. Rows are sorted by revenue, highest first.

```
for each invoice in scope, each line:
  revenue[key] += lineAmount(line) * sign
  cost[key]    += roundMoney(quantity * unitCost) * sign
margin = revenue - cost
```

- **By product category**: key is `categoryOf(line)`. Label from `CATEGORY_LABELS`, else `TAX_CATEGORY_LABELS`, else the key.
- **By salesperson**: key is `i.salesRepId`. Label is the user's name, else "Former employee".
- The Margin column needs `show.margin`.

### 16. Sections: Expenses

`expenseSections` in `business-report.ts`. Keys `expense_category`, `expense_vendor`, `expense_location`. Shown with no salesperson filter. Chart sections on Cost. Sorted by cost, highest first.

```
cost[key] = sum(expenseCost(e)) over costExpenses
```

Vendor rows with no supplier read "No vendor". Location rows with no location read "Company-wide".

### 17. Section: Cash

`cashSection` in `business-report.ts`. Key `cash`. Shown with no salesperson filter. Note: "Excludes wages, which your payroll provider pays."

- One "Received by <method>" row per method used, in the order first seen.
- Paid to suppliers, Paid for expenses and Refunds to customers, each negated.

```
Net cash = inTotal - outTotal
```

### 18. Section: Purchases by supplier

`purchasesSection` in `business-report.ts`. Key `purchases`. Shown with no salesperson filter. Chart column: Received at order cost.

```
for each receipt with receivedAt date in the period, with its PO found, and PO supplier matching Vendor when picked:
  value = receivedValue(po, [receipt]) = sum(roundMoney(received * poLine.unitCost))
  by[po.supplierId] += value
  if no bill has this receipt in receiptIds: notBilled += value
```

Note: "Received but not billed yet: $<amount>."

### 19. Section: Taxes

`taxesSection` in `business-report.ts`. Key `taxes`. Shown with no salesperson filter. It takes no filter except the dates.

```
charged(a, b) = sum(dec(i.tax) * sign(i)) over non-void invoices with issuedAt in [a, b]
payments      = expenses with category sales_tax_payment and status confirmed
paid(a, b)    = sum(e.amount) over payments with date in [a, b]
confirmed     = expenses where countsAsCost(e) and date in [from, to]
```

| Row | Formula |
| --- | --- |
| Sales tax charged to customers | `charged(from, to)` |
| Sales tax paid to the state | `paid(from, to)` |
| Still owed at period end | `charged("0000-01-01", asOf) - paid("0000-01-01", asOf)` |
| Taxes that are costs | `sum(expenseCost(e))` over `confirmed` with category `taxes_licenses` |
| Sales tax paid on purchases (memo, already in expenses) | `sum(e.tax)` over `confirmed` |

### 20. Section: People costs

`peopleSection` in `business-report.ts`. Key `people`. Needs `show.people` and no salesperson filter. One row, "Gross pay estimate and commissions", is the sum of the pay lines from rule 7. Note: "Gross pay estimate. Taxes and net pay are calculated by your payroll provider."

### 21. Section: Stock on hand

`stockSection` in `business-report.ts`. Key `stock`. Needs `show.stock` and no salesperson filter. One row per warehouse. Note: "Value today. The period does not change it." Chart column: Value on hand.

```
amount = inventoryValuation(rolls at the warehouse, all products, boxedStock(stockMovements, warehouseId)).total
         rolls: sum(rollAreaSqFt(widthFt, remainingLengthFt) * costPerSqFt)
         boxed: sum(boxed quantity * product.cost)
         total: moneyString(rolls + boxed)
```

`inventoryValuation` is in `packages/shared/src/analytics.ts`, `boxedStock` in `packages/shared/src/stock.ts`.

### 22. Business report filters

From `BusinessReportView` in `business-report.tsx`, applied in `businessReport`.

| Filter | Changes | Does not change |
| --- | --- | --- |
| Period | Everything except Stock on hand | Stock on hand |
| Locations (none ticked means all) | Invoices in scope by `soldAt`, so Summary revenue and cost, Profit by location and the Revenue sections. Operating expenses and net through `totalOf`. | Expenses sections, Cash, balances, Purchases, Taxes, People costs, Stock on hand |
| Product category | Summary Revenue, Cost of goods, Gross profit and Net profit | Profit by location, the Revenue sections and every drill list |
| Expense category | Summary Operating expenses and Net profit, Profit by location shared and direct columns, the Expenses sections | People costs and bad debts inside Operating expenses, the Taxes section |
| Salesperson | Invoices in scope. Hides everything below gross profit and every section except the Revenue sections. | |
| Vendor | Cost expenses, so Summary Operating expenses, the Expenses sections and Profit by location. Purchases by supplier. | Cash, balances, People costs and bad debts inside Operating expenses |

No filter is stored in the address. Only `?report=` is.

### 23. Drill-down, chart and exports for the Business report

From `business-report.tsx` and `business-report-pdf.tsx`.

- **Drill-down.** In a table, a row with records has a link that opens a sheet of its records. In a chart, every bar opens the sheet, and a row with no records says "This figure is worked out from other lines." The sheet lists at most 200 records.
- **Chart or table.** A section with a `chartColumn` opens as a chart with a Chart / Table switch. Bars are drawn only for values above zero.
- **CSV.** `toCsvText` writes each section as `Section, Line, <columns>` with its rows and total, then a blank line. Values are raw, not formatted. File: `business-report-<today>.csv`.
- **PDF.** `BusinessReportPdf`, US Letter portrait, built with `formatNumber` and the company's number settings. File: `business-report-<today>.pdf`.
- Hidden sections are left out of the screen, the CSV and the PDF, because they are not in the report at all.

### 24. The three other reports

`ReportsPage` builds them in the browser from `client.list`.

**Filters.** Dates: Last 12 months (default), Last 3 months, This month, This year. `monthsFor` picks the months. Warehouse compares `invoice.locationId` (where it ships from, not `soldAt`), and the Payments report uses the warehouse of the payment's invoice. Category appears only on Sales by category and leaves out Services. Method and Customer appear only on Payments received.

```
from     = first day of the first month
invoices = invoices with issuedAt >= from and issuedAt <= addDays(today, 1), in the warehouse
expenses = expenses with date >= from
payments = payments with date >= from and date <= today, in the warehouse
```

**Profit and loss.** `monthlyPnl` in `packages/shared/src/analytics.ts`, one row per month.

```
inMonth  = invoices where !voidedAt and issuedAt starts with month
revenue  = sum(signed subtotal)        // a return subtracts
cogs     = sum(signed cost)
opex     = sum(e.amount) over expenses where countsAsCost(e) and date starts with month
gross    = revenue - cogs
marginPct = revenue is zero ? 0 : (revenue - cogs) / revenue * 100
netIncome = gross - opex
```

`opex` uses `amount` before tax, includes payroll expenses and has no HR pay or write-offs. So this report's expenses differ from the Business report's Operating expenses.

**Sales by category.** `salesByCategory` in `packages/shared/src/analytics.ts`.

```
for each non-void invoice, each line:
  key = product exists and product.category !== "service" ? product.category : line.category
  revenue[key] += lineAmount(line) * sign
  cost[key]    += roundMoney(quantity * unitCost) * sign
margin = revenue - cost
```

Sorted by revenue, highest first. Services group under their tax category, unlike rule 15. Cost and Margin columns need `inventory.product.view_sensitive`.

**Payments received.** `paymentsReport` in `report-model.ts`. Confirmed payments by payment date, sorted by date then number. Method matches exactly. Customer matches part of the name, ignoring case. The Total is the sum of Amount.

### 25. The four reports that are off

Status `removed`, `enabled: false` in `packages/shared/src/features.ts`. Their builders stay in `report-model.ts` and `analytics.ts`.

| Key | Report | Where its content went | What is gone |
| --- | --- | --- | --- |
| `reports.tax-jurisdiction` | Sales tax by jurisdiction | Taxes section | Per-state and jurisdiction rows, exempt sales |
| `reports.inventory-valuation` | Inventory valuation | Stock on hand section | Value per product category |
| `reports.receivables-aging` | Receivables aging | Customers owe, current and overdue, in the Summary | Per-customer rows and the 1 to 30, 31 to 60, 61 to 90 and over 90 day buckets |
| `reports.payables-aging` | Payables aging | You owe suppliers, current and overdue, in the Summary | Per-supplier rows and the buckets |

## Entities and fields

Reports store nothing. These are the shapes passed around, in `packages/shared/src/business-report.ts` unless noted.

### BusinessFilters

| Field | Type | Notes |
| --- | --- | --- |
| `from` | string | ISO date. |
| `to` | string | ISO date. |
| `locationIds` | `string[]` | Empty means all. |
| `productCategory` | string or null | |
| `expenseCategory` | string or null | |
| `salesRepId` | string or null | |
| `supplierId` | string or null | |

### BusinessVisibility

| Field | Type | Notes |
| --- | --- | --- |
| `margin` | boolean | `sales.margin.view_sensitive` |
| `people` | boolean | `hr.employee.view_sensitive` |
| `stock` | boolean | `inventory.product.view_sensitive` |

### BusinessReport

| Field | Type | Notes |
| --- | --- | --- |
| `period` | `{ from, to }` | |
| `previous` | `{ from, to }` | Rule 3. |
| `sections` | `BusinessSection[]` | |

### BusinessSection

| Field | Type | Notes |
| --- | --- | --- |
| `key` | string | `summary`, `locations`, `revenue_category`, `revenue_rep`, `expense_category`, `expense_vendor`, `expense_location`, `cash`, `purchases`, `taxes`, `people`, `stock`. |
| `title` | string | |
| `note` | string or null | |
| `columns` | `BusinessColumn[]` | `id`, `header`, optional `kind` of `money` or `percent`. |
| `rows` | `BusinessRow[]` | |
| `total` | `BusinessRow` or null | |
| `chartColumn` | string or null | The column drawn as bars. |

### BusinessRow

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `label` | string | |
| `values` | `Record<string, string>` | One per column. |
| `records` | `DrillRecord[]` | `date`, `label`, `amount`, `href`. |
| `kind` | `percent`, optional | Overrides the column's kind. |

### Report

`apps/web/src/features/reports/report-model.ts`. The three other reports.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | |
| `columns` | `ReportColumn[]` | `id`, `header`, optional number `kind`. |
| `rows` | `Record<string, string>[]` | |
| `totals` | `Record<string, string>` or null | |

### Collections read

| Report | Collections |
| --- | --- |
| Business report | `invoices`, `payments`, `invoiceAdjustments`, `refunds`, `expenses`, `bills`, `supplierPayments`, `receipts`, `purchaseOrders`, `suppliers`, `users`, `employees`, `locations`, `products`, `rolls`, `stockMovements`, `payPeriods`, `settings.sharedCosts` |
| Profit and loss | `invoices`, `expenses` |
| Sales by category | `invoices`, `products` |
| Payments received | `payments`, `invoices`, `customers` |

## Events and audit entries

None. Viewing or exporting a report raises no notification event and writes no audit entry.

## Emails

None.

## Reports

| Report | Basis | CSV | PDF | Filters printed on the export |
| --- | --- | --- | --- | --- |
| Business report | Accrual by invoice and expense date; cash by payment date; balances at period end | `business-report-<today>.csv` | `business-report-<today>.pdf`, portrait | PDF: dates only. CSV: none. |
| Profit and loss | Accrual | `pnl-<today>.csv` | `pnl-<today>.pdf`, landscape | PDF: range and warehouse. CSV: none. |
| Sales by category | Accrual | `sales-<today>.csv` | `sales-<today>.pdf`, portrait | PDF: range, warehouse and category. CSV: none. |
| Payments received | Cash, by payment date | `payments-<today>.csv` | `payments-<today>.pdf`, landscape | PDF: range, warehouse, method and customer. CSV: none. |

Report PDFs print with `apps/web/src/features/reports/report-pdf.tsx`, landscape when a report has more than 5 columns. CSVs of the three other reports include the totals row.

## Edge cases and known limits

- **Data scope differs between reports.** The Business report uses `db.list`, so it shows the whole company even to a Manager with branch scope. The other three use `client.list`, which applies data scope to invoices, payments and customers. A Sales user sees Sales by category for their own invoices only.
- **Profit and loss mixes scopes.** For a branch-scoped Manager, invoices are the branch's and expenses are the company's. The warehouse filter also leaves expenses alone.
- **Sections hidden from a person still count.** The Accountant has no People costs section, but Operating expenses and Net profit include those costs.
- **Product category filter reaches only the top of the Summary.** Profit by location and the Revenue sections ignore it, so their totals stop matching Summary revenue when it is on. Drill lists keep the whole invoice's amount.
- **Filters do not reach every section.** Location, Vendor and Expense category filters skip some sections (rule 22), and the report prints no note saying which. ADR 0023 asked for one.
- **A filtered Business report does not say so on the PDF or CSV.** Only the dates are printed. The salesperson note appears, and only when that filter is on.
- **Sales tax payment filter.** Expense category offers Sales tax payment, but `countsAsCost` excludes it, so the Expenses sections come back empty.
- **Costs that never reach net profit.** Contractor payments (`contractorPayments`) are not read. Subcontract and goods bills are not costs in this report. Cost of goods comes from invoice cost, and on contract invoices from the estimated cost share (`contractInvoice`). Employer payroll taxes are left out (ADR 0023).
- **Contract retainage.** A progress invoice's gross is revenue at billing. A release invoice has no lines, so it adds no revenue. Held retainage is outside Customers owe until it is released (`total = subtotal + tax - withheld + released`).
- **Pay periods land in one month.** A pay period's whole gross lands in the month of its end date.
- **A short range can pick the other payroll source.** `hrMonths` only sees pay periods ending inside the chosen dates. A custom range that stops before a pay period ends counts that month's payroll expense, and a longer range replaces it with HR pay.
- **Balances at an earlier date use today's void state.** `balancesAt` does not compare `voidedAt` with the as-of date.
- **Comparison.** A previous period of zero shows no change. `earliest` looks at every invoice, including void ones.
- **Still owed can go negative.** It is a running difference and has no floor.
- **"Received but not billed" prints a literal dollar sign** and the raw value (`purchasesSection`). It does not follow Settings for number format.
- **Sales by category and the Business report label services differently.** Rule 15 versus rule 24.
- **Exports are checked on the screen only.** The data is already in the browser.
- **Drill lists stop at 200 records** with no message.
- **Could not determine from the code.** How a Business report PDF section taller than one page prints. Each section is `wrap={false}`, and no PDF was rendered for this document.
- **Differences from ADR 0023.** The "Profit before shared costs" column and the note on sections a filter does not reach were not built.
