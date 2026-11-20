# ADR 0055: Reports on the API (Business report, Profit and loss, Sales by category, Payments received)

- **Status:** accepted, 2026-11-15. Built overnight on `feat/reports-api` (PR #39) under the owner's rule for this queue: follow docs/product-spec/reports.md as the approved behaviour, deviate only in the safer direction (less exposure, deny by default, refuse what can't be done correctly), record each deviation in docs/blueprint-delta.md, here and the spec's "Real build (ADR 0055)" section, and defer what needs the owner. The safer deviations and the questions under "For the owner" are open for the owner's review.
- **Context:**
  - docs/real-build-plan.md, module 15 (Reports; it depends on modules 8, 9 and 11, all merged) and the week-18 gate, "Location profits add up to company profit".
  - docs/STATUS.md:
    - "Next three tasks", item 3: reports, then import, then cross-module e2e flows, then the whole-product check;
    - the PR #18 review follow-up: adjustment `at`, and payment `recordedAt` and `voidedAt`, are read as UTC moments, and reports cut them to a day. Give them company days before reports move to the API.
  - The behaviour is docs/product-spec/reports.md, rules 1 to 25, written from the demo on 2026-11-10.
  - Blueprint p26 and p27, "Reports catalog": "Reports showing cost or margin require the matching permission".
  - ADR 0023 (expenses, shared costs and location profit), ADR 0039 (the ledger) and ADR 0041 (expenses on the API; payroll months hidden without `hr.payroll.view`).
  - **Where things stood at `e6b37ea`:** nothing about reports was on the API.
    - The Business report ran in the browser through `DemoStore.businessReport` in both modes. It was not in `API_METHODS`, so api mode read demo data.
    - P&L, Sales by category and Payments received were built in the browser by `apps/web/src/features/reports/report-model.ts` from about 11 `client.list` reads. In api mode those mixed API lists (invoices, payments) with demo lists (locations, users, suppliers, expenses).
    - In api mode the Business report's location, salesperson and vendor pickers held demo ids.
  - **Precedents in the API:**
    - `GET /ledger/trial-balance` needs `reports.financial.view` and data scope `all` (`requireCompanyWide`).
    - `GET /expenses` and `GET /pay-periods` hide pay from anyone without `hr.payroll.view` (`seesPayroll`, ADR 0041).
    - `GET /invoices` strips an invoice's `cost` without `inventory.product.view_sensitive`, and a contract invoice's cost without `contracts.contract.view_sensitive` (`contractCostShown`), whatever the module state.
    - The global `SensitiveFieldsInterceptor` strips reserved names (`cost`, `unitCost`, `margin`, `marginPct`, `grossMargin`, `grossMarginPct`, `estimatedCost` and others) at any depth. It doesn't know `cogs`, `netIncome`, `net` or `amount`, so for reports it can only be a second net.
    - The permission engine drops every key of a switched-off module for everyone, the Owner included. `reports.*`, `sales.margin.*` and `inventory.*` are in `core`, `contracts.*` in `contracts`, `hr.*` in `hr`.
    - `@RequireProduct()` existed in core/tenancy, and TenantGuard enforces it, but no route used it yet.

## Decision

### Routes
`apps/api/src/modules/reports/`, `ReportsController` on `@Controller("reports")`, with `@RequireProduct("flooring")` and `@RequireModule("core")` at class level (S13). All five routes are GET, carry `Cache-Control: private, no-store` (S11), and write nothing: no audit entry (the AuditInterceptor runs only on writes) and no notification. docs/api-contract.md, "Reports (real build, ADR 0055)".

| Route | Needs (any one) | Switches (404 when off) | Data scope | Answer |
| --- | --- | --- | --- | --- |
| `GET /reports/options` | `reports.sales.view`, `reports.financial.view` | `reports.hub` | any | `ReportOptions` `{ reports, exports, locations, salespeople, vendors }` |
| `GET /reports/business` | `reports.financial.view` | `reports.hub`, `reports.business` | `all`, else 403 (S1) | `BusinessReport`, stripped and with drill lists capped |
| `GET /reports/pnl` | `reports.financial.view` | `reports.hub`, `reports.pnl` | `all`, else 403 (S1) | `Report` |
| `GET /reports/sales-by-category` | `reports.sales.view` | `reports.hub`, `reports.sales-category` | applied to the rows (S2) | `Report` |
| `GET /reports/payments` | `reports.financial.view` | `reports.hub`, `reports.payments` | applied to the rows (S2) | `Report` |

In each handler the order is:
1. the guards: 401, then 403 for product (`product_not_enabled`), module (`module_not_enabled`), MFA or permission;
2. the switches: `reports.hub`, then the report's own (`requireReport`, 404);
3. the whole-company check where the report needs it (`requireWholeCompany`, 403 `forbidden` "This report covers the whole company.");
4. the query (400 `invalid_request`, words from the shared `REPORT_QUERY_MESSAGES`);
5. the report. Inside its snapshot, a location that isn't live, or a hub location that isn't a live warehouse, is 400.

The four removed reports (`reports.tax-jurisdiction`, `reports.inventory-valuation`, `reports.receivables-aging`, `reports.payables-aging`) have no route and no ApiClient method (S14).

### Who sees what (Flooring Suite, every module on, Summit has contract invoices)

| Role (scope) | Reports menu | Business report | Profit and loss | Sales by category | Payments received | Export buttons |
| --- | --- | --- | --- | --- | --- | --- |
| Owner (all) | yes | All 12 sections | All columns | Company, with Cost and Margin | Company | All four |
| Accountant (all) | yes | Every section but People costs. Operating expenses and net include people costs, because `hr.payroll.view` already shows every pay line | All columns | Company, with Cost and Margin | Company | All four |
| Manager (branch) | yes | 403, hidden | 403, hidden | Branch or own invoices, with Cost and Margin | Payments on branch or own invoices | Sales by category only |
| Sales (own) | yes | no key (403) | no key | Own invoices, no Cost or Margin | no key | none |
| Purchasing (all), Warehouse (branch) | no (they hold only `reports.inventory.view`) | 403 | 403 | 403 | 403 | none |
| HR manager, Installer, Employee | no | 403 | 403 | 403 | 403 | none |

A switched-off module's keys are gone for everyone. So an Owner of a company with **HR off** gets no People costs and "Operating expenses, excluding people costs" (S3), and an Owner of a company with **Contracts off and live contract invoices** gets no cost-of-goods figures (S4). `GET /expenses` and `GET /invoices` already hide the same in those states. The Manager loses the Business report and P&L that the spec gave them; that is owner question 1.

### Data scope (S1, S2)
- **The Business report and P&L need data scope `all`.** Narrowing them to a branch was rejected for four reasons:
  1. company-wide costs are spread by company-wide weights, so a branch's share of a cost of known amount gives away the company's revenue for the month, other branches included;
  2. most sections (Cash, Customers owe, You owe suppliers, Purchases, Taxes, the company-wide expense rows, People costs) have no location dimension;
  3. a branch manager could work out people costs per location from Direct expenses, and at a one-person showroom that is one person's pay (the reason ADR 0041 hides payroll);
  4. the spec has no branch version of the report, so it would invent unapproved behaviour.
- **Sales by category and Payments received** keep each invoice the person may see by the rules of `GET /invoices` (`seesDocument`: own by rep, branch by the invoice's branch, or all). Payments received keeps the payments on those invoices, and names only customers the person may see (`seesCustomer`); any other customer reads with an empty name, as in the demo.

### Visibility: four flags from the effective permissions and one data fact
`reportVisibility` (`packages/shared/src/reports/visibility.ts`), worked out once per request from the effective permissions (role ∩ ceiling ∩ enabled modules) and one fact read inside the snapshot (`hasContractInvoices`: a live invoice has a contract):

```
stock   = inventory.product.view_sensitive
margin  = sales.margin.view_sensitive and stock
          and (contracts.contract.view_sensitive or no live contract invoice)
payroll = hr.payroll.view
people  = payroll and hr.employee.view_sensitive
```

- **Stripped at the source (S7).** The shared calculation never computes, adds up or attaches records for anything a false flag hides, so hidden rows, columns, values, totals and drill records are absent, not zero:
  - Summary Cost of goods, Gross profit, Gross profit %, Operating expenses, Net profit and Net profit % need `margin`;
  - Profit by location needs `margin`;
  - the revenue sections' Margin column needs `margin`, and their row values and totals hold only the visible columns (before, each row's `values` always held `margin`; only the column was hidden);
  - the Cost of goods drill records, which show each invoice's cost, need `margin`;
  - without `payroll`, payroll expenses and pay periods are dropped once, at the top of `businessReport` and `pnlReport` (`withoutPayroll`), before any figure is worked out, so the Taxes memo and every other section agree; the API doesn't even read them;
  - People costs, with a record per person, need `people`;
  - Stock on hand needs `stock`, and so does Purchases by supplier (S5);
  - P&L Cost of goods, Gross margin, Margin and Net income need `margin` (S18);
  - Sales by category Cost and Margin need `margin`, and are left out of rows and totals (S6).
- **Labels say what is left out.** Without pay sight: "Operating expenses, excluding people costs", "Net profit, before people costs and income tax", the Summary note "People costs are left out, because your access doesn't include pay periods.", Profit by location's note "Direct expenses leave out people costs.", and the P&L headers "Expenses, excluding payroll" and "Net income, before payroll". Row ids stay the same.
- **Second net.** The global interceptor stays on. Because `margin` needs both of its keys, and Stock and Purchases need the cost key, it never blanks a figure the flags allow. The expense sections' column id moves from `cost` to `amount`, so the reserved name is never used for a figure that isn't sensitive (S7).
- **Derivation closed.** Pay: without pay sight no figure holds people costs (S3). Product cost: every cost-of-goods figure needs the product-cost key (S17). Contract estimated cost: S4. Order unit cost: S5. Sales-by-category margin: S6.

### One calculation (packages/shared)
- The API and the demo run the same functions: `businessReport` (`src/business-report.ts`); `pnlReport`, `salesByCategoryReport` and `paymentsReport`, moved from the web to `src/reports/hub-reports.ts`, with raw values and a `format` hint (`date`, `month`) the screen applies (`presentReport`); and, in `src/reports/`, the catalog and `reportAccess`, `reportVisibility`, the report days and ranges, `hubWindow` and the drill cap (`capDrillRecords`).
- The hub builders apply rule 24's range and warehouse filters themselves, so neither caller filters differently.
- `businessReport`'s inputs are narrowed to the fields it reads, with type-only `Pick<>`s; the demo's full objects still fit. `BusinessData` gains `productCategories` (every product a line may name, deleted ones included).
- `businessWindow(filters, today)` is the one statement of which documents the Business report reads: the period and the one before it (rule 3), invoice heads up to the end of the period's month (the shared-cost weights take a whole month's revenue), plus the heads named by write-offs in the window, and the history balances need. The API's readers and the shared windowing test both use it.
- **Removed locations.** Profit by location lists a location a figure still points at that is no longer live as "Removed location", after the live ones, without giving it new shared costs, so the rows always add up. No route deletes locations today; this guards imported data and later settings work.
- Lookups that grew with the data are memoised with no change in output, and `salesByCategory` sorts with decimals instead of `Number` (CLAUDE.md rule 6).

### Readers and the snapshot (apps/api)
- **One read-only snapshot per request (S9).** `readSnapshot` runs the whole read in one `READ ONLY`, `REPEATABLE READ` transaction, so every figure comes from the same moment and a write can't make the location rows disagree with the total. The STATUS note against REPEATABLE READ is about the lock-then-read pattern of posting writes, which a read-only transaction doesn't use.
- **Narrow readers** (`report-records.ts`) load only the columns and dates each report needs: the Business report's period of at most 366 days plus the comparison period; narrow history columns, with no lines, for balances and "still owed"; all live bills (a receipt billed after the period still counts as billed, rule 18). Stock, rolls, live products, receipts and orders are read only with `stock`; pay periods, employees and payroll expenses only with `payroll`.
- **Company days (S12).** `timestamptz` columns are first narrowed in SQL with UTC bounds widened by a day on each side, then filtered exactly on the company's day. Write-off `at` and goods receipt `receivedAt` are read as company minutes (`minuteIn`), which closes the PR #18 follow-up for reports.
- **Deleted rows on old documents.** Product categories and paid employees (name and home location) are read whether or not they are deleted, so a deleted product's lines keep their category and a deleted employee's pay stays at their location. Stock is valued on live products only.
- **The tenant** comes only from the session, through `TenantConnectionService`. Rep names come from the control database (`loadNames`); a missing one reads "Former employee". No figure is logged.

### Bounds and strict queries (S8, S10)
- A report day is `yyyy-MM-dd`, a real date, with a year from 1900 to 2999 ("Enter a real date."), so date sums and SQL bounds stay four-digit.
- The Business report period is at most 366 days, counted inclusively ("Choose a period of 366 days or less."), and from must be on or before to.
- The hub reports take only their four presets (`12m`, the default, `3m`, `1m`, `ytd`).
- Drill lists are capped at 200 records per row, newest first; a cut row carries `recordCount`, and the sheet says "Showing the latest 200 of N records.".
- Every query is strict. A parameter the route doesn't name is refused first with "This report can't be filtered that way.", before any field is read, so `?companyId=` can only ever be a mistake. A repeated parameter is refused with its field's message. Location ids are at most 50 UUIDs and must be live; a hub location must be a live warehouse; categories, expense categories (payroll refused) and methods must be in their lists; ids are UUIDs; a customer search is at most 100 characters.

### Switches, product and module (S13, S14)
- `reports.hub` off: every route answers 404; the web reads that as no reports and shows `NoAccess`.
- A report's own switch off: its route answers 404, and `options` leaves it out (with `reports.business` off, the salespeople and vendor lists are empty).
- An HR Suite company gets 403 `product_not_enabled`; a Flooring company with `core` off gets 403 `module_not_enabled`.
- `features.ts` and docs/FEATURES.md do not change: no status changed.

### Exports (S15)
CSV and PDF stay in the browser and are built from the API's answer, the same rows the screen shows (rule 2). The buttons show only for reports in `ReportOptions.exports`, which the server works out from `reports.financial.export` and `reports.sales.export` (`reportAccess`; a report can be exported only when it can be opened). There is no export route: the data a person may view is already in their browser. **Any future server-side export (Excel, emailed reports on pg-boss) must check the export key on the server.**

### Web (apps/web)
- **ApiClient:** `reportOptions`, `pnlReport`, `salesByCategoryReport` and `paymentsReport` are new; with `businessReport` all five are in `API_METHODS`. `report-paths.ts` builds the queries: only set fields, locations as one comma-joined value, the customer trimmed, never a company id. `reportOptions` reads a 403 `forbidden` or a 404 as `EMPTY_REPORT_OPTIONS`; every other failure (MFA, a suspended company, the wrong product) surfaces as elsewhere.
- **The Reports page** reads `reportOptions()` and only the report methods. Rule 1's choice of which report opens uses the server's list. The 11 `client.list` reads, `useCan` and the browser-side cost logic are gone. The nav lists only the four reports, from the shared catalog. Pickers and the warehouse filter come from `options`; a pick the server no longer lists is not sent (it reads as all).
- **Hub reports** (`hub-report.tsx`): one query per filter set, dates through `presentReport`, the customer search debounced by 300 ms and capped at 100 characters. While a new answer loads, the last rows stay dimmed and marked `aria-busy`, and the export buttons wait for the new rows, so an export always matches its filters (`shownAnswer` in `report-answer.ts`, shared with the Business report).
- **Business report:** drill lists are no longer cut on screen (the server caps them), and the sheet says "Showing the latest N of M records." with both numbers through `<Num>`. It keeps each answer with the filters it was read for, as the hub reports do: while a new answer loads, the last sections stay dimmed in a group marked `aria-busy`, and Export CSV and Export PDF wait, so a PDF never prints old figures under the new dates. Its Custom dates are checked on the screen with the shared `businessPeriodProblem` (the demo's check, and the API's rule, S8) before anything is sent: a pair the API would refuse (a day that isn't real, From after To, more than 366 days, a cleared date) is explained beside the inputs in the API's words, both inputs are marked `aria-invalid`, and the report stays on the last pair that worked, with its figures and its date line (`custom-period.ts`, `custom-dates.tsx`; review round 3).
- **"This report covers the whole company."** shows as a calm notice with a "Show my reports" button that reads the options again (`report-fallback.tsx`). A refused filter (any `REPORT_QUERY_MESSAGES` text, from the API's 400 or the demo) shows as a notice in the server's words, "Change the filters above to see the report.", with no Try again, since sending the same filters again would only be refused again (review round 3).

### Demo (S16)
DemoStore (`apps/web/src/lib/api/demo/report-actions.ts`) runs the same shared functions with the same visibility, the same scope rule (`scopeAllows`: own or branch), the same messages and the same empty options. It checks in the API's order: permission, switches ("This report is switched off." where the API answers 404), whole-company scope, days and period, then locations. A View as Manager in the demo no longer sees the Business report or P&L.

### The week-18 gate: location profits add up to company profit
Reports come from the documents, not the ledger, as the spec says. The gate is proven four times:
1. **Shared property test** (`business-report-gate.test.ts`): 40 seeded runs of 300 documents each, every invoice built through `computeTotals` or as a line-less credit note, random sharing rules, periods and filters (live location ids only), with and without pay sight. The Profit by location total `net` equals the Summary `net`, and the total `revenue` equals the Summary `revenue`. With no ids picked, a removed location's row reads "Removed location". The same file shows that windowed data gives the same answer as the whole record (S-WIN-1).
2. **API integration** (R-GATE in `reports.int.test.ts`): Summit plus edge rows written behind the API's back (a company-wide expense, a write-off, a line-less credit note at Southgate, a void invoice, an employee with no home location), four periods, four filter sets, as the Owner and as a role without pay sight, then again with Southgate soft-deleted. It first checks the document invariant on the seeded data.
3. **Equality** (R-EQ): the API's answer deep-equals the shared function run on the module loaders' full rows, for the Owner, the Accountant and a role without pay sight.
4. **On screen and in the CSV** (api-mode e2e): the Profit by location Total equals the Summary "Net profit, before income tax", on screen and in `business-report-<date>.csv`.

## Safest options taken (also in docs/blueprint-delta.md and the spec)
1. **S1. The Business report and P&L need data scope `all`.** Anyone else gets 403 "This report covers the whole company.", even with `reports.financial.view`; the screen hides them and the demo refuses them too.
2. **S2. Sales by category and Payments received apply data scope on the server,** with the invoice and customer rules of the sales routes (own or branch).
3. **S3. Pay sight is `hr.payroll.view`,** the rule `GET /expenses` and `GET /pay-periods` already use; People costs also need `hr.employee.view_sensitive` (the spec named only that key). Without pay sight, payroll expenses and pay periods are dropped before any figure is worked out, people costs are left out of Operating expenses, net profit and Profit by location, and the labels and notes say so. An Owner of a company with HR off loses pay sight.
4. **S4. Cost-of-goods figures also need `contracts.contract.view_sensitive` while the company has a live contract invoice,** whatever the module state, because that invoice's cost is the contract's estimated cost share, which the sales routes strip. With Contracts off nobody sees them while contract invoices exist. No default role is affected while Contracts is on.
5. **S5. Purchases by supplier needs `inventory.product.view_sensitive`,** like the order unit costs it adds up. No default role is affected.
6. **S6. Sales by category's Cost and Margin need the full `margin` flag** (the spec named only the product-cost key), and hidden columns are absent from rows and totals; the demo kept them in the totals. No default role is affected.
7. **S7. Stripped at the source:** hidden figures are not computed, so they are absent from rows, values, totals and drill records. The interceptor stays as a second net, and the expense column id `cost` becomes `amount`.
8. **S8. Bounds:** report days in 1900 to 2999; a Business report period of at most 366 days; the four hub presets only; drill lists capped at 200 per row, saying "Showing the latest 200 of N records." (the spec stopped silently).
9. **S9. One read-only, repeatable-read snapshot per request.**
10. **S10. Strict queries:** an unknown parameter is refused before anything else, a repeated one with its field's message; locations must be live (warehouses for the hub reports); product categories, expense categories and payment methods must be in their lists; salesperson and vendor ids must be UUIDs, and an unknown one matches no records rather than being refused (see Residual risks); `?companyId=` is refused.
11. **S11. `Cache-Control: private, no-store`** on every report answer.
12. **S12. Write-off `at` and goods receipt `receivedAt` are read as company days.** A correctness fix more than a safety one; it closes the STATUS follow-up for reports.
13. **S13. Flooring Suite only, module `core`.**
14. **S14. The removed reports have no route** and the page no longer lists them; bringing one back needs an API route first.
15. **S15. No export route;** the buttons follow the server's `exports`; a future server export must check the export key on the server.
16. **S16. DemoStore follows S1 to S18** with the same shared functions, messages, scope rule and empty options.
17. **S17. Every cost-of-goods figure also needs `inventory.product.view_sensitive`** (blueprint p27; `GET /invoices` strips invoice cost without it). No default role is affected.
18. **S18. The P&L's Cost of goods, Gross margin, Margin and Net income need the `margin` flag;** without it the P&L shows Month, Revenue and Expenses. The spec and demo showed them to every holder of `reports.financial.view`. No default role is affected.

**Also safer, settled while building:**
- **Unknown parameters are refused before field errors.** Zod reports field errors first, so `?companyId=` with a bad date would have answered "Enter a date."; each parser now refuses an unknown key first, and the strict schemas stay as a second net.
- **Repeated location ids are de-duplicated,** and an empty `locationIds=` means none picked.
- **The demo checks the warehouse on all three hub reports** and refuses a customer search over 100 characters, as the API does.
- **An empty branch on a demo user counts as no branch,** so it never widens what someone sees.
- **Stale picks are not sent:** a location, salesperson or vendor the server no longer lists reads as all, not a 400.
- **An export always matches its filters:** on every report, the Business report included, the export buttons wait while a new answer loads.
- **Custom dates the API would refuse are never sent:** the screen checks them with the same shared function and says why beside the inputs, so a typo or a two-year range keeps the last figures instead of replacing every section with "This page could not load its data." and a Try again that could only be refused again; a refused filter that does reach the server reads as a notice, not a load failure (review round 3).

## Kept as the spec says (not safety)
- Business rules 2 to 21, including the shared-cost weights over all non-void invoices in a month whatever the filters, and one payroll source per month.
- Rule 22's filters with their known limits: the product category filter reaches only the top of the Summary; Location, Vendor and Expense category skip some sections without a note; the expense category list offers Sales tax payment (empty Expenses sections) and leaves out payroll.
- "Sections hidden from a person still count" for pay-sight holders: the Accountant's Operating expenses and net include people costs, because `hr.payroll.view` already shows every pay line.
- Balances at an earlier date use today's void state; `earliest` includes void invoices; "Still owed" can go negative; "Received but not billed" prints a literal "$" and the raw value; the two service labels (rule 15 versus rule 24); a pay period lands in its end month; a short range can pick the other payroll source; contract retainage as the spec says.
- CSV and PDF built in the browser; the exports print only the dates (Business report) or the filters the spec lists.
- Reports come from the documents, not the ledger.

## Smaller choices made while building (not safety)
- **Raw values with a format hint** in the hub reports (`format: "date"` or `"month"`), applied by the web's `presentReport` with the company's date pattern; a malformed value is left as it is.
- **The invoice number in Payments received** is looked up in all the invoices read, not only those issued in the range; the demo blanked the number of a payment whose invoice was issued before the range.
- **`DEFAULT_SHARED_COSTS`** (the revenue rule, ADR 0023) when a company has no `sharedCosts` row; it and `EMPTY_REPORT_OPTIONS` are frozen at the top level.
- **Drill order:** newest first, then by label in plain character order, not locale order, so the server and every browser sort alike. Payments received keeps the web's original sort (date, then number).
- **Picker order:** salespeople by name (`localeCompare(…, "en")`), then id, on the API and in the demo. Vendors come from Postgres `ORDER BY name, id` on the API and `localeCompare` in the demo; these could differ on unusual names (Summit's agree).
- **The Summary note "People costs are left out…"** shows whenever margin is shown without pay sight, also with a salesperson filter, as the plan wrote it.
- **More memoisation than planned:** suppliers, users and locations too. Before the commit, the old and new `business-report.ts` were run side by side on Summit and Keystone over 60 period and filter combinations, with everything shown and everything hidden; they matched except the intended changes.
- **New shared names:** `REPORT_CUSTOMER_SEARCH_MAX` (one limit for the API, the demo and the input), `REMOVED_LOCATION`, `BusinessWindow`, `HubWindow`, `ReportEntry`, `LedgerInvoice`, `LedgerBill`, `LedgerSupplierPayment`, `BusinessRoll`. `access-rules.test.ts` lists `paymentsTo` as not sensitive.
- **API helpers beyond the plan:** `loadInvoiceRepIds` and `loadVendorOptions` for the pickers, `withLines`, `ReportInvoice`, `ReportPayment`, `REPORT_DAY` and `MAX_REPORT_LOCATIONS = 50`; `requireReport(key?)` checks the hub, then the report's switch; the options route also reads in one snapshot.
- **Screens:** `hub-report.tsx` and `report-fallback.tsx` split out of the page, `ScrollRegion` gains a `busy` prop (`aria-busy`). Side effect: the hub's filter choices reset after visiting the Business report.
- **Kept builders:** `report-model.ts` keeps only the four removed reports' builders, as rule 25 says, with a header citing S14.

## Deferred, not invented
- **Freezing shared-cost shares when a period closes** (an `expense_allocations` table, ADR 0023 Consequences): a migration.
- **Indexes on `invoices.issued_at`, `expenses.date` and `payments_received.date`:** a migration. Windowed reads scan these tables; fine at Summit's size.
- **A branch Business report and P&L:** needs a spec (owner question 1).
- **Excel and emailed reports,** with server-side export checks.
- **Reconciling reports with the ledger:** the ledger holds only postings since go-live and seeded history posted nothing, so it belongs to the whole-product check.
- **The "Profit before shared costs" column and the note naming the sections a filter doesn't reach** (ADR 0023 "As built").
- **Employer payroll taxes** (ADR 0023).
- **Gating the trial balance's Cost of Goods Sold and Wages accounts** like the reports (P13; owner question 7).
- **Payment `recordedAt` and `voidedAt` as company days:** reports read payment `date`, so the PR #18 follow-up stays open for commissions only.

## For the owner
Also in docs/product-spec/reports.md, "Real build (ADR 0055)", and the session log.
1. **Branch managers (S1).** Should a Manager get a branch Business report and P&L? It needs a spec: which sections, shared costs as one line with no weights, and no company-wide balances, cash, taxes or people costs. Until then they are refused on the API and in the demo.
2. **Pay sight (S3).** Pay-inclusive figures now need `hr.payroll.view`, the Owner included, so with HR off nobody sees people costs. Right? And without pay sight, should Operating expenses and net profit show with people costs left out and labelled, as built, or should the Summary stop at gross profit as it does with a salesperson filter?
3. **Contracts (S4).** While live contract invoices exist, cost-of-goods figures need `contracts.contract.view_sensitive`; with Contracts off nobody, the Owner included, sees them, matching the sales routes. Accept, or should the Owner keep them?
4. **Cost key (S17) and the P&L (S18).** Cost-of-goods figures also need `inventory.product.view_sensitive`, and the P&L hides its cost and margin columns without the `margin` flag. No default role changes. Confirm.
5. **Period length (S8).** Is a 366-day cap on the Business report period right, or should it allow up to two years for year-over-year (1,462 days of documents read)?
6. **Exports (S15).** Exports stay screen-checked because viewing already sends the data. Acceptable until Excel and emailed reports come, when the server will check the export key?
7. **Trial balance.** `GET /ledger/trial-balance` shows the Cost of Goods Sold and Wages accounts to anyone with `reports.financial.view` and scope `all`, without the margin, cost or payroll keys. Should P13 gate those accounts the same way? **Default taken 2026-11-20** (below, "Trial balance"): the whole trial balance is refused without the sight its figures reveal. Still open for the owner to confirm.
8. **Schema follow-ups** (each a migration): freezing shared-cost shares when a period closes (`expense_allocations`, ADR 0023), and indexes on `invoices.issued_at`, `expenses.date` and `payments_received.date`.
9. **Removed reports (S14).** Keep their web builders as rule 25 says, or delete them as dead code now that the page no longer lists them?

## Residual risks
- **History for balances.** Balances and "still owed" read every invoice head to the end of the period's month, and every payment, adjustment, bill and supplier payment up to the period's end, as narrow columns. This grows with history, and the date columns have no index. A balance read model or indexes would fix it; both need a migration.
- **Live shares.** Shares are derived live: voiding an old invoice under the revenue rule, or changing the rule, rewrites past months (ADR 0023).
- **Trial balance.** Closed 2026-11-20 (below, "Trial balance"): the route now needs the cost, contract and pay sight its figures reveal.
- **Module switches hide figures from the Owner.** With HR off, no people costs; with Contracts off and contract invoices present, no cost-of-goods figures. Deliberate (S3, S4), and the same as the sales and expense routes.
- **No rate limit** on report reads. The P13 review should look at expensive reads.
- **Browser exports.** Export gating is screen-only (kept).
- **Browser day.** In api mode the Business report's presets use the browser's day; the server clamps "as of" to the company's today.
- **Time zone changes.** Changing a company's time zone moves past invoice days (STATUS, unchanged).
- **Snapshot cost.** A REPEATABLE READ snapshot holds an old xmin for the length of one report read (well under a second on Summit).
- **Rep names** come from the control database, outside the snapshot. A removed user reads "Former employee".
- **Deleted rows.** Deleted products' categories and deleted employees' names and home locations are read for old documents. No route deletes either today; this matters for import and later work.
- **Shared-cost settings are not shape-checked** when read: a malformed `sharedCosts` row would fail the report (a 500), not leak anything. `DEFAULT_SHARED_COSTS` applies only when there is no row.
- **Supplier names** for old documents include deleted suppliers, while the integration test's expected values use live suppliers; the seed has no deleted supplier, so the test doesn't tell the two apart.
- **Shared empty options.** `EMPTY_REPORT_OPTIONS` is frozen at the top level only, and both clients return that one object; a screen that changed its lists would change them for everyone. No screen does.
- **Drill links** (`href`) still point at the web routes as before; not checked in api mode.
- **Test clock.** R-EQ and R-GATE work out the company's today in the test, so a run that crosses Denver midnight could flake.
- **Salesperson and vendor filters are checked only as UUIDs** (S10), not against the company's reps or suppliers: an unknown id matches no records and its sections come back empty, with a 200. Nothing leaks, because the tenant comes from the session, the Business report needs data scope `all`, and the screen sends only ids from the options. Refusing an unknown id (400 with the salesperson or vendor message) would need a check inside the snapshot and the same in the demo.

## Consequences
- **No schema, dependency or core change:** no table, column, index or migration, no dependency, and nothing in core/auth or core/tenancy (`@RequireProduct()` is used from the module side). `features.ts` and docs/FEATURES.md are unchanged. Reports write nothing: no audit row, no Outbox row.
- **Changed behaviour:** in both modes a Manager (or anyone below scope `all`) no longer opens the Business report or P&L; the expense sections' column id is `amount`; the P&L and Sales by category drop hidden columns from rows and totals; the page no longer lists the four removed reports; drill sheets say how many records there are when cut.
- **Paths touched:** `packages/shared/src/business-report.ts`, `expenses.ts`, `ledger.ts`, `sales-lines.ts`, `operations/purchasing.ts`, `analytics.ts`, `stock.ts`, `cost-sharing.ts`, `index.ts` and the new `src/reports/` folder; `apps/api/src/modules/reports/*` and one import in `app.module.ts`; `apps/web/src/lib/api/` (`contract.ts`, `http/api-methods.ts`, `http/report-paths.ts`, `demo/report-actions.ts`, `demo/store.ts`), `features/reports/*`, `components/warehouse-select.tsx` (type only) and `components/scroll-region.tsx`.
- **The docs changed:** docs/api-contract.md, docs/product-spec/reports.md ("Real build (ADR 0055)", and the limits it closes marked), docs/data-model.md and docs/blueprint-delta.md.
- **Tests:**
  - packages/shared: new `report-visibility` (15 cases), `report-catalog` (13), `report-periods` (6, the sixth for `businessPeriodProblem`, review round 3), `hub-reports` (12, with golden values taken from the old web builders), `report-drill` (4), `business-report-strip` (9) and `business-report-gate` (13: the windowing check and the 40-run gate property test); `expenses.test.ts` (32) and `access-rules.test.ts` edited. The package: 825 cases in 64 files at the docs commit, 826 after review round 3.
  - apps/api: new `test/reports.int.test.ts` (29 cases: R-AUTH, R-PRODUCT, R-KEY, R-SCOPE-1 to 4, R-ROLE-1 to 3, R-STRIP-1 to 6, R-MODULES-OFF, R-RANGE, R-SWITCH, R-REMOVED, R-EQ, R-DELETED, R-DRILL, R-ISO, R-NOAUDIT, R-CACHE, R-SNAP, R-GATE, and the seeded-invariant check) and unit `test/report-params.test.ts` (14). The route inventories (`isolation.int.test.ts`, `permissions.int.test.ts`) pick up the routes unedited and pass.
  - apps/web: new unit `report-paths` (4), `reports-api` (4), `demo-reports` (9), `present-report` (3) `report-answer` (4, review round 2) and `report-refusals` (6, review round 3: the Custom dates model, the inline message and `aria-invalid`, and the fallback's notices); the web unit suite is 130 cases in 19 files. The demo `tests/e2e/reports.spec.ts` gains View as Manager; `tests/e2e/expenses.spec.ts` gains a Business report test where a 2020 From is explained beside the dates while the Summary and Export CSV stay; `tests/e2e/payments.spec.ts` now waits for the refreshed rows after a filter change. New api-mode `tests/e2e-api/reports.spec.ts` (3 tests: the Owner's four reports, the gate on screen and in the CSV, and the Business report's exports waiting while a held answer for a new period loads; the Manager's 403s; the salesperson's narrow view).
  - Runs before the docs stage: the demo e2e flooring project 257 passed and 1 skipped (the switched-off sales tax report); the api-mode suite 23 of 23; the reports integration file 29 of 29 and the isolation, permissions, expenses and invoices files 67 of 67; mutation checks on scope, the whole-company check, UTC write-off minutes, customer scope, the period-end heads, removed-location rows and the margin value each made tests fail.

## 2026-11-17 (B5): one two-key rule and a stored P&L
- **The margin flag calls `seesMargin`.** `reportVisibility`'s `margin` flag is `seesMargin(has)` (both `sales.margin.view_sensitive` and `inventory.product.view_sensitive`, the rule quotes and the dashboard use) plus the S4 contract-cost condition. The truth table is unchanged, and `report-visibility.test.ts` passes unchanged.
- **`pnlReport` reads its months through `storedPnl`,** which refuses an unknown cost of goods. `monthlyPnl` now takes invoices as received and gives a null cost for a month with a withheld cost (the dashboard's case), but the report's inputs (`invoices.cost NOT NULL` in the API's report rows; DemoStore's rows) can't hold one, so the P&L is the same byte for byte (S-HUB-1, R-EQ).
- **No column, flag or route changes.** See ADR 0037, "A withheld cost on the dashboard and Sales → Team (2026-11-17, STATUS B5)".

## Trial balance (2026-11-20)
The owner's queue, item 2, "a trial balance screen" (ADR 0039 "Later"). Built on `feat/finance-trial-balance-screen`; session log docs/sessions/2026-11-20-1516-a-trial-balance-screen.md.

- **Where:** a fifth report in the Reports hub, `/reports?report=trial-balance`, "Trial balance", after Payments received (report key `trial-balance` in `REPORT_CATALOG`, `wholeCompany: true`, view `reports.financial.view`, export `reports.financial.export`). The hub already lists only what `GET /reports/options` allows, so the screen is hidden from everyone the API refuses.
- **No new switch.** The entry rides on `reports.hub`: the other reports' own switches came from the demo, where the trial balance never was. The route now answers 404 while the hub is off (CLAUDE.md rule 13); before, it answered regardless.
- **Owner question 7, the safer default: refuse the whole trial balance, don't hide rows.** Hiding the Cost of Goods Sold and Wages rows isn't enough: the other side of each posting (Inventory and Accrued Payroll credits, Cash) and the column totals give them back. So `seesTrialBalance` (packages/shared/src/reports/trial-balance.ts) asks for everything the books reveal:
  - always the margin rule (`sales.margin.view_sensitive` and `inventory.product.view_sensitive`, S17);
  - `contracts.contract.view_sensitive` once a contract billing has posted (S4's rule, read from the journal, because a subcontract bill's cost is in Cost of Goods Sold even without a contract invoice);
  - `hr.payroll.view` once pay has posted (S3): a pay-run, contractor-payment or commission-statement entry, or a line on Wages, Accrued Payroll, Commissions or Contract Labor (a payroll expense posts to Wages). Pay rates (`hr.employee.view_sensitive`) aren't needed: the books hold pay per location, never per person.

  The facts are read over all time, whatever `through` is, and the facts and the figures come from one read-only, repeatable-read snapshot, so a posting that lands between them can't slip through. Refused: 403 `forbidden` "The trial balance shows cost of goods and pay, which your access doesn't include.", after the switch, scope and query checks. `GET /reports/options` lists `trial-balance` only when the route would answer (`reportAccess(viewer, isOn, books)`).
- **Who keeps it:** the Owner and the Accountant (default roles). **Who loses it:** custom roles without those keys, and the Owner of a company with HR switched off once pay has posted (as the reports' S3). A Manager (scope `branch`) never had it.
- **Demo: hidden, not derived.** The demo keeps no journal (its "ledger" is each invoice's balance), so a trial balance made up from the documents would be invented figures that disagree with the API's postings. `reportAccess` lists it only when the caller passes `books`, which only the API does; `DemoStore.trialBalance` refuses with "The demo keeps no journal, so it has no trial balance.".
- **The screen** (`apps/web/src/features/reports/trial-balance-report.tsx`, model in `trial-balance-model.ts`): an As of day (the app's today by default; a day `reportDayProblem` refuses is explained beside it and never sent, and the figures stay); accounts grouped Assets, Liabilities, Equity, Revenue, Expenses, with empty accounts behind "Show accounts with no entries"; Debits, Credits and the balance on its side (Dr or Cr) through `<Num>`; the totals; and a Balanced or Out of balance pill with the difference. Export CSV for `reports.financial.export` holders gives the accounts on screen and the totals as raw values, `trial-balance-<day>.csv`. No PDF. A refusal after the list was read (the books gained pay or contract postings) shows its words with "Show my reports".
- **Flooring Suite only,** like the hub (`@RequireProduct("flooring")` on the route, security review round 2): an HR Suite company gets 403 `product_not_enabled`. Before, an HR Suite Owner could read it; no screen or caller outside the hub reads it.
- **Accepted disclosure (review round 2):** someone with the cost keys but without pay or contract sight is refused once pay or a contract has first posted, so they learn that it has, never an amount. The message is the same for either fact.
- **CSV formulas (review rounds 1 and 2):** every `toCsv` export and the Business report's CSV now go through `csvCell` (`apps/web/src/components/data-table/csv.ts`), which puts a `'` before text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return, as the import's CSV does (ADR 0057 S-15); plain numbers, negative ones included, stay as they are. An account, vendor or customer name can't run as a formula in the accountant's spreadsheet.
- **Types:** `TrialBalance` and `TrialBalanceRow` moved from apps/api to packages/shared; the answer is unchanged.
- **Not done:** the period-close screen (ADR 0039 "Later"); the As of day still starts from the browser's today (STATUS, `today()` in the company's time zone).
