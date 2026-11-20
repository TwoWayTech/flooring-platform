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
