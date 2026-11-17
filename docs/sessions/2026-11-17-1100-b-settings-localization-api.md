# Session 2026-11-17 11:00, B (Claude): Settings part 2a on the API: Sales and documents and the Payroll rules tab, one key per tab (queue item 2, task 2)

Person: B (Claude), on B's Mac. Branch `feat/settings-localization-api`, base `b898f05` (the handoff head of Settings part 1, `feat/settings-sections-api`, draft PR #51, review clean after five rounds). Main is `d0e4e20`. This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

**Stacked on PR #51.** Settings part 1 (#51) is stacked on GET /company (#50), and through it on B6 (#49), B5 (#48), B4 (#47), B1 (#46) and B3 (#45). None can merge yet: GitHub Actions is blocked by a billing problem on the account. The orchestrator cut this branch from part 1's handoff head with `git switch -q --no-track -c feat/settings-localization-api origin/feat/settings-sections-api`, so that STATUS and BRANCHES stay linear and the files part 1 and 2a share (`sections.ts`, `section-rules.ts`, the settings module, `settings-answer.ts`, `api-methods.ts`, `store.ts`, `checks.ts`, part 1's e2e spec, ADR 0059, api-contract.md, the spec) can't conflict later (D20). The PR must merge after #45, #46, #47, #48, #49, #50 and #51; when they merge, the orchestrator merges `origin/main` into this branch.

## Prompt

### The owner's queue (verbatim)
> Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
> 2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
> 3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
> 4. Then stop and hand off. Don't start P13; the owner does a click-through first.

This session is item 2, task 2, "then Settings", part 2a: Sales and documents and the Payroll rules tab of Localization and tax move to the API (`PUT /settings/localization/documents` and `/payroll`), with per-tab keys from a shared `LOCALIZATION_TABS`, `updateLocalization(tab, value)` on the web, and `GET /settings` answering documents and payroll to their readers. **First, before any section is added,** `GET /settings`' answer dispatch becomes exhaustive (a switch with a `never` check, so a section it doesn't name can never be answered as `expenses`), and the web merge likewise, with a test that fails on the old code. That was raised in Settings part 1's review rounds 2 to 5 and recorded as a STATUS follow-up ("Settings part 1 follow-ups"). Security review required (money-adjacent defaults, the payroll rule, permissions).

### Per-task rules (owner)
- Read the blueprint prompt first: P11 in docs/real-build-plan.md ("Each module follows prompt P11"), the product spec (docs/product-spec/settings-and-permissions.md) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why". Add a docs/blueprint-delta.md row only if the plan of record changes.
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- CLAUDE.md rules apply: rule 1 (screens only through the ApiClient), rule 2 (the company from the verified session), rules 3 and 4 (deny by default, permissions only from packages/shared), rule 6 (decimal strings), rule 12 (no hard-coded rules), JSDoc on exports, no dead code, no duplicated logic.
- If a stop-and-ask item comes up (the time zone made editable, a `document_sequences` change, seeding at provisioning), stop and report it instead of building it.
- STATUS and BRANCHES are left to the orchestrator's handoff; what they need is under "For STATUS" below.
- **This laptop (8 GB):**
  - Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `gh pr merge`, or `rm -rf`.

### The problem as recorded
- In api mode Sales and documents and all four tabs of Localization and tax save through `updateSettings("localization")`, which stays on DemoStore (part 1's W6), so they save in the browser only, while the server numbers quotes, invoices and purchase orders, sets new customers' terms, dates deposit balances and checks a salesperson's waste from its own `localization` row. A waste default changed on Sales and documents in api mode already makes every salesperson's new line of that category a 403, because the builder starts from DemoStore's copy and the server compares with its own.
- `settings.tax.manage` is enough to save all of `localization` (spec edge case): the section is one record and its rule takes either key.
- docs/STATUS.md (part 1's head): "The waste and Settings default inputs keep a bare point as typed (`12.`)"; "When `PUT /settings/:section` moves to the API, it must refuse `overtimeRuleProblem`"; "`GET /settings`' answer builder is not exhaustive: a section it doesn't name is answered as `expenses`, and the web merge would ignore it. Part 2a adds sections, so it makes the dispatch exhaustive (a `never` check) first."

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (spec, failing tests, endpoints with guards and audit, the screen, the security review, the PR, the handoff), module order row 4 (Settings), and the CI budget (drafts get only `fast`).
  - `.claude/commands/feature.md` steps 1 to 9.
  - docs/product-spec/settings-and-permissions.md: "Who uses it", "Settings pages", "Workflows" (Save settings), rules 7, 22, 23 and 30, "CompanySettings" (`localization.payroll`, `localization.documents`), "Events and audit entries", "Edge cases and known limits", "Real build" (part 1, known limits).
  - docs/product-spec/sales.md ("Settings that drive this module", rule 8 on waste, rules 12 and 21, known gaps) and docs/product-spec/hr.md (rule 7, the payroll rule).
  - The blueprint's "Localization, currency and tax settings" (pp. 20-21) and its rule 4 (base currency and tax changes need a step-up).
  - ADR 0059 (part 1), ADR 0050 (the California switch), ADR 0037 (sales); docs/api-contract.md "Settings, part 1"; docs/data-model.md "Settings groups"; docs/FEATURES.md row `settings.localization`.
  - Part 1's session log (docs/sessions/2026-11-17-0700-b-settings-sections-api.md): D1 to D24, the build lessons B1 to B18, review rounds 1 to 5 and the handoff.
- **The code at `b898f05`:**
  - **Shared:** `settings/sections.ts`, `settings/section-rules.ts`, `decimal-text.ts`, `operations/quotes.ts` (`defaultWastePct`, `PAYMENT_TERM_LABELS`), `catalog-labels.ts`, `us-pack/overtime.ts`, `us-pack/states.ts`, `types/settings.ts`, `index.ts`.
  - **API:** `modules/settings/settings.controller.ts`, `settings.service.ts`, `settings-input.ts`; `modules/sales/sales.service.ts` (`assertWaste`, numbering, terms), `sales-records.ts` (`loadLocalization`), `sales-common.ts`; `modules/hr/hr-records.ts` (`loadHrRules`); `core/access/permission.guard.ts` (module before keys).
  - **Web:** `lib/api/http/api-methods.ts`, `settings-answer.ts`; `lib/api/contract.ts`; `lib/api/demo/store.ts` (`updateSettings`); `features/settings/documents/documents-page.tsx`, `features/settings/localization/localization-page.tsx`; the quote builder's use of the defaults (`quote-page.tsx`, `quote-builder.tsx`, `use-quote-draft.ts`).
  - **Tests:** api `settings.int.test.ts` (setup, A0 to A15), `sales.int.test.ts` (`setUp`, `placeIn`), `california-switch.ts`; web `settings-answer.test.ts`, `demo-settings.test.ts`, `api-rereads.test.ts` (151 cases, 108 writes), `fake-api.ts`; e2e `tests/e2e-api/settings.spec.ts`, `flows/checks.ts`, `tests/e2e/settings.spec.ts`.
- **Planning:** a first plan, a critic's review (two must-fix items and thirteen should items) and a final plan that applies them, written against part 1's stage 2 head `d043fc7`. Part 1 has since finished at `b898f05`, so every line number was re-checked here and every edit is anchored on text. The plans live in the session scratchpad, not in the repo, so the plan is restated below.

### Differences from the plan found in stage 0 (part 1's head `b898f05`)
- **DemoStore already checks the module before the keys** (part 1's review round 4, `517b805`), and the spec's rule 7 order sentence already says so. 2a's `assertSettingsSave` only shares that order between `updateSettings` and the new `updateLocalization` (D16); no existing demo behaviour changes.
- **Part 1's handoff is pushed:** ADR 0059 exists on the branch, `origin/feat/web-company-from-api` is an ancestor, and PR #51 is a draft. Stage 0's preconditions hold.
- **Part 1's tests that read `GET /settings` keys** (A1, A2, A8, A9b, A11) use `floorco`, `peopleco`, `bareco` and `otherco`, none of which holds a `localization` row (only `payco` does, and no exact-key check reads it). They are unchanged by 2a.
- **The exhaustive dispatch** is not in the final plan (it was raised in part 1's later review rounds); it is done first, as its own commit (D19).
- The rereads counts (151 and 108), `canonical` and `auditBy` (local to part 1's e2e spec) and the controller's shape match the plan.

## Plan (short)

### First: an exhaustive `GET /settings` dispatch (D19)
- packages/shared `sections.ts`: `unservedSection(section: never): Error`, the one error a dispatch over the served sections throws for a section it doesn't name. Its `never` parameter makes TypeScript refuse a dispatch that leaves a section of `API_SETTINGS_SECTIONS` out; a call that slips past the types throws instead of answering one section as another.
- API `SettingsService.answer`: a `switch` over the section with a `default` that throws `unservedSection(section)`, before any value is read. Each case reads its own section's value (no cast needed).
- Web `settingsFromAnswer`: a `switch` over `API_SETTINGS_SECTIONS` with the same `default`, so a section the API serves can't be left as DemoStore's copy by the merge.
- Tests that fail on the old code: an API unit test (`readableSections` mocked to give a section the dispatch doesn't name, with a stored row for it: the old code answered it as `expenses`), and a web unit test (`API_SETTINGS_SECTIONS` mocked with an extra section: the old merge silently kept DemoStore's copy).

### Shared (packages/shared; plain functions, no Zod)
- New `settings/localization-rules.ts` (a leaf): `DOCUMENT_PREFIX_TEXT` (moved here), `WASTE_CATEGORIES`, `LEGAL_FOOTER_MAX`, `DOCUMENT_MESSAGES`, `PAYROLL_MESSAGES`, the loose input types `DocumentsInput` and `PayrollInput`, `documentsProblem`, `payrollProblem`, `localizationTabProblem` (DemoStore's per-tab dispatcher) and `localizationProblem` (the whole-section path).
- `settings/sections.ts`: `LocalizationTabRule` (exactly one key), `LOCALIZATION_TABS` (key, switch, module and audit label per tab: documents `core`, payroll `hr`, the rest `platform`), `API_LOCALIZATION_TABS` (`documents`, `payroll`), `LOCALIZATION_READERS`, `readableTabs`, one private `isReadable` shared with `readableSections`, and `SettingsAnswer.localization`.
- `settings/section-rules.ts`: the localization branch runs `localizationProblem`.

### The API (part 1's `settings` module)
- `PUT /settings/localization/documents` and `/payroll`: one key, module and switch from `LOCALIZATION_TABS`; then data scope `all`, the strict Zod body, the shared rule, and a save that replaces only that tab of the `localization` row under `FOR UPDATE`, with one audit entry naming the tab. 409 `settings_missing` when the company has no `localization` row; nothing is created.
- `GET /settings` answers `localization: { documents?, payroll? }` per `readableTabs`.

### The web
- `updateLocalization(tab, value)` on the ApiClient: in api mode the tabs in `API_LOCALIZATION_TABS` are the PUT, then a read; Region, Currency and Sales tax stay on DemoStore, which checks each tab's own key. The merge takes only the served tabs.
- `documents-page.tsx` and `localization-page.tsx` call it (one line each). DemoStore gets `assertSettingsSave` (module, keys, switch, scope) and `updateLocalization`.

### Tests (red first)
- **Exhaustive dispatch:** X1 to X3 (API unit `settings-dispatch.test.ts`, web unit `settings-dispatch.test.ts`).
- **Shared** LR1 to LR7 (`localization-rules.test.ts`).
- **API** L0 to L16 (`settings-localization.int.test.ts`, its own companies; part 1's file unchanged).
- **Web unit:** LW1 to LW6 (`settings-answer.test.ts`), LD1 to LD13 and LD8b (`demo-localization.test.ts`), one `api-rereads` case (152 and 109).
- **Api-mode e2e:** E1 and E2 (`tests/e2e-api/settings-localization.spec.ts`), with `canonical` and `auditBy` moved to `flows/checks.ts`.
- **Demo e2e:** S2 and S3 in `tests/e2e/settings.spec.ts`.
- **Mutations** LM1 to LM26 on the final code.

### Stages (one commit each, pushed)
0. This log and the spec (docs only), the draft PR.
0b. The exhaustive dispatch, red first, with its tests.
1. Red tests for 2a, no product code (no commit).
2. The change: 2a shared and API, 2b web, each with its unit and API tests and checks; the mutations; 2c the e2e specs; this log.
3. Api-mode and demo e2e (green). 4. Docs. 5. Full checks, both suites, reviews, handoff (later stages, run by the orchestrator's next steps).

## Decisions and why
Planned decisions, each the safest option found. Decisions taken while building go under "Decisions taken during the build".

- **D1, part 2 is split** into 2a (Sales and documents, Payroll rules, the per-tab plumbing) and 2b (Region, Currency). All of part 2 would be about 15 product files, at the limit; the split is for review focus: 2b holds the time zone's control copy, the Currency step-up and the tax effect of states of operation, and would double the test set (Q8).
- **D2, a per-tab ApiClient method, not a client or server diff:** `updateLocalization(tab, value)`, a one-line change on each page. A server-side diff would compare the half-DemoStore copy with the stored row and need each changed tab's key: more code, and it hides which tab a person meant to save.
- **D3, one key per tab, in both modes.** `LOCALIZATION_TABS` gives Sales tax `settings.tax.manage` and every other tab `settings.localization.manage`; its type allows exactly one key. "`settings.tax.manage` is enough to save all of localization" is closed for every screen. Only the screenless `updateSettings("localization")` keeps the any-of (R6).
- **D4, the three document prefixes must differ** (without case). Numbers are unique per table, so this isn't integrity: an invoice and a quote both numbered `Q-1001` would mislead customers and searches. Payment, refund and supplier prefixes may still equal them (Q2). **Corrected in review round 1 (R1-1):** it is integrity for invoices: credit notes share the invoices' number index under the fixed `CR-`, so no document prefix may start with `CR-`.
- **D5, the audit action stays "Changed localization and tax"** (the spec's string). The target is the tab's label, and `before` and `after` are that tab only, in both modes.
- **D6, no step-up** for Sales and documents or Payroll rules. The blueprint asks one only for base currency and tax (p21 rule 4); the deposit and prefixes aren't controls over money already taken, and payroll accepts only the federal rule while California is off (Q3).
- **D7, a company with no `localization` row:** `GET /settings` leaves `localization` out, and a tab PUT answers 409 `settings_missing`. The API never builds a row from one tab: the other tabs would be missing, and `loadLocalization`, `taxContextFor` and numbering would read `undefined`. Fail closed; seeding at provisioning stays part 1's Q4. A provisioned HR company can't set its payroll rule on the API until then, which is today's state too (`loadHrRules` already 409s).
- **D8, readers, the narrowest every screen still gets** (part 1's D3): documents to quote, invoice and PO readers and the page's managers; payroll to timesheet, HR overview, HR settings and localization key holders (every default role in a company with HR). Neither is hidden by its page switch.
- **D9, the tab dispatcher takes no `current` in 2a.** No 2a rule reads the stored tab, and the shared ESLint config fails an unused parameter. The API still reads the locked row to merge into. 2b adds `current` with its first rule that reads it, which changes the dispatcher's signature there.
- **D10, whole days, terms, waste categories, percent bounds, the holiday state and the footer length are the shared rule's,** not Zod's. Zod checks types, outer lengths and unknown top-level fields, and the footer's Zod bound carries the shared words. A refusal reads the same in both modes. **Narrowed in review round 1 (R1-2):** from the screen, yes; every outer length now carries its field's words, but a direct caller sending a string past an outer length together with another problem can get a different field named.
- **D11, loose input types.** `DocumentsInput` and `PayrollInput` are what the API's body check outputs and what the rules take; nothing on the API casts a body. The stored types are assignable to them.
- **D12, Payroll rules are module `hr`.** A Flooring company without HR (none in the fixtures) still sees the Payroll tab, and its save is refused with the module message (Q4).
- **D13, Sales and documents is module `core`.** The HR Suite never shows the page; its Owner's PUT answers `module_not_enabled`.
- **D14, `document_sequences` is not updated by a prefix change.** It is seeded and read by nothing (R10). Changing it is a stop-and-ask item.
- **D15, the waste defaults reach every quote reader, Sales included,** so a builder's new line matches the server's waste check. B6 already answers every line's waste to Sales, so nothing new is exposed (Q6).
- **D16, DemoStore's settings saves share one `assertSettingsSave`** (module, keys, switch, scope), the API's order, which part 1 already applies in `updateSettings`.
- **D17, the API test file builds its own companies;** part 1's file is left as it is (repo precedent of per-file helpers). A test-helper sweep is a follow-up.
- **D18, STATUS and BRANCHES are the orchestrator's** (part 1's D24).
- **D19, the exhaustive dispatch comes first, as its own commit.** A `switch` with a `never` default in the API's answer and in the web merge, both throwing one shared `unservedSection` error, so adding a section to `API_SETTINGS_SECTIONS` without answering and merging it fails the typecheck, and a section that slips past the types fails closed (a 500 on the read, an error in the merge) instead of being answered as `expenses` or left as DemoStore's copy. The tests force a section the dispatch doesn't name by mocking the shared module, since the real types make it impossible; each fails on part 1's code (the API answered the section's row as `expenses`; the merge returned DemoStore's copy).
- **D20, stacked on Settings part 1 (#51) (the orchestrator's decision).** Nothing can merge while GitHub Actions is blocked by billing; stacking keeps STATUS and BRANCHES linear and the shared files conflict-free. The PR body says it is stacked on #51 and must merge after #45 to #51.
- **D21, no test-writer subagent.** feature.md step 4 hands the API and Playwright tests to the test-writer subagent; this session runs as a subagent without one, so the builder writes them from the final plan's test section, as part 1 did (its D23).

### Decisions taken during the build
- **B1, the exhaustive dispatch reads each section inside its own case.** In `SettingsService.answer` a local `read(section)` calls `valueOf` with the case's narrowed section, so each case gets its own type with no cast (part 1 cast every value), and the `default` throws `unservedSection` before any value is read. The web merge loops over `API_SETTINGS_SECTIONS` with the same `default`. X1 (the four sections each under its own key) passes on part 1's code as the positive control; X2 and X3 failed there for the reason the follow-up names: "promise resolved `{ expenses: { …(6) } }` instead of rejecting" (Summit's branding row answered as `expenses`) and "expected [Function] to throw an error" (the merge kept DemoStore's copy).
- **B2, `GET /settings` reads the `localization` row in the same one query,** typed as the column's `SettingsGroup` list, and `lockGroup` takes a `SettingsGroup` (the column's own type; a plain `string` doesn't typecheck against it).
- **B3, part 1's W tests needed one type line.** Their `served()` helper was typed `Required<SettingsAnswer>`; `SettingsAnswer` gained an optional `localization`, so `Required<…>` demanded it. The helper is now `Required<Pick<SettingsAnswer, ApiSettingsSection>>`. No case of W1 to W7 changed. Part 1's `settings.int.test.ts`, `demo-settings.test.ts` and `settings-sections.test.ts` are unchanged, as planned.
- **B4, `auditBy` moved with a sibling.** `flows/checks.ts` gets `auditEntriesBy` (the entries) and `auditBy` (their count), using checks.ts' existing `auditTime`, the same parse part 1's local copy did; E1 and E2 read the audit targets through `auditEntriesBy`, so the filter is written once.
- **B5, the `api-rereads` case saves Payroll rules** (`updateLocalization("payroll", { overtimeRule: "federal", holidayState: "CO" })`) rather than Summit's documents literal: a served tab either way, so it is a write that reaches the API; the counts are 152 and 109.
- **B6, three new cases pass on part 1's code by design:** LW6 (an unrouted method already falls through to DemoStore; LM15 pins the routing), L16 (the routes don't exist yet) and LR7 (a key walk of the fixture). Every other new case was red.
- **B7, the demo e2e script** is the planning step's `settings2/e2e-demo.sh` (written from part 1's, which came from `b2/e2e-demo-r2.sh`): a demo-mode build, one worker, ports freed through `flows/ports.sh` before and after, logs in `settings2/logs`.
- **B8, L5's people.** Sales is placed in the warehouse's branch after sign-up, as `sales.int.test.ts` places its rep; the Owner adds the supplier and Purchasing places the order. The quote total of step 7 is compared with step 1's as text (the same body, the same tax rule).
- **B9, one prettier pass wasn't enough** for `settings-localization.int.test.ts` (a chained `insert … values` re-wrapped on the second `--write`); both passes were run before the commit.
- **B10, E1's first green run failed in the test, never in the product** (stage 3). The refusal toast opens at the bottom right, over the sticky bar's Discard and Save buttons, and sonner keeps it open while the pointer rests on it; the pointer is still where Save was clicked, so the toast never closed and the next click on the bar timed out ("subtree intercepts pointer events"). E1 now moves the pointer away and waits for the toast to close before clicking Discard (the plan's step), then checks the late fee is back at 1.5. A second failure was a test locator: "Waste for Carpet" also matched "Waste for Carpet tile", so it is matched exactly. The toast and the bar are part 1's `saveSection` and `SaveBar` on every settings page, not 2a's; demo S2's second Save at the same window size went through, so when the toast covers the bar isn't pinned down. Recorded as a follow-up to check by hand, not changed here.
- **B11, a throwaway proof of E1's builder step** (the earlier report's open doubt). With the web merge changed to skip `documents` (`if (answer[tab] && tab !== "documents")` in `servedTabs`), an api-mode build and E1 alone, Priya's "Save as draft" answered **403 instead of 201** ("the builder's new line carries the server's waste default"): the builder started from DemoStore's 12 % carpet waste while the server's default was 13 %. The file was restored with `git checkout --` (`git diff --quiet` true) and later builds were made from the restored code. So E1 step 3 pins on screen that a salesperson's new line starts from the server's default.
- **B12, `assertCan` kept its own JSDoc.** Stage 2b inserted `assertSettingsSave` between `assertCan`'s JSDoc and `assertCan`, leaving that JSDoc above the new method's and `assertCan` without one (CLAUDE.md: every function gets a JSDoc). Found while reading the diff for the docs; moved back, comment placement only, its own commit.
- **B13, no flow is `fixme`.** `git grep fixme -- apps/web/tests` finds nothing on this branch: every flow (F1 to F7) already runs, so there was no flow to turn back on. All 8 flow tests ran green in stage 3.
- **B14, the quick api-mode builds are real builds.** tsup builds the API in about 240 ms, and Next 16's Turbopack reuses its build cache ("Compiled successfully in 3.5s") while TypeScript still checks everything ("Finished TypeScript in 8.3s"), so `--build` takes 12 to 17 s. B11's mutation reached the built web, which shows a source change is picked up.
- **B15, Markdown is in `.prettierignore`** (`*.md`), so prettier checks none of the docs; the stage 4 docs were checked by reading them against the code.
- **B16, the docs follow the code where the plan's words were looser:** `document_sequences` is described as seeded and read by nothing, with each kind numbered from its own table under a lock (quotes and invoices, for example, take advisory locks); the legal footer is printed on invoices, receipts and purchase orders (sales.md's row said invoices only).

## Which test pins which path
| Path | Pinned by |
| --- | --- |
| `GET /settings` answers each served section under its own name; the web merge takes every served section | X1 to X3; XM1, XM2 |
| Routes declare one key per tab, with their module | L0, L14, LR1; LM1, LM2 |
| GET answers each tab to its readers; module filter; switch doesn't hide | L1, L7, L9, LR3, E1 step 3, E2 step 3; LM12, LM13, LM22 |
| Never saved: no answer, 409, no row made | L2; LM18 |
| Each PUT's permission, every role, both products | L3, L6 |
| Strict bodies and shared content rules in both modes, same words | L4, L6, LR4, LR5, LD1 to LD5, LD12, S2, E1 step 1; LM8 to LM11, LM19, LM20, LM23, LM24, LM26 |
| Read-modify-write keeps the other tabs and the tax block; the lock | L3, L5 step 7, L13, LD11; LM5, LM6 |
| The server acts on it (numbering, terms, waste rule, PO, prices) | L5, E1 step 3 |
| Switch, scope, ceiling, module below | L7, L8, L9, L10, LD8 to LD10; LM3, LM4 |
| Module before keys in DemoStore (as the API) | LD8b; LM17, LM25 |
| Own company only | L11 |
| Audit per save, the tab named | L3, L6, LD11, S2, S3, E1 step 7, E2 step 5; LM7 |
| Per-tab key in DemoStore (the any-of closed for screens) | LD6, LD7; LM16 |
| Web: served tabs merged, others DemoStore's, unknown ignored, routing | W2, LW1 to LW6; LM14, LM15 |
| Whole-section path runs the tab rules | LR6, LD13; LM21 |
| Only documents and payroll are routes (zone, base, tax not writable) | L16 |
| The saver's screens follow; what isn't offered the API refuses | E1 steps 2 to 5, E2 steps 1 and 3 |
| Region, Currency and Sales tax unchanged in api mode (browser) | LW6, E2 step 4, S3, the demo subset |

## Owner questions
None blocks; each has its safest default taken.
- **Q1, who reads Sales and documents and Payroll rules.** Taken: documents to quote, invoice and PO readers and the page's managers; payroll to timesheet, HR overview, HR settings and localization key holders (every default role in an HR company). Widen or narrow?
- **Q2, prefix overlap across sections.** Taken: quote, invoice and PO prefixes differ from each other; payment, refund and supplier prefixes may still equal them. Refuse those too?
- **Q3, step-up.** Taken: none for Sales and documents or Payroll rules; the blueprint asks one only for base currency and tax (2b, part 3). Add one for the deposit or prefixes, or for payroll once California is on?
- **Q4, Payroll rules without HR.** Taken: the save is refused (module `hr`) and the tab still shows. Hide the tab for a company without HR?
- **Q5, a company with no localization settings.** Taken: a tab save is 409 and nothing is invented. Seed country-pack defaults at provisioning (part 1's Q4)?
- **Q6, waste defaults and Sales.** Taken: the defaults reach every quote reader, because the builder starts new lines from them. If waste becomes sensitive (B6 Q3), how does a salesperson's new line get its waste? And when a default changes while her builder is open, should the server fill a new line's waste for people without `sales.waste.view` (the builder sending none), or the builder re-apply a changed default to unsaved lines still at the old one? Today every save of that draft is refused until she re-adds the lines (R3).
- **Q7, audit wording.** Taken: the action stays "Changed localization and tax" and the target names the tab. Prefer per-tab actions ("Changed sales and documents")?
- **Q8, the split.** Part 2 became 2a (this) and 2b (Region and Currency). All of it is about 15 product files, so it could have been one PR; it was split for review focus. Keep 2b separate, and this order?

## For STATUS
The orchestrator applies these at handoff (re-read STATUS first and anchor on the quoted text).
- **"In progress" and "Next three tasks" item 2:** "then Settings" gains "(part 2a: draft PR #52, `feat/settings-localization-api`, stacked on #51)".
- **"Done"** (on merge): "Settings part 2a on the API (queue item 2, task 2), PR #52 (ADR 0059, 2026-11-17 section). `GET /settings`' answer and the web merge dispatch every served section exhaustively (a `never` check), so a section neither names can't be answered as another. In api mode Sales and documents and the Payroll rules tab save on the API (`PUT /settings/localization/documents` and `/payroll`), each with its own key and module (documents `core`, payroll `hr`), company-wide scope, strict bodies and shared rules (percents 0 to 100 as quotes take them, whole days, distinct prefixes none of which starts with the credit notes' `CR-` (credit notes are numbered from every invoice number), a footer of at most 1,000 characters, the California rule refused while off), replacing only that tab under a row lock, with one audit entry naming the tab; `GET /settings` answers the documents to quote, invoice and PO readers and the payroll rule to timesheet, HR and settings readers, so the quote builder's deposit, waste and expiry, the invoice, receipt and PO footers and the timesheets' overtime rule follow the server, and a salesperson's new line matches the server's waste default; every Localization tab saves on its own with its own key in both modes (`updateLocalization`), so `settings.tax.manage` no longer saves the other tabs; DemoStore's settings saves share one module-first check. No schema change, migration or dependency; nothing in core, providers, packages/db or the web's session. Checks: lint, typecheck, test, test:api and test:hooks green (after review round 1: shared 1,144, web 391, api unit 126, api integration 724); the whole api-mode suite green on a fresh build (51 tests, before round 1; round 1's affected api-mode specs, 15, green on a fresh build); the demo subset green (271 tests, before round 1; round 1's affected demo specs, 16, green); 35 mutations caught (28, then 7 in round 1)."
- **Close or update:**
  - "Settings part 1 follow-ups": "`GET /settings`' answer builder is not exhaustive …": done (D19).
  - "The waste and Settings default inputs keep a bare point as typed (`12.`)": Sales and documents' percents now refuse it in both modes, with the field's message. The blur write-back (PR #49 Q2) stays open.
  - "When `PUT /settings/:section` moves to the API, it must refuse `overtimeRuleProblem`": done by `PUT /settings/localization/payroll`. "Storing the rule a run was approved under" stays open.
  - "The company's zone has two copies … The Settings task must write both" becomes: "**Planned for Settings part 2b:** answer the zone from `tenants.time_zone` and refuse a change in both modes (owner question). Until then Region saves in the browser in api mode, and nothing on the API writes either copy."
  - Part 1's "Unmoved settings pages save in the browser only" drops Sales and documents and says "Localization and tax's Region, Currency and Sales tax tabs".
  - The spec edge case "settings.tax.manage is enough to save all of localization": closed for every screen.
- **New follow-ups:**
  - **Settings part 2b** (Region and Currency), then part 3 (Sales tax). The quote builder's tax preview still reads DemoStore's region and tax in api mode.
  - **A waste default changed while a salesperson's builder is open** refuses every save of her draft ("Your role does not allow changing waste.") until she removes and re-adds the lines started from the old default, or reloads and loses the draft; she can't see the waste to fix it, and the words say she changed something. Fix on the B6 side: either the server fills a new line's waste for people without `sales.waste.view` and the builder sends none, or the builder re-applies a changed default to unsaved lines still at the old one (Q6).
  - **The Payroll tab shows for a company without HR**, and its save is refused (Q4).
  - **`updateSettings("localization")`** keeps the any-of keys for `resetSettings` only. Retire it or route it per tab in part 3.
  - **`document_sequences`** is seeded and read by nothing, and isn't updated by a prefix change. Use it or drop it.
  - **A stored `california` rule** (an old overlay) blocks Payroll saves until the person picks federal, while the picker already shows federal (pre-existing demo behaviour; both modes).
  - **API test helpers are copied per file** (`summitLocalization`, `withFeatureOff`, the settings companies). Sweep them into `apps/api/test/support/`.
  - **Flows' local runs leave data:** E1 leaves a customer `E2E Docs <run>` and Priya's draft quote per run.
  - **A refused settings save's toast can cover the sticky bar** (part 1's `saveSection`, every settings page). In api-mode E1 (1440 by 900) the error toast opened at the bottom right over the bar's Save and Discard buttons and stayed while the pointer rested on it, where Save had just been clicked, so the next click on the bar never landed until the pointer moved away. Demo S2's second Save at the same size went through, so when it happens isn't pinned down. Check by hand; if it shows, move the toast (for example top right on settings pages) or the bar's buttons (B10).
- **Owner questions:** a new block "Owner questions (PR #52, Settings part 2a; none blocks)" with Q1 to Q8 above.
- **BRANCHES:** a `feat/settings-localization-api` row: "B (Claude)", "Queue item 2, task 2, Settings part 2a: Sales and documents and payroll rules on the API, one key per tab (main checkout; stacked on #51)", "Draft" then the state at handoff, the PR, "see the branch".

## Commands run
| Command | Result |
| --- | --- |
| `git status --short`; `git fetch -q origin`; `git log --oneline -14 origin/feat/settings-sections-api` | clean; part 1's handoff `b898f05` on top |
| `git show origin/feat/settings-sections-api:docs/adr/0059-settings-on-the-api.md \| head -5` | ADR 0059 present |
| `git merge-base --is-ancestor origin/feat/web-company-from-api origin/feat/settings-sections-api` | `p1-holds-company` |
| `gh pr list --head feat/settings-sections-api --json number,isDraft` | `[{"isDraft":true,"number":51}]` |
| `git switch -q --no-track -c feat/settings-localization-api origin/feat/settings-sections-api` | the branch, at `b898f05` |
| `docker ps`; `lsof` on 3000 and 4000 | compose PostgreSQL on 5432, `fp-e2e-worktree` on 5433; both ports free |
| `gh pr create --draft …` | draft PR **#52** |
| **0b red** (part 1's product code): `vitest --project unit test/settings-dispatch.test.ts` (api); `vitest tests/unit/settings-dispatch.test.ts` (web) | exit 1, 1 failed and 1 passed (X2 failed, X1 the control passed); exit 1, X3 failed |
| **0b green:** the same two, plus web `settings-answer`, `api-rereads` | 2 passed; 15 passed |
| `checks.sh s0b` shared typecheck, lint, test; api typecheck, lint; web typecheck, lint | all exit 0; shared 75 files, 1,136 tests |
| `vitest --project integration test/settings.int.test.ts` (after 0b) | exit 0, 42 passed, 17 s |
| **Stage 1 red** `vitest test/localization-rules.test.ts` (shared) | exit 1: LR1 to LR6 failed (the exports don't exist), LR7 passed |
| `vitest tests/unit/settings-answer.test.ts demo-localization.test.ts api-rereads.test.ts` (web) | exit 1: 23 failed, 11 passed (LW1, LW3 to LW5, LD1 to LD13 and LD8b, and the five `api-rereads` cases failed; W1 to W7, LW2 and LW6 passed) |
| `vitest --project integration test/settings-localization.int.test.ts` | exit 1: 26 failed, 1 passed (L16), 13 s |
| `checks.sh s1red web:typecheck` (with the red-run swaps) | exit 0 |
| `api-e2e.sh settings2-red --build -- tests/e2e-api/settings-localization.spec.ts tests/e2e-api/settings.spec.ts` | exit 1 after 44 s: E1 and E2 failed at their heal ("Expected: 200, Received: 404"); part 1's E1 to E3 passed with the moved helpers |
| `e2e-demo.sh red` | exit 1 after 45 s: S2 failed at the refusal toast (not found), S3 at the "Payroll rules" audit row (not found) |
| **Stage 2a green** `vitest test/localization-rules.test.ts test/settings-sections.test.ts` (shared) | exit 0, 17 passed |
| `checks.sh s2a-pre…` api typecheck | first exit 2 (`inArray` and `eq` on the `SettingsGroup` column with a `string`), then exit 0 (B2) |
| `vitest --project integration test/settings-localization.int.test.ts` | exit 0, 27 passed, 16 s |
| `checks.sh s2` shared test, typecheck, lint; api typecheck, lint, test | all exit 0; shared 76 files, 1,143 tests; api unit 18 files, 126 tests |
| `vitest --project integration` settings-localization, settings, sales, invoices, purchasing, contract-billing, hr, payroll, california-pay, permissions, isolation | exit 0, 11 files, 216 passed, 50 s |
| **Stage 2b** `vitest` web settings-answer, demo-localization, api-rereads, demo-settings, settings-dispatch | exit 0, 5 files, 46 passed |
| `checks.sh s2b` web test, typecheck, lint | test exit 0 (49 files, 390 tests); typecheck exit 2 (B3), then `s2b2` exit 0; lint exit 0 |
| `prettier --check` on each stage's files | clean (after the second `--write`, B9) |
| **Stage 2c** `eslint` on the four e2e files | exit 0 |
| `heavy.sh python3 settings2/mutate.py LM1 … LM26 XM1 XM2` (on the committed 2a and 2b, about 25 minutes) | all 28 caught, every file restored (below) |
| **Stage 3** `api-e2e.sh settings2-green --build -- settings-localization, settings, sales, invoices, purchasing, company, login` | exit 1 after 150 s: 24 passed (part 1's E1 to E3 among them), E1 failed at step 1 (the toast over Discard, B10) |
| `api-e2e.sh settings2-green2 -- settings-localization.spec.ts` (Discard swapped for typing the value back) | exit 1 after 14 s: E1 at step 2, "Waste for Carpet" matched two inputs (B10); E2 passed |
| `api-e2e.sh settings2-green3 -- settings-localization.spec.ts` (label exact) | exit 1 after 28 s: E1 at step 2, the toast over Save (B10); E2 passed |
| `api-e2e.sh settings2-green4 -- settings-localization.spec.ts` (pointer moved away, wait for the toast to close, then Discard) | exit 0 after 20 s: E1 10.4 s, E2 4.0 s |
| `api-e2e.sh settings2-again -- settings-localization.spec.ts` (the dirty database, no rebuild) | exit 0 after 19 s: E1 10.2 s, E2 3.7 s |
| `api-e2e.sh settings2-flows -- tests/e2e-api/flows` | exit 0 after 79 s: 8 passed (F1 19.2 s, F2 9.2 s, F3 5.7 s and 3.7 s, F4 5.5 s, F5 11.5 s, F6 12.9 s, F7 5.5 s) |
| Throwaway proof (B11): `servedTabs` skips `documents`; `api-e2e.sh settings2-proof-merge --build -- settings-localization.spec.ts -g "E1 Sales"`; then `git checkout --` | exit 1 after 15 s: E1 step 3 "Expected: 201, Received: 403"; the clean-up put the documents back (no clean-up error); file restored, `git diff --quiet` true |
| `e2e-demo.sh subset` (demo build, one worker) | exit 0: flooring 264 passed in 330 s (S2 and S3 among them), hr 7 passed in 6 s |
| **Stage 4** `vitest run test/features.test.ts` (shared) | exit 0, 7 passed |
| **Stage 5** `full.sh` (lint, typecheck, test, test:api, test:hooks) | all exit 0 in 3 min 52 s: shared 1,143, web 390, api unit 126, db 18, providers 11; test:api: api 723, db 59, providers 2; hooks 15 |
| `api-e2e.sh settings2-all-final --build` (the whole api-mode suite after the last product change) | exit 0 after 211 s (builds 13 s): 51 passed, none flaky; E1 10.5 s, E2 4.1 s; the eight flow tests among them |

### Mutations (stage 2, on the committed change)
Each mutation changes one product file, runs its tests, and restores the file with `git checkout --` (`git diff --quiet` true). Anchors were copied from the committed code and keep their commas (part 1's B13). Every one was caught by the test the plan names; `git status` showed only the uncommitted e2e files and this log afterwards.

| # | Mutation | Caught by (first failure) |
| --- | --- | --- |
| LM1 | `saveDocuments`' keys → the section's two | L0 ("expected [ Array(2) ] to deeply equal [ 'settings.localization.manage' ]") |
| LM2 | `@RequireModule` off `saveDocuments` | L3 ("hr owner: expected [ 200 ] … [ 403, 'module_not_enabled' ]") |
| LM3 | `requireFeature` off `saveDocuments` | L7 ("expected 200 to be 404") |
| LM4 | `requireWholeCompany` off `saveDocuments` | L8 (200 instead of the scope refusal) |
| LM5 | the tab save writes the body as the whole row | L3 (the row's documents undefined) |
| LM6 | `.for("update")` off `lockGroup` | L13 ("expected 'CO' to be 'WY'": a lost update) |
| LM7 | the tab save's audit entry removed | L3 ("one audit entry per save: expected [] to have a length of 1") |
| LM8 | `dec(v).lte(100)` off `isPercent` | LR4 ("100.5: expected null …"); L4 |
| LM9 | `PERCENT_TEXT` → `/^\d+(\.\d*)?$/` | LR4 ("12.: expected null …"); L4; LD1 |
| LM10 | `overtimeRuleProblem` off `payrollProblem` | LR5; L6 (200 instead of 400); LD12 |
| LM11 | the equal-prefix check off | LR4; L4; LD4 |
| LM12 | `isReadable`'s module test off | LR3 ("hr owner: [documents, payroll]"); L1 hr owner |
| LM13 | `isReadable`'s readers test off | LR3 ("installer: [documents, payroll]"); L1 flooring installer |
| LM14 | `servedTabs` copies the whole answer | W2 (DemoStore's localization replaced) |
| LM15 | `updateLocalization` routes every tab | LW6 ("region: expected [ … ] to deeply equal []") |
| LM16 | DemoStore's tab rule → the section's any-of | LD6 (the tax-only role saved documents) |
| LM17 | `assertSettingsSave`'s module check off | LD8 (Harbor saved documents) |
| LM18 | a missing row is inserted instead of 409 | L2 ("documents: expected [ 200 ] … [ 409 ]") |
| LM19 | `.strict()` off `DOCUMENTS_INPUT` | L4 (an unknown field answered 200) |
| LM20 | `Number.isInteger` off the day checks | LR4 ("2.5: expected null …"); L4; LD5 |
| LM21 | the whole-section branch back to the overtime rule only | LR6; LD13 |
| LM22 | `answer` gives the whole stored row | L1 ("[currency, documents, …(3)]") |
| LM23 | the exact waste-category check off | LR4, L4, LD3 (the waste message instead of "Give a default waste for each product category.") |
| LM24 | the holiday state check off | LR5 ("XX: expected null …"); L6; LD12 |
| LM25 | `assertSettingsSave` checks the keys before the module | LD8b (the role message instead of the module's) |
| LM26 | the footer length check off `documentsProblem` | LR4; LD4. L4 stays green, as planned: Zod's bound carries the same words |
| XM1 | the API dispatch's `default` → `break` | X2 ("promise resolved { expenses: … } instead of rejecting") |
| XM2 | the web merge's `default` → `break` | X3 ("expected [Function] to throw an error") |

## Stages 0 to 2: outcome
- **Commits, all pushed:** `f8010ca` (stage 0: this log and the spec), `dd2bbe6` (the exhaustive dispatch, red first), `afb85a2` (2a: shared and API), `26a3c3e` (2b: web), `6f2b060` (2c: the e2e specs), then this log.
- **Product files (13, as planned):** new `packages/shared/src/settings/localization-rules.ts`; changed `sections.ts`, `section-rules.ts`, `index.ts`; the settings controller, service and input; `contract.ts`, `api-methods.ts`, `settings-answer.ts`, `store.ts`; `documents-page.tsx` and `localization-page.tsx` (one line each). `settings.service.ts` and `settings-answer.ts` also carry the exhaustive dispatch, and `sections.ts` its `unservedSection`, so the dispatch added no file.
- **Tests:** new `apps/api/test/settings-dispatch.test.ts` (X1, X2), `apps/web/tests/unit/settings-dispatch.test.ts` (X3), `packages/shared/test/localization-rules.test.ts` (LR1 to LR7), `apps/api/test/settings-localization.int.test.ts` (L0 to L16, 27 cases), `apps/web/tests/unit/demo-localization.test.ts` (LD1 to LD13, LD8b), `apps/web/tests/e2e-api/settings-localization.spec.ts` (E1, E2); changed `settings-answer.test.ts` (LW1 to LW6; B3), `api-rereads.test.ts` (152 and 109), `tests/e2e/settings.spec.ts` (S2, S3), `flows/checks.ts` and part 1's `tests/e2e-api/settings.spec.ts` (the helpers moved, B4).
- **No stop-and-ask item came up:** the time zone isn't touched, `document_sequences` isn't changed, nothing is seeded at provisioning, and nothing in packages/db, core, auth, tenancy, providers or the control database changed.
- **Left (stages 3 to 5):** the green api-mode run (`settings2-green --build`, then `settings2-again` and `settings2-flows`), the demo subset, the docs (ADR 0059's dated section, api-contract, sales.md and hr.md, data-model, the delta row, FEATURES and the features sync test), the full checks, both whole suites, `/review` and the security review (section "Security-review focus" of the PR body), and the handoff. The e2e specs E1, E2, S2 and S3 have been run only red so far.

## Stages 3 to 5: outcome
- **Commits (all pushed, all `[skip ci]`):**

  | Commit | Subject |
  | --- | --- |
  | `f8010ca` | docs(settings): plan for Settings part 2a on the API |
  | `dd2bbe6` | fix(settings): GET /settings and the web merge name every served section |
  | `afb85a2` | feat(api): Settings part 2a, PUT /settings/localization/documents and /payroll with one key per tab |
  | `26a3c3e` | feat(web): Localization and Sales and documents save one tab at a time; documents and payroll on the API |
  | `6f2b060` | test(e2e): Settings part 2a specs, red on part 1's head; the green run is stage 3 |
  | `74111c0`, `9a783c7` | docs(sessions): Settings part 2a, stages 0 to 2; the product file count |
  | `dca6d3b` | test(e2e): Settings part 2a round-trips through the API and the builder follows (B10) |
  | `dcb2c56` | style(web): DemoStore's assertCan keeps its own JSDoc (B12) |
  | `0a5b01c` | docs: Settings part 2a on the API (ADR 0059 section, api-contract, specs, delta, data model, FEATURES) |
  | this commit | docs(sessions): Settings part 2a outcome, full checks and the api-mode suite |

- **Stage 3:** E1 and E2 green in api mode (E1 about 10 s, E2 about 4 s), again on the dirty database, and next to part 1's E1 to E3, sales, invoices, purchasing, company and login; the eight flow tests green; the demo subset green (271 tests, S2 and S3 among them). The only red was E1's own test mechanics (B10); no product code changed for it. B11's throwaway mutation proved E1's builder step on screen.
- **Stage 4:** ADR 0059's dated part 2a section, api-contract's "Settings, part 2a" and its rows, sales.md, hr.md, data-model, the delta row and the FEATURES note; the features sync test passes. The spec's edits were made in stage 0.
- **Stage 5 (this session's part):** the full checks and the whole api-mode suite after the last product change (`dcb2c56`, a comment move) are green (commands table). The whole demo suite, `/review`, the security review (focus: the PR body's "Security-review focus") and the handoff are the orchestrator's next steps; STATUS and BRANCHES are untouched (D18).
- **No stop-and-ask item came up** in stages 3 to 5: no time zone, no `document_sequences` change, no seeding, nothing in packages/db, core, auth, tenancy, providers or the control database.
- **Left or doubtful:**
  - The refusal toast over the sticky bar (B10) is recorded under "For STATUS"; it is part 1's behaviour and was seen in api mode only.
  - Local runs leave data on the 5433 database: per E1 run a customer `E2E Docs <run>` and Priya's draft quote (the proof run left only the customer).

## Review round 1
Two findings, both confirmed by a skeptic, both fixed in `3b641ef`. No stop-and-ask item came up: no time zone, no `document_sequences` change, no seeding, nothing in packages/db, core, auth, tenancy, providers or the control database.

### R1-1 (blocking): an invoice prefix of `CR-` broke credit notes for good
Credit notes are rows of `invoices`, numbered under the fixed `CR-` from 5001 in the one `invoices_number_uidx`, but their next number was read from credit notes only, while an invoice's is read from every row. This branch made `invoicePrefix` savable on the API, and `prefixProblem` only compared the three page prefixes. With `invoicePrefix: "CR-"`, the next invoice and the next credit note both computed `CR-5002`, so the note's insert hit the unique index and the API answered 500. Reverting the prefix didn't help: the posted invoice `CR-5002` is immutable (rule 9), so every later credit note computed the same number. D4 ("numbers are unique per table, so this isn't integrity") was wrong for invoices.
- **Fix.** `CREDIT_NOTE_PREFIX` ("CR-") and `FIRST_CREDIT_NOTE` (5001) moved to packages/shared (`localization-rules.ts`, next to `DOCUMENT_PREFIX_TEXT`); `invoices.service.ts` and the demo's `commission-actions.ts` import them. `prefixProblem` refuses a quote, invoice or PO prefix that starts with `CR-` in any case, with its own words: "Credit notes are numbered CR-; choose a prefix that doesn't start with CR-." Both modes refuse it the same way.
- **Defence in depth.** The API and the demo number a credit note from every invoice number, as `takeInvoiceNumber` does, under the same advisory lock. An import, a legacy row or a prefix saved before this change can no longer make the two series collide. `nextNumber` then can't return a number already used: any used number that starts with the prefix is counted.
- **Tests.** LR4: `CR-`, `cr-`, `Cr-5` and `CR-INV` refused for each of the three prefixes, and `CR` (no hyphen) accepted. L4 on the API: `CR-`, `cr-` and `CR-5`. LD4 in the demo: `CR-` and `cr-`, with nothing stored. Two cases are new. "numbers a credit note past every CR- number…" in `invoices.int.test.ts` renames an invoice to the number the notes alone would take next, then issues a note: 201, one number higher. CN1 (new `apps/web/tests/unit/demo-credit-note-number.test.ts`) does the same in the demo through `issueCreditNote`. S2 in the demo e2e shows the refusal on screen.

### R1-2 (should fix): the API's outer bounds answered in Zod's English, and the footer's bound jumped the rule's order
- **Fix.** Each outer `max` in `DOCUMENTS_INPUT` and `PAYROLL_INPUT` now carries its field's shared words:
  - the terms, late fee, deposit and the three prefixes use `DOCUMENT_MESSAGES`;
  - a waste value uses its category's words through Zod's `error` function, which gets the issue's path (checked on Zod 4.6.7), and a key that isn't a category gets "Give a default waste…";
  - a waste key past 40 characters gets the categories' words;
  - the overtime rule uses the new `OVERTIME_RULE_MESSAGE`, which `overtimeRuleProblem` now returns and `PAYROLL_MESSAGES.overtimeRule` points to;
  - the holiday state uses `PAYROLL_MESSAGES.holidayState`.
- **The footer.** Its outer bound is now `10 × LEGAL_FOOTER_MAX`, so `documentsProblem` names a long footer in its own order. A long footer together with a late fee of `12.` now names the late fee in both modes.
- **The page.** Its prefix inputs stop at `DOCUMENT_PREFIX_MAX` (10), and its percent and waste inputs at `PERCENT_TEXT_MAX` (12). Both constants are new in packages/shared, and LR8 pins each to the longest text its pattern takes, so a valid value is never cut. From the screen, every refusal is the shared rule's, in its order, in both modes.
- **Docs.** api-contract.md's "Bodies" line no longer overclaims. It says the shape is checked first with the field's words, and that only a direct caller who sends a string past an outer length together with another problem can see a different field named.
- **Tests.** L4 adds 21-character quote, invoice and PO prefixes, a 22-character late fee, a 21-character deposit and terms, a 21-character carpet waste (its category's words), a 21-character value under an unknown key (the categories' words), a 10,001-character footer, and the combined late fee and footer case. L6 adds a 21-character overtime rule and holiday state. S2 checks the inputs' `maxlength`.

### Decisions (round 1)
- **R1-D1, starts with, not equals.** The finding asked to refuse a prefix equal to `CR-`. A prefix that starts with it (`CR-5`, `CR-INV`) numbers documents that read as credit notes, such as `CR-51001`. Refusing every such prefix, in any case, is the safer reading. `CR` without the hyphen numbers `CR1001` and stays allowed.
- **R1-D2, the constants live in `localization-rules.ts`,** next to `DOCUMENT_PREFIX_TEXT`, as the finding asked. Both call sites keep calling `nextNumber`, so no new helper was added. The fixture generator (`packages/shared/scripts/fixtures/sales.ts`) keeps its literal `CR-`, because it only writes demo data.
- **R1-D3, payment, refund and supplier prefixes may still be `CR-`.** They number other tables (payments, refunds, bills), so no number index is shared. This is still open as owner question Q2.
- **R1-D4, the waste value gets its category's words on the API** rather than Zod's, through Zod's `error` function. The finding only asked for `maxLength` on the page, but this way every outer length carries shared words and the contract can say so without an exception.
- **R1-D5, the footer's bound was raised, not documented.** The finding allowed either. Raising it makes the order the same as the demo's for any footer a person can type. A footer past 10,000 characters still gets the footer's words.
- **R1-D6, the delta row was amended, not added.** The plan of record's rule list for part 2a gains the `CR-` reservation and the credit-note numbering, in the existing 2026-11-17 row. sales.md rule 22, commissions.md rule 16, the settings spec, ADR 0059 and api-contract.md were updated to match.

### Mutations (round 1, on `3b641ef`; `settings2/mutate-r1.py`, about 1.5 minutes)
| # | Mutation | Caught by (first failure) |
| --- | --- | --- |
| RM1 | the `CR-` check off `prefixProblem` | LR4 ("quotePrefix CR-: expected null to be 'Credit notes are numbered CR-…'"); L4 ("expected [ 200, undefined ] to deeply equal [ 400, 'invalid_request' ]"); LD4 (the save resolved) |
| RM2 | the API's credit notes numbered from the notes alone again | the new `invoices.int.test.ts` case: "internal_error … expected 500 to be 201" (the finding's failure, reproduced) |
| RM3 | the demo's credit notes numbered from the notes alone again | CN1 ("expected 'CR-5008' to be 'CR-5009'") |
| RM4 | the documents' outer bounds without their words | L4 ("expected 'Too big: expected string to have <=20…' to be 'Use 1 to 10 letters…'") |
| RM5 | the payroll bounds without their words | L6 |
| RM6 | the footer's bound back to 1,000 | L4 ("expected 'Keep the legal footer…' to be 'Enter the late fee…'") |
| RM7 | a waste value's bound without its words | L4 ("expected 'Too big…' to be 'Enter the waste for Carpet…'") |

Every file was restored (`git diff --quiet`). The `maxlength` attributes are pinned by S2 and were not mutated, because that would need another demo build.

### Commands (round 1)
| Command | Result |
| --- | --- |
| `prettier --write` twice, then `--check`, on the 13 files | clean |
| `vitest run test/localization-rules.test.ts test/quotes.test.ts` (shared) | exit 0, 20 passed |
| `checks.sh r1` shared, api and web typecheck and lint | all exit 0 |
| `vitest run` web `demo-localization`, `demo-credit-note-number`, `api-rereads` | exit 0, 22 passed |
| `vitest --project integration settings-localization.int.test.ts invoices.int.test.ts` | exit 0, 38 passed, 15 s |
| `heavy.sh python3 settings2/mutate-r1.py RM1 … RM7` | all 7 caught, every file restored, 88 s |
| `api-e2e.sh settings2-r1 --build -- settings-localization, settings, invoices, sales, purchasing` (e2e-api) | exit 0 after 60 s (builds 13 s): 15 passed |
| `e2e-demo.sh r1` (a new mode: demo build, then settings, credit-notes, invoice-lifecycle, quote, waste; one worker) | exit 0: 16 passed in 34 s (S2 with the `CR-` refusal and the `maxlength` checks among them) |
| `full.sh` (lint, typecheck, test, test:api, test:hooks) | all exit 0 in 4 min 27 s: shared 1,144, web 391, api unit 126, db 18, providers 11; test:api: api 724, db 59, providers 2; hooks green |
