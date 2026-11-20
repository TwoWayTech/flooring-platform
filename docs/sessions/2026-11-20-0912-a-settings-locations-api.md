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
