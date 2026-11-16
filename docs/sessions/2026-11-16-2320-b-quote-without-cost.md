# Session 2026-11-16 23:20, B (Claude): a salesperson's quote builder works without cost and shows no margin (B1)

Person: B (Claude), on B's Mac. Branch `fix/sales-quote-without-cost`, base `6154081` (the head of B3's branch `fix/web-stock-short-by`, PR #45). Main is `d0e4e20` (B2 merged in PR #44). This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

**Stacked on PR #45.** B3 can't merge yet: GitHub Actions is blocked by a billing problem on the account. F1 needs B3, so the orchestrator cut this branch from B3's head, and the PR must merge after #45. When B3 merges, the orchestrator merges `origin/main` into this branch.

## Prompt

### The owner's queue (verbatim)
> Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
> 2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
> 3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
> 4. Then stop and hand off. Don't start P13; the owner does a click-through first.

This session is item 1, the third bug: B1. B2 and B3 are in this branch's history, so F1 comes back from `fixme` here. B5, found while planning B1, is recorded with a `fixme` test and fixed later in its own PR, after B4.

### Per-task rules (owner)
- Read the blueprint prompt first: P11 in docs/real-build-plan.md ("Each module follows prompt P11"), the product spec (docs/product-spec/sales.md, and rule 9 of docs/product-spec/settings-and-permissions.md) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why". Add a docs/blueprint-delta.md row only if the plan of record changes.
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- CLAUDE.md rules apply: rule 4 (permissions only from packages/shared), rule 5 (the server strips cost and margin; hiding on screen is not enough), rule 6 (decimals), JSDoc on exports, no dead code, no duplicated logic.
- ADR numbers: 0058 is reserved by the paused check branch, so this work amends ADR 0037 with a dated section.
- STATUS and BRANCHES are left to the orchestrator's handoff; what they need is under "For STATUS" below.
- **This laptop (8 GB):**
  - Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `gh pr merge`.

### The bug as recorded (docs/STATUS.md, "Api-mode bugs the flows found", B1)
- A salesperson's quote builder crashes ("This screen stopped working", `[DecimalError] Invalid argument: undefined`) once a quote has a product line.
- The API strips `cost` and `unitCost` without product cost (rule 5), and `computeTotals` multiplies by the missing value (`use-quote-draft.ts` `lineFor`, `packages/shared/src/documents.ts`). Opening a saved quote breaks too.
- The server already ignores a sent cost (`trustedLines`). The fix stays on the client (no margin without cost), with a security review. It blocks F1.
- PR #42's final review notes: never send real cost or a placeholder margin to fix B1.

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (spec, failing tests, endpoints with guards and audit, the screen, the security review, the PR, the handoff) and the CI budget.
  - `.claude/commands/feature.md`.
  - docs/product-spec/sales.md: "Who uses it" (See margin on a quote), rule 13 (document totals), DocLine, and the known gaps ("`DemoStore.list` strips no sales fields").
  - docs/product-spec/settings-and-permissions.md rule 9 (sensitive fields).
  - ADR 0037 (sales part 1: quote cost from the catalog, stripped without product cost) and ADR 0055 (the reports' `margin` flag needs both keys; S17).
- **Where the bug was found:** docs/STATUS.md B1 and the PR #42 final review notes; the flows session log docs/sessions/2026-11-16-0200-b-e2e-api-flows.md; B3's session log docs/sessions/2026-11-16-2205-b-stock-short-by.md (its throwaway F1 with only B1 worked around passed in 17.7 s).
- **The code at `6154081`:**
  - **Shared:** `documents.ts` (`DocLine`, `computeTotals`), `operations/quotes.ts` (`invoiceFromQuote`), `operations/jobs.ts` (`invoiceFromJob`, behind `invoiceFromRoll`), `permissions/access-rules.ts` (`SENSITIVE_FIELDS`), `permissions/roles.ts`, `scripts/fixtures/sales.ts`.
  - **Web:** `features/quotes/use-quote-draft.ts` (`lineFor`), `quote-builder.tsx`, `quote-summary.tsx`, `quote-page.tsx`, `lib/api/http/api-methods.ts` (`inventoryData`, `salesData`, `saveQuote`).
  - **API (read, not changed):** `core/access/sensitive-fields.ts`, `modules/sales/sales.controller.ts` (a line's `unitCost` defaults to `"0"` and is ignored), `sales.service.ts` (`trustedLines`).
  - **Tests:** `packages/shared/test/quotes.test.ts`, `access-rules.test.ts`, `reconciliation.test.ts`, `business-report-gate.test.ts`; `apps/api/test/sales.int.test.ts`; `apps/web/tests/e2e-api/sales.spec.ts` and F1.
- **Planning:** a first plan, a critic's review (must-fix M1 to M4, should S1 to S12) and a final plan that applies them, each checked against main `d0e4e20` and B3's branch. They live in the session scratchpad, not in the repo, so the plan is restated below.

## Plan (short)

### The fix (client and shared code only; nothing changes on the server)
- **A withheld cost is unknown, never zero.** `computeTotals` takes `ViewedDocLine` (a `DocLine` whose `unitCost` may be absent or null). When any line lacks it, `cost`, `margin` and `marginPct`, and that line's `cost`, are null. Amounts, tax and total never depend on cost.
- **`storedCost`** gives a document being stored its cost and throws on null. It is used at the four places that store a cost: `invoiceFromQuote`, `invoiceFromJob`, the fixtures' `documentAmounts` and the business-report gate test.
- **`quoteLineFor`** (the web's `lineFor`, moved to `packages/shared/src/operations/quotes.ts`, exported and unit-tested) keeps the product's cost as received and never fills one in.
- **`seesQuoteMargin`** (shared, next to `SENSITIVE_FIELDS`): a quote's margin needs the margin key and the product-cost key.
- **`QuoteSummary`** shows the Margin row only with both keys and a known cost.

### Tests
- **Shared:** a new `quote-without-cost.test.ts` (absent, undefined and null costs; mixed lines; no lines; every fixture document stripped as the API strips for Sales; `storedCost`; `invoiceFromQuote`; `quoteLineFor` with a stripped product); `quoteLineFor`'s shape in `quotes.test.ts`; `seesQuoteMargin` in `access-rules.test.ts`.
- **Web:** `quote-summary-margin.test.tsx`, four cases (Sales without cost; both keys without cost; margin key only with cost; both keys with cost), rendered in the real `WorkspaceContext.Provider`.
- **API:** one `sales.int.test.ts` case pinning the contract the client relies on: a line sent without `unitCost` is costed from the catalog; the rep's POST, GET and status-change answers never carry cost while the manager's GET does; a cost sent with a save is ignored. It passes before and after, because the server is unchanged. (The plan had the rep's PUT; B6 below stops it.)
- **Api-mode e2e:** in `sales.spec.ts`, Priya's quote builder works with no cost in her answers and no margin; Luis sees margin; B5 as `fixme`. F1 back from `fixme`, with the rule-5 check on its quote request and answer, and three clean-ups.
- **Mutations M1 to M7** after the fix, each failing its named test.

### Stages (one commit each, pushed)
| Stage | What |
| --- | --- |
| 0 | This log and the spec amendments (sales.md "See margin on a quote", rule 13, DocLine `unitCost`; settings-and-permissions.md rule 9); then the draft PR |
| 1 | Red first, nothing committed: every test above, the F1 edits, the B5 `fixme` test and a throwaway probe, run against today's code |
| 2 | The fix in shared and web, with its unit and API tests; the mutations |
| 3 | Api-mode e2e green (F1 twice, a stopped-run clean-up proof, the whole suite) and the demo regression run; commit `sales.spec.ts` and F1 |
| 4 | Docs: a dated section in ADR 0037, docs/api-contract.md, one docs/blueprint-delta.md row |
| 5 | Full checks, `/review`, a fresh read-only security review, handoff |

## Decisions and why
Planned decisions, each the safest option found. Decisions taken while building go under "Decisions taken during the build".

- **D1, a withheld cost (absent or null) is unknown,** never zero and never a partial sum. Zero would show a 100 % margin; a sum of the known costs would understate cost and overstate margin.
- **D2, one calculator with nullable outputs,** not overloads or a second function. The builder's lines are typed `DocLine[]`, so an overload would hand it `string` costs and the runtime null would crash again in `<Num>`. Nullable outputs make every consumer handle the unknown case at compile time, and sales.md rule 13's "the same function serves the builder, conversion and the seed" stays true.
- **D3, `DocLine.unitCost` stays required** (the stored shape: API, seed, ledger). `ViewedDocLine` widens only the calculator's input. Typed "as received" records are a follow-up (Q4).
- **D4, `storedCost` at the four stored sites.** None can see a null today: the API's conversion reads `quote_lines.unit_cost` (NOT NULL), `trustedLines` always sets `unitCost`, a roll line takes the roll's cost read on the server, and DemoStore's lines always carry cost. Throwing beats storing `0`, which would make every margin report 100 %.
- **D5, a quote's margin needs both keys and a known cost.** In api mode the null check alone does it: the server withholds cost from anyone without product cost, so no margin can be worked out. The key rule changes behaviour only in the demo, where DemoStore sends cost to every browser, and makes the two modes agree. It mirrors ADR 0055 S17 for reports. No default role changes. A delta row records it.
- **D6, no "not available" note** in the summary: the row is hidden, as every sensitive field is (settings-and-permissions.md rule 9). No visual change for any default role, so no frontend-design pass.
- **D7, `lineFor` moves to shared as `quoteLineFor`,** exported and unit-tested, so the "no placeholder" rule is pinned by a unit test (M6), not only by F1. Its two identical `measuredFromRooms` branches collapse into one.
- **D8, DemoStore unchanged.** It never lacks cost (a known gap, sales.md), so the demo can't exercise a withheld cost; the demo e2e run is regression only (Q3).
- **D9, B5 recorded, not fixed.** A salesperson's dashboard and Sales → Team read invoice `cost` and fail the same way in api mode. They are different functions (invoice-level aggregates), and `monthlyPnl` also feeds the API's P&L, so a nullable `PnlMonth` reaches server report code and needs its own security review. The owner asked for one small PR per bug.
- **D10, O2 is not part of B1:** a different screen (the payment sheet's "Status after") and rule (own-scope verification), and F1 doesn't assert that preview.
- **D11, F1 comes back with three clean-ups:** void the invoice, void the deposit, reject the final payment if it still waits. None voids a confirmed final payment, which would post entries after a passing run. A throwaway run stopped after step 3 proves them by its log lines.
- **D12, rule 5 is checked the other way:** F1 for the quote request and answer, `sales.spec` for Priya's products and quotes, Priya with no margin and Luis with margin.
- **D13, an API test pins the contract,** with no API code change.
- **D14, ADR 0037 gets a dated section;** 0058 is reserved and this amends the sales ADR that set up quote stripping.
- **D15, tests go red first and are never committed red.**
- **D16, B3 had not merged when this branch was cut** (the plan expected it on main). GitHub Actions is blocked by a billing problem, so PR #45 can't merge. The orchestrator stacked this branch on B3's head (`6154081`): B2 and B3 are both in its history, so F1 returns from `fixme` here as the plan intended, and the PR says it must merge after #45. Taken as the safer reading of the plan's "wait" case: F1's evidence needs B3's fix, and the stack keeps B3's commits unchanged.
- **D17, B5 is recorded with a committed `fixme` test** in `apps/web/tests/e2e-api/sales.spec.ts` and a STATUS entry, and is fixed later in its own PR, after B4 (the orchestrator's safest-option decision: B4 is already queued, B5 needs its own security review, and appending keeps the owner's order).
- **D18, the View as banner is unchanged.** After B1 a margin-only role still sees margin on the dashboard, Best sellers, Revenue and Sales → Team in the demo until B5 applies the both-keys rule there, so "Costs and margins are hidden." would be wrong for that role today. It is a follow-up tied to B5.
- **D19, the cost displays gated only by the shell's `can()`** (`product-drawer.tsx`, `roll/roll-page.tsx`, `products-table.tsx`, `rolls-table.tsx`, `purchasing/order-drawer.tsx`) are listed, not fixed. They crash in `formatNumber(undefined)` only when `can()` says yes while the server stripped the cost (R1), which no default role reaches; they belong to the `GET /company` move.
- **Test-writer subagent:** feature.md step 4 hands the API and Playwright tests to it. This session runs as a subagent without one, so the builder writes them from the final plan's test section.

### Decisions taken during the build

#### Stages 0 to 2
- **The PR title** is the orchestrator's ("works without cost and shows no margin"), not the plan's.
- **B6 found: a saved quote can't be saved again in api mode.** The plan's API check had the rep `PUT` the POST answer back with a sent cost. The server refused it before any B1 code ran:
  - the API answers `depositPct` and a line's `wastePct` at the `numeric(18,8)` scale (`"50.00000000"`, `"10.00000000"`), and its own `PERCENT` check takes at most 4 decimals, so a re-save of the API's own answer gets 400 "Enter a percent such as 10." for anyone (the manager too);
  - sent as typed (`"10"`), a salesperson's unchanged waste is compared as text with the stored `"10.00000000"` (`assertWaste`), so she gets 403 "Your role does not allow changing waste.";
  - the manager's save with the percents as typed is taken (200).

  Checked with three throwaway requests in the integration test, then removed. In the web, any Save on a saved quote sends the draft the API answered, so editing a saved quote fails in api mode. F1 never re-saves (Save as draft, then status changes), and Priya's test doesn't save, so neither meets it.

  **Safest option: record it, don't fix it here.** It is a different rule (server-side input validation and the waste check), not the cost rule, and the owner asked for one small PR per bug. It goes to STATUS as B6 (Q6).
- **The API test was rebuilt around B6.** It keeps every check B1 relies on: the rep's POST answer and her GET have no `unitCost`; the stored cost is the catalog's; the manager's GET carries it. The plan's rep `PUT` became two checks:
  - the manager's `PUT` with `unitCost: "0.0001"` and the percents as typed is answered with the catalog cost, and the store keeps `"2.1000"` (a sent cost is ignored);
  - the rep's status change (`POST /quotes/:id/status`, which the builder also takes back as the draft) answers without `unitCost`.

  The stored-cost read counts live lines only, because a save soft-deletes the old ones.
- **The red api-mode build set the new web unit test aside.** `next build` type-checks `tests/` too, and the test imports `ViewedDocLine`, which didn't exist yet. It sat in the scratchpad for the red build only and came back unchanged.
- **The B5 probe on the red build:** `B5-PROBE / load-error` and `B5-PROBE /sales?view=team ok`, with no page errors.
  - The dashboard fails as planned ("This page could not load its data.").
  - Sales → Team doesn't fail today, but only because of R1. Its people come from `list("users")`, which the API doesn't serve yet (ADR 0034), so they are DemoStore's people. Their ids never match the API's rep ids, so `teamStats` meets no invoice and the table is empty: wrong data, not a crash. It will fail once users move to the API (the `GET /company` move) unless B5 lands first.
  - Stage 3 settles the `fixme` test on the green probe, as plan 4.4/3 says: keep only the pages that fail, and say why Team was dropped.
- **The fixture check skips documents without lines** (credit notes issued in the app, ADR 0025). Nothing of them is withheld, and their cost stays `"0.00"`.
- **The web test strips `unitCost` by `delete` on a `ViewedDocLine` copy,** not by destructuring into an unused name, which lint would flag.
- **The stop-after-3 throwaway** (`flows/zz-f1-stop.spec.ts`, never committed) names its records `madeInvoice` and `depositPayment`, because the flow already has a `deposit` amount. It stops with `if (process.env.F1_STOP !== "no") throw …`, so the steps after it still type-check and lint while it sits in the tree.

#### Stages 3 and 4
- **The B5 test was settled on the green probe** (plan 4.4/3: keep only the pages the probe shows failing). The green build's probe logged the same as the red one: `B5-PROBE / load-error` and `B5-PROBE /sales?view=team ok`, with no page errors. So the committed `fixme` test checks the dashboard only, and its title is "a salesperson's dashboard loads without cost (B5)". Sales → Team is left out with a comment: it loads today only because its people come from DemoStore, so a check there would pass whatever B5 does. The `BLOCKED_BY_B5` text names the dashboard's failure and says Team's `teamStats` reads the same cost. B5's builder adds Team back once users come from the API. The dashboard's positive signal ("Revenue") is unproven in api mode until B5, since the page never loads for her; B5's builder confirms the locators.
- **The clean-ups answer 201, not 200** as the plan wrote: the void routes are NestJS POSTs, whose default success is 201. The kit takes any 2xx as done, so nothing changes; the proof's lines say 201.
- **The first whole-suite run (`b1-all`) still had the throwaways in the tree.** The plan runs the suite (step 4) before deleting them (step 5), while expecting only F5 and B5 skipped. It shows the planned `F1-STOP` failure and the probe, and nothing else failed; that run's own `F1-STOP-PROOF` is a second OK. The clean whole suite is `b1-all-final`, run after the full checks on a fresh build.
- **The delta row's "Blueprint section"** says "Quote builder", as the earlier sales rows do, rather than the plan's "Sales: quotes".
- **F1 needed no timing fix.** It passed four times with nothing patched (S8): 19.2 s next to `sales.spec` on the fresh build, 16.4 s alone on the dirty database, 15.6 s in the first whole suite and 17.6 s in the final one.

## Which test pins which path
- **Crash on Add product:** `quote-without-cost.test.ts` (absent, undefined and null costs), Priya's api-mode test, F1 step 1.
- **A saved quote opens:** Priya's api-mode test (a seeded quote), F1 (the page reads `GET /quotes` again after the save, B2).
- **No margin without cost:** `quote-without-cost.test.ts` (absent and mixed lines), `quote-summary-margin` (b), Priya's test; mutations M1, M2, M7.
- **Margin needs both keys:** `access-rules.test.ts` `seesQuoteMargin`, `quote-summary-margin` (c); M3, M4.
- **Margin for holders:** `quote-summary-margin` (d), Luis's api-mode test.
- **No cost sent, no placeholder:** `quoteLineFor` with a stripped product (M6), F1 step 1's request body. The server ignores one anyway: the API test.
- **No guessed cost stored:** `storedCost` and `invoiceFromQuote` with a stripped line; M5.
- **Default roles unchanged:** `access-rules.test.ts` over every flooring role.
- **The move kept behaviour:** `quotes.test.ts` shape tests, the demo quote specs.
- **B5 recorded:** the `fixme` test and the probe's `B5-PROBE` lines.

## Owner questions
None blocks the build.

- **Q1.** A quote's margin, and the cost under it, now need `inventory.product.view_sensitive` as well as `sales.margin.view_sensitive`. No default role changes. In api mode this was already so in effect (the server withholds cost from anyone without product cost, so no margin can be worked out); the key rule changes the demo, so both modes agree. Taken as the safest option, as ADR 0055 S17 did for reports. Confirm.
- **Q2, B5:** a salesperson's dashboard and Sales → Team fail in api mode because `GET /invoices` withholds `cost`. It is appended after B4 in the queue. Move it earlier, or fold it into the whole-product check? It changes `monthlyPnl`, `salesTotals`, `teamStats`, `bestSellersIn` and the API's P&L types, and applies the both-keys margin rule to the dashboard, so it needs a security review.
- **Q3.** Should DemoStore strip cost like the API, so the demo meets the same missing-cost paths? Not done; it is the spec's known gap.
- **Q4.** Should the contract types say when a field may be withheld? `Product.cost`, `DocLine.unitCost`, `Invoice.cost`, `ContractLine.estimatedCost` and `Employee.payRate` are typed as present but are stripped. That would be a typed "as received" record, for example for P13.
- **Q5, CI time:** F1 adds about 16 to 19 s to `verify` on this Mac (19.2, 16.4, 15.6 and 17.6 s in B1's four runs; B3's throwaway 17.7 s; the flows session 28 s). The whole api-mode suite took 146 s. This joins PR #42's Q1.
- **Q6, B6:** editing a saved quote fails in api mode. The API answers percents at `numeric(18,8)` scale, which its own percent check refuses, and its waste check compares text. Fix it on the server: accept any scale up to 8 decimals and compare waste by value? Or on the client, sending percents as typed? Queue it after B4 and B5, or earlier? It touches input validation and a permission check, so it needs a security review.

## For STATUS
The orchestrator applies these at handoff (this session leaves docs/STATUS.md and docs/BRANCHES.md alone). Re-read STATUS first: B3 changed it.

- **"In progress" and "Next three tasks" item 1:** B1 done in PR #46; "F1 runs since B1; F5 needs B4". **Append B5 after B4** (don't reorder): "then B5 (a salesperson's dashboard and Sales → Team in api mode; security review), found in B1's audit; the owner may move it (Q2)".
- **"Done":** a B1 entry: PR #46 (stacked on #45), this log, the ADR 0037 section, one delta row, the api-contract notes, and the checks: the full checks green (shared 1,075, web 276, api unit 124, db 18 and providers 11 tests; `test:api` api 629, db 59 and providers 2; hooks 15), the whole api-mode suite 36 passed and 2 skipped (F5, B5) in 146 s, the demo regression 24 passed, and the mutations M1 to M7; then the review rounds.
- **"Api-mode bugs the flows found":**
  - the header lists B2, B3 and B1 as fixed with their PRs, "so F1 and F2 run; F5 waits on B4";
  - remove the B1 bullet;
  - add **B5** (the probe, on the red and the green build alike: `B5-PROBE / load-error`, `B5-PROBE /sales?view=team ok`; see "Decisions taken during the build"): "a salesperson's dashboard (her landing page) shows 'This page could not load its data.' in api mode: `GET /invoices` leaves out `cost` without product cost (rule 5), and `monthlyPnl` (the dashboard loader), `salesTotals`, `bestSellersIn` and the margin sparkline (`dashboard-page.tsx:86`) add or subtract it. Sales → Team's `teamStats` reads the same cost; it loads today only because its people still come from DemoStore (their ids match no API invoice, so the table is empty), and it will fail once users come from the API unless B5 lands first." "The fix needs **the unknown-cost rule** (as B1's `computeTotals`) **and the both-keys rule** (`seesQuoteMargin`, ADR 0055 S17) for the margin displays gated by the margin key alone (`dashboard-page.tsx:106`, `best-sellers.tsx:61`, `:153`, `:170`, `team-table.tsx:69`, `revenue-panel.tsx:75`). It touches `monthlyPnl`, which feeds the API's P&L, so it needs its own PR and a security review. Its test is committed as `fixme` in `apps/web/tests/e2e-api/sales.spec.ts` (the dashboard only; B5 adds Team back once users come from the API).";
  - add **B6**: "a saved quote can't be saved again in api mode: the API answers `depositPct` and `wastePct` at `numeric(18,8)` scale (`"50.00000000"`), its own percent check takes at most 4 decimals (400 "Enter a percent such as 10." for anyone), and `assertWaste` compares waste as text, so a salesperson's unchanged waste sent as typed reads as changed (403). Found by B1's API test (session log 2026-11-16-2320). Its own PR with a security review (Q6)."
  - O2 stays;
  - add: "Cost displays gated only by the shell's `can()` (`product-drawer.tsx`, `roll-page.tsx`, `products-table.tsx`, `rolls-table.tsx`, `purchasing/order-drawer.tsx`) crash in `formatNumber(undefined)` when `can()` says yes while the server stripped the cost (R1). Not reachable for default roles; goes with the `GET /company` move."
- **"Flows' local runs leave data":** B1's red run of F1 stopped in step 1 and left a customer with a job-site address (no quote). F1 leaves per complete run a customer, a converted quote, a Partly paid invoice with a voided deposit and a confirmed final payment, and about 1 ft cut from Denver Fieldstone (four complete runs in B1: `b1-green`, `b1-f1-again`, `b1-all`, `b1-all-final`). The two stopped throwaway runs each left a customer, a converted quote, a voided invoice and a voided deposit (`INV-1242` with `PAY-0369`, `INV-1244` with `PAY-0372`), with their holds released.
- **PR #42 final review notes:**
  - the B1 bullet: "B1 fixed on the client in PR #46 (no cost sent; none ever needed)";
  - the rule-5 bullet: F1 now checks the quote request and answers, and `sales.spec` Priya's products and quotes; Bri's portal and Cole's rolls are still unchecked;
  - the clean-ups bullet: "F5 registers none (`fixme`). F1 registers three (invoice void, deposit void, final reject if waiting), proved once by a stopped throwaway run."
- **Q1 (CI time):** F1 took 15.6 to 19.2 s locally (four runs: 19.2, 16.4, 15.6 and 17.6 s); the whole api-mode suite took 146 s (`b1-all-final`, 36 passed, 2 skipped), against 2.2 minutes for B3's 33 tests.
- **Owner questions (PR #46, B1):** Q1 to Q6 above.
- **New follow-ups:** typed "as received" records (Q4); the View as banner, after B5; the installation jobs move must handle a withheld `jobCost`, `laborCost` and `jobMargin`.
- **BRANCHES:** a `fix/sales-quote-without-cost` row: "B (Claude)", "B1: a salesperson's quote builder works without cost; margin needs product cost too (main checkout; stacked on #45)", "Draft" then "Ready", the PR, "see the branch".

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `b1/logs` folder, and api-mode runs in `flows/logs`.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `docker ps`; ports 3000 and 4000 | the compose PostgreSQL on 5432 and the api e2e one on 5433 up; both ports free |
| 0 | `gh pr create --draft …` | draft PR #46 |
| 1 | `heavy.sh pnpm --filter @workspace/shared exec vitest run` on `quote-without-cost`, `access-rules` and `quotes`, before the fix | red as expected: 25 failed, 24 passed. `DecimalError` for absent, undefined and null costs, mixed lines and both companies' fixtures; "is not a function" for `seesQuoteMargin` (10), `quoteLineFor` (6) and `storedCost` (1); the two refusals got `DecimalError` instead of the stored-cost message. The strip check, no lines and `invoiceFromQuote`'s "260.00" passed |
| 1 | `heavy.sh pnpm --filter web exec vitest run tests/unit/quote-summary-margin.test.tsx`, before the fix | red as expected: 3 failed, 1 passed. (a) and (b) `DecimalError` in the test's own `computeTotals`; (c) showed Margin; (d) passed |
| 1 | `heavy.sh pnpm --filter api exec vitest run --project integration test/sales.int.test.ts` (PostgreSQL on 5432), before the fix | the plan's version failed at the rep's `PUT`: 400 "Enter a percent such as 10." (B6). Three throwaway requests then showed the rep's save with typed percents 403 (waste), the manager's 200, and the manager's raw answer 400; they were removed. The rebuilt case: 7 passed (it pins the server, which B1 doesn't change) |
| 1 | `heavy.sh flows/api-e2e.sh b1-red --build -- sales.spec, F1, zz-b1-probe` | the web build failed at `next build`'s TypeScript step (the new web unit test imports `ViewedDocLine`); nothing ran |
| 1 | the same, with the web unit test set aside | builds in 6 s; exit 1 after 49 s: 3 passed (the manager's quotes, Luis's margin 1.9 s, the probe), 2 failed, 1 skipped (B5). F1 failed in step 1 waiting for the Fieldstone quantity after Add product (19.1 s); Priya's test failed at the same field, with "This screen stopped working." in her page snapshot. `B5-PROBE / load-error`, `B5-PROBE /sales?view=team ok`, no `pageerror` lines |
| 2 | the targeted shared and web tests after the fix | 3 files, 49 passed; 1 file, 4 passed |
| 2 | `heavy.sh b1/checks.sh s2`: shared `test`, `typecheck`, `lint`; web `typecheck`, `lint`, `test`; api `typecheck`, `lint`, `test` | all exit 0: shared 71 files and 1,075 tests (the fixed-seed regeneration among them); web 34 files and 276 tests; api unit 17 files and 124 tests |
| 2 | `heavy.sh pnpm --filter api exec vitest run --project integration test/sales.int.test.ts test/invoices.int.test.ts test/stock-issue.int.test.ts` | 3 files, 31 passed (conversion and roll invoices through `storedCost`) |
| 2 | `pnpm exec prettier --check` on the 15 changed files | clean (4 formatted with `--write` first) |
| 2 | `heavy.sh python3 b1/mutate.py M1 … M7` (each mutation, its test, `git checkout --` and `git diff --quiet`) | each failed its test and was restored: M1 (missing cost as `"0"`) 9 of 49, among them absent, undefined and null, mixed, both fixtures, `storedCost`'s refusal and `quoteLineFor`; M2 (a partial sum) the same 9; M3 (the margin key alone) web (c); M4 (`seesQuoteMargin` without the cost key) its first case; M5 (`storedCost` returns `"0.00"`) the two refusals; M6 (`quoteLineFor` fills `"0"`) the stripped-product case; M7 (`shownMargin` without the null checks) web (b) |
| 3 | `heavy.sh flows/api-e2e.sh b1-green --build -- sales.spec, F1, zz-b1-probe` | builds in 14 s; exit 0 after 34 s: 5 passed, 1 skipped (B5). F1 19.2 s; Priya 2.6 s; Luis 1.8 s; the manager's quotes 2.2 s. `B5-PROBE / load-error`, `B5-PROBE /sales?view=team ok`, no `pageerror` lines |
| 3 | `api-e2e.sh b1-f1-again -- F1` (the dirty database, no rebuild) | exit 0 after 21 s: 1 passed, F1 16.4 s |
| 3 | `api-e2e.sh b1-f1-stop -- flows/zz-f1-stop.spec.ts` | exit 1 after 13 s, as planned: "Error: F1-STOP stopped after step 3"; `F1-STOP-CLEANUP void PAY-0369 201`, `F1-STOP-CLEANUP void INV-1242 201`, `F1-STOP-PROOF invoice=INV-1242 voidedAt=2026-11-16 deposit=voided holdsNamingInvoice=0 OK` |
| 3 | `api-e2e.sh b1-all` (the whole suite, throwaways still in the tree) | exit 1 after 156 s: 37 passed, 2 skipped (F5, B5), 1 failed (the planned `F1-STOP` stop). F1 15.6 s. Its proof: `F1-STOP-CLEANUP void PAY-0372 201`, `F1-STOP-CLEANUP void INV-1244 201`, `F1-STOP-PROOF invoice=INV-1244 voidedAt=2026-11-16 deposit=voided holdsNamingInvoice=0 OK`; the probe as above |
| 3 | delete `zz-b1-probe.spec.ts` and `flows/zz-f1-stop.spec.ts`; `git status --porcelain` | neither listed |
| 3 | `heavy.sh bash b1/e2e-demo.sh` (demo build, `--project=flooring`, one worker; quote, quote-status, quote-warehouse, square-feet, waste, localization, invoice-lifecycle, customers-picker, dashboard) | exit 0: 24 passed in 37.9 s; ports free after |
| 3 | `heavy.sh pnpm exec eslint` on `sales.spec.ts` and F1; `pnpm exec prettier --check` on them | clean |
| 4 | `pnpm exec prettier --check` on the ADR, `api-contract.md`, `blueprint-delta.md` | clean |
| 5 | `heavy.sh b1/full.sh` (`pnpm lint`, `typecheck`, `test`, `test:api`, `test:hooks`) | all exit 0 in under 4 minutes (Turborepo replayed the packages whose inputs hadn't changed). `test`: db 18, providers 11, api 124, shared 1,075, web 276. `test:api`: db 59, providers 2, api 629. Hooks 15 of 15 |
| 5 | `heavy.sh flows/api-e2e.sh b1-all-final --build` (a fresh api build after the demo build; no throwaways) | builds in 12 s; exit 0 after 146 s: 36 passed, 2 skipped (F5 and the B5 `fixme`). F1 17.6 s; Priya 1.9 s; Luis 2.1 s |

## Outcome
B1 is fixed on the client and in shared code, with no server change. A salesperson's quote builder works in api mode without cost: new lines, saved quotes and the save's and status change's answers. A quote's margin needs both keys and a known cost. F1 runs again and passes with nothing patched. B5 is recorded with a committed `fixme` test (the dashboard), and B6 is recorded for STATUS. Every check is green: the full checks, the whole api-mode suite on a fresh build (`b1-all-final`) and the demo regression run. Commits on `fix/sales-quote-without-cost`, each pushed:

| Commit | Subject |
| --- | --- |
| `f9627d6` | docs(sales): plan for B1 and the withheld-cost rule in the spec |
| `61a8e55` | fix(sales): a quote builder without cost shows no margin and no longer crashes (B1) |
| `dde3a44` | docs(sessions): B1 red runs, the fix's checks and mutations, and B6 found |
| `4bf283f` | test(e2e): F1 runs again, a salesperson's quote builder works without cost, and B5 is recorded (B1) |
| `9d77939` | docs: B1, a cost the server withheld is unknown on the web |
| (this commit) | docs(sessions): B1 outcome, full checks and the final api-mode suite |

All carry `[skip ci]`. The throwaways (`zz-b1-probe.spec.ts`, `flows/zz-f1-stop.spec.ts`) were deleted and never committed.

## Left
- **The orchestrator's part:** `/review`; a fresh read-only security-reviewer (CLAUDE.md: cost, margin and a permission rule), focused on the PR body's "Security-review focus"; STATUS and BRANCHES from "For STATUS" above; the handoff commit without `[skip ci]`.
- **The merge waits for PR #45** (B3), which waits for GitHub Actions. When #45 merges, `origin/main` is merged into this branch, then the PR is marked ready and self-merges under the CLAUDE.md rule once `verify` and `e2e` are green.
- **Next in the queue:** B4 (a branch-assigned user can't save a contract; security review), then B5 (the orchestrator's placement; the owner may move it, Q2). B6 has no place yet: the owner decides (Q6).
