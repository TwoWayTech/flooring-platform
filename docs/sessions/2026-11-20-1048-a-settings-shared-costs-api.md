# Session 2026-11-20 10:48, A (Claude): Settings part 4b, Shared costs on the API (queue item 2, task 2)

Person: A (Claude), on A's Windows laptop, working unattended. Worktree `C:\dev\fp-4b`, branch `feat/settings-shared-costs-api`, base `3c3a04b` (part 4a, PR #61, and through it the rest of the stack). The other checkouts (`C:\dev\flooring-platform`, `fp-work`, `fp-work2`, `fp-3b`, `fp-4a`, `fp-5`) belong to others and are not touched.

**Queue item 2, Settings part 4b** (ADR 0059 "Later parts" row 4, its shared-costs half; plan outline docs/specs/settings-part-4a-plan.md section 17 with the critique's notes (a) to (f); ADR 0023 for the rule). Code comments cite "ADR 0059, part 4b, D<n>".

## Prompt (orchestrator, summarised)

- `PUT /settings/sharedCosts` with the server running the shared-costs rule, on the pattern of parts 1, 2a, 2b, 3a and 4a: `API_SETTINGS_SECTIONS` and `SETTINGS_READERS` (narrowest readers), a strict Zod body, scope `all`, the page switch, key and module per the plan, `current` passed to the dispatcher, the same words in both modes, one audit row per save, DemoStore applying the same rules. Decide on a step-up by the safest option and record it.
- No schema change, migration or dependency (stop and report if one seems needed). No e2e, `next build` or Playwright run (another builder owns ports 3000 and 4000): write the specs and stop.
- Fresh read-only security-reviewer until a clean round. Commit and push after each step with `git push -q origin feat/settings-shared-costs-api`. No PR, merge or `gh` write.

## Plan (short)

1. This log. Commit.
2. Shared: the shared-costs rule (`sharedCostsProblem`, messages, input type), `fixedPctProblem` never throwing, `weightsFor` reading blank or malformed text as 0 (R5) and fixed shares in ten-thousandths; `API_SETTINGS_SECTIONS` and `SETTINGS_READERS` gain `sharedCosts`; the dispatcher gains a context with the live locations. Unit tests. Commit.
3. API: `PUT /settings/sharedCosts` (module `core`, `settings.expenses.manage`, switch `finance.expenses`, scope `all`, strict body, the rule judged in the save's transaction against `loadLocations(tx)`, audit "Changed shared costs"); `GET /settings` answers it (never saved = `DEFAULT_SHARED_COSTS`). Integration tests (SCA). Commit.
4. Web and DemoStore: `settings-answer.ts` case; the Expenses page passes `problem`, inputs stop at `PERCENT_TEXT_MAX`, a cleared input drops the share; DemoStore's `updateSettings` passes the live locations. Unit tests. Commit.
5. Mutations of the protections (Node runner, files restored from saved copies). Commit the log.
6. E2E specs written, not run (api-mode rewrite of part 1's pin and a new case; demo case). Commit.
7. Docs: ADR 0059 section, api-contract, specs, FEATURES text, blueprint-delta. Commit.
8. Lint, typecheck, `pnpm test`, the whole integration suite once (`--maxWorkers=3`); security review rounds. Commit and report.

## Decisions and why

- **D1 Readers.** `SETTINGS_READERS.sharedCosts = { readers: ["settings.expenses.manage"], hiddenWhenOff: true }`. Every reader checked: on the web only Settings → Expenses reads `settings.sharedCosts` (`expenses-settings-page.tsx`); the Business report reads it on the server in api mode (`loadSharedCosts`, `GET /reports/business`) and from DemoStore's own copy in the demo; no other screen reads it.
- **D2 Route.** `PUT /settings/sharedCosts`: the guards take `SETTINGS_SECTIONS.sharedCosts` (key `settings.expenses.manage`, module `core`); the handler checks the switch `finance.expenses` (404), scope `all` (403), the strict body (400), then, inside the save's transaction under the row lock, the shared rule against `loadLocations(tx)` (400). Answers the section as saved.
- **D3 No step-up.** Shared costs only change how the Business report splits company-wide costs across locations: nothing posts to the ledger, no payment, bill or expense changes, and every save is audited with before and after. `settings.expenses.manage` is not an MFA key, only the Owner holds it by default, and Expense approval (a real money control) under the same key has none; the owner's answer of 2026-11-20 kept part 1's Q1 default (step-up on Payments and on the tax, currency and states changes only). A step-up here would also lock out a custom role holder without an authenticator. Recorded as owner question Q1.
- **D4 The rule (`sharedCostsProblem`, same words both modes).** In order: the rule is one of revenue, floor area, equal, fixed; every share names a live location of the company; every share is `PERCENT_TEXT` and at most 100 (checked before any `dec`, note (a)); for `fixed`, the shares add up to exactly 100 (by value). Shares are checked whatever the rule, so nothing malformed is ever stored.
- **D5 A non-fixed rule keeps the shares as sent** (validated), so switching back to fixed shows the last split. Owner question Q2.
- **D6 A location added after a fixed split** has no share (0) and the report normalizes (note (d)). Locations are never removed (4a), so "keys only live locations" is a membership check.
- **D7 `weightsFor` never throws on stored text:** a blank or malformed floor area or share reads as 0 (closes R5, note (c)); fixed shares weigh in ten-thousandths, so every percent `PERCENT_TEXT` takes is exact (same split as hundredths for any share with two decimals or fewer).
- **D8 The dispatcher takes a context** (`{ locations }`), which DemoStore passes; `sharedCosts` without it throws (fails closed). The API calls the rule directly inside the transaction.
- **D9 Never saved** = `DEFAULT_SHARED_COSTS` (revenue), which is what `loadSharedCosts` acts on; the first save has a null `before`.
- **D10 No stock lock** (the rule reads locations only; a location added during the save gets no share, as D6).

## Owner questions (none blocks; each with its safest default taken)

- **Q1 Step-up for Shared costs.** Taken: none (D3). Add one?
- **Q2 A non-fixed rule keeps the fixed shares** (D5). Clear them instead?
- **Q3 Effective dates** for the sharing rule (ADR 0023 Consequences: "changing the rule cannot rewrite closed months"). Not built: a save changes every month of the report, as before. A dated rule needs a design (and `expense_allocations` when periods close).

## Build notes

- **B1 Tests changed for the fifth served section:** packages/shared R7 and R10; apps/api part 1's A1 (the Owner's answer and the never-saved shared costs), A8 (one switch hides expenses and shared costs), A9b, and X1 in `settings-dispatch.test.ts`; apps/web W1, W2 and W5. Part 1's `SERVED` list stays part 1's four; 4b has its own file.
- **B2 Zod's record** reports a refused key as the record's own issue ("Invalid key in record"), so the key's words are set on the record. Part 2a's `DOCUMENTS_INPUT` waste-category keys have the same shape and probably answer Zod's words for a key over 40 characters: follow-up F1.
- **B3 Zod's record drops a `__proto__` key silently**, so `fixedPct` refuses one first with the unknown-location words (review round 1).
- **B4 `PLAIN_DECIMAL`** (decimal-text.ts) is exported for `weightsFor`, rather than a second copy of the pattern.

## Commands run

- `packages/shared`: `npx vitest run` 82 files, 1203 tests pass; `npx tsc --noEmit`.
- `apps/api`: `npx vitest run --project integration --maxWorkers=2 test/settings-shared-costs.int.test.ts` 24/24; `test/settings.int.test.ts` and `test/reports.int.test.ts` 73/73; `npx vitest run test/settings-dispatch.test.ts` 2/2.
- `apps/web`: `npx vitest run tests/unit/demo-settings.test.ts tests/unit/settings-answer.test.ts tests/unit/settings-dispatch.test.ts` 33/33.
- Root: `pnpm lint` (6 tasks, Prettier clean), `pnpm typecheck` (6 tasks), `pnpm test` (shared 1203, api 126, web 444, db 18, providers 11; all pass).
- Whole integration suite, `--maxWorkers=3`: first run 852/853. The one failure, SCA5, was the new `__proto__` case: the run overlapped with its addition and with the SCM27 mutation of `settings-input.ts`. The file alone then passed 24/24. **Whole suite rerun on the committed tree (`06fbe4b`), `--maxWorkers=3`: 43 files, 853/853 pass.**
- **Not run (by instruction):** e2e, `next build`, Playwright.

### Mutations (Node runner in the scratchpad; each file restored from a saved copy, never `git stash`)

| Id | Mutation | Caught by |
| --- | --- | --- |
| SCM1 | no rule check | SCR1, SCA5 |
| SCM2 | unknown location skipped | SCR4, SCA5, SCA11 |
| SCM3 | no upper bound of 100 | SCR3, SCA5 |
| SCM4 | `PERCENT_TEXT` loosened to digits and points | SCR2 to SCR6, SCA5, SCA6, SCA10 to SCA12 (malformed text throws: 500) |
| SCM5 | fixed total not checked | SCR2, SCR6, SCA5 |
| SCM6 | no share count bound | SCR4 |
| SCM7 | `weightsFor` reads malformed text | SCR7 |
| SCM8 | fixed shares in hundredths | SCR7, SCR8 |
| SCM9 | `fixedPctProblem` skips the share check | SCR5 |
| SCM10 | dispatcher returns null for shared costs | SCR6, SCD2 |
| SCM11 | dispatcher without locations passes | SCR6 |
| SCM12 | readers widened to everyone | SCA2 |
| SCM13 | not hidden while the switch is off | SCA7 |
| SCM14 | no switch check | SCA7 |
| SCM15 | no scope check | SCA8 |
| SCM16 | no module guard | SCA0, SCA2, SCA9 |
| SCM17 | the rule not run in the save | SCA5, SCA11 |
| SCM18 | every sent key counted as a live location | SCA5, SCA6, SCA10 to SCA12 |
| SCM19 | `@Audited()` removed (safety-net entry doubles) | SCA0, SCA10 |
| SCM20 | never saved answered as equal | SCA1 |
| SCM21 | the stored row not answered | SCA1, SCA2, SCA6, SCA11, X1 |
| SCM22 | body not strict | SCA3 |
| SCM23 | record key words removed | SCA4 |
| SCM24 | rule's outer length removed | **survived, equivalent:** the shared rule refuses any unknown rule with the same words, and the JSON body limit bounds the size |
| SCM25 | DemoStore counts an unknown location as live | SCD2 |
| SCM26 | web merge keeps DemoStore's copy | W1 |
| SCM27 | `__proto__` refusal removed (after review round 1) | SCA5 |

## Review

- **Round 1** (fresh read-only security-reviewer, `3c3a04b..1753b7e`): PASS, no blocking finding. Two low notes, both fixed in `35d446f`: (1) Zod's record silently dropped a `__proto__` share key; it is now refused with the unknown-location words, pinned by SCA5 and SCM27. (2) The `SharedCostSettings` cast relies on the guard running before the write; the comment now names `SettingsService.save`'s order.
- **Round 2** (a fresh reviewer, `3c3a04b..35d446f`): PASS, no blocking finding; it agrees with D3 (no step-up). Three low notes: a top-level `__proto__` key was untested (now pinned in SCA3, `06fbe4b`, no product change); `loadSharedCosts` casts the stored row without checking its shape (outside 4b's files, harmless because `weightsFor` reads bad values as 0: follow-up F2); a share over 20 characters gets the general share words rather than the named ones (wording only: follow-up F3). Round 2 is the clean round.
- `/review` was not run as a slash command (unattended subagent session); the security-reviewer rounds are the self-merge rule's reviewer for money and permissions.

### Reviewer summary, ready to paste (`gh pr review <n> --comment --body-file …`)

> Security review (read-only, two rounds), feat/settings-shared-costs-api, diff 3c3a04b..HEAD: **PASS**, no blocking issues. `PUT /settings/sharedCosts` takes the company only from the session through TenantConnectionService. In order, it checks the shared `SETTINGS_SECTIONS` key (`settings.expenses.manage`) and `core` module in the guards, then the `finance.expenses` switch (404), data scope `all` (403) and a strict Zod body (400; an own `__proto__` key is refused, not dropped). Then the shared `sharedCostsProblem` runs inside the save's transaction, under the row lock, against this company's live locations, so a share can't name another company's or a retired location, every percent is `PERCENT_TEXT` from 0 to 100, and a fixed split totals exactly 100. One audit entry per save, before and after. `GET /settings` answers the section only to `settings.expenses.manage` holders with `core` and Expenses on; the Business report reads the stored row on the server, and `weightsFor` no longer throws on blank or malformed stored text. Fixed shares split exactly (ten-thousandths of a percent, whole cents by largest remainder). DemoStore runs the same rule with the same words. No step-up (D3) is agreed: nothing posts to the ledger and every save is audited. Non-blocking follow-ups: `loadSharedCosts` could check the stored rule's shape; a share over 20 characters gets the general words.

## Follow-ups

- **F1** `DOCUMENTS_INPUT`'s waste-category record keys likely answer Zod's "Invalid key in record" instead of the shared words (B2).
- **F2** `loadSharedCosts` (`report-records.ts`) could read the stored row through `isSharedCostRule` and fall back to `DEFAULT_SHARED_COSTS`.
- **F3** A share over 20 characters gets "Enter each share as a percent…" without the location's name.

## For STATUS (the orchestrator applies these; re-read STATUS first and anchor on the quoted text)

- **In progress / next:** "…; part 4b, Shared costs (`feat/settings-shared-costs-api`, stacked on #61); then 5 HR, 6 Branding".
- **Done (on merge):** "Settings part 4b (queue item 2, task 2), PR #<n> (ADR 0059, 2026-11-20 part 4b section). Shared costs save on the API: `PUT /settings/sharedCosts` (core, `settings.expenses.manage`, the `finance.expenses` switch, scope `all`, a strict body), with the shared `sharedCostsProblem` judged inside the save against the company's live locations (a known rule; shares only for live locations, each a percent from 0 to 100; fixed totals exactly 100), one audit entry per save, no step-up (D3). `GET /settings` answers it to `settings.expenses.manage`; never saved = revenue share. The Expenses page and DemoStore run the same rule with the same words; the Business report's weights never throw on stored text (closes R5) and split fixed shares exactly. No schema, migration or dependency change. 26 of 27 mutations caught (SCM24 is equivalent); security review PASS in two rounds."
- **Close:** "The Expenses page is mixed in api mode: approval on the API, Shared costs in the browser until part 4." (both halves are on the API).
- **Change:** the unmoved-pages list loses "Shared costs".
- **Close:** 4a's follow-up "Saved demo data with an empty floor area breaks the demo Business report until … 4b's reader fix lands (R5)".
- **New follow-ups:** F1 to F3 above.
- **Owner questions:** "Owner questions (Settings part 4b; none blocks)" with Q1 to Q3 above.
- **BRANCHES:** a `feat/settings-shared-costs-api` row: "A (Claude)", "Queue item 2, task 2, Settings part 4b: shared costs on the API (worktree `C:\dev\fp-4b`; stacked on #61)", the state at handoff, the PR once opened, "see the branch".

## E2E (written first; run after the coordinator freed ports 3000 and 4000)

- Api mode: `apps/web/tests/e2e-api/settings-shared-costs.spec.ts`, SCE1 (new); part 1's E3 in `tests/e2e-api/settings.spec.ts` keeps its check that saving expense approval sends no shared costs, with its comment rewritten.
- Demo: SCS1 in `apps/web/tests/e2e/expenses.spec.ts`.
- To run (one server at a time; stop it after; demo and api need separate builds):
  - Demo: `NEXT_PUBLIC_DATA_SOURCE=demo pnpm --filter web build`, then from `apps/web`: `E2E_WORKERS=2 npx playwright test tests/e2e/expenses.spec.ts --project=flooring`.
  - Api mode: `NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build` and `pnpm --filter api build`, then `node <scratchpad>/e2e-api.mjs C:/dev/fp-4b tests/e2e-api/settings-shared-costs.spec.ts tests/e2e-api/settings.spec.ts` (the orchestrator's runner, as in 4a), then the whole api-mode suite once: `node <scratchpad>/e2e-api.mjs C:/dev/fp-4b tests/e2e-api`.

### E2E run (coordinator's go-ahead; one build at a time; ports free and the throwaway database removed after)

- **Fresh database, as CI makes one:** a throwaway PostgreSQL 16 container on port 5434 (`fp4b-e2e-pg`, recreated for every run), seeded twice and migrated, with a seed password and auth secret made in memory for the run (never printed or written) and CI's public throwaway encryption key. No `.env` file read; the shared local server on 5432 was not touched. Runner: `<scratchpad>/4b-e2e-api.mjs <worktree> [playwright args]`.
- **Builds:** `pnpm --filter api build`, `NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build`; later `NEXT_PUBLIC_DATA_SOURCE=demo pnpm --filter web build`.

| Run | Result |
| --- | --- |
| Whole api-mode suite, `--workers=2` | 46 passed, 7 failed, 5 did not run. Failures across specs that share Summit's personas (login.spec's MFA reset, company standing, F2, F3, meetings, LNE1, SCE1): the api config is single-worker by design (`workers: 1`, `fullyParallel: false`). |
| SCE1 alone, 1 worker | first on the reused database: refused at sign-in (my runner gave a new seed password to a database whose users kept the old one); the runner now recreates the container every run; then **1 passed** on a fresh database |
| **Whole api-mode suite, `--workers=1`, fresh database** | **58 passed (6.3 m)**, SCE1 and part 1's E3 among them |
| Demo, `E2E_WORKERS=2 npx playwright test tests/e2e/expenses.spec.ts tests/e2e/settings.spec.ts tests/e2e/reports.spec.ts tests/e2e/warehouses.spec.ts --project=flooring` | **35 passed, 1 skipped** (a switched-off feature), SCS1 among them |

No code changed after the review rounds, so no new review round was needed.

