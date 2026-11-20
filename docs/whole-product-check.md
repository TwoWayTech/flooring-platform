# Whole-product check: report

The owner's step 3 (STATUS "Next three tasks"): compare the specs, the feature register and the demo script with what runs on the real API; prove the books agree with the documents; call every endpoint as every role and as another company's user; make a fresh company from the setup script, import sample CSV data and walk the demo script in api mode. Built 2026-11-16, resumed and finished 2026-11-20 on `feat/check-whole-product` (draft PR #43), on main plus PR #68's stack. ADR 0058 records the decisions; the session log docs/sessions/2026-11-16-1241-b-whole-product-check.md holds every command, number and finding; docs/real-build-coverage.md answers "what runs on the real API", item by item.

## Verdict

| Piece | Result | Counts | Gaps pinned |
| --- | --- | --- | --- |
| Coverage list (generated) | Pass | 65 pages: 35 on the API, 22 mixed, 1 demo-only, 7 no data (incl. `/[...missing]`); 225 routes, 207 reached by a screen; 168 screen calls on the API, 38 reviewed on DemoStore | G5 |
| Real-build coverage (hand-written) | Written | 72 features: 38 done, 23 partly, 1 missing, 10 not on the API by design; 37 demo-script steps: 21, 14, 0, 2 | G1 to G7 |
| Permission matrix | Pass, no leak | 201 company routes × 12 default roles = 2,412 pairs against the shared engine, 201 wrong-host checks, every company route refused on another product's host, switches traced, data scope on 9 lists, sensitive fields on every list read | F-h, F-j |
| Money integrity | Pass, every equality exact | E1 to E15 after every step of 5 seeds × 108 steps (opt-in) or 58 steps (default); R1 to R6; contracts, payroll, immutability, closed period, banks | F-a (by design), F-m |
| Bare new company (FA) | Pass | 13 tests: what a provisioned company can and can't do | G2, G3, G4 |
| Fresh company from the setup script with sample CSV data (FS) | Pass | 6 tests: the real script, every settings tab and section, two locations, four CSV files, a purchase and a sale with the ledger agreeing to the cent | G2, G3, G4 |
| Fresh company in the browser (FC) | see "Browser runs" | | G1 |
| Demo script on Summit (DS) | see "Browser runs" | | |
| Page × persona matrix (PGM) | see "Browser runs" | | |
| Mutations | 11 of 11 caught | M1 to M10 from the plan, M11 for FS | |

## How to rerun

- Default guards (in CI): `pnpm test` (coverage list, page gates, money in the UI) and `pnpm test:api` (route matrix, money integrity, FA, FS, FH).
- Long variants: `WHOLE_CHECK=1 pnpm test:api` (all twelve roles over HTTP, five money seeds of 108 steps). One seed: `WHOLE_CHECK=1 MONEY_SEED=20261118 pnpm --filter api exec vitest run --project integration test/money-integrity.int.test.ts`.
- Browser suites (opt-in, on a throwaway database on port 5433 outside CI): build both apps (`pnpm --filter api build`, `NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build`), then `WHOLE_CHECK=1 pnpm --filter web test:e2e:api tests/e2e-api/check`. PowerShell: `$env:WHOLE_CHECK = "1"` first.
- After a PR adds a route, a client method, a page rule or a role change: `pnpm --filter api exec vitest run --project integration test/route-matrix.int.test.ts -u` and `pnpm --filter web exec vitest run tests/unit/coverage-list.test.ts tests/unit/page-gates.test.ts -u`, then review the diff.
- Why the browser suites stay out of CI: verify runs 11 to 18 minutes on ready PRs against a 25-minute limit; the three suites add several minutes of builds and browser time. Owner question Q1.

## Results

### Coverage

From `docs/coverage.md`. The mixed pages (G5) are the dashboard (17 DemoStore lists), Sales, Inventory and the roll page, the invoice page, the Outbox and the settings pages whose Reset to default still reads DemoStore. Routes no screen calls (18): bonuses and contractor payments, clock entries, the period close and accounting settings, `POST /time-off-adjustments`, and the session and public routes the sign-in code calls directly. Routes no API test names (5): the outbox pair (tested through a computed path), `POST /payments/:id/files`, `POST /roles/:id/reset` and `PUT /supplier-contacts/:id` (F-q). Pages on the API with no api-mode e2e: 16, among them `/hr/employees`, `/settings/roles` and `/account/security`.

### Money

| Equality | Holds |
| --- | --- |
| E1 every entry balances, has two lines or more, each one-sided and positive | exact, after every step |
| E2 the trial balance sums to zero | exact, after every step |
| E3 receivables = open invoice balances; E4 customer credit | exact |
| E5 sales tax payable; E6 retainage receivable and payable | exact |
| E7 payables = open bills; E8 goods received not billed | exact |
| E9 inventory = received value + bill differences − issue costs + corrections; valuation within the allowance | exact; within |
| E10 each cash account holds its own payments; E11 accrued payroll | exact |
| E12 cost of goods and inventory adjustments | exact |
| E13 (MI-2) reports against the ledger, R1 to R6 | exact; P&L expenses differ from the ledger by purchase tax and write-offs, by design (F-a) |
| E14 every journal entry matches its document; each void posts its reversal today | exact |
| E15 no stored balance or derived state outside 20 reviewed columns | holds |
| FS: stock on hand × cost = inventory; payables, receivables, sales, tax, cost of goods and the bank on a company set up through the API | exact |

### Permission matrix

The real `TenantGuard` → `PermissionGuard` chain agrees with an oracle built only from packages/shared on every company route × every default role, and refuses an HR Suite company on the Flooring host on every company route. Turning a module off refuses every route that declares it; every gating switch hides its routes (404), except the 12 routes of F-h. Data scope on Summit (PM-6): no row outside the rule and none missing, for Sales, a Manager at Denver and one at Colorado Springs, Warehouse and an Employee, on contracts, customers, employees, expenses, invoices, payments, time off, quotes and timesheets. Sensitive fields (PM-7): no role receives a field it lacks the key for, at any depth, on every list read. Every money, quantity and rate is a decimal string (MI-DEC), except the F-k quantities.

Rules the guards can't see and the matrix therefore doesn't judge (covered by their modules' tests): company-wide scope on the ledger, accounting, expenses and payroll (`requireCompanyWide`, `requireCompanyWidePayroll`), Owner-only support grants and billing, separation of duties (`selfCheck`, 19 calls), the import's per-kind checks, and the any-member routes that narrow inside (`GET /outbox`, `/billing`, `/support-grants`, `/locations`, `/notifications`, `/company`, `/settings`).

### Fresh company and the demo script

See docs/real-build-coverage.md, "By demo-script step", for the step-by-step table.

### Browser runs

To be filled after the runs.

## Gaps

| Gap | What | Pinned by |
| --- | --- | --- |
| G1 | The web opens only the demo companies in api mode | FC-1 |
| G2 | No settings at provisioning; no Localization tab can be saved on a company with none | FA-4, FA-12, FS-3 |
| G3 | No branch route, so no location; products only by import | FA-5, FS-4 |
| G4 | No Owner invitation at provisioning | FA-0, FS-2 |
| G5 | 22 mixed pages | `docs/coverage.md` |
| G6 | The HR Suite is not walked in api mode | — (Q5) |
| G7 | No API or console route makes a company | F-f |

## Findings

Every finding, with evidence, is in the session log's "Findings"; the ones to fix are in its "Fix PRs to make" (P1 to P10).

## Follow-ups ranked for P13

- **T1, security:** F-h (switches on users, roles, audit, support grants); F-l (prototype names in field stripping); F-j (outbox writes on a view key); the trial balance and contract amounts visible only with the right sight (fixed in #67, re-checked by PM-7).
- **T2, money:** opening balances; F-a (P&L expenses); F-m (part cartons); F-o (float money in the UI); "payroll paid" posting (Q3).
- **T3, real-company readiness:** G1 to G4, G7, then G6.
- **T4, robustness and operations:** F-g (no CI on main since 2026-11-14), F-c (retirement and migrations), F-b (Turbo), F-r (dates).
- **T5, minor:** F-i (a bare 404), F-p (HR host page gates), F-q (five routes without API tests), F-k (JSON-number quantities).

## Owner questions

Q1 to Q10 in the session log, "Owner questions", with the default the check took.
