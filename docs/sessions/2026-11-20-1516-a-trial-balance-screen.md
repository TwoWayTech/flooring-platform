# 2026-11-20 15:16, A: a trial balance screen

Branch `feat/finance-trial-balance-screen`, stacked on `feat/inventory-stock-rules-api` (PR #66). Worktree `C:\dev\fp-tb`.

## Goal
The owner's queue, item 2: "a trial balance screen". `GET /ledger/trial-balance` exists (ADR 0039); no screen shows it (ADR 0039 "Later", STATUS).

## Prompt used
A builder brief from the coordinating session: build a read-only Trial balance screen, api mode through the ApiClient, the demo either derived or hidden (pick the safest and record it), and decide owner question 7 of docs/product-spec/reports.md (the trial balance shows Cost of Goods Sold and Wages to `reports.financial.view` holders whatever the reports hide). Tests, a fresh security review each round, no PR, no STATUS/BRANCHES edits, e2e only once the ports are free.

## Plan
1. **Where it lives.** A fifth report in the Reports hub, `/reports?report=trial-balance`, labelled "Trial balance", after Payments received. The hub already lists only what the server's `GET /reports/options` allows, shows Export only for what it lists in `exports`, and refuses with NoAccess, so the screen is hidden for anyone the API refuses. The catalog entry rides on the hub's own switch, `reports.hub`: no new feature key (every report has one only because the demo had them; the trial balance never was in the demo).
2. **Who may open it (API, safer direction, owner question 7).** Everything the route already checks (module `core`, `reports.financial.view`, data scope `all`), plus the hub switch (404 when off, CLAUDE.md rule 13), plus **all the sensitive sight the books reveal**, refused whole with 403 otherwise:
   - the reports' margin rule (`sales.margin.view_sensitive` and `inventory.product.view_sensitive`, ADR 0055 S17), and `contracts.contract.view_sensitive` while the ledger holds a contract billing posting (S4's rule, read from the ledger);
   - pay sight, `hr.payroll.view` (S3), while the ledger holds a pay posting (Wages, Accrued Payroll, Commissions or Contract Labor, or a pay-run, contractor-payment or commission-statement entry).
   Hiding only the Cost of Goods Sold and Wages rows is not safe: the other side of each posting (Inventory credits, Accrued Payroll credits, Cash) and the column totals give them back. The facts and the figures are read in one read-only snapshot, so a posting that lands between them can't slip through. Owner and Accountant keep it; a custom role without those keys loses it, and so does an Owner of a company with HR off once pay has posted (as with the reports, S3).
3. **Demo.** The demo keeps no journal (its "ledger" is each invoice's balance), so a derived trial balance would be invented figures that disagree with the API's postings. The screen is api mode only: `reportAccess` lists it only when the caller says the books exist and may be seen, which only the API does; `DemoStore.trialBalance` refuses.
4. **Shared:** `TrialBalance` types move to packages/shared (the API and the web share them); `seesTrialBalance` and its message; catalog entry; `reportAccess(viewer, isOn, books)`.
5. **API:** the route gains the switch, the sight check in a snapshot, `Cache-Control: private, no-store` (S11); `GET /reports/options` lists `trial-balance` for those who pass.
6. **Web:** `trialBalance(through)` in the ApiClient and API_METHODS; a Trial balance view: "As of" day (defaults to today, checked by `reportDayProblem` before sending), rows grouped by account type, empty accounts hidden behind a switch, debit/credit/balance through `<Num>`, totals, a balanced or out-of-balance indicator, CSV export (Export key only).
7. **Tests:** shared unit (sight rule, catalog), web unit (the view model and CSV), API integration (refusals, sight by role and facts, switch, options, snapshot answer), Playwright api-mode spec, and a demo assertion that the hub doesn't list it.
8. **Docs:** reports spec "Real build" section, ADR 0055 addendum (question 7 answered with the default), docs/api-contract.md, docs/FEATURES.md `reports.hub` row, blueprint-delta row dated 2026-11-20.
