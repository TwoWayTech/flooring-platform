# Settings on the API, part 4a: Warehouses and showrooms (`feat/settings-locations-api`), FINAL plan

> **Status: planned, not built.** Written read-only by B's night session on 2026-11-17 (a plan, a critic and a final pass) and committed at the owner's stop so it isn't lost on one laptop. Re-check every file:line against the branch you build on and anchor edits on text.
>
> **Laptop-only helpers.** `<scratchpad>` is B's session folder on B's Mac; nothing in it is in the repo. On another machine:
> - `<scratchpad>/heavy.sh <command>` only runs the command one heavy job at a time (8 GB laptop): run the command directly.
> - `<scratchpad>/flows/api-e2e.sh <label> [--build] [-- <args>]` builds the API and the web in api mode (after `--build`) and runs `pnpm --filter web test:e2e:api <args>` (`playwright.api.config.ts`, which loads the env files itself).
> - `<scratchpad>/<key>/full.sh` runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:api` and `pnpm test:hooks` in turn.
> - `checks.sh`, `e2e-demo.sh` and `mutate.py` are the builder's own small scripts (targeted checks, a demo-mode build and Playwright run, and mutation runs that restore each file); write your own or run the commands they name.

Queue of 2026-11-16, item 2 ("Move the remaining screens to the API: GET /company first (...), then Settings, ..."), task 2, part 4 (ADR 0059 "Later parts" row 4: "Warehouses and showrooms (`POST/PUT /locations`, `settings.locations.manage`, core, scope `all`) and `sharedCosts` (`fixedPctProblem` on the server). Branch limit stays stored, not enforced, until a branch editor exists. Security review (data scope)").

**Part 4 is split (D1).** **4a** (this plan, built in full): the locations collection on the API (`POST /locations`, `PUT /locations/:id`), `list("locations")` routed in api mode, Settings → Warehouses and showrooms saving there, and the one conversion check that keeps a showroom from ever holding stock for an invoice (D21). **4b** (section 17, outlined only): the `sharedCosts` section (`PUT /settings/sharedCosts`, `fixedPctProblem` on the server). 4a is stacked on part 3b (`feat/settings-localization-section`, draft PR #55 expected), which is stacked on 3a (#54), 2b (#53), 2a (#52), part 1 (#51) and #45 to #50, while GitHub Actions is blocked by billing.

- **Paths.** `SP` = `<scratchpad>`; `SP4` = `SP/settings4` (this plan; `full.sh` and `logs/` exist); `SP2B` = `SP/settings2b` (`checks.sh`, `e2e-demo.sh`, `mutate.py` to copy). Section 12 writes every command out in full.
- **Refs** (read with `git show` / `git grep` from the main checkout; a planning session never checks out, fetches or edits there):
  - `B` = `origin/feat/settings-region-currency-api`, 2b's handoff head **`cfb907f`** (#53). Section 1 was read here; line numbers are on `B` unless marked `T:`.
  - `T` = `origin/feat/settings-tax-api` (3a, #54). **Now on origin at `6c452d4`**: `7137931` (plan, spec), `0bfb73b` (tests), **`0809465` (product, 16 files)**, `6c452d4` (session log, stages 0 to 2). 3a's stages 3 to 5 (e2e, ADR 0059 and api-contract sections, handoff) had not landed when this was written. Lines marked `T:` are on `6c452d4`. 3a's product commit touches none of 4a's logic: `decimal-text.ts` gains `TAX_RATE_TEXT`/`TAX_RATE_TEXT_MAX` **after `FX_RATE_TEXT_MAX` (`T:39-48`), before `PLAIN_DECIMAL` (`T:54`)**, not at the end; `index.ts` gains `./settings/tax-settings` at `T:91`; `settings-input.ts` gains `TAX_INPUT`; `settings.controller.ts` changes its imports and adds the tax handler (`requireWholeCompany` is still `T:58-60`, `check` `T:63-65`); `sections.ts`, `api-methods.ts` and `settings-answer.ts` change comments or `API_LOCALIZATION_TABS` only. `invoices.service.ts`, the inventory module, `store.ts`'s `saveLocation`, the locations page and dialog are unchanged from `B`.
  - `L` = `origin/feat/settings-localization-section` (3b). **Not on origin yet**; taken from `SP/settings3b/plan-final.md`. 3b changes `section-rules.ts` (imports `:3-11`, a new `LOCALIZATION_SECTION_MESSAGE` and the body of `settingsSectionProblem`), `localization-rules.ts` (removes `localizationProblem`), JSDoc in `sections.ts`, `store.ts` (`updateSettings`, `updateLocalization`, `resetSettings`), `contract.ts` (the same three) and the comment above `getSettings` in `api-methods.ts`, and spec text in `settings-and-permissions.md` and `sales.md` (`:75`, `:76`, `:682`). 4a edits other hunks of `section-rules.ts`, `store.ts`, `contract.ts`, `api-methods.ts` and `sales.md` (rule 19, `:304`). **Stage 0 re-reads `L` and follows the landed code.**
  - zsh: write `git show "${L}:path"`, never `$L:path` (`:a` is a zsh modifier).
- **Test ids** (checked with `git grep` on `T` and in 3a's and 3b's final plans; none exists; 3b took `WS`, `WD`, `WW`, `WM`; 3a took `SR`, `ST`, `TW`, `TD`, `TP`, `TE`, `S7`, `S8`, `TM`): shared `LNR`, API `LNA`, web transport `LNW`, DemoStore `LND`, dialog `LNP`, api-mode e2e `LNE1`/`LNE2`, demo e2e `LNS1`/`LNS2`, mutations `LNM`.
- **Decision labels** `D1` to `D24` are part 4a's own; code comments cite "ADR 0059, part 4a, D<n>". Owner questions `Q1` to `Q9`, risks `R1` to `R18`.

---

## What changed from plan.md

`SP4/critic.md` was applied. Every item was re-checked against the code on `T` (`6c452d4`), and 3b's final plan replaced its draft.

| Id | Item | Taken? | Where it lands |
| --- | --- | --- | --- |
| **M1** | `features.test.ts:52-53` (`T`) looks for a FEATURES.md test file only in `apps/web/tests/e2e` and `packages/shared/test`, so naming `settings-locations.spec.ts` (e2e-api) turns it red | **Taken** | 10.5: the tests column adds `location-rules.test.ts`; the api-mode spec is named in the Notes text only |
| **M2** | LNA13(b)'s "four audit entries" is 3 or 4 depending on which racing PUT runs first, because one of A and B is already the default | **Taken** | 7.2 LNA13(b): a third warehouse C is made the default first, so each racing PUT clears exactly one row (2 + 2 = 4 either way); the assertions are by content, not by time (`audit_log.at` is the writer's clock, and the waiting transaction started earlier) |
| **M3** | LNE1 step 1's `toContainText("Colorado Springs")` passes on the City cell ("Colorado Springs, CO", `locations-page.tsx:55`) even when the Branch cell is empty; LNS1 and `company.spec.ts:193` have the same masking | **Taken** | 7.6 LNE1.1, 7.7 LNS1 and 7.8: the Branch cell is checked exactly (`getByRole("cell", { name, exact: true })`; `<td>` cells, `data-table.tsx:355`). `company.spec.ts:191-193` becomes an exact check on Denver Central's Branch cell ("Denver"), not a comment edit |
| **S1** | Quote saves read the warehouse's kind without the stock lock, so a quote saved while its warehouse becomes a showroom can stay open there; `convert` (`invoices.service.ts:152-205`) checks no kind and would reserve short at a showroom | **Taken, option (a)** | **D21**, 4.3: `convert` checks, right after `lockStock(tx)` (`:184`), that the quote's header and line warehouses are still live warehouses ("Fulfil the quote from a warehouse.", the quote save's words). +1 product file. New test **LNA18**, mutation **LNM35**, spec `sales.md` rule 19, R16 |
| **S2** | Name uniqueness (trim, case) is weaker than the stock import's lookup by name (`fold`: trim, lower case, spaces, dashes and underscores as one space; `import/fields.ts:24-28`, `lookup.ts:10`, `:51-53`), so "Denver-Central" could sit next to "Denver Central" and imported stock would land in the first | **Taken** | **D9**, 4.2: `locationProblem` compares names with `fold` (imported from `../import/fields`). LNR8 and LNA7 gain dash, underscore and double-space cases; mutation **LNM33** |
| **S3** | A short row (`active`, `quantity` "0", `shortBy` > 0) counted as a hold, but it can't be issued (`stock-issue.service.ts:147` `T`) and only voiding the invoice releases it (`invoices.service.ts:556-562`), so "Issue or release it" couldn't be followed | **Taken: a short row doesn't count** | **D22**: a hold counts only when its quantity is above zero, read by value (`"0.000"` from the API). A short row holds nothing, and nothing ever fills it (inventory.md `:501` "Short lines stay short"). `heldStock`'s words become "... has stock held for invoices. Issue it, or void the invoice, before making it a showroom." LNR12 and LNA12 step 5b; mutation **LNM34**; R15 |
| **S4** | `countyLength` can't be reached on the API (part 1's `county: z.string().max(100)` has no words and runs first), so the two modes answer differently | **Taken: the rule drops it** | **D10**: the location rule is exactly the profile's address rule; every address length (street 200, city 100, ZIP 10, county 100) is bounded by the API body without words, as part 1 does, and the dialog's inputs stop typing there. `LOCATION_MESSAGES.countyLength` is gone; LNR5 loses the county case; LNA6 gains "a county of 101 characters → 400 `invalid_request`". Giving `ADDRESS_INPUT` words would change Company profile's answers, which part 1 pins |
| **S5** | A fourth copy of `requireWholeCompany` (`settings.controller.ts:58-60` `T`) and of `check` | **Taken** | **D23**: `settings.controller.ts` exports `requireWholeCompany` (one word; +1 product file) and the inventory controller imports it. No `check` copy: the service writes `if (problem) throw refuse(problem)`. A new `settings-scope.ts` was not taken: it would make 17 product files. The sweep of the other copies (finance, reports, hr) is a STATUS follow-up |
| **S6** | LNA12.6 and LND3 decline a draft quote, which both modes refuse (`quoteActions`: a draft offers only "send") | **Taken** | LNA12 step 6: `PUT /quotes/:id` moves the draft to A; LND3: `saveQuote` with Denver Central's `locationId` |
| **S7** | If LNE2's POST with a demo branch ever passed the branch check, it would create a location nothing can remove from the shared e2e database | **Taken, and widened** | LNE2's POST also carries the name "Southgate Showroom", so a broken branch check is still refused (on the wrong words) and writes nothing. **New:** LNE1 and LNE2 also register a clean-up that puts Colorado Springs back as a warehouse, so a broken holds check can't leave it a showroom for every later test |
| **S8** | `page.route("**/api-proxy/locations")` also catches the page's GET reads | **Taken** | LNE1 step 7: `page.route(/\/locations(\?.*)?$/, …)`, whose handler calls `route.fallback()` for anything but a POST and fulfils every POST to a URL ending in `/locations` (so a changed prefix can't let it through) |
| **S9** | `FLOOR_AREA_TEXT` repeats the inventory controller's `QUANTITY` pattern (`inventory.controller.ts:15`) | **Taken** | **D23**: `decimal-text.ts` gains `QUANTITY_TEXT` and `QUANTITY_TEXT_MAX`, placed after `TAX_RATE_TEXT_MAX`; the controller's `QUANTITY` and the floor area both use it. `FLOOR_AREA_TEXT` is gone |
| N1 | `TAX_RATE_TEXT` is not at the end of `decimal-text.ts` | Taken | Stage 0 greps for it |
| N2 | `index.ts`'s new export goes after `./settings/tax-settings` (`T:91`) | Taken | 4.2 |
| N3 | LND3 can't catch LNM15 (Colorado Springs also has rolls) | Taken | Section 8: LNM15 is caught by LNR12 and LNA12 step 1 only |
| N4 | A no-op save is audited too | Taken (reworded) | D13 says "every saved row", as every settings save since part 1 (no unchanged-skip in `settings.service.ts`) |
| N5 | Seeded ids are UUID v5 | Taken | 4.3 keeps `new ParseUUIDPipe()` with no version; **new:** LNW2 sends a v5 id and expects PUT (`isSaved` takes any UUID, `api-methods.ts:1032-1034` `T`) |
| N6 | `sameName` should name the stored name | Taken | `sameName(existing.name)`; LNR8, LND2, LNS2, LNE2 expect "Another location is already called Denver Central." |
| N7 | feature.md step 4 hands API and Playwright tests to test-writer | Taken (recorded) | **D24**: as parts 1 to 3b (their session logs, e.g. 3a's D22), the builder runs as a subagent without one and writes them from section 7 |
| N8 | `global-setup.ts` could heal a renamed Southgate | Taken (STATUS) | Section 11, item 13 |
| N9 | DemoStore's `saveLocation` reads the company twice | Taken | 4.5: `const { branches } = await this.getCompany();` once after `assertSettingsSave` |
| N10 | A fixed branch plus no removal makes a location added in the wrong branch permanent | Taken (Q2, R17) | Q2 offers the middle option (a branch change while nothing references the location, all 22 references checked) |
| 4b (a) to (e) | The critique's notes on the 4b outline | Taken | Section 17 |
| New | DemoStore's audit texts were left to "check at build time" (`diffSummary(null, x)` gives `": null"` noise, `admin-rules.ts:49-68`) | Decided | 4.5: an add keeps today's `"<kind>[, default]"`; a change and a cleared default use `diffSummary(before, after)` |
| New | LNE1 step 8 compared the page's save with "the healed record" (a PUT body with `"2400"`) | Fixed | It compares GET with GET (the read right after the heal) |
| New | 3a's product and session-log commits landed; 3b's plan is final | Followed | Refs above; stage 0's greps; section 6 counts **16 product files** (two new, one comment-only, one one-word export) |

---

## 0. Summary

- **What moves.** In api mode Settings → Warehouses and showrooms lists and saves on the API: `POST /locations` (add) and `PUT /locations/:id` (change), beside the existing `GET /locations` in the inventory module (module `core`, class guard). Each needs `settings.locations.manage` (from a shared `LOCATION_RULE` that reuses `SETTINGS_SECTIONS.inventory`'s key, switch and module), the `inventory.locations` switch (404), data scope `all` (403, "Company settings cover the whole company.", the settings controller's own `requireWholeCompany`, now exported), a strict body (400), then, **inside one transaction under the stock lock** (`lockStock`, the advisory lock every stock writer takes), the shared rules against the live rows (400 with the rule's words), then the write and one audit entry per saved row ("Added location", "Changed location", target the location's name). No step-up (not an MFA key; D2). `list("locations")` and `get("locations")` go to `GET /locations` in api mode, so the four screens that call `list("locations")` directly read the API's ids; `saveLocation` sends a UUID id (v7 or the seed's v5) to `PUT` and anything else to `POST`, never the id in the body.
- **What editing may do (D4 to D11, D22).** Name (1 to 80 characters, unique among live locations as the stock import compares names: trimmed, ignoring case, spaces, dashes and underscores as one space), address (the company profile's address rule and words; lengths bounded by the body and the inputs, as part 1), display samples (whole 0 to 100,000, showrooms only), floor area (blank, or `QUANTITY_TEXT`: sq ft with up to 3 decimals, as the API answers `numeric(14,3)`) change freely. **The branch is fixed once added** (expenses' branch scope reads a location's branch live, and a quote takes its branch from its warehouse on every save, so a move would re-scope history). **Showroom → warehouse** is always allowed. **Warehouse → showroom** is refused while the location holds stock (a roll with length left, in transit or not; boxed stock not zero), has a transfer in transit to or from it, holds stock for an invoice (an active reservation with a quantity above zero; a short row holds nothing, D22), or is where an open quote ships from (header or line). **One default warehouse** stays: a showroom can't be it, a save that leaves none is refused, a new default clears the old (both rows audited).
- **Converting a quote (D21).** Quote saves read the warehouse's kind without the stock lock, so a quote saved at the moment its warehouse becomes a showroom can stay open there. `POST /quotes/:id/invoice` now checks, under the stock lock it already takes, that the quote's header and line warehouses are still warehouses ("Fulfil the quote from a warehouse."). With it, no path can hold stock for an invoice at a showroom.
- **Deactivating or removing a location is not offered (D4).** No screen asks for it, the table has no active flag (adding one alters a table: ask-before), a soft delete would hide the location from every picker while 22 columns in 19 tables still point at it, and the foreign keys make a hard delete impossible. Asked as Q1 with a recommended design.
- **The demo** gets the same order, rules and words through the same shared functions: `saveLocation` now checks module, key, switch and scope (`assertSettingsSave`, was the key only), runs the shared rules and the holds check on its own records, stores a blank floor area as none (an empty text broke the demo's Business report, `dec("")` in `weightsFor`), audits a cleared default too, and the generic `save("locations")` is refused, so no screenless path skips the rules.
- **The page** reads branches from the shell (`useWorkspace().company.branches`: GET /company's in api mode), closing ADR 0051 "GET /company" D7; the dialog runs the shared rule before sending, shows the branch read only on edit, takes the API's floor area at scale (`"18000.000"`, which today's dialog pattern refuses), and stops inputs at the rule's and the body's lengths.
- **Closes:** ADR 0059 row 4's locations half; STATUS "Decide whether `GET /locations` honours the `inventory.locations` switch" (D3: it doesn't, every module picks a location; the switch hides the page and its writes); "Settings → Locations still reads its warehouses and their branch names from the demo"; "Warehouses and showrooms" in the unmoved-pages list. **The branch limit stays stored, not enforced** (locations aren't branches; no branch editor exists; D17).
- **Size: 16 product files** (2 new; `contract.ts` comment-only; `settings.controller.ts` one `export`). **No table, migration, dependency, core, auth, tenancy or provider change; no control-database write. No stop-and-ask item** (two designs that need a schema change are left out and asked: Q1, Q3).
- **Review:** `/review` and a fresh read-only **security-reviewer** (data scope, tenancy of ids, permissions, stock integrity incl. the conversion check; section 13). No `packages/db` change, so no schema-reviewer.

---

## 1. What exists

### 1.1 The table and every reference (company database; never altered here)

- `packages/db/src/company/organization.ts:5-11` `branches` (`name`, `city`, `state`; business columns) and `:13-28` `locations`: `...business()` (id, created_at, updated_at, created_by, **deleted_at**), `name` text, `kind` text (`LocationKind`), `branchId` uuid **not null** → `branches.id`, `address` jsonb (`Address`), `isDefault` boolean default false, `displaySamples` integer default 0, `floorAreaSqFt` `quantity()` = **numeric(14,3)**, nullable. Migration `packages/db/migrations/company/0000_company_base.sql:970-983`. **No index on `is_default` or `name`; no CHECK; no active flag.** No later migration changes it (0001 to 0006 checked; 0002 adds `journal_lines.location_id` → locations, `:24`, `:54`, `:61`).
- **Every foreign key to `locations`** (all `ON DELETE no action`; `0000_company_base.sql` lines): `user_profiles.default_location_id` :1456, `contracts.location_id` :1479, `expenses.location_id` :1493, `recurring_expenses.location_id` :1497, `employees.home_location_id` :1503, `reservations.location_id` :1525, `rolls.location_id` :1528, `stock_adjustments.location_id` :1533, `stock_movements.location_id` :1535, `transfers.from_id` :1539, `transfers.to_id` :1540, `goods_receipts.location_id` :1549, `po_lines.location_id` :1555, `purchase_orders.location_id` :1557, `receipt_lines.location_id` :1562, `invoice_lines.location_id` :1574, `invoices.location_id` :1578, `invoices.sold_at_location_id` :1579, `quote_lines.location_id` :1588, `quotes.location_id` :1591, `quotes.sold_at_location_id` :1592, plus `journal_lines.location_id` (0002). A hard delete fails while any row points at it; a soft delete would not.
- **Who writes `locations` today:** only the seed (`packages/db/src/seed/company.ts:96-110`, `seedId(...)` ids, `onConflictDoNothing`). **Who writes `branches`:** only the seed (`:97-100`). A provisioned company has neither (the API tests insert them, `apps/api/test/inventory.int.test.ts:39-115`).
- `packages/shared/src/types/locations.ts:1-25`: `LocationKind = "warehouse" | "showroom"`; `Location { id, name, kind, branchId, address, isDefault, displaySamples: number, floorAreaSqFt?: string }`. `Address` (`types/company.ts:11-20`): street, city, state, zip, county?, lat?, lng?. `Branch` (`:22-28`).

### 1.2 The API's readers (nothing writes locations)

| Reader | Where | What it does with a location |
| --- | --- | --- |
| `GET /locations` | `apps/api/src/modules/inventory/inventory.controller.ts:79-88` (`@AnyCompanyMember()`, class `@RequireModule("core")` `:50-53`, **no switch**) → `inventory.service.ts:84-87` → `loadLocations` (`inventory-records.ts:103-116`: live rows by name; `floorAreaSqFt` raw, at scale `"18000.000"`, left out when null) | shared reference data for every module (`docs/api-contract.md:81`, `:325`) |
| Web composites | `apps/web/src/lib/api/http/api-methods.ts` `inventoryData` :286-297, `salesData` :299-305, `expensesData` :336-344, `purchasingData` :407-418, contracts :515-527, `hrData` :606-620 (`seenOrOff`) | already read `GET /locations` in api mode |
| Stock writers | `lockStock` `inventory/stock-lock.ts:4-11` (`pg_advisory_xact_lock(hashtext('inventory:stock'))`), taken by transfers `inventory.service.ts:101`, receive `:183`, corrections `:262`, issue `stock-issue.service.ts:140`, receipts `purchasing.service.ts:488`, `:530`, invoices `invoices.service.ts:184`, `:276`, `:549`, imports `imports/product-store.ts:45` | every stock change in a company runs one at a time |
| Kind checks | transfers `packages/shared/src/operations/transfers.ts:30` (both ends warehouses); corrections `inventory.service.ts:274`; quote save `sales.service.ts:270` (header) and `:491` (lines); PO save `purchasing.service.ts:362-369`; receipt `:540-550` (the receipt names its own warehouse, `input.locationId || po.locationId`); import `packages/shared/src/import/kinds/stock.ts:19`; reports `report-params.ts:178` | refuse a showroom |
| **No kind check** | **`receiveTransfer`** (`inventory.service.ts:180-200`; shared `operations/transfers.ts:98-111`: rolls take `locationId = toId`, boxed `transfer_in` movements at `toId`); **quote conversion** (`invoices.service.ts:152-205`: `planReservations` at `:192` holds stock at the quote's warehouse without checking its kind) | the two paths that would put stock into, or leave a hold at, a location that became a showroom; 4a refuses the showroom change while a transfer is in transit to it (D6) and adds a kind check to conversion under the stock lock (D21) |
| **Kind checks outside the stock lock** | quote save `sales.service.ts:269-270` and its lines `:485-493` (`assertReferences`) read `loadLocations(tx)` without `lockStock` (only `sales:quote-number`, new quotes only); PO save `purchasing.service.ts:362-369` likewise. Transfers (`inventory.service.ts:101`), corrections (`:262`), receipts (`purchasing.service.ts:530`, kind at `:546-550`) check under the lock | a quote saved concurrently with a warehouse → showroom change can stay open at the showroom (R16); a PO doesn't matter (its receipt checks under the lock) |
| Branch from a location | expenses: `locationBranches` (`finance/expense-records.ts:21-25`), `seesExpense`, `list` (`expenses.service.ts:104-112`), `listRecurring` (`:114-121`), `requireWritableAt` (`:517-523`) read the **current** `locations.branch_id` on every read and write; quotes: `sales.service.ts:302-304` stores `branchId: location.branchId` **on every save** (re-stamped when an old quote is saved again) | a branch change moves expenses' visibility at once and quotes' on their next save |
| Default warehouse | shared `warehousesOf` / `defaultWarehouse` (`packages/shared/src/stock.ts:60-75`): the person's `defaultLocationId`, then the company default, then the first warehouse; showrooms left out | a person's default pointing at a showroom falls back |
| Business report | shared `weightsFor` (`cost-sharing.ts:36-72`; `business-report.ts:426`) over live locations; `profitByLocation` (`business-report.ts:684-700`) shows a no-longer-live location as "Removed location" | `dec(l.floorAreaSqFt ?? 0)` throws on `""` |
| `GET /company` branches | `users/company.service.ts:40-43` (live branches, by name) to every member | the shell's and Settings → Users' branches |
| Branch writers' rules | `knownBranch` (`users/users.service.ts:470`) stores an unknown branch as none; `newBranch` (`contracts/contracts.service.ts:613`) | precedent 4a doesn't follow (D5) |
| Branch limit | `apps/api/src/core/access/plan-limits.ts:31-38`: "stored but not enforced until Settings → Locations moves to the API" | core: comment left as is (D17) |

### 1.3 The web

- **Page** `apps/web/src/features/settings/locations/locations-page.tsx:23-102`: `NoAccess` without `settings.locations.manage`; `useApiQuery` reads `client.list("locations")` **and** `client.getCompany()` (comment `:26-27`: "Branches from the same source as the locations: DemoStore's in api mode until Locations moves", ADR 0051 "GET /company" D7); table columns name, type, branch (`branchName`), city, display samples, company default; "Add location"; `StockRulesForm` panel (the `inventory` section, unmoved, "with stock adjustments").
- **Dialog** `location-dialog.tsx`: Zod `LocationSchema` `:30-44` (name trimmed min 1 with "Enter a name people will recognise, such as Denver Central."; kind; branch "Choose the branch this location belongs to."; address street/city/state (US code)/zip (`ZIP_PATTERN`)/county; `isDefault`; `displaySamples` int ≥ 0; **`floorAreaSqFt` `/^\d*(\.\d{1,2})?$/`**, which refuses the API's `"18000.000"` and takes `".5"`); defaults `:66-76` (new: first branch, `company.state`, floor area `""`); `save` `:81-95`: id `location?.id ?? \`${company.id}-loc-${uuid8}\``, `isDefault` only for a warehouse, samples 0 for a warehouse, **floor area sent as typed (`""` when blank)**; refusals into the root alert (`:221-225`); toast `"<name> saved"`. Branch select enabled on edit; no `maxLength` anywhere.
- **Transport** `api-methods.ts`: `SERVED_LISTS` `:129-140` has **no `locations`**, so `list("locations")` and `get("locations")` go to DemoStore (`:153-170`); **`saveLocation` is not in `API_METHODS`** (DemoStore in api mode). `isSaved(id)` (UUID test) `:1031-1034`; `seen` (403 → `[]`) `:981-988`.
- **Screens that call `list("locations")` directly** (all DemoStore's ids in api mode today): `components/shell/profile-dialog.tsx:30` (Your profile: not offered in api mode), `features/dashboard/use-dashboard-data.ts:96` (the warehouse filter, `dashboard-page.tsx:217-218`, `:276-283`, applied to API invoices and **DemoStore quotes**: `list("quotes")` isn't served), `features/settings/expenses/expenses-settings-page.tsx:106` (shared costs' fixed percentages), `locations-page.tsx:29`.
- `contract.ts:1281-1285` `saveLocation(location: Location): Promise<Location>` JSDoc ("Exactly one warehouse is the company default, and a location holding stock cannot become a showroom").
- Menu `apps/web/src/products/settings-menu.ts:118-126` (`settings.locations.manage`, feature `inventory.locations`); switch `packages/shared/src/features.ts:104-111` (`inventory.locations`, flooring, core, screens `/settings/locations`).

### 1.4 DemoStore (`apps/web/src/lib/api/demo/store.ts` on `B`)

- `saveLocation` `:1940-1970`: `assertCan(["settings.locations.manage"])` **only** (no module, switch or scope); `holdsStock` = a roll at it with `remainingLengthFt > 0` or boxed stock not zero (`boxedStock`); refusals "<name> holds stock. Transfer it out before making it a showroom.", "The default must be a warehouse; showrooms hold no sellable stock.", "Keep one warehouse as the company default."; name trimmed; a new default clears the others (`db.put`, **no audit for them**); one audit entry "Added location"/"Changed location", category settings, target the name, before/after `"<kind>[, default]"`.
- `assertSettingsSave(db, rule)` `:2153-2161` (module, keys, switch, scope; part 1); `assertCan` `:2168-2173`.
- **Generic `save`** `:924-930` with `savePermissions("locations")` = `["settings.locations.manage"]` (`permission-rules.ts:19-22`): a screenless path that writes any location with none of the rules. No screen calls it (`git grep 'save("locations"'` prints nothing).
- `businessReport` (report-actions.ts `:153` passes `db.list("locations")` raw): a location saved with `floorAreaSqFt: ""` makes `weightsFor` throw on every company-wide expense (Summit has 72 of them, every month).

### 1.5 Shared costs today (4b's, not changed by 4a)

`SETTINGS_SECTIONS.sharedCosts` (`sections.ts:75-80`, key `settings.expenses.manage`, `finance.expenses`, core, "Shared costs"); not in `API_SETTINGS_SECTIONS` (`:96`); `fixedPctProblem` (`cost-sharing.ts:74-79`, throws on `""` or `"1.2.3"` through `dec`); the API's Business report reads the row (`report-records.ts:554-560` `loadSharedCosts`, `DEFAULT_SHARED_COSTS` when none); the Expenses page saves it through `updateSettings("sharedCosts")` → DemoStore (`expenses-settings-page.tsx:127-141`; api-mode e2e `tests/e2e-api/settings.spec.ts:316-322` pins "Shared costs stays in the browser"). Fixtures: every company `{ rule: "revenue", fixedPct: {} }`.

### 1.6 Spec, blueprint, ADRs and STATUS follow-ups

- **Blueprint** p14 (Organization: branches, locations), p15 (table rules), p19 ("Company settings: Users and roles; branches and locations"). Nothing on retiring a location.
- **settings-and-permissions.md** (on `B`): "Who uses it" `:36` (warehouses, `DemoStore.saveLocation`, scope `all`), `:37` (shared costs on `updateSettings` "until their part"), `:46` (own default warehouse); permission table `:211`; settings pages `:264`, `:267`; rule 6 table `:413` (`locations | settings.locations.manage`); rule 7 table `:434-435`; **rule 29** `:583` (locations); `sharedCosts` entity `:808-813`; audit rows `:859`, `:863`; Real build "The shell on the API" last bullet `:952` ("Settings → Locations still reads its warehouses and their branch names from the demo until Locations moves"); Known limits `:980` (branch limit "Enforcement comes when Settings → Locations moves"), `:984` (unmoved pages: "Warehouses and showrooms, Shared costs").
- **inventory.md**: `:15` (`settings.locations.manage` is core), `:35` (Who uses it), rule 24 `:296`, rule 25 `:298`, Location entity `:437-447`, audit row `:481`. No "Real build" section.
- **ADR 0059** `:78` row 4; `:91` residual risks ("unmoved sections ... Warehouses and showrooms, Shared costs"; "the Expenses page is mixed"). **ADR 0051** `:855` (D7, historical). Session log `docs/sessions/2026-11-17-0525-b-company-from-api.md:101` (D7: "When Locations moves (the Settings task), the page reads the API's").
- **api-contract.md**: `:81` (`GET /locations` as an `@AnyCompanyMember` exception), `:325` (Inventory part 1 row), `:768` (`getCompany()`: "Settings → Locations reads its branches here"), `:780` (Records: `list`, `get`, `save` on `locations`), `:841` (`saveLocation` → "`PUT /locations/:id`").
- **FEATURES.md** `:31` (`inventory.locations`), `:40` (`finance.expenses`). **data-model.md** `:65` (Location), `:284` (Warehouses).
- **STATUS.md** (on `B`; find by text): `:178` ("The branch limit is stored, not enforced, until Settings → Locations moves to the API."), `:188` (`newBranch` ... "When Settings → Locations moves, check it or clear `user_profiles.branch_id` on delete."), `:211` (unmoved pages incl. "Warehouses and showrooms"), `:212` ("The Expenses page is mixed in api mode ... Shared costs in the browser until part 4"), **`:463` ("Decide whether `GET /locations` honours the `inventory.locations` switch, and say so in docs/FEATURES.md.")**, `:470` (branch-scoped admin's branch changes, server half), `:481` (`knownBranch`), `:574` (order of later parts), `:583`, `:600` (invite branches, Q-B4-2).
- E2e that names locations: demo `tests/e2e/warehouses.spec.ts:5-25` (list; "refuses to turn a warehouse that holds stock into a showroom", alert `/holds stock\. Transfer it out/`), `tests/e2e/expenses.spec.ts:92-106` (fixed percentages; "a location has a floor area"); api `tests/e2e-api/company.spec.ts:191-193` (comment "Settings → Locations is still DemoStore's (D7)"; asserts Denver Central's row contains "Denver", which the name and City cells also satisfy, so 4a makes it an exact Branch-cell check, M3), `tests/e2e-api/reports.spec.ts:75` (**"Southgate Showroom" by exact label**).

### 1.7 Fixtures, seed and the e2e database

Summit (`packages/shared/fixtures/summit.json`; seeded with `seedId` ids into the e2e database on 5433): branches Denver, Colorado Springs; locations **Denver Central** (warehouse, Denver, **default**, 18000 sq ft), **Colorado Springs** (warehouse, Springs, 12000), **Summit Design Studio** (showroom, Denver, 142 samples, 3200), **Southgate Showroom** (showroom, Springs, 96 samples, 2400; street "3380 Meadowgate Drive", city "Colorado Springs", CO, 80920, county "El Paso"). TR-1003 in transit Denver → Springs; active reservations at Denver; Q-2002 pending at Denver. Colorado Springs also has 18 live rolls and boxed stock for 78 products (so the demo's showroom refusal there is on stock, whichever of rolls or boxes is checked). Keystone: three locations; Harbor (HR Suite): none. Every company's `sharedCosts` `{ rule: "revenue", fixedPct: {} }`. `playwright.api.config.ts` runs one worker.

### 1.8 Pieces of earlier parts 4a relies on (on `B`)

| Piece | Where | 4a uses it for |
| --- | --- | --- |
| `SETTINGS_SECTIONS.inventory` (`settings.locations.manage`, `inventory.locations`, `core`) | `sections.ts:63-68` | `LOCATION_RULE` reuses its key, switch, module (one source, CLAUDE.md rule 4) |
| `SETTINGS_SCOPE_MESSAGE`, `SettingsSectionRule` | `sections.ts:189`, `:19-24` | the scope refusal; the rule's type |
| `PROFILE_MESSAGES`, `companyProfileProblem` | `section-rules.ts:26-37`, `:75-89` | the address rule, extracted (D10) |
| `PROFILE_INPUT`'s address bounds | `apps/api/src/modules/settings/settings-input.ts:35-54` (street 200, city 100, state 2, zip 10, county 100, lat/lng finite) | `ADDRESS_INPUT`, shared by both bodies |
| `assertSettingsSave` | `store.ts:2153-2161` | DemoStore's module, key, switch, scope |
| Inventory controller's `requireFeature`, `parse`, `actorOf`, `@Audited()` | `inventory.controller.ts:1-43` | the new handlers |
| `refuse`, `notFound` | `apps/api/src/modules/sales/sales-common.ts:24-32` | 400 / 404 with words |
| `requireWholeCompany` | `apps/api/src/modules/settings/settings.controller.ts` `T:54-60` (module-private; `SETTINGS_SCOPE_MESSAGE`) | exported and imported by the inventory controller (D23) |
| The inventory controller's `QUANTITY` | `inventory.controller.ts:15` (`/^\d{1,10}(\.\d{1,3})?$/`, "Enter a quantity such as 12 or 12.5.") | its pattern moves to shared `QUANTITY_TEXT`, which the floor area uses too (D23) |
| `fold`, `findLocation` | `packages/shared/src/import/fields.ts:24-28`; `import/lookup.ts:10`, `:51-53` (`locations.find(same)`, the first by name order); `import/kinds/stock.ts:17` | location names compared as the import finds them (D9) |
| `warehousesOf`, `lockStock` in `convert` | `packages/shared/src/stock.ts:60-62`; `invoices.service.ts:184` (after `insertInvoice`, before `books.post`) | the conversion check (D21) |
| Short rows | shared `reservations.ts:222` (`quantity: "0"`, `shortBy` left); `isShort` `:242-244`; issue refuses them (`stock-issue.service.ts:147` `T`); only a void releases them (`invoices.service.ts:556-562`); inventory.md `:501` "Short lines stay short" | D22 |
| `lockStock`, `loadLocations` | `stock-lock.ts:9-11`, `inventory-records.ts:103-116` | the lock; the live rows and the answer |
| `quoteIsOpen` | `packages/shared/src/operations/quote-status.ts:28-30` | open quotes in the holds rule |
| `boxedStock` | `packages/shared/src/stock.ts:32-42` | boxed stock in the holds rule |
| `isSaved`, `seen`, the transport's re-read | `api-methods.ts:1031-1034`, `:981-988`; ADR 0051 2026-11-16 | POST vs PUT; HR Suite's 403 as none; screens read again |
| `fakeApi` | `apps/web/tests/unit/fake-api.ts` | transport tests |
| API test helpers: `platformHelpers` (`call`, `enrolled`), `AuthHarness.provisionCompany`/`addUser`/`companyDb`, `expectedPermissions`/`expectedPut`/`withFeatureOff` (`settings-localization.int.test.ts:202-301`), A0's metadata check (`settings.int.test.ts:272-294`), `addStock` (`inventory.int.test.ts:39-115`), `setUp`/`invoiced` (`invoices.int.test.ts:72-190`), `tenantPermissionCeiling` (2b's test imports it) | `apps/api/test/*` | LNA's set-up (copied per file, as 2a/2b did) |
| e2e helpers `readAs`, `auditEntriesBy`, `canonical` (`tests/e2e-api/flows/checks.ts:23`, `:279`, `:308`), `flowTest`, `resetAuthAround`, `personas.onCleanup` (`flows/kit.ts`) | e2e | LNE1, LNE2 |

---

## 2. Scope and split

**Why split (D1).** Part 4 whole is about 22 product files (4a's 16 below, plus `sections.ts`, `cost-sharing.ts`, `settings.service.ts`, `settings-answer.ts`, `expenses-settings-page.tsx` and the settings controller's handler), above the task's "about 15". The seam is natural: shared costs' server rule checks fixed percentages against the API's location ids, which reach the Expenses page only once `list("locations")` is routed (4a). So 4a first.

**4a (this plan, one PR, `feat/settings-locations-api`):** `POST /locations`, `PUT /locations/:id`; the shared location rules (content, branch, name, default, holds, stored form); the conversion check (D21); `list`/`get("locations")` and `saveLocation` routed; the page's branches from the shell; the dialog's rule, read-only branch, floor-area pattern and lengths; DemoStore's checks, holds, blank floor area and audit parity; the generic `save("locations")` refused; one scope check and one quantity pattern (D23); docs.

**4b (section 17, its own branch, stacked on 4a, planned after 4a's handoff):** `sharedCosts` on the API.

**Out of both:** removing or retiring a location (Q1, needs a schema change or a soft-delete design); moving a location to another branch (Q2); a branch editor and enforcing the branch limit (D17, Q6); unique indexes (Q3); Stock rules (`inventory` section, "with stock adjustments"); Your profile / `PATCH /me`; the dashboard's quotes in api mode (R3); `GET /settings/defaults`; taking the stock lock in quote saves (D21 makes it unnecessary for stock); the sweep of the other whole-company scope copies (STATUS).

**4a's product files: 16, two new** (section 6). That is "about 15": `contract.ts` is a JSDoc edit and `settings.controller.ts` gains one `export`. If stage 0 finds that 3b's handoff makes 4a touch one more file, drop the `contract.ts` JSDoc edit (its current text stays true) and list it in STATUS, so 4a stays at 16. If that is not enough, **stop and report**; do not build a 17-file PR.

---

## 3. Before building (read first)

1. CLAUDE.md; `.claude/commands/feature.md`; `docs/real-build-plan.md` prompt **P11** (`:29-35`), module order rows 4 and 6 (`:46`, `:48`), the CI budget.
2. `docs/product-spec/sales.md` rule 19 (`:304`, Conversion) on `L`. `docs/product-spec/settings-and-permissions.md` on `L`: "Who uses it" (`:36-37`), rule 6 (`:413`), rule 7, **rule 29**, the audit table, "Real build" ("The shell on the API", parts 1 to 3b), "Known limits in api mode".
3. `docs/product-spec/inventory.md`: "Who uses it", rules 11 (reservation plan) and 19 to 25, the Location and Reservation entities, "Events and audit entries", "Edge cases" (`:501` "Short lines stay short").
4. Blueprint pp. 14, 15 and 19 only (`SP/bp.txt:552-562`, `:705-735`).
5. `docs/api-contract.md`: Conventions, "Permissions" `:81`, "Inventory, part 1", "Settings" parts 1 to 3b, the ApiClient rows `:768`, `:780`, `:841`; `docs/data-model.md:65`, `:284`; `docs/FEATURES.md` `inventory.locations`.
6. ADR 0059 (every section, incl. 3a's and 3b's), ADR 0035 (inventory part 1), ADR 0006 (warehouses and showrooms), ADR 0051 "GET /company" (D7), ADR 0023 (shared costs, for 4b).
7. docs/STATUS.md lines of 1.6 (find by text on `L`).

---

## 4. Design

### 4.1 What adding, editing and retiring a location may do (the decision)

| Change | Allowed? | Why |
| --- | --- | --- |
| Add (POST) | Yes, in a live branch of the company; the first location must be a default warehouse | the API makes a UUID v7 id; an unknown branch (a demo id, another company's) is refused with words, never stored as none (D5) |
| Name | Yes: trimmed, 1 to 80 characters, and not the name of another live location once both are folded as the stock import folds them (`fold`: trimmed, lower case, each run of spaces, dashes and underscores as one space) | pickers show names only, and the opening-stock import finds a warehouse by its folded name and takes the first match, so "Denver-Central" beside "Denver Central" would send imported stock to the wrong one (D9) |
| Address | Yes: street, city, state (US code), ZIP (`ZIP_PATTERN`), optional county, optional finite lat/lng. Lengths are bounded by the API body (part 1's street 200, city 100, state 2, ZIP 10, county 100; no words) and by the inputs, which stop typing there | the company profile's rule and words, unchanged (D10) |
| Display samples | Yes on a showroom (whole 0 to 100,000); a warehouse has none (0) | samples are a count, never stock (D11) |
| Floor area | Yes: blank (none) or `QUANTITY_TEXT` (≤ 10 digits, ≤ 3 decimals) | `numeric(14,3)`; the API answers `"2400.000"`, which must save back; blank stored as none in both modes (D11) |
| Company default | Only a warehouse; a new default clears the old (each audited); a save that leaves no default is refused | one default warehouse (spec rule 29; D7) |
| **Branch** | **No: fixed once added** | expense branch scope reads it live; quotes re-stamp it on save; a move re-scopes history (D5; Q2) |
| Showroom → warehouse | Yes (samples to 0) | nothing is orphaned |
| **Warehouse → showroom** | **Refused while** it holds stock (a live roll with `remainingLengthFt > 0` at it, in transit or not; boxed stock not zero for any product), has a transfer in transit **from or to** it, **holds stock for an invoice** (an `active` reservation at it whose `quantity` is above zero, read by value; a short row with quantity 0 holds nothing and doesn't block, D22), or is where an **open** quote (draft, pending, accepted) ships from, by header or by a line | receiving a transfer doesn't check the kind (1.2), so the transfer refusal is load-bearing; an open quote would otherwise wait at a showroom until its conversion is refused (D21); purchase orders don't block (a receipt names its own warehouse and refuses a showroom under the lock); contracts hold no stock (D6; Q4) |
| **Convert a quote** whose header or line warehouse is no longer a live warehouse | **Refused** (400 "Fulfil the quote from a warehouse."), checked under the stock lock | quote saves read the kind without the stock lock, so a quote can be saved at the moment its warehouse becomes a showroom; the check keeps every reservation at a warehouse (D21) |
| **Deactivate, remove, delete** | **Not offered** (no route, no button) | no active column (a schema change); a soft delete hides a location 22 columns still point at; hard delete impossible (D4; Q1) |

Order of the checks, the same in both modes: content (name, name length, kind, branch, address, samples, floor area), duplicate name, default rules, then (only for warehouse → showroom) the holds: stock, transfer, held stock, open quotes. The first problem is answered.

### 4.2 Shared (packages/shared; no dependency)

**`packages/shared/src/decimal-text.ts`**: insert right after `TAX_RATE_TEXT_MAX` (`T:48`), before the `PLAIN_DECIMAL` JSDoc (find both by text; 3a put them mid-file):
```ts
/**
 * A quantity as a write takes it (CLAUDE.md rules 6 and 8: quantities are numeric(14,3)): up to ten
 * digits and three decimals, as such a column is answered ("18000.000"), so a client that sends back
 * what it read is taken. Transfer and count quantities (the inventory controller's `QUANTITY`) and a
 * location's floor area in sq ft (ADR 0059, part 4a, D11, D23). No bare point, sign, exponent or
 * space. Blank is the caller's to decide.
 */
export const QUANTITY_TEXT = /^\d{1,10}(\.\d{1,3})?$/;

/** The longest text `QUANTITY_TEXT` takes ("9999999999.999"), where a quantity input stops typing. */
export const QUANTITY_TEXT_MAX = 14;
```

**`packages/shared/src/settings/section-rules.ts`** (behaviour of `companyProfileProblem` unchanged; add `Address` to the type imports, from where `types` exports it):
```ts
/**
 * The longest street, city, ZIP and county an address takes (ADR 0059, part 4a, D10): the API body's
 * bounds since part 1, with no words of their own, where the address inputs stop typing.
 */
export const ADDRESS_MAX = { street: 200, city: 100, zip: 10, county: 100 } as const;

/**
 * Why a street address can't be saved, or null (spec rule 28): street and city given, a US state
 * code, a ZIP, and a map position that is a pair of numbers or absent. The company profile's and a
 * location's rule (ADR 0059, part 4a, D10), with the profile's words.
 */
export function streetAddressProblem(address: Address): string | null { /* the five lines moved from companyProfileProblem */ }
```
`companyProfileProblem` calls it after the website check (same order). (Not `addressProblem`: that name is the notification rule's in `apps/api/src/core/notifications/notification-rules.ts:8`.)

**`packages/shared/src/settings/location-rules.ts` (new)**, exported from `index.ts` (`export * from "./settings/location-rules";` right after `export * from "./settings/tax-settings";`, `T:91`). Imports: `dec` (`../money`), `boxedStock` (`../stock`), `fold` (`../import/fields`), `quoteIsOpen` (`../operations/quote-status`), `QUANTITY_TEXT` (`../decimal-text`), the types, `SETTINGS_SECTIONS`/`SettingsSectionRule` (`./sections`), `streetAddressProblem` (`./section-rules`). No cycle: none of these imports a settings rule file except `section-rules → localization-rules → sections, tax-settings`, as today.
```ts
/** Who may add or change a location, the page's switch and the module (ADR 0059, part 4a, D2): Stock rules' own, so one source. */
export const LOCATION_RULE = {
  keys: SETTINGS_SECTIONS.inventory.keys,
  feature: SETTINGS_SECTIONS.inventory.feature,
  module: SETTINGS_SECTIONS.inventory.module,
} as const satisfies Pick<SettingsSectionRule, "keys" | "feature" | "module">;

/** The longest location name, where the name input stops typing (ADR 0059, part 4a, D9). */
export const LOCATION_NAME_MAX = 80;
/** The most display samples a showroom counts (ADR 0059, part 4a, D11). */
export const DISPLAY_SAMPLES_MAX = 100_000;

/** What Warehouses and showrooms says about what it refuses, the same words in both modes. */
export const LOCATION_MESSAGES = {
  name: "Enter a name people will recognise, such as Denver Central.",
  nameLength: `Keep the name to ${LOCATION_NAME_MAX} characters or fewer.`,
  kind: "Choose whether this is a warehouse or a showroom.",
  branch: "Choose the branch this location belongs to.",
  branchFixed: "A location stays in the branch it was added to: its expenses and quotes are seen by that branch. Add a new location instead.",
  samples: "Enter the display samples as a whole number from 0 to 100,000.",
  warehouseSamples: "Only showrooms count display samples; a warehouse has 0.",
  floorArea: "Enter the area in sq ft, for example 3200.",
  // Names the location that already has the name, as it is stored (D9).
  sameName: (stored: string) => `Another location is already called ${stored}.`,
  showroomDefault: "The default must be a warehouse; showrooms hold no sellable stock.",
  oneDefault: "Keep one warehouse as the company default.",
  holdsStock: (name: string) => `${name} holds stock. Transfer it out before making it a showroom.`,
  inTransit: (name: string) => `${name} has a transfer in transit. Receive it before making it a showroom.`,
  heldStock: (name: string) => `${name} has stock held for invoices. Issue it, or void the invoice, before making it a showroom.`,
  openQuotes: (name: string) => `Open quotes ship from ${name}. Move them to another warehouse or close them before making it a showroom.`,
} as const;

/** A location as a write sends it: everything but the id, which the API makes (ADR 0059, part 4a, D12). */
export type LocationInput = Omit<Location, "id">;

/** What a location's rule judges against: the stored row (undefined for a new one), the other live locations, the live branches. */
export interface LocationContext { before: Location | undefined; others: readonly Location[]; branches: readonly Pick<Branch, "id">[] }

/** Why a location can't be saved, or null (spec rule 29; ADR 0059, part 4a, D5 to D11). Order of 4.1. */
export function locationProblem(input: LocationInput, context: LocationContext): string | null;

/** Whether a save turns a stored warehouse into a showroom: the only change that needs the holds check (D6). */
export function becomesShowroom(before: Location | undefined, input: Pick<LocationInput, "kind">): boolean;

/** The records that point at one location, narrowed to what the holds rule reads. */
export interface LocationRecords {
  rolls: readonly Pick<Roll, "locationId" | "remainingLengthFt">[];
  movements: readonly Pick<StockMovement, "productId" | "locationId" | "quantity">[];
  transfers: readonly Pick<Transfer, "fromId" | "toId" | "status">[];
  reservations: readonly Pick<Reservation, "locationId" | "status" | "quantity">[];
  quotes: readonly (Pick<Quote, "status" | "locationId"> & { lines: readonly Pick<DocLine, "locationId">[] })[];
}

/** What keeps a warehouse from becoming a showroom (D6): stock, a transfer in transit, stock held for an invoice, an open quote. */
export interface LocationHolds { stock: boolean; transfers: boolean; holds: boolean; quotes: boolean }

/**
 * The holds of one location from any records (others' are ignored): a live roll with length left (in
 * transit too), boxed stock not zero (`boxedStock`), a transfer `in_transit` from or to it, an
 * `active` reservation whose quantity is above zero (by value: the API answers "0.000"; a short row
 * holds nothing and nothing fills it, inventory.md "Short lines stay short", D22), a quote
 * `quoteIsOpen` from it by header or line.
 */
export function locationHolds(locationId: string, records: LocationRecords): LocationHolds;

/** The refusal for the first hold, in the order stock, transfer, held stock, quotes, naming the location; null when none. */
export function locationHoldsProblem(name: string, holds: LocationHolds): string | null;

/** A location as both modes store it: the name trimmed, a blank floor area left out (D11); the rest as sent. */
export function locationStored(input: LocationInput): LocationInput;
```
- `locationProblem`, in this order: name blank (trimmed) → `name`; trimmed length > 80 → `nameLength`; kind not warehouse/showroom → `kind`; new: `branches` lacks `branchId` → `branch`; edit: `branchId !== before.branchId` → `branchFixed` (a stored branch no longer live is fine); `streetAddressProblem(address)`; samples not an integer, < 0 or > 100,000 → `samples`; warehouse with samples ≠ 0 → `warehouseSamples`; floor area neither absent, `""` nor `QUANTITY_TEXT` → `floorArea`; `const taken = others.find((l) => fold(l.name) === fold(input.name))` → `sameName(taken.name)`; showroom with `isDefault` → `showroomDefault`; `!isDefault && !others.some((l) => l.isDefault)` → `oneDefault`. JSDoc of the name check cites `import/lookup.ts` `findLocation` (D9).
- `locationHolds`: `stock` = a roll at it with `dec(remainingLengthFt).gt(0)` or any `boxedStock(movements, id)` value not zero; `transfers` = `status === "in_transit"` and (`fromId === id` or `toId === id`); `holds` = `locationId === id`, `status === "active"` and `dec(quantity).gt(0)`; `quotes` = `quoteIsOpen(q)` and (`q.locationId === id` or a line's `locationId === id`).
- **Sensitive-name scan** (`packages/shared/test/access-rules.test.ts:205-219`, indented keys matching `Cost|Margin|Rate|Salary|Wage|Limit|Pay`, case-insensitive on the first letter): every new indented key is clear of it (checked: `keys`, `feature`, `module`, `name`, `nameLength`, `kind`, `branch`, `branchFixed`, `samples`, `warehouseSamples`, `floorArea`, `sameName`, `showroomDefault`, `oneDefault`, `holdsStock`, `inTransit`, `heldStock`, `openQuotes`, `before`, `others`, `branches`, `rolls`, `movements`, `transfers`, `reservations`, `quotes`, `stock`, `holds`, `lines`, `street`, `city`, `zip`, `county`). **Avoid key names such as `separate`, `generate` or `accurate`** (they contain "rate"). `access-rules.test.ts` joins the shared runs.
- Every export gets a JSDoc saying what and why, citing spec rule 29 / inventory.md rule 24 and "ADR 0059, part 4a, D<n>".

### 4.3 API

**`apps/api/src/modules/settings/settings-input.ts`**:
```ts
/**
 * An address as Company profile and Warehouses and showrooms send it (ADR 0059, part 4a, D10): part
 * 1's bounds from `ADDRESS_MAX`, with no words of their own (the inputs stop typing there), a state of
 * two characters (the shared rule checks the code), and a map position of finite numbers or none.
 */
export const ADDRESS_INPUT = z
  .object({
    street: z.string().max(ADDRESS_MAX.street),
    city: z.string().max(ADDRESS_MAX.city),
    state: z.string().max(2),
    zip: z.string().max(ADDRESS_MAX.zip),
    county: z.string().max(ADDRESS_MAX.county).optional(),
    lat: z.number().finite().optional(),
    lng: z.number().finite().optional(),
  })
  .strict();
```
`PROFILE_INPUT.address` becomes `ADDRESS_INPUT` (no behaviour change; part 1's A-cases pin it).

**`apps/api/src/modules/settings/settings.controller.ts`** (D23): `function requireWholeCompany` becomes `export function requireWholeCompany`; its JSDoc adds "Warehouses and showrooms use it too (part 4a)". Nothing else changes; `check` stays module-private.

**`apps/api/src/modules/inventory/inventory.controller.ts`**:
```ts
/** A decimal quantity as the screens send it: a plain decimal string, never a float (`QUANTITY_TEXT`). */
const QUANTITY = z.string().regex(QUANTITY_TEXT, "Enter a quantity such as 12 or 12.5.");

/**
 * POST /locations and PUT /locations/:id (ADR 0059, part 4a): a location as Settings → Warehouses and
 * showrooms sends it, never its id. Outer lengths sit far above the rule's with the rule's words, so
 * the shared rule speaks first for anything a person types (2a's pattern); the address takes part 1's
 * bounds (D10, D12).
 */
const LOCATION: z.ZodType<LocationInput> = z
  .object({
    name: z.string().max(LOCATION_NAME_MAX * 10, LOCATION_MESSAGES.nameLength),
    kind: z.enum(["warehouse", "showroom"], LOCATION_MESSAGES.kind),
    // Checked by the rule against the company's live branches, never cast in SQL, so a demo id gets the branch's words (D12).
    branchId: z.string().max(100, LOCATION_MESSAGES.branch),
    address: ADDRESS_INPUT,
    isDefault: z.boolean(),
    displaySamples: z.number(),
    floorAreaSqFt: z.string().max(QUANTITY_TEXT_MAX * 10, LOCATION_MESSAGES.floorArea).optional(),
  })
  .strict();
```
- `z.enum(values, message)` is the form `location-dialog.tsx:37` already uses; if apps/api's Zod wants the message differently, use its form (`parse` answers the first issue's message, `request-actor.ts:16-25`) and record it.
- Imports `requireWholeCompany` from `../settings/settings.controller` and `ADDRESS_INPUT` from `../settings/settings-input` (no cycle: neither imports the inventory module).
- Constructor gains `private readonly locations: LocationsService`.
- `@Post("locations") @RequirePermission(...LOCATION_RULE.keys) @Audited() createLocation(tenant, access, session, request, body)`: `requireFeature(LOCATION_RULE.feature)` (the controller's own `requireFeature`, `:41-43`) → `requireWholeCompany(access)` → `this.locations.create(tenant, actorOf(...), parse(LOCATION, body))`.
- `@Put("locations/:id") ... updateLocation(..., @Param("id", new ParseUUIDPipe()) id, body)`: same, `this.locations.update(...)`. **No `version` on the pipe**: seeded ids are UUID v5 (`packages/db/src/seed/fixtures.ts:10-18`).
- The class keeps `@RequireModule("core")` (= `LOCATION_RULE.module`, pinned by LNA0). JSDoc on both handlers and on the class (part 4a).
- **The answer:** the location as `GET /locations` lists it (201 for POST, 200 for PUT).

**`apps/api/src/modules/inventory/locations.service.ts` (new)**, registered in `inventory.module.ts` (`providers: [InventoryService, StockIssueService, LocationsService]`):
```ts
/**
 * Adds and changes warehouses and showrooms (Settings → Warehouses and showrooms; ADR 0059, part 4a;
 * spec rule 29, inventory.md rule 24), in the session's company only. Every save runs under the stock
 * lock, so the holds check, the default and the name checks see every stock change and every other
 * location save before or after it, never during (D8). One audit entry per saved row (D13).
 */
@Injectable()
export class LocationsService {
  constructor(private readonly tenancy: TenantConnectionService, private readonly auditLog: AuditService) {}
  create(tenant, actor, input): Promise<Location>   // save(undefined)
  update(tenant, actor, id, input): Promise<Location> // save(id)
  private async save(tenant, actor, id: string | undefined, input: LocationInput): Promise<Location> {
    const db = await this.tenancy.db(tenant);
    return db.transaction(async (tx) => {
      await lockStock(tx);
      const live = await loadLocations(tx);
      const before = id === undefined ? undefined : live.find((l) => l.id === id);
      if (id !== undefined && !before) throw notFound("location");          // unknown, deleted, or another company's id
      const others = live.filter((l) => l.id !== id);
      const branchRows = await tx.select({ id: branches.id }).from(branches).where(isNull(branches.deletedAt));
      const problem =
        locationProblem(input, { before, others, branches: branchRows }) ??
        (before && becomesShowroom(before, input)
          ? locationHoldsProblem(input.name.trim(), locationHolds(before.id, await loadLocationRecords(tx, before.id)))
          : null);
      if (problem) throw refuse(problem);
      const stored = locationStored(input);
      const savedId = id ?? uuidv7();
      const cleared = stored.isDefault ? others.filter((l) => l.isDefault) : [];
      if (cleared.length > 0) await tx.update(locations).set({ isDefault: false, updatedAt: new Date() }).where(inArray(locations.id, cleared.map((l) => l.id)));
      if (before) await tx.update(locations).set({ name, kind, address, isDefault, displaySamples, floorAreaSqFt: stored.floorAreaSqFt ?? null, updatedAt: new Date() }).where(eq(locations.id, savedId)); // branchId never updated (D5, defence in depth)
      else await tx.insert(locations).values({ id: savedId, ...stored, floorAreaSqFt: stored.floorAreaSqFt ?? null, createdBy: actor.access.userId });
      const saved = (await loadLocations(tx)).find((l) => l.id === savedId)!;
      await this.auditLog.record(tenant, actor.audit, { category: "settings", action: before ? "Changed location" : "Added location", targetType: "location", targetId: savedId, targetLabel: saved.name, before: before ?? null, after: saved }, tx);
      for (const old of cleared) await this.auditLog.record(tenant, actor.audit, { category: "settings", action: "Changed location", targetType: "location", targetId: old.id, targetLabel: old.name, before: old, after: { ...old, isDefault: false } }, tx);
      return saved;
    });
  }
}
```
- `refuse`, `notFound` from `../sales/sales-common` (400 `invalid_request` with the words; 404 "This location no longer exists."). No local `check` helper (D23).
- **`loadLocationRecords(tx, id)`** (private, same file): narrow reads by location id only, mapped to `LocationRecords`: live rolls `where location_id = id and deleted_at is null` (`locationId`, `remainingLengthFt`); stock movements **summed per product** `select product_id, sum(quantity) from stock_movements where location_id = id group by product_id` (append-only, so no deleted filter; each row mapped with `locationId: id`); live transfers `where from_id = id or to_id = id`; live reservations `where location_id = id` (`locationId`, `status`, `quantity`); live quotes `where location_id = id`, plus the live quotes that have a live line `where quote_lines.location_id = id` (their `status` and `locationId`, with `lines: [{ locationId: id }]`). The **rule** (statuses, sums, `> 0`, `quoteIsOpen`) stays in the shared `locationHolds`, so both modes judge the same way.
- Read only on warehouse → showroom; no other path pays for it.

**`apps/api/src/modules/sales/invoices.service.ts`** (D21), in `convert`, directly after `await lockStock(tx);` (`:184`) and before `this.books.post(...)`:
```ts
      // Under the stock lock, which every location save takes, so a warehouse that became a showroom
      // after the quote was saved is seen here: a showroom never holds stock for an invoice
      // (ADR 0059, part 4a, D21; inventory.md rule 24). Quote saves don't take this lock.
      const warehouses = new Set(warehousesOf(await loadLocations(tx)).map((location) => location.id));
      const shipsFrom = [quote.locationId, ...quote.lines.flatMap((line) => (line.locationId ? [line.locationId] : []))];
      if (!shipsFrom.every((locationId) => warehouses.has(locationId))) throw refuse("Fulfil the quote from a warehouse.");
```
- Imports: `loadLocations` joins the existing `../inventory/inventory-records` import (`:47`); `warehousesOf` joins the `@workspace/shared` import (`:12-36`). The words are the quote save's (`sales.service.ts:270`). The refusal rolls back the whole transaction (the invoice row, its number under `sales:invoice-number`, nothing posted yet).
- Nothing in `apps/api/src/core`, auth, tenancy or providers changes. `plan-limits.ts`'s comment (core) is left (D17).

### 4.4 Web

- **`apps/web/src/lib/api/http/api-methods.ts`**:
  - `SERVED_LISTS.locations = "/locations"` with a comment: "Settings part 4a (ADR 0059): warehouses and showrooms, for every member; an HR Suite company answers 403, read as none (`seen`)." The JSDoc above `SERVED_LISTS` names it.
  - `saveLocation: (http) => (location) => { const { id, ...body } = location; return isSaved(id) ? http.request<Location>("PUT", \`/locations/${id}\`, body) : http.request<Location>("POST", "/locations", body); }` with the comment "a location the API made (or the seed: UUID v5) has a UUID; a new one from the dialog doesn't. The id never travels in the body (D14)."
- **`apps/web/src/lib/api/contract.ts:1281-1285`** (JSDoc only): what 4.1 allows, "a new location is one whose id the API didn't make", the key, switch and scope, audited (the old default too).
- **`locations-page.tsx`**: `const { company } = useWorkspace(); const branches = company.branches;` (comment: "the shell's branches: GET /company's in api mode, DemoStore's in the demo (ADR 0051 'GET /company' D7, closed by ADR 0059 part 4a)"); `useApiQuery((client) => client.list("locations"), [])`; passes `locations={data.data ?? []}` to the dialog. No other change (the Branch column keeps `branchName`).
- **`location-dialog.tsx`**:
  - `export const LOCATION_FORM` (today's `LocationSchema`, renamed and exported for LNP): name `.trim().min(1, LOCATION_MESSAGES.name).max(LOCATION_NAME_MAX, LOCATION_MESSAGES.nameLength)`, kind `z.enum([...], LOCATION_MESSAGES.kind)`, branch/address messages from `LOCATION_MESSAGES` and `PROFILE_MESSAGES`, `displaySamples` `.int(LOCATION_MESSAGES.samples).min(0, …).max(DISPLAY_SAMPLES_MAX, …)`, **`floorAreaSqFt: z.string().refine((v) => v === "" || QUANTITY_TEXT.test(v), LOCATION_MESSAGES.floorArea)`**.
  - `export function locationSave(values: LocationForm, location: Location | null, locations: readonly Location[], branches: readonly Branch[], newId: string): { location: Location; problem: string | null }`: builds what is sent (today's coercions: `isDefault` only for a warehouse, samples 0 for a warehouse; **the branch is `location.branchId` when editing**; a blank floor area left out; id `location?.id ?? newId`) and runs `locationProblem(input, { before: location ?? undefined, others: locations.filter((l) => l.id !== location?.id), branches })`.
  - `save`: `const { location: next, problem } = locationSave(values, location, locations, branches, \`${company.id}-loc-${crypto.randomUUID().slice(0, 8)}\`)`; a problem goes to the root alert and nothing is sent; else `api.saveLocation(next)` as today.
  - Inputs stop at the rule's and the body's lengths: `maxLength` `LOCATION_NAME_MAX`, `ADDRESS_MAX.street/city/zip/county`, `QUANTITY_TEXT_MAX`.
  - Branch select `disabled={location !== null}` with `aria-describedby="loc-branch-hint"` and the hint "A location stays in the branch it was added to." (visible text, both themes' tokens, focus unchanged; CLAUDE.md rule 15).
  - Props gain `locations: readonly Location[]`.
- **`apps/web/src/lib/api/demo/permission-rules.ts:22`**: `locations: []` with "// Locations change only through `saveLocation`, which runs the shared rules (ADR 0059, part 4a, D16)."

### 4.5 DemoStore (`store.ts` `saveLocation`)

```ts
/**
 * Adds or changes a warehouse or showroom with the API's checks in the API's order (ADR 0059, part 4a):
 * module, key, switch, scope (`assertSettingsSave`), then the shared rule, then, for a warehouse that
 * becomes a showroom, the holds on its own records; stored as both modes store it; one audit entry
 * per saved row (the cleared default too). Its ids come from the dialog.
 */
async saveLocation(location: Location) {
  const db = this.open();
  await this.assertSettingsSave(db, LOCATION_RULE);
  const { branches } = await this.getCompany();
  const { id, ...input } = location;
  const live = db.list("locations");
  const before = live.find((l) => l.id === id);
  const others = live.filter((l) => l.id !== id);
  const problem =
    locationProblem(input, { before, others, branches }) ??
    (before && becomesShowroom(before, input)
      ? locationHoldsProblem(input.name.trim(), locationHolds(id, { rolls: db.list("rolls"), movements: db.list("stockMovements"), transfers: db.list("transfers"), reservations: db.list("reservations"), quotes: db.list("quotes") }))
      : null);
  if (problem) throw new DemoRuleError(problem);
  const saved: Location = { id, ...locationStored(input) };
  const cleared = saved.isDefault ? others.filter((l) => l.isDefault) : [];
  for (const l of cleared) db.put("locations", { ...l, isDefault: false });
  db.put("locations", saved);
  this.appendAudit(db, {
    category: "settings",
    action: before ? "Changed location" : "Added location",
    target: saved.name,
    // An add keeps today's text; a change names what changed (diffSummary, as updateSettings).
    ...(before ? diffSummary(before, saved) : { before: null, after: `${saved.kind}${saved.isDefault ? ", default" : ""}` }),
  });
  for (const l of cleared)
    this.appendAudit(db, { category: "settings", action: "Changed location", target: l.name, ...diffSummary(l, { ...l, isDefault: false }) });
  this.emit();
  return saved;
}
```
`diffSummary` is already imported (`store.ts:130`). Unused imports (`boxedStock`, `dec` if no longer used) go. DemoStore's `convertQuoteToInvoice` is unchanged: one browser has no race, and a location with open quotes can't become a showroom there (D21).

### 4.6 How screens follow, and what doesn't change

- After a save the transport re-reads (ADR 0051), so the page's `useApiQuery` reads `GET /locations` again; every picker reading a composite (`salesData`, `inventoryData`, `purchasingData`, `expensesData`, `hrData`, contracts) reads `GET /locations` on its next load.
- **Unchanged:** `GET /locations` (route, guard, answer, no switch), `loadLocations`, every stock writer (the conversion only gains its kind check, D21), quote saves (still no stock lock), transfers and the import's name lookup, `Stock rules` (`updateSettings("inventory")`, DemoStore), Your profile (demo only), the shell, `GET /company`. The inventory controller's `QUANTITY` keeps its pattern and words; only its source moves (D23).

### 4.7 Every affected place

| Place | Change |
| --- | --- |
| `packages/shared/src/decimal-text.ts` | `QUANTITY_TEXT`, `QUANTITY_TEXT_MAX` (after `TAX_RATE_TEXT_MAX`) |
| `packages/shared/src/settings/section-rules.ts` | `ADDRESS_MAX`, `streetAddressProblem`; `companyProfileProblem` calls it |
| `packages/shared/src/settings/location-rules.ts` (new) | 4.2 |
| `packages/shared/src/index.ts` | one export line after `./settings/tax-settings` |
| `apps/api/src/modules/settings/settings-input.ts` | `ADDRESS_INPUT` (shared by `PROFILE_INPUT`) |
| `apps/api/src/modules/settings/settings.controller.ts` | `export` on `requireWholeCompany`, one JSDoc line |
| `apps/api/src/modules/inventory/inventory.controller.ts` | `QUANTITY` from `QUANTITY_TEXT`, `LOCATION` body, two handlers, constructor, imports, JSDoc |
| `apps/api/src/modules/inventory/locations.service.ts` (new) | 4.3 |
| `apps/api/src/modules/inventory/inventory.module.ts` | provider |
| `apps/api/src/modules/sales/invoices.service.ts` | the conversion's kind check under the stock lock (D21) |
| `apps/web/src/lib/api/http/api-methods.ts` | `SERVED_LISTS.locations`, `saveLocation` |
| `apps/web/src/lib/api/contract.ts` | `saveLocation` JSDoc (comment only) |
| `apps/web/src/lib/api/demo/store.ts` | `saveLocation` (4.5) |
| `apps/web/src/lib/api/demo/permission-rules.ts` | `locations: []` |
| `apps/web/src/features/settings/locations/locations-page.tsx` | branches from the shell; `locations` to the dialog |
| `apps/web/src/features/settings/locations/location-dialog.tsx` | `LOCATION_FORM`, `locationSave`, read-only branch, lengths, floor-area pattern |
| Screens that call `list("locations")` (profile dialog, dashboard, Expenses' shared costs) | no code change; they read the API's ids in api mode (R3, R4) |
| `apps/web/tests/e2e-api/company.spec.ts:191-193` | the comment, and the assertion becomes an exact check of Denver Central's Branch cell (M3) |
| `apps/web/tests/unit/api-rereads.test.ts` | `saveLocation: write(...)` case |

---

## 5. Decisions (for the session log and the ADR section)

- **D1 Split.** 4a locations, 4b shared costs (section 2).
- **D2 Routes and checks.** `POST /locations`, `PUT /locations/:id` in the inventory module beside `GET /locations`; module `core` (class guard), key from `LOCATION_RULE` (= `SETTINGS_SECTIONS.inventory`'s), then in the handler the switch (404), scope `all` (403), the strict body (400); in the service, not found (404), the rules (400), the holds (400); no step-up (`settings.locations.manage` is not an MFA key; the blueprint asks one only for base currency and tax; part 1 Q1).
- **D3 `GET /locations` is not switched.** Every module picks a location (quotes, POs, transfers, receipts, expenses, employees, reports), so the read stays answered while `inventory.locations` is off, like the profile and number format; the switch hides the page and its writes (POST/PUT 404). Closes STATUS ":463".
- **D4 No removal or deactivation.** Not offered: no screen asks, no active column (a schema change), a soft delete hides a location that 22 columns still point at, a hard delete fails on the foreign keys (Q1).
- **D5 A location's branch is fixed; a new one needs a live branch of the company.** Expenses' branch scope reads a location's branch live and quotes re-stamp theirs on each save, so a move would re-scope history (Q2). An unknown branch is refused with words (unlike `knownBranch`, which stores none): fail closed. The update never writes `branch_id`.
- **D6 Warehouse → showroom** only with no stock, no transfer in transit (from or to), no stock held for an invoice (D22) and no open quote shipping from it (header or line); purchase orders and contracts don't block (Q4). Showroom → warehouse always.
- **D7 One default warehouse,** kept by the rule under the stock lock (no partial unique index: a schema change, Q3); a new default clears the old in the same transaction.
- **D8 Every location save takes the stock lock** (`lockStock`), so the holds check serializes with every writer of rolls, movements, transfers and reservations, and two location saves can't both pass the default or name checks. Quote saves don't take it (they read the kind without it); D21 closes what that leaves.
- **D9 Names:** trimmed, 1 to 80, unique among live locations **as the stock import compares names** (`fold` from `import/fields.ts`: trimmed, lower case, runs of spaces, dashes and underscores as one space), because `findLocation` (`import/lookup.ts:51-53`) takes the first folded match. The refusal names the stored name of the location that has it ("Another location is already called Denver Central."). New in both modes.
- **D10 The address rule is the company profile's** (`streetAddressProblem`, extracted, same words). No length rule of its own: every address length is bounded by the API body (part 1's bounds, now `ADDRESS_MAX`, no words) and by the inputs, which stop typing there, as Company profile does. A county length rule was dropped: the API's bound would always speak first, so the two modes would answer differently, and giving the bound words would change Company profile's answers.
- **D11 Samples and floor area:** samples whole 0 to 100,000, showrooms only; floor area blank or `QUANTITY_TEXT` (the API's scale saves back); blank stored as none in both modes.
- **D12 Strict bodies:** outer bounds ten times the rule's maxima with the rule's words (2a's pattern), the kind enum with the rule's words, part 1's address bounds without words; `branchId` checked by membership in JS, never cast in SQL; the body never carries an id (unknown field → 400); the server makes UUID v7 ids; the path takes any UUID (the seed's are v5).
- **D13 Audit:** "Added location" / "Changed location", category `settings`, target the name, before/after as answered (null before an add); the cleared default gets its own "Changed location"; **every saved row is audited, a no-op save too** (as every settings save since part 1); `@Audited()` silences the safety net; refusals write nothing. Last save wins (R6).
- **D14 Transport:** `list`/`get("locations")` → `GET /locations`; `saveLocation` → PUT for a UUID (any version), POST otherwise.
- **D15 Page:** branches from the shell; the shared rule before sending; branch read only on edit; inputs stop at the rule's and the body's lengths; a blank floor area is not sent.
- **D16 DemoStore:** `assertSettingsSave(LOCATION_RULE)`, the shared rules and holds on its own records, `locationStored`, the cleared default audited (`diffSummary`; an add keeps today's text), the generic `save("locations")` refused.
- **D17 The branch limit stays stored, not enforced:** locations aren't branches; no branch editor exists. Notes that tied it to "Settings → Locations moves" are reworded to "a branch editor"; `plan-limits.ts`'s comment (core) is left and listed in STATUS.
- **D18 Security review required** (data scope, permissions, tenancy of ids, stock integrity incl. D21); no schema review.
- **D19 Tests:** API cases in their own provisioned companies; the api-mode e2e edits a seeded showroom and puts it back, and checks POST's routing by stopping the request in the browser, because a created location could never be removed from the shared e2e database. **Every e2e write that is expected to be refused carries a second reason to refuse it** (LNE2's POST also takes an existing name), the POST interception catches any URL ending in `/locations` and lets reads through, and both e2e tests register clean-ups that put Southgate Showroom and Colorado Springs back, so a regression can't leave the shared database changed for later tests.
- **D20 Answers at scale:** the API answers `floorAreaSqFt` as stored (`"2400.000"`); the dialog takes it; no trimming on screen (R13).
- **D21 Converting a quote checks its warehouses under the stock lock.** `POST /quotes/:id/invoice` refuses, right after `lockStock`, a quote whose header or line warehouse is not a live warehouse ("Fulfil the quote from a warehouse.", the quote save's words). Quote saves read the kind without the stock lock, so a quote saved at the moment its warehouse becomes a showroom can stay open there (R16); without this check its conversion would reserve short at a showroom that nothing can fill (transfers and receipts refuse showrooms). Taking the stock lock in every quote save was not chosen: it would serialize quoting with every stock change. The demo is unchanged (one browser, no race). Spec `sales.md` rule 19 says so.
- **D22 A short row doesn't block the showroom change.** A hold counts only when it holds stock: an `active` reservation whose `quantity` is above zero, read by value. A short row (`quantity` 0, `shortBy` above 0) holds nothing, nothing ever fills it (inventory.md "Short lines stay short"), it can't be issued, and only voiding its invoice releases it, so refusing on it would block the change for good with advice nobody can follow. The refusal for a real hold says what can be done: "... has stock held for invoices. Issue it, or void the invoice, before making it a showroom." R15 records what stays.
- **D23 One scope check, one quantity pattern** (CLAUDE.md Style, no duplicated logic). The inventory controller imports the settings controller's `requireWholeCompany` (exported; same words) instead of a fourth copy, and the service uses `refuse` directly instead of a copied `check`. `QUANTITY_TEXT` in `decimal-text.ts` is the inventory controller's `QUANTITY` pattern and the floor area's. A separate `settings-scope.ts` was not taken (a 17th product file); the other scope copies (finance, reports, hr) are a STATUS sweep.
- **D24 Process.** Stacked on 3b (#55), the orchestrator's safest option while CI is blocked by billing. **No test-writer subagent:** feature.md step 4 hands API and Playwright tests to it, but this session runs as a subagent without one, so the builder writes them from section 7, as parts 1 to 3b did (3a's D22). STATUS and BRANCHES are the orchestrator's, and so are marking the PR ready and merging it.

---

## 6. Files

**Product (16; 2 new; `contract.ts` comment-only; `settings.controller.ts` one `export`):**
- Shared (4): `packages/shared/src/settings/location-rules.ts` (new), `packages/shared/src/settings/section-rules.ts`, `packages/shared/src/decimal-text.ts`, `packages/shared/src/index.ts`.
- API (6): `apps/api/src/modules/inventory/locations.service.ts` (new), `apps/api/src/modules/inventory/inventory.controller.ts`, `apps/api/src/modules/inventory/inventory.module.ts`, `apps/api/src/modules/settings/settings-input.ts`, `apps/api/src/modules/settings/settings.controller.ts`, `apps/api/src/modules/sales/invoices.service.ts`.
- Web (6): `apps/web/src/lib/api/http/api-methods.ts`, `apps/web/src/lib/api/demo/store.ts`, `apps/web/src/lib/api/demo/permission-rules.ts`, `apps/web/src/features/settings/locations/locations-page.tsx`, `apps/web/src/features/settings/locations/location-dialog.tsx`, `apps/web/src/lib/api/contract.ts` (JSDoc only).

**Tests (new 6, changed 3):** new `packages/shared/test/location-rules.test.ts` (LNR), `apps/api/test/settings-locations.int.test.ts` (LNA), `apps/web/tests/unit/locations-api.test.ts` (LNW), `apps/web/tests/unit/demo-locations.test.ts` (LND), `apps/web/tests/unit/location-form.test.tsx` (LNP), `apps/web/tests/e2e-api/settings-locations.spec.ts` (LNE1, LNE2); changed `apps/web/tests/e2e/warehouses.spec.ts` (LNS1, LNS2), `apps/web/tests/unit/api-rereads.test.ts` (one case), `apps/web/tests/e2e-api/company.spec.ts` (the exact Branch check, M3).

**Docs:** session log `docs/sessions/2026-11-17-HHMM-b-settings-locations-api.md` (new), ADR 0059 (dated section, row 4), `docs/api-contract.md`, `docs/product-spec/settings-and-permissions.md`, `docs/product-spec/inventory.md`, `docs/product-spec/sales.md` (rule 19, D21), `docs/data-model.md`, `docs/FEATURES.md`, `docs/blueprint-delta.md` (one row). Not STATUS or BRANCHES (the orchestrator applies section 11).

---

## 7. Tests

Every case names its id first (for the mutation runs).

### 7.1 Shared: `packages/shared/test/location-rules.test.ts` (LNR)

Fixtures: two branches `b1`, `b2`; a default warehouse `W` "Denver Central" (b1), a warehouse `X` (b2), a showroom `S` (b1); `input(patch)` builds a `LocationInput` from `S`.
- **LNR1** `LOCATION_RULE` equals `SETTINGS_SECTIONS.inventory`'s keys, feature and module.
- **LNR2** name: `""`, `"   "` → `name`; 81 characters after trimming → `nameLength`; 80 → null; `"  Annex  "` passes (trimmed).
- **LNR3** kind `"depot"` (cast) → `kind`.
- **LNR4** branch: new with `"sm-br-denver"` or a branch not in the list → `branch`; new with `b1` → null; edit `S` to `b2` → `branchFixed`; edit with `S`'s branch when that branch is no longer in the list → null.
- **LNR5** address: blank street, blank city, `"Colorado"`, `"8020"`, `lat: NaN` → the five `PROFILE_MESSAGES` words in that order; `streetAddressProblem` gives `companyProfileProblem`'s words (and `companyProfileProblem` still refuses the same profile, pinned by part 1's R-cases); a county of 500 characters → null (no length rule of its own, D10); `ADDRESS_MAX` equals `{ street: 200, city: 100, zip: 10, county: 100 }`.
- **LNR6** samples: `-1`, `1.5`, `100001` → `samples`; `0` and `100000` on a showroom → null; a warehouse with `3` → `warehouseSamples`; the message names "100,000" and `DISPLAY_SAMPLES_MAX` is 100000.
- **LNR7** floor area: absent, `""`, `"3200"`, `"18000.000"`, `"9999999999.999"` → null; `"12."`, `".5"`, `"1e3"`, `"-1"`, `"12345678901"`, `"1.2345"`, `" 12"`, `"0x10"` → `floorArea`; `QUANTITY_TEXT_MAX` equals `"9999999999.999".length`; `QUANTITY_TEXT` takes `"12"` and `"12.5"` and refuses `"12.5555"` (the inventory controller's quantities).
- **LNR8** names (D9): `" denver central "`, `"Denver-Central"`, `"denver_central"` and `"Denver  Central"` against `W` → `sameName("Denver Central")` (the stored name); `"Denver Centre"` → null; an edit of `W` keeping its own name → null; an edit of `S` renamed `"DENVER CENTRAL"` → `sameName("Denver Central")`.
- **LNR9** default: a showroom with `isDefault` → `showroomDefault`; editing `W` to `isDefault: false` → `oneDefault`; a new non-default warehouse while `W` is default → null; a new default warehouse → null; the first location of a company (no others) non-default → `oneDefault`.
- **LNR10** order: a blank name and a showroom default together → `name`; a duplicate name and a showroom default → `sameName`.
- **LNR11** `becomesShowroom`: `W` → showroom true; new showroom false; `S` → showroom false; `S` → warehouse false.
- **LNR12** `locationHolds(W.id, records)`, one field at a time: a roll at `W` with `"0.5"` left → stock; `"0"` left → none; a roll at `W` with a `transferId` (in transit from it) → stock; boxed `+10` then `-10` → none, `+10` → stock; a transfer `in_transit` from `W` → transfers, to `W` → transfers, `received` → none; reservations (D22): `active` with quantity `"2"` → holds; `active` with quantity `"0"` and `shortBy` `"5"` → none; `active` `"0.000"`/`"5.000"` (the API's scale) → none; `active` `"2"` with `shortBy` `"3"` → holds; `released` and `issued` with `"2"` → none; quotes `draft`/`pending`/`accepted` from `W` → quotes, `converted`/`declined` → none, a pending quote at `X` with a line `locationId: W.id` → quotes; every record of `X` → none.
- **LNR13** `locationHoldsProblem`: all four true → `holdsStock(name)`; transfers+holds+quotes → `inTransit`; holds+quotes → `heldStock` (exactly "W has stock held for invoices. Issue it, or void the invoice, before making it a showroom." for the name "W"); quotes → `openQuotes`; none → null.
- **LNR14** `locationStored`: `"  Annex  "` → `"Annex"`; `floorAreaSqFt: ""` → the key absent (`"floorAreaSqFt" in stored` is false); `"2400"` kept; address, kind, branch, samples, default as sent.

### 7.2 API: `apps/api/test/settings-locations.int.test.ts` (LNA)

Companies (own, provisioned in `beforeAll`): `floorco` (flooring) with branches Main and North, warehouses **A "Main Warehouse"** (default, Main) and **B "North Warehouse"** (North), showroom **S "Main Showroom"** (Main), inserted directly as `inventory.int.test.ts:39-115` does (with an `addStock`-style set-up: a boxed product with 200 at A, a carpet roll at A), a customer, and a `localization` row (Summit's, without tax tables, as 2a's tests) so quotes and invoices work; `peopleco` (hr); `otherco` (flooring, its own branch and default warehouse). Helpers copied per file (2a's D19): `withCompanyDb`, `member(company, roles)`, `expectedPermissions`, `expectedWrite` (module first, then key, then scope), `withFeatureOff`, `locationRow(id)`, `defaults(company)` (ids with `is_default`), `auditsOf(company, action)`, `auditCount`, `post(cookie, body)`, `put(cookie, id, body)`, `body(patch)` (S's fields), `insertLocation(company, fields)` (direct SQL, for LNA18), and **`accepted(cookie, customerId, location, lines?)`**: `invoices.int.test.ts`'s `invoiced` (`:158-189`) without its conversion (POST /quotes, send with `expiresAt: "2099-01-01"`, accept).

- **LNA0** metadata: `createLocation` and `updateLocation` declare `LOCATION_RULE.keys`, module `core` (class), `@Audited()`; `locations` (GET) still `anyMember` (A0's `permissionRequirement`/`isAudited`).
- **LNA1** every default role of both products, POST and PUT: `expectedWrite` (flooring Owner 201/200; every other flooring role 403 `forbidden`; every HR Suite role 403 `module_not_enabled`); each refusal leaves `locations` and `audit_log` counts unchanged.
- **LNA2** another company: `otherco`'s Owner `PUT /locations/<floorco's S id>` → 404 `not_found`, floorco's row unchanged; `otherco`'s Owner `POST` with floorco's branch id → 400 `branch` words, nothing stored in either company; `POST` with otherco's own branch → 201 in otherco only.
- **LNA3** switch `inventory.locations` off (`withFeatureOff`): POST and PUT → 404; `GET /locations` → 200 with the same list (D3). *(Passes on both heads by design: no route answers 404 too; recorded.)*
- **LNA4** module: `peopleco` Owner → POST/PUT 403 `module_not_enabled`; `GET /locations` → 403 (unchanged).
- **LNA5** scope: a custom role in floorco with `settings.locations.manage` and data scope `branch` → POST/PUT 403 `forbidden` with `SETTINGS_SCOPE_MESSAGE`; nothing written. **LNA5b** ceiling: floorco's ceiling without `settings.locations.manage` (`tenantPermissionCeiling`) → Owner 403 `forbidden`; ceiling put back.
- **LNA6** strict bodies, each 400 `invalid_request` and nothing written: an `id` field; `deletedAt`; an unknown address field; `displaySamples: "3"`; `floorAreaSqFt: 3200`; `isDefault: "true"`; no `kind`; a name of 801 characters (with `nameLength`'s words); a county of 101 characters and a street of 201 (part 1's bounds, D10); `PUT /locations/not-a-uuid` → 400.
- **LNA7** the shared words (table-driven, one row each, 400 with exactly the message): blank name; 81-character name; kind `"depot"` (the enum carries the rule's words, D12); branch `"sm-br-denver"`; a live branch of another company (otherco's id); ZIP `"8020"`; samples `-1`; a warehouse with samples 3; floor area `"12."`; name `" main warehouse "` → "Another location is already called Main Warehouse."; name `"Main-Warehouse"` → the same words (D9); a showroom default; `isDefault: false` on A (the only default).
- **LNA8** add: Owner POSTs a showroom in North with floor area `"2400"` → 201; the answer has a UUID v7 id, `floorAreaSqFt: "2400.000"`, equals `GET /locations`'s entry; the row's `created_by` is the Owner's user id; one "Added location" entry, category `settings`, target the name, `before` null, `after` the answer; `QUANTITY_TEXT.test(answer.floorAreaSqFt)` (the answer saves back).
- **LNA9** change: PUT S renamed with floor area `""` → 200; the row's `floor_area_sq_ft` is null, the answer has no `floorAreaSqFt`; `updated_at` later than before; one "Changed location" entry with `before` the old answer and `after` the new; a PUT of the answer as read (floor `"2500.000"` after a second save) → 200 (the scale saves back).
- **LNA10** default: PUT B `isDefault: true` → 200; B is the only default; two entries: "Changed location" for B and "Changed location" for A with `before.isDefault` true and `after.isDefault` false; PUT A `isDefault: false` while B is default → 200 and nothing else changes; PUT B `isDefault: false` (only default) → 400 `oneDefault`.
- **LNA11** branch fixed: PUT S with North's id when it is in Main → 400 `branchFixed`; the row's `branch_id` unchanged; a direct-SQL soft delete of Main (set `deleted_at`) then PUT S unchanged → 200 (a stored branch no longer live is kept); Main restored.
- **LNA12** warehouse → showroom (each on a fresh warehouse made with POST, so one reason at a time; each refusal 400 with the location's name in the words, nothing written, no audit entry):
  1. boxed stock (an `opening` movement of 10 inserted) → `holdsStock`; a `-10` movement added → allowed (200), then PUT back to warehouse.
  2. a roll with 5 ft left → `holdsStock`; `remaining_length_ft` set to 0 → allowed.
  3. a roll at it sent by `POST /transfers` to A (in transit from it; the roll keeps its location) → `holdsStock`.
  4. `POST /transfers` A → it with boxed stock (it holds nothing yet) → `inTransit`; `POST /transfers/:id/receive` → `holdsStock`.
  5. an active reservation with quantity `"2"` at it (inserted directly, referencing an invoice and line made by `invoiced(...)` at A) → `heldStock` (exactly its words); status set to `released` → allowed, then PUT back to warehouse.
  5b. an active **short row** at it (`quantity` 0, `short_by` 5; same references) → **allowed** (D22), then PUT back to warehouse.
  6. a draft quote fulfilled from it (`POST /quotes`) → `openQuotes`; `PUT /quotes/:id` moving the quote to A → allowed (a draft can't be declined: `quoteActions` offers only "send").
  7. a pending quote at A with one line `locationId` = it → `openQuotes`.
- **LNA13** the lock: (a) a test transaction holds `pg_advisory_xact_lock(hashtext('inventory:stock'))`; a PUT sent meanwhile has not answered after 500 ms; after the test transaction ends it answers 200. (b) POST a warehouse **C**, then PUT C `isDefault: true` (200; neither A nor B is the default now). Then two PUTs at once, A `isDefault: true` and B `isDefault: true` → both 200. Afterwards exactly one default, `Wn` ∈ {A, B}; `Ls` is the other. The "Changed location" entries written since the race are exactly four, matched by content (not by time: `at` is the writer's clock, and the waiting transaction began earlier): `Wn`'s own (`after.isDefault` true); `Ls`'s own (`after.isDefault` true); `Ls` cleared (`before.isDefault` true, `after.isDefault` false, written by `Wn`'s PUT); C cleared (the same, written by `Ls`'s PUT). This holds in either order.
- **LNA14** not found: PUT a random UUID → 404 `not_found` and no row is created with that id; PUT a location soft-deleted directly (set `deleted_at`) → 404; restored after.
- **LNA15** readers unchanged: Sales and Warehouse members of floorco read `GET /locations` including LNA8's showroom; HR Suite 403. *(Passes on both heads except for the added row; recorded.)*
- **LNA16** the server acts on a saved location: a new warehouse made by POST receives `POST /transfers` from A (201) and is accepted as a quote's warehouse (`POST /quotes`, 201); a showroom turned warehouse (S → warehouse, samples 0) is accepted by `POST /transfers` too.
- **LNA17** see LNA8/LNA9 (the API's scale saves back).
- **LNA18** conversion (D21). Warehouses **W2** and **W3** are inserted directly (`insertLocation`), so the case is red on 3b's head for the conversion itself, not for a missing route.
  1. `accepted(owner, customer, W2)`; W2's `kind` set to `showroom` by SQL (what a quote save racing a location save, or a row written outside the API, leaves; R16); `POST /quotes/:id/invoice` → 400 "Fulfil the quote from a warehouse."; the counts of `invoices`, `reservations` and journal entries are unchanged and the quote is still `accepted`. W2 set back to `warehouse` by SQL → the conversion → 201 (the check refuses only what isn't a warehouse).
  2. `accepted(owner, customer, A, [a line with locationId W3])`; W3's `kind` set to `showroom` → 400 with the same words; nothing written.
  3. W3 back to `warehouse` but soft-deleted (`deleted_at` set) → 400 (not a live warehouse); restored.

### 7.3 Web transport: `apps/web/tests/unit/locations-api.test.ts` (LNW)

- **LNW1** `list("locations")` sends `GET /locations` and answers its body; a 403 answers `[]`; `get("locations", id)` sends `GET /locations` and finds the id; nothing reaches the demo stub (`fakeApi`'s stub throws for anything routed elsewhere).
- **LNW2** `saveLocation({ id: "summit-loc-1a2b3c4d", ...})` sends `POST /locations` with a body **without `id`**; `saveLocation({ id: <a v7 uuid>, ...})` and `saveLocation({ id: <a v5 uuid, as the seed makes> , ...})` each send `PUT /locations/<id>`, body without `id`; each answers the API's location; `changes()` goes up once per write (re-read).
- `api-rereads.test.ts`: `saveLocation: write((c) => c.saveLocation(stub({ id: ID })))` (the `CASES` table must name every key of `API_METHODS`).

### 7.4 DemoStore: `apps/web/tests/unit/demo-locations.test.ts` (LND)

Same set-up as `demo-settings.test.ts` (`OFF` switches via `vi.mock`, `open(company, userId)`, Summit's Dana and Priya, Harbor's owner).
- **LND1** order: Harbor's Owner → "This part of the product is not switched on for your company."; Priya → the role words; `inventory.locations` off → "This feature is switched off." (and Priya with it off still gets the role words first); Dana viewing as a custom role with the key and scope `branch` → `SETTINGS_SCOPE_MESSAGE`.
- **LND2** the shared words: a duplicate name ("denver-central") → "Another location is already called Denver Central."; Southgate moved to Denver's branch (`branchFixed`); floor area `"12."`; a showroom default; Denver Central `isDefault: false`.
- **LND3** holds: Colorado Springs → showroom → `holdsStock("Colorado Springs")` (fixture stock); a new warehouse `N` (Denver) and `createTransfer` from Denver Central to `N` → `inTransit`; a new warehouse `Q` with a quote saved from it (`saveQuote`) → `openQuotes`; the quote saved again with Denver Central's `locationId` → allowed.
- **LND4** a location saved with `floorAreaSqFt: ""` is stored without the key, and `store.businessReport(<this month's filters>)` answers (no throw) with the new location's row. *(Red on `L`: the stored `""` makes `weightsFor` throw.)*
- **LND5** a new default clears the old: `N` with `isDefault: true` → Denver Central not default; two new audit entries: "Added location" (or "Changed location") for `N` and "Changed location" for Denver Central with before "isDefault: true" and after "isDefault: false".
- **LND6** generic `save("locations", {...Southgate, isDefault: true})` → the role words (`store.internal.manage`); nothing stored. Every refusal in LND1 to LND6 leaves `list("locations")` and `list("audit")` unchanged.

### 7.5 Dialog: `apps/web/tests/unit/location-form.test.tsx` (LNP)

- **LNP1** `LOCATION_FORM` takes `floorAreaSqFt: "18000.000"` (the API's answer) and `""`; refuses `"12."`, `".5"` with `LOCATION_MESSAGES.floorArea`; refuses an 81-character name with `nameLength`; refuses samples `100001`.
- **LNP2** `locationSave` on an edit keeps `location.branchId` whatever `values.branchId` says; on a new one uses `values.branchId` and `newId`; leaves a blank floor area out; sets `isDefault` false and keeps samples for a showroom, samples 0 for a warehouse.
- **LNP3** `locationSave` answers the shared rule's problem for a duplicate name and for a showroom that was the only default, and null for a valid edit.

### 7.6 Api-mode e2e: `apps/web/tests/e2e-api/settings-locations.spec.ts` (LNE1, LNE2)

Local types only (the spec must build on `L` for the red run). `SOUTHGATE(branchId)` = the fixture's fields (name "Southgate Showroom", showroom, the address of 1.7, `isDefault: false`, `displaySamples: 96`, `floorAreaSqFt: "2400"`); `southgateOf(list)` finds it by street "3380 Meadowgate Drive" (a killed run may have renamed it); `COLORADO(cs)` = Colorado Springs as read, as a warehouse (`kind: "warehouse"`, `isDefault: false`, `displaySamples: 0`, its other fields as read, no `id`); `restoreOrThrow(request, id, body)` PUTs and throws unless 200; `branchCell(page, rowName, branch)` = `page.getByRole("row", { name: rowName }).getByRole("cell", { name: branch, exact: true })` (the City cell reads "<city>, CO", so only the Branch cell matches exactly). `resetAuthAround([OWNER_EMAIL, SALES_EMAIL])`.

- **LNE1** "Warehouses and showrooms on the API: a showroom's change round-trips and shows in another person's picker, a warehouse with stock stays one, and a new location goes to POST without an id":
  0. Dana (MFA) and Priya. Heal: `sg = southgateOf(GET /locations)` (fail with "the e2e database has no Southgate Showroom" if absent) and `cs` = the location named "Colorado Springs"; `personas.onCleanup("put Southgate back", () => restoreOrThrow(dana.request, sg.id, SOUTHGATE(sg.branchId)))` and `personas.onCleanup("put Colorado Springs back", () => restoreOrThrow(dana.request, cs.id, COLORADO(cs)))`; the heal PUT of Southgate answers 200; `healed` = `GET /locations`' Southgate right after it. `since = Date.now()`; `seen` = Dana's "Changed location" entry ids since then.
  1. `/settings/locations`: `branchCell(page, /Southgate Showroom/, "Colorado Springs")` is visible (the API's branch, named from the shell's branches; empty if the page still read DemoStore's branches); `branchCell(page, /Denver Central/, "Denver")` is visible; the Denver Central row shows "Default".
  2. Edit Southgate: the "Branch" combobox is disabled; "Floor area, sq ft" shows `"2400.000"`; Name "Southgate Showroom E2E", Floor area "2500", Display samples "97"; Save; the `PUT /api-proxy/locations/<id>` answers 200; toast "Southgate Showroom E2E saved"; the row shows the new name.
  3. `GET /locations`: name "Southgate Showroom E2E", `floorAreaSqFt` "2500.000", 97 samples, same branch, showroom; Denver Central still the only default.
  4. Priya's `/sales/quotes/new`: "Sold at" lists "Southgate Showroom E2E".
  5. Dana's "Changed location" entries since `since` not in `seen`: exactly one, target "Southgate Showroom E2E".
  6. Edit Colorado Springs → Type Showroom → Save: the PUT answers 400 and the dialog's alert reads "Colorado Springs holds stock. Transfer it out before making it a showroom."; Cancel; `GET /locations` still says warehouse.
  7. POST's routing without a record: `page.route(/\/locations(\?.*)?$/, handler)`, where the handler does `if (route.request().method() !== "POST") return route.fallback();` and otherwise keeps `postDataJSON()` and fulfils 409 `{ code: "conflict", message: "Stopped by the test." }` (any URL ending in `/locations` is caught, so a changed prefix can't let the POST through, and the page's reads pass). Add location, Name "E2E Annex", Type Showroom, Street "1 Test Way", City "Denver", State "CO", ZIP "80202", Save; the alert reads "Stopped by the test."; the kept body is not null, has no `id` and no `floorAreaSqFt`, its `branchId` is one of `GET /company`'s branch ids, `displaySamples` 0, `isDefault` false; unroute; Cancel; `GET /locations` has no "E2E Annex".
  8. Put back through the page: Edit "Southgate Showroom E2E", Name "Southgate Showroom", Floor area "2400", samples "96", Save → 200; `canonical(GET's Southgate)` equals `canonical(healed)` (GET compared with GET).
- **LNE2** "What the page doesn't offer, the API refuses": heal Southgate and register both clean-ups as in LNE1 step 0; `before` = `GET /locations` after the heal; `since` after the heal. Priya `PUT /api-proxy/locations/<sg>` → 403 `forbidden`; Dana PUT with Denver's branch id → 400 with `branchFixed`'s words; Dana PUT with `id` in the body → 400 `invalid_request`; Dana PUT name " Denver Central " → 400 "Another location is already called Denver Central."; Dana PUT Colorado Springs as a showroom → 400 with `holdsStock`'s words; Dana POST `SOUTHGATE(...)` with `branchId: "sm-br-denver"` **and the name "Southgate Showroom"** → 400 "Choose the branch this location belongs to." (if the branch check ever broke, the duplicate name still refuses it and nothing is written; D19); afterwards `GET /locations` equals `before` (`canonical`) and Dana has no new "Added location"/"Changed location" entry since `since`.

### 7.7 Demo e2e: `apps/web/tests/e2e/warehouses.spec.ts` (LNS1, LNS2)

- **LNS1** "a new showroom with no floor area is added and the Business report still opens with it": Owner, Add location, Name "Annex Showroom", Type Showroom, the first branch (Denver), Street "1 Annex Way", City "Denver", State "CO", ZIP "80202", floor area blank, Save; toast "Annex Showroom saved"; `getByRole("row", { name: /Annex Showroom/ }).getByRole("cell", { name: "Denver", exact: true })` visible (the Branch cell; City reads "Denver, CO"); `/reports`: heading "Profit by location" and `getByLabel("Annex Showroom", { exact: true })` visible (as `reports.spec.ts` checks names). *(Red on `L` if the stored `""` breaks the report; if it passes on `L`, record it: LND4 still pins the stored shape.)*
- **LNS2** "an edit keeps the branch read only, and another location's name is refused before anything is saved": Edit Southgate Showroom; "Branch" disabled; Name "denver central"; Save; alert "Another location is already called Denver Central."; Cancel; the "Southgate Showroom" row is still there.
- The existing "refuses to turn a warehouse that holds stock into a showroom" keeps passing (same words).

### 7.8 Earlier tests 4a changes or relies on

| Test | Change | Why |
| --- | --- | --- |
| `apps/web/tests/unit/api-rereads.test.ts` | add `saveLocation` | `CASES` names every routed method |
| `apps/web/tests/e2e-api/company.spec.ts:191-193` | comment: "Settings → Locations reads the API's locations and the shell's branches since part 4a"; the assertion becomes `page.getByRole("row", { name: /Denver Central/ }).first().getByRole("cell", { name: "Denver", exact: true })` visible | M3: `toContainText("Denver")` also matched the name and City cells. Passes on `L` too (DemoStore's locations and branches agree there) |
| `apps/web/tests/e2e/warehouses.spec.ts` | LNS1, LNS2 | 7.7 |
| part 1's R-cases (`settings-sections.test.ts`) and A-cases (`settings.int.test.ts`) | none | pin `companyProfileProblem`, `PROFILE_INPUT` and part 1's scope words through the extraction and the export |
| `inventory.int.test.ts` | none | pins the controller's `QUANTITY` (now `QUANTITY_TEXT`) |
| `invoices.int.test.ts`, `sales.int.test.ts`, `stock-issue.int.test.ts` | none | every conversion at a warehouse still passes D21's check |
| `purchasing.int.test.ts`, `expenses.int.test.ts`, `reports.int.test.ts`, `imports.int.test.ts`, `company.int.test.ts`, `permissions.int.test.ts`, `isolation.int.test.ts` | none | run in stage 2 (route inventories cover the new routes by design) |
| `packages/shared/test/access-rules.test.ts`, `features.test.ts`, `decimal-text.test.ts`, `expenses.test.ts`, `import*.test.ts` | none | run in stages 2 and 4 |

### 7.9 Which test pins which path

| Path | API | Demo | Shared | Web | E2e |
| --- | --- | --- | --- | --- | --- |
| module, key, switch, scope, ceiling | LNA0, LNA1, LNA3 to LNA5b | LND1 | LNR1 | | LNE2 |
| strict body, no id | LNA6 | | | LNW2 | LNE1.7, LNE2 |
| tenancy of ids, branches | LNA2, LNA7, LNA14 | | LNR4 | | LNE2 |
| branch fixed | LNA11 | LND2 | LNR4 | LNP2 | LNE1.2, LNE2, LNS2 |
| names (fold), address, samples, floor area | LNA6, LNA7, LNA8, LNA9 | LND2, LND4 | LNR2 to LNR8, LNR14 | LNP1 | LNE1.2, LNS1, LNS2 |
| default | LNA10, LNA13b | LND5 | LNR9 | LNP3 | LNE1.3 |
| holds (incl. short rows) | LNA12 | LND3 | LNR11 to LNR13 | | LNE1.6, LNE2, warehouses.spec |
| conversion (D21) | LNA18 | | | | |
| the lock | LNA13a | | | | |
| audit | LNA8 to LNA10, LNA13b | LND5 | | | LNE1.5, LNE2 |
| routing, branches from the shell | | | | LNW1, LNW2, api-rereads | LNE1.1, LNE1.7, company.spec |

---

## 8. Mutations: `SP4/mutate.py`

Written from `SP2B/mutate.py` (same runner: one mutation, its commands, expected failing test regex, `git checkout --` restore, `restored`/`caught` per line), with anchors copied from the **committed** change (anchors keep their commas). Commands: `SHARED` = `pnpm --filter @workspace/shared exec vitest run test/location-rules.test.ts test/settings-sections.test.ts`; `API` = `pnpm --filter api exec vitest run --project integration test/settings-locations.int.test.ts`; `DEMO` = `web("demo-locations.test.ts")`; `WIRE` = `web("locations-api.test.ts")`; `FORM` = `web("location-form.test.tsx")`.

| Id | File | Mutation | Caught by |
| --- | --- | --- | --- |
| LNM1 | controller | POST's `@RequirePermission(...LOCATION_RULE.keys)` → `("inventory.transfer.create")` | API LNA0, LNA1 |
| LNM2 | controller | drop `requireFeature(LOCATION_RULE.feature)` in `createLocation` | API LNA3 |
| LNM3 | controller | drop `requireWholeCompany(access)` in `updateLocation` | API LNA5 |
| LNM4 | controller | drop `.strict()` on `LOCATION` | API LNA6 |
| LNM5 | service | drop `await lockStock(tx);` | API LNA13 |
| LNM6 | service | drop the `notFound("location")` line | API LNA14 |
| LNM7 | service | the update also sets `branchId: input.branchId` and the rule's `branchFixed` line is dropped (two-anchor mutation) | API LNA11, SHARED LNR4 |
| LNM8 | rules | drop the unknown-branch check | SHARED LNR4, API LNA2, LNA7 |
| LNM9 | rules | the name comparison is `l.name.trim() === input.name.trim()` (case-sensitive, no fold) | SHARED LNR8, API LNA7 |
| LNM10 | rules | drop the `oneDefault` check | SHARED LNR9, API LNA10 |
| LNM11 | service | `cleared` always `[]` | API LNA10, LNA13b |
| LNM12 | service | drop the cleared default's audit loop | API LNA10, LNA13b |
| LNM13 | service | the main audit's `before: before ?? null` → `before: null` | API LNA9 |
| LNM14 | rules | rolls ignored in `locationHolds` | SHARED LNR12, API LNA12 |
| LNM15 | rules | boxed stock ignored | SHARED LNR12, API LNA12 (step 1). Not DEMO LND3: Colorado Springs also has 18 live rolls in the fixture (N3) |
| LNM16 | rules | transfers only `fromId` | SHARED LNR12, API LNA12 (step 4) |
| LNM17 | rules | reservations' status ignored | SHARED LNR12, API LNA12 (step 5, the released row) |
| LNM18 | rules | quote lines ignored | SHARED LNR12, API LNA12 (step 7) |
| LNM19 | rules | `quoteIsOpen(q)` → `true` | SHARED LNR12, API LNA12 (step 6) |
| LNM20 | rules | `becomesShowroom` returns false | SHARED LNR11, API LNA12, DEMO LND3 |
| LNM21 | rules | `locationStored` keeps a blank floor area | SHARED LNR14, DEMO LND4 |
| LNM22 | decimal-text | `QUANTITY_TEXT` with `\d{1,2}` decimals | SHARED LNR7, FORM LNP1, API LNA9 |
| LNM23 | rules | drop `warehouseSamples` | SHARED LNR6, API LNA7 |
| LNM24 | rules | drop the samples upper bound | SHARED LNR6 |
| LNM25 | section-rules | drop the ZIP line of `streetAddressProblem` | SHARED LNR5 and part 1's profile case |
| LNM26 | api-methods | drop `locations: "/locations"` | WIRE LNW1 |
| LNM27 | api-methods | `saveLocation` always POST | WIRE LNW2 |
| LNM28 | api-methods | send `location` (with id) as the body | WIRE LNW2 |
| LNM29 | store | `assertSettingsSave(db, LOCATION_RULE)` → `assertCan(db, LOCATION_RULE.keys)` | DEMO LND1 |
| LNM30 | permission-rules | `locations: ["settings.locations.manage"]` | DEMO LND6 |
| LNM31 | dialog | `locationSave` takes `values.branchId` on an edit | FORM LNP2 |
| LNM32 | dialog | `locationSave` returns `problem: null` | FORM LNP3 |
| LNM33 | rules | `fold(...)` in the name comparison → `.trim().toLowerCase()` (no folding of spaces, dashes, underscores) | SHARED LNR8, API LNA7 (the `"Main-Warehouse"` row) |
| LNM34 | rules | the reservation hold drops `dec(quantity).gt(0)` (a short row counts) | SHARED LNR12, API LNA12 (step 5b) |
| LNM35 | invoices.service | drop the conversion's `if (!shipsFrom.every(...)) throw refuse(...)` line | API LNA18 |

A mutation not caught: strengthen its test (it must fail on the mutation and pass on the code), commit the test, run that mutation again.

---

## 9. DemoStore parity

| Check | API | DemoStore |
| --- | --- | --- |
| Module `core` | class guard: 403 `module_not_enabled` ("This part of the product is not switched on for your company.") | `assertSettingsSave`, same words |
| Key | guard: 403 `forbidden` | role words |
| Switch `inventory.locations` | 404 | "This feature is switched off." |
| Scope `all` | 403 `SETTINGS_SCOPE_MESSAGE` (the settings controller's `requireWholeCompany`) | same words (View as limits it) |
| Body shape | strict Zod 400 (the kind and lengths with the rule's words; address lengths without) | typed by the screen; inputs stop at the same lengths |
| Unknown id | 404 | an id it doesn't hold is a new location (ids come from the dialog) |
| Content, branch, name (fold), default | `locationProblem` | same function, same words, same order |
| Warehouse → showroom | `locationHolds` on narrow reads by location id (short rows ignored) | `locationHolds` on its own lists (the same) |
| Stored form | `locationStored`; floor area null; scale on read | `locationStored`; key left out; as typed |
| New default | clears the old, audits both | same |
| Audit before/after | the answered JSON | an add: `"<kind>[, default]"`; a change and the cleared default: `diffSummary` |
| Lock | `lockStock` | none (one browser) |
| Converting a quote at a former warehouse | refused under the stock lock (D21) | unchanged: no race in one browser, and the showroom change is refused while a quote is open |
| Generic `save` | n/a | refused |
| Read | `GET /locations` (no switch) | `list("locations")` from its copy |

Kept different, as earlier parts: ids, audit text, scale, no lock, the conversion check.

---

## 10. Docs

### 10.1 Session log `docs/sessions/2026-11-17-HHMM-b-settings-locations-api.md`
Goal, the split (D1), stage 0's re-read of `L`, D1 to D24 (D24: no test-writer subagent, as parts 1 to 3b), the critique items taken and not taken (this plan's "What changed" table), the decision table 4.1, build decisions (B1 …), red results with reasons, the mutation lines, the commands table, "For STATUS", "BRANCHES", outcome.

### 10.2 ADR 0059: "## 2026-11-17: part 4a, Warehouses and showrooms" (after 3b's section)
- **Status:** accepted 2026-11-17, branch `feat/settings-locations-api`, draft PR #<n>, stacked on #55 and through it on #54 to #45; queue item 2, task 2, part 4a; owner asleep, safest options; session log path; "ADR 0059, part 4a, D<n>".
- **Context:** in api mode the page listed and saved DemoStore's locations while every module read the API's; `list("locations")` wasn't served; the dialog's floor-area pattern refused the API's scale; the demo's blank floor area broke its Business report; GET /locations' switch was undecided; the page read branches from `getCompany()` (ADR 0051 D7); quote saves read a warehouse's kind outside the stock lock and conversion read none.
- **Decision:** routes and order (D2), D3, the decision table of 4.1 (D4 to D11, D22), the lock (D8), bodies (D12), audit (D13), web (D14, D15), DemoStore (D16), the branch limit (D17), the conversion check (D21), one scope check and one quantity pattern (D23).
- **Later parts:** 4b shared costs (section 17); retiring a location (Q1) and moving one (Q2) wait for the owner; a branch editor brings the branch limit.
- **Consequences:** deploy the API first (a 4a web against an older API: lists still work, saves answer 404 in the dialog, fails closed; an older web ignores the routes); the demo refuses more (module, switch, scope, branch change, folded duplicate names, the new holds, generic save); a quote whose warehouse stopped being one is refused at conversion; R3, R4, R5, R15, R16; no schema, migration, dependency, core, auth, tenancy, provider or control change.
- **Tests:** LNR1 to LNR14, LNA0 to LNA18, LNW1, LNW2, LND1 to LND6, LNP1 to LNP3, LNE1, LNE2, LNS1, LNS2; mutations LNM1 to LNM35.
- **Row 4 of "Later parts"** (`:78`): prefix "**Split (2026-11-17):** 4a, Warehouses and showrooms, is built (section '2026-11-17: part 4a' below); 4b, Shared costs, follows on its pattern."

### 10.3 `docs/api-contract.md`
- New "## Settings, part 4a: warehouses and showrooms (real build, ADR 0059, 2026-11-17)" after the last Settings section: the two routes (needs, order, bodies, answers, refusals with codes and words), the holds (short rows don't count), the lock, audit, D3.
- "Inventory, part 1" `GET /locations` row (`:325`): "answered while `inventory.locations` is off (part 4a D3)".
- The quote conversion row (`POST /quotes/:id/invoice`, find by text): "refuses, under the stock lock, a quote whose header or line warehouse is no longer a live warehouse: 400 'Fulfil the quote from a warehouse.' (part 4a D21)".
- `getCompany()` row (`:768`): drop "Settings → Locations reads its branches here".
- Records (`:780`): "`list` and `get` of `locations` read `GET /locations` in api mode; the generic `save` refuses `locations`".
- `saveLocation` row (`:841`): "`POST /locations` for an id the API didn't make, else `PUT /locations/:id` (any UUID); body without the id" and the rules.

### 10.4 `docs/product-spec/settings-and-permissions.md` and `docs/product-spec/sales.md` (stage 0, by text on `L`)
- **settings-and-permissions.md:** "Who uses it" `:36` (API routes; Stock rules stays on `updateSettings`); rule 6 table (`locations` refuses the generic save); **rule 29 rewritten** (4.1, `location-rules.ts`, both modes, names compared as the import compares them, short rows don't block); audit rows (`Added location`, `Changed location`, the cleared default, a no-op save too); Real build: "The shell on the API" last bullet (Locations reads the API's since part 4a); a new "**Settings on the API, part 4a: Warehouses and showrooms**" block (who reads, which routes, what editing may do, no removal, the conversion check, the demo); Known limits: the branch limit "until a branch editor exists"; the unmoved list without Warehouses and showrooms; new limits R3, R4, R5, R15, R16, R17.
- **sales.md rule 19** (`:304`, Conversion): add "On the API the conversion also refuses, under the stock lock, a quote whose warehouse (the header's or a line's) is no longer a live warehouse: 'Fulfil the quote from a warehouse.' (ADR 0059, part 4a, D21). Quote saves check the kind without that lock, so a warehouse can become a showroom while a quote is being saved; in the demo it can't (one browser)." 3b edits other lines of sales.md (`:75`, `:76`, `:682`); anchor by text on `L`.

### 10.5 Other docs
- `docs/product-spec/inventory.md`: "Who uses it" `:35` (API routes); rule 24 (4.1, pointing to settings rule 29; short rows don't block, D22); Location entity (`branchId` fixed; `floorAreaSqFt` up to 3 decimals, blank is none; name unique as the import folds it); audit row `:481`; "Edge cases": "A short row at a location that becomes a showroom stays there; it holds nothing (R15)".
- `docs/data-model.md:65`: "branch fixed after creation; one default warehouse and unique (folded) names kept by the API's rule under the stock lock, not by an index".
- `docs/FEATURES.md:31` (M1): the tests column becomes `` `warehouses.spec.ts`, `location-rules.test.ts`, `migrations.test.ts` `` (`location-rules.test.ts` is in `packages/shared/test`, one of the two folders `features.test.ts:52-53` looks in; **never name an `e2e-api` spec there**); the Notes add "In api mode the page lists and saves on the API (ADR 0059, part 4a; api-mode e2e `tests/e2e-api/settings-locations.spec.ts`); `GET /locations` stays answered while the switch is off, POST/PUT answer 404".
- `docs/blueprint-delta.md`: one 2026-11-17 row (`inventory.locations`): routes; branch fixed; no removal; GET not switched; unique (folded) names; the holds; conversion re-checks the warehouse.

---

## 11. For STATUS and BRANCHES (the orchestrator applies these; re-read STATUS first and anchor on the quoted text)

1. Queue item 2 (`:141`): after 3b, "part 4a, Warehouses and showrooms, in draft PR #<n> (`feat/settings-locations-api`, stacked on #55); then 4b Shared costs, 5 HR, 6 Branding".
2. A new entry for part 4a in the same style as parts 2a/2b (what moved, D-highlights incl. D21 and D22, checks, suites, mutations, review), written at handoff.
3. `:178` "The branch limit is stored, not enforced, until Settings → Locations moves to the API." → "... until a branch editor exists (Warehouses and showrooms moved in part 4a; locations aren't branches). `apps/api/src/core/access/plan-limits.ts`'s comment still names Settings → Locations (core, left as is)."
4. `:188` `newBranch` note: "When Settings → Locations moves" → "When a branch editor or branch removal exists". Part 4a removes nothing.
5. `:211` unmoved pages: drop "Warehouses and showrooms".
6. `:212` "The Expenses page is mixed in api mode": add "its location list is the API's since part 4a, so a saved fixed split keys the API's ids in the browser until 4b".
7. `:463` "Decide whether `GET /locations` honours the `inventory.locations` switch": **closed** (part 4a D3: it doesn't; POST/PUT 404 while off; FEATURES.md says so).
8. `:470` (branch-scoped admin): add "Locations: every save needs data scope `all` (part 4a)".
9. `:481` (`knownBranch`): add "`POST /locations` refuses an unknown branch with words (part 4a D5), the precedent for Q-B4-2".
10. `:574` order of later parts: "4 Locations and shared costs (split into 4a and 4b)".
11. New follow-ups: R3 (the dashboard's quotes in api mode no longer match its warehouse filter; `list("quotes")` isn't served); R5 (saved demo data with an empty floor area breaks the demo Business report until re-saved or 4b's reader fix); R15 (short rows stay at a location that became a showroom); R16 (quote saves don't take the stock lock; conversion re-checks); Q1 (no removal), Q2 (branch fixed; a location added in the wrong branch can only be renamed, R17), Q3 (no indexes), Q6 (a company with no branch can't add a location).
12. **Sweep (D23):** the whole-company scope check has copies in `finance/company-wide.ts` (`requireCompanyWide`), `reports/report-access.ts` (`requireWholeCompany`), `hr/commission-records.ts:55`, `hr/pay-records.ts:74`; one helper with a message parameter would replace them (it belongs in `apps/api/src/core/access`, so it is its own task). The purchasing and invoices controllers' `MONEY` copies of `MONEY_TEXT` are the same kind of sweep (already listed by part 1).
13. **E2e heal (N8):** `tests/e2e-api/global-setup.ts` heals crashed-run leftovers; healing a renamed Southgate Showroom there would need a `@workspace/db/testing` helper (packages/db). Until then LNE1 heals it by street at its start.
14. **BRANCHES:** `feat/settings-locations-api` | draft PR #<n> | stacked on `feat/settings-localization-section` (#55) | Settings part 4a.

---

## 12. Build stages

Every heavy command runs alone: `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <command> > <scratchpad>/settings4/logs/<name>.log 2>&1; echo "exit $?"`.

**Working rules** (as parts 1 to 3b kept them):
- No plan mode; the short plan goes in the session log. For anything open, take the safest option and record it.
- Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) one at a time through `heavy.sh`. Api-mode Playwright runs against the throwaway PostgreSQL on 5433; never re-create, reseed or stop it, never `docker compose up` or `stop`.
- Never read, print, create or source an env file or a `*env.sh`.
- Working commits carry `[skip ci]` and are pushed by naming the branch (`git push -q origin feat/settings-locations-api`). Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `gh pr merge`, or `rm -rf`.
- Add files by name; before each commit `git status --porcelain` shows no scratchpad or `zz-*` file. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; long texts via `-F` / `--body-file`.
- Never touch `/Users/sarah/dev/flooring-platform-check`.
- **Stop and report** (don't build) if an ask-before item comes up (a new dependency, altering or adding a table or index, a removal design, touching auth, tenancy, providers or `apps/api/src/core`, a control-database write), or if 4a would grow past 16 product files (16 is the planned count: section 2 says what gives way first).

### Stage 0: preconditions, branch, scripts, spec and session log (docs only)
1. **3b handed off and the checkout free:** the orchestrator says 3b's session has ended; `cd /Users/sarah/dev/flooring-platform && git status --short` is empty; `git rev-parse --abbrev-ref HEAD` is not a branch another agent uses.
   - `cd /Users/sarah/dev/flooring-platform && git fetch -q origin && git log --oneline origin/feat/settings-tax-api..origin/feat/settings-localization-section` ends in 3b's handoff commit. **If not, stop and report.**
   - `cd /Users/sarah/dev/flooring-platform && git merge-base --is-ancestor origin/feat/settings-tax-api origin/feat/settings-localization-section && echo 3b-holds-3a`; `gh pr list --head feat/settings-localization-section --json number,isDraft` (#55 expected; record it).
2. **Re-check the claims of section 1 on `L`** (record each difference in the log and follow the code):
   - `cd /Users/sarah/dev/flooring-platform && L=origin/feat/settings-localization-section && git diff --stat origin/feat/settings-region-currency-api "$L" -- apps/api/src/modules/inventory apps/api/src/modules/settings/settings-input.ts apps/api/src/modules/settings/settings.controller.ts apps/api/src/modules/sales/invoices.service.ts apps/web/src/features/settings/locations apps/web/src/lib/api packages/shared/src/settings packages/shared/src/decimal-text.ts packages/shared/src/index.ts packages/shared/src/import docs/product-spec/sales.md` (expected: 3a's and 3b's files of the Refs list only; `invoices.service.ts`, the inventory module, the locations feature and `packages/shared/src/import` unchanged).
   - `cd /Users/sarah/dev/flooring-platform && L=origin/feat/settings-localization-section && git grep -n -E 'saveLocation|SERVED_LISTS|assertSettingsSave|companyProfileProblem|PROFILE_INPUT|loadLocations|"locations"' "$L" -- apps packages ':!**/fixtures/**'` (expected as section 1).
   - `git show "${L}:apps/web/src/lib/api/demo/store.ts" | grep -n -A31 'async saveLocation'`; `git show "${L}:packages/shared/src/settings/section-rules.ts" | grep -n -B2 -A16 'export function companyProfileProblem'`; `git show "${L}:packages/shared/src/decimal-text.ts" | grep -n 'TAX_RATE_TEXT_MAX\|PLAIN_DECIMAL'` (3a's constants sit mid-file, before `PLAIN_DECIMAL`; `QUANTITY_TEXT` goes right after `TAX_RATE_TEXT_MAX`).
   - The pieces the critique's fixes touch: `git show "${L}:apps/api/src/modules/settings/settings.controller.ts" | grep -n -A3 'function requireWholeCompany\|function check'` (module-private, `T:58-65`); `git show "${L}:apps/api/src/modules/inventory/inventory.controller.ts" | grep -n 'const QUANTITY\|function requireFeature'` (`:15`, `:41`); `git show "${L}:apps/api/src/modules/sales/invoices.service.ts" | grep -n -B3 -A3 'await lockStock(tx);'` (the one in `convert`, `:184`, before `this.books.post`); `git show "${L}:packages/shared/src/import/fields.ts" | grep -n -A5 'export const fold'`; `git show "${L}:packages/shared/src/index.ts" | grep -n 'settings/'` (`tax-settings` last); `git show "${L}:apps/web/tests/e2e-api/company.spec.ts" | grep -n -A2 'Settings → Locations'`; `git show "${L}:docs/product-spec/sales.md" | grep -n '^19\. \*\*Conversion'`.
   - Names still free: `git grep -n -w -E 'LOCATION_RULE|LOCATION_MESSAGES|locationProblem|locationHolds|streetAddressProblem|QUANTITY_TEXT|ADDRESS_MAX|ADDRESS_INPUT|LocationsService|LNR[0-9]+|LNA[0-9]+|LNM[0-9]+' "$L" -- apps packages` prints nothing.
3. **Branch:** `cd /Users/sarah/dev/flooring-platform && git switch -q --no-track -c feat/settings-locations-api origin/feat/settings-localization-section`.
4. **Scripts** (scratchpad only):
   - `sed 's#settings2b#settings4#g' <scratchpad>/settings2b/checks.sh > <scratchpad>/settings4/checks.sh && chmod +x <scratchpad>/settings4/checks.sh`
   - `e2e-demo.sh` (paths, header, the red line and the subset):
     ```
     python3 - <<'PY'
     import pathlib
     sp = pathlib.Path("<scratchpad>")
     s = (sp / "settings2b/e2e-demo.sh").read_text()
     s = s.replace("settings2b", "settings4").replace("Settings part 2b", "Settings part 4a")
     old_red = 'red) run flooring tests/e2e/settings.spec.ts -g "${2:-S[456] }" ;;'
     assert s.count(old_red) == 1
     s = s.replace(old_red, 'red) run flooring tests/e2e/warehouses.spec.ts -g "${2:-LNS[12] }" ;;')
     start, end = s.index("  subset)\n"), s.index("  all)\n")
     subset = (
         "  subset)\n"
         "    run flooring tests/e2e/warehouses.spec.ts tests/e2e/expenses.spec.ts tests/e2e/settings.spec.ts \\\n"
         "      tests/e2e/inventory.spec.ts tests/e2e/stock.spec.ts tests/e2e/quote-warehouse.spec.ts tests/e2e/quote.spec.ts \\\n"
         "      tests/e2e/purchasing.spec.ts tests/e2e/reports.spec.ts tests/e2e/dashboard.spec.ts tests/e2e/audit.spec.ts \\\n"
         "      tests/e2e/flows-batch3.spec.ts tests/e2e/states.spec.ts tests/e2e/tables.spec.ts tests/e2e/shell.spec.ts \\\n"
         "      tests/e2e/a11y.spec.ts tests/e2e/responsive.spec.ts tests/e2e/login.spec.ts\n"
         "    run hr tests/e2e/settings.spec.ts tests/e2e/hr.spec.ts tests/e2e/shell.spec.ts\n"
         "    ;;\n"
     )
     s = s[:start] + subset + s[end:]
     out = sp / "settings4/e2e-demo.sh"
     out.write_text(s)
     out.chmod(0o755)
     PY
     ```
   - `grep -n 'settings4/logs\|LNS\[12\]' <scratchpad>/settings4/full.sh <scratchpad>/settings4/checks.sh <scratchpad>/settings4/e2e-demo.sh` finds the log folder in all three and the red pattern in the last.
5. **Pre-flight:** `docker ps --format '{{.Names}} {{.Ports}}'` shows 5432 and 5433 (else stop and report); `lsof -ti tcp:3000 -sTCP:LISTEN; lsof -ti tcp:4000 -sTCP:LISTEN` print nothing.
6. **Write** the session log (10.1's first parts, the split said plainly, stage 0's differences, D24's process note) and the spec edits of 10.4 (settings-and-permissions.md and sales.md rule 19) and the inventory.md edits of 10.5, stated as decided.
7. **Commit 0.** `SP4/commit-0.txt`: `docs(settings): plan for Settings part 4a, warehouses and showrooms on the API [skip ci]` + a body (what moves, the split, the decision table in short, stacked on #55) + Co-Authored-By. `cd /Users/sarah/dev/flooring-platform && git add docs/sessions/2026-11-17-HHMM-b-settings-locations-api.md docs/product-spec/settings-and-permissions.md docs/product-spec/inventory.md docs/product-spec/sales.md && git commit -q -F <scratchpad>/settings4/commit-0.txt && git push -q -u origin feat/settings-locations-api`.
8. **Draft PR.** `SP4/pr-body.md`: section 0, "Part 4 is split: this is 4a (16 product files, one of them the conversion check of D21); 4b moves Shared costs", "stacked on #55, #54, #53, #52, #51, #50, #49, #48, #47, #46 and #45: merge after them", section 13, section 15, and `🤖 Generated with [Claude Code](https://claude.com/claude-code)` last. `cd /Users/sarah/dev/flooring-platform && gh pr create --draft --base main --head feat/settings-locations-api --title "feat(settings): warehouses and showrooms on the API (Settings part 4a)" --body-file <scratchpad>/settings4/pr-body.md`. Record the number.

### Stage 1: red first (one commit: the tests)
1. Write every test of 7.1 to 7.7 and the 7.8 edits, with no product code.
2. **Shared** (red: `location-rules.test.ts` fails to load; the others pass): `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh pnpm --filter @workspace/shared exec vitest run test/location-rules.test.ts test/settings-sections.test.ts test/access-rules.test.ts > <scratchpad>/settings4/logs/s1-shared-red.log 2>&1; echo "exit $?"`.
3. **API** (red: every LNA case but LNA3 and LNA15, which pass on both heads by design (no route answers 404; the GET is unchanged); POST/PUT answer Nest's 404 on `L`; **LNA18** is red because the conversion answers 201 where 400 is expected, its warehouses being inserted directly): `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh pnpm --filter api exec vitest run --project integration test/settings-locations.int.test.ts > <scratchpad>/settings4/logs/s1-int-red.log 2>&1; echo "exit $?"` (`api:typecheck` may be red: LNA imports `LOCATION_RULE`; Vitest still runs if the import resolves to undefined; if the file fails to load, record "every case red at load").
4. **Web** (red: LNW1, LNW2 and the api-rereads case fall to the demo stub and throw; LND and LNP fail to import or on new words): `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh pnpm --filter web exec vitest run tests/unit/locations-api.test.ts tests/unit/demo-locations.test.ts tests/unit/location-form.test.tsx tests/unit/api-rereads.test.ts > <scratchpad>/settings4/logs/s1-web-red.log 2>&1; echo "exit $?"`.
5. Check each failure against its expected reason (`sed 's/\x1b\[[0-9;]*m//g' <log> | grep -E 'FAIL|✓|×|Tests '`) and record it. A test red for a test reason is fixed in the test and run again before the commit; a test meant red that passes is strengthened until it fails for the right reason.
6. **Commit 1** (the tests, red): `SP4/commit-1.txt` `test(settings): part 4a tests, red on part 3b's head [skip ci]`; `git add` each test file by name; commit and push (`git push -q origin feat/settings-locations-api`). From here, setting files aside is undone with `git checkout --`.
7. **E2e on 3b's product code.** `next build` type-checks `tests/**`: set aside what doesn't compile on `L`: `mkdir -p <scratchpad>/settings4/red-keep`; `mv` `apps/web/tests/unit/demo-locations.test.ts` and `apps/web/tests/unit/location-form.test.tsx` there; restore `L`'s `api-rereads.test.ts` (`git show "${L}:apps/web/tests/unit/api-rereads.test.ts" > apps/web/tests/unit/api-rereads.test.ts`) if the build names it. The LNE spec uses local types and compiles.
   - **Api mode:** `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <scratchpad>/flows/api-e2e.sh settings4-red --build -- tests/e2e-api/settings-locations.spec.ts tests/e2e-api/company.spec.ts; echo "exit $?"`. Expected: LNE1 fails at its heal (the PUT answers 404); LNE2 at Priya's PUT (404, not 403); `company.spec.ts`'s new exact Branch check **passes** on `L` by design (there DemoStore's locations and branches agree), which shows the check itself is sound; record it. `grep -E "✘|passed|failed|skipped" <scratchpad>/flows/logs/settings4-red.log`.
   - **Demo:** `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh bash <scratchpad>/settings4/e2e-demo.sh red > <scratchpad>/settings4/logs/s1-demo-red.log 2>&1; echo "exit $?"`. Expected: LNS1 at the Business report (if it passes, record it), LNS2 at "Branch" being enabled.
   - A red-run failure for a test reason is fixed in the test, committed as its own `[skip ci]` commit, and run red again.
   - Put everything back: `cd /Users/sarah/dev/flooring-platform && git checkout -- apps/web/tests/unit && git status --short` (empty; the moved files come back from the commit).
8. Record the e2e failures in the session log (committed with stage 2's log commit).

### Stage 2: the change, green, then mutations on the committed change
1. **Shared, API, web** as section 4 (16 files).
2. Checks:
   - `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <scratchpad>/settings4/checks.sh s2 @workspace/shared:test @workspace/shared:typecheck @workspace/shared:lint api:typecheck api:lint api:test web:test web:typecheck web:lint` (the shared suite includes `access-rules.test.ts`, `decimal-text.test.ts`, `expenses.test.ts`).
   - `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh pnpm --filter api exec vitest run --project integration test/settings-locations.int.test.ts test/inventory.int.test.ts test/stock-issue.int.test.ts test/purchasing.int.test.ts test/sales.int.test.ts test/invoices.int.test.ts test/expenses.int.test.ts test/reports.int.test.ts test/imports.int.test.ts test/company.int.test.ts test/settings.int.test.ts test/permissions.int.test.ts test/isolation.int.test.ts > <scratchpad>/settings4/logs/s2-int.log 2>&1; echo "exit $?"`.
   - `cd /Users/sarah/dev/flooring-platform && pnpm exec prettier --check <the 16 product files and the 9 test files>` (`--write` first if needed; run it twice, 2a's B9).
3. **Commit 2 locally (do not push yet):** `SP4/commit-2.txt` `feat(settings): warehouses and showrooms on the API (Settings part 4a) [skip ci]`; add the 16 product files by name.
4. **Mutations LNM1 to LNM35** (section 8) on the committed change: write `SP4/mutate.py` from `SP2B/mutate.py`; `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh python3 <scratchpad>/settings4/mutate.py --check LNM1 LNM2 LNM3 LNM4 LNM5 LNM6 LNM7 LNM8 LNM9 LNM10 LNM11 LNM12 LNM13 LNM14 LNM15 LNM16 LNM17 LNM18 LNM19 LNM20 LNM21 LNM22 LNM23 LNM24 LNM25 LNM26 LNM27 LNM28 LNM29 LNM30 LNM31 LNM32 LNM33 LNM34 LNM35`, then the same without `--check` `> <scratchpad>/settings4/logs/s2-mutations.log 2>&1; echo "exit $?"`; every line `restored=True caught=True`; then `git status --porcelain` is empty. A mutation not caught: strengthen its test (it must fail on the mutation and pass on the code), commit the test, run that mutation again.
5. **Session log:** stages 0 to 2 (red with reasons, green, every mutation line, build decisions); commit `docs(sessions): Settings part 4a, stages 0 to 2 [skip ci]`; push both: `git push -q origin feat/settings-locations-api`.

### Stage 3: api-mode and demo e2e (one commit)
1. **Green:** `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <scratchpad>/flows/api-e2e.sh settings4-green --build -- tests/e2e-api/settings-locations.spec.ts tests/e2e-api/company.spec.ts tests/e2e-api/inventory.spec.ts tests/e2e-api/purchasing.spec.ts tests/e2e-api/sales.spec.ts tests/e2e-api/invoices.spec.ts tests/e2e-api/expenses.spec.ts tests/e2e-api/reports.spec.ts tests/e2e-api/settings.spec.ts tests/e2e-api/login.spec.ts; echo "exit $?"`. All pass; afterwards `GET /locations` as Dana shows "Southgate Showroom" with 96 samples and floor area "2400.000", Colorado Springs still a warehouse, Denver Central the only default, and no "E2E Annex".
2. **Again** on the dirty database, no rebuild: `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <scratchpad>/flows/api-e2e.sh settings4-again -- tests/e2e-api/settings-locations.spec.ts tests/e2e-api/reports.spec.ts; echo "exit $?"`.
3. **The flows** (every one picks warehouses and showrooms; `f1-sales-quote-to-cut` converts a quote through D21's check): `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <scratchpad>/flows/api-e2e.sh settings4-flows -- tests/e2e-api/flows; echo "exit $?"`.
4. **Demo subset, last** (the builds share `apps/web/.next`): `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh bash <scratchpad>/settings4/e2e-demo.sh subset > <scratchpad>/settings4/logs/s3-demo.log 2>&1; echo "exit $?"`. A failure that also fails on `L` is recorded with its line, not fixed here.
5. Fix anything red with a test that failed first. **Commit 3:** `SP4/commit-3.txt` `test(e2e): Settings part 4a round-trips a location through the API [skip ci]` (the e2e files and the log); push.

### Stage 4: docs (one commit)
- Write 10.2 to 10.5 (the spec's 10.4 edits were made in stage 0; check them against the code), the session log's build decisions and table 7.9.
- `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh pnpm --filter @workspace/shared exec vitest run test/features.test.ts > <scratchpad>/settings4/logs/s4-features.log 2>&1; echo "exit $?"`.
- Markdown is in `.prettierignore` (2a's B15): check the docs by reading them against the code.
- **Commit 4:** `SP4/commit-4.txt` `docs: Settings part 4a on the API (ADR 0059 section, api-contract, specs, data model, delta, FEATURES) [skip ci]`; push.

### Stage 5: full checks, both suites, review, handoff (one commit)
1. **Full checks:** `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh bash <scratchpad>/settings4/full.sh > <scratchpad>/settings4/logs/full.log 2>&1; echo "exit $?"` (lint, typecheck, test, test:api, test:hooks).
2. **The whole demo suite:** `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh bash <scratchpad>/settings4/e2e-demo.sh all > <scratchpad>/settings4/logs/s5-demo-all.log 2>&1; echo "exit $?"`. Totals and time; a failure that also fails on `L` is noted, not fixed.
3. **The whole api-mode suite** on a fresh build after the demo build: `cd /Users/sarah/dev/flooring-platform && <scratchpad>/heavy.sh <scratchpad>/flows/api-e2e.sh settings4-all-final --build; echo "exit $?"`. Every test passes; totals and time.
4. **`/review`.**
5. **A fresh read-only security-reviewer** on `origin/feat/settings-localization-section...HEAD`, focused on section 13. No `packages/db` change, so no schema-reviewer. A blocking finding is fixed with a test that failed first; the rest are recorded. Its summary goes to `SP4/review-body.md` for the orchestrator.
6. **Handoff:** the session log's outcome, commands table, "For STATUS" and "BRANCHES" final (STATUS and BRANCHES untouched unless the orchestrator says otherwise). **Commit 5:** `SP4/commit-5.txt` `docs(sessions): Settings part 4a outcome, full checks, both suites and reviews` (no `[skip ci]`); push.
7. **Ready and merge are the orchestrator's,** in queue order, after #45 to #55 have merged and `origin/main` is merged in: ready, `verify` and `e2e` green on the head (`fast` too if it ran), the reviewer's summary posted with `gh pr review <n> --comment --body-file <scratchpad>/settings4/review-body.md`, then `gh pr merge <n> --squash --delete-branch` on its own.

---

## 13. Security-review focus

1. **Tenancy of ids.** `PUT /locations/:id` reads only the session tenant's database (`TenantConnectionService`); another company's id is 404 (LNA2, LNA14). A sent `branchId` must be one of this company's live branches, checked by membership in JS (never cast in SQL): a demo id or another company's branch is refused with words, never stored (LNA2, LNA7). The server makes every id; a body id is refused (LNA6). No path, query or header names a company.
2. **Deny by default.** Module `core` (class), the key from shared `LOCATION_RULE`, the switch (404), scope `all` (403, the settings controller's exported `requireWholeCompany`), the ceiling (LNA0, LNA1, LNA3 to LNA5b); every default role of both products; HR Suite. The cross-module import (inventory → settings controller) adds no route and no guard change.
3. **Data scope.** A location's branch drives expense scope live and quotes' branch on save: the branch is fixed (D5; LNA11, LND2, LNP2, LNE2) and the update never writes `branch_id`; only company-wide people save (LNA5).
4. **Stock integrity.** Warehouse → showroom refused while stock, a transfer in transit (from or to), a hold with stock (short rows excepted, D22) or an open quote (header or line) remains (LNA12); receiving a transfer doesn't check the kind, so that refusal is load-bearing; everything under the stock lock (LNA13a). **The conversion (D21, `invoices.service.ts`) now re-checks the quote's warehouses under the same lock**, so a quote saved while its warehouse became a showroom can't hold stock there (LNA18). Check that the refusal sits after `lockStock` and before anything is posted, and that a refused conversion leaves no invoice, reservation or journal entry.
5. **Invariants without an index:** one default and unique (folded) names under the lock (LNA10, LNA13b, LNA7).
6. **Audit.** Every saved row, the old default too; refusals write nothing (LNA8 to LNA10, LNA12, LNA13b).
7. **What members learn.** `GET /locations` unchanged (every member, addresses included); no sensitive names (the scan stays green).
8. **Web.** ApiClient only; the id never in the body (LNW2); the page's branches from the shell.
9. **Demo parity** of order and words; the generic `save("locations")` closed (LND1, LND6).

---

## 14. Risks

- **R1 Merge order.** Stacked on 3b (#55) and through it on #54 to #45; `section-rules.ts`, `decimal-text.ts`, `index.ts`, `settings-input.ts`, `settings.controller.ts`, `store.ts`, `contract.ts`, `api-methods.ts`, ADR 0059, api-contract and the specs (incl. `sales.md`, which 3b also edits) need main merged in after each lands. `invoices.service.ts` is touched by no earlier part of the stack. 4b stacks on 4a.
- **R2 Shared e2e database.** LNE1 renames Southgate and puts it back; a killed run leaves "Southgate Showroom E2E" until LNE1 runs again (it heals by street), and `reports.spec.ts:75` (Southgate by name) fails meanwhile.
- **R3 The dashboard's warehouse filter in api mode:** its locations are now the API's, so API invoices match (they didn't before) while its quotes, still DemoStore's (`list("quotes")` isn't served), no longer do: with a warehouse picked, pending quotes read 0. Recorded; the dashboard's quotes move with their own task.
- **R4 The Expenses page in api mode** lists the API's locations while Shared costs still saves in the browser: a fixed split keyed by API ids lives in DemoStore until 4b.
- **R5 Saved demo data** with an empty floor area still breaks the demo's Business report until that location is saved again (4a normalizes new saves; 4b's `weightsFor` reads blank as 0).
- **R6 Last save wins** on a location; both saves audited.
- **R7 Version skew.** A 4a web against an older API: lists work (`GET /locations` exists), saves answer 404 in the dialog (fails closed). An older web against a 4a API keeps saving in the browser. Deploy the API first.
- **R8 Cost of the holds check:** six narrow reads by location id, only on warehouse → showroom. The conversion's check adds one `loadLocations` read under a lock it already holds.
- **R9 The lock:** location saves wait behind stock writers and vice versa; saves are rare and short.
- **R10 Rows written outside the API** (seed, imports) aren't re-validated: two defaults or duplicate names from elsewhere stay until a save touches them; the next save of a default resolves it.
- **R11 A person's default warehouse** pointing at a location that became a showroom falls back to the company default (`defaultWarehouse`); the profile keeps the id.
- **R12 GET /locations while the switch is off** stays answered (D3).
- **R13 Floor area at scale** in api mode (`"2400.000"` in the dialog).
- **R14 A company with no branch** (any provisioned company) can't add a location until a branch editor or provisioning makes one (Q6).
- **R15 Short rows stay at a location that became a showroom** (D22): they hold nothing and nothing fills them; the invoice's stock panel shows "Short by …" against the showroom until the invoice is voided. No stock moves.
- **R16 Quote saves don't take the stock lock:** a quote saved at the moment its warehouse becomes a showroom can stay open there. Its conversion is refused (D21) until its warehouse is changed; nothing is reserved at the showroom.
- **R17 A location added in the wrong branch is permanent** (D4, D5): it can be renamed but not moved or removed, and it stays in every picker. Q1 and Q2 ask the owner.
- **R18 Names written outside the API** (the seed, a future API import) aren't folded-checked: two folded-equal names from elsewhere stay until a save touches one of them (as R10).

---

## 15. Owner questions (none blocks; each with its safest default taken)

- **Q1 Retiring a location.** Taken: not offered. Recommended when wanted: an `active` flag (a schema change) or a soft delete, refused while it holds stock, a transfer, a hold, an open quote or purchase order, or is the company default or someone's default or home location; history keeps its name. Build it?
- **Q2 Moving a location to another branch.** Taken: refused (history would move between branches' views). With no removal either (Q1), a location added in the wrong branch can only be renamed and stays in every picker (R17). The cheap middle option: allow a branch change while nothing references the location, checked under the stock lock against all 22 referencing columns (stock, transfers, reservations, quotes and invoices with their lines, POs and receipts, expenses and recurring expenses, contracts, employees' home location, people's default warehouse, stock adjustments, journal lines). Allow that, always, or never?
- **Q3 One default and unique names in the database** (partial unique indexes on `is_default` and `lower(name)` where `deleted_at is null`). Taken: the rule under the stock lock. Add the indexes (a schema change)?
- **Q4 Showroom conversion and open purchase orders or contracts.** Taken: they don't block (a receipt picks its own warehouse; contracts hold no stock). Block them too?
- **Q5 Step-up for location saves.** Taken: none (not an MFA key). Add one?
- **Q6 A company with no branch** can't add a location. Create a first branch at provisioning, or build the branch editor (with the branch limit enforced then)?
- **Q7 Name uniqueness** is company-wide and folded as the stock import folds names (D9). Per branch instead (the import would then need the branch too)?
- **Q8 Who reads locations.** Taken: every member, addresses included, as before. Narrow it?
- **Q9 The dashboard's quotes in api mode** (R3). Move `list("quotes")` with the dashboard task?

---

## 16. Stop-and-ask items

None is needed to build 4a. Two designs would need a schema change and are **left out, recorded and asked**: retiring a location (Q1) and database-enforced default and names (Q3). The conversion check (D21) touches `invoices.service.ts` (sales module), not core, auth, tenancy or providers, so it is not an ask-before item; it is in the security review. The builder stops and reports if any other ask-before item appears (section 12's working rules) or 4a grows past 16 product files.

---

## 17. Part 4b outline: Shared costs (not built here; planned in full after 4a's handoff)

**Branch** `feat/settings-shared-costs-api`, stacked on 4a; session log `docs/sessions/2026-11-17-HHMM-b-settings-shared-costs-api.md` (or the day it starts). Closes "The Expenses page is mixed in api mode".

- **Shared:** `API_SETTINGS_SECTIONS` gains `sharedCosts`; `SETTINGS_READERS.sharedCosts = { readers: ["settings.expenses.manage"], hiddenWhenOff: true }` (only Settings → Expenses reads it); `sharedCostsProblem(value, locations)`: each percent `PERCENT_TEXT` (≤ 100, checked before any `dec`), keys only live locations, and, for `fixed`, exactly 100 over the live locations; `fixedPctProblem` never throws on malformed text; `weightsFor` reads a blank floor area as 0 (closes R5); the dispatcher's `sharedCosts` branch needs the live locations (a context parameter, or the API and DemoStore call the rule directly; decide then).
- **API:** `PUT /settings/sharedCosts` (module `core`, `settings.expenses.manage`, switch `finance.expenses`, scope `all`, strict body), the rule judged inside the save's transaction against `loadLocations(tx)` (a `settle` variant of part 1's `save`, as 2b's), audit "Changed shared costs"; `GET /settings` answers it (the exhaustive dispatch gains a case; never-saved = `DEFAULT_SHARED_COSTS`, what `loadSharedCosts` acts on). No step-up (Q1 of part 1).
- **Web:** `settings-answer.ts` gains the case; the Expenses page passes `problem` instead of `canSave`, its percent inputs stop at `PERCENT_TEXT_MAX`; `updateSettings("sharedCosts")` routes by `isApiSettingsSection` with no other change; part 1's e2e "Shared costs stays in the browser" (`tests/e2e-api/settings.spec.ts:316-322`) is rewritten.
- **About 9 product files:** `sections.ts`, `section-rules.ts` or `cost-sharing.ts`, `settings.controller.ts`, `settings.service.ts`, `settings-input.ts`, `settings-answer.ts`, `expenses-settings-page.tsx`, `store.ts`, maybe `api-methods.ts` (comment).
- **Open for 4b:** whether a non-fixed rule keeps or clears `fixedPct`; what a location added after a fixed split gets (today 0, and the report normalizes); whether shared costs need the stock lock (no: they read locations only).
- **Security review:** yes (money split in the Business report; no ledger effect).
- **Notes from 4a's critique, for 4b's full plan:**
  - (a) Validate each percent with `PERCENT_TEXT` before any `dec`: `fixedPctProblem` throws today on `""` or `"1.2.3"`.
  - (b) DemoStore must run the same `sharedCostsProblem`; today only the page does (`expenses-settings-page.tsx:66`, `:134`).
  - (c) `weightsFor` reading a blank floor area as 0 also fixes R5's saved overlays.
  - (d) A location added after a fixed split gets 0 and the report normalizes. Since 4a removes nothing, "keys only live locations" is a simple membership check.
  - (e) Rewrite part 1's e2e pin `tests/e2e-api/settings.spec.ts:316-322` ("Shared costs stays in the browser").
  - (f) 4a's `QUANTITY_TEXT` and `requireWholeCompany` export are there to reuse; the settings controller already holds `requireWholeCompany` for the `sharedCosts` PUT.
