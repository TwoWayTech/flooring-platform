# Session 2026-11-17 01:46, B (Claude): a salesperson's dashboard loads without cost, and its margins need product cost too (B5)

Person: B (Claude), on B's Mac. Branch `fix/sales-dashboard-without-cost`, base `5a6c653` (the head of B4's branch `fix/contracts-branch-from-session`, with B4's handoff; draft PR #47). Main is `d0e4e20` (B2 merged in PR #44). This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

**Stacked on PR #47.** B4 (#47) is stacked on B1 (#46), which is stacked on B3 (#45). None can merge yet: GitHub Actions is blocked by a billing problem on the account. The orchestrator cut this branch from B4's final head so that STATUS and BRANCHES stay linear (D16). The PR must merge after #45, #46 and #47; when they merge, the orchestrator merges `origin/main` into this branch.

## Prompt

### The owner's queue (verbatim)
> Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
> 2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
> 3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
> 4. Then stop and hand off. Don't start P13; the owner does a click-through first.

This session is item 1, B5: found in B1's audit and appended to item 1 after B4 by the safest-option rule (B1 D17). After the fix, its `fixme` test in `apps/web/tests/e2e-api/sales.spec.ts` comes back on.

### Per-task rules (owner)
- Read the blueprint prompt first: P11 in docs/real-build-plan.md ("Each module follows prompt P11"), the product specs involved (docs/product-spec/sales.md, commissions.md, reports.md, and rule 9 of settings-and-permissions.md) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why". Add a docs/blueprint-delta.md row only if the plan of record changes.
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- CLAUDE.md rules apply: rule 4 (permissions only from packages/shared), rule 5 (the server strips cost and margin; hiding on screen is not enough), rule 6 (decimals), JSDoc on exports, no dead code, no duplicated logic.
- Security review required: B5 touches `monthlyPnl`, which feeds the API's profit and loss, and a margin rule.
- ADR numbers: 0058 is reserved by the paused check branch, so this work amends ADR 0037 and ADR 0055 with dated sections.
- STATUS and BRANCHES are left to the orchestrator's handoff; what they need is under "For STATUS" below.
- **This laptop (8 GB):**
  - Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `gh pr merge`.

### The bug as recorded (docs/STATUS.md, "Api-mode bugs the flows found", B5)
- A salesperson's dashboard (her landing page) shows "This page could not load its data." in api mode. `GET /invoices` leaves out `cost` without product cost (rule 5), and `monthlyPnl` (the dashboard loader), `salesTotals`, `bestSellersIn` and the margin sparkline (`dashboard-page.tsx:86`) add or subtract it.
- Sales → Team's `teamStats` reads the same cost. It loads today only because its people still come from DemoStore (their ids match no API invoice, so the table is empty), and it will fail once users come from the API.
- The fix needs the unknown-cost rule (as B1's `computeTotals`) and the both-keys rule (`seesQuoteMargin`, ADR 0055 S17) for the margin displays gated by the margin key alone (`dashboard-page.tsx:106`, `best-sellers.tsx:61`, `:153`, `:170`, `team-table.tsx:69`, `revenue-panel.tsx:75`).
- It touches `monthlyPnl`, which feeds the API's P&L, so its own PR and a security review. Its test is committed as `fixme` in `apps/web/tests/e2e-api/sales.spec.ts`.

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (spec, failing tests, endpoints with guards and audit, the screen, the security review, the PR, the handoff) and the CI budget.
  - `.claude/commands/feature.md`, steps 1 to 9.
  - docs/product-spec/sales.md: "Who uses it" (See margin on a quote), rule 13 with B1's withheld-cost paragraph, and the Reports table.
  - docs/product-spec/reports.md: the P&L formula and "Real build (ADR 0055)".
  - docs/product-spec/commissions.md: the Team CSV row (the margin column).
  - docs/product-spec/settings-and-permissions.md rule 9 (sensitive fields); finance-expenses.md; docs/FEATURES.md (`dashboard.store`, `sales.team`, `sales.quotes`); demo-spec.md ("Sales role sees no margin").
  - No product spec covers the dashboard itself. Its acceptance is demo-spec E1/E2 and FEATURES.md (D20).
  - ADR 0037 (B1's dated section, "B5, recorded, not fixed"), ADR 0055 (S4, S7, S17, S18), ADR 0048 (`hideMarginBase`), ADR 0017.
- **Where the bug was found:** docs/STATUS.md B5; B1's session log docs/sessions/2026-11-16-2320-b-quote-without-cost.md (D1 to D19, the B5 probe, Q2 to Q6, and the review note "the both-keys margin rule has a quote-specific name, which B5 will need to reuse").
- **The code at `5a6c653`:**
  - **Shared:** `analytics.ts` (`PnlMonth`, `signedSubtotal`, `signedCost`, `monthlyPnl`), `dashboard.ts` (`invoicesIn`, `salesTotals`, `sparkSeries`, `SellerRow`, `bestSellersIn`), `commissions.ts` (`TeamRow`, `TeamInputs`, `teamStats`), `money.ts`, `documents.ts` (`computeTotals`, `storedCost`), `permissions/access-rules.ts` (`SENSITIVE_FIELDS`, `seesQuoteMargin`), `reports/visibility.ts`, `reports/hub-reports.ts` (`pnlReport`), `types/sales.ts` (`Invoice`), `scripts/fixtures/generate.ts`.
  - **Web:** `features/dashboard/use-dashboard-data.ts`, `revenue-panel.tsx`, `revenue-chart.tsx`, `dashboard-page.tsx` (`FigureRow`, `TopPerformer`), `best-sellers.tsx`, `features/sales/team-table.tsx`, `features/quotes/quote-summary.tsx`, `components/shell/view-as.tsx`, `lib/sales-ledger.ts`.
  - **API (read, not changed):** `modules/sales/invoices.service.ts` (`GET /invoices`, `contractCostShown`), `modules/reports/reports.service.ts` and `report-records.ts` (the P&L reads stored invoices), the global strip interceptor.
  - **Tests:** shared `access-rules`, `quote-without-cost`, `hub-reports` (S-HUB-1), `report-visibility`, `commissions`, `reconciliation` (the fixed seed), `features`; api `invoices.int`, `reports.int` (R-STRIP, R-EQ, R-MODULES-OFF); web `quote-summary-margin.test.tsx`, `invoice-stock.test.tsx`; e2e `dashboard.spec.ts` (demo) and `e2e-api/sales.spec.ts` with `flows/kit.ts`.
- **Planning:** a first plan, a critic's review (must-fix MUST-1 to MUST-3, should S1 to S12) and a final plan that applies them, checked against B1's head `7c4003e`. B4 changes none of B5's files. They live in the session scratchpad, not in the repo, so the plan is restated below.

## Plan (short)

### The fix (shared and web only; nothing changes on the server)
- **The unknown-cost rule, once.** `sumKnown` (money.ts) sums values that may be unknown: one null makes the sum null, an empty list is a known zero. `signedSubtotal` and `signedCost` are exported from analytics.ts; `signedCost` gives null for a withheld cost. `computeTotals` (B1) uses `sumKnown` too.
- **Invoices as received.** `ViewedInvoice` (types/sales.ts): an `Invoice` whose `cost` and lines' `unitCost` may be absent or null. `Invoice` stays the stored shape.
- **Nullable outputs.** `monthlyPnl` (`PnlMonth.cogs`, `grossMargin`, `grossMarginPct`, `netIncome`), `salesTotals` (`SalesTotals.cost`, `margin`, `marginPct`), `bestSellersIn` (`SellerRow.margin`) and `teamStats` (`TeamRow.margin`) take invoices as received and give null for a set with a withheld cost, never zero or a partial sum.
- **New shared pieces:** `marginSeries` (the margin sparkline, moved out of the page), `knownPnl` and `pnlTotals` (the 12-month panel's totals, margin all or nothing), and `storedPnl` (the stored path refuses an unknown cost; `pnlReport`, the fixture generator and the demo e2e read through it, so the server's P&L is unchanged).
- **One two-key rule.** `seesQuoteMargin` becomes `seesMargin`; `reportVisibility` uses it, with the same truth table.
- **The displays.** The Gross margin card and sparkline, the 12-month panel (title, key figures, chart line, table columns), Best sellers (Margin option and column) and Sales → Team (Margin column, total, CSV) need `seesMargin(can)` and a known value.
- **The View as banner** adds "Costs are hidden." for a role with the margin key but no product cost.

### Tests
- **Shared:** a new `dashboard-without-cost.test.ts` (13 groups: `monthlyPnl` stripped for Sales and for a viewer without contract cost, the empty month, `knownPnl`, `pnlTotals`, `storedPnl` and `pnlReport`, `salesTotals`, `marginSeries`, `bestSellersIn` with a hand-made two-product case and contract lines, `teamStats`, `sumKnown`, `signedCost`, and the types). B1's `strippedFor` moves to a shared test helper, `viewed-records.ts`, with `contractCostStripped`. `access-rules.test.ts` renames its B1 cases.
- **Web:** `dashboard-margin.test.tsx` (RevenuePanel, FigureRow, BestSellers and TeamTable, four cases each plus FigureRow (e), (f) and TeamTable (e)) and `view-as-banner.test.tsx`.
- **API:** one `invoices.int.test.ts` case that pins what the web relies on: `GET /invoices` leaves out `cost` and `unitCost` for a salesperson and carries them for the Owner. A control: it passes before and after.
- **Api-mode e2e:** Priya's dashboard test back from `fixme`, taking its dates from her own `GET /invoices` answer; Luis's dashboard shows gross margin (a control). A throwaway probe, never committed.
- **Mutations M1 to M19** on the committed fix.

### Stages (one commit each, pushed)
| Stage | What |
| --- | --- |
| 0 | This log and the spec amendments (sales.md "Who uses it", rule 13 and the P&L row; commissions.md; settings-and-permissions.md rule 9; reports.md's P&L formula); then the draft PR |
| 1 | Red first, nothing committed: a behaviour-neutral prep edit (export `FigureRow` and `hiddenNote`), every test above, the `sales.spec.ts` edits typed with today's types, and the probe, run against today's code |
| 2 | The fix in shared and web, with its unit and API tests (commit 2); then the mutations, and this log's red runs and checks (commit 2b) |
| 3 | Api-mode e2e green and the demo regression run; commit `sales.spec.ts` |
| 4 | Docs: dated sections in ADR 0037 and ADR 0055, one docs/blueprint-delta.md row, docs/api-contract.md, docs/FEATURES.md |
| 5 | Full checks, the whole api-mode suite, `/review`, a fresh read-only security review, handoff |

## Decisions and why
Planned decisions, each the safest option found. Decisions taken while building go under "Decisions taken during the build".

- **D1, unknown is never zero or a partial sum, per set.** The set is what a figure adds up: a month (`monthlyPnl`) and the 12 months together (`pnlTotals`); a period (`salesTotals`, `marginSeries`); the Best sellers window with its filters, all products together, because rows rank against each other (`bestSellersIn`); a salesperson's issued invoices (`teamStats`). Zero would show a 100 % margin, and a partial sum would understate cost (B1 D1).
- **D2, one calculation per figure, with nullable outputs** (B1 D2). The web's types say `Invoice.cost: string` while the API leaves it out; an overload or a generic would hand the web the strict type and crash at run time. Nullable outputs make every consumer handle the unknown case at compile time. Inputs widen to `ViewedInvoice`, and `Invoice` stays the stored shape (B1 D3).
- **D3, stored data keeps a required cost.** `storedPnl` refuses a null for `pnlReport`, the fixture generator and the demo e2e's expected figures, as `storedCost` does for documents (B1 D4). `pnlReport`'s inputs can't hold a null (`invoices.cost NOT NULL`; DemoStore's rows), and throwing beats printing a partial cost of goods. It refuses whatever the `margin` flag says.
- **D4, a display shows margin only with both keys and every shown value known, all or nothing within the display:** the 12-month panel hides its two key figures, its chart line and its table columns together; the Team column hides when any shown row is unknown; Best sellers' Margin option and column go together; the Gross margin card needs its value and its sparkline.
- **D5, `seesQuoteMargin` becomes `seesMargin`** (B1's review note), and `reportVisibility` calls it: one two-key rule (no duplicated logic; rule 4).
- **D6, the dashboard doesn't copy the reports' company-level S4 fact.** The browser sees only its own invoices. A contract invoice the viewer can't cost arrives without cost, so D1 hides margin for every month, period or salesperson set it is in. Best sellers never counts contract lines (they carry no product). The same safety with no new input.
- **D7, ranking by margin with an unknown margin falls back to revenue** in shared, and the screen doesn't offer Margin.
- **D8, the margin card's change line is left out when the earlier period's margin is unknown.** "No earlier period to compare" would be untrue. This affects custom roles and Contracts-off companies only (Q5).
- **D9, no API change.** The server is right. An API test pins `GET /invoices`' stripping (B1 D13), and the reports suite and S-HUB-1 prove the P&L is unchanged.
- **D10, DemoStore is unchanged** (B1 D8). The parity gap is recorded (Q3).
- **D11, the View as banner gets "Costs are hidden."** for a role with margin but not product cost (B1 D18). It makes no claim about margins, because the server's commission margin bases still need only the margin key (Q2).
- **D12, `FigureRow` and `hiddenNote` are exported, not moved,** in a behaviour-neutral prep edit before the red run.
- **D13, the api-mode tests.** Priya's dashboard test is the proof; Luis's is a positive control. Sales → Team stays out of api-mode e2e until users come from the API (B1 D17); its rule is pinned by unit tests.
- **D14, docs.** A dated section in ADR 0037, a pointer in ADR 0055, one delta row, spec and api-contract notes, and two FEATURES rows. No new ADR (0058 is reserved).
- **D15, tests go red first and are never committed red** (B1 D15). The red api-mode build sets the new web unit tests aside, because `next build` type-checks `tests/`; `sales.spec.ts` uses only existing types until stage 3.
- **D16, stacked on B4.** The branch is cut from B4's final pushed head (`5a6c653`, its handoff included) with `--no-track`. The PR's base is `main`. It merges after #45, #46 and #47, in queue order once CI runs; the orchestrator then merges `origin/main` in.
- **D17, no frontend-design pass.** No default role sees a visual change.
- **D18, `pnlTotals` holds the 12-month totals in shared.** The hook holds no maths, and its rule is tested and mutated.
- **D19, `sumKnown` and the exported `signedSubtotal`/`signedCost` carry the rule once,** and B1's `computeTotals` uses them too.
- **D20, no new spec draft** (feature.md step 2). No product spec covers the dashboard; its rules are demo-spec E1/E2 and FEATURES.md. Under the owner's safest-option rule for this unattended queue, the margin rule is written into sales.md ("Who uses it", rule 13), commissions.md, settings-and-permissions.md rule 9 and reports.md, which own these figures. No `docs/specs/` draft is left waiting for approval.
- **D21, mutations run after commit 2,** because the runner restores each file from the index with `git checkout --`.
- **D22, the api-mode dashboard test takes its window from Priya's answer.** The API seed keeps the fixture dates (to 2026-11-04) while `today()` is the real date in api mode, so "This month" style windows empty out as the calendar moves. A precondition says when the loader proof can't apply.
- **D23, the job card and the tooltip's float are recorded, not fixed.** Neither is reachable by a default role or about this bug.
- **Test-writer subagent:** feature.md step 4 hands the API and Playwright tests to it. This session runs as a subagent without one, so the builder writes them from the final plan's test section, as B1 did.

### Decisions taken during the build

#### Stage 0
- **The base is B4's handoff head `5a6c653`,** not `149ab66` as the plan saw it. The stop checks passed: a clean tree, HEAD equal to `origin/fix/contracts-branch-from-session`, and exactly one open PR on it (#47, draft). The handoff commit changes only STATUS, BRANCHES and B4's log, none of B5's files.
- **The demo regression script** is a copy of B2's `e2e-demo-r2.sh` (the orchestrator's instruction), not B1's `e2e-demo.sh`: it builds demo mode and frees the ports the same way, with B5's spec list and `s3-demo-*` log names.

## Owner questions
None blocks the build.

- **Q1.** The dashboard's Gross margin card and sparkline, the 12-month panel's margin, Best sellers' Margin and Sales → Team's Margin column now need `inventory.product.view_sensitive` as well as `sales.margin.view_sensitive`, as quotes (B1) and reports (ADR 0055 S17) already do. No default role changes in a company with its modules on. In api mode, the server's stripping already made it so for anyone without product cost; the key rule brings the demo into line. Confirm.
- **Q2.** Commission statement margin bases (HR → Commissions, the employee portal) need only the margin key on the server (`hideMarginBase`, ADR 0048). A gross-margin base gives an invoice's cost away to a margin-only custom role, and the access preview still lists "Sales margin" for that role. Apply the both-keys rule there too? That would be a server change with its own security review, not in B5.
- **Q3** (extends B1 Q3). Should DemoStore strip invoice `cost` and line `unitCost` the way the API does, including `contractCostShown`? Then the demo would meet the same unknown-cost paths, and a viewer without contract cost would see the same in both modes. Not done.
- **Q4 (CI time).** Priya's and Luis's dashboard tests add a few seconds to `e2e`; the measured times go here at stage 5. This joins PR #42's Q1.
- **Q5.** When the earlier period's margin is unknown (custom roles, or a company with Contracts off), the margin card shows no change line rather than "No earlier period to compare". Keep that?

## For STATUS
The orchestrator applies these at handoff (this session leaves docs/STATUS.md and docs/BRANCHES.md alone). Re-read STATUS first: B4 changed it. `#<n>` is this branch's draft PR.

- **"In progress" and "Next three tasks" item 1:** "B5 done in PR #<n> (stacked on B4's PR #47)", then B6. The owner may still move B6 (B1 Q6).
- **"Done": a B5 entry.**
  - **Where it is:** PR #<n> (stacked on #45, #46 and #47); this log; the ADR 0037 section dated 2026-11-17 and the ADR 0055 pointer; one delta row; the api-contract, spec and FEATURES notes.
  - **What changed:** `ViewedInvoice`; `sumKnown` and the exported `signedSubtotal`/`signedCost`; nullable `PnlMonth`, `SalesTotals`, `SellerRow.margin` and `TeamRow.margin`; `marginSeries`, `knownPnl`, `pnlTotals` and `storedPnl`; `seesMargin` (renamed), used by `reportVisibility`, `QuoteSummary`, `FigureRow`, `RevenuePanel`, `BestSellers` and `TeamTable`; the banner's "Costs are hidden."; no API, schema or DemoStore change.
  - **The checks:** their counts, the api-mode suite's total and time, the demo regression, M1 to M19, then the review rounds (filled in at stage 5).
- **"Api-mode bugs the flows found":**
  - the header lists B5 as fixed, with its PR;
  - remove the B5 bullet;
  - B6 stays, and so does the D19 cost-display bullet;
  - add: "Commission margin bases (HR → Commissions, the portal) need only `sales.margin.view_sensitive` on the server (`hideMarginBase`, ADR 0048); a gross-margin base gives an invoice's cost away to a margin-only custom role, and the access preview (`access-preview.tsx`) still lists 'Sales margin' for that role. No default role reaches it. Owner question (PR #<n> Q2)."
- **New follow-ups:**
  - The Sales → Team api-mode e2e comes back with `GET /company`, once users come from the API.
  - DemoStore strips invoice cost the way the API does, contract invoices included (Q3; B1 Q3).
  - Typed "as received" records (B1 Q4), now with two viewed types: `ViewedDocLine` and `ViewedInvoice`.
  - **The job card:** "Materials at cost" and "Job margin" (`features/installation/job-card.tsx`) need only `installation.job.view_sensitive`. "Materials at cost" is product cost, so a custom role with the job-margin key but no product cost reads it. No default role is affected, and Installation is still DemoStore. Once it moves to the API, the server strips material `cost` and `jobCosting` meets `dec(undefined)` for that role; apply `seesMargin`-style both keys and the unknown-cost rule then.
  - **The revenue chart's tooltip:** it passes the chart's float to `<Num>` (`revenue-chart.tsx`, pre-existing; rule 6). Carry the decimal strings under their own keys.
  - **Api-mode e2e and the calendar:** the API seed keeps the fixture dates (to 2026-11-04) while `today()` is the real date. Any api-mode test of a "this month" style window must take its dates from the answer, as B5's does. B5's 12-month precondition fails with its message once her seed invoices are over 330 days old (about 2027-10).
  - Remove "the View as banner, after B5" (done by D11).
- **PR #42 final review notes, the rule-5 bullet:** `sales.spec` now also checks Priya's `GET /invoices` answer.
- **"Flows' local runs leave data":** B5's api-mode tests only read.
- **Q1 (CI time):** add the two dashboard tests' times and the suite total.
- **Owner questions (PR #<n>, B5):** Q1 to Q5 above.
- **BRANCHES:** a `fix/sales-dashboard-without-cost` row: "B (Claude)", "B5: a salesperson's dashboard loads without cost; dashboard and Team margins need product cost too (main checkout; stacked on B4)", "Draft" then "Ready", the PR, "see the branch".

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `b5/logs` folder, and api-mode runs in `flows/logs`.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `git status --porcelain`; `git fetch origin`; HEAD against `origin/fix/contracts-branch-from-session`; `gh pr list --head fix/contracts-branch-from-session --state open` | clean; `head-ok` (`5a6c653`); one open PR, #47 (draft) |
| 0 | `git switch --no-track -c fix/sales-dashboard-without-cost origin/fix/contracts-branch-from-session` | branch made at `5a6c653` |
| 0 | `docker ps`; ports 3000 and 4000 | the compose PostgreSQL on 5432 and the api e2e one on 5433 up; both ports free |
