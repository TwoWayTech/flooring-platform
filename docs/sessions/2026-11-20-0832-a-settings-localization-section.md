# Session 2026-11-20 08:32, A (Claude): Settings part 3b, Localization and tax saves one tab at a time (queue item 2, task 2)

Person: A (Claude), on A's Windows laptop, working unattended. Worktree `C:\dev\fp-3b`, branch `feat/settings-localization-section`, base `d42737c` (`fix/sales-accepted-quote-total`, the top of the PR stack: part 3a's handoff `76ea8f3`, the owner's answers `62e7491`, then the users, payments and quote fixes). The other checkouts (`C:\dev\flooring-platform`, `C:\dev\fp-work`, `C:\dev\fp-work2`) are in use by others and are not touched.

**Queue item 2, Settings part 3b** (ADR 0059 "Later parts" row 3; part 3a's D16 and D29). The plan of record is `docs/specs/settings-part-3b-plan.md` (the FINAL plan, written by B's session on 2026-11-17). Its line numbers are stale; every edit is anchored on text and re-checked on this branch.

## Prompt (orchestrator, summarised)

- Build exactly what the 3b plan describes: retire the whole-section save `updateSettings("localization")` / `resetSettings("localization")` in both modes with "Localization and tax saves one tab at a time.", remove `localizationProblem`, update the tests and docs it lists.
- No plan mode; this log holds the short plan. For anything open, take the safest option and record it here; owner questions go here and in `docs/blueprint-delta.md`.
- CLAUDE.md applies in full. No new dependency, no schema change, never an `.env*` file.
- Commit after each working step, push with `git push -q origin feat/settings-localization-section`. No PR, no merge, no `gh` write (the orchestrator does those). STATUS and BRANCHES are the orchestrator's.
- The plan's laptop-only helpers (`heavy.sh`, `api-e2e.sh`, `full.sh`, `checks.sh`, `e2e-demo.sh`, `mutate.py`) don't exist here: the commands run directly. Api-mode e2e runs through the orchestrator's `e2e-api.mjs`, one at a time on ports 3000 and 4000.

## Plan (short)

Goal: no key, role or value saves Localization and tax whole, in either mode. `settingsSectionProblem` refuses `localization` by the section's name with `LOCALIZATION_SECTION_MESSAGE`; DemoStore already runs module, keys, switch and scope first, and `resetSettings` already goes through `updateSettings`, so both refuse after those checks with no logic change in `store.ts`. Api mode already routes the whole section to DemoStore (`isApiSettingsSection` is false; `resetSettings` is unrouted). `localizationProblem` goes.

Steps:
1. Stage 0: re-check the plan on this branch (below), session log, spec edits (settings-and-permissions.md, sales.md). Commit.
2. Stage 1: the tests of plan section 7, red on the base. Commit.
3. Stage 2: the 6 product files (2 logic, 4 comment-only), green; mutations WM1 to WM6. Commit.
4. Stage 3: api-mode e2e (settings, settings-localization, settings-region-currency) and the demo subset. Commit the log.
5. Stage 4: docs (ADR 0059 section, api-contract, blueprint-delta row). Commit.
6. Stage 5: lint, typecheck, `pnpm test`, the whole API integration suite, the db suite, the whole api-mode e2e suite, a fresh read-only security-reviewer pass. Commit the outcome.

## Stage 0: the plan re-checked on this branch (`d42737c`)

Greps run in the worktree (`git grep` on HEAD), as plan stage 0 steps 2a to 2f.

- **Single-line pass** (`localizationProblem|settingsSectionProblem\("localization"|updateSettings\("localization"|resetSettings\(`): as planned (`section-rules.ts:11,156`, `localization-rules.ts:387,391`, `sections.ts:40`, `store.ts:916`, `contract.ts:903`, LR6, RG7, LD13, RD10, D5, W6), **plus one more caller: `demo-tax.test.ts:296`, TD11** ("saved demo data typed before 3a: rows dated later are not shown and drop out on the first save"), added by 3a's review round 2 (`c0f1581`). It seeds later-dated tax rows through `updateSettings("localization", { ...whole, tax: legacy })`. TD9 is at `:242-252`.
- **Multi-line pass:** only R8 (two blocks) and the declaration in `section-rules.ts`, as planned.
- **Variable-section pass:** only `store.ts:917`, `api-methods.ts:200` and `settings-answer.test.ts:124`, as planned.
- **No screen, flow, e2e, demo-script or presenter step** reaches the whole section (the plan's 1.3 holds).
- **`store.ts` moved:** `updateSettings` now also refuses a payment-control loosening by a non-Owner (`paymentControlsLoosened`, ADR 0059 "2026-11-20"), after `settingsSectionProblem`. Its JSDoc mentions it, so 4.2's JSDoc keeps that clause. `resetSettings` is still `return this.updateSettings(section, this.open().defaultSettings[section]);` with no JSDoc. `assertSettingsSave` is unchanged (module, keys, switch, scope).
- **DemoStore answers the tax tab in force** (`answered`, `taxInForce`, 3a review round 2). Not affected.
- `API_LOCALIZATION_TABS` holds all five tabs, so 4.2's new `updateLocalization` wording applies. `api-methods.ts`' `updateLocalization` comment is already right (3a); only the comment above `getSettings` changes.
- `contract.ts`'s `updateLocalization` JSDoc still says "the rest stay on DemoStore until their part" (stale); fixed here as planned.

## Decisions and why

The plan's D16 and D33 to D46 are taken as written (plan section 5). Build decisions:

- **A1. TD11 gets the same fixture set-up as TD9** (plan 7.2's fallback: "If 3a's handoff ... set its data some other way that still calls `updateSettings("localization"`, apply the same set-up there and record it"). The later-dated rows come from Summit's fixtures, patched in the test through `vi.mock("@/lib/api/demo/fixtures")`.
- **A2. The fixture patch is a function, not a partial tax block.** DemoStore moves every fixture date by the anchor-to-today shift (`shiftDates`), so TD11's rows dated later must be built from the raw fixture (a date after its `anchorDate`), not from the shifted tax a store answers. `SUMMIT_TAX.value` is `(tax, anchorDate) => tax`; TD9 uses `(tax) => ({ ...tax, pricesInclude: "inclusive" })`, the plan's patch in function form.
- **A3. TD11's first assertion moves.** It used to prove the seeding by reading the saved copy right after the whole-section save. Now nothing is saved until the first save, so it reads the saved copy after the Payroll rules save (which stores the section with every tax row) and proves the later rows are there; the Sales tax save then drops them, as before.
- **A4. A blueprint-delta row is added** although plan D43 said none: 2a, 2b and 3a each have one, the orchestrator's done-list names one, and the owner questions are recorded there.
- **A5. WM3's anchor** is `const access = await this.assertSettingsSave(db, rule);` (the save now keeps the access for the payments check), not the plan's bare `await`; the mutation is the same.
- **A6. The mutation runner is Node** (`mutate.mjs`): this laptop has no Python. Same behaviour as the plan's `mutate.py`: one mutation at a time, a saved copy restored after each, `--check` for the anchors.

## Owner questions (none blocks; each with its safest default taken)

- **Q1. Per-tab routing for a whole-section save.** Taken: refused (D16). A future "Reset all of Localization and tax" button would call each tab's save and report each tab's outcome. Route the whole section per tab instead?
- **Q2. An explicit API route for the whole section.** Taken: none (404, deny by default; the web never sends it). Add `PUT /settings/localization` answering 400 with the words, so the API and the demo give the same words?
- **Q3. `resetSettings` in the ApiClient.** Taken: kept. It refuses Localization and tax and still resets other sections, and no screen calls it. Remove it from the contract?
- **Q4. Keep `"localization"` out of the method types** (`Exclude<keyof CompanySettings, "localization">` on `updateSettings` and `resetSettings`). Taken: not done (D45); the runtime refusal with words stays either way. Add the compile-time block too?

## Which test pins which path

| Path | Tests | Mutations |
| --- | --- | --- |
| The section refused by name, any value | WS1, R8, LD13 | WM1, WM2 |
| After module, keys, switch and scope; nothing stored or audited | WD1, LD13 | WM3 |
| Neither key alone saves another tab's settings | WD1, LD6 | WM1 |
| `resetSettings` refused; other sections still reset | WD2, WW1 | WM4 |
| Api mode: refused through DemoStore, nothing sent | WW1, W6, W7 | WM5 |
| The API has no whole-section route | L16, 3a's ST case | (unchanged) |
| Zone and overtime can't pass through the whole section | RD10, D5 | WM1 |
| Tax-inclusive data can only go back to exclusive (TD9's new set-up still reaches the rule) | TD9 | WM6 (3a's TM40) |
| Later-dated pre-3a rows are not shown and drop out on the first Sales tax save (TD11's new set-up) | TD11 | none (A1) |

## For STATUS (the orchestrator applies these)

- **In progress / next:** "...; part 3b, Localization and tax saves one tab at a time (`feat/settings-localization-section`, stacked on #59); then 4 Locations and shared costs, 5 HR, 6 Branding".
- **Done (on merge):** "Settings part 3b (queue item 2, task 2), PR #<n> (ADR 0059, 2026-11-20 part 3b section). `updateSettings("localization")` and `resetSettings("localization")` are refused in both modes ("Localization and tax saves one tab at a time.") after the module, keys, switch and scope checks; nothing is stored or audited, and `localizationProblem` is gone. Neither localization key alone saves another tab's settings by any path, and no tax block is stored whole. No screen, API, schema, migration or dependency change."
- **Close:** 2a's "`updateSettings("localization")` keeps the any-of keys ..." and 2b's "The whole-section path ... retire it in part 3 (planned as 3b)" (also 2b's review note, which has no STATUS line of its own).
- **Change:** part 1's "Reset to default reads DemoStore's originals in api mode; `resetSettings` is unrouted. ..." gains "; `resetSettings("localization")` is refused (part 3b)".
- **New follow-ups:** the settings menu repeats `SETTINGS_SECTIONS.localization.keys` (`settings-menu.ts`'s `anyOf`, and the page's `canLocal || canTax`): read them from the one table. `apps/api/src/modules/settings/settings-input.ts`'s JSDoc says the API checks bodies with `settingsSectionProblem`, but the controller calls each section's rule directly: reword it.
- **Owner questions:** "Owner questions (Settings part 3b; none blocks)" with Q1 to Q4 above.
- **BRANCHES:** a `feat/settings-localization-section` row: "A (Claude)", "Queue item 2, task 2, Settings part 3b: the whole-section localization save retired (worktree `C:devp-3b`; stacked on #59)", the state at handoff, the PR once opened, "see the branch".

## Commands run

| Stage | Command | Result |
| --- | --- | --- |
| 0 | the plan's stage 0 greps (above) | one extra caller, TD11 (A1) |
| 0 | commit `9463378` (log, settings-and-permissions.md, sales.md) | pushed |
| 1 | `pnpm --filter @workspace/shared exec vitest run test/settings-sections.test.ts test/localization-rules.test.ts test/region-currency-rules.test.ts` | red as planned: R8 (null, not the words) and WS1 (the constant undefined); 26 others pass, LR6 and RG7 among them |
| 1 | `apps/web: npx vitest run` demo-localization, demo-region-currency, demo-settings, demo-tax, settings-answer | red as planned, 6 of 65: LD13, WD1 (at the tax-only line, `:246`), WD2 and WW1 (the whole save resolved), RD10 (the zone's words), D5 (the overtime words). TD9 and TD11 pass: the fixture patch applies |
| 1 | commit `de9b41f` (the tests) | pushed |
| 2 | `packages/shared: npx vitest run` | 80 files, 1178 tests passed |
| 2 | the same 5 web files | 65 passed |
| 2 | `pnpm typecheck`, `pnpm --filter api typecheck` (uncached), `pnpm lint` (with Prettier) | all pass; the API compiles without `localizationProblem` |
| 2 | `git grep -n localizationProblem -- apps packages` | only WS1's assertion that it is gone |
| 2 | commit `35d2b8a` (the 6 product files; Prettier reformatted two of the new tests) | pushed after the mutations |
| 2 | mutations WM1 to WM6 (`settings3b/mutate.mjs` in the scratchpad: a saved copy restored after each) | all caught, all restored, tree clean (below) |
| 3 | `netstat -ano | grep -E ":3000 |:4000 " | grep LISTEN` before and after every e2e run | nothing listening each time |
| 3 | `NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build`, `pnpm --filter api build` | both exit 0 |
| 3 | `node <scratchpad>/e2e-api.mjs C:/dev/fp-3b tests/e2e-api/settings.spec.ts tests/e2e-api/settings-localization.spec.ts tests/e2e-api/settings-region-currency.spec.ts` (trimmed, plan S5; `settings-tax.spec.ts` waits for the whole suite) | 7 passed (1.3m) |
| 3 | `NEXT_PUBLIC_DATA_SOURCE=demo pnpm --filter web build` | exit 0 |
| 3 | `apps/web: E2E_WORKERS=2 npx playwright test` settings, localization, tax, number-format, branding, square-feet, quote, invoice-lifecycle, audit, roles, users, presenter-guide, expenses, payments `--project=flooring` | 56 passed (1.2m) |
| 3 | the same for settings, localization, hr, hr-workspace, branding, number-format, roles, users, audit `--project=hr` (only settings.spec.ts holds `@hr` tests among them) | 8 passed (10.8s) |
| 4 | docs: ADR 0059 section "2026-11-20: part 3b" and its "Later parts" row 3 and 3a's 3b line; api-contract (part 1 "The web", 2a "One key per tab" and "Not routes yet", the `updateSettings`, `updateLocalization`, `getDefaultSettings` and `resetSettings` rows); blueprint-delta row (A4). FEATURES.md, data-model.md and demo-script.md unchanged (D43: no switch, table or step) | read against the code; Markdown is in `.prettierignore` |

### Mutations (stage 2, on the committed change `35d2b8a`)

```
WM1 (drop the name check)            caught by WS1, R8, LD13, WD1, WD2, RD10, D5, WW1   restored=true caught=true
WM2 (refuse by the narrowed value)   caught by WS1 (the undefined value)                 restored=true caught=true
WM3 (content rules before the keys)  caught by WD1 (Priya got the section's words)       restored=true caught=true
WM4 (resetSettings bypasses updateSettings) caught by WD2                                 restored=true caught=true
WM5 (api mode sends localization)    caught by WW1 and W6                                restored=true caught=true
WM6 (3a's TM40: refuse every pricesInclude change) caught by TD9                          restored=true caught=true
```

## Stages 0 to 2: outcome

Red for the stated reasons, then green; every mutation caught. No screen, flow or e2e calls the whole-section save; only unit tests did.

## Stage 3: outcome

Every settings page of both projects, Localization and tax, Sales tax, Sales and documents' Reset to default, the quote builder, invoices and the audit log pass in demo mode, and the settings, localization and region-currency specs pass in api mode on this branch's build. No e2e test changed (D41).

## What's left

Stage 5.
