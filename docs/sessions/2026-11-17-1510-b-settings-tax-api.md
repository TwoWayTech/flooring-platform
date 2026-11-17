# Session 2026-11-17 15:10, B (Claude): Settings part 3a on the API: the Sales tax tab with versioned rules (queue item 2, task 2)

Person: B (Claude), on B's Mac. Branch `feat/settings-tax-api`, base `cfb907f` (the handoff head of Settings part 2b, `feat/settings-region-currency-api`, draft PR #53, review clean). Main is `d0e4e20`. This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

**Stacked on PR #53.** Part 2b (#53) is stacked on part 2a (#52), part 1 (#51), and through them on GET /company (#50), B6 (#49), B5 (#48), B4 (#47), B1 (#46) and B3 (#45). None can merge yet: GitHub Actions is blocked by a billing problem on the account. The orchestrator chose, as the safest option, to cut this branch from 2b's handoff head with `git switch -q --no-track -c feat/settings-tax-api origin/feat/settings-region-currency-api`, so that STATUS and BRANCHES stay linear and the files 2b and 3a share (`localization-rules.ts`, `sections.ts`, the settings module, `localization-page.tsx`, 2a's and 2b's tests, ADR 0059, api-contract.md, the spec, FEATURES) can't conflict later (D22). The PR must merge after #45 to #53; when they merge, the orchestrator merges `origin/main` into this branch.

**Part 3 is split: this PR (3a) is 15 product files, 2 of them comments only; the whole-section retirement (`updateSettings("localization")`'s any-of keys) is part 3b (D29).**

## Prompt

### The owner's queue (verbatim)
> Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
> 2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
> 3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
> 4. Then stop and hand off. Don't start P13; the owner does a click-through first.

This session is item 2, task 2, "then Settings", part 3a: the Sales tax tab of Localization and tax moves to the API. `PUT /settings/localization/tax` with `settings.tax.manage` and always a step-up after the content checks, under the row lock. A changed or removed state rule or county rate ends every live row of it reaching the company's day (`valid_to` the day before), and a changed or new one starts that day, a changed state rule taking `max(version) + 1` over every row. County rates are matched by state and county, never by a body id. `TAX_RATE_TEXT` is compared by value. `GET /settings` answers the tax in force on the company's day to quote viewers and tax managers, so the quote builder's preview follows the server. The newest-row tie is broken by version, then id. No row is edited except to close it, none deleted. Security review required (tax, money, history).

### Per-task rules (owner)
- Read the blueprint prompt first: P11 in docs/real-build-plan.md ("Each module follows prompt P11"), the product spec (docs/product-spec/settings-and-permissions.md) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why". Add a docs/blueprint-delta.md row only if the plan of record changes.
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- CLAUDE.md rules apply: rule 1 (screens only through the ApiClient), rule 2 (the company from the verified session), rules 3 and 4 (deny by default, permissions only from packages/shared), rule 6 (decimal strings), rule 8 (rates are numeric(18,8)), rule 9 (posted documents are never edited; history kept), rule 10 (audit), rule 12 (no hard-coded tax), JSDoc on exports, no dead code, no duplicated logic.
- If a stop-and-ask item comes up (a versioned company default, storing an accepted quote's tax, a county version in invoice snapshots, any other schema change, or 3a growing past 16 product files), stop and report it instead of building it.
- STATUS and BRANCHES are left to the orchestrator's handoff; what they need is under "For STATUS" below.
- **This laptop (8 GB):**
  - Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `gh pr merge`, or `rm -rf`.

### The problem as recorded
- In api mode the Sales tax tab saves through `updateLocalization("tax")`, which 2a's routing keeps on DemoStore, so it saves in the browser only, while the server taxes every quote, invoice, contract billing and retainage release from its own `tax_rules` and `tax_jurisdictions`, which nothing on the API writes but the seed.
- The quote builder's tax preview reads the API's states of operation (2b) but DemoStore's tax rules.
- docs/STATUS.md B6: "The Settings move: tax rule and county `ratePct` are numeric(18,8) and answered raw; their write check must use the shared pattern (Settings part 3)."
- ADR 0059 "Later parts" row 3: "A changed rule is a new `tax_rules` version; county rates in `tax_jurisdictions`; a shared tax-rate text compared by value. Security review (tax)."

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (spec, failing tests, endpoints with guards and audit, the screen, the security review, the PR, the handoff), module order row 4 (Settings), and the CI budget.
  - `.claude/commands/feature.md` steps 1 to 9.
  - docs/product-spec/settings-and-permissions.md: "Who uses it", rule 7 (the per-tab table), rule 22, rule 23 (step-up), rule 25 (tax rule resolution), "CompanySettings" `localization.tax`, `TaxRule`, `JurisdictionRate`, `CompanyDefaultRate`, the audit table, "Edge cases and known limits", "Real build" parts 2a and 2b, "Known limits in api mode".
  - docs/product-spec/sales.md: rules 13 to 20 (15 which rule applies; 18 invoices keep the tax they used; 19 conversion sets the quote's total), "Settings that drive this module", the audit table.
  - The blueprint's "Localization, currency and tax settings" (pp. 20-22): the Sales tax row, rule 1 ("every rate and rule has a valid-from and valid-to date; each posted document stores the rate and rule version it used, so changing a setting never alters history"), rule 4 (base currency and tax changes need step-up MFA and are audited), the company tables `tax_jurisdictions`, `tax_categories`, `tax_rules`.
  - ADR 0059 (part 1, "2026-11-17: part 2a", "2026-11-17: part 2b"), 2a's and 2b's session logs (2b's D1 to D23 and build decisions B1 to B13), ADR 0037 (sales tax engine), ADR 0013 (derived, never stored); docs/api-contract.md "Settings, part 2a" and 2b's section; docs/data-model.md "Settings groups"; docs/FEATURES.md rows `settings.localization` and `auth.step-up`.
- **The code at `cfb907f`:**
  - **Shared:** `decimal-text.ts` (`PERCENT_TEXT`, `FX_RATE_TEXT`, `sameOptionalDecimal`), `us-pack/tax-defaults.ts` (`resolveTaxRule`, `validOn`, `newest`, `countyKey`, `companyRule`), `us-pack/tax.ts`, `us-pack/states.ts`, `settings/localization-rules.ts`, `settings/sections.ts`, `types/settings.ts`, `dates.ts`.
  - **API:** `modules/settings/settings.controller.ts`, `settings.service.ts`, `settings-input.ts`; `modules/sales/sales-records.ts` (`loadLocalization`), `sales.service.ts`, `invoices.service.ts`, `contract-billing.service.ts`, `sales-common.ts` (`companyClock`, `dayIn`); packages/db `company/organization.ts` (`tax_rules`, `tax_jurisdictions`) and the seed.
  - **Web:** `features/settings/localization/localization-page.tsx`, `tax-tab.tsx`, `tax-defaults-section.tsx`, `simple-tabs.tsx`; `features/settings/form/settings-form.tsx`, `save-section.ts`, `registry.ts`; `lib/api/demo/store.ts` (`updateLocalization`); `lib/api/http/api-methods.ts`, `settings-answer.ts`; `features/sales/quote-builder.tsx`.
  - **Tests:** shared `localization-rules.test.ts`, `region-currency-rules.test.ts`, `access-rules.test.ts`; api `settings-localization.int.test.ts`, `settings-region-currency.int.test.ts`, `contract-billing.int.test.ts`, `auth-harness.ts`; web `settings-answer.test.ts`, `demo-localization.test.ts`, `region-currency-forms.test.tsx`; e2e `tests/e2e-api/flows/checks.ts`, `flows/kit.ts`, `tests/e2e/settings.spec.ts`, `tax.spec.ts`, `localization.spec.ts`.
- **Planning:** a first plan, a critic's review (four must-fix items M1 to M4 and seventeen should items S1 to S17) and a final plan that applies them, written against 2b's stage 2 code (`c758d74`, log `d04e0a1`). The plans live in the session scratchpad, not in the repo, so the plan is restated below.

### Differences from the plan found in stage 0 (2b's head `cfb907f`)
- **2b finished after the plan was written:** its e2e specs (Z1, Z2), docs, outcome and handoff (`1f03d72`, `f0f37a2`, `f254efe`, `cfb907f`). The preconditions hold: 2b's dated ADR section exists ("## 2026-11-17: part 2b, Region and Currency"), 2a's head is an ancestor, PR #53 is a draft.
- **No product code changed after `d04e0a1`:** `git diff --stat d04e0a1 cfb907f` touches only `tests/e2e-api/settings-region-currency.spec.ts` and docs. So every 2b name the plan builds on (section 1.7: `SettingsService(tenancy, auditLog, control)`, `answered`, `pickTabs`, `settingsMissing`, `saveLocalizationTab(tenant, actor, tab, settle)`, `localizationTabProblem(tab, value, current, holds)`, `localizationTabStored`, `HoldsKey`, `LocalizationTabInput`, `regionCurrencyForms`, DemoStore's `updateLocalization`) is as the plan read it.
- **The earlier tests the plan changes (7.8) are where it says,** by text: L0 (`:336`), L1, L9 (`:694`), L14 (`:831`), L16 (`:848`, "Sales tax and the whole section are not routes"), RC1 (`:384`), LR2 (`:120`), LR3 (`:127`), LR6 (`:221`), RG7 (`:198`), W2 (`:82`), LW6 (`:196`), LW1, RW1 and W6 unchanged. Every edit is anchored on text.

## Plan (short)

### Shared (packages/shared; plain functions, no Zod, no dependency)
- `decimal-text.ts`: `TAX_RATE_TEXT` (up to two digits and four decimals by value, then only zeros up to eight: below 100) and `TAX_RATE_TEXT_MAX` (11).
- `us-pack/tax-defaults.ts`: `countyKey` exported; `newest` breaks a `validFrom` tie by the higher version, then the higher id (D26); new `taxInForce(tax, day)`: per state the rule in force, per county the rate in force, sorted by state, then county.
- **New `settings/tax-settings.ts`:** `TaxBlock`, `TaxRuleInput`, `JurisdictionInput`, `TaxInput`, `TAX_ROUNDINGS`, `TAX_PRICES_APPLIED`, the length limits, `TAX_MESSAGES` (no key matches the sensitive-field scan: `rulePercent`, `countyPercent`), `taxProblem(next, current)`, `closesOn(day)`, `taxBlock(tax)`, `TaxChanges` and `taxChanges(next, current, day, { latest, makeId })`.
- `settings/localization-rules.ts`: the two dispatchers' Sales tax branches (`taxProblem`; `taxChanges(...).after`), `LocalizationTabInput.tax`, `localizationProblem`'s JSDoc. `settings/sections.ts`: `API_LOCALIZATION_TABS` gains `tax`; `LOCALIZATION_READERS.tax` = quote viewers and tax managers, not hidden by the page switch. `index.ts`: one export line.

### The API (the settings module; nothing in core)
- `PUT /settings/localization/tax`: `settings.tax.manage` from `LOCALIZATION_TABS` (`platform`, no module guard), the switch (404), scope `all` (403), the strict `TAX_INPUT` body (400), then under the row lock: no row or no tax block (409), `taxProblem` against the tab in force (400), always a step-up (403), then close and insert rows, store the block without the tables, one audit entry, and answer the tab now in force, read back.
- `SettingsService.saveTax`: the company clock before the transaction; every live row read under the lock; `latest` = `max(version)` per state over every row (soft-deleted ones too); `taxChanges` decides; ended rows get `valid_to` = the day before and nothing else; new rows are inserted with server uuid v7 ids. `answer` answers `localization.tax` as `taxInForce` of the block with its tables on the company's day.

### The web
- `tax-tab.tsx`: a pure `taxForm(current, original, holds)` (the shared rule before the code, Reset keeps filing and certificate types, a `revision` that remounts the form after a save); prices and dates read only; inputs stop at their rule's length; one line on what a change does.
- `tax-defaults-section.tsx`: dates read only, input lengths. `localization-page.tsx`: spreads `taxForm` onto the Sales tax form with `key={revision}`. `registry.ts`: three helper texts. Two comment-only edits in the transport (no logic change: it loops over `API_LOCALIZATION_TABS`).
- DemoStore: no change; its `updateLocalization` runs the shared dispatchers, which gain their Sales tax branches.

### Tests (red first)
- **Shared** SR1 to SR8 (`tax-settings.test.ts`); LR2, LR3, LR6, RG7 updated.
- **API** ST0 to ST20 with ST5a (`settings-tax.int.test.ts`, its own companies); L0, L1, L9, L16, RC1 updated.
- **Web unit** TW1, TW2 (`settings-answer.test.ts`, W2 updated, LW6 removed); TD1 to TD10 (`demo-tax.test.ts`); TP1 (`tax-form.test.tsx`).
- **Api-mode e2e** TE1, TE2 (`tests/e2e-api/settings-tax.spec.ts`). **Demo e2e** S7, S8 in `tests/e2e/settings.spec.ts`.
- **Mutations** TM1 to TM40 (TM26 is 3b's) on the committed change.

### Stages (one commit each, pushed)
0. This log and the spec (docs only), the draft PR.
1. Red tests, no product code (one commit), then the red e2e runs on 2b's product code.
2. The change (shared, API, web), green, committed; the mutations on the committed change; this log.
3. Api-mode and demo e2e (green). 4. Docs. 5. Full checks, both suites, reviews, handoff (later stages, run by the orchestrator's next steps).

## Decisions and why
Planned decisions, each the safest option found. Decisions taken while building go under "Decisions taken during the build".

- **D1, scope:** Sales tax on the API, one PR, 15 product files (1 new, 2 comment-only); the whole-section retirement is part 3b (D29).
- **D2, a change is a new row; a row is never edited except to close it, and never deleted** (blueprint p21 rule 1; CLAUDE.md rule 9's spirit). Changed or new rows start on the company's day; the rows they replace end the day before. Issued invoices keep their snapshot, rate included; nothing re-taxes them. A state-rule snapshot's version names its row; a county or company-default snapshot keeps its rate with the state rule's version or 1 (R15, Q10). A quote's stored total follows the day it is saved, sent or converted: converting an accepted quote after a change overwrites its stored total with the new invoice's (sales.md rules 18 and 19; existing, intended).
- **D3, the day is the company's** (`companyClock`, control `tenants.time_zone`), read once per save; DemoStore uses its `todayIso`. A row changed again on the day it started is closed the day before it started (an empty range): the invoices issued under it that day keep its rate and version in their snapshot; day-granular rows can't hold two rates for one day (R3).
- **D4, dates and versions are the save's.** The sent `validFrom`, `validTo` and `version` are taken for their shape only, as 2b's `asOf`; the tab shows them read only. No back-dating or scheduling (Q1).
- **D5, Sales tax stays module `platform`.** Every company database has the tables; an HR Suite company's rules drive nothing. Making it `core` would show HR Suite Owners a tab whose every save is refused (Q4).
- **D6, "changed" is by value and by identity in force:** a state rule by state, a county rate by state and county (D25); rates through `sameOptionalDecimal`. No id a body sends ever selects a row, so a body can never reach a row of another company or a closed one.
- **D7, readers:** `sales.quote.view` (the builder) and `settings.tax.manage` (the tab), not hidden by the page switch; answered in force on the company's day (the block plus the rule and county rows in force), never the block alone.
- **D8, the answer and the audit are read back** after the writes, in the transaction.
- **D9, whether prices include tax can't be turned on** (refused in both modes, read only on the tab): nothing applies `"inclusive"` (`computeTotals` adds tax on top), so the setting would mislead (Q3). See D28.
- **D10, filing frequencies and certificate types are fixed** (no screen edits them; refused unless equal).
- **D11, the company default stays in the jsonb block,** dated the company's day when it changes; its earlier values are in the audit log; its snapshot version stays 1. Versioning it needs a table or column: left out (Q2, a stop-and-ask item).
- **D12, always a step-up on the API,** after the content checks, under the lock, whatever `auth.step-up` says (blueprint p21 rule 4; Payments, Currency). Even a save that changes nothing (Q6).
- **D13, every check runs against the locked row** (2b's settle pattern); version numbers are taken under the same lock, and the `(state, version)` unique index stays the backstop.
- **D14, one audit entry per save,** "Changed localization and tax", target "Sales tax", `before`/`after` the tab in force. It covers the rows closed and inserted (rule 10).
- **D15, 409 `settings_missing`** for a company without the localization row or without its tax block (the rule compares the block).
- **D16, moved to part 3b** (the whole-section path).
- **D17, the demo keeps only what is in force.** It versions through the same `taxChanges` (a changed rule: the next version from today; a changed county rate: the same id from today; ended rows go); a re-added state starts at version 1 there, while the API continues the state's numbering. Its history is the audit log and each invoice's snapshot.
- **D18, rates:** `TAX_RATE_TEXT` (0 to 99.9999 by value; up to 8 decimals, zeros after the fourth), answered raw from numeric(18,8) (STATUS B6).
- **D19, county rates without a rule under them are allowed** (inert, as `resolveTaxRule` treats them); duplicates by state and county (`countyKey`) are refused (Q7).
- **D20, the page's rules are a pure function in the tab-body file** (`taxForm` in `tax-tab.tsx`), unit-tested (TP1), as 2b's D20.
- **D21, Reset to default keeps** filing frequencies and certificate types from the company's own copy; whether prices include tax takes the original's (`"exclusive"`; D28).
- **D22, process:** stacked on 2b (#53), the orchestrator's safest-option decision while CI is blocked by billing; no test-writer subagent (this session runs as a subagent without one, so the builder writes the API and Playwright tests from the final plan, as parts 1, 2a and 2b did); STATUS and BRANCHES are the orchestrator's; no `gh pr ready` or `gh pr merge`.
- **D23, earlier tests that part 3a changes** are updated in stage 1, each with a line in this log.
- **D24, per-file API test helpers** (2a's D17, 2b's D22): the ST file copies them; the sweep stays a STATUS follow-up.
- **D25, county rates are matched by state and county** (`countyKey`), never by id: a second save without reopening the page, and Reset to default in api mode (the fixture's ids), keep unchanged rows as they are. The id is the row's name in the answer and the page's key; the API never stores a sent id; DemoStore keeps the sent id of a new row.
- **D26, a change or removal ends every live row that reaches the company's day** for that state (or state and county), rows dated later included; ties of `validFrom` resolve by the higher version, then the higher id, in `resolveTaxRule` and `taxInForce` alike, so the tab shows the row the engine uses. Saves never create overlaps; only rows written outside the API can (R7).
- **D27, the Sales tax form remounts when the tab in force changes** (`key={revision}`), so after a save it shows the dates, versions and ids the save stored, and a second save sends them.
- **D28, whether prices include tax may change only to `"exclusive"`** (`TAX_PRICES_APPLIED`), the way documents apply tax; a change to `"inclusive"` is refused. Saved demo data with `"inclusive"` can be put back (Reset, or a direct save); the API's rows are all `"exclusive"`.
- **D29, split:** 3a (this PR) the Sales tax save; 3b the whole-section retirement, on `feat/settings-localization-section` stacked on 3a. 3a leaves `updateSettings("localization")` as 2b left it (DemoStore only, no screen): it can still store a whole tax block unversioned in the demo until 3b.
- **D30, the body requires `filing`, `certificateTypes` and `companyDefault`** (null for none). A stored block without one (only hand-made rows: the seed, the fixtures and the test helpers have them, and nothing provisions the row) can't be saved on the tab until repaired. DemoStore's rule reads a missing list as none, for saved demo data older than the lists.
- **D31, no stale-page refusal:** a page left open saves its view back, which can revert another person's change (both audited), as every settings section does. A 409 on a version or id mismatch was not taken: it would refuse Reset to default in api mode after any change and still couldn't tell a removed row from a new one (Q9).
- **D32, outer bounds as 2b landed them** (2b's D23 and B4): fixed words carry the bound; jurisdiction, name, rates and note (words that name a state or county) and the never-stored `id`, dates and version take none; the JSON body limit bounds the request.

### Decisions taken during the build
(Filled in during stages 1 and 2.)

## Owner questions
None blocks; each has its safest default taken.
- **Q1, effective dates.** Taken: a change takes effect on the company's day of the save; the tab's dates are read only; no back-dating or scheduling. Allow a future start date (scheduling a known rate change)?
- **Q2, the company default's history.** Taken: it stays in the settings row, dated when it changes, with its earlier values in the audit log; invoices taxed by it keep their rate. Version it in its own table (a schema change)?
- **Q3, tax-inclusive prices.** Taken: shown, can't be turned on (it can go back to "before tax"), because nothing applies it. Build inclusive pricing, or remove the setting?
- **Q4, Sales tax for the HR Suite.** Taken: `platform`, so an HR Suite Owner can still save tax rules that drive nothing. Make it `core` and hide the tab there?
- **Q5, who reads tax.** Taken: quote viewers and tax managers. Widen (for example to invoice viewers) when a screen needs it?
- **Q6, step-up.** Taken: always, even for a save that changes nothing (as Payments and Currency). Only when something changed?
- **Q7, county rates without a rule under them.** Taken: allowed (they apply nowhere until a rule exists). Refuse them, or warn on the tab?
- **Q8, accepted quotes and a rate change.** Taken: conversion taxes under the conversion day's rule and the quote's stored total becomes the invoice's (sales.md rules 18 and 19), so the total the customer accepted is overwritten; the builder previews today's rule for a sent or accepted quote. Keep, or price an accepted quote's tax at acceptance (needs the quote to store its tax: a schema change)?
- **Q9, a page left open.** Taken: last save wins, both audited, as every settings section. Refuse a save made from a stale page (a version check; Reset to default would then need the page's current versions)?
- **Q10, snapshot versions for county and company-default rates.** Taken: the invoice keeps the rate; its version names the state rule (or 1). Add a county version or id to the snapshot (a schema change)?

## For STATUS
The orchestrator applies these at handoff (re-read STATUS first and anchor on the quoted text). This PR is #<n> (filled in below once opened).
- **"In progress" and "Next three tasks" item 2:** after 2b's "(part 2b: draft PR #53, …)", add "part 3a Sales tax (draft PR #<n>, `feat/settings-tax-api`, stacked on #53); part 3b retires the whole-section save next".
- **"Done"** (on merge): "Settings part 3a on the API (queue item 2, task 2), PR #<n> (ADR 0059, 2026-11-17 part 3a section). In api mode Localization's Sales tax tab saves on the API (`PUT /settings/localization/tax`, `settings.tax.manage`, platform, scope `all`, a strict body, the shared rules in both modes against the locked row, always a step-up after them, one audit entry). A changed rule or county rate is a new row from the company's day and every row of that state or county reaching the day ends the day before; a changed rule takes the next version of its state; county rates are matched by state and county; nothing is edited in place or deleted, and issued invoices keep their tax. Rates are `TAX_RATE_TEXT` (below 100, four decimals by value, eight written). `GET /settings` answers the tab in force to quote viewers and tax managers, so the quote builder's preview follows the server. Dates, filing and certificate types are read only; prices can't be made tax-inclusive. The form remounts after a save. No schema change, migration or dependency. Checks: <filled in at handoff>."
- **Close:**
  - B6's "The Settings move: tax rule and county `ratePct` are numeric(18,8) and answered raw; their write check must use the shared pattern (Settings part 3)." → done (`TAX_RATE_TEXT`, compared by value).
  - 2a's and 2b's "**Settings part 2b** …, then part 3 (Sales tax). The quote builder's tax preview still reads …" → done for Sales tax; keep "part 3b (the whole-section save), then Settings parts 4 to 6".
  - "Unmoved settings pages save in the browser only" → drop "Localization and tax's Sales tax tab".
  - Part 1's "**Reset to default** reads DemoStore's originals in api mode" gains "; Sales tax keeps filing and certificate types from the company's own copy, and unchanged rows stay as they are (matched by state and county) (part 3a)".
- **Keep open:** 2a's "`updateSettings("localization")` keeps the any-of keys …" → add "(part 3b; since 3a it can also store a whole tax block unversioned, DemoStore only, no screen)".
- **New follow-ups:**
  - **The company default has no versions** (jsonb): a table for it, or a version in the block, is an owner question (Q2).
  - **Snapshots name state-rule versions only** (Q10): county and company-default snapshots keep the rate; a county version or id needs a schema change.
  - **The tab shows rates at numeric scale in api mode** (`8.81000000`); trim for display without `toFixed` in UI code.
  - **The quote builder previews with the browser's day** (`api.today()`): a browser a day behind the company finds no rule for a state changed today; the `today()` task fixes it.
  - **Installation-job invoices in api mode** keep DemoStore's tax rules until jobs move to the API.
  - **The api-mode e2e adds Texas versions on every run** (each change and restore); harmless, but the shared database's `tax_rules` grows.
  - **County rates without a rule under them** are allowed (inert); a warning on the tab (Q7).
  - **API test helpers** have a fourth per-file copy (ST); the sweep stays open.
- **Owner questions:** a block "Owner questions (PR #<n>, Settings part 3a; none blocks)" with Q1 to Q10 above.
- **BRANCHES:** a `feat/settings-tax-api` row: "B (Claude)", "Queue item 2, task 2, Settings part 3a: Sales tax on the API with versions (main checkout; stacked on #53)", "Draft" then the state at handoff, the PR, "see the branch".

## Commands run
| Command | Result |
| --- | --- |
| `git status --short`; `git fetch -q origin`; `git log --oneline -12 origin/feat/settings-region-currency-api` | clean; 2b's handoff `cfb907f` on top, after `d04e0a1` its e2e, docs, outcome and handoff commits |
| `git show origin/feat/settings-region-currency-api:docs/adr/0059-settings-on-the-api.md \| grep -n "part 2b"`; `git merge-base --is-ancestor …` ; `gh pr list --head feat/settings-region-currency-api` | 2b's dated section at `:143`; `2b-holds-2a`; `[{"isDraft":true,"number":53}]` |
| `git diff --stat d04e0a1 origin/feat/settings-region-currency-api` | 11 files, only `tests/e2e-api/settings-region-currency.spec.ts` and docs: no product change after the plan's base |
| `git switch -q --no-track -c feat/settings-tax-api origin/feat/settings-region-currency-api` | on `feat/settings-tax-api` at `cfb907f` |
| `docker ps`; `lsof` on 3000 and 4000 | 5432 and 5433 up; both ports free |
| scripts `settings3/checks.sh`, `settings3/e2e-demo.sh` (from 2b's, `sed`) | written; the log folder found in all three scripts, `S[78]` in the demo one |
