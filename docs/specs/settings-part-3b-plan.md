# Settings part 3b: Localization and tax saves one tab at a time (`feat/settings-localization-section`), FINAL plan

> **Status: planned, not built.** Written read-only by B's night session on 2026-11-17 (a plan, a critic and a final pass) and committed at the owner's stop so it isn't lost on one laptop. Re-check every file:line against the branch you build on and anchor edits on text.
>
> **Laptop-only helpers.** `<scratchpad>` is B's session folder on B's Mac; nothing in it is in the repo. On another machine:
> - `<scratchpad>/heavy.sh <command>` only runs the command one heavy job at a time (8 GB laptop): run the command directly.
> - `<scratchpad>/flows/api-e2e.sh <label> [--build] [-- <args>]` builds the API and the web in api mode (after `--build`) and runs `pnpm --filter web test:e2e:api <args>` (`playwright.api.config.ts`, which loads the env files itself).
> - `<scratchpad>/<key>/full.sh` runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:api` and `pnpm test:hooks` in turn.
> - `checks.sh`, `e2e-demo.sh` and `mutate.py` are the builder's own small scripts (targeted checks, a demo-mode build and Playwright run, and mutation runs that restore each file); write your own or run the commands they name.

Queue of 2026-11-16, item 2 ("Move the remaining screens to the API: GET /company first (...), then Settings, ..."), task 2, part 3b (ADR 0059 "Later parts" row 3; part 3a's final plan section 17, D16, D29).

**3b retires the whole-section save.** `updateSettings("localization")` and `resetSettings("localization")` refuse in both modes with "Localization and tax saves one tab at a time.". The refusal comes after the module, keys, switch and scope checks, and `localizationProblem` is removed.

It closes two STATUS lines:
- 2a's "`updateSettings("localization")` keeps the any-of keys".
- 2b's "The whole-section path ... retire it in part 3 (planned as 3b)".

It is stacked on part 3a (`feat/settings-tax-api`, draft PR #54). 3a is stacked on 2b (#53), 2a (#52), part 1 (#51) and #45 to #50, because GitHub Actions is blocked by billing. Part 4 will stack on this branch.

- **Paths.**
  - `SP` = `<scratchpad>`.
  - `SP3B` = `SP/settings3b`: this plan, its scripts and logs. `full.sh` and `logs/` already exist.
  - `SP2B` = `SP/settings2b`: `checks.sh`, `e2e-demo.sh` and `mutate.py`, to copy.
  - `SP3` = `SP/settings3`: 3a's `mutate.py`, whose TM40 is replayed as WM6.
  - Section 12 writes every command out in full.
- **Refs.** Read them with `git show` / `git grep` from the main checkout. zsh: write `git show "${T}:path"`, never `$T:path`, because `:a` is a zsh modifier.
  - `B` = `origin/feat/settings-region-currency-api`, 2b's handoff head **`cfb907f`** (#53).
  - `T` = `origin/feat/settings-tax-api` (#54). **When this plan was written it was at `0bfb73b`:**
    - `7137931`: 3a's session log and spec edits;
    - `0bfb73b`: 3a's tests.
  - `C3A` = **`0809465`**, 3a's product commit. It was committed in the main checkout but **not yet pushed** while 3a ran its mutations. It is read-only evidence for 3a's product code.
  - Line numbers marked `T:` are on `0bfb73b`, and those marked `C3A:` are on `0809465`. **Everything is found by its text**, and stage 0 re-reads 3a's handoff head and follows it.
  - 3a's stages 3 to 5 (e2e, docs, handoff) had not landed. Where they will edit a file 3b also edits, this plan says so.
- **Test ids:** shared `WS`, demo `WD`, transport `WW`, mutations `WM`. They were checked with `git grep` on `T` and `C3A`, and none exists yet. 3a's `TD8`, which 3a's plan reserved for 3b, is **not** used: its content goes to demo-localization.test.ts (D39).
- **Decision labels** continue part 3's list: `D16` (moved here by 3a), then `D33` to `D46`. Code comments cite "ADR 0059, part 3b, D<n>" and, for the rule, "spec settings-and-permissions.md rule 7".

---

## What changed from plan.md

critic.md was applied, and everything was re-checked against `T` = `0bfb73b` and `C3A` = `0809465`.

| Id | Item | Taken? | Where it lands |
| --- | --- | --- | --- |
| **M1** | `docs/product-spec/sales.md:75` still says "The store accepts it or `settings.tax.manage` … Store: `updateSettings`" for Sales and documents. That is the exact claim 3b closes. `:76` and the audit row `:682` also name `updateSettings`, and 3a's plan rewrites `:76` and `:682` but not `:75` | **Taken** | 10.5. **sales.md moves into stage 0's spec edits** (it is a spec). Section 6 lists it among the docs. Stage 0's docs grep is widened to `settings\.tax\.manage`, `any-of`, `any one`, `either key` and `accepts it or`, and every hit is listed with its verdict (stage 0, step 2e) |
| S1 | Stage 0's code greps missed calls split across lines, which is how the outline missed R8 | **Taken** | Stage 0 step 2b adds a multi-line pass (`-A2` on a call ending its line) and a variable-section pass. **Both were run on `T` while planning**, and their output is in 1.3. Nothing new was found |
| S2 | Make the TD9 rewrite unconditional, and use the existing fixture-mock pattern rather than swapping `localStorage` | **Taken, both halves** | TD9's set-up was confirmed on `T`: `demo-tax.test.ts:219-229` calls `updateSettings("localization", …)` at `:222`. It is rewritten unconditionally with a hoisted `SUMMIT_TAX` patch through `vi.mock("@/lib/api/demo/fixtures")`, as `demo-settings.test.ts:26-46` does for D8b (D40). There is no storage swap and no overlay format dependency, and the old R5 is gone. **WM6** replays 3a's TM40 against the new set-up |
| S3 | Spec rule 7 still says each section's keys "save it", `localization` included (`:425`, `:430`) | **Taken** | 10.4: the `:425` sentence and the `:430` row are both annotated |
| S4 | STATUS "Close" item 3 names a line that is not in STATUS. It is in 2b's session log `:315`, and STATUS carries it as `:194` | **Taken** | Section 11: the item is dropped, with a note that 2b's review note is STATUS `:194` |
| S5 | Stage 3's api-mode e2e proves nothing for this change, and `settings-tax.spec.ts` adds Texas versions on every run | **Taken as a trim** | The task fixes the builder's stages: stage 3 runs api-mode and demo e2e, and stage 5 runs the whole api-mode suite. Stage 3's api-mode run is cut to `settings.spec.ts`, `settings-localization.spec.ts` and `settings-region-currency.spec.ts`. `settings-tax.spec.ts` runs once, in stage 5's whole suite, so the Texas rows grow once (3a's recorded follow-up). The demo subset stays. D41 says why |
| S6 | Record why `"localization"` is not kept out of the `updateSettings` and `resetSettings` types | **Taken** | **D45**, and owner question **Q4** |
| S7 | The new comments should point to the spec section | **Taken** | The JSDoc of `LOCALIZATION_SECTION_MESSAGE` and `settingsSectionProblem` cites "spec settings-and-permissions.md rule 7" (4.1) |
| S8 | Add the presenter guide to the caller table | **Taken** | 1.3: `apps/web/src/features/presenter/guide-steps.ts` has no Localization or Reset step |
| S9a | api-contract wording: `:292` ("a tab never takes the section's any-of keys") and `:772` (the `updateLocalization` row) | **Taken** | 10.3, anchored by text (3a rewrites `:772` first) |
| S9b | Where the words live: `LOCALIZATION_SECTION_MESSAGE` could sit beside `PROFILE_MESSAGES`, `PAYMENT_MESSAGES` and `EXPENSE_MESSAGES` | **Taken** | **D46**: the constant goes in `section-rules.ts`, just above `settingsSectionProblem`, the one function that answers it. `localization-rules.ts` only loses `localizationProblem`. The mutation anchors are unchanged |
| S9c | WS1 doesn't need to be `async` (namespace import) | **Not taken** | It keeps `await import("../src")`. A second static `import * as … from "../src"` beside the file's named import is a duplicated import for one assertion |
| S9d | Change W6's example from `localization` to `branding` | **Not taken** | W6 also pins that `localization` still routes to DemoStore, and it catches WM5 with WW1. It passes unchanged because its DemoStore is a mock |
| N1 | **New.** 3a's product code is committed locally (`0809465`) but not pushed. It **doesn't change** `section-rules.ts`, `store.ts` or `contract.ts` (empty diff from `B`). It **does** change `localization-rules.ts` (`localizationProblem`'s JSDoc, now `:384-398`, still the last function), `sections.ts` (`API_LOCALIZATION_TABS` gains `tax`; the `SETTINGS_SECTIONS.localization` JSDoc `:39-43` is unchanged) and `api-methods.ts` (only the `updateLocalization` comment, `:206-207`) | **Followed** | 1.1 and 4.x anchors. `contract.ts`'s `updateLocalization` JSDoc is still stale ("the rest stay on DemoStore until their part"), so it is fixed here. `api-methods.ts`' `updateLocalization` comment is already right, so only its `getSettings` comment (`:194-195`) changes |
| N2 | **New.** The test anchors on `T` moved from `B` | **Followed** | LR6 is `T:231-261`, with its whole-section lines `:255-258` and the import `:35`. RG7 is `:199-239`, with the block `:227-238` (a blank line, then `paris` … the comment and line `:238`) and the import `:19`. TD9 is `:219-229`. R1 is `:100` and R8 `:226-258` (`overtimeRuleProblem` only at `:20`, `:237`, `:244`). LD13 is `:218-227` (the file ends at `:228`). RD10 is `:202-208`. D5 is `:132-143`. W6 is `:129-136` and W7 `:138-141` |
| N3 | **New.** `SETTINGS_SECTIONS.localization.label` is also read by the API (`settings.service.ts`, the per-tab audit action) | **Followed** | D35's reasons |
| N4 | **New.** The API pins the whole section's 404 twice: L16 (`settings-localization.int.test.ts:861`) and an ST case (`settings-tax.int.test.ts:1239`) | **Followed** | 1.1, 7.3 and 9 |
| N5 | **New.** The task's stage list includes "the whole api-mode suite". plan.md's stage 5 said "the whole suites are not run" | **Changed** | Stage 5 runs the whole api-mode suite on a fresh build. The whole demo suite is not run (recorded, D41): no screen changed, and stage 3's demo subset covers every settings page of both projects |
| N6 | **New.** sales.md's audit row should name every Sales-relevant per-tab source, whatever 3a writes there | **Taken** | 10.5: `updateLocalization("documents")` and `updateLocalization("tax")`. Never the whole section |

---

## 0. Summary

- **What changes.**
  - `settingsSectionProblem` refuses `localization` by the section's name with `LOCALIZATION_SECTION_MESSAGE` ("Localization and tax saves one tab at a time."). It does this before any other rule, whatever the value holds.
  - DemoStore's `updateSettings` already runs module, keys (either of the two), switch and scope (`assertSettingsSave`) before `settingsSectionProblem`, and `resetSettings` already calls `updateSettings`. So **both refuse after those checks, with no logic change in `store.ts`**.
  - In api mode the ApiClient already sends `updateSettings("localization")` to DemoStore (`isApiSettingsSection` is false), and `resetSettings` is unrouted. So the same words come back in **both modes**, and nothing reaches the API, which has no whole-section route (404, unchanged).
  - `localizationProblem` goes. Its only caller was the localization branch.
- **What it closes.** Before 3b:
  - a holder of `settings.tax.manage` alone could save Sales and documents and Payroll rules through the whole section;
  - a holder of `settings.localization.manage` alone could store a tax block whole and unversioned (3a R17, its D29);
  - the path skipped Region's tax key and step-up, Currency's dating and Sales tax's versions (2b D17).

  After 3b, no key, role or value saves the section whole in either mode.
- **Who calls it.** Nobody: no screen, flow, e2e, demo-script step or presenter step (1.3).
  - Reset to default on every settings page only puts the originals into the draft. Localization and tax and Sales and documents then save per tab through `updateLocalization`.
  - Reset demo data clears storage (`resetDemo`), not `resetSettings`.
  - So no screen, flow or e2e changes; only unit tests and docs do.
- **Size.**
  - 6 product files, none new: 2 with logic (`section-rules.ts`, `localization-rules.ts`) and 4 comment-only (`sections.ts`, `store.ts`, `contract.ts`, `api-methods.ts`).
  - 8 test files changed, none new.
  - No API, schema, migration, dependency, core, auth, tenancy, provider or `features.ts` change. **No stop-and-ask item.**
- **Review.** `/review`, plus one fresh read-only security-reviewer pass on the small diff (section 13). The change narrows who can save tax and payroll settings in the demo. feature.md step 6 names permissions, tax and payroll, and the self-merge rule names that reviewer for them. **This is the security-relevant path the task asked about.**

---

## 1. What exists

### 1.1 The whole-section path (3a leaves it as 2b left it; 3a's D29)

| Piece | Where | What it does |
| --- | --- | --- |
| `SETTINGS_SECTIONS.localization` | `packages/shared/src/settings/sections.ts:39-49` (`C3A`, unchanged by 3a) | Keys `["settings.localization.manage", "settings.tax.manage"]` (any one), feature `settings.localization`, module `platform`, label "Localization and tax". JSDoc `:39-43`: "The demo's whole-section rule, kept for `updateSettings("localization")`, which no screen calls since part 2a ...". The interface JSDoc `:13-18`: "any one of `keys` saves it". The `satisfies Readonly<Record<keyof CompanySettings, SettingsSectionRule>>` at `:89` needs the entry |
| `LOCALIZATION = SETTINGS_SECTIONS.localization` | `sections.ts:257` | Every tab's `feature` comes from it (`LOCALIZATION_TABS`). The API's per-tab audit action and DemoStore's `updateLocalization` (`store.ts:881`) read its `label` |
| `settingsSectionProblem` | `packages/shared/src/settings/section-rules.ts:137-158` (`C3A` = `B`) | JSDoc `:137-143`. It narrows `{ [section]: value }`. `:156`: `if (settings.localization) return localizationProblem(settings.localization, current as LocalizationSettings);` |
| Its imports | `section-rules.ts:3-11` | The type import holds `LocalizationSettings` at `:7`, used only at `:156`. `:11`: `import { DOCUMENT_PREFIX_TEXT, localizationProblem } from "./localization-rules";`. `DOCUMENT_PREFIX_TEXT` stays for payments' prefixes. Message constants `PROFILE_MESSAGES :26`, `PAYMENT_MESSAGES :40`, `EXPENSE_MESSAGES :50`, `NUMBER_MESSAGES :56` |
| `localizationProblem` | `packages/shared/src/settings/localization-rules.ts:384-398` (`C3A`), the last function of the file | It runs payroll, documents, region (against `current`) and currency (against `current`). It runs no tax rule, checks no extra key and does no dating. 3a reworded its JSDoc only ("part 3b retires this path") |
| Exports | `packages/shared/src/index.ts:88-91` | `export *` of `sections`, `section-rules`, `localization-rules` and (3a) `tax-settings` |
| DemoStore `updateSettings` | `apps/web/src/lib/api/demo/store.ts:838-860` | JSDoc `:838-842`. `:845` `rule = SETTINGS_SECTIONS[section]`; `:846` `await this.assertSettingsSave(db, rule)`; `:847-848` `settingsSectionProblem(section, value, db.settings[section])` → `DemoRuleError`. Then it stores the section whole and audits "Changed localization and tax", target "Localization and tax" |
| `assertSettingsSave` | `store.ts:2147-2162` | Module ("This part of the product is not switched on for your company.") → `assertCan(db, rule.keys)` (any one; the role words) → `featureOn(rule.feature)` ("This feature is switched off.") → scope `all` (`SETTINGS_SCOPE_MESSAGE`) |
| DemoStore `resetSettings` | `store.ts:893-895` | `return this.updateSettings(section, this.open().defaultSettings[section]);`, with no JSDoc |
| DemoStore `updateLocalization` | `store.ts:862-887` | Per tab: `LOCALIZATION_TABS[tab]`, `assertSettingsSave`, `localizationTabProblem`, `localizationTabStored` (3a gives these their Sales tax branches). Its JSDoc `:862-869` doesn't mention Sales tax (3a's N7: "3b rewrites the JSDoc") |
| ApiClient contract | `apps/web/src/lib/api/contract.ts` | `:880-884` `updateSettings` JSDoc ("Screens save `localization` per tab ...; no screen sends the whole section (ADR 0059, part 2a)"). `:886-891` `updateLocalization` ("In api mode the tabs in API_LOCALIZATION_TABS are `PUT /settings/localization/<tab>`; the rest stay on DemoStore until their part (ADR 0059, part 2a)." This is stale after 3a, because every tab is served). `:902` `resetSettings` ("No screen calls it; DemoStore only.") |
| Api-mode routing | `apps/web/src/lib/api/http/api-methods.ts:194-205` (`C3A`) | Comment `:194-195`. `:200`: `if (!isApiSettingsSection(section)) return demo.updateSettings(section, value);`. `resetSettings` is not in `API_METHODS` (W7), so `routeClient` (`http/router.ts:43-45`) hands out DemoStore's method. 3a only rewrote the `updateLocalization` comment `:206-207` ("every tab ..., all of them since part 3a") |
| Api mode opens DemoStore | `apps/web/src/lib/session/api-context.ts:36-55` | The API company by slug (`summit`, `keystone`, `harbor`) and the person by email. DemoStore's keys, switch and scope checks use DemoStore's copy of the person, as for every unmoved section |
| The API | `apps/api/src/modules/settings/settings.controller.ts` (`C3A`) | Fixed routes only: `@Put("profile")`, `numbers`, `payments`, `expenses`, `localization/documents`, `/payroll`, `/region`, `/currency`, `/tax`. **`PUT /settings/localization` is not a route (404)**, pinned by L16 (`apps/api/test/settings-localization.int.test.ts:861`) and 3a's ST case (`settings-tax.int.test.ts:1239`). The API never calls `settingsSectionProblem` or `localizationProblem`; it calls each section's rule. `settings-input.ts:28-34`'s JSDoc says the bodies are then checked by `settingsSectionProblem` (inaccurate, follow-up in section 11, not changed here) |

### 1.2 Where `SETTINGS_SECTIONS.localization`'s keys are read (correction to the outline)

The outline says the keys "remain only as who opens the page". **They don't open the page:**
- The settings menu has its own `anyOf: ["settings.localization.manage", "settings.tax.manage"]` (`apps/web/src/products/settings-menu.ts:128-135`).
- The Sales and documents entry has `anyOf: ["settings.localization.manage"]` (`:110-118`).
- The Localization page checks `can("settings.localization.manage") || can("settings.tax.manage")` (`apps/web/src/features/settings/localization/localization-page.tsx:53-55`).
- The documents page checks `can("settings.localization.manage")` (`documents-page.tsx:185`).

The keys are read only by DemoStore's `updateSettings` (through `assertSettingsSave`) and pinned by R1 (`packages/shared/test/settings-sections.test.ts:101`). After 3b:
- They decide **who reaches the refusal**; others get the role words first.
- The `Record<keyof CompanySettings, SettingsSectionRule>` type needs the entry.
- Its `label` and `feature` still feed every tab: the audit action in both modes and the switch.

The menu's copy of the two keys is a STATUS follow-up (section 11) and is not changed here.

### 1.3 Every screen, flow and test that could reach the path

Checked on `T` while planning. Stage 0 re-runs the same greps on 3a's handoff head.

| Place | How it saves | Reaches the whole section? |
| --- | --- | --- |
| Localization and tax page: every tab's Save and **Reset to default** | `SettingsForm` Reset only sets the draft (`form/settings-form.tsx:106`, `onClick={() => setDraft(defaults)}`). Save → `onSave` → `api.updateLocalization(key, value)` (`localization-page.tsx:61-71`) | No |
| Sales and documents page: Save and Reset | `api.updateLocalization("documents", ...)` (`documents/documents-page.tsx:184-195`). Demo e2e "resets to default" (`tests/e2e/settings.spec.ts:47-67`) saves through it | No |
| Company profile's Reset | `form.reset(defaults.data.profile, …)` (`company-profile-page.tsx:118-131`), then `api.updateSettings("profile", …)` | No |
| Every other settings page | `api.updateSettings("<own section>")` with a literal: branding, profile, expenses, sharedCosts, hr, inventory, meetings, email, numbers, payments (10 calls under `apps/web/src/features/settings`) | No |
| `resetSettings` | No caller in `apps/web/src` beyond the contract and DemoStore. In tests only W7 names it (`in API_METHODS`) | Only directly |
| Reset demo data (account menu `user-menu.tsx:28-29`, palette `command-palette.tsx:124`, the demo script's start and troubleshooting) | `api.resetDemo()` → `clearStored()` and rebuilt companies (`store.ts:392-401`) | No |
| `docs/demo-script.md` | No Localization or tax-settings step. The quote step changes a quote's **State**, not Settings | No |
| Presenter guide `apps/web/src/features/presenter/guide-steps.ts` (S8) | Steps: roles, number format, branding, audit, outbox, import, users. No Localization step | No |
| Api-mode e2e (`tests/e2e-api/**`): 2a's E1/E2, 2b's Z1/Z2, 3a's TE1/TE2, `healTab`, `putWithStepUp` | Per-tab `PUT /settings/localization/<tab>` (`flows/checks.ts`). No spec PUTs `/settings/localization` itself | No |
| Demo e2e (`tests/e2e/**`): `settings.spec.ts` (S1 to S8, "resets to default"), `localization.spec.ts`, `tax.spec.ts`, `square-feet.spec.ts` | Per tab, through the page | No |
| Unit tests | R8, LR6, RG7, LD13, RD10, D5, W6, 3a's TD9 | Yes: section 7 |

Grep evidence on `T` (S1):
- **Single-line pass.** `git grep -n -E 'localizationProblem|settingsSectionProblem\("localization"|updateSettings\("localization"|resetSettings\('` prints: `contract.ts:903`, `store.ts:893`, `demo-localization.test.ts:222`, `demo-region-currency.test.ts:206`, `demo-settings.test.ts:136`, `demo-tax.test.ts:222`, `settings-answer.test.ts:132`, `localization-rules.ts:376,379` (`T` = `B`'s code; on `C3A` `:387,391`), `section-rules.ts:11,156`, `sections.ts:40`, `localization-rules.test.ts:256,258` and `region-currency-rules.test.ts:229,235,236,238`.
- **Multi-line pass.** `git grep -n -A2 -E '(updateSettings|resetSettings|settingsSectionProblem)(<[^>]*>)?\(\s*$'` adds only R8 (`settings-sections.test.ts:232-234`, `:239-241`) and the declaration `section-rules.ts:144`.
- **Variable-section pass.** `git grep -n -E '(updateSettings|resetSettings)\([a-z][A-Za-z]*[,)]'` prints only `store.ts:894`, `api-methods.ts:200` and `settings-answer.test.ts:124` (W5's loop over profile, payments, expenses).

**Conclusion:** no screen or flow changes, and the only callers are unit tests. A future caller fails closed with the words.

### 1.4 The STATUS lines this closes (find them by text on 3a's handoff head; `T:` numbers)

- 2a's follow-up (`T:docs/STATUS.md:203`): "**`updateSettings("localization")`** keeps the any-of keys for `resetSettings` only (DemoStore). Retire it or route it per tab in part 3.". 3a appends "(part 3b; since 3a it can also store a whole tax block unversioned, DemoStore only, no screen)".
- 2b's follow-up (`T:194`): "**The whole-section path** (`updateSettings("localization")`, `resetSettings`, no screen) runs every tab's content rule but not the states' tax key or dated rates, and keeps the any-of keys; retire it in part 3 (planned as 3b).". This is also 2b's review note (its session log `:315`); STATUS has no separate line for it (S4).
- Part 1's "**Reset to default** reads DemoStore's originals in api mode; `resetSettings` is unrouted. ..." (`T:213`) gains a clause.

### 1.5 Docs that name the path (on `T`; 3a's stage 4 edits some of them first)

`docs/product-spec/settings-and-permissions.md`:
- "Save settings" (`T:340`: "... `DemoStore.resetSettings` exists, but no screen calls it.");
- rule 7's opening sentence (`T:425`: "Each section names the keys that save it (any one)") and its table row (`T:430`: `localization` | `settings.localization.manage`, `settings.tax.manage`, under "Keys, any of");
- rule 7's closing paragraph (`T:450`: "The `localization` keys are the demo's whole-section rule for `updateSettings("localization")`, which no screen calls; ...");
- the audit row "Changed localization and tax" (`T:853`: "(`Localization and tax` for the whole section)" and "`updateSettings("localization")`");
- "Closed for every screen" (`T:891`: "Only `updateSettings("localization")`, which no screen calls, still takes either key.");
- "Real build" (after part 3a's bullets, `T:982-989`, before "Known limits in api mode" at `T:991`).

`docs/product-spec/sales.md` (M1):
- `T:75` ("Settings > Sales and documents | `settings.localization.manage` to open the page. The store accepts it or `settings.tax.manage` | … | Store: `updateSettings`");
- `T:76` ("Tax rates in Settings > Localization | `settings.localization.manage` or `settings.tax.manage` | … | Store: `updateSettings`"; 3a's plan 10.5 rewrites it);
- `T:682` (audit row: `updateSettings("localization", ...)`; 3a's plan rewrites it to `updateLocalization("tax")`).

`docs/api-contract.md`:
- part 1 "The web." (`T:281`);
- part 2a "One key per tab." (`T:292`) and "Not routes yet" (`T:296`; 3a may reword it);
- the ApiClient rows `updateSettings` (`T:771`), `updateLocalization` (`T:772`; 3a rewrites it), `getDefaultSettings` (`T:773`, "saves through `updateSettings`") and `resetSettings` (`T:774`).

ADR 0059:
- "Later parts" row 3 (`T:77`: "Closes "`settings.tax.manage` is enough to save all of localization"");
- 2a's "Later parts" `3:` (`T:134`) and 2b's (`T:162`);
- 3a's section (not landed) adds "3b (the whole-section save) next".

**Not affected** (checked with the widened grep):
- `docs/data-model.md`, `docs/FEATURES.md` (`:72` is the page's open keys, which are right), `docs/blueprint-delta.md`, `docs/demo-script.md`;
- the spec's `:33`, `:34`, `:207`, `:265`, `:446`, `:555`, `:702`, `:968-989`;
- the api-contract's `:305`, `:308`, `:309`;
- sales.md `:625`.

### 1.6 Re-check of 3a's section 17 outline, claim by claim

| Outline claim | Verdict |
| --- | --- |
| Branch, stacking and session log name; it closes "keeps the any-of keys" | Holds. It also closes 2b's "The whole-section path" line (1.4) |
| `settingsSectionProblem("localization")` answers the message, so `updateSettings` and `resetSettings` refuse in both modes after module, keys, switch and scope | Holds: the `assertSettingsSave` order (`store.ts:2153-2160`), `resetSettings` → `updateSettings` (`:893-895`), api mode → DemoStore (`api-methods.ts:200`, W7, `router.ts:43-45`). **Refined (D33):** it is checked on the section's name first, not on the narrowed value, so a missing or odd value can't fall through to `return null` |
| `localizationProblem` removed | Holds: its only caller is `section-rules.ts:156`, and nothing in the API, web or tests imports it (1.3) |
| The keys "remain only as who opens the page" | **Corrected** (1.2) |
| Routing per tab not taken, because it would not be one transaction | Holds: in api mode it would be separate PUTs, each with its own key and step-up. D16 adds the other reasons |
| About 6 product files; unused imports go | Holds: exactly 6. `LocalizationSettings` leaves `section-rules.ts`'s type import. The words go in `section-rules.ts` (D46), not `localization-rules.ts` |
| `store.ts` and `contract.ts` JSDoc; the `api-methods.ts` comment | Holds. `resetSettings` gains a JSDoc in `store.ts` and a sentence in `contract.ts`. `contract.ts`'s `updateLocalization` JSDoc is stale after 3a and is fixed here. On `api-methods.ts`, only the `getSettings`/`updateSettings` comment changes; 3a already fixed the `updateLocalization` one |
| Tests: SR-section, TD8, LR6, RG7, LD13, RD10, D5, TD9 | Holds, with changes. SR-section is **WS1** in `settings-sections.test.ts`. TD8's content goes to **LD13, WD1 and WD2**, because demo-localization.test.ts holds the helpers. LD13 is `T:218-227`, RD10 `T:202-208` and D5 `T:132-143`. **R8 was missed** (two whole-section overtime expectations, split across lines), and so was the R1 comment (`:100`). **WW1** is added (api-mode composition). W6 needs no change. **TD9 is rewritten** (it calls the whole section at `T:222`) |
| Mutation TM26 | Becomes WM1. WM2 to WM6 are added (section 8) |
| Docs: ADR, spec rule 7 and "Closed", the api-contract `updateSettings` row, STATUS | Holds, and more: the spec's "Save settings" paragraph, rule 7's opening sentence and row, the audit row and "Real build"; **sales.md `:75`, `:76`, `:682` (M1)**; the api-contract's `:281`, `:292`, `:296`, `:772`, `:773`, `:774`; the ADR's "Later parts" rows |
| Security review not required | **Partly corrected** (section 13). No server path changes, but the change narrows a permission over tax and payroll settings in the demo. One cheap fresh read-only security-reviewer pass is the safest default and is what the self-merge rule needs anyway |

---

## 2. Scope decision

**3b, in one PR (`feat/settings-localization-section`):**
- the refusal in `settingsSectionProblem`, by name;
- `LOCALIZATION_SECTION_MESSAGE` in `section-rules.ts`, and `localizationProblem` removed from `localization-rules.ts`;
- the JSDoc and comments of `sections.ts`, `store.ts`, `contract.ts` and `api-methods.ts`;
- the unit tests of section 7;
- the docs of section 10.

**Out:**
- any API change (the whole section stays a 404; Q2);
- routing the whole section per tab (D16, Q1);
- removing `resetSettings` from the ApiClient (Q3);
- keeping `"localization"` out of the method types (D45, Q4);
- making the settings menu read `SETTINGS_SECTIONS.localization.keys` (follow-up);
- rewording `settings-input.ts`'s JSDoc (follow-up; an API file);
- any new e2e (D41);
- any screen change.

**If stage 0 finds more** (3a's handoff left another caller or doc of the whole-section path), add it and record it. Stop and report only if an ask-before item appears (none is expected) or the product files would exceed 8.

---

## 3. Before building (read first)

1. CLAUDE.md and `.claude/commands/feature.md`.
2. `docs/real-build-plan.md`:
   - prompt **P11** (`:29-35`): spec approved first, failing tests, endpoints with guards, the screen, a security review when auth, tenancy, permissions or money are touched, then a PR and /handoff;
   - module order row 4;
   - the CI budget.
3. `docs/product-spec/settings-and-permissions.md` on 3a's handoff head:
   - "Save settings";
   - **rule 7**;
   - rule 22 (View as limits saves);
   - the audit table;
   - "Edge cases and known limits" ("Closed for every screen");
   - "Real build" parts 2a, 2b and 3a.
4. `docs/product-spec/sales.md`:
   - "Who uses it" `:75` and `:76`;
   - the audit table.
5. `docs/api-contract.md`:
   - "Settings, part 1" ("The web");
   - part 2a ("One key per tab", "Not routes yet");
   - 3a's section;
   - the ApiClient rows `updateSettings`, `updateLocalization`, `getDefaultSettings` and `resetSettings`.
6. ADR 0059:
   - "Later parts";
   - the dated sections of 2a (its D-list on the whole-section path), 2b (D17) and 3a (D16, D29).
7. 3a's session log: D16, D29 and "For STATUS".
8. The blueprint is not needed. Its pp. 20-21 say nothing about a whole-section save, so no blueprint-delta row (D43).

---

## 4. Design

### 4.1 Shared

**`packages/shared/src/settings/section-rules.ts`** (logic):
- **Imports.**
  - Drop `LocalizationSettings` from the type import (`:3-9`).
  - `:11` becomes `import { DOCUMENT_PREFIX_TEXT } from "./localization-rules";`.
  - There is still no cycle: `section-rules → localization-rules → sections, tax-settings`, as today.
- **The words**, directly above `settingsSectionProblem`'s JSDoc (D46):
```ts
/**
 * Why Localization and tax is never saved whole (spec settings-and-permissions.md rule 7; ADR 0059,
 * part 3b, D16): each tab saves on its own, with its own key, rules, step-up and dating
 * (`LOCALIZATION_TABS`, `localizationTabProblem`, `localizationTabStored`; Sales tax's versions),
 * which one whole-section save would skip. `settingsSectionProblem` answers it for
 * `updateSettings("localization")` and `resetSettings("localization")` in both modes, after the
 * module, keys, switch and scope checks.
 */
export const LOCALIZATION_SECTION_MESSAGE = "Localization and tax saves one tab at a time.";
```
- **`settingsSectionProblem`** (JSDoc and body):
```ts
/**
 * Why a settings section can't be saved, or null: the content rules both modes run, with the same
 * words (ADR 0059). `current` is the stored section (or the API's never-saved answer), so a rule can
 * refuse a change that no page makes. Localization and tax is refused by its name, whatever the
 * value holds: its tabs save one at a time through `updateLocalization` (spec rule 7; ADR 0059,
 * part 3b, D33). Every other section gets its rules when its part moves to the API.
 */
export function settingsSectionProblem<K extends keyof CompanySettings>(
  section: K,
  value: CompanySettings[K],
  current: CompanySettings[K],
): string | null {
  // By the name, not the value, so no value of any shape is stored whole (part 3b, D33).
  if (section === "localization") return LOCALIZATION_SECTION_MESSAGE;
  // One key is set, so reading a section's property narrows the value to that section's type;
  // `current` is that same section's stored value.
  const settings = { [section]: value } as Partial<CompanySettings>;
  if (settings.profile) return companyProfileProblem(settings.profile);
  if (settings.numbers) return numberSettingsProblem(settings.numbers, current as NumberSettings);
  if (settings.payments) return paymentSettingsProblem(settings.payments);
  if (settings.expenses) return expenseSettingsProblem(settings.expenses);
  return null;
}
```

**`packages/shared/src/settings/localization-rules.ts`** (logic; on 3a's version):
- Remove `localizationProblem` and its JSDoc (`C3A:384-398`, the last block of the file).
- Nothing else changes. `payrollProblem`, `documentsProblem`, `regionProblem` and `currencyProblem` stay: `localizationTabProblem` and the API's controller use them.
- The comment in `localizationTabProblem` "(as settingsSectionProblem does)" (`C3A:348`) stays true, because the other sections still narrow.
- No import becomes unused.

**`packages/shared/src/settings/sections.ts`** (JSDoc only):
- `SettingsSectionRule` (`:13-18`):
```ts
/**
 * Who may save one settings section and where it lives (spec settings-and-permissions.md rule 7;
 * ADR 0059): any one of `keys` saves it (Localization and tax's two keys only reach its refusal: it
 * saves one tab at a time, `LOCALIZATION_TABS`; part 3b); `feature` is the switch of the page that
 * saves it, and a save answers "not found" while it is off; a company without `module` is refused;
 * `label` names the section in the audit log ("Changed <label in lower case>", target `<label>`).
 */
```
- `SETTINGS_SECTIONS.localization` (`:39-43`):
```ts
  /**
   * Localization and tax saves one tab at a time, each with its own key (`LOCALIZATION_TABS`), on
   * screens, in DemoStore and on the API. These keys only decide who reaches the whole-section
   * refusal: `updateSettings("localization")` and `resetSettings("localization")` check the module,
   * either key, the switch and scope, then refuse with `LOCALIZATION_SECTION_MESSAGE` (spec rule 7;
   * ADR 0059, part 3b). The label names every tab's audit entry and the feature is every tab's switch.
   */
```

### 4.2 Web (comment-only; no logic change)

**`apps/web/src/lib/api/demo/store.ts`:**
- `updateSettings` JSDoc (`:838-842`):
```ts
  /**
   * Replaces one settings section with the API's checks in the API's order (ADR 0059; spec rule 7):
   * module, keys, switch, scope (`assertSettingsSave`), then the shared content rules against the
   * stored section. Localization and tax is never replaced whole: after those checks it is refused
   * with "Localization and tax saves one tab at a time." and nothing is stored or audited; screens
   * save it per tab through `updateLocalization` (ADR 0059, part 3b).
   */
```
- `updateLocalization` JSDoc (`:862-869`): after "... and dates a changed rate with today (ADR 0059, part 2b).", add "Sales tax starts a changed rule or county rate today, a changed rule taking its state's next version, and keeps only what is in force (part 3a)."
- `resetSettings` gains a JSDoc:
```ts
  /**
   * Restores one section to the company's original values through `updateSettings`, with its checks
   * and rules, so Localization and tax is refused here too (ADR 0059, part 3b). No screen calls it.
   */
```

**`apps/web/src/lib/api/contract.ts`:**
- `updateSettings` (`:880-884`):
```ts
  /**
   * Replaces one settings section and audits the change. In api mode a served section is
   * `PUT /settings/<section>`; other sections stay on DemoStore. Localization and tax saves per tab
   * through `updateLocalization`: `updateSettings("localization")` is refused in both modes
   * ("Localization and tax saves one tab at a time."), after the module, keys, switch and scope
   * checks (ADR 0059, part 3b).
   */
```
- `updateLocalization` (`:886-891`): replace its last sentence "In api mode the tabs in API_LOCALIZATION_TABS are `PUT /settings/localization/<tab>`; the rest stay on DemoStore until their part (ADR 0059, part 2a)." with "In api mode every tab is `PUT /settings/localization/<tab>` (API_LOCALIZATION_TABS, all five since part 3a; ADR 0059, parts 2a to 3a)." **If 3a's handoff kept a tab off `API_LOCALIZATION_TABS`, keep the old wording** (on `C3A` all five are served).
- `resetSettings` (`:902`): `/** Restores one settings section to the company's original values and audits it; \`localization\` is refused, as by \`updateSettings\` (ADR 0059, part 3b). No screen calls it; DemoStore only. */`. Prettier wraps it if it is too long.

**`apps/web/src/lib/api/http/api-methods.ts`** (`:194-195`, the comment above `getSettings`):
```ts
  // Settings, part 1 (ADR 0059): the sections in API_SETTINGS_SECTIONS read and write the API; every
  // other section, Reset to default and resetSettings stay on DemoStore until their part moves.
  // `localization` is never sent whole: DemoStore refuses it, because Localization and tax saves one
  // tab at a time through updateLocalization (part 3b).
```

### 4.3 What does not change

- `store.ts` logic (the order, the audit, `resetSettings`'s body);
- `api-methods.ts` logic (routing; W6, W7);
- `router.ts`, every page, `settings-menu.ts` and `settings-form.tsx`;
- every file under `apps/api` (including `settings-input.ts`'s JSDoc, a follow-up);
- `features.ts` and the fixtures;
- packages/db, core, providers, auth and tenancy.

### 4.4 Every affected place

| Place | Before 3b | After 3b |
| --- | --- | --- |
| `updateSettings("localization")`, demo mode | Either key; payroll, documents, region and currency rules; stored whole (tax unversioned); audited "Localization and tax" | Module, either key, switch, scope, then **refused** with the words. Nothing stored, no audit |
| Same, api mode | Routed to DemoStore: the same as the demo | Routed to DemoStore: **refused** the same way. Nothing sent to the API |
| `resetSettings("localization")`, both modes | `updateSettings` with the fixture section: stored | **Refused** the same way |
| `resetSettings(<other section>)` | Unchanged | Unchanged (WD2 pins numbers) |
| `PUT /settings/localization` on the API | 404 | 404 (L16; 3a's ST case) |
| Every per-tab save, both modes | Unchanged | Unchanged |
| Every screen, flow, demo-script and presenter step, and e2e | Never reach it | Unchanged |
| `localizationProblem` (shared export) | Exported, one caller | Removed. `LOCALIZATION_SECTION_MESSAGE` is exported from `section-rules.ts` |

---

## 5. Decisions (3b's, for the session log and the ADR section)

- **D16. The whole-section path is retired, not routed per tab.** Per-tab routing was not taken, for four reasons:
  - In api mode it would be several PUTs, not one transaction, so a later tab could be refused after an earlier one saved.
  - Each tab has its own key, so a tax-only holder's whole save would fail at the first other tab.
  - Region and Currency have their own step-up and Sales tax its versions, which one call can't compose.
  - No screen needs it (Q1).
- **D33. Refused by the section's name,** first in `settingsSectionProblem`, not by narrowing the value. No value (missing, odd or valid) gets through to `return null` and a whole-section store.
- **D34. Order:** module, keys (either of the two), switch, scope, then the refusal, as every settings save (`assertSettingsSave`). A person without access gets the usual words and learns nothing more. Nothing is stored or audited.
- **D35. `SETTINGS_SECTIONS.localization` keeps its keys,** now only as the gate before the refusal. The `Record<keyof CompanySettings, …>` type needs the entry, and its label and feature feed every tab: the audit action in DemoStore and on the API (`settings.service.ts`), and the switch. The settings menu's own copy of the keys is a follow-up (1.2).
- **D36. The API is unchanged.** It has no whole-section route (404, L16), and one is never added (deny by default; Q2).
- **D37. The api-mode routing is unchanged.** `updateSettings("localization")` goes to DemoStore (W6), and `resetSettings` stays unrouted (W7), so DemoStore's refusal answers in both modes (WW1).
- **D38. `localizationProblem` is removed,** not kept for a later caller (no dead code).
- **D39. Tests.**
  - The shared refusal is pinned once (WS1). LR6 and RG7 drop their whole-section lines and the import, and R8 keeps one refusal line.
  - The demo refusal lives in demo-localization.test.ts (LD13 rewritten, WD1, WD2), with RD10 and D5 updated, and not in 3a's demo-tax.test.ts (TD8 unused). TD9's set-up is rewritten (D40).
  - The web tests write the words as a literal (`SECTION_REFUSAL`), as these files already do for the role, module and switch words. An import of the not-yet-existing constant would be `undefined` on 3a's head, and `rejects.toThrow(undefined)` passes for any error, so the red run would prove nothing.
- **D40. TD9's tax-inclusive data comes from the company's fixtures, patched in the test.**
  - A hoisted `SUMMIT_TAX` patch goes through `vi.mock("@/lib/api/demo/fixtures")`, the pattern of `demo-settings.test.ts`' D8b.
  - The whole-section save that set it is refused now, and since part 3a no save can make prices tax-inclusive. Only data typed before 3a can hold it, and D28's rule compares with the stored value whichever layer holds it.
  - The patch has no storage swap and no dependence on the saved-data format. TD9's first assertion proves the patch applied, and WM6 proves TD9 still reaches the rule.
- **D41. No e2e is added.**
  - No screen or flow reaches the path, a page can't call the ApiClient directly, and the transport composition is unit-tested (WW1).
  - Stage 3 re-runs the demo subset (every settings page of both projects, where DemoStore runs the refusal's code path under real pages) and a **trimmed** api-mode run (the settings, localization and region-currency specs on this branch's web build).
  - `settings-tax.spec.ts` is left to stage 5's whole api-mode suite, so its Texas versions grow once (3a's follow-up), not twice.
  - The whole demo suite is not run: no screen changed, and the subset covers every settings page.
- **D42. Reviews:** `/review` and one fresh read-only security-reviewer pass (section 13). No schema review, because packages/db doesn't change.
- **D43. No blueprint-delta, data-model or FEATURES change.** The blueprint has no whole-section save, and no table, column or switch changes.
- **D44. Process.**
  - Stacked on 3a (#54).
  - No test-writer subagent: no API or Playwright test is written, and the unit tests are the builder's, as in parts 1 to 3a.
  - STATUS and BRANCHES are the orchestrator's.
  - No `gh pr ready` or `gh pr merge`.
- **D45 (S6). `"localization"` stays in the `updateSettings` and `resetSettings` types.** Typing them as `Exclude<keyof CompanySettings, "localization">` would make a future typed caller fail at compile time, but it was not taken, for three reasons:
  - It changes three signatures (the contract, DemoStore and the routed factory) and the generic `K` of `updateSettings`.
  - The runtime refusal must stay anyway, for untyped callers (a console snippet, a cast, the generic `section` in W5-style loops).
  - LD13, WD1, WD2, RD10, D5, WW1 and W6 would each need a cast to reach it.

  A runtime refusal with words, pinned by tests, fails closed; Q4 asks the owner.
- **D46 (S9b). The words live in `section-rules.ts`,** beside `PROFILE_MESSAGES`, `PAYMENT_MESSAGES` and `EXPENSE_MESSAGES`, just above `settingsSectionProblem`, the one function that answers them. `localization-rules.ts` holds per-tab rules and only loses `localizationProblem`.

---

## 6. Files

**Product (6, none new):**
- Logic (2): `packages/shared/src/settings/section-rules.ts` and `packages/shared/src/settings/localization-rules.ts`.
- Comment-only (4): `packages/shared/src/settings/sections.ts`, `apps/web/src/lib/api/demo/store.ts`, `apps/web/src/lib/api/contract.ts` and `apps/web/src/lib/api/http/api-methods.ts`.

**Tests (8 changed, none new):**
- `packages/shared/test/settings-sections.test.ts`: the R1 comment, R8, WS1.
- `packages/shared/test/localization-rules.test.ts`: LR6.
- `packages/shared/test/region-currency-rules.test.ts`: RG7.
- `apps/web/tests/unit/demo-localization.test.ts`: LD13, WD1, WD2.
- `apps/web/tests/unit/demo-region-currency.test.ts`: RD10.
- `apps/web/tests/unit/demo-settings.test.ts`: D5.
- `apps/web/tests/unit/demo-tax.test.ts`: 3a's TD9 set-up, **unconditional**.
- `apps/web/tests/unit/settings-answer.test.ts`: WW1.

**Docs:**
- the session log `docs/sessions/2026-11-17-HHMM-b-settings-localization-section.md` (new; HHMM is the start time, or the date the session starts if not 2026-11-17);
- `docs/product-spec/settings-and-permissions.md` and `docs/product-spec/sales.md` (stage 0);
- ADR 0059 (a dated section and the "Later parts" rows) and `docs/api-contract.md` (stage 4).

Not STATUS or BRANCHES (D44).

---

## 7. Tests

### 7.1 Shared

**`packages/shared/test/settings-sections.test.ts`:**
- **R1** (`T:100`): the comment "Both keys: the demo's whole-section rule. API routes go per tab (see the entry's JSDoc)." becomes "Both keys: who reaches the whole-section refusal; every save goes per tab (part 3b).". The expectation stays.
- **R8** (`T:226-258`):
  - The title becomes "R8 settingsSectionProblem dispatches, numbers against the current value; Localization and tax is refused whole (part 3b)".
  - Replace the `localization` helper (`:227-230`) and its two expectations (`:231-244`) with:
```ts
    // Refused whole (WS1); the overtime rule is Payroll rules' own (LR5, LR6; D5 in the demo).
    expect(settingsSectionProblem("localization", SUMMIT.localization, SUMMIT.localization)).toBe(
      LOCALIZATION_SECTION_MESSAGE,
    );
```
  - The rest of R8 is unchanged.
  - Imports: add `LOCALIZATION_SECTION_MESSAGE` (after `isApiSettingsSection`, before `MODULES`), and remove `overtimeRuleProblem` (`:20`; R8 was its only use).
- **WS1** (new, after R8):
```ts
  it("WS1 the whole Localization and tax section is refused by its name, whatever it holds (ADR 0059, part 3b)", async () => {
    const whole = SUMMIT.localization;
    const refused = "Localization and tax saves one tab at a time.";
    expect(LOCALIZATION_SECTION_MESSAGE).toBe(refused);
    const values: CompanySettings["localization"][] = [
      whole,
      // A value a tab's rule refuses gets the section's words: no tab rule runs.
      { ...whole, documents: { ...whole.documents, lateFeePct: "12." } },
      // What the path let through before part 3b: a states change without the tax key, a tax block whole.
      { ...whole, region: { ...whole.region, statesOfOperation: ["CO"] } },
      { ...whole, tax: { ...whole.tax, pricesInclude: "inclusive" } },
      // By the name, so a value of no shape is refused too (D33).
      undefined as unknown as CompanySettings["localization"],
    ];
    for (const [i, value] of values.entries())
      expect(settingsSectionProblem("localization", value, whole), String(i)).toBe(refused);
    expect(settingsSectionProblem("numbers", SUMMIT.numbers, SUMMIT.numbers)).toBeNull();
    // The dynamic import reads the package's exports without a second static import of "../src" (S9c).
    expect(Object.keys(await import("../src"))).not.toContain("localizationProblem");
  });
```

**`packages/shared/test/localization-rules.test.ts` LR6** (`T:231-261`):
- Remove the two `settingsSectionProblem("localization", …)` expectations (`T:255-258`).
- The title's ending "; the whole section runs them" becomes "; the whole section is refused (WS1)".
- Remove `settingsSectionProblem` from the imports (`T:35`; LR6 was its only use).
- `DOCUMENT_MESSAGES` and `SUMMIT` stay used.

**`packages/shared/test/region-currency-rules.test.ts` RG7** (`T:199-239`):
- Remove the whole-section block (`T:227-238`): the blank line, `paris`, `keystone`, `added`, the four `settingsSectionProblem` expectations, and the comment "The whole-section path checks no extra key ...".
- The title loses "; the whole section too".
- Remove `settingsSectionProblem` from the imports (`T:19`; RG7 was its only use).
- `changed` (`:204`), `KEYSTONE` (`:38`, used by `CURRENCY :42`), `REGION_MESSAGES` and `CURRENCY_MESSAGES` stay used.

### 7.2 Web (DemoStore and transport)

Each changed web file except demo-tax.test.ts declares, beside its other refusal words: `const SECTION_REFUSAL = "Localization and tax saves one tab at a time.";` (D39).

**`apps/web/tests/unit/demo-localization.test.ts`.** The helpers on `T` are `open`, `holderOf`, `viewingAs`, `OFF`, `DANA`, `PRIYA`, `HARBOR_OWNER`, `ROLE_REFUSAL`, `MODULE_REFUSAL` and `SETTINGS_SCOPE_MESSAGE` (imported).
- **LD13**, rewritten in place (`T:218-227`, the last test of the 2a describe):
```ts
  it("LD13 the whole-section save is refused, even a value every tab's rule takes; nothing is stored or audited (part 3b)", async () => {
    const store = await open("summit", DANA);
    const before = structuredClone((await store.getSettings()).localization);
    const seen = new Set((await store.list("audit")).map((row) => row.id));
    await expect(store.updateSettings("localization", before)).rejects.toThrow(SECTION_REFUSAL);
    await expect(
      store.updateSettings("localization", { ...before, documents: { ...before.documents, lateFeePct: "12." } }),
    ).rejects.toThrow(SECTION_REFUSAL);
    expect((await store.getSettings()).localization).toEqual(before);
    expect((await store.list("audit")).filter((row) => !seen.has(row.id))).toEqual([]);
  });
```
- A new `describe("DemoStore refuses Localization and tax saved whole (ADR 0059, part 3b)", ...)` at the end of the file, holding WD1 and WD2:
  - **WD1:**
```ts
  it("WD1 the refusal comes after the keys, switch and scope; neither key alone saves another tab's settings", async () => {
    const priya = await open("summit", PRIYA);
    const whole = structuredClone((await priya.getSettings()).localization);
    await expect(priya.updateSettings("localization", whole)).rejects.toThrow(ROLE_REFUSAL);
    const branch = await viewingAs(["settings.localization.manage"], "branch");
    await expect(branch.updateSettings("localization", whole)).rejects.toThrow(SETTINGS_SCOPE_MESSAGE);
    OFF.add("settings.localization");
    const off = await open("summit", DANA);
    await expect(off.updateSettings("localization", whole)).rejects.toThrow("This feature is switched off.");
    OFF.clear();
    // Before part 3b either key saved every tab here: Sales tax's key a late fee, the localization key a tax rate.
    const taxOnly = await viewingAs(["settings.tax.manage"]);
    await expect(
      taxOnly.updateSettings("localization", { ...whole, documents: { ...whole.documents, lateFeePct: "2" } }),
    ).rejects.toThrow(SECTION_REFUSAL);
    expect((await taxOnly.getSettings()).localization).toEqual(whole);
    const localOnly = await viewingAs(["settings.localization.manage"]);
    const [first, ...rest] = whole.tax.rules;
    const changedTax = { ...whole.tax, rules: [{ ...first!, ratePct: "9" }, ...rest] };
    await expect(localOnly.updateSettings("localization", { ...whole, tax: changedTax })).rejects.toThrow(
      SECTION_REFUSAL,
    );
    expect((await localOnly.getSettings()).localization).toEqual(whole);
    // Platform module: an HR Suite company reaches the refusal too.
    const harbor = await open("harbor", HARBOR_OWNER);
    await expect(
      harbor.updateSettings("localization", (await harbor.getSettings()).localization),
    ).rejects.toThrow(SECTION_REFUSAL);
  });
```
  Notes on WD1:
  - The module refusal can't be reached, because every company has `platform`.
  - Priya holds neither key (LD9, TD6 show it).
  - Each `open`/`viewingAs` builds a fresh store from the fixtures, so `whole` read from Priya's store equals the others'.
  - The ordering assertions come first: on 3a's head they pass, and the test fails at the tax-only line.
  - **WD2:**
```ts
  it("WD2 resetSettings('localization') is refused too; another section still resets", async () => {
    const store = await open("summit", DANA);
    const before = structuredClone((await store.getSettings()).localization);
    await expect(store.resetSettings("localization")).rejects.toThrow(SECTION_REFUSAL);
    expect((await store.getSettings()).localization).toEqual(before);
    const original = (await store.getDefaultSettings()).numbers;
    await store.updateSettings("numbers", {
      ...original,
      negativeStyle: original.negativeStyle === "minus" ? "parens" : "minus",
    });
    await store.resetSettings("numbers");
    expect((await store.getSettings()).numbers).toEqual(original);
  });
```

**`apps/web/tests/unit/demo-region-currency.test.ts` RD10** (`T:202-208`):
```ts
  it("RD10 the whole-section path can't change the zone: the section is refused whole (part 3b)", async () => {
    const store = await open("summit", DANA);
    const whole = (await store.getSettings()).localization;
    await expect(
      store.updateSettings("localization", { ...whole, region: { ...whole.region, timeZone: "Europe/Paris" } }),
    ).rejects.toThrow(SECTION_REFUSAL);
    expect((await store.getSettings()).localization.region.timeZone).toBe(whole.region.timeZone);
  });
```
`REGION_MESSAGES` stays imported, because RD1, RD2 and RD4 use it.

**`apps/web/tests/unit/demo-settings.test.ts` D5** (`T:132-143`):
```ts
  it("D5 the overtime rule is refused on a Payroll rules save; the whole section is refused before any rule (part 3b)", async () => {
    const store = await open("summit", DANA);
    const localization = (await store.getSettings()).localization;
    const payroll = (overtimeRule: string) => ({ ...localization.payroll, overtimeRule: overtimeRule as "federal" });
    await expect(store.updateLocalization("payroll", payroll("weekly"))).rejects.toThrow(overtimeRuleProblem("weekly")!);
    // California is switched off in the register until a payroll review (ADR 0050).
    await expect(store.updateLocalization("payroll", payroll("california"))).rejects.toThrow(
      overtimeRuleProblem("california")!,
    );
    await expect(
      store.updateSettings("localization", { ...localization, payroll: payroll("weekly") }),
    ).rejects.toThrow(SECTION_REFUSAL);
  });
```
`payrollProblem` returns `overtimeRuleProblem(rule)` first (`C3A:localization-rules.ts:180-186`). LD12 shows Summit's Payroll tab isn't refused for a module reason.

**`apps/web/tests/unit/demo-tax.test.ts` TD9** (3a's file, `T:219-229`; **unconditional**, S2 and D40):
- Add `type CompanyId` to the `@workspace/shared` import.
- After the `@workspace/shared` mock, add:
```ts
/** Summit's Sales tax as a test opens it (data typed before part 3a, D40); null keeps the fixture's. */
const SUMMIT_TAX = vi.hoisted(() => ({ value: null as Partial<LocalizationSettings["tax"]> | null }));

vi.mock("@/lib/api/demo/fixtures", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/demo/fixtures")>();
  return {
    ...real,
    loadCompanyFixtures: async (companyId: CompanyId) => {
      const fixtures = await real.loadCompanyFixtures(companyId);
      const patch = SUMMIT_TAX.value;
      if (companyId !== "summit" || !patch) return fixtures;
      const tax = { ...fixtures.settings.localization.tax, ...patch };
      return { ...fixtures, settings: { ...fixtures.settings, localization: { ...fixtures.settings.localization, tax } } };
    },
  };
});
```
- The file's `afterEach` gains `SUMMIT_TAX.value = null;`.
- TD9 becomes:
```ts
  it("TD9 saved data with tax-inclusive prices can go back to before tax; never the other way", async () => {
    // Only data typed before part 3a holds "inclusive": no save sets it since part 3b (D40).
    SUMMIT_TAX.value = { pricesInclude: "inclusive" };
    const store = await open("summit", DANA);
    expect((await taxOf(store)).pricesInclude).toBe("inclusive");
    await store.updateLocalization("tax", { ...(await taxOf(store)), pricesInclude: "exclusive" });
    expect((await taxOf(store)).pricesInclude).toBe("exclusive");
    await expect(
      store.updateLocalization("tax", { ...(await taxOf(store)), pricesInclude: "inclusive" }),
    ).rejects.toThrow(TAX_MESSAGES.pricesInclude);
  });
```
- Why the patch works:
  - DemoStore builds each company from `loadCompanyFixtures` (`store.ts:2043`, a fresh `CompanyDb` per new store), and `open` builds a new store.
  - The mock only spreads and never mutates the shared JSON object.
  - The mocked path is the module DemoStore imports as `./fixtures`, the same resolution `demo-settings.test.ts` relies on.
  - `taxProblem` compares with the stored value (`C3A:tax-settings.ts:185-186`). The patched fixture is the stored value, because node tests have no saved overlay.
- If 3a's handoff renamed TD9, or set its data some other way that still calls `updateSettings("localization"` or `resetSettings(`, apply the same set-up there and record it.

**`apps/web/tests/unit/settings-answer.test.ts`:**
- W6 (`T:129-136`) and W7 (`T:138-141`) are **unchanged**. W6's DemoStore is a mock, and the routing it pins stays (S9d).
- New **WW1** after W7, in the part 1 describe:
```ts
  it("WW1 api mode: updateSettings('localization') and resetSettings('localization') reach DemoStore, which refuses them; nothing is sent (part 3b)", async () => {
    const store = new DemoStore(noFiles);
    await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
    const api = client(served(), {
      updateSettings: store.updateSettings.bind(store) as ApiClient["updateSettings"],
      resetSettings: store.resetSettings.bind(store),
    });
    await expect(api.client.updateSettings("localization", demo.localization)).rejects.toThrow(SECTION_REFUSAL);
    await expect(api.client.resetSettings("localization")).rejects.toThrow(SECTION_REFUSAL);
    expect(api.sent).toEqual([]);
    expect((await store.getSettings()).localization).toEqual(demo.localization);
  });
```
- How WW1 is wired:
  - `client(answer, demoMethods)` puts the methods on `fakeApi`'s demo stub (`fake-api.ts:21-39`).
  - `routeClient` hands unrouted `resetSettings` to that stub (`router.ts:43-45`).
  - `demo` comes from `beforeAll` (the same fixtures on the same day).

### 7.3 Unchanged tests that matter (run, not edited)

- **API:** L16 and 3a's whole-section ST case (`PUT /settings/localization` 404), every 2a, 2b and 3a localization case (per tab), and part 1's settings cases. No API code changes; stage 5's `pnpm test:api` runs them.
- **Web:** LD6 ("settings.tax.manage saves only Sales tax: the section's any-of is closed for every tab", now true by every path), LD7, LD9, LD10, W5, W6, W7, and 3a's TD1 to TD10 (with TD9's new set-up), TW1 and TW2.
- **Shared:** LR1 to LR5, LR7, LR8, RG1 to RG6, RG8, RG9, R1's keys pin, and 3a's SR1 to SR8.

### 7.4 Red on 3a's head (stage 1)

| Test | On 3a's head | Why |
| --- | --- | --- |
| WS1 | **red** | `LOCALIZATION_SECTION_MESSAGE` is not exported (undefined), the section answers null, and `localizationProblem` is still an export |
| R8 | **red** | null, not the message (`toBe(undefined)` fails on null) |
| LR6, RG7 | pass on both heads | Lines are only removed |
| LD13 | **red** | Dana's valid whole save resolves |
| WD1 | **red** at the tax-only line | The whole save is stored |
| WD2 | **red** | `resetSettings("localization")` resolves |
| RD10 | **red** | The zone's words, not the section's |
| D5 | **red** at its last line | The overtime words, not the section's |
| TD9 | pass on both heads | The set-up no longer uses the whole section |
| WW1 | **red** | DemoStore stores it |

The shared typecheck is red on 3a's head because of the new import; it is not run in stage 1. The web tests use literals and type-check on both heads.

### 7.5 Which test pins which path

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

---

## 8. Mutations: `SP3B/mutate.py`

Write it from `SP2B/mutate.py`, keeping the same runner: `run`, `check`, `main` and the `__main__` block unchanged. It makes one mutation at a time, runs its commands, restores the file with `git checkout --` and checks `restored=True`; `--check` verifies every anchor is found once.

Replace:
- its docstring ("Settings part 3b mutation checks (settings3b/plan-final.md section 8) ...");
- `LOGS` (`.../settings3b/logs`);
- the command and file constants;
- `MUTATIONS`.

Copy the anchors from the **committed** code at stage 2 and adjust them if the committed text differs; `--check` says so. WM6's anchor is 3a's TM40 (`SP3/mutate.py`), checked on 3a's handoff head.

```python
SHARED = ["pnpm", "--filter", "@workspace/shared", "exec", "vitest", "run", "test/settings-sections.test.ts"]


def web(name: str) -> list[str]:
    """A web unit test file, by its full name."""
    return ["pnpm", "--filter", "web", "exec", "vitest", "run", f"tests/unit/{name}"]


DEMO_L = web("demo-localization.test.ts")
DEMO_RC = web("demo-region-currency.test.ts")
DEMO_S = web("demo-settings.test.ts")
DEMO_T = web("demo-tax.test.ts")
ANSWER = web("settings-answer.test.ts")

SECTION_RULES = "packages/shared/src/settings/section-rules.ts"
TAX = "packages/shared/src/settings/tax-settings.ts"
STORE = "apps/web/src/lib/api/demo/store.ts"
METHODS = "apps/web/src/lib/api/http/api-methods.ts"

NAME_CHECK = '  if (section === "localization") return LOCALIZATION_SECTION_MESSAGE;\n'
EXPENSES = "  if (settings.expenses) return expenseSettingsProblem(settings.expenses);\n"
SAVE_ORDER = ("    await this.assertSettingsSave(db, rule);\n"
              "    const problem = settingsSectionProblem(section, value, db.settings[section]);\n"
              "    if (problem) throw new DemoRuleError(problem);\n")
PRICES = "  if (next.pricesInclude !== current.pricesInclude && next.pricesInclude !== TAX_PRICES_APPLIED)\n"

# name: (file, [(old, new), ...], [(command, expected failing test regex), ...])
MUTATIONS = {
    "WM1": (SECTION_RULES, [(NAME_CHECK, "")],
            [(SHARED, r"FAIL .*WS1 "), (DEMO_L, r"FAIL .*LD13 "), (DEMO_RC, r"FAIL .*RD10 "),
             (DEMO_S, r"FAIL .*D5 "), (ANSWER, r"FAIL .*WW1 ")]),
    "WM2": (SECTION_RULES, [(NAME_CHECK, ""),
                            (EXPENSES, EXPENSES + "  if (settings.localization) return LOCALIZATION_SECTION_MESSAGE;\n")],
            [(SHARED, r"FAIL .*WS1 ")]),
    "WM3": (STORE, [(SAVE_ORDER, "    const problem = settingsSectionProblem(section, value, db.settings[section]);\n"
                                 "    if (problem) throw new DemoRuleError(problem);\n"
                                 "    await this.assertSettingsSave(db, rule);\n")],
            [(DEMO_L, r"FAIL .*WD1 ")]),
    "WM4": (STORE, [("    return this.updateSettings(section, this.open().defaultSettings[section]);\n",
                     "    const db = this.open();\n"
                     "    db.settings = { ...db.settings, [section]: db.defaultSettings[section] };\n"
                     "    this.emit();\n"
                     "    return db.settings;\n")],
            [(DEMO_L, r"FAIL .*WD2 ")]),
    "WM5": (METHODS, [("      if (!isApiSettingsSection(section)) return demo.updateSettings(section, value);\n",
                       '      if (!isApiSettingsSection(section) && section !== "localization") return demo.updateSettings(section, value);\n')],
            [(ANSWER, r"FAIL .*WW1 ")]),
    "WM6": (TAX, [(PRICES, "  if (next.pricesInclude !== current.pricesInclude && TAX_PRICES_APPLIED)\n")],
            [(DEMO_T, r"FAIL .*TD9 ")]),
}
```

| Id | File | Mutation | Must fail |
| --- | --- | --- | --- |
| WM1 (3a's TM26) | section-rules | Drop the localization refusal | WS1, LD13, RD10, D5, WW1 (and R8, WD1, WD2) |
| WM2 | section-rules | Refuse by the narrowed value instead of the name | WS1 (the `undefined` value) |
| WM3 | store | Content rules before `assertSettingsSave` | WD1 (Priya gets the section's words, not the role's) |
| WM4 | store | `resetSettings` writes the defaults without `updateSettings` | WD2 |
| WM5 | api-methods | Api mode sends `localization` to the API | WW1 (and W6) |
| WM6 (3a's TM40) | tax-settings | Refuse every `pricesInclude` change | TD9 (its fixture set-up still reaches the rule) |

---

## 9. DemoStore parity

| | API | DemoStore (demo mode, and api mode through the routing) |
| --- | --- | --- |
| Whole-section save | `PUT /settings/localization`: no route, 404, nothing stored (L16, 3a's ST case) | `updateSettings("localization")`: module, either key, switch, scope, then "Localization and tax saves one tab at a time."; nothing stored, no audit |
| Whole-section reset | None | `resetSettings("localization")`: the same |
| What the ApiClient caller sees | Never sent (api mode routes it to DemoStore) | The words, in both modes (WW1) |
| Per-tab saves | Unchanged | Unchanged |

---

## 10. Docs

### 10.1 Session log `docs/sessions/2026-11-17-HHMM-b-settings-localization-section.md`

Write it as 2b's and 3a's logs are written. It holds:
- the prompt (the queue verbatim, the per-task rules);
- the inputs (3a's handoff head and PR, this plan);
- the differences found in stage 0 on 3a's handoff head;
- the short plan and the outline re-check (1.6);
- D16 and D33 to D46;
- the owner questions and which test pins which path (7.5);
- the commands run, red and green results with reasons, and every mutation line;
- the build decisions (a B-list) and the e2e results;
- "For STATUS", "BRANCHES" and the outcome.

Say plainly: "No screen, flow or e2e calls the whole-section save; only unit tests did."

### 10.2 ADR 0059: "## 2026-11-17: part 3b, Localization and tax saves one tab at a time" (stage 4, after 3a's section)

- **Status:** accepted 2026-11-17, branch `feat/settings-localization-section`, draft PR #<n>, stacked on #54 (part 3a) and through it on #53, #52, #51 and #45 to #50; it merges after them. Queue item 2, task 2, part 3b. The owner was asleep, so the safest option was taken wherever something was open. Give the session log path. Code comments cite "ADR 0059, part 3b, D<n>".
- **Context:** since part 2a, screens and the API save Localization and tax one tab at a time, with one key each. DemoStore's `updateSettings("localization")` (and `resetSettings`, through it) still took either key and stored the section whole. So:
  - `settings.tax.manage` alone saved Sales and documents and Payroll rules;
  - `settings.localization.manage` alone saved a tax block whole and unversioned (since 3a);
  - Region's tax key and step-up, Currency's dating and Sales tax's versions were skipped (2b D17).

  No screen called it. In api mode the web sent it to DemoStore, and the API had no route.
- **Decision:** D16 and D33 to D38, in prose; D45 and D46 in one line each.
- **Consequences:**
  - "`settings.tax.manage` is enough to save all of localization" is closed by every path.
  - Nothing a screen calls changes.
  - No API, schema, migration, dependency, auth, tenancy, provider or core change.
  - A future caller of the whole-section save gets the words (it fails closed).
  - The shared exports lose `localizationProblem` and gain `LOCALIZATION_SECTION_MESSAGE`.
  - `SETTINGS_SECTIONS.localization.keys` now only gate the refusal; the menu keeps its own copy.
- **Tests:** WS1, R8, LR6, RG7, LD13, WD1, WD2, RD10, D5, TD9's set-up and WW1; WM1 to WM6.
- **For the owner:** section 15.
- **"Later parts" table row 3** (`T:77`) gains "3b built (2026-11-17, part 3b): the whole section is refused in both modes". 3a's section's "3b (the whole-section save) next" (or its wording) becomes "3b built (part 3b)". 2a's (`T:134`) and 2b's (`T:162`) "Later parts" lines stay as written: dated sections are history.

### 10.3 `docs/api-contract.md` (stage 4, by text on 3a's handoff head)

- **"The web."** (part 1, `T:281`): after "every other section stays on DemoStore until its part", add "; `updateSettings("localization")` stays on DemoStore, which refuses it (Localization and tax saves one tab at a time, part 3b)".
- **"One key per tab."** (part 2a, `T:292`; S9a): after "so `settings.tax.manage` alone saves neither", add "; the whole section is refused in both modes (part 3b)".
- **"Not routes yet"** (part 2a, `T:296`; 3a may have reworded it): the whole-section half becomes "`PUT /settings/localization` (the whole section) answers 404 and is never a route: the section saves one tab at a time; the web's `updateSettings("localization")` is refused by DemoStore with "Localization and tax saves one tab at a time." (part 3b)". Keep whatever 3a wrote about `/tax`.
- **ApiClient rows:**
  - `updateSettings` (`T:771`) adds "`localization` is refused in both modes ("Localization and tax saves one tab at a time."), after the module, keys, switch and scope checks (ADR 0059, part 3b)."
  - `updateLocalization` (`T:772`, which 3a rewrites first; S9a): its "No screen sends the whole `localization` section." becomes "The whole `localization` section is never sent and is refused (part 3b)."
  - `getDefaultSettings` (`T:773`): "saves through `updateSettings`" becomes "saves through `updateSettings`, or through `updateLocalization` per tab for Localization and tax and Sales and documents".
  - `resetSettings` (`T:774`) adds "`localization` is refused (part 3b)."

### 10.4 `docs/product-spec/settings-and-permissions.md` (stage 0, by text on 3a's handoff head)

- **"Save settings"** (`T:340`): after "`DemoStore.resetSettings` exists, but no screen calls it.", add "Localization and tax is never saved whole: `updateSettings("localization")` and `resetSettings("localization")` are refused in both modes with "Localization and tax saves one tab at a time." (ADR 0059, part 3b)."
- **Rule 7**, opening sentence (`T:425`; S3): "Each section names the keys that save it (any one)" becomes "Each section names the keys that save it (any one; Localization and tax's two only reach its refusal, below)".
- **Rule 7**, table row (`T:430`; S3): the keys cell becomes "`settings.localization.manage`, `settings.tax.manage` (only reach the whole-section refusal; saves go per tab, below)".
- **Rule 7**, closing paragraph (`T:450`): replace "The `localization` keys are the demo's whole-section rule for `updateSettings("localization")`, which no screen calls; screens and the API save per tab (`LOCALIZATION_TABS`)." with "Localization and tax is saved only per tab (`LOCALIZATION_TABS`), by screens, DemoStore and the API. Its section keys only decide who reaches the whole-section refusal: `updateSettings("localization")` and `resetSettings("localization")` check the module, either key, the switch and scope, then refuse with "Localization and tax saves one tab at a time." in both modes, storing and auditing nothing; the API has no whole-section route (ADR 0059, part 3b)."
- **Audit row** "Changed localization and tax" (`T:853`):
  - the target becomes "The tab's label: `Region`, `Currency`, `Sales tax`, `Payroll rules` or `Sales and documents` (`Localization and tax` on entries of the whole-section save before part 3b)";
  - the source becomes "`updateLocalization(tab)`. On the API, ..." (drop "; `updateSettings("localization")`").
- **"Closed for every screen"** (`T:891`) becomes "**Closed (ADR 0059, parts 2a and 3b): "`settings.tax.manage` is enough to save all of `localization`."** Each tab checks its own key in both modes (`LOCALIZATION_TABS`), and the whole section is refused (part 3b)." If 3a's handoff says it "stays until 3b", resolve that wording too.
- **"Real build"**: after 3a's part and before "Known limits in api mode", add "**Settings on the API, part 3b (ADR 0059): the whole section.**" with these bullets:
  - "`updateSettings("localization")` and `resetSettings("localization")` are refused in both modes ("Localization and tax saves one tab at a time.") after the module, keys, switch and scope checks; nothing is stored or audited."
  - "The API has no whole-section route (404). Every tab saves on its own route with its own key."

### 10.5 `docs/product-spec/sales.md` (stage 0, by text on 3a's handoff head; M1)

- **`:75`** (Settings > Sales and documents) becomes "| Settings > Sales and documents | `settings.localization.manage` (to open the page and to save it; `settings.tax.manage` alone saves nothing here) | Owner, Accountant | Store: `updateLocalization("documents")`; on the API `PUT /settings/localization/documents` (ADR 0059, part 2a). The whole section is never saved (part 3b). Screen: `DocumentsPage`; menu `apps/web/src/products/settings-menu.ts` |".
- **`:76`** (Tax rates): if 3a's handoff left it as "`settings.localization.manage` or `settings.tax.manage` … Store: `updateSettings`", make it "| Tax rates in Settings > Localization | `settings.tax.manage` | Owner, Accountant | Store: `updateLocalization("tax")`; on the API `PUT /settings/localization/tax` (ADR 0059, part 3a). The whole section is never saved (part 3b) |". If 3a rewrote it, only add the last sentence if it is missing.
- **The audit row** `Changed localization and tax` (`T:682`) becomes "`updateLocalization("documents")` (Sales and documents) or `updateLocalization("tax")` (Sales tax); never the whole section (part 3b)", whatever 3a wrote there (N6).
- **No change:** data-model.md, FEATURES.md, blueprint-delta.md (D43), demo-script.md (1.3).

---

## 11. For STATUS and BRANCHES

The orchestrator applies these. Re-read STATUS first and anchor on the quoted text.

- **"In progress" / "Next three tasks" item 2:** after 3a's "part 3a Sales tax (draft PR #54, `feat/settings-tax-api`, stacked on #53); part 3b retires the whole-section save next", write "...; part 3b, Localization and tax saves one tab at a time (draft PR #<n>, `feat/settings-localization-section`, stacked on #54); then 4 Locations and shared costs, 5 HR, 6 Branding". The line (`T:141`) also carries a stale "then 2b Region and Currency, 3 Sales tax, ..." list; drop it when editing.
- **"Done"** (on merge): "Settings part 3b (queue item 2, task 2), PR #<n> (ADR 0059, 2026-11-17 part 3b section). `updateSettings("localization")` and `resetSettings("localization")` are refused in both modes ("Localization and tax saves one tab at a time.") after the module, keys, switch and scope checks; nothing is stored or audited, and `localizationProblem` is gone. Neither localization key alone saves another tab's settings by any path, and no tax block is stored whole. No screen, API, schema, migration or dependency change. Checks: …"
- **Close:**
  - 2a's "**`updateSettings("localization")`** keeps the any-of keys for `resetSettings` only (DemoStore). Retire it or route it per tab in part 3." (`T:203`, with 3a's addition) → done (part 3b, PR #<n>).
  - 2b's "**The whole-section path** (`updateSettings("localization")`, `resetSettings`, no screen) ... retire it in part 3 (planned as 3b)." (`T:194`) → done. This is also 2b's review note "the whole-section localization save still takes either key …", which lives only in 2b's session log (`:315`), so there is no separate STATUS line to close (S4).
- **Change:** part 1's "**Reset to default** reads DemoStore's originals in api mode; `resetSettings` is unrouted. ..." (`T:213`) gains "; `resetSettings("localization")` is refused (part 3b)".
- **New follow-ups:**
  - **The settings menu repeats `SETTINGS_SECTIONS.localization.keys`** (`settings-menu.ts`'s `anyOf`, and the page's `canLocal || canTax`): read them from the one table.
  - **`settings-input.ts`'s JSDoc** says the API checks bodies with `settingsSectionProblem`, but the controller calls each section's rule directly. Reword it.
- **Owner questions:** a block "Owner questions (PR #<n>, Settings part 3b; none blocks)" with Q1 to Q4.
- **BRANCHES:** a `feat/settings-localization-section` row: "B (Claude)", "Queue item 2, task 2, Settings part 3b: the whole-section localization save retired (main checkout; stacked on #54)", "Draft" then the state at handoff, the PR, and "see the branch".

---

## 12. Build stages

Every heavy command runs alone, in this form: `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <command> > <scratchpad>/settings3b/logs/<name>.log 2>&1; echo "exit $?"`.

**Working rules** (as parts 1 to 3a kept them):
- No plan mode; the short plan goes in the session log. For anything open, take the safest option and record it.
- Run heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) one at a time through `heavy.sh`.
- Api-mode Playwright runs against the throwaway PostgreSQL on 5433. Never re-create, reseed or stop it, and never run `docker compose up` or `stop`.
- Never read, print, create or source an env file or a `*env.sh`.
- Working commits carry `[skip ci]` and are pushed by naming the branch (`git push -q origin feat/settings-localization-section`). Never use a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready`, `gh pr merge` or `rm -rf`.
- Add files by name. Before each commit, `git status --porcelain` must show no scratchpad or `zz-*` file.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pass long texts with `-F` / `--body-file`.
- Never touch `/Users/sarah/dev/flooring-platform-check`.
- **Stop and report** (don't build) if:
  - an ask-before item comes up: a new dependency, altering or adding a table, touching auth, tenancy, providers or `apps/api/src/core`, or a control-database write;
  - an API change looks needed;
  - the product files would exceed 8.

### Stage 0: preconditions, branch, scripts, spec and session log (docs only)

1. **3a has handed off and the checkout is free.**
   - The orchestrator says 3a's session has ended.
   - `cd /Users/sarah/dev/flooring-platform && git status --short` is empty, and `git rev-parse --abbrev-ref HEAD` is not a branch another agent uses.
   - `cd /Users/sarah/dev/flooring-platform && git fetch -q origin && git log --oneline origin/feat/settings-region-currency-api..origin/feat/settings-tax-api` ends in 3a's handoff commit: after `0bfb73b` come its product commit (`0809465` or a successor), its stages 0 to 2 log, e2e, docs, outcome and handoff commits. **If not, stop and report.**
   - `cd /Users/sarah/dev/flooring-platform && git merge-base --is-ancestor origin/feat/settings-region-currency-api origin/feat/settings-tax-api && echo 3a-holds-2b`.
   - `gh pr list --head feat/settings-tax-api --json number,isDraft` gives #54.
2. **Re-check every claim against 3a's handoff head.** Record each difference in the log and follow the code. Use `T=origin/feat/settings-tax-api` in each command.
   - **a. Single-line pass:** `cd /Users/sarah/dev/flooring-platform && T=origin/feat/settings-tax-api && git grep -n -E 'localizationProblem|settingsSectionProblem\("localization"|updateSettings\("localization"|resetSettings\(' "$T" -- apps packages`. Expected, as in 1.3 (on 3a's product code `localization-rules.ts` reads `:387,391`): `section-rules.ts:11,156`, `localization-rules.ts` (the function and its JSDoc), `sections.ts:40`, `store.ts:893`, `contract.ts:903`, and the tests LR6, RG7, LD13, RD10, D5, W6 and **TD9**.
   - **b. Multi-line and variable-section passes (S1):**
     - `cd /Users/sarah/dev/flooring-platform && T=origin/feat/settings-tax-api && git grep -n -A2 -E '(updateSettings|resetSettings|settingsSectionProblem)(<[^>]*>)?\(\s*$' "$T" -- apps packages`. Read each `-A2` block for `"localization"`. Expected: only R8 (two blocks) and the declaration in `section-rules.ts`.
     - `cd /Users/sarah/dev/flooring-platform && T=origin/feat/settings-tax-api && git grep -n -E '(updateSettings|resetSettings)\([a-z][A-Za-z]*[,)]' "$T" -- apps packages`. Expected: only `store.ts:894`, `api-methods.ts:200` and `settings-answer.test.ts:124`.
     - **Any other hit joins the edit list.**
   - **c. No screen, flow, e2e or demo step:** `cd /Users/sarah/dev/flooring-platform && T=origin/feat/settings-tax-api && git grep -n -E 'updateSettings|resetSettings' "$T" -- apps/web/src/features apps/web/src/components apps/web/src/products apps/web/src/app apps/web/tests/e2e apps/web/tests/e2e-api docs/demo-script.md | grep -v -E 'updateSettings\("(branding|profile|expenses|sharedCosts|hr|inventory|meetings|email|numbers|payments)"'` prints nothing. Also confirm `git show "${T}:apps/web/src/features/presenter/guide-steps.ts" | grep -n -i localization` prints nothing.
   - **d. The order and the reset path are unchanged by 3a:**
     - `git show "${T}:apps/web/src/lib/api/demo/store.ts" | grep -n -A3 'async resetSettings'`;
     - `git show "${T}:apps/web/src/lib/api/demo/store.ts" | grep -n -B1 -A3 'await this.assertSettingsSave(db, rule);'`;
     - `git show "${T}:apps/web/src/lib/api/contract.ts" | grep -n -B6 'updateLocalization<'`. 3a left "the rest stay on DemoStore"; 4.2 fixes it.
     - `git show "${T}:packages/shared/src/settings/sections.ts" | grep -n 'API_LOCALIZATION_TABS ='`. All five tabs are expected; otherwise keep 4.2's old `updateLocalization` wording.
   - **e. Docs (widened, M1):** `cd /Users/sarah/dev/flooring-platform && T=origin/feat/settings-tax-api && git grep -n -E 'updateSettings\(.localization|whole section|whole-section|resetSettings|3b|settings\.tax\.manage|any-of|any one|either key|accepts it or' "$T" -- docs/product-spec docs/api-contract.md docs/FEATURES.md docs/adr/0059-settings-on-the-api.md docs/data-model.md`. Review each hit by eye and record its verdict.
     - Change: the places of 10.2 to 10.5.
     - Keep: the page-open rows (spec `:265`, FEATURES `:72`), the per-tab rows (spec `:33`, `:34`, `:207`, `:446`; api-contract `:305`, `:308`; sales `:625`), rule 25 and the dated ADR sections.
     - Add anything new 3a wrote that names the whole section as live.
   - **f. TD9:** `git show "${T}:apps/web/tests/unit/demo-tax.test.ts" | grep -n -A10 'it("TD9'`. Confirm the set-up 7.2 replaces, and record whether 3a's stages 3 to 5 amended it.
3. **Branch:** `cd /Users/sarah/dev/flooring-platform && git switch -q --no-track -c feat/settings-localization-section origin/feat/settings-tax-api`.
4. **Scripts** (scratchpad only):
   - `sed 's#settings2b#settings3b#g' <scratchpad>/settings2b/checks.sh > <scratchpad>/settings3b/checks.sh && chmod +x <scratchpad>/settings3b/checks.sh`
   - `sed -e 's#settings2b#settings3b#g' -e 's#Settings part 2b#Settings part 3b#' <scratchpad>/settings2b/e2e-demo.sh > <scratchpad>/settings3b/e2e-demo.sh && chmod +x <scratchpad>/settings3b/e2e-demo.sh`. Only its `subset` mode is used: every settings page in both projects, Localization and tax and Sales tax, the quote builder, invoices, the audit log and the hr project's settings. Its header's plan pointer is cosmetic.
   - `grep -n 'settings3b/logs' <scratchpad>/settings3b/full.sh <scratchpad>/settings3b/checks.sh <scratchpad>/settings3b/e2e-demo.sh` finds the log folder in all three.
5. **Pre-flight:** `docker ps --format '{{.Names}} {{.Ports}}'` shows 5432 and 5433 (else stop and report). `lsof -ti tcp:3000 -sTCP:LISTEN; lsof -ti tcp:4000 -sTCP:LISTEN` print nothing.
6. **Write** the session log (10.1's first parts, with 1.6's re-check and stage 0's differences) and the spec edits of **10.4 and 10.5**, stated as decided.
7. **Commit 0.** Write `SP3B/commit-0.txt`: `docs(settings): plan for Settings part 3b, Localization and tax saves one tab at a time [skip ci]`, a body (what is refused, in which order, in both modes; nothing calls it; the sales.md permission rows; stacked on #54), and Co-Authored-By. Then `cd /Users/sarah/dev/flooring-platform && git add docs/sessions/2026-11-17-HHMM-b-settings-localization-section.md docs/product-spec/settings-and-permissions.md docs/product-spec/sales.md && git commit -q -F <scratchpad>/settings3b/commit-0.txt && git push -q -u origin feat/settings-localization-section`.
8. **Draft PR.**
   - Write `SP3B/pr-body.md` with: what it does (section 0); "No screen, flow or e2e called the whole-section save; only unit tests did"; "stacked on #54, #53, #52, #51, #50, #49, #48, #47, #46 and #45: merge after them"; section 13; section 15; and `🤖 Generated with [Claude Code](https://claude.com/claude-code)` last.
   - Run `cd /Users/sarah/dev/flooring-platform && gh pr create --draft --base main --head feat/settings-localization-section --title "fix(settings): Localization and tax saves one tab at a time (Settings part 3b)" --body-file <scratchpad>/settings3b/pr-body.md`.
   - Record the number.

### Stage 1: red first (one commit: the tests)

1. Write the tests of section 7 with no product code: the R1 comment, R8, WS1, LR6, RG7, LD13, WD1, WD2, RD10, D5, TD9's set-up and WW1.
2. **Shared** (red: WS1 and R8; LR6 and RG7 pass on both heads): `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh pnpm --filter @workspace/shared exec vitest run test/settings-sections.test.ts test/localization-rules.test.ts test/region-currency-rules.test.ts > <scratchpad>/settings3b/logs/s1-shared-red.log 2>&1; echo "exit $?"`.
3. **Web** (red: LD13, WD1, WD2, RD10, D5 and WW1; TD9 and every other TD pass on both heads): `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh pnpm --filter web exec vitest run tests/unit/demo-localization.test.ts tests/unit/demo-region-currency.test.ts tests/unit/demo-settings.test.ts tests/unit/demo-tax.test.ts tests/unit/settings-answer.test.ts > <scratchpad>/settings3b/logs/s1-web-red.log 2>&1; echo "exit $?"`.
4. **Check each result against table 7.4** and record it with its reason. Read the log with `sed 's/\x1b\[[0-9;]*m//g' <log> | grep -E 'FAIL|✓|×|Tests '`.
   - A test that is red for a test reason (a typo, a helper name) is fixed in the test and run again before the commit.
   - A test meant to be red that passes (for example, a `toThrow` that matched other words) is strengthened until it fails for the right reason.
   - TD9 must pass here: that proves the fixture patch applies.
5. **Commit 1** (the tests, red): write `SP3B/commit-1.txt` (`test(settings): part 3b tests, red on part 3a's head [skip ci]`), `git add` each test file by name, then commit and push (`git push -q origin feat/settings-localization-section`).
6. There is no e2e red run, because no e2e test is added (D41).

### Stage 2: the change, green, then mutations on the committed change

1. **Shared and web** as section 4 (6 files).
2. **Checks:**
   - `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <scratchpad>/settings3b/checks.sh s2 @workspace/shared:test @workspace/shared:typecheck @workspace/shared:lint api:typecheck web:test web:typecheck web:lint`. Every exit must be 0; `api:typecheck` proves the API compiles without `localizationProblem`.
   - `cd /Users/sarah/dev/flooring-platform && pnpm exec prettier --check packages/shared/src/settings/section-rules.ts packages/shared/src/settings/localization-rules.ts packages/shared/src/settings/sections.ts apps/web/src/lib/api/demo/store.ts apps/web/src/lib/api/contract.ts apps/web/src/lib/api/http/api-methods.ts packages/shared/test/settings-sections.test.ts packages/shared/test/localization-rules.test.ts packages/shared/test/region-currency-rules.test.ts apps/web/tests/unit/demo-localization.test.ts apps/web/tests/unit/demo-region-currency.test.ts apps/web/tests/unit/demo-settings.test.ts apps/web/tests/unit/demo-tax.test.ts apps/web/tests/unit/settings-answer.test.ts`. Run `--write` first if needed and commit the tests' reformatting with the product. Run it twice (2a's B9).
   - `git grep -n localizationProblem -- apps packages` prints nothing.
3. **Commit 2 locally (do not push yet):** write `SP3B/commit-2.txt` (`fix(settings): refuse the whole-section localization save in both modes (Settings part 3b) [skip ci]`) and add the 6 product files by name.
4. **Mutations WM1 to WM6** (section 8), on the committed change:
   - Write `SP3B/mutate.py`.
   - Run `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh python3 <scratchpad>/settings3b/mutate.py --check WM1 WM2 WM3 WM4 WM5 WM6`.
   - Then run `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh python3 <scratchpad>/settings3b/mutate.py WM1 WM2 WM3 WM4 WM5 WM6 > <scratchpad>/settings3b/logs/s2-mutations.log 2>&1; echo "exit $?"`.
   - Every line must read `restored=True caught=True`, and then `git status --porcelain` must be empty.
   - If a mutation is not caught, strengthen its test (it must fail on the mutation and pass on the code), commit the test, and run that mutation again.
5. **Session log:** write stages 0 to 2 (red with reasons, green, every mutation line, build decisions) and commit `docs(sessions): Settings part 3b, stages 0 to 2 [skip ci]`. Push both: `git push -q origin feat/settings-localization-section`.

### Stage 3: api-mode and demo e2e (one commit: the log)

No e2e test changes (D41). These runs prove that the settings screens of both modes still save per tab and reset to default on this head.

1. **Api mode, trimmed (S5).** The API is unchanged, but the web build is this branch's. `settings-tax.spec.ts` waits for stage 5's whole suite.
   - Run `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <scratchpad>/flows/api-e2e.sh settings3b-api --build -- tests/e2e-api/settings.spec.ts tests/e2e-api/settings-localization.spec.ts tests/e2e-api/settings-region-currency.spec.ts; echo "exit $?"`.
   - Then run `grep -E "✘|passed|failed|skipped" <scratchpad>/flows/logs/settings3b-api.log`. All must pass.
2. **Demo subset, last** (the builds share `apps/web/.next`): `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh bash <scratchpad>/settings3b/e2e-demo.sh subset > <scratchpad>/settings3b/logs/s3-demo.log 2>&1; echo "exit $?"`. A failure that also fails on 3a's head is recorded with its line, not fixed here.
3. **Commit 3:** add the session log's stage 3 results, write `SP3B/commit-3.txt` (`docs(sessions): Settings part 3b, e2e runs in both modes [skip ci]`), and push.

### Stage 4: docs (one commit)

- Write 10.2 and 10.3 (the ADR section and api-contract). Check stage 0's 10.4 and 10.5 edits against the committed code. Write the session log's build decisions and table 7.5.
- Markdown is in `.prettierignore` (2a's B15), so check the docs by reading them against the code.
- **Commit 4:** write `SP3B/commit-4.txt` (`docs: Settings part 3b (ADR 0059 section, api-contract) [skip ci]`) and push.

### Stage 5: full checks, the whole api-mode suite, review, handoff (one commit)

1. **Full checks** (lint, typecheck, test, test:api, test:hooks; the API suite includes L16, 3a's ST case and every per-tab case): `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh bash <scratchpad>/settings3b/full.sh > <scratchpad>/settings3b/logs/full.log 2>&1; echo "exit $?"`.
2. **The whole api-mode suite** (N5), on a fresh build after stage 3's demo build: `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <scratchpad>/flows/api-e2e.sh settings3b-all-final --build; echo "exit $?"`.
   - Every test must pass. Record the totals and the time.
   - `settings-tax.spec.ts` adds Texas versions once (3a's recorded follow-up).
   - A failure that also fails on 3a's head is recorded with its line, not fixed here.
   - The whole demo suite is not run (D41).
3. **`/review`.**
4. **A fresh read-only security-reviewer** on `origin/feat/settings-tax-api...HEAD`, focused on section 13. No schema review.
   - A blocking finding is fixed with a test that failed first; the rest are recorded.
   - Its summary goes to `SP3B/review-body.md` for the orchestrator.
5. **Handoff:** make the session log's outcome, commands table, "For STATUS" and "BRANCHES" final. STATUS and BRANCHES stay untouched unless the orchestrator says otherwise. **Commit 5:** write `SP3B/commit-5.txt` (`docs(sessions): Settings part 3b outcome, full checks, the api-mode suite and reviews`, no `[skip ci]`) and push.
6. **Ready and merge are the orchestrator's.** They happen in queue order, after #45 to #54 have merged and `origin/main` is merged in:
   - mark the PR ready;
   - `verify` and `e2e` green on the head (`fast` too if it ran);
   - post the reviewer's summary with `gh pr review <n> --comment --body-file <scratchpad>/settings3b/review-body.md`;
   - then run `gh pr merge <n> --squash --delete-branch` on its own.

---

## 13. Security-review focus

**Does a security-relevant path appear?** No server path does: nothing under `apps/api`, packages/db, core, auth, tenancy or providers changes, and `PUT /settings/localization` stays a 404.

But the change decides **who can save tax and payroll settings in the demo**, in both modes. That is a permission check over tax and payroll content, and feature.md step 6 names permissions, tax and payroll. CLAUDE.md's self-merge rule wants a fresh read-only reviewer, and names security-reviewer for permissions and payroll. The safest default is `/review` **and** one fresh read-only security-reviewer pass on this small diff (D42).

Focus:
1. **No path stores the section whole.**
   - `settingsSectionProblem` refuses `localization` by name before anything else (WS1 with an `undefined` value; WM1, WM2).
   - DemoStore's `updateSettings` throws before storing or auditing (LD13).
   - `resetSettings` goes through it (WD2, WM4).
2. **Order and words.** Module, keys, switch, scope, then the refusal. A person without either key gets the role words (WD1, WM3), and nothing about the section leaks to them.
3. **Neither key alone saves another tab.** `settings.tax.manage` can't save documents or payroll, and `settings.localization.manage` can't save tax, by any path (WD1, LD6, LD7, 3a's TD6).
4. **Api mode.** The whole section is never sent to the API and is refused by DemoStore (WW1, W6, W7, WM5). The API has no route (L16, 3a's ST case).
5. **No collateral change.** Every other section's rule and every per-tab save are unchanged: the rest of R8, the D-tests, the LD-tests, 3a's TD and ST cases, `pnpm test:api` and the whole api-mode suite. TD9's set-up change is test-only (WM6).

---

## 14. Risks

- **R1. Merge order.** This branch is stacked on 3a (#54) and through it on #53 to #45. The shared files (`section-rules.ts`, `localization-rules.ts`, `sections.ts`), `store.ts`, `contract.ts`, `api-methods.ts`, the tests and the docs need main merged in after each lands. Part 4 stacks on this branch and also edits `sections.ts` and `store.ts`; keep 3b's edits to the lines named here.
- **R2. 3a was not handed off when this plan was written.** Its product commit was local (`0809465`), and its stages 3 to 5 may still amend TD9, LR6's and RG7's titles, `localizationProblem`'s JSDoc, `contract.ts`, api-contract `:296` and `:772`, and sales.md `:76` and `:682`. Every anchor is by text. Stage 0 re-greps 3a's handoff head and follows it.
- **R3. A caller outside the repo** (a presenter's console snippet, a future screen) of `updateSettings("localization")` or `resetSettings("localization")` now gets the words. This is intended: it fails closed and nothing is stored.
- **R4. The red run.** A `toThrow(undefined)` matches any error, so the web tests use the literal words (D39), and stage 1 checks that every red test fails for its stated reason.
- **R5. TD9's fixture patch** relies on DemoStore building each company from `loadCompanyFixtures` (`store.ts:2043`) and on the mock resolving to the module DemoStore imports. TD9's first assertion fails if the patch did not apply, and WM6 proves the rule is still reached.
- **R6. `resetSettings` had no unit test before.** WD2 now pins numbers, so a later change to reset that breaks other sections is caught.
- **R7. The settings menu's keys** stay a separate copy of `SETTINGS_SECTIONS.localization.keys` (follow-up), unchanged here.
- **R8. Old audit entries** in saved demo data may still name "Localization and tax" as their target. The spec's audit row says so.
- **R9. The whole api-mode suite** in stage 5 grows Summit's `tax_rules` with Texas versions once (3a's follow-up). This is harmless.

---

## 15. Owner questions (none blocks; each with its safest default taken)

- **Q1. Per-tab routing for a whole-section save.** Taken: refused (D16). A future "Reset all of Localization and tax" button would call each tab's save and report each tab's outcome. Route the whole section per tab instead?
- **Q2. An explicit API route for the whole section.** Taken: none (404, deny by default; the web never sends it). Add `PUT /settings/localization` answering 400 with the words, so the API and the demo give the same words?
- **Q3. `resetSettings` in the ApiClient.** Taken: kept. It refuses Localization and tax and still resets other sections, and no screen calls it. Remove it from the contract?
- **Q4. Keep `"localization"` out of the method types** (`Exclude<keyof CompanySettings, "localization">` on `updateSettings` and `resetSettings`). Taken: not done (D45); the runtime refusal with words stays either way. Add the compile-time block too?

---

## 16. Stop-and-ask items

None:
- no dependency;
- no table change;
- nothing in auth, tenancy, providers or core;
- no control-database write;
- no API change.

The builder stops and reports if any of these appears (section 12's working rules).
