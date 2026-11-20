# Whole-product check: report

The owner's step 3 (STATUS "Next three tasks"): compare the specs, the feature register and the demo script with what runs on the real API; prove the books agree with the documents; call every endpoint as every role and as another company's user; make a fresh company from the setup script, import sample CSV data and walk the demo script in api mode. Built 2026-11-16, resumed and finished 2026-11-20 on `feat/check-whole-product` (draft PR #43), on main plus PR #68's stack. ADR 0058 records the decisions; the session log docs/sessions/2026-11-16-1241-b-whole-product-check.md holds every command, number and finding; docs/real-build-coverage.md answers "what runs on the real API", item by item.

## Verdict

| Piece | Result | Counts | Gaps pinned |
| --- | --- | --- | --- |
| Coverage list (generated) | Pass | 65 pages: 35 on the API, 22 mixed, 1 demo-only, 7 no data (incl. `/[...missing]`); 225 routes, 207 reached by a screen; 168 screen calls on the API, 38 reviewed on DemoStore | G5 |
| Real-build coverage (hand-written) | Written | 72 features: 39 done, 21 partly, 1 missing, 11 not on the API by design; 37 demo-script steps: 22, 12, 0, 3 | G1 to G7 |
| Permission matrix | Pass, no leak | 201 company routes × 12 default roles = 2,412 pairs against the shared engine, 201 wrong-host checks, every company route refused on another product's host, switches traced, data scope on 9 lists, sensitive fields on every list read | F-j (F-h fixed 2026-11-20) |
| Money integrity | Pass, every equality exact | E1 to E15 after every step of 5 seeds × 108 steps (opt-in) or 58 steps (default); R1 to R6; contracts, payroll, immutability, closed period, banks | F-a (by design), F-m |
| Bare new company (FA) | Pass | 13 tests: what a provisioned company can and can't do | G2, G3, G4 |
| Fresh company from the setup script with sample CSV data (FS) | Pass | 6 tests: the real script, every settings tab and section, two locations, four CSV files, a purchase and a sale with the ledger agreeing to the cent | G2, G3, G4 |
| Fresh company in the browser (FC) | Pass | 1 test, 5 steps: invitation, password, MFA, then G1; nothing left live on 5433 | G1 |
| Demo script on Summit (DS) | Pass | 6 tests (the Owner's walk, Tamara, Priya, Cole, Grace, Bri); no sensitive field reaches Sales or Warehouse | — |
| Page × persona matrix (PGM) | Pass | 9 personas × 57 pages: every page opens or refuses as the gate says, with no failed read; 5 reviewed differences (Settings home is stricter than the gate) | — |
| Mutations | 12 of 12 caught | M1 to M10 from the plan, M11 for FS, M12 for the reviewed sensitive-key overrides | |

## How to rerun

- Default guards (in CI): `pnpm test` (coverage list, page gates, money in the UI) and `pnpm test:api` (route matrix, money integrity, FA, FS, FH).
- Long variants: `WHOLE_CHECK=1 pnpm test:api` (all twelve roles over HTTP, five money seeds of 108 steps). One seed: `WHOLE_CHECK=1 MONEY_SEED=20261118 pnpm --filter api exec vitest run --project integration test/money-integrity.int.test.ts`.
- Browser suites (opt-in, on a throwaway database on port 5433 outside CI): build both apps (`pnpm --filter api build`, `NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build`), then `WHOLE_CHECK=1 pnpm --filter web test:e2e:api tests/e2e-api/check`. PowerShell: `$env:WHOLE_CHECK = "1"` first.
- After a PR adds a route, a client method, a page rule or a role change: `pnpm --filter api exec vitest run --project integration test/route-matrix.int.test.ts -u` and `pnpm --filter web exec vitest run tests/unit/coverage-list.test.ts tests/unit/page-gates.test.ts -u`, then review the diff.
- Why the browser suites stay out of CI: verify runs 11 to 18 minutes on ready PRs against a 25-minute limit; the three suites add several minutes of builds and browser time. Owner question Q1.

## Results

### Coverage

From `docs/coverage.md`. The mixed pages (G5) are the dashboard (17 DemoStore lists), Sales, Inventory and the roll page, the invoice page, the Outbox and the settings pages whose Reset to default still reads DemoStore. Routes no screen calls (18): bonuses and contractor payments, clock entries, the period close and accounting settings, `POST /time-off-adjustments`, and the session and public routes the sign-in code calls directly. Routes no API test names: none since 2026-11-20 (F-q fixed: the outbox pair, `POST /payments/:id/files`, `PUT /supplier-contacts/:id` and `POST /roles/:id/reset` each have an integration test). Pages on the API with no api-mode e2e: 16, among them `/hr/employees`, `/settings/roles` and `/account/security`.

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

The real `TenantGuard` → `PermissionGuard` chain agrees with an oracle built only from packages/shared on every company route × every default role, and refuses an HR Suite company on the Flooring host on every company route. Turning a module off refuses every route that declares it; every gating switch hides its routes (404); since 2026-11-20 that includes the 12 routes of F-h (two of them, `GET /users` and `GET /roles`, only with both `settings.users` and `settings.roles` off). Data scope on Summit (PM-6): no row outside the rule and none missing, for Sales, a Manager at Denver and one at Colorado Springs, Warehouse and an Employee, on contracts, customers, employees, expenses, invoices, payments, time off, quotes and timesheets. Sensitive fields (PM-7): no role receives a field it lacks the key for, at any depth, on every list read. Every money, quantity and rate is a decimal string (MI-DEC), except the F-k quantities.

Rules the guards can't see and the matrix therefore doesn't judge (covered by their modules' tests): company-wide scope on the ledger, accounting, expenses and payroll (`requireCompanyWide`, `requireCompanyWidePayroll`), Owner-only support grants and billing, separation of duties (`selfCheck`, 19 calls), the import's per-kind checks, and the any-member routes that narrow inside (`GET /outbox`, `/billing`, `/support-grants`, `/locations`, `/notifications`, `/company`, `/settings`).

### Fresh company and the demo script

See docs/real-build-coverage.md, "By demo-script step", for the step-by-step table.

### Browser runs

On a throwaway database on port 5433 (Summit seeded twice and migrated, as CI does), production builds of both apps, one worker:

| Run | Result | Time |
| --- | --- | --- |
| The api-mode suite without the flag, as CI runs it | 68 passed, 16 skipped (the opt-in check specs) | 6.3 min |
| FC, fresh company | 1 passed | with DS, 39 s |
| DS, demo script on Summit | 6 passed | 45 s |
| PGM, page × persona matrix | 9 passed | 7.4 min |

Five GAP pins failed the first time because their gap had closed upstream, which is what a pin is for, and now assert the working behaviour: the commission split with a second rep saves (F-t, people from `GET /company`); Number format and Branding read and save on the API (G17, G18); the Outbox and the bell read the API (GB, PR #65); View as is not offered in api mode, since the API answers only for the signed-in person (G15, PR #50); the Sales dashboard loads (F-s, PR #48).

### CI gate (plan 9.4)

- **CI today:** the last twelve ready-PR verify runs (2026-11-20) took 10.6 to 18.0 minutes, their "API and database tests" step 3.5 to 7.1; e2e 9.3 to 17.6. Main has had no CI run since 2026-11-14 (F-g).
- **Local measurement:** the whole apps/api integration suite took 738 s (52 files, 1,021 tests) and 654 s without the check's four files (48 files, 973 tests): 84 s more.
- **Projection:** CI's API step runs at about half this laptop's time, so about +45 s per verify, at most about 18.8 minutes against the 20-minute line. Tier B (PM-3 lite, PM-5, PM-6, PM-7, MI-DEC, MI-1's 30-step tail) stays on by default (`TIER_B_DEFAULT = true`). After the ready run: over 22 minutes, turn it off in one commit.
- The browser suites stay opt-in (Q1).

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

## Review

A fresh schema-reviewer (pass) and five rounds of a fresh security-reviewer, the last clean; every should-fix was in the check's own helpers and is fixed (session log, "Reviewer summary"). The database-URL guards of the test helpers now refuse anything postgres.js could read differently from WHATWG URL.

## Findings

Every finding, with evidence, is in the session log's "Findings"; the ones to fix are in its "Fix PRs to make" (P1 to P10).

## Follow-ups ranked for P13

- **T1, security:** F-h (switches on users, roles, audit, support grants; fixed 2026-11-20, P1); F-l (prototype names in field stripping; fixed 2026-11-20, P2); F-j (outbox writes on a view key); the trial balance and contract amounts visible only with the right sight (fixed in #67, re-checked by PM-7).
- **T2, money:** opening balances; F-a (P&L expenses); F-m (part cartons); F-o (float money in the UI); "payroll paid" posting (Q3).
- **T3, real-company readiness:** G1 to G4, G7, then G6.
- **T4, robustness and operations:** F-g (no CI on main since 2026-11-14), F-c (retirement and migrations), F-b (Turbo), F-r (dates).
- **T5, minor:** F-i (a bare 404; fixed 2026-11-20, P8), F-n's words (fixed 2026-11-20, P7; G2 stays), F-p (HR host page gates; fixed 2026-11-20, P9), F-q (five routes without API tests; fixed 2026-11-20, P10), F-k (JSON-number quantities).

## Owner questions

Q1 to Q10 in the session log, "Owner questions", with the default the check took.
