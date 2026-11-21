# 2026-11-21 20:01, A: finance and reports click-through fixes

Branch `fix/finance-reports-click-through`. Closes click-through #37, #38, #40 and #41, and answers PR #82's open question 1 (the P&L place filter).

## Goal
New expense numbers keep the series' padding, the expense pickers find a name by typing, the Business report's drill sheet ends with a total, the seed files each vendor's costs under the right category, and the P&L's filter is called Location and lists every location.

## What changed
- #37: `nextNumber` (`packages/shared/src/operations/quotes.ts`) pads to the widest number already in the series and never cuts (EXP-0209, then EXP-0210; EXP-9999, then EXP-10000). `nextPaymentNumber` is now `nextNumber` with a four-digit minimum. Every series built with them (EXP, INV, CR, Q, PO, J, TR, CTR, IMP, PAY, SP, GR) follows.
- #38: `apps/web/src/components/search-pick.tsx` (Popover and Command, the supplier picker's pattern) and `search-pick-match.ts`. Vendor and Location on New expense and New recurring expense use it. Typing on the closed picker opens it with that text; a name that starts with the text comes first, then a name with a word that starts with it, then any match; Enter picks the first. Category, Payment and the HR forms keep `Pick`.
- #40: `drillTotal` (`packages/shared/src/reports/drill.ts`) and a total line in the Business report's drill sheet. It reads "Total" when the records add up to the figure clicked, and otherwise "Total of the records listed" with the figure. That happens for operating expenses, a product category and a cut list.
- #41: seed generator. The monthly "Software subscriptions" cost under Other, paid to Peakline Internet and Phone, is now "Internet and phone service" under Internet and phone. Cleaning and repairs get a new invented vendor, Tidewell Facility Services. The fixtures are regenerated. PAY and SP numbers that the generator had left unpadded (PAY-343, SP-47) are now padded too. Only payroll and the one draft are seeded without a vendor.
- P&L filter: `HUB_LOCATION_FILTERS`, `hubLocationsOf` and `hubLocationProblem` (`packages/shared/src/reports/hub-locations.ts`) drive the hub filter (`hub-report.tsx`), the API check (`checkHubLocation` in `report-params.ts`) and the demo check (`report-actions.ts`). Profit and loss takes any live location; the other two hub reports still take warehouses only.
- Docs: blueprint-delta row, api-contract (`GET /reports/pnl`), reports.md rules 23 and 24, finance-expenses.md rules 10 and 11.

## Checks
See the PR body for the exact runs.

## Open questions
- The P&L Location filter only means "where the sale was made" once PR #82 is merged. On main, P&L still compares where the invoice ships from, so a showroom shows no revenue. Merge this after #82. Two small conflicts are expected: the `pnl()` call in `reports.service.ts` and `demoPnlReport` in `report-actions.ts`, plus the reports.md Filters line and the api-contract row.
- The shared `Pick` select (Radix) already supports first-letter type-ahead. It is kept for short fixed lists. Should the longer lists elsewhere (for example the HR forms) move to `SearchPick` too?
