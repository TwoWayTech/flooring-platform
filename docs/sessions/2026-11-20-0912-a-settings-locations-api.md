# Session 2026-11-20 09:12, A (Claude): Settings part 4a, Warehouses and showrooms on the API (queue item 2, task 2)

Person: A (Claude), on A's Windows laptop, working unattended. Worktree `C:\dev\fp-4a`, branch `feat/settings-locations-api`, base `804e5d7` (the top of the PR stack: part 3b, PR #60). The other checkouts (`C:\dev\flooring-platform`, `C:\dev\fp-work`, `C:\dev\fp-work2`, `C:\dev\fp-3b`) are in use by others and are not touched.

**Queue item 2, Settings part 4a** (ADR 0059 "Later parts" row 4, its locations half). The plan of record is `docs/specs/settings-part-4a-plan.md` (the FINAL plan, written by B's session on 2026-11-17). Its line numbers are stale and it predates part 3b and the owner's answers of 2026-11-20; every edit is anchored on text and re-checked on this branch. Part 4b (shared costs) is not built here.

## Prompt (orchestrator, summarised)

- Build exactly what the 4a plan describes for part 4a: `POST /locations`, `PUT /locations/:id`, `list("locations")` routed in api mode, Settings → Warehouses and showrooms saving there, the conversion check (D21), DemoStore parity, tests and docs.
- No plan mode; this log holds the short plan. For anything open, take the safest option and record it here.
- CLAUDE.md applies in full. Stop and report on a schema change, migration, new dependency, or a change to core auth, tenancy or providers. Never an `.env*` file.
- Commit after each working step, push with `git push -q origin feat/settings-locations-api`. No PR, no merge, no `gh` write. STATUS and BRANCHES are the orchestrator's.
- The plan's laptop-only helpers don't exist here: the commands run directly; api-mode e2e through the orchestrator's `e2e-api.mjs`, one run at a time on ports 3000 and 4000.

## Plan (short)

1. Stage 0: re-check the plan's claims on this branch; this log; the spec edits (settings-and-permissions.md, inventory.md, sales.md rule 19). Commit.
2. Stage 1: the tests of plan section 7 (LNR, LNA, LNW, LND, LNP, LNE, LNS), red on the base. Commit.
3. Stage 2: the 16 product files of plan section 6, green; mutations LNM1 to LNM35 on the committed change (a Node runner). Commit.
4. Stage 3: api-mode e2e (the plan's list) and the demo subset. Commit.
5. Stage 4: docs (ADR 0059 section, api-contract, data-model, FEATURES.md, blueprint-delta row). Commit.
6. Stage 5: lint, typecheck, `pnpm test`, the whole API integration suite, the db suite, the hooks, the whole api-mode suite, a fresh read-only security-reviewer until a clean round. Commit the outcome.

## Stage 0: the plan re-checked on this branch (`804e5d7`)

Greps run in the worktree (`git grep` on HEAD), as plan stage 0 step 2.

- **Names still free:** `LOCATION_RULE`, `LOCATION_MESSAGES`, `locationProblem`, `locationHolds`, `streetAddressProblem`, `QUANTITY_TEXT`, `ADDRESS_MAX`, `ADDRESS_INPUT`, `LocationsService`, `LNR*`, `LNA*`, `LNM*`: none in `apps` or `packages`.
- **Section 1 holds on this branch**, with these differences (followed):
  - `decimal-text.ts`: `TAX_RATE_TEXT_MAX` (`:48`) before `PLAIN_DECIMAL` (`:54`), as planned.
  - `index.ts`: the settings exports end with `./settings/tax-settings` (`:92`); 3b's base added `./settings/payment-controls` (`:90`) before it. The new export goes after `tax-settings`.
  - `settings.controller.ts`: `requireWholeCompany` and `check` module-private (`:58-65`), as planned.
  - `inventory.controller.ts`: `QUANTITY` at `:15`, `requireFeature` at `:41`, as planned.
  - `invoices.service.ts` `convert`: the owner's answer of 2026-11-20 (`d42737c`) stopped conversion from overwriting the quote's total and added `acceptedTotal` to the audit row; `await lockStock(tx);` is still right after `insertInvoice` and before `this.books.post(...)` (`:185-186`). D21's check goes there as planned. `loadLocations` is not yet imported there (`:47` imports `loadMovements, loadProducts, loadRolls`).
  - `store.ts`: `saveLocation` at `:1984` as section 1.4 says (`assertCan` only); `assertSettingsSave` at `:2197` now returns the access (part 2b), so `saveLocation` may ignore it. `diffSummary` is imported (`:137`); `boxedStock` and `dec` are imported and used elsewhere in the store.
  - `permission-rules.ts`: `locations: ["settings.locations.manage"]` at `:22`.
  - `contract.ts`: `saveLocation` JSDoc at `:1287-1291`.
  - `api-methods.ts`: `SERVED_LISTS` at `:129-140` without `locations`; `saveLocation` not in `API_METHODS`.
  - **Users' `knownBranch` changed** (`4c5b67e`, "refuse unknown branches"): the plan's D5 says "unlike `knownBranch`, which stores none"; that precedent no longer holds, and D5's refusal now matches the users routes. Recorded; no code change.
  - `company.spec.ts:191-193` still has the D7 comment and `toContainText("Denver")`.
  - `sales.md` rule 19 (`:304`) now carries the owner's accepted-total sentence; D21's sentence is added after it.
- **FEATURES.md `inventory.locations`** (`:31`) tests column `warehouses.spec.ts`, `migrations.test.ts`; `features.test.ts` looks only in `apps/web/tests/e2e` and `packages/shared/test` (M1 holds).
- **File count:** 16 product files as planned; no 17th file found.

## Decisions and why

The plan's D1 to D24 are taken as written (plan section 5), including the "What changed" items M1 to M3, S1 to S9 and N1 to N10. Build decisions:

- **A1. No red e2e runs on the base.** Plan stage 1 step 7 builds the web twice on 3b's product code (api and demo mode) to watch LNE1, LNE2, LNS1 and LNS2 fail. Skipped to save two production builds on this laptop; the unit and API red runs cover every protection the e2e cases pin, and the e2e specs pass on the change (stage 3). The plan's own expectation for `company.spec.ts`'s exact Branch check was "passes on the base too".
- **A2. LNA16 turns a fresh showroom (made by POST) into a warehouse,** not Main Showroom, so S stays a showroom for the other cases; the same path is pinned.
- **A3. The dialog keeps an address's map position** (`lat`, `lng` optional in `LOCATION_FORM`). Zod drops unknown keys, so without them an edit through the dialog would erase a stored position the API answers; the shared rule still checks them.
- **A4. `api-rereads.test.ts` pins the method counts** (152 routed, 109 writes); `saveLocation` makes them 153 and 110.
- **A5. Holds' boxed stock is summed in SQL with drizzle's `sum()`** (plain `sum(quantity)` grouped by product; a null sum reads as `"0"`), then judged by the shared `locationHolds`.
- **A6. The mutation runner is Node** (`settings4a/mutate.mjs` in the scratchpad): this laptop has no Python. One mutation at a time, a saved copy of each file restored after it, `--check` for the anchors, multi-file mutations (LNM7). API mutations run `settings-locations.int.test.ts` filtered with `-t` to the cases that pin them (the companies are still provisioned in `beforeAll`). LNM12 empties the cleared-default audit loop (`cleared.slice(cleared.length)`) and LNM20 makes `becomesShowroom` always false, the plan's mutations in a form that compiles at the anchor.
- **A7. Users' `knownBranch` changed since the plan** (`4c5b67e`: unknown branches are refused), so D5's "unlike `knownBranch`" no longer holds; the location routes now match the users routes. No code change.
- **A8. Docs written after the code.** The plan writes the spec edits in stage 0; here they were written in stage 4 against the built behaviour, in one docs commit. The ADR section is dated 2026-11-20 (the plan's text says 2026-11-17).
- **Red on the base, by design:** LNA3 (switch off: no route answers 404 too) and LNA14 (no route answers 404 for an unknown id too) pass on 3b's head; every other LNA case is red (POST and PUT answer Nest's 404; LNA18 converts with 201 where 400 is expected). LNA15 is red only because LNA8's location doesn't exist.
- **A9. Part 1's api-mode E1 fills the invoice search until the box holds the number.** With part 4a's spec running before it, E1 step 7 failed three times out of three: the invoices table restores the person's last search (from step 4) when it opens, and the restore landed while Playwright was filling, so the box read "INV-1224INV-1224". E1 passes alone and after `settings-localization.spec.ts`; nothing in this change touches the sales page (`salesData` already read `GET /locations`). `totalOf` now refills until `toHaveValue(number)`; the pair passes.
- **A10. LNE1 and LNE2 each get their own describe with `resetAuthAround`**, as the other settings specs, because LNE2 enrols Dana again and the reset runs only around a describe.
- **A11. Review round 1's purchase-order note** is recorded in the ADR section (purchase orders and contracts don't block, Q4), with no code change.

## Owner questions (none blocks; each with its safest default taken; plan section 15)

- **Q1. Retiring a location.** Taken: not offered (no route, no button). Recommended when wanted: an `active` flag (a schema change) or a soft delete, refused while it holds stock, a transfer, a hold, an open quote or purchase order, or is the company default or someone's default or home location. Build it?
- **Q2. Moving a location to another branch.** Taken: refused. With no removal either, a location added in the wrong branch can only be renamed and stays in every picker. Middle option: allow a branch change while nothing references the location (all 22 referencing columns, under the stock lock). Allow that, always, or never?
- **Q3. One default and unique names in the database** (partial unique indexes). Taken: the rule under the stock lock. Add the indexes (a schema change)?
- **Q4. Open purchase orders or contracts at a warehouse turning showroom.** Taken: they don't block (a receipt names its own warehouse and refuses a showroom; contracts hold no stock). Block them too?
- **Q5. A step-up for location saves.** Taken: none (not an MFA key). Add one?
- **Q6. A company with no branch** can't add a location. Create a first branch at provisioning, or build the branch editor (with the branch limit enforced then)?
- **Q7. Name uniqueness** is company-wide and folded as the stock import folds names. Per branch instead (the import would then need the branch too)?
- **Q8. Who reads locations.** Taken: every member, addresses included, as before. Narrow it?
- **Q9. The dashboard's quotes in api mode** (its warehouse filter now reads the API's locations while `list("quotes")` is still DemoStore's). Move `list("quotes")` with the dashboard task?

## Which test pins which path

| Path | API | Demo | Shared | Web | E2e |
| --- | --- | --- | --- | --- | --- |
| module, key, switch, scope, ceiling | LNA0, LNA1, LNA3 to LNA5b | LND1 | LNR1 | | LNE2 |
| strict body, no id | LNA6 | | | LNW2 | LNE1.7, LNE2 |
| tenancy of ids, branches | LNA2, LNA7, LNA14 | | LNR4 | | LNE2 |
| branch fixed | LNA11 | LND2 | LNR4 | LNP2 | LNE1.2, LNE2, LNS2 |
| names (fold), address, samples, floor area | LNA6, LNA7, LNA8, LNA9 | LND2, LND4 | LNR2 to LNR8, LNR14 | LNP1 | LNE1.2, LNS1, LNS2 |
| default | LNA10, LNA13b | LND5 | LNR9 | LNP3 | LNE1.3 |
| holds (incl. short rows, a declined quote) | LNA12 | LND3 | LNR11 to LNR13 | | LNE1.6, LNE2, warehouses.spec |
| conversion (D21) | LNA18 | | | | |
| the lock | LNA13a | | | | |
| audit | LNA8 to LNA10, LNA13b | LND5 | | | LNE1.5, LNE2 |
| routing, branches from the shell | | | | LNW1, LNW2, api-rereads | LNE1.1, LNE1.7, company.spec |

## Commands run

| Stage | Command | Result |
| --- | --- | --- |
| 0 | the plan's stage 0 greps (above) | as planned, with the differences listed |
| 0 | commit `8219824` (this log) | pushed |
| 1 | `packages/shared: npx vitest run test/location-rules.test.ts` | red: 14 of 14 (the module doesn't exist) |
| 1 | `apps/web: npx vitest run` locations-api, demo-locations, location-form, api-rereads | red, 16 of 18: LNW1, LNW2 and four api-rereads cases (no `saveLocation` route; the demo stub throws), LND1 (role words before module), LND2 and LND3 (no `LOCATION_MESSAGES`), LND4 (`""` stored), LND5 (one audit entry, not two), LND6 (the generic save took it), LNP1 to LNP3 (no exports) |
| 1 | `apps/api: npx vitest run --project integration test/settings-locations.int.test.ts` | red, 29 of 31: POST and PUT answer Nest's 404; LNA18 converts with 201 where 400 is expected; LNA3 and LNA14 pass by design |
| 1 | commit `cc962a3` (the tests) | pushed |
| 2 | shared `location-rules`, `settings-sections`, `access-rules`, `decimal-text` | 56 passed |
| 2 | `pnpm --filter api typecheck`, `pnpm --filter web typecheck` | pass |
| 2 | `apps/api` settings-locations | 31 passed |
| 2 | `apps/web: npx vitest run tests/unit` | 61 files, 441 passed (after A4) |
| 2 | Prettier on the 16 product and 9 test files, `pnpm lint`, `pnpm typecheck`, the shared suite | pass; shared 81 files, 1195 passed |
| 2 | `apps/api: npx vitest run --project integration --maxWorkers=4` settings-locations, inventory, stock-issue, purchasing, sales, invoices, expenses, reports, imports, company, settings, permissions, isolation | 13 files, 265 passed (239 s) |
| 2 | commit `65b4769` (16 product files) | pushed after the mutations |
| 2 | mutations LNM1 to LNM35 (`settings4a/mutate.mjs`) | 33 caught at once. LNM15's edit dropped a comma (a syntax error, not a catch), so the mutation was fixed. LNM19 was caught by LNR12 but not by the API, so LNA12 was strengthened (a declined quote frees the warehouse; commit `4c1c199`). Both caught on the re-run. Every file restored, tree clean |
| 3 | `netstat -ano \| grep -E ":3000 \|:4000 " \| grep LISTEN` before and after every e2e run | nothing listening each time |
| 3 | `NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build`, `pnpm --filter api build` | both exit 0 |
| 3 | `e2e-api.mjs` settings-locations, company, inventory, purchasing, sales, invoices, expenses, reports, settings, login | 28 passed, 2 failed: LNE2 (Dana already enrolled, A10) and part 1's E1 (A9) |
| 3 | `e2e-api.mjs`: settings-locations + settings + reports; settings alone; settings-localization + settings; settings-locations + settings | E1 fails only after settings-locations (A9); after the fixes the pair passes (5 passed) |
| 3 | commit (A9, A10) | pushed |
| 3 | `NEXT_PUBLIC_DATA_SOURCE=demo pnpm --filter web build` | exit 0 |
| 3 | `apps/web: E2E_WORKERS=2 npx playwright test` warehouses, expenses, settings, inventory, stock, quote-warehouse, quote, purchasing, reports, dashboard, audit, flows-batch3, states, tables, shell, a11y, responsive, login `--project=flooring` | 271 passed, 3 skipped (switched-off features), LNS1 and LNS2 among them (5.9 m) |
| 3 | the same for settings, hr, shell `--project=hr` | 7 passed |
| 4 | docs: ADR 0059 section "2026-11-20: part 4a" and row 4; api-contract (new section, plus the `GET /locations`, conversion, `getCompany()`, Records, `save` and `saveLocation` rows); settings-and-permissions.md; inventory.md; sales.md rule 19; data-model.md; FEATURES.md (M1); blueprint-delta row; `features.test.ts` | 7 passed; commit `a40b559` |
| 5 | `pnpm test` | providers 11, db 18, api 126, shared 1195, web 441 passed |
| 5 | `pnpm test:hooks` | 15 passed |
| 5 | `apps/api: npx vitest run --project integration --maxWorkers=4` (the whole API suite) | 42 files, 829 passed (523 s) |
| 5 | `pnpm --filter @workspace/db test:api` | 8 files, 59 passed |
| 5 | `pnpm lint`, `pnpm typecheck` | pass |
| 5 | fresh `NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build` and `pnpm --filter api build`, then `node <scratchpad>/e2e-api.mjs C:/dev/fp-4a tests/e2e-api` (the whole api-mode suite, one worker) | 57 passed (6.0 m); ports free after |
| 5 | fresh read-only security-reviewer on `804e5d7..HEAD` | PASS, no blocking findings (below) |

### Mutations (on the committed change `65b4769`; LNA12 strengthened in `4c1c199`)

```
LNM1  POST's key → inventory.transfer.create          caught by LNA0
LNM2  drop the switch in createLocation               caught by LNA3
LNM3  drop the scope check in updateLocation          caught by LNA5
LNM4  drop .strict() on LOCATION                      caught by LNA6
LNM5  drop lockStock in the save                      caught by LNA13a
LNM6  drop notFound("location")                       caught by LNA14
LNM7  update writes branchId, rule's branchFixed gone caught by LNA11, LNR4
LNM8  drop the unknown-branch check                   caught by LNR4, LNA2, LNA7
LNM9  names compared trimmed, case-sensitive          caught by LNR8, LNR10, LNA7
LNM10 drop oneDefault                                 caught by LNR9, LNA10
LNM11 cleared always empty                            caught by LNA10, LNA13b
LNM12 the cleared default's audit loop empty          caught by LNA10, LNA13b
LNM13 main audit before: null                         caught by LNA9
LNM14 rolls ignored                                   caught by LNR12, LNA12
LNM15 boxed stock ignored                             caught by LNR12, LNA12 (re-run, mutation fixed)
LNM16 transfers from only                             caught by LNR12, LNA12
LNM17 reservation status ignored                      caught by LNR12, LNA12
LNM18 quote lines ignored                             caught by LNR12, LNA12
LNM19 quoteIsOpen → true                              caught by LNR12, LNA12 (re-run, LNA12 strengthened)
LNM20 becomesShowroom always false                    caught by LNR11, LND3, LNA12
LNM21 a blank floor area kept                         caught by LNR14, LND4
LNM22 QUANTITY_TEXT with 2 decimals                   caught by LNR7, LNP1, LNP3, LNA9
LNM23 drop warehouseSamples                           caught by LNR6, LNA7
LNM24 drop the samples upper bound                    caught by LNR6
LNM25 drop the ZIP check of streetAddressProblem      caught by LNR5, R2
LNM26 drop locations from SERVED_LISTS                caught by LNW1
LNM27 saveLocation always POST                        caught by LNW2
LNM28 the id sent in the body                         caught by LNW2
LNM29 assertSettingsSave → assertCan                  caught by LND1
LNM30 generic save of locations allowed               caught by LND6
LNM31 locationSave takes the form's branch on edit    caught by LNP2
LNM32 locationSave answers no problem                 caught by LNP3
LNM33 names compared lower-case, not folded           caught by LNR8, LNA7
LNM34 a short row counts as a hold                    caught by LNR12, LNA12
LNM35 drop the conversion's warehouse check           caught by LNA18
every line: restored=true caught=true; git status clean after
```

## Review (stage 5)

A fresh read-only security-reviewer pass on `804e5d7..HEAD`, focused on plan section 13: **PASS, no blocking findings.** Two low, non-blocking notes:
1. Open purchase orders don't stop a warehouse becoming a showroom. Their receipts are then refused there ("Receive into a warehouse.", under the stock lock) and must be received into another warehouse. This is already owner question Q4, and the ADR section now says so (A11).
2. Quote saves read the kind without the stock lock (by design, R16). D21's conversion check sits after `lockStock` and before posting or holding, and its refusal rolls back the invoice row and its number. LNA18 already asserts that invoices, reservations and journal entries are unchanged.

No code change was needed, so the first round is the final clean round.

Summary for the PR review comment (for the orchestrator):

> Security review (read-only), feat/settings-locations-api, diff 804e5d7..HEAD: PASS, no blocking issues. `POST /locations` and `PUT /locations/:id` take the company only from the session through TenantConnectionService. They are guarded in order by the `core` module, the shared `settings.locations.manage` key (with the ceiling), the `inventory.locations` switch (404) and data scope `all` (403), so the HR Suite and narrower scopes are refused. Ids are made by the server and never read from the body. Another company's or a deleted id is 404. A new location's branch must be a live branch of the company (checked in JS, no SQL cast), and a location's branch never changes, so expense scope stays stable. Every save runs under the stock lock every stock writer takes, so turning a warehouse into a showroom is judged against current stock, transfers in transit from or to it, active non-zero reservations and open quotes; the single default and unique names are kept under the same lock. The quote conversion's re-check sits after the stock lock and before any posting or reservation, and a refusal rolls back the invoice. Audit entries cover each saved row and each cleared default. The web goes through the ApiClient only, and DemoStore matches the API's order. Non-blocking: open purchase orders are not a hold (owner question Q4), so their receipts go to another warehouse after a conversion.

`/review` was not run as a slash command (unattended subagent session); the fresh security-reviewer pass is the self-merge rule's reviewer for permissions and data scope.

## For STATUS (the orchestrator applies these; plan section 11; re-read STATUS first and anchor on the quoted text)

- **In progress / next:** "...; part 4a, Warehouses and showrooms (`feat/settings-locations-api`, stacked on #60); then 4b Shared costs, 5 HR, 6 Branding".
- **Done (on merge):** "Settings part 4a (queue item 2, task 2), PR #<n> (ADR 0059, 2026-11-20 part 4a section). Settings → Warehouses and showrooms lists and saves on the API: `POST /locations` and `PUT /locations/:id` (core, `settings.locations.manage`, the `inventory.locations` switch, scope `all`, strict bodies), with the shared rules under the stock lock (folded unique names, a fixed branch, one default warehouse). A warehouse becomes a showroom only with no stock, transfer in transit, stock held for an invoice or open quote; short rows don't count. One audit entry per saved row. Converting a quote re-checks its warehouses under the stock lock (D21). `list`/`get("locations")` are the API's in api mode, and the page names branches from the shell. The demo applies the same rules and refuses the generic save of locations. 16 product files; no schema, migration or dependency change. 35 mutations caught; security review PASS."
- **Change:** "The branch limit is stored, not enforced, until Settings → Locations moves to the API." → "... until a branch editor exists (Warehouses and showrooms moved in part 4a; locations aren't branches). `apps/api/src/core/access/plan-limits.ts`'s comment still names Settings → Locations (core, left as is)."
- **Change:** in the `newBranch` note, "When Settings → Locations moves" → "When a branch editor or branch removal exists". Part 4a removes nothing.
- **Change:** the unmoved-pages list loses "Warehouses and showrooms".
- **Change:** "The Expenses page is mixed in api mode": add "its location list is the API's since part 4a, so a saved fixed split keys the API's ids in the browser until 4b".
- **Close:** "Decide whether `GET /locations` honours the `inventory.locations` switch" (part 4a D3: it doesn't; POST and PUT answer 404 while it's off; FEATURES.md says so).
- **Change:** the branch-scoped admin line: add "Locations: every save needs data scope `all` (part 4a)". The `knownBranch` line: users' routes now refuse unknown branches too (A7), and `POST /locations` does the same.
- **Change:** the order of later parts: "4 Locations and shared costs (split into 4a and 4b)".
- **New follow-ups:**
  - The dashboard's quotes in api mode no longer match its warehouse filter, because `list("quotes")` isn't served (R3, Q9).
  - Saved demo data with an empty floor area breaks the demo Business report until the location is saved again or 4b's reader fix lands (R5).
  - Short rows stay at a location that became a showroom (R15).
  - Quote saves don't take the stock lock; conversion re-checks (R16).
  - A location added in the wrong branch is permanent (R17, Q1, Q2).
  - There are no indexes for the default and the names (Q3).
  - A company with no branch can't add a location (Q6).
  - `global-setup.ts` could heal a renamed Southgate Showroom with a `@workspace/db/testing` helper (N8).
  - The whole-company scope check is copied in `finance/company-wide.ts`, `reports/report-access.ts`, `hr/commission-records.ts` and `hr/pay-records.ts` (D23 sweep; it belongs in `apps/api/src/core/access`).
  - The invoices table's restore of a remembered search races a fill. Part 1's E1 now refills (A9); other specs that search after a remembered view could meet the same race.
- **Owner questions:** "Owner questions (Settings part 4a; none blocks)" with Q1 to Q9 above.
- **BRANCHES:** a `feat/settings-locations-api` row: "A (Claude)", "Queue item 2, task 2, Settings part 4a: warehouses and showrooms on the API (worktree `C:\dev\fp-4a`; stacked on #60)", the state at handoff, the PR once opened, "see the branch".

## Outcome

Built as planned: 16 product files (2 new, `contract.ts` JSDoc only, `settings.controller.ts` one `export`), 10 test files (6 new; `api-rereads`, `warehouses.spec`, `company.spec`, and part 1's `settings.spec` for A9), docs (spec, inventory.md, sales.md, api-contract, ADR 0059 section, data-model, FEATURES.md, blueprint-delta row). Every check passes: lint, typecheck, `pnpm test`, the whole API integration suite, the db suite, the hooks, the demo subset in both projects and the whole api-mode suite. 35 mutations caught. Security review PASS. No schema, migration, dependency, core, auth, tenancy or provider change. No servers left running. No PR opened (the orchestrator's).

## What's left

- The orchestrator: open the draft PR (stacked on #60), apply "For STATUS" and BRANCHES, post the review summary, and later ready and merge in queue order.
- Part 4b (Shared costs), planned in full from plan section 17.
- The owner questions Q1 to Q9.
