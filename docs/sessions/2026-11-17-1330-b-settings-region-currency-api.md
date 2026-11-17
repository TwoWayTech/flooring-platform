# Session 2026-11-17 13:30, B (Claude): Settings part 2b on the API: Region and Currency, the time zone read only (queue item 2, task 2)

Person: B (Claude), on B's Mac. Branch `feat/settings-region-currency-api`, base `3b1d530` (the handoff head of Settings part 2a, `feat/settings-localization-api`, draft PR #52, review clean). Main is `d0e4e20`. This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

**Stacked on PR #52.** Part 2a (#52) is stacked on Settings part 1 (#51), and through it on GET /company (#50), B6 (#49), B5 (#48), B4 (#47), B1 (#46) and B3 (#45). None can merge yet: GitHub Actions is blocked by a billing problem on the account. The orchestrator chose, as the safest option, to cut this branch from 2a's handoff head with `git switch -q --no-track -c feat/settings-region-currency-api origin/feat/settings-localization-api`, so that STATUS and BRANCHES stay linear and the files 2a and 2b share (`localization-rules.ts`, `sections.ts`, the settings module, `store.ts`, `localization-page.tsx`, `checks.ts`, 2a's tests, ADR 0059, api-contract.md, the spec, FEATURES) can't conflict later (D16). The PR must merge after #45 to #52; when they merge, the orchestrator merges `origin/main` into this branch.

## Prompt

### The owner's queue (verbatim)
> Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
> 2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
> 3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
> 4. Then stop and hand off. Don't start P13; the owner does a click-through first.

This session is item 2, task 2, "then Settings", part 2b: the Region and Currency tabs of Localization and tax move to the API (`PUT /settings/localization/region` and `/currency`, on 2a's per-tab pattern). The company's time zone is answered from control `tenants.time_zone`, read only, and refused if changed, in both modes, with no control-database write; country and locale stay as stored; a change of the states of operation also needs `settings.tax.manage` and a step-up, judged against the locked row, and the API's tax follows; Currency always needs a step-up after the content checks, keeps its base, lock and codes, takes plain rates above 0 and dates a changed rate with the company's day; every check that reads the stored tab runs inside the lock. Security review required (tax, currency, a control-database read next to tenancy).

### Per-task rules (owner)
- Read the blueprint prompt first: P11 in docs/real-build-plan.md ("Each module follows prompt P11"), the product spec (docs/product-spec/settings-and-permissions.md) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why". Add a docs/blueprint-delta.md row only if the plan of record changes.
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- CLAUDE.md rules apply: rule 1 (screens only through the ApiClient), rule 2 (the company from the verified session), rules 3 and 4 (deny by default, permissions only from packages/shared), rule 6 (decimal strings), rule 8 (rates are numeric(18,8)), rule 12 (no hard-coded rules), JSDoc on exports, no dead code, no duplicated logic.
- If a stop-and-ask item comes up (the zone editable, adding currencies, seeding at provisioning, any change under `apps/api/src/core`), stop and report it instead of building it.
- STATUS and BRANCHES are left to the orchestrator's handoff; what they need is under "For STATUS" below.
- **This laptop (8 GB):**
  - Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `gh pr merge`, or `rm -rf`.

### The problem as recorded
- In api mode Region and Currency save through `updateLocalization`, which keeps them on DemoStore (2a's routing), so they save in the browser only, while the server reads the states of operation from its own row for every quote's, invoice's and contract bill's tax.
- docs/STATUS.md: "Part 2b's time zone is a likely stop-and-ask"; "The number format's locale and currency are compared with a read taken outside the save's transaction; harmless until part 2b makes Currency editable, which must check against the locked row"; "The company's zone has two copies … Planned for Settings part 2b: answer the zone from `tenants.time_zone` and refuse a change in both modes"; "changing a company's zone would move past invoice days".
- Currency's step-up exists only on the client (`stepUp: true` on the tab).

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (spec, failing tests, endpoints with guards and audit, the screen, the security review, the PR, the handoff), module order row 4 (Settings), and the CI budget.
  - `.claude/commands/feature.md` steps 1 to 9.
  - docs/product-spec/settings-and-permissions.md: "Who uses it", rule 7 (2a's per-tab table and order), rules 22, 23 (step-up) and 25 (tax rule resolution), "CompanySettings" `localization.region` and `localization.currency`, the audit table, "Edge cases and known limits", "Real build" part 2a and "Known limits in api mode".
  - docs/product-spec/sales.md (the company default rule, "Settings that drive this module") and docs/product-spec/meetings.md (the zone).
  - The blueprint's "Localization, currency and tax settings" (pp. 20-21): the Region and Currency rows, rule 3 (foreign currency) and rule 4 (base currency and tax changes need a step-up).
  - ADR 0059 (part 1 and "2026-11-17: part 2a"), 2a's session log (D1 to D21, B1 to B16, review rounds 1 and 2, the handoff), ADR 0051 (GET /company), ADR 0037 (sales tax engine); docs/api-contract.md "Settings, part 2a"; docs/data-model.md "Settings groups"; docs/FEATURES.md rows `settings.localization` and `auth.step-up`.
- **The code at `3b1d530`:**
  - **Shared:** `settings/localization-rules.ts`, `settings/sections.ts`, `settings/section-rules.ts`, `decimal-text.ts`, `types/settings.ts`, `us-pack/states.ts`, `operations/quotes.ts` (`invoiceFromQuote`), `permissions/mfa.ts`.
  - **API:** `modules/settings/settings.controller.ts`, `settings.service.ts`, `settings-input.ts`; `modules/sales/sales-common.ts` (`companyClock`, `dayIn`), `invoice-records.ts`; `core/auth/step-up.service.ts`; `core/database/control-db.ts`; `app.ts` (the JSON body limit).
  - **Web:** `features/settings/localization/localization-page.tsx`, `simple-tabs.tsx`; `features/settings/form/settings-form.tsx`, `save-section.ts`, `registry.ts`; `lib/api/demo/store.ts` (`updateLocalization`, `assertSettingsSave`, `granter`, `todayIso`); `lib/api/http/api-methods.ts`, `settings-answer.ts`.
  - **Tests:** shared `localization-rules.test.ts` (LR1 to LR8); api `settings-localization.int.test.ts` (L0 to L16), `settings-dispatch.test.ts`, `auth-harness.ts` (companies provisioned in `America/Chicago`), `meetings.int.test.ts` (a tenant's zone moved in a test); web `settings-answer.test.ts`, `save-section.test.ts`, `demo-localization.test.ts`; e2e `tests/e2e-api/settings-localization.spec.ts`, `flows/checks.ts`, `flows/kit.ts`, `tests/e2e/settings.spec.ts`.
- **Planning:** a first plan, a critic's review (three must-fix items and ten should items) and a final plan that applies them, written against 2a's stage 2 code (`afb85a2`, `26a3c3e`, then `0a5b01c`). The plans live in the session scratchpad, not in the repo, so the plan is restated below.

### Differences from the plan found in stage 0 (2a's head `3b1d530`)
- **2a finished after the plan was written:** its e2e specs, docs, review round 1 (`3b641ef`: no document prefix may start with `CR-`, credit notes numbered from every invoice number, refusal words the same in both modes) and its handoff (`3b1d530`). The preconditions hold: 2a's dated ADR section exists, part 1's head is an ancestor, PR #52 is a draft. 2a's last commit is the handoff ("docs: hand off Settings part 2a (PR #52) …"), after its outcome commit `7540cd8`.
- **None of the signatures 2b builds on changed:** `saveLocalizationTab(tenant, actor, tab, value): Promise<void>` and its 409 words, the service constructor `(tenancy, auditLog)`, `pickTabs`, `localizationTabProblem(tab, value)`, `localizationProblem(localization)`, `LocalizationTabInput`, `assertSettingsSave`, the reader order and the controller's handler shape are as the plan read them. Line numbers moved a little; every edit is anchored on text.
- **Review round 1 made every outer length of 2a's bodies carry its field's shared words (R1-2),** and the page's inputs stop at the longest text each rule takes (`DOCUMENT_PREFIX_MAX`, `PERCENT_TEXT_MAX`, pinned by LR8). The plan's `REGION_INPUT` and `CURRENCY_INPUT` had bare `max()` bounds, so 2b follows round 1 (D23): each outer length carries its field's words, and a rate input stops at the longest text `FX_RATE_TEXT` takes (`FX_RATE_TEXT_MAX`, pinned like LR8).
- **2a's tests the plan lists in table 7.9 are where it says,** by text: L0 (`Record<ApiLocalizationTab, string>`), L1's pins, L9's last line, L14's loop, L16's region/currency loop, `serviceOver` in `settings-dispatch.test.ts`, LR2, LR3, LR6, W2, LW1, LW6, E1 step 3 and E2 step 4. 2a's new LR8 and L4/L6 round-1 cases are not touched by 2b.

## Plan (short)

### Shared (packages/shared; plain functions, no Zod)
- `decimal-text.ts`: `FX_RATE_TEXT` (up to ten digits and eight decimals; rates are numeric(18,8)) and `FX_RATE_TEXT_MAX`.
- `settings/localization-rules.ts`, a block "Region and Currency (ADR 0059, part 2b)": `RegionInput`, `CurrencyInput`, `HoldsKey`; `DATE_FORMATS`, `WEEK_STARTS`; `REGION_MESSAGES`, `CURRENCY_MESSAGES`; `regionProblem(next, current)` (zone, then country and locale against `current`, primary state, states, date format, week start, fiscal month), `statesOfOperationChanged` (as sets), `regionKeyProblem(next, current, holds)` (the one tax-key check), `currencyProblem(next, current)` (base and lock, codes in order, plain rates above 0), `datedRates(next, current, day)`. The dispatchers gain the stored tab: `localizationTabProblem(tab, value, current, holds)` (content, then Region's key) and the new `localizationTabStored(tab, value, current, day)`; `localizationProblem(value, current)` runs Region's and Currency's content rules too.
- `settings/sections.ts`: `API_LOCALIZATION_TABS` gains `region` and `currency`; `LOCALIZATION_READERS` gains `region` (everyone) and `currency` (`settings.localization.manage`, hidden while the page is off).
- `settings/section-rules.ts`: the localization branch passes `current`.

### The API (the settings module; nothing in core)
- `PUT /settings/localization/region` and `/currency`: one key from `LOCALIZATION_TABS` (`platform`, so no module guard), the switch (404), scope `all` (403), the strict body (400), then under the row lock the 409 for a missing row or tab and the shared rules against the stored tab (400), for Region a states change's tax key (403) and step-up, for Currency always a step-up (403); then the write and one audit entry.
- `SettingsService`: the control handle injected last; `answered(stored, zone)` overlays control's zone on Region for every read and judgement; `answer` reads `companyClock` once when it read the localization row; `saveLocalizationTab` takes a `settle(current, clock)` callback run inside its transaction after `FOR UPDATE`, and answers what it stored. 2a's handlers pass `() => value`.

### The web
- `nextSaveStep` and `SettingsForm.stepUp` take a function of the draft (Region: only a states change asks for a code).
- `simple-tabs.tsx`: the time zone read only (any IANA zone shows); the rate input stops at `FX_RATE_TEXT_MAX`; a pure `regionCurrencyForms(current, original, holds)` gives Region and Currency their shared rule plus key (before the code) and a Reset that keeps the fixed fields.
- `localization-page.tsx` spreads it onto the two forms; `registry.ts` rewords two helpers; DemoStore's `updateLocalization` checks the stored tab, the viewer's tax key and dates a changed rate with its today. Two comment-only edits in the transport (no logic change: it already loops over `API_LOCALIZATION_TABS`).

### Tests (red first)
- **Shared** RG1 to RG9 (`region-currency-rules.test.ts`); LR2, LR3, LR6 updated.
- **API** RC1 to RC16b, RC10b (`settings-region-currency.int.test.ts`, its own companies); 2a's L0, L1, L9, L14, L16 and `serviceOver` updated.
- **Web unit** W2, LW1, LW6 updated, RW1 to RW3 (`settings-answer.test.ts`); SF6 (`save-section.test.ts`); RD1 to RD10 (`demo-region-currency.test.ts`); RP1 (`region-currency-forms.test.tsx`).
- **Api-mode e2e** Z1, Z2 (`tests/e2e-api/settings-region-currency.spec.ts`), with 2a's `healTab` and `healTabOrThrow` moved to `flows/checks.ts`; 2a's E1 step 3 and E2 step 4 updated.
- **Demo e2e** S4 to S6 in `tests/e2e/settings.spec.ts`.
- **Mutations** RM1 to RM30 on the committed change.

### Stages (one commit each, pushed)
0. This log and the spec (docs only), the draft PR.
1. Red tests, no product code (one commit), then the red e2e runs on 2a's product code.
2. The change (shared, API, web), green, committed; the mutations on the committed change; this log.
3. Api-mode and demo e2e (green). 4. Docs. 5. Full checks, both suites, reviews, handoff (later stages, run by the orchestrator's next steps).

## Decisions and why
Planned decisions, each the safest option found. Decisions taken while building go under "Decisions taken during the build".

- **D1, scope:** Region and Currency only, on 2a's per-tab plumbing; Sales tax is part 3. 13 product files changed, none new, 2 comment-only.
- **D2, the zone is answered from control `tenants.time_zone`,** through `companyClock`, the reader every module's dates use, so the zone a screen shows is the one the API's date checks use. The row's copy is overlaid on every read and replaced by control's on a Region save; nothing on the API reads it. The control database is read, never written. Injecting `CONTROL_DB` into a module service is the established pattern (41 services), not a tenancy change: the company comes from the verified `TenantContext`. The handle is the last constructor parameter so 2a's positional test double keeps working.
- **D3, the zone is read only, in both modes;** a change is refused with "The company's time zone is set when the company is set up. Ask us to change it." The tab shows it disabled. **A demo change:** the tab no longer offers five zones; the demo's meetings and console keep the fixture zone. Making it editable is the stop-and-ask (Q1), so it isn't built.
- **D4, country and locale must equal the stored values** (rule 12, as part 1's D12 for the number format). No page edits them.
- **D5, Region's content rules are shared,** same words in both modes; Zod checks types, outer lengths and unknown fields only. At least one state of operation, each a US pack code once; the primary state a code; the date format and week start from the tab's options; the fiscal month a whole 1 to 12. The primary state need not be a state of operation (Q6).
- **D6, a change of the states of operation (as sets) needs `settings.tax.manage` and a step-up,** in that order, after the content rules, judged against the locked row. It changes where the company default rate applies (spec rule 25), which the blueprint treats as a tax change (p21 rule 4); it also moves the tax of a quote accepted earlier when it is invoiced, because the invoice recomputes tax at conversion. `settings.tax.manage` is an MFA key, so whoever passes the key can step up. A reorder is no change. No default role is affected. The demo checks the key; its step-up is the dialog.
- **D7, Currency:** base and lock equal the stored ones (no literal "USD"); codes fixed in order (Q3); rates `FX_RATE_TEXT` and above 0. A step-up **always** on the API (Payments' order: content, then code), whatever `auth.step-up` says.
- **D8, `asOf` is the server's.** A changed rate (by value, `sameOptionalDecimal`) is dated the company's day (API: `companyClock`; demo: `today()`), an unchanged value keeps its stored entry, and the sent `asOf` is never stored.
- **D9, checks that read the stored tab run under the row lock** (STATUS): `saveLocalizationTab` takes `settle(current, clock)`, run inside its transaction after `FOR UPDATE`; refusals roll back; the step-up is checked there too. RC16b pins it.
- **D10, readers:** `region` to everyone, not hidden by the page switch; `currency` only to `settings.localization.manage`, hidden while `settings.localization` is off.
- **D11, 409 `settings_missing`:** a missing row for every tab (2a's D7); a row without Region or Currency on that tab's save, because their rules judge the stored tab. Documents and payroll keep 2a's behaviour and write a tab the row lacks (the body is complete and checked whole, so the save repairs the row).
- **D12, audit:** "Changed localization and tax", target "Region" or "Currency", `before` the tab as answered (control's zone, so a stale copy shows no false zone change), `after` as stored (dated rates).
- **D13, the web's step-up may depend on the draft** (`nextSaveStep`, `SettingsForm.stepUp` as a function): Region asks for a code only when the states change.
- **D14, `today()` is not built here;** that task reads `GET /company`'s `company.timeZone` (the same control column).
- **D15, `GET /settings` reads the control zone once per call that reads the localization row** (one light query).
- **D16, process:** stacked on 2a (#52), which is stacked on #51 and #45 to #50 (the orchestrator's safest-option decision while CI is blocked by billing); STATUS and BRANCHES are the orchestrator's; no `gh pr ready` or `gh pr merge`.
- **D17, the whole-section path** (`updateSettings("localization")`, `resetSettings`, no screen) runs Region's and Currency's content rules with `current` too, but no extra key and no dating (R6).
- **D18, earlier tests that 2b changes** are updated in stage 1, each with a line in this log.
- **D19, one tax-key check** (`regionKeyProblem`) for the three callers: the page and DemoStore through `localizationTabProblem(…, holds)`, the API as 403.
- **D20, the page's rules are a pure function in the tab-body file** (`regionCurrencyForms` in `simple-tabs.tsx`), unit-tested (RP1), so no new product file and no unit test imports the `api` singleton.
- **D21, Reset to default keeps the fields Settings can't change** (zone, country, locale; base, lock, codes) from the company's current copy.
- **D22, per-file API test helpers** (as 2a's D17): the RC file copies 2a's harness helpers; the sweep stays a STATUS follow-up. **No test-writer subagent:** this session runs as a subagent without one, so the builder writes the API and Playwright tests from the final plan, as parts 1 and 2a did.
- **D23, the bodies' outer lengths carry the shared words, as 2a's review round 1 (R1-2) made them.** Where the words are fixed (zone, primary state, states, date format, week start, a currency code), the outer `max` carries them. Where the words name stored values or a sibling field (country and locale name the stored ones, the base names the stored base, a rate names its code), the body check can't know them, so those strings and `asOf` take no outer length: the rule compares them with the stored tab and nothing else is ever stored (`asOf` is never stored at all), and the API's JSON body limit (the parser's default, about 100 kB) bounds the request. The page's rate input stops at `FX_RATE_TEXT_MAX`, the longest text `FX_RATE_TEXT` takes. So from the screen and from a direct caller, every refusal of these fields reads the same in both modes.

### Decisions taken during the build
(Filled in at stages 1 and 2.)

## Owner questions
None blocks; each has its safest default taken.
- **Q1, the time zone.** Taken: the company's zone comes from control `tenants.time_zone`, read only in both modes; a change is refused ("Ask us to change it"). No platform console route changes it today (`company-status.service.ts` writes only `status`), so "us" means a manual control change. Should a company change it in Settings? That needs a control write, a decision on past invoice days and journal dates read in the zone, meetings' zone, and `today()`: its own task (stop-and-ask).
- **Q2, states of operation.** Taken: a change also needs `settings.tax.manage` and a step-up, because it moves where the company default rate applies (and the tax of accepted quotes when invoiced). Keep both, only the key, or neither?
- **Q3, currencies.** Taken: base and lock stay; codes can't be added or removed; only rates change, always with a code. Add and remove currencies on screen (after FX postings exist)?
- **Q4, `asOf`.** Taken: a changed rate is dated the company's day by the save. Allow entering a rate for another day?
- **Q5, who reads Currency.** Taken: only `settings.localization.manage` holders, and nobody while the page is switched off. Widen when bills in other currencies are built?
- **Q6, Region rules.** Taken: at least one state of operation; the primary state need not be one of them. Require it to be?
- **Q7, the demo's zone.** Taken: read only in the demo too (it offered five zones). Keep it, or let the demo still change it as a presenter's toy?
- **Q8, locale and country.** Taken: the stored values, refused if changed (rule 12), as the number format's. Confirm.

## For STATUS
The orchestrator applies these at handoff (re-read STATUS first and anchor on the quoted text). `<n>` is this PR's number (below).
- **"In progress" and "Next three tasks" item 2:** after 2a's "(part 2a: draft PR #52, …)", add "part 2b Region and Currency (draft PR #<n>, `feat/settings-region-currency-api`, stacked on #52)".
- **"Done"** (on merge): "Settings part 2b on the API (queue item 2, task 2), PR #<n> (ADR 0059, 2026-11-17 part 2b section). In api mode Localization's Region and Currency tabs save on the API (`PUT /settings/localization/region` and `/currency`, `settings.localization.manage`, scope `all`, strict bodies and shared rules in both modes, only that tab replaced under the row lock with every check that reads it inside the lock, one audit entry naming the tab). The company's time zone is answered from control `tenants.time_zone` and read only in both modes (never written); country and locale stay the stored ones; a change of the states of operation also needs `settings.tax.manage` and a step-up, and the API's tax follows it at once (an accepted quote's invoice too); Currency always needs a step-up, keeps its base, lock and codes, takes plain rates above 0 and dates a changed rate with the company's day. `GET /settings` answers Region to every member and Currency to the key holders, so every screen's date format and a new quote's state follow the server. Reset to default keeps the fields Settings can't change. No schema change, migration or dependency; nothing in core, providers, packages/db or the web's session. Checks: …"
- **Close or update:**
  - "**The company's zone has two copies** … The Settings task must write both …" (and 2a's rewording "Planned for Settings part 2b …"): **done differently:** "the API answers the zone from `tenants.time_zone` and refuses a change in both modes; a Region save writes control's value into the row's copy; nothing writes control. Making it editable is an owner question (Q1)." Keep "the `today()` task reads `GET /company`'s `company.timeZone`".
  - "Part 2b's time zone is a likely stop-and-ask": resolved without one (read only).
  - "**The number format's locale and currency** are compared with a read taken outside the save's transaction; harmless until part 2b makes Currency editable, which must check against the locked row" → "Currency's checks run against the locked row (part 2b) and its base can't change, so the number format's currency stays consistent; the number format's own read is still outside its transaction (harmless while no base currency can change)."
  - 2a's "**Settings part 2b** (Region and Currency), then part 3": done; keep part 3. "The quote builder's tax preview still reads DemoStore's region and tax" → "…reads the API's states of operation and DemoStore's tax rules until part 3."
  - "Unmoved settings pages save in the browser only" → "Localization and tax's Sales tax tab".
  - "**Reset to default** reads DemoStore's originals in api mode" gains "; Region and Currency keep the zone, country, locale, base, lock and codes from the company's own copy (part 2b)."
  - "**The company's day on the web client**" (`today()`): add "read `GET /company`'s `company.timeZone` (the same value `GET /settings` answers as `region.timeZone` since part 2b); the zone can't change in either mode; DemoStore's `todayIso` is fixed when the store is built, so compute it per call."
- **New follow-ups:**
  - **Adding or removing currencies** needs FX postings first (blueprint p21 rule 3); the Currency tab changes rates only (Q3).
  - **The Currency tab doesn't show a rate's `asOf`;** show "as of <date>" beside each rate.
  - **An editable time zone** (Q1): a control write, past invoice days and journal dates, meetings, `today()`; no console route changes it today.
  - **The whole-section path** (`updateSettings("localization")`, `resetSettings`, no screen) runs every tab's content rule but not the states' tax key or dated rates, and keeps the any-of keys; retire it in part 3.
  - **A page left open across a control zone change** keeps the old zone in its Region draft, so its save is refused with the zone's words until a reload.
  - **`flows/kit.ts` `formatted()`** assumes Summit's `MMM d, yyyy`; a killed Z1 run leaves `yyyy-MM-dd` (or states `["CO"]`) on the e2e database until the spec runs again. Its `shown()` JSDoc still says "Settings is still DemoStore in api mode".
  - **API test helpers** now have a third per-file copy (RC); the sweep into `apps/api/test/support/` stays open.
- **Owner questions:** a block "Owner questions (PR #<n>, Settings part 2b; none blocks)" with Q1 to Q8 above.
- **BRANCHES:** a `feat/settings-region-currency-api` row: "B (Claude)", "Queue item 2, task 2, Settings part 2b: Region and Currency on the API, the zone from control and read only (main checkout; stacked on #52)", "Draft" then the state at handoff, the PR, "see the branch".

## Commands run
| Command | Result |
| --- | --- |
| `git status --short`; `git fetch -q origin`; `git log --oneline -15 origin/feat/settings-localization-api` | clean; 2a's handoff `3b1d530` on top |
| `git show origin/feat/settings-localization-api:docs/adr/0059-settings-on-the-api.md \| grep -n "part 2a"` | 2a's dated section present |
| `git merge-base --is-ancestor origin/feat/settings-sections-api origin/feat/settings-localization-api` | `2a-holds-p1` |
| `gh pr list --head feat/settings-localization-api --json number,isDraft` | `[{"isDraft":true,"number":52}]` |
| `git diff --stat 0a5b01c 3b1d530` (what 2a changed after the plan) | review round 1 and the handoff (above) |
| `git switch -q --no-track -c feat/settings-region-currency-api origin/feat/settings-localization-api` | the branch, at `3b1d530` |
| `docker ps`; `lsof` on 3000 and 4000 | compose PostgreSQL on 5432, `fp-e2e-worktree` on 5433; both ports free |
