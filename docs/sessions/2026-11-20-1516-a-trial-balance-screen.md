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

## What was built
As planned, with three changes from the security reviews:
- the route is Flooring Suite only, like the hub (round 2);
- every CSV cell goes through a formula-safe `csvCell` (rounds 1 and 2);
- every journal source type is classified in `SOURCE_SIGHT`, so a new one can't skip the sight rule (round 3).

Details are in ADR 0055, "Trial balance (2026-11-20)".

Files changed:
- **packages/shared:**
  - `src/reports/trial-balance.ts` (new): the types, `seesTrialBalance`, `SOURCE_SIGHT`, the pay accounts and the message;
  - `src/reports/catalog.ts`: the `trial-balance` entry and `reportAccess(…, books)`;
  - tests: `trial-balance-sight`, `report-catalog`, and `access-rules` (one field classified).
- **apps/api:**
  - `core/ledger/ledger.service.ts`: `trialBalanceFacts`, as two indexed checks;
  - `modules/finance/ledger.controller.ts`: product gate, switch, snapshot, sight rule and no-store;
  - `modules/reports/reports.service.ts`: options;
  - tests: `trial-balance.int.test.ts` (10 cases), and the expectations in `reports.int.test.ts`.
- **apps/web:**
  - `features/reports/`: `trial-balance-report.tsx`, `trial-balance-model.ts`, `reports-page.tsx`, `hub-report.tsx`, `report-fallback.tsx` and `business-report.tsx` (`csvCell`);
  - `components/data-table/csv.ts`;
  - `lib/api/`: `contract.ts`, `http/api-methods.ts` and `demo/store.ts`;
  - unit tests: `trial-balance`, `csv-cell` and `api-rereads`;
  - Playwright: `tests/e2e-api/trial-balance.spec.ts` (new) and `tests/e2e/reports.spec.ts` (the demo never offers it);
  - comments in `tests/e2e-api/flows/{checks,ledger}.ts`.
- **docs:** ADR 0055, api-contract, the reports spec, FEATURES (the `reports.hub` row) and blueprint-delta (a row dated 2026-11-20).

## Decisions and why
1. **It sits in the Reports hub, with no new switch.** The hub already hides whatever the server's options leave out. The report rides on `reports.hub`, so no feature-change confirmation is needed.
2. **Owner question 7, the safer default.** The whole report is refused without margin and product cost, plus contract cost and pay sight once those have posted. Hiding rows would leak through the other side of each posting and through the totals. The Owner and the Accountant keep it.
3. **The demo hides it rather than deriving it.** The demo has no journal, so a derived trial balance would show invented figures.
4. **The route is now Flooring only and returns 404 while the hub is off,** the same as the options list.
5. **Every CSV export now puts `'` before formula-like text.** This change is visible: a phone number `+1 303…` exports as `'+1 303…`. Plain numbers are unchanged.

## Commands run and results
| Check | Result |
| --- | --- |
| `pnpm lint` | pass (ESLint and Prettier) |
| `pnpm typecheck` | pass, 6 of 6 |
| `pnpm test` | shared 1218, web 478, api 128, db 18, providers 11: all pass |
| API integration, full (`--maxWorkers=3`), on `efa0bbf` | 46 files, 919 passed |
| `trial-balance.int.test.ts` on the head | 10 passed |
| Mutation: sight rule off | 4 tests failed (caught), then restored |
| Mutation: pay-account fact off | 3 tests failed (caught), then restored |
| Playwright, api mode and demo | api mode 64 passed (1 worker, fresh database); demo reports 4 passed and 1 skipped; demo export specs 55 passed and 1 skipped. See "E2E" below |

## Security review rounds
1. **Round 1: PASS, with 2 Low findings.**
   - CSV formula injection through account names: fixed with `csvCell` and a test.
   - The pay fact used an OR join that scanned every line: split into two indexed checks, with a test for the account path.
2. **Round 2: PASS, with 4 Low findings.**
   - The Business report's CSV bypassed `csvCell`: fixed.
   - The shared escape had no tests of its own: `csv-cell.test.ts` added.
   - The refusal reveals that pay or a contract has posted: accepted and recorded in the ADR.
   - The route had no product gate: `@RequireProduct("flooring")` added, with an HR Suite test.
3. **Round 3: PASS, with 4 findings.**
   - The source lists weren't tied to the source type: the `SOURCE_SIGHT` Record was added, with a test.
   - The pay-period CSV doesn't escape names: this predates the branch (ADR 0057 S14, an open owner question) and is out of scope.
   - `csvCell` changes some exported text: noted for the PR.
   - Old figures might stay on screen after a refusal: checked, and they don't, because `useApiQuery` clears its data on error.
4. **Round 4: PASS, 0 blocking.** Three notes are left as follow-ups:
   - the visible text change from `csvCell`;
   - the fact queries run even when the margin rule already refuses;
   - "The books cover the whole company." is repeated in the web and the API, and could move to packages/shared.

## What is left
1. Playwright, once the coordinator frees the ports:
   - `pnpm build` in api mode, then `tests/e2e-api/trial-balance.spec.ts` and the whole api-mode suite (1 worker, on a throwaway Postgres on 5434 or through the launcher);
   - `pnpm build` in demo mode, then `tests/e2e/reports.spec.ts` with 2 workers.
2. The period-close screen (ADR 0039 "Later").
3. The round 4 follow-ups listed above.

## Next prompt
"On `feat/finance-trial-balance-screen` (worktree C:\dev\fp-tb), the ports are free. Build in api mode and run `tests/e2e-api/trial-balance.spec.ts`, then the whole api-mode suite on a fresh Postgres 16 on 5434. Build in demo mode and run `tests/e2e/reports.spec.ts` with 2 workers. Fix any failures and record the results in this log, then open the PR."

## For STATUS
- [x] **Trial balance screen** (queue item 2), on `feat/finance-trial-balance-screen`, stacked on #66.
  - **Screen:** Reports → Trial balance, in api mode only. It shows an As of day, the accounts grouped by kind, the totals, a Balanced or Out of balance indicator, and Export CSV.
  - **Route:** `GET /ledger/trial-balance` now needs the cost, contract and pay sight its figures reveal (owner question 7, safer default). It is Flooring only and answers 404 while `reports.hub` is off.
  - **Exports:** every CSV export is formula-safe.
  - **Demo:** never offers the report.
  - **Records:** ADR 0055 "Trial balance", and the blueprint-delta row dated 2026-11-20.
  - **Checks:** lint, typecheck, unit tests and API integration (919) pass. Four security review rounds, the last with 0 blocking findings. Playwright waits for free ports.
- **Owner questions** (each default is built):
  1. Q7: the whole trial balance is refused without the sight.
  2. An Owner with HR switched off loses it once pay has posted.
  3. HR Suite companies lose the route.
  4. CSV text that starts with `+`, `-`, `=` or `@` exports with a leading `'`.

## Reviewer summary
Security review by the security-reviewer subagent: 4 rounds on `29e8d42..HEAD`. The final round is a PASS with 0 blocking findings.

- **Tenancy:** the company comes only from the session, through TenantConnectionService. `through` is the only input, and Zod checks it.
- **Order:** product (Flooring), module `core`, `reports.financial.view`, hub switch (404), scope `all` (403), `through` (400), then `seesTrialBalance` (403). All of these run before any figure is read.
- **Sight rule:**
  - the margin rule, always;
  - contract cost sight once a `contract_billing` entry exists;
  - `hr.payroll.view` once pay has posted (pay sources, or lines on Wages, Accrued Payroll, Commissions or Contract Labor).

  Every posting source is classified in `SOURCE_SIGHT`, a Record, so a new source can't compile unclassified.
- **Snapshot:** the facts and the figures come from one read-only, repeatable-read snapshot, and the facts cover all time.
- **Consistency:** the options and the route agree, and the demo never offers the report. Export follows `options.exports`. Money stays as decimal strings shown through `<Num>`.
- **Accepted:** the refusal reveals that pay or a contract has posted, never an amount (ADR 0055).
- **Fixed during review:**
  - CSV formula injection: `csvCell` now covers every `toCsv` export and the Business report;
  - the pay fact now uses indexed checks instead of a scan;
  - the Flooring product gate;
  - the source classification.
- **Open, non-blocking:**
  - the pay-period CSV doesn't escape names (predates the branch, ADR 0057 S14);
  - the fact queries run even when the margin rule already refuses;
  - one refusal string is repeated in the web and the API.

## E2E (ports handed over by the coordinator)
- **Database:** a throwaway Postgres 16 container on 5434. Secrets were made in-process and never printed or read from `.env`; the shared 5432 was left alone. Setup ran as CI does: seed, seed, migrate, then `pnpm --filter api build` and an api-mode `pnpm --filter web build`.
- **New spec (`tests/e2e-api/trial-balance.spec.ts`):**
  - **First run:** 1 failed, 1 passed. The screen was right: on a fresh database nothing has posted, so the books have no accounts (ADR 0039, accounts are made by the first posting). The spec had assumed every group was present.
  - **Fix (test only, `e8fdbc2`):** the spec now checks the groups and accounts the answer holds, and the empty-books message when there are none.
  - **Rerun:** 2 passed.
- **Whole api-mode suite, 1 worker, same throwaway database:** 64 passed in 6.0 min. The trial balance spec ran 60th of 64. By then the earlier specs had posted, and by the end the database held 29 accounts and 15 entries, so it most likely read populated books.
- **Demo build (`NEXT_PUBLIC_DATA_SOURCE` unset), 2 workers:**
  - `tests/e2e/reports.spec.ts`: 4 passed, 1 skipped (the switched-off sales tax report).
  - Every demo spec that exports a file (admin, expenses, import, invoice-lifecycle, meetings-invites, payments, quote, reports, states, tables), because `csvCell` now covers every CSV: 55 passed, 1 skipped.
- **Clean-up:** servers stopped, ports 3000 and 4000 free, the throwaway container removed and the secrets file deleted.
- **No product code changed in this step,** so no new security review was needed.
