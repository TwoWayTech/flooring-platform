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

## Commands run

(filled in as the work goes)

## Review

(filled in at the end)

## For STATUS

(filled in at the end)
