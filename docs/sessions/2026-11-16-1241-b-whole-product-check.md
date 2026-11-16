# Session 2026-11-16 12:41, B (Claude): the whole-product check

- **Person:** B (Claude), unattended, under the orchestrating session.
- **Branch:** `feat/check-whole-product`, from `origin/main` at `67fc1de` (import part 1, PR #41, merged; reports #39 and platform admin part 2 #40 before it).
- **Worktree:** `/Users/sarah/dev/flooring-platform-check`. The main checkout belongs to another task (the cross-module flows, PR #42), so nothing here is edited, built or run there.
- **Draft PR:** #43, https://github.com/TwoWayTech/flooring-platform/pull/43 (opened at the end of stage 0).

## Prompt
- **The owner's queue** (owner, 2026-11-14 and 2026-11-15; STATUS "Owner decisions"), in this order:
  1. meetings;
  2. platform admin and manual billing;
  3. reports;
  4. import;
  5. cross-module api-mode e2e flows;
  6. **the whole-product check: a coverage list, money-integrity tests, a permission matrix, a fresh company plus the demo script in api mode, and a report** (this session);
  7. the P13 security review, last.
- **The decision rule** (the owner is asleep and asked for the safest option, recorded): where the plan, the specs or the code leave a choice, take the safest option, and record it with the reason here, in ADR 0058 and in a docs/blueprint-delta.md row. If the code contradicts the plan, take the safer reading and record it here.
- **Limits:** tests, test helpers, scripts and docs only, plus three non-test files: `turbo.json` (cache inputs, pass-through env), `.prettierignore` (generated JSON), and `packages/db/src/testing.ts` (additive test-only helpers).
  - No product code, schema, dependency, or anything in `apps/api/src/core`, `.github`, `CLAUDE.md` or `.claude/`.
  - Product bugs become proposed STATUS lines (below). The only exception is a tiny, clearly correct fix outside auth, tenancy, permissions, money and payroll, in its own commit with its own test.
  - docs/STATUS.md and docs/BRANCHES.md are the orchestrating session's to edit.
- **This laptop (8 GB):** heavy commands (lint, typecheck, vitest, integration tests, builds, Playwright) go one at a time through the scratchpad lock.
  - Integration tests use the local PostgreSQL on 5432 with throwaway CI values, from a scratchpad env script that is sourced inside the heavy command and never printed.
  - Api-mode e2e uses the throwaway container `fp-e2e-worktree` on 5433. It is never re-created or reseeded. Provisioning a test company on it is allowed.
  - Ports 3000 and 4000 must be free before and after each Playwright run.

## Inputs
- **CLAUDE.md:** the non-negotiable rules, workflow and style.
- **The plan:** a first plan, a critique and the final, critic-checked plan, written in the session scratchpad against `9cb7c73`, PR #41's branch and PR #42's branch on 2026-11-16. They are not in the repo, so "The plan in short" below restates them. Nothing in the repo points at the scratchpad.
- **docs/STATUS.md:**
  - "Owner decisions" (the queue);
  - "Next three tasks", item 3;
  - "Follow-ups (don't forget)";
  - "Blockers and open questions".
- **Import (PR #41, merged):**
  - ADR 0057, especially 4.2 (routes), "For the owner" 1 to 13 and "Later parts";
  - docs/sessions/2026-11-16-0730-b-import-api.md;
  - `apps/api/src/modules/imports/imports.controller.ts`;
  - `apps/api/test/support/summit-tables.ts`;
  - `apps/web/tests/e2e-api/import.spec.ts`.
- **Flows (PR #42, draft), read only from `origin/feat/e2e-api-flows` at `10afe49`:**
  - `apps/web/tests/e2e-api/flows/{kit,checks,ledger}.ts`;
  - the `accounts.ts` diff;
  - the `playwright.api.config.ts` docblock;
  - its session log `docs/sessions/2026-11-16-0200-b-e2e-api-flows.md`.
- **CI (read only):**
  - `.github/workflows/ci.yml`;
  - `gh run list` and `gh run view` for PR #41's ready run and for main.
- **The code at `67fc1de`:**
  - route decorators and controllers in `apps/api/src`;
  - `API_METHODS` in `apps/web/src/lib/api/http/api-methods.ts`;
  - `packages/shared/src/permissions/{catalog,access-rules}.ts`;
  - `packages/shared/src/accounting/postings.ts`;
  - `apps/web/src/products/pages.ts`;
  - `turbo.json`;
  - the vitest configs.

## The plan in short
The check proves, with tests that stay in the repo, that the product as merged does what its specs and rules say across modules, and reports what it can't do yet. Five pieces:

1. **A generated coverage list** (`docs/coverage.md`, plus `page-coverage.json` and `page-gates.json`), written by web unit tests as vitest file snapshots, so it can't drift.
   - What it records: every ApiClient method on the API or demo-only, with a reason; every page classified as API, mixed or demo; every feature switch against its tests; every route against a test literal.
   - It reads code and file names only, never doc contents, because docs-only PRs skip CI.
2. **Money integrity on an API-only company** (`money-integrity.int.test.ts`).
   - A fixed prelude hits every event kind at least once, then a seeded random tail runs.
   - After each step, the equalities E1 to E15 between the documents and the ledger must hold: balanced books, receivables, customer credit, tax, stock, payables, contracts, payroll accrual.
   - Reports are checked against the ledger figure by figure (R1 to R6). The by-design differences are asserted exactly (finding F-a, P&L expenses without purchase tax).
   - Contract, payroll, immutability, closed-period and bank scenarios run on fresh companies (`new-company.int.test.ts`, MI-4 to MI-9).
3. **A permission matrix** (`route-matrix.int.test.ts`).
   - A route catalog is read through the real `core/` readers.
   - An oracle built only from `packages/shared` predicts each route × role answer. The real guard chain (`TenantGuard`, then `PermissionGuard`) is the defendant.
   - The outcomes are reviewed snapshots (`route-requirements.json`, `route-role-matrix.txt`).
   - Further checks: module and switch coverage; a Summit sweep for data scope (PM-6), sensitive fields judged by an independent `MUST_STRIP` list (PM-7), and decimal strings (MI-DEC).
4. **A fresh company:**
   - (a) a bare provisioned company on the API (FA-0 to FA-12), each gap asserted as it behaves today in a `GAP-Gn` test that pins an exact 4xx;
   - (b) test-only helpers in `packages/db/src/testing.ts` that provision, invite and retire a throwaway company, and an opt-in Playwright spec where its Owner accepts the real invitation, signs in with MFA and meets gap G1;
   - (c) an opt-in demo-script walk on Summit and a page × persona gate matrix, both reusing the flows' kit.
5. **A report** (`docs/whole-product-check.md`):
   - a verdict table and results per piece;
   - gaps G1 to G7;
   - follow-ups ranked into tiers T1 to T5 for P13;
   - one de-duplicated table of owner questions;
   - ADR 0058, a blueprint-delta row and the real-build-plan lines.

Also:
- **UI-1:** a money-in-UI scan (`parseFloat`, and `Number(`/unary `+` on money names, outside a reviewed list).
- **Turbo inputs:** `turbo.json` inputs so the drift guards rerun when what they read changes.
- **Opt-in tier:** the long runs and the e2e check specs are opt-in behind `WHOLE_CHECK=1`, because verify is near its timeout.
- **Build stages, one commit each, `[skip ci]` until the handoff:**
  - 0: plan, scripts, draft PR;
  - 1: route catalog and guard matrix;
  - 2: Summit sweep;
  - 3: money integrity;
  - 4: the bare new company;
  - 5: coverage list, page gates, money in UI, Turbo;
  - 6: fresh-company helpers and the fresh e2e company;
  - 7: demo-script walk and page-gate matrix (needs PR #42);
  - 8: whole runs, mutations M1 to M10, the CI gate, the report;
  - 9: review, handoff, ready, merge.

## What changed from the plan
Re-checked at stage 0 against `origin/main 67fc1de` and, read only, `origin/feat/e2e-api-flows 10afe49`.

| # | Plan said | Found at stage 0 | What the later stages do |
| --- | --- | --- | --- |
| 1 | Start once both PRs merge; fallback if only import merged | #41 merged (2026-11-16 10:40 UTC, `67fc1de`). #42 is open and a draft at `10afe49` (it has merged main in) | **SH-1 fallback:** stages 1–6 and 8 build now. Stage 7 (DS, PGM) waits for #42. The report marks DS and PGM "waiting for PR #42" until a stage-7 agent finds #42 merged |
| 2 | 207 route decorators after import | 207, in 32 controller files | As planned |
| 3 | `API_METHODS` has 152 keys, 157 after import | **146** on `67fc1de` (141 on `9cb7c73`). Import added 5: `importOverview`, `previewImport`, `runImport`, `undoImport`, `saveImportMapping`. Counted as the object's top-level keys | No test hard-codes the count; tests read `Object.keys(API_METHODS)`. The report quotes the measured number |
| 4 | 14 api-mode spec files, 34 API integration files on main | 15 spec files (`import.spec.ts` added), 35 integration files (`imports.int.test.ts` added) | CV-8's floors (≥ 30 integration, ≥ 14 spec files) hold |
| 5 | `imports.controller.ts` has no `@RequireModule` and goes in `NO_MODULE_ROUTES` | Confirmed: `@Controller()` with no module. Every handler has `@RequirePermission("settings.import.manage")` (module `platform`, `catalog.ts:112`) and calls `requireFeature("settings.import")` first (404 when off). The kind's own module, switch, data scope and keys are checked in `ImportsService` | `NO_MODULE_ROUTES` gets the five import routes. PM-5 expects `settings.import` as their gating switch. The report's in-handler list adds the import's per-kind checks |
| 6 | The five import paths and their step-ups | `GET /imports` (200); `POST /imports/check` (200, dry run, no audit entry); `POST /imports` (201, **step-up**); `POST /imports/:id/undo` (201, **step-up**); `PUT /imports/mappings/:kind` (200, no step-up) | FA-9 and FC-4 do the step-up before the commit and before Undo |
| 7 | Whether an api-mode `import.spec.ts` lands | It landed: the Owner imports customers after a dry run and a step-up, re-imports them as skips, and undoes the batch | DS step 14 cites `import.spec.ts` |
| 8 | Reuse `apps/api/test/support/summit-tables.ts` for PM-6 where it fits | It builds import files from Summit's fixture (`summitMasterData`, `importFile`, `summitFiles`). It has no scope or route data | PM-6 doesn't use it. FA-9 builds its customers body with `importFile("customers", rows)` instead of a copy. FC-4 (Playwright in apps/web) decides at stage 6, following `import.spec.ts` |
| 9 | If imports post journal entries, assert FA-9's effect on E2 | They post none: "none posts to the ledger, because no money moves" (ADR 0057 §2) | FA-9 asserts the trial balance is unchanged by the import and its Undo |
| 10 | ADR 0057's number and its "For the owner" items | ADR 0057 is on main, with "For the owner" 1 to 13; the PR body adds 14 (Undo and the delete keys) | All 14 go into the report's owner-question table (6.3) |
| 11 | STATUS changes, the opening-balance stance | "Next three tasks" item 3 lists import part 1 (PR #41), flows (draft PR #42), then this check. Opening balances: not built. Imported and seeded records have no journal entries (STATUS "Opening balances"; ADR 0057 parts 3 and 4) | "Documents that never posted" and the opening-balance entry stay T2 follow-ups |
| 12 | ADR 0058 free? | Main ends at 0057. The flows branch adds no ADR | ADR 0058 is this check's |
| 13 | Flows' kit names (`kit.ts`, persona pool, `waitForAnswer`, sign-in helpers) | **`flows/kit.ts`:**<br>- `flowTest`: a `test.extend` whose fixture `personas: PersonaPool` has `open(email, { mfa })` and `onCleanup(label, run)`; it sets action and navigation timeouts;<br>- `waitForAnswer(page, method, pathRegex, query?, { timeout? })`;<br>- `resetAuthAround(emails)`: `beforeAll`/`afterAll` around `resetAuthState`, with a local-host guard on `CONTROL_DATABASE_URL` outside CI;<br>- also `runId`, `companyToday`, `assertSameCompanyDay`, `COMPANY_ZONE = "America/Denver"`, `EMPLOYEE_NAME`, `PDF_PROOF`, `FIELDSTONE`, `CORK_LVP`, `addProduct`, `choose`, `openWeek`, `shown`, `formatted` and `mondayForRun` | DS and PGM use `flowTest` with `personas.open(...)` and `waitForAnswer`. `resetAuthState` runs before each sign-in (SH-18), through `resetAuthAround` or directly |
| 14 | `checks.ts`, `ledger.ts` (`ledgerDelta`) | **`flows/checks.ts`:** `readAs`, `postAs`, `trialBalance`, `expectLedgerMoved`, `outboxRows`, `notifications`, `expectOutboxSent`, `openBusinessReport`, `openPayPeriodReview`, `cellUnder`, `openPayLine`, `payAtBaseRate`, `expectPayRow`, `openMyPortal`, `invoicePills`, `savePayment` and `expectAuditRows`.<br>**`flows/ledger.ts`:** `TrialBalance`, `TrialBalanceRow`, `CASH`, `ExpectedMoves`, `netByCode`, `ledgerDelta`, `movedBy`, `resolveExpected` and `ledgerMismatches` | DS reads with `readAs` and checks ledger moves with `expectLedgerMoved`, never a copy |
| 15 | `accounts.ts` additions (installer email?) | Adds `ACCOUNTANT_EMAIL` (grace.liu), `HR_EMAIL` (tamara.reyes), `EMPLOYEE_EMAIL` (bri.alvarez), `WAREHOUSE_EMAIL` (cole.brennan) and `PURCHASING_EMAIL` (renata.kowalski), all eight in `SEEDED_EMAILS`, and `signInAndEnrol(page, email)`. **No installer email** | Stage 7 adds `INSTALLER_EMAIL` (`marcus.bell@summitfloor.example`) additively. Whether to add it to `SEEDED_EMAILS` is decided against `global-setup.ts`'s reset then |
| 16 | The `@flow` tag | Confirmed. The config docblock gains a paragraph: flows in `tests/e2e-api/flows`, tagged `@flow`; run with `--grep @flow`, or skip with `--grep-invert @flow` | Stage 6 **merges** its `check/` paragraph into the docblock and never overwrites the flows' one. If #42 is still open then, stage 7 adds it after the flows' paragraph |
| 17 | Flows' coverage of demo-script steps 2, 3, 5, 7, 8, 9, 11 and 12 (DS's "cited" list) | F1, F2 and F5 are `fixme`, blocked by product bugs B1 to B4 (flows log, "Product bugs found"). F3, F4, F6 and F7 run | DS cites F1 (steps 2, 3, 5), F2 (step 7) and F5 (step 8, billing and release) as "present but `fixme` (B1–B4): not exercised in api-mode e2e" until they run. Steps 9 (F7), 11 (F6), and 12's review figures (F3, F4) are cited as running |
| 18 | The flows' CI decision (Q1) | The flows stay in verify with no workflow change. Measured: −30 s to +1:20 per verify run with four flows, up to +3.7 min once all seven run. Q1 is open | The 9.4 gate adds the flows' measured cost when #42 merges |
| 19 | 9.4 step 1.1, "read the latest verify on main" | **No CI run on main since `e2ff2ae` (2026-11-14).** Every squash merge since PR #32 carries the branch's `[skip ci]` commit subjects in its body, so GitHub skips the push run on main (finding F-g, below). The latest ready-PR verify is PR #41's (run 43845110976 on `fee03b7`): verify 14:32, its "API and database tests" step 6:57, the api-mode Playwright step 3:07; e2e 22:29. The flows log lists verify on #37–#40: 18:18, 17:35, 19:27, 15:15 | The gate reads the latest ready-PR verify runs instead of main's, and says so |
| 20 | `turbo-hash.sh` restores the file with `git checkout --` | Safer: it restores from a byte copy, so it also works for files not yet committed (`docs/coverage.md` at stage 5) and never discards an uncommitted edit. It checks `git status --short` is the same after as before | Stage 5 runs it as planned |
| 21 | F-b ("Turbo doesn't rerun web unit tests on a packages/shared-only change") | Proved at stage 0 with `turbo-hash.sh`:<br>- `apps/web/tests/unit/api-router.test.ts` changes the `web#test` hash;<br>- `packages/shared/src/features.ts` does **not** change it;<br>- `docs/FEATURES.md` does **not** change `@workspace/shared#test`'s hash | Stage 5's `turbo.json` inputs must turn the last two into "changed" |
| 22 | Fetch and `gh pr view` from the main checkout (stage 0, step 1) | The fetch ran in this worktree, which shares the repository's object store. The main checkout belongs to the flows task | Every later stage works in this worktree only |
| 23 | Stage 1: the oracle is `expectedRefusal(route, roleKey, company)` | `expectedOutcome(route, role, company)` in `support/route-oracle.ts`, returning `"pass"` or the refusal code | Later stages (PM-7's "roles the oracle lets through") call `expectedOutcome` |
| 24 | Stage 1 files: `support/{sign-in,route-catalog,route-oracle,route-lists}.ts` | Also `support/switches.ts` (`withModuleOff`, `withFeaturesOff`), shared by PM-4, PM-5 and the later stages. `sign-in.ts` delegates to the platform tests' `enrolled` and `stepUp` instead of a third copy | The older copies of `withModuleOff`/`withFeatureOff` in `reports.int.test.ts` stay (S-10) and join the follow-up list of copies |
| 25 | `.prettierignore` gets the snapshot JSON at stage 5 | Added at stage 1 for `apps/api/test/__snapshots__/*.json`, because `route-requirements.json` is committed now and `prettier --check .` (in `pnpm lint`) would fail on it | Stage 5 adds the two web JSON files |
| 26 | `DOCUMENT_WRITES` classes: reversal, state change only, refused once posted, attachment, not a money document | A sixth class, **"adds a document"**: a new document or posting against the record, which itself is not edited (a PO's bill or receipt, an invoice from a quote or a roll, apply-credit, write-off, a contract's billing, retainage release, change order, lien waiver or renewal, a hold's issue) | 14 of the 85 entries. Forcing them into "state change only" would misdescribe them; MI-7 reads the class |
| 27 | PM-5 records "gating" or "shaping" | A third effect, **"any-of"**: `GET /employees` and `GET /time-off-policies` call `requireAnyFeature`, so they are hidden only when every one of their switches is off. PM-5 finds that by turning off what was read, then whatever the next answer reads, until the route is hidden | The snapshot's `features` column shows `any-of` for those two routes |
| 28 | `SWITCH_READ_IN_SERVICE`: switch read in a service after a nil-UUID 404 | Also a route whose switch is read first, but whose missing record answers the same bare 404 as a switched-off feature (`POST /outbox/:id/retry`), so a flip can't show it | Two entries: `GET /files/:id` (service) and `POST /outbox/:id/retry` (F-i) |
| 29 | `features` in `route-requirements.json` come from PM-5 (tier B) | When tier B is off, PM-5 doesn't run, so the snapshot test compares every column but `features` against the committed file. Proved with one run at `TIER_B_DEFAULT = false` (12 passed, 2 skipped), restored after | If stage 8's gate turns tier B off, regenerate the file with `WHOLE_CHECK=1 … -u` |
| 30 | PM-1(e): every write declares a non-`.view` key | Safer reading: a write whose keys include any `.view` key, or that has no key at all (`@AnyCompanyMember`), must be in `WRITE_WITH_VIEW_KEY` | 11 entries |
| 31 | PM-1(b)–(f) over "every company route" | (b), (d), (e) and (f) cover company routes only; (c) covers every route. The 20 session-only routes are behind `PlatformAdminGuard` or answer for themselves, not `PermissionGuard` | — |
| 32 | M2 (`@RequireModule("contracts")` removed) must fail PM-4 | Without a change it wouldn't: PM-4 loops over the declared modules, so contracts would just drop out. PM-4 now also asserts that every business module whose keys some route asks for is declared on some route | M2 fails PM-1(b), PM-4 and `route-requirements.json` |
| 33 | Every reviewed list has a reason per entry | Each list also has a stale-entry check: an entry whose route no longer needs it fails | — |
| 34 | `route-role-matrix.txt`: one line per route with the roles per product | As planned, roles that pass only; the refusal codes are compared with the oracle in PM-2, not snapshotted. JSON has no comment line, so `route-requirements.json` carries the header as its `note` field | — |
| 35 | `QUERY_FOR` used by PM-5 | Left empty at stage 1: every GET read its switch before any query parsing, so PM-5 needed none | Stage 2 fills it for PM-7 |
| 36 | "About 2,500 pairs" | 183 company routes × 12 default roles = 2,196 pairs, plus 183 wrong-host checks. The catalog has 207 routes: 183 company, 20 session-only, 4 public | — |
| 37 | Run time about 60–75 s with stage 2, 30 s more for `WHOLE_CHECK` | Stage 1 alone: about 20 s by default and 31 s with `WHOLE_CHECK=1` | Stage 8 measures again with stage 2's sweep in |
| 38 | PM-7 runs "every role the PM-2 oracle lets through" | The PM-2 oracle describes a fresh trial. Summit has a plan (no wholesale), a 137-key ceiling and its own nine roles. `route-oracle.ts` gains an optional `seeded` company (plan modules, ceiling, roles) and `accessFor(role, company)`; new `support/summit-access.ts` reads them from packages/shared's `platform.json` and `summit.json` | PM-6 and PM-7 judge Summit with the fixtures the seed writes, never the API's `AccessService`. PM-2 is unchanged (no `seeded`) |
| 39 | Personas: one per flooring role; installer `marcus.bell` | Derived from the fixture: the first active user holding each role, by fixture id. That gives Dana, Luis, Grace, Priya, Renata, Cole, Marcus, Tamara and Bri, the plan's names | No email is hard-coded in the matrix |
| 40 | PM-6: equality only "where the rule is a plain owner-and-branch rule"; other routes get the leak check only | Every one of the nine rules can be written exactly from shared `scopeAllows` or `seesPersonRecords` (`SCOPE_RULES` in `route-lists.ts`), so all nine get both checks: no row outside the rule, and none of the Owner's allowed rows missing | Also asserted: every list is narrowed for some persona, and denied in part to some branch-scope reader |
| 41 | PM-6 personas: Priya, Luis, Cole, Bri | Plus a test-only Manager at Colorado Springs (`harness.addUser`, profile branch set to Cole's). A sanity mutation (branch scope sees every document) passed PM-6 without it: every Summit document and rep is at Denver, and Cole can't read sales documents | With the extra reader the same mutation fails PM-6 on contracts, invoices, payments and quotes |
| 42 | `INTEGER_KEYS`: "any JSON number sits under INTEGER_KEYS" | 17 whole counts in `INTEGER_KEYS` (checked to be integers). Non-counts go to a typed `OTHER_NUMBER_KEYS`: coordinates outside rule 6 (`lat`, `lng`, a quote room's `x`, `y`) and finding F-k (`reorderPoint`, `widthFt`, `lengthFt`) | Calling 692.85 sq ft a "whole count" would hide a rule-6 problem; failing would turn CI red on existing behaviour |
| 43 | `MONEY_KEYS` (named, not listed) | 87 names reviewed by hand from every field PM-7 met holding a decimal-looking string. Objects or arrays under a money name (a plan's `draw`, a report section's `total` row) are containers whose own fields are checked | Left out, with reasons in the file: card and check numbers, zip codes, product attributes, `commission` (money and a flag), `capHours` and `annualUseLimitHours` ("" for no limit) |
| 44 | PM-7: the Owner shows each `MUST_STRIP` name, "or the name is reported" | Pinned as a reviewed list, `MUST_STRIP_NOT_EXERCISED` (10 names, each with why) | A name that starts or stops showing fails until reviewed; over-stripping for the Owner would show here |
| 45 | PM-7 limits | A handler's own 403 is accepted only when pinned in `READ_REFUSED_IN_HANDLER` (20 role × route pairs). A 200 that isn't JSON fails. Any other non-200 fails, so a guard refusal where the Summit oracle passes fails too | PM-7 also checks HTTP against the Summit oracle on every list read |
| 46 | `QUERY_FOR` (empty at stage 1) | Two entries: `GET /commission-totals` and `GET /reports/business` need `from` and `to`; both get Summit's last fixture year, 2025-11-05 to 2026-11-04 (365 days, inside the 366-day limit) | — |
| 47 | Run time about 60–75 s for stages 1 and 2 | The file now runs in 24 s by default (stage 2 adds PM-6 1.2 s and PM-7 3.8 s) and 37 s with `WHOLE_CHECK=1` | Stage 8's gate uses these |

## Decisions and why
1. **SH-1 fallback (stage 0).** Import has merged and flows is still a draft, so this branch builds every stage except 7. Why: it is the plan's fallback (section 0). DS and PGM reuse `flows/kit.ts`, and copying the kit would duplicate code (CLAUDE.md, style). The report marks DS and PGM "waiting for PR #42". A later commit, or a small follow-up PR if this one has merged, adds them once #42 merges.
2. **The plan stays in the scratchpad; this log restates it.** Why: the plan files hold scratchpad paths and line references that go stale, and the flows' final review flagged repo comments that pointed at the scratchpad. Nothing in the repo points there.
3. **Counts are read from the code, never hard-coded.** Why: the plan's `API_METHODS` count (152/157) was off by 11 at the start, while the route count matched. A hard-coded count would either fail for no reason or pass for the wrong one. Tests and the generated list derive every count.
4. **Imports don't touch the ledger.** FA-9 asserts the trial balance is unchanged across the import and its Undo, instead of "an effect on E2". Why: ADR 0057 §2 says no part-1 import posts, and asserting "no change" pins that.
5. **`summit-tables.ts` is reused where it fits (FA-9), not forced into PM-6.** Why: it has no scope data, and reusing `importFile` avoids a second CSV builder.
6. **The DS "cited" list follows what actually runs.** F1, F2 and F5 are `fixme` on #42, so their steps count as not exercised in api-mode e2e until B1 to B4 are fixed. Why: citing a skipped test as coverage would overstate the check (MF-7).
7. **The scratch scripts refuse anything but local, plain-postgres databases, and print only counts and failing test names.**
   - `int.sh` refuses unless every database URL is on `localhost:5432` or `127.0.0.1:5432`. `api-e2e.sh` refuses unless both are on `:5433`. A `?host=` or `#` override is refused, and so is any `DB_PROVIDER` but `postgres`.
   - Neither prints error text, which could quote a connection string.
   - `api-e2e.sh check` and `int.sh --check` prove the guards without starting a test.
   - Why: helpers in this branch provision and drop databases, so a wrong URL is the worst case.
8. **CI on main isn't running (F-g): recorded, not fixed.** The fix is a `.github`, merge-guard or repository-setting change, all outside this branch's scope and the owner's to make (S-9). Stage 8's gate uses ready-PR verify runs. This PR's own squash merge will carry `[skip ci]` too, so the orchestrating session should know before merging #42 and this PR.
9. **`mutate.sh` restores from byte copies and reports NO-TARGET instead of passing quietly.** It never commits, and it checks `git status` after each mutation. Why: a mutation whose `sed` matches nothing would "pass" and prove nothing. M7 and M10 target files that stages 5 and 6 create, so stage 8 checks those two patterns first.
10. **Stage 1: the oracle never reads the API's decision code, but it does read the catalog's declarations.** The catalog reads each route through the guards' own readers (`permissionRequirement`, `accessLevel`, `requiredProduct`), so the oracle and the guards see the same declared keys and modules. The decision itself (product, undeclared, module, keys) is rebuilt from packages/shared only. Why: S-4. The declarations are pinned by the two snapshots, so a changed key fails there (M1) even though PM-2 agrees.
11. **`sign-in.ts` reuses the platform tests' sign-in.** Why: a third copy of `enrolled` would be duplicated logic (CLAUDE.md, style); delegating keeps one implementation and gives the check a neutral name.
12. **Session cookies are cached per person in the matrix.** Why: enrolling an authenticator twice for the same person would fail, and PM-3 full and PM-4 both need the Owner.
13. **The sixth `DOCUMENT_WRITES` class and the `any-of` effect** (rows 26 and 27). Why: the safer reading is the accurate one; a list that misdescribes a write would mislead MI-7 and the report.
14. **F-h, F-i and F-j are recorded, not fixed.** F-h touches users and roles (auth and permissions) and F-j is a permission-catalog question, both outside the tiny-fix exception. F-i (a bare 404's words) is outside those areas and tiny, but the safest option for a tests-only branch is no product change for a wording problem. Proposed STATUS lines below.
15. **`TIER_B_DEFAULT` stays `true` at stage 1.** Why: the gate in stage 8 decides with measured times; the fallback for the snapshot is already proved.
16. **Stage 2 judges Summit with its own fixtures, through the same oracle** (rows 38 and 39). Why: Summit's plan, ceiling and roles differ from a fresh trial's. Reading what the seed writes from packages/shared keeps S-4: nothing in the API decides who may read what. One oracle with an optional `seeded` company avoids a second copy of the decision.
17. **PM-6 checks both directions on all nine lists, and adds a Colorado Springs Manager** (rows 40 and 41). Why: the stricter check costs nothing once each rule is written from the shared functions. The extra reader is needed because Summit's seeded data never makes a branch-scope reader be refused a document; without it the branch half of the rule was untested. It is a test user in the harness's throwaway Summit only (`harness.addUser` with Summit's Manager role, its profile's branch set directly, as `grantRoles` already does), and PM-7, which runs after it, reads only as the nine seeded personas.
18. **Rule-6 numbers are split into whole counts, coordinates and finding F-k** (row 42). Why: the plan's "any JSON number sits under `INTEGER_KEYS`" would either mislabel quantities as counts or fail CI on existing behaviour. A typed list keeps each one visible with its reason, as S-12 does for float use in the UI.
19. **PM-7 pins the not-exercised names and the in-handler refusals** (rows 44 and 45). Why: logging them alone would let them drift. Accepting any handler 403 would also hide an Owner wrongly refused.
20. **`json-walk.ts` matches names as own properties only** (`Object.hasOwn`). Why: a plain object lookup also finds `constructor`, `toString` and other `Object.prototype` members, so an answer field with such a name would be judged by a function instead of a key. The same pattern in the product's `sensitiveKeyFor` is recorded as F-l, not fixed (permissions code).
21. **Two sanity mutations were run by hand at stage 2, then reverted from byte copies** (nothing committed; `git status` clean in `apps/api/src` and `packages/shared/src` after each). `seesDocument` letting branch scope see everything: PM-6 failed once the Springs Manager was in. M4 (`unitCost` out of `SENSITIVE_FIELDS`): PM-7 failed on the superset check and on `unitCost` sent to Sales (`GET /invoices`, `GET /quotes`) and Warehouse (`GET /purchase-orders`). Why: a sweep that can't fail proves nothing. Stage 8 still runs the planned M1 to M10.

## Findings
- **F-g (new, CI): `verify` hasn't run on main since 2026-11-14, and neither has the Merge log workflow.**
  - **Evidence:** every squash merge from PR #32 (`253058a`) to PR #41 (`67fc1de`) carries 6 to 19 `[skip ci]` lines in its commit body: GitHub's squash body lists the branch's commits, and the stage commits end in `[skip ci]`. GitHub skips push-triggered workflows when the head commit's message contains `[skip ci]`.
  - `gh run list --branch main` shows the last `CI` and `Merge log` runs on `e2ff2ae` and `bd9155d` (2026-11-14). Ten merges since have none.
  - **Effects:**
    - the regression net on main (verify on every push to main, `ci.yml:55-57`) is off;
    - the Merge log workflow's `docs(merge-log): record …` commits stopped after `bd9155d`;
    - the plan's CI-budget figures assume about 9 main runs a month that aren't happening.
  - **Not a product bug.**
  - **Fix options for the owner:**
    - a repository setting so squash commits take the PR title and description, not the commit list;
    - stage commits without `[skip ci]`, which costs `fast` runs;
    - or a merge-guard change allowing `--body-file` on `gh pr merge`.

- **Stage 1 results (route matrix).**
  - **PM-2:** the real `TenantGuard` → `PermissionGuard` chain agrees with the shared-engine oracle on all 2,196 pairs (183 company routes × 9 flooring and 3 HR default roles), and refuses an HR Suite company on the Flooring Suite host on all 183 routes (`product_not_enabled`).
  - **PM-3:** over HTTP, the refusal code and words match the oracle for every role (lite: both Employees; `WHOLE_CHECK=1`: all 12 roles). No company route answers 5xx to `{}` with the nil UUID for any role, and no write answers 2xx to `{}` except `POST /notifications/read` (own notes, reviewed).
  - **PM-4:** turning core, contracts, hr or meetings off refuses every route that declares it with `module_not_enabled`; the no-module controls (`GET /users`, `/roles`, `/audit`, `/imports`) still answer. In an HR Suite company, every route of a Flooring Suite module answers `module_not_enabled` and every reports route `product_not_enabled`.
  - **PM-5:** of 183 company routes, 161 are hidden by one switch, 2 only by all of theirs together (`any-of`), 2 are traced by hand, and 18 read no switch (6 by design: the ledger ×3, accounting settings ×2, locations; 12 are F-h). No route reads a removed feature.
  - **F-e confirmed:** retail, wholesale and installation have permission keys but no routes (PM-4 asserts it by name).
  - **F-d does not occur today:** PM-1(b) proves every route with no `@RequireModule` declares only `platform` keys (always on) or is any-member, so a module switched off never meets a no-module route that needs it.
  - **In-handler rules the matrix can't see (SH-4, for the report):** `requireCompanyWide` (ledger, accounting, expenses), `requireCompanyWidePayroll` (pay periods, pay items), `assertOwner` (support grants), 14 reads of `access.isOwner` in 10 module files, 19 `selfCheck` calls (separation of duties) in 8 files, `scopeAllows` in 3 files, `requireAnyFeature` (GET /employees, GET /time-off-policies), and the import's per-kind checks. Any-member routes that narrow inside: `GET /outbox`, `GET /billing`, `GET /support-grants`, `GET /locations`, `GET /notifications`.
- **F-h (new, rule 13): Settings → Users, Security roles, Audit log and Support access answer with their switch off.**
  - **Evidence:** PM-5 traces no `featureOn` on 12 routes: `GET /users`, `PATCH /users/:id`, `POST /users/invite`, `GET /roles`, `POST /roles`, `PUT /roles/:id`, `DELETE /roles/:id`, `POST /roles/:id/reset`, `GET /audit`, `GET /support-grants`, `POST /support-grants/:id/approve` and `/revoke`. The register has `settings.users`, `settings.roles` and `settings.audit` (the support-access panel sits on Settings → Users).
  - **Effect:** switching one off hides the screen but not the API (CLAUDE.md rule 13). All three are on today, so nothing is exposed now.
  - **Not fixed:** users and roles are auth and permissions code.
- **F-i (new, API contract): a missing outbox message answers a bare 404.** `POST /outbox/:id/retry` for an id that doesn't exist answers `{ code: "not_found", message: "Not Found" }` (`NotificationService.rowFor` throws `new NotFoundException()`), not words for the person (docs/api-contract.md, ErrorBody). It is also the same answer a switched-off feature gives, so PM-5 can't tell them apart (traced by hand instead).
- **F-j (new, permissions): the outbox's writes need only a view key.** `POST /outbox/:id/retry` and `/cancel` require `settings.outbox.view`; the catalog has no `settings.outbox.manage`. Only the Owner holds it by default, but a custom role given "view the outbox" could resend or cancel email. Owner question Q10.
- **Observation (no STATUS line): `POST /pay-periods` opens a period with `hr.payroll.view`.** The controller also requires company-wide payroll access, the call is safe to repeat and posts nothing (hr.md "Who uses it"). Reviewed in `WRITE_WITH_VIEW_KEY`; mentioned under Q10.

- **Stage 2 results (Summit sweep).**
  - **PM-6, data scope:** on `GET /contracts` (5 rows for the Owner), `/customers` (80), `/employees` (19), `/expenses` (209), `/invoices` (230), `/payments` (344), `/pto-requests` (18), `/quotes` (300) and `/timesheets` (96), every row Priya (Sales, own), Luis (Manager, Denver), Cole (Warehouse, Colorado Springs), Bri (Employee, own) and the test Manager at Colorado Springs receive is inside the rule, and none of the Owner's rows the rule allows is missing. Every list is narrowed for some persona and partly denied to some branch-scope reader. No leak and no over-filtering.
  - **PM-7, sensitive fields:** 58 company GET routes with no path parameter; 300 requests over the nine seeded personas where the Summit oracle lets them through (280 answers read, 20 refused by handlers as pinned). No sensitive field reaches a role without its key, at any depth. `SENSITIVE_FIELDS` holds every `MUST_STRIP` name with the same key. HTTP agrees with the Summit oracle on every list read.
  - **Exercised:** the Owner's answers show 12 of the 22 `MUST_STRIP` names: `baseRate`, `cost`, `costPerSqFt`, `creditLimit`, `estimatedCost`, `grossMargin`, `grossMarginPct`, `margin`, `payRate`, `regularRate`, `salaryAmount`, `unitCost`.
  - **Not exercised (10, pinned in `MUST_STRIP_NOT_EXERCISED`):** `averageCost` (computed, sent as `cost` or `unitCost`), `hourlyRate` and `landedCost` (unused), `jobCost`, `jobMargin`, `jobMarginPct` and `laborCost` (installation job costing, no routes: F-e), `marginPct` (demo dashboard and job costing only), `productCost` (a key group's name, not a field), `salary` (only a `payType` value).
  - **Not covered by PM-7 (for the report):** report figures under names stripping doesn't reserve (`cogs`, `netIncome`, `net`, `amount`; ADR 0055:20) are protected by the reports' `show` flags. They are covered by R-EQ and the reports e2e, not by PM-7.
  - **Refused in handlers (pinned in `READ_REFUSED_IN_HANDLER`, for the report's in-handler list):** `GET /billing` and `GET /support-grants` for all eight non-Owner roles (Owner only); `GET /ledger/trial-balance`, `/ledger/period-close`, `/reports/business` and `/reports/pnl` for the Manager (company-wide scope only).
  - **MI-DEC:** every money, quantity, hours, percentage and rate field in the 280 answers is a decimal string or null. JSON numbers are whole counts (`INTEGER_KEYS`, 17: `branchLimit`, `clawbackDays`, `dayOfMonth`, `displaySamples`, `durationMin`, `noticeDays`, `number`, `recordCount`, `reminderMin`, `rescheduleSequence`, `respondedSequence`, `salaryHoursPerWeek`, `sequence`, `userLimit`, `version`, `waitingPeriodDays`, `weekStartDay`), coordinates (`lat`, `lng`, `x`, `y`) or finding F-k.
- **F-k (new, rule 6): some quantities go out as JSON numbers.**
  - **Evidence (MI-DEC on Summit):**
    - a product's `reorderPoint`, in sq ft, is stored `numeric(14,3)` but sent through `asNumber` (`inventory-records.ts:32`), so Summit sends `692.85`;
    - a product's and a roll's `widthFt` (`asNumber`, `Number`, `inventory-records.ts:33,63`);
    - a quote room's `widthFt` and `lengthFt` (`Number`, `sales-records.ts:206`; the quote body accepts `z.number()`, `sales.controller.ts:81`).
  - **Why it matters:** CLAUDE.md rule 6 says quantities are decimal strings in JSON. These feed sq ft and reorder decisions. Today's values survive a float, so nothing is wrong on screen yet.
  - **Not fixed:** it changes shared types (`Product.reorderPoint`, `Product.widthFt`, `Roll.widthFt`, `Room`), the web and the API together, so it isn't a tiny fix.
- **F-l (new, latent, permissions): `sensitiveKeyFor` matches `Object.prototype` names.**
  - `SENSITIVE_FIELDS[field]` on a plain object returns a function for `constructor`, `toString`, `valueOf`, `hasOwnProperty` (and `to_string` through the camelCase step).
  - **Effect:** such a field would be stripped from every answer. On a route with its own `@SensitiveFieldKeys` (the `/suppliers` routes), `own?.[field]` would be a function and `.some` would throw, so the route would answer 500.
  - **No effect today:** no answer carries such a field, and no route lets a person choose field names (product `attributes` come only from the seed; imports write `{}`).
  - **Not fixed:** it is permissions code. The fix is `Object.hasOwn` in `sensitiveKeyFor` and `visible`. For the P13 review.
- **Observations (no STATUS line):**
  - Summit's seeded sales documents (230 invoices, 300 quotes, 5 contracts) and all its reps are at the Denver branch. Branch-scope tests on Summit need a reader elsewhere, as PM-6 now has.
  - `commission` is money on `GET /commissions` and a yes/no flag on `GET /me/portal`; `draw` is money on a statement and an object on a plan. The names are reused with different meanings, which a reader of the JSON has to know.
  - A time-off policy's `capHours` and `annualUseLimitHours` are "" for "no limit" rather than null.

## Owner questions
From the plan (section 12), unchanged:
- **Q1, CI:** how should the opt-in check suites run in CI (a manual or nightly job, a longer verify timeout, or the api-mode Playwright step moved to `e2e`)? All are `.github` changes.
- **Q2, onboarding:** the order of, and whether before P13 or at launch:
  - G1, the web workspace for non-demo companies;
  - G2, settings, sequences and tax at provisioning;
  - G3, locations, products and settings on the API;
  - G4, the Owner's invitation at provisioning;
  - G7, creating a company from the console.
- **Q3, accountant:**
  - a "payroll paid" posting;
  - the account for the bill price variance;
  - whether P&L expenses should include purchase tax (F-a).
- **Q4, process:** regenerate the coverage and matrix artifacts as part of the CLAUDE.md workflow, `/feature` and `/review`?
- **Q5, HR Suite in api mode:** seed Harbor Staffing in the api-mode e2e database?
- **Q6, Turbo:** a transit node or `dependsOn` so unit tests rerun on packages/shared-only changes (F-b, proved above)?
- **Q7, process rules:** may test-only helpers in `packages/db/src/testing.ts` provision, invite and retire companies, and may ADR 0058 stand in for a `docs/specs` draft for a tests-only task? Both were done under the decision rule.
- **Q8, company deletion:** should real deletion also set `tenant_databases.deleted_at`, since `pnpm db:migrate` reads only that column (F-c)?

New at stage 0:
- **Q9, CI on main (F-g):** which fix (repository squash-message setting, no `[skip ci]` on stage commits, or `--body-file` in the merge guard)? And should main get one manual verify run now, to cover PRs #32 to #41?

- **Q10, permissions (F-j):** should the outbox get a `settings.outbox.manage` key for retry and cancel, so seeing the outbox and acting on it can be given separately? And is `hr.payroll.view` the intended key for opening a pay period (`POST /pay-periods`)?

## For STATUS
Proposed lines; the orchestrating session decides and edits STATUS.
- **Follow-up (CI, F-g):** push-triggered CI and the Merge log workflow haven't run on main since `e2ff2ae`/`bd9155d` (2026-11-14). Each squash merge's body carries the branch's `[skip ci]` subjects, and GitHub then skips the push run. Ten merges (PRs #32 to #41) have had no verify on main and no merge-log entry. Owner question Q9 (whole-product check session log).

- **Follow-up (rule 13, F-h):** `GET/PATCH /users`, `POST /users/invite`, the five `/roles` routes, `GET /audit` and the three `/support-grants` routes read no feature switch, although `settings.users`, `settings.roles` and `settings.audit` are in the register; switching one off would hide the screen but not the API. Either read the switch in those routes, or mark those features as always on in the register. Found by the route matrix's PM-5 (whole-product check session log).
- **Follow-up (API contract, F-i):** `POST /outbox/:id/retry` answers a missing message with a bare `{ code: "not_found", message: "Not Found" }` (`NotificationService.rowFor`), not words for the person, and indistinguishable from a switched-off feature. Give it `notFound("message")`-style words.
- **Owner question (permissions, F-j, Q10):** the outbox's retry and cancel need only `settings.outbox.view`; should there be a `settings.outbox.manage`?
- **Follow-up (rule 6, F-k):** quantities sent as JSON numbers: a product's `reorderPoint` (stored `numeric(14,3)`, sent through `asNumber`; Summit sends 692.85), a product's and a roll's `widthFt`, and a quote room's `widthFt` and `lengthFt` (also accepted as `z.number()`). Make them decimal strings in the shared types, the API and the web (`formatNumber`). Found by the route matrix's MI-DEC; listed in `OTHER_NUMBER_KEYS` (whole-product check session log).
- **Follow-up (permissions, latent, F-l; for P13):** `sensitiveKeyFor` and the interceptor's `visible` read `SENSITIVE_FIELDS[field]` and `own?.[field]` on plain objects, so a field named like an `Object.prototype` member (`constructor`, `toString`, …) is matched against a function: stripped for everyone, or a 500 on the `/suppliers` routes with their own keys. No answer carries such a name today. Use `Object.hasOwn` (whole-product check session log).

## Commands run
| Stage | Command | Result |
| --- | --- | --- |
| 0 | `git fetch -q origin`; `git log --oneline -8 origin/main`; `gh pr view 41` and `gh pr view 42` (read only) | main at `67fc1de`; #41 MERGED 10:40 UTC; #42 OPEN, draft, head `10afe49` |
| 0 | `grep` counts over `apps/api/src` and `api-methods.ts`; a per-controller module listing | 207 route decorators, 32 controllers; 146 `API_METHODS` keys (141 at `9cb7c73`); 13 controllers with no `@RequireModule` |
| 0 | `git show origin/feat/e2e-api-flows:<path>` for kit, checks, ledger, accounts, the config docblock and the flows log (read only) | Names in "What changed", rows 13 to 18 |
| 0 | `gh run list --workflow ci.yml`, `gh run view 43845110976 --json jobs` (read only) | PR #41 verify 14:32 (API step 6:57, api-mode step 3:07), e2e 22:29; no main run since 2026-11-14 |
| 0 | `heavy.sh check/int.sh --check` | int-env ok (local :5432), exit 0 |
| 0 | `heavy.sh check/api-e2e.sh check` | e2e env ok (:5433), container ready, ports free, exit 0 |
| 0 | `check/turbo-hash.sh` on `apps/web/tests/unit/api-router.test.ts`, `packages/shared/src/features.ts`, and `docs/FEATURES.md` (`@workspace/shared#test`) | changed; unchanged; unchanged (F-b). `git status` clean after each |
| 0 | `bash -n` on the seven scratch scripts | all parse |
| 1 | `heavy.sh check/int.sh pm-u0 apps/api test/route-matrix.int.test.ts -u` (first run, empty lists) | 7 failed, 7 passed, 18 s; the two snapshots written. The failures listed every route the reviewed lists needed; PM-2 matched the oracle on the first run |
| 1 | `heavy.sh check/int.sh pm-u1 … -u` (lists filled) | 14 passed, 20 s |
| 1 | `heavy.sh check/int.sh pm-tierb-off …` with `TIER_B_DEFAULT = false` (temporary, restored from a byte copy) | 12 passed, 2 skipped (PM-3, PM-5), 12 s: the snapshot fallback works |
| 1 | `heavy.sh pnpm --filter api lint`; `heavy.sh pnpm --filter api typecheck` | exit 0 (eslint confirmed it lints the six new files); exit 0 |
| 1 | `pnpm exec prettier --check` on the new files, then `prettier --check .` | clean |
| 1 | `heavy.sh check/int.sh pm-u apps/api test/route-matrix.int.test.ts -u` | 15 passed, 19.8 s |
| 1 | `heavy.sh check/int.sh pm-a …`, then `pm-b` | 15 passed each, 20.3 s and 19.9 s |
| 1 | `WHOLE_CHECK=1 heavy.sh check/int.sh pm-full …` | 15 passed, 31.0 s (PM-3 over all 12 roles) |
| 1 | `heavy.sh check/int.sh perm-iso apps/api test/permissions.int.test.ts test/isolation.int.test.ts` | 2 files, 40 passed, 10.3 s |
| 1 | `heavy.sh check/int.sh pm-c …` after the last edits to the lists' reason texts; `heavy.sh pnpm --filter api lint`; `prettier --check .` | 15 passed, 19 s; exit 0; clean |
| 1 | `check/scope.sh` | scope ok: nothing under `apps/web/src`, `apps/api/src`, `packages/shared/src`, `packages/db/src`, `.github`, `CLAUDE.md`, `.claude` or dependency files |
| 2 | `heavy.sh check/int.sh rs-d0 apps/api test/route-matrix.int.test.ts` with a temporary key-statistics dump to the scratchpad (removed before the commit) | 17 passed, 2 failed, 24 s: PM-6 passed first time; PM-7 listed the two routes needing a query; MI-DEC listed every JSON number. The dump listed each field's value kinds for the `MONEY_KEYS` review |
| 2 | `rs-d1` (queries and number lists filled), `rs-d2` (handler refusals, not-exercised names, `recordCount`, containers skipped) | 2 failed, 23 s (the two pinned lists); then 19 passed, 23 s |
| 2 | Sanity mutation by hand: `seesDocument` lets branch scope see everything; `heavy.sh check/int.sh rs-m-pm6 … -t PM-6`; restored from a byte copy | **Passed (12 s): PM-6 could not see it.** Led to the Colorado Springs Manager (decision 17) |
| 2 | Same mutation, `rs-m-pm6b`, after adding the Springs Manager; restored | PM-6 failed as it should (13 s): contracts 5, invoices 230, payments 344, quotes 300 rows outside the rule |
| 2 | M4 by hand (`unitCost` out of `SENSITIVE_FIELDS`), `rs-m-m4 … -t PM-7`; restored | Both PM-7 tests failed as they should (13 s): the superset check, and `unitCost` sent to Sales (`/invoices`, `/quotes`) and Warehouse (`/purchase-orders`) |
| 2 | `heavy.sh pnpm --filter api lint`, `heavy.sh pnpm --filter api typecheck`, `eslint --max-warnings 0` on the five changed files, `prettier --check` on them | exit 0, exit 0, exit 0, clean |
| 2 | `heavy.sh check/int.sh rs-a … --reporter=verbose` | 19 passed, 24 s. PM-2 2.6 s, PM-3 lite 2.1 s, PM-4 1.8 s, PM-5 4.7 s, PM-6 1.2 s, PM-7 3.8 s, MI-DEC under 1 ms |
| 2 | `heavy.sh check/int.sh rs-b …` | 19 passed, 24 s |
| 2 | `WHOLE_CHECK=1 heavy.sh check/int.sh rs-full …` | 19 passed, 37 s |
| 2 | `rs-count … -t "Summit sweep"` with two temporary count lines (restored from a byte copy) | 4 passed, 13 s: 58 reads, 280 answers checked, 20 handler refusals, 12 names shown to the Owner; the nine lists' Owner row counts |
| 2 | `check/scope.sh` | scope ok |

The scratch scripts (`ports.sh`, `int.sh`, `api-e2e.sh`, `full.sh`, `turbo-hash.sh`, `mutate.sh`, `scope.sh`) live in the session scratchpad and aren't committed.

## Outcome
- **Stage 0** is done: this log is committed and pushed, and draft PR #43 is open.
- **Stage 1** is done: the route catalog, the oracle, the reviewed lists and `route-matrix.int.test.ts` (PM-1 to PM-5), with the snapshots `apps/api/test/__snapshots__/route-requirements.json` and `route-role-matrix.txt`. 15 tests pass in about 20 s, or 31 s with `WHOLE_CHECK=1`. Findings F-h, F-i and F-j are new.
- **Stage 2** is done: `support/json-walk.ts` (`MUST_STRIP`, `MUST_STRIP_NOT_EXERCISED`, `MONEY_KEYS`, `INTEGER_KEYS`, `OTHER_NUMBER_KEYS`, `leaks`, `decimalProblems`), `support/summit-access.ts`, the `seeded` oracle in `route-oracle.ts`, `QUERY_FOR`, `READ_REFUSED_IN_HANDLER` and `SCOPE_RULES` in `route-lists.ts`, and PM-6, PM-7 and MI-DEC in `route-matrix.int.test.ts` (tier B). 19 tests pass in about 24 s, or 37 s with `WHOLE_CHECK=1`. No leak, no scope problem; findings F-k and F-l are new.
- **Next:** stage 3, money integrity.
