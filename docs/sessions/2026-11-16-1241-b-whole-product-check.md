# Session 2026-11-16 12:41, B (Claude): the whole-product check

- **Person:** B (Claude), unattended, under the orchestrating session.
- **Branch:** `feat/check-whole-product`, from `origin/main` at `67fc1de` (import part 1, PR #41, merged; reports #39 and platform admin part 2 #40 before it).
- **Worktree:** `/Users/sarah/dev/flooring-platform-check`. The main checkout belongs to another task (the cross-module flows, PR #42), so nothing here is edited, built or run there.
- **Draft PR:** opened at the end of stage 0 (see "Outcome").

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

## For STATUS
Proposed lines; the orchestrating session decides and edits STATUS.
- **Follow-up (CI, F-g):** push-triggered CI and the Merge log workflow haven't run on main since `e2ff2ae`/`bd9155d` (2026-11-14). Each squash merge's body carries the branch's `[skip ci]` subjects, and GitHub then skips the push run. Ten merges (PRs #32 to #41) have had no verify on main and no merge-log entry. Owner question Q9 (whole-product check session log).

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

The scratch scripts (`ports.sh`, `int.sh`, `api-e2e.sh`, `full.sh`, `turbo-hash.sh`, `mutate.sh`, `scope.sh`) live in the session scratchpad and aren't committed.

## Outcome
Stage 0 is done: this log is committed and pushed, and the draft PR is open. The next step is stage 1, the route catalog and the guard matrix.
