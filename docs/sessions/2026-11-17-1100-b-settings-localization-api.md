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
- **D4, the three document prefixes must differ** (without case). Numbers are unique per table, so this isn't integrity: an invoice and a quote both numbered `Q-1001` would mislead customers and searches. Payment, refund and supplier prefixes may still equal them (Q2).
- **D5, the audit action stays "Changed localization and tax"** (the spec's string). The target is the tab's label, and `before` and `after` are that tab only, in both modes.
- **D6, no step-up** for Sales and documents or Payroll rules. The blueprint asks one only for base currency and tax (p21 rule 4); the deposit and prefixes aren't controls over money already taken, and payroll accepts only the federal rule while California is off (Q3).
- **D7, a company with no `localization` row:** `GET /settings` leaves `localization` out, and a tab PUT answers 409 `settings_missing`. The API never builds a row from one tab: the other tabs would be missing, and `loadLocalization`, `taxContextFor` and numbering would read `undefined`. Fail closed; seeding at provisioning stays part 1's Q4. A provisioned HR company can't set its payroll rule on the API until then, which is today's state too (`loadHrRules` already 409s).
- **D8, readers, the narrowest every screen still gets** (part 1's D3): documents to quote, invoice and PO readers and the page's managers; payroll to timesheet, HR overview, HR settings and localization key holders (every default role in a company with HR). Neither is hidden by its page switch.
- **D9, the tab dispatcher takes no `current` in 2a.** No 2a rule reads the stored tab, and the shared ESLint config fails an unused parameter. The API still reads the locked row to merge into. 2b adds `current` with its first rule that reads it, which changes the dispatcher's signature there.
- **D10, whole days, terms, waste categories, percent bounds, the holiday state and the footer length are the shared rule's,** not Zod's. Zod checks types, outer lengths and unknown top-level fields, and the footer's Zod bound carries the shared words. A refusal reads the same in both modes.
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
(Filled in as the stages run.)

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
- **"In progress" and "Next three tasks" item 2:** "then Settings" gains "(part 2a: draft PR #<n>, `feat/settings-localization-api`, stacked on #51)".
- **"Done"** (on merge): "Settings part 2a on the API (queue item 2, task 2), PR #<n> (ADR 0059, 2026-11-17 section). `GET /settings`' answer and the web merge dispatch every served section exhaustively (a `never` check), so a section neither names can't be answered as another. In api mode Sales and documents and the Payroll rules tab save on the API (`PUT /settings/localization/documents` and `/payroll`), each with its own key and module (documents `core`, payroll `hr`), company-wide scope, strict bodies and shared rules (percents 0 to 100 as quotes take them, whole days, distinct prefixes, a footer of at most 1,000 characters, the California rule refused while off), replacing only that tab under a row lock, with one audit entry naming the tab; `GET /settings` answers the documents to quote, invoice and PO readers and the payroll rule to timesheet, HR and settings readers, so the quote builder's deposit, waste and expiry, the invoice, receipt and PO footers and the timesheets' overtime rule follow the server, and a salesperson's new line matches the server's waste default; every Localization tab saves on its own with its own key in both modes (`updateLocalization`), so `settings.tax.manage` no longer saves the other tabs; DemoStore's settings saves share one module-first check. No schema change, migration or dependency; nothing in core, providers, packages/db or the web's session. Checks: …"
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
- **Owner questions:** a new block "Owner questions (PR #<n>, Settings part 2a; none blocks)" with Q1 to Q8 above.
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
