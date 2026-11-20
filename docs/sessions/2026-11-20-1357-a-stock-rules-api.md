# Session 2026-11-20 13:57, A (Claude): Stock rules on the API; stock adjustments stay switched off

Person: A (Claude), on A's Windows laptop, working unattended. Worktree `C:\dev\fp-stock`, branch `feat/inventory-stock-rules-api`, stacked on `feat/notifications-api` (PR #65) and through it on Settings parts 3b to 6. The other checkouts belong to others and are not touched.

**Owner's queue:** item 2, "stock adjustments, with the stock rules section" (STATUS), and ADR 0059 "Later parts" row "with stock adjustments: `inventory` (stock rules)". No plan file exists; this log holds the plan.

## Prompt (orchestrator, summarised)

- Queue item 2. The feature `inventory.adjustments` is switched off with status `removed` (the Owner's Correct stock count replaced it, plan A-1); switching it on is the owner's decision, so it stays off. Pick the safest scope and record it in docs/blueprint-delta.md and ADR 0059.
- Suggested: Stock rules on the API on parts 4b/5/6 and Email's pattern (switch 404, scope `all`, strict body, shared rule, step-up when warranted, one audit row under the row lock), with the shared rule used by the API and DemoStore; loosening the approval threshold treated like loosening payment controls (Owner-only with a step-up). Adjustments' own API only behind the switch, or not built and recorded as an owner question.
- Tests with every change; commit and push after every step; a fresh security reviewer until a round is clean; no server or Playwright run until the ports are free; no PR, no merge, no STATUS or BRANCHES edit.

## What the spec and ADRs say

- inventory.md rule 23: `recordAdjustment` and `reviewAdjustment` (DemoStore) are hidden by `featureOn("inventory.adjustments")`; Correct stock count replaces them; `adjustmentNeedsApproval` is `limit !== "" && |quantity| > limit`. `InventorySettings` has one field, `adjustmentApprovalQty` (seeded `"1000"`), edited in `stock-rules-form.tsx`.
- settings-and-permissions.md: Stock rules is section `inventory` (`settings.locations.manage`, Owner by default, switch `inventory.locations`, module `core`, label "Stock rules"), still saved in the browser in api mode; known limit "The Stock rules form on `/settings/locations` still shows its threshold" while adjustments are off.
- ADR 0059 "Later parts": the row "with stock adjustments: `inventory` (stock rules)"; residual risk "unmoved sections still save in the browser only in api mode (… Stock rules …)". Owner's answer of 2026-11-20 to Q10: loosening a payment control is Owner-only with a step-up.
- The API already has Correct stock count (`POST /stock/corrections`, ADR 0042/0043), which writes an approved `ADJ-` record and posts to Inventory Adjustments. Nothing on the API reads the `inventory` settings row.

## Plan (decisions D1…)

- **D1. Scope: Stock rules move; adjustments stay off and their API is not built.** Building `recordAdjustment`/`reviewAdjustment` on the API would be a whole workflow (pending records, two-person review, ledger postings, notifications, attention count) that answers 404 behind a `removed` switch and that no screen calls: dead code to review and keep. The safest option is to move only the section that today saves in the browser in api mode, and record "adjustments stay switched off; their API is not built" as an owner question (Q1). The adjustments panel's own-request note in STATUS stays open with it.
- **D2. `PUT /settings/inventory`** (the section key, as every other section's path; the web routes it with no other change): guards `settings.locations.manage` and module `core` from `SETTINGS_SECTIONS.inventory`; in the handler the `inventory.locations` switch (404), data scope `all` (403), a strict body (400), the shared rule (400), then under the row's lock the loosening rule (403 `owner_only`) and, for a loosening, a step-up (403 `step_up_required`), then one audit entry "Changed stock rules". Answers the section as saved.
- **D3. The rule** (`packages/shared/src/settings/stock-rules.ts`): `inventorySettingsProblem`: the approval quantity is empty or `QUANTITY_TEXT` (a quantity column's form, up to 3 decimals; no bare point, sign, exponent or space). `settingsSectionProblem` runs it in both modes.
- **D4. Loosening is Owner-only with a step-up** (as Payments, owner's answer to Q10): raising the quantity, or clearing it (empty means no adjustment ever waits), is looser; lowering it, or setting one where there was none, is tighter. `stockRulesLoosened(next, current)` compares by value; a stored value the rule would refuse counts any change as loosening. Judged against the stored row under its lock, after the content rule and before the code. Tightening or keeping needs only the key, with no step-up (Warehouses and showrooms, part 4a, has none either; Q2).
- **D5. Never saved:** answered and judged as `"0"`, the strictest (every non-zero adjustment waits), as Payments' never-saved answer is the strictest. Nothing on the API acts on it today.
- **D6. Who reads it:** `SETTINGS_READERS.inventory`: `settings.locations.manage` only (only the Stock rules form reads it), hidden while `inventory.locations` is off.
- **D7. The page:** `StockRulesForm` passes `problem` (the shared rule, then the Owner-only words) and `stepUp` as a function (only for a loosening), and the input stops at `QUANTITY_TEXT_MAX`.
- **D8. DemoStore:** the same rule through `settingsSectionProblem` and the same Owner-only check in `updateSettings`; its step-up is the dialog.
- **D9. Visibility unchanged:** the form stays on the Warehouses and showrooms page while adjustments are off, as the spec documents (Q3: hide it with the adjustments switch?).

## Tests planned

- packages/shared: `stock-rules.test.ts` (the rule and the loosening judge), `settings-sections.test.ts` (served sections and readers).
- apps/api: `settings-stock.int.test.ts` (route metadata, per-role answer and PUT, never saved, strict body, rule, loosening Owner-only and step-up order, tightening without a code, switch, scope, own company, one audit entry); `settings.int` adjusted only where it lists served sections.
- apps/web units: `settings-answer` (served sections), `demo-settings` (the DemoStore rule and Owner-only loosening).
- api-mode e2e: a Stock rules save on `/settings/locations` (once the ports are free).

## Build decisions (B1…)

- **B1. The path is `/settings/inventory`,** the section key, as every other section's: the web routes it through `API_SETTINGS_SECTIONS` with no transport change.
- **B2. Step-up only for a loosening.** Tightening and keeping need no code (part 4a has none on the same key); a loosening is the Owner's and always asks one. The form's `stepUp` is a function of the draft.
- **B3. Racing first saves refuse** (`firstSave: "refuse"`, review round 1): `SettingsService.save` gained an optional trailing parameter (default `upsert`, so the other sections are unchanged).
- **B4. A stored row of any shape** (`null`, a number, no quantity) is read without trusting it (`quantityOf`); any change to it is a loosening; nothing throws (round 1).
- **B5. No demo test of a malformed stored value:** DemoStore's copy only changes through `updateSettings`, which runs the rule; the shared SR4 covers the function both modes call.

## Owner questions (none blocks; the safest default is taken)

- **Q1. Stock adjustments on the API, or removed for good?** Taken: they stay switched off (`removed`) and get no API routes; the adjustments panel's own-request note in STATUS stays open with this question. Entry conditions for bringing them back are in ADR 0059 (the threshold read through `SettingsService.current`, a malformed threshold refuses, the requester never approves their own, by session user id).
- **Q2. A step-up on every Stock rules save?** Taken: only on a loosening (Owner-only); tightening needs only the key.
- **Q3. Hide the Stock rules form while adjustments are off** (CLAUDE.md rule 13 reading)? Taken: unchanged, it shows on Warehouses and showrooms as the spec documents.
- **Q4. The never-saved answer `"0"`** (strictest) against ADR 0015's 50 and the seed's 1000. Taken: `"0"`; Summit and every seeded company have `"1000"` stored, so only provisioned companies see it, and Reset to default (DemoStore's `"1000"`) is then a loosening only an Owner saves.

## Security review

- **Round 1** (fresh `security-reviewer`): nothing blocking. Non-blocking, all fixed with tests: a jsonb `null` row made the loosening judge throw (500) → `quantityOf`, SR1/SR4/MS7; racing first saves could audit the wrong `before` → `firstSave: "refuse"`, MS13; coverage → MS11 (Owner lowers without a code), MS12 (owner_only before any step-up, with a second factor). Note recorded in ADR 0059: the entry conditions for adjustments.
- **Round 2** (a new fresh reviewer, whole diff): **PASS, nothing blocking**. Four Low items: three test gaps, all added (SR3b value comparison; MS14 an Owner on a malformed or null row is asked for a code and the read still answers; MS15 a first save whose row appears after its judgement is a deterministic 409 with nothing stored or audited, and the route is shown to save with `refuse`); one demo-only parity note (a falsy section value skips `settingsSectionProblem`'s dispatch in DemoStore, the existing pattern for every section; the API refuses it at the body), left as is. Two notes (Reset to default is a loosening for a never-saved company, Q4; adjustments' entry conditions, ADR 0059).

## Mutations

`mutate-stock.mjs` in the scratchpad: one mutation at a time on the file's saved text, `settings-stock.int.test.ts` run, the file restored from the saved copy. 8 mutations (the route's `refuse`, the Owner check, the step-up, the scope check, the content rule; value comparison as text, clearing not a loosening, a malformed stored row trusted): **8/8 caught**.

## Commands and results

- `pnpm lint`, `pnpm typecheck` (root): clean after each step and after each review round.
- `pnpm test` (root), final: shared 1211, web 466, api unit 128, db 18, providers 11, all passed.
- `pnpm --filter @workspace/db test:api`: 59 passed (8 files). `pnpm test:hooks`: 15 passed.
- API integration, whole suite `--maxWorkers=3` (after step 1, while round 1's tests were being edited): 44 files passed, 905 tests; the two failures were in `settings-stock.int` (MS7, MS13), both from that mid-run edit; MS7's seed then wrote SQL NULL for a jsonb null and was fixed. Final: every `settings*.int` file (8 files) **244 passed**; `settings-stock.int` alone **27 passed**.
- **api-mode e2e not run yet:** ports 3000/4000 belong to another builder. `tests/e2e-api/settings-stock.spec.ts` (ST1) is written and typechecks; run it with the launcher when the ports are free, then the whole api-mode suite once.

## What is left

- Run ST1 and the api-mode e2e suite (and demo e2e `settings.spec.ts` / `warehouses.spec.ts`) against a production build when the ports are free.
- The owner's answers to Q1 to Q4.

## For STATUS

- **Queue item 2, "stock adjustments, with the stock rules section":** built on `feat/inventory-stock-rules-api` (stacked on PR #65). Stock rules save on the API (`PUT /settings/inventory`, `settings.locations.manage`, core, the `inventory.locations` switch, scope `all`, `inventorySettingsProblem`); raising or clearing the adjustment approval quantity is the Owner's alone, with a step-up (ADR 0059, "the Stock rules part"). **Stock adjustments stay switched off (`removed`) and have no API** (Q1). Two security review rounds; the second clean. api-mode e2e ST1 written, not run yet (ports).
- Remove "Stock rules" from "Unmoved settings pages save in the browser only in api mode".
- The note "Stock adjustments (`adjustments-panel.tsx`): the own-request check compares `user.id` with DemoStore rows" stays open, now tied to owner question Q1.
- New open questions (safest default taken): Q1 adjustments on the API or removed for good; Q2 a step-up on every Stock rules save; Q3 hide Stock rules while adjustments are off; Q4 the never-saved `"0"`.

## Reviewer summary

Security review of `feat/inventory-stock-rules-api` (Stock rules on the API; ADR 0059, "2026-11-20: the Stock rules part"), two fresh read-only `security-reviewer` rounds.

- **Round 1: nothing blocking.** Fixed with tests: a jsonb `null` stored row made the loosening judge throw (500, fails closed) → the row is read without trusting its shape and any change to a malformed row is a loosening (SR1, SR4, MS7); racing first saves could audit the wrong `before` → the save refuses a first save that finds the row taken (409, MS13); coverage → MS11, MS12. ADR 0059 records the entry conditions for bringing adjustments back.
- **Round 2: PASS, nothing blocking.** Three Low test gaps added (SR3b value comparison; MS14 Owner on a malformed or null row needs a code, the read still answers; MS15 a deterministic first-save 409 with nothing stored or audited, and the route saves with `refuse`). One demo-only parity note left as the existing pattern (the API refuses at the body).
- Checked sound: guard order (module `core`, `settings.locations.manage`) then the switch (404), scope `all` (403), strict body, shared rule (400), then under the row lock `owner_only` before the step-up; tenancy only from the session (MS10); decimal comparison by value with `QUANTITY_TEXT`; never saved is the strictest `"0"`; one audit entry per save; readers limited to `settings.locations.manage`; no `SENSITIVE_FIELDS` name; API, DemoStore and form share one rule and words. Mutations: 8/8 caught. No schema, migration, dependency, provider or core auth/tenancy change. Stock adjustments stay switched off with no routes, by design.
