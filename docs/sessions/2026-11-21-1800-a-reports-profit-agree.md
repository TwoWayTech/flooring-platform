# 2026-11-21 18:00, A: Business report and Profit and loss give one profit

## Goal
Close click-through finding #39 (major) under the owner's decision 2 (ADR 0061): the Business report and Profit and loss give the same profit for the same period and filters, with a test that compares them.

## Why October 2026 differed (Summit, all filters off)
Revenue and cost of goods agreed. Operating expenses did not, for three reasons, all in the old P&L rule (reports.md rule 24 documented the gap):
1. **People costs.** P&L counted October's payroll expense. The Business report (rule 7) counts the approved or exported pay periods that end in October instead, one source per month: two exported periods, $106,377.02 of gross pay and commissions.
2. **Tax on expenses.** P&L added `amount` before tax; the Business report adds `amount + tax` (`expenseCost`).
3. **Bad debts.** P&L had no write-offs (none in October on the seed, so no effect there).
Also, P&L's revenue came from invoice subtotals and the Business report's from line amounts (equal on the seed), and P&L's warehouse filter matched where an invoice ships from and left expenses alone.

## The rule
The Business report's documented profit, reports.md rules 4 to 9, for both reports. One calculation, `profitFigures` and `profitOf` in `packages/shared/src/profit.ts` (moved out of `business-report.ts` unchanged), serves the Business report's Summary and Profit by location and every P&L row. A P&L row is one whole calendar month; the total is the whole range. The warehouse filter is the Business report's Locations filter with that one location ticked. P&L has no product category, expense category, salesperson or vendor filter.

## What changed
- `packages/shared/src/profit.ts` (new): `profitFigures`, `profitOf`, `periodProfit`, `withPaySight`, `soldAt` and their helpers.
- `packages/shared/src/business-report.ts`: uses them; output unchanged.
- `packages/shared/src/reports/hub-reports.ts`: `pnlReport` builds each month with them; `PnlData`, `pnlFilters`, `PNL_UNKNOWN_COST`. `HubReportData` loses `expenses`. `hubWindow.expensesTo` is now `profitTo`.
- `apps/api/src/modules/reports/profit-records.ts` (new) and `reports.service.ts`: `GET /reports/pnl` reads what the profit reads.
- `apps/web/src/lib/api/demo/report-actions.ts`: DemoStore passes the same collections.
- Docs: reports.md (rule 24, catalog, collections, limits), api-contract.md, blueprint-delta.md.

## Tests
- `packages/shared/test/profit-agree.test.ts` (new): on the Summit and Keystone fixtures, `periodProfit` equals the Business report's Summary for a month, a quarter, year to date and a custom range, with no filter, one and two locations, product category, expense category and vendor, with and without pay sight. Every P&L row of every preset and warehouse equals the Business report for that month, and the total equals the whole range. Built-fixture tests of rules 5 to 8.
- `apps/api/test/reports.int.test.ts`: R-PROFIT compares `GET /reports/pnl` with `GET /reports/business` on seeded Summit for October 2026, last month, the last full quarter, year to date, a custom range and 12 months, with no filter and with Denver Central, as Owner, Accountant and a role without pay sight; the 3m and ytd totals too; October's expenses equal operating expenses with people costs; P&L refuses the four filters it lacks. R-EQ and R-STRIP-2 now expect the new P&L.
- Updated: hub-reports, dashboard-without-cost and report-periods tests.

## Open questions
- The P&L picker still says "Warehouse" and lists warehouses only, while the filter now means the Business report's Locations filter for that location. Should it list every location (showrooms too)?
- The dashboard's 12-month panel (`monthlyPnl`) keeps the old rule, so its expenses still differ from both reports. Should it follow?
- On the seed, October's HR gross pay ($106,377.02) is nearly four times October's payroll expense (about $28,200). The rule is right, but the seed's two data sets don't match.
