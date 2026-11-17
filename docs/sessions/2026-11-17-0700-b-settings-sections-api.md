# Session 2026-11-17 07:00, B (Claude): Settings part 1 on the API: company profile, number format, payments and expense approval (queue item 2, task 2)

Person: B (Claude), on B's Mac. Branch `feat/settings-sections-api`, base `6dbd03c` (the head of GET /company's branch `feat/web-company-from-api`, with its handoff; draft PR #50). Main is `d0e4e20`. This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

**Stacked on PR #50.** GET /company (#50) is stacked on B6 (#49), B5 (#48), B4 (#47), B1 (#46) and B3 (#45). None can merge yet: GitHub Actions is blocked by a billing problem on the account. The orchestrator cut this branch from GET /company's final head, so that STATUS and BRANCHES stay linear and the shared edits (`api-methods.ts`, `contract.ts`, `store.ts`, `api-rereads.test.ts`, `packages/shared/src/index.ts`, `company.spec.ts`, `checks.ts`, api-contract.md, the spec, FEATURES.md) can't conflict later (D22). The PR must merge after #45, #46, #47, #48, #49 and #50; when they merge, the orchestrator merges `origin/main` into this branch.

## Prompt

### The owner's queue (verbatim)
> Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
> 2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
> 3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
> 4. Then stop and hand off. Don't start P13; the owner does a click-through first.

This session is item 2, task 2, "then Settings", part 1 of 6: Company profile, Number format, Payments and Expense approval move to the API. `GET /settings` is cut per person; `PUT /settings/<section>` saves one section with its key, module, switch, company-wide scope, a strict body, the shared rules, a row lock and an audit entry, and Payments needs a step-up. The shell re-reads `GET /settings` with `GET /company`. A refused settings save shows a toast and keeps the draft. Today in api mode these pages say "saved" while the server keeps its old values, including the two-person payment check, the write-off limit and expense approval. Security review required (money and fraud controls, permissions, tenancy).

### Per-task rules (owner)
- Read the blueprint prompt first: P11 in docs/real-build-plan.md ("Each module follows prompt P11"), the product spec (docs/product-spec/settings-and-permissions.md) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why". Add a docs/blueprint-delta.md row only if the plan of record changes.
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- CLAUDE.md rules apply: rule 1 (screens only through the ApiClient), rule 2 (the company from the verified session), rules 3 and 4 (deny by default, permissions only from packages/shared), rule 5, rule 6 (decimal strings), rule 12 (no hard-coded locale or currency), rule 13 (the `auth.step-up` register row), JSDoc on exports, no dead code, no duplicated logic.
- If a stop-and-ask item comes up (a control-database write, Zod in packages/shared, seeding at provisioning), stop and report it instead of building it.
- ADR numbers: 0058 is reserved by the paused check branch, so this work writes ADR 0059.
- STATUS and BRANCHES are left to the orchestrator's handoff; what they need is under "For STATUS" below.
- **This laptop (8 GB):**
  - Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `gh pr merge`.

### The problem as recorded
- In api mode `getSettings()` and `updateSettings()` are not in `API_METHODS`, so every Settings value the screens read is DemoStore's, and every Settings save but Users, Security roles, Support access, time-off policies and Data import goes to the browser only.
- The API has a `settings` table with every group seeded, and its modules act on those rows, but no route reads or writes a settings section apart from ADR 0040's `GET/PUT /settings/accounting`, which has no screen.
- So when an Accountant turns on the two-person check, changes the write-off limit or edits the number format in api mode, the screen says "Payments saved" while the server keeps applying its old values, for customer and supplier payments alike.
- docs/STATUS.md (GET /company's head): "The shell's branding and number format are still DemoStore's"; "Settings default inputs keep a bare point as typed (`12.`)"; "When `PUT /settings/:section` moves to the API, it must refuse `overtimeRuleProblem`"; B6's tax-rate note; "Settings at provisioning"; GET /company 2.7, the company's zone in two places.

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (spec, failing tests, endpoints with guards and audit, the screen, the security review, the PR, the handoff), module order row 4 (Settings), and the CI budget.
  - `.claude/commands/feature.md` steps 1 to 9, and `.claude/commands/feature-change.md` step 6 ("change a feature") for `auth.step-up`.
  - docs/product-spec/settings-and-permissions.md: "Who uses it", "Settings pages", "Workflows" (Save settings), rules 5, 7, 22, 23, 26, 27, 28 and 30, "CompanySettings", "Events and audit entries", "Edge cases and known limits" and "Real build".
  - docs/product-spec/sales.md rules 28, 31 and 34 (payments: approval, numbering, write-off; the file has no appendix, corrected in review round 2) and docs/product-spec/purchasing.md (supplier payments use the same rule).
  - docs/api-contract.md: Conventions, Permissions, `/settings/accounting`, Sales part 2, Purchasing, Expenses, "Company and settings", GET /company.
  - ADRs 0009, 0031, 0034, 0040, 0050, 0051, 0054 and 0057; docs/data-model.md "Settings groups"; docs/FEATURES.md rows `auth.step-up`, `sales.payments`, `finance.expenses`, `settings.company` and `settings.number-format`.
  - GET /company's session log (docs/sessions/2026-11-17-0525-b-company-from-api.md), "Decisions taken during the build" B1 to B12.
- **The code at `6dbd03c`:**
  - **Shared:** `types/settings.ts`, `numbers.ts`, `decimal-text.ts`, `permissions/engine.ts`, `permissions/access-rules.ts` (`SENSITIVE_FIELDS`), `features.ts`, `products.ts`, `us-pack/states.ts`, `us-pack/overtime.ts`, `index.ts`.
  - **API:** `core/access/permission.decorators.ts`, `permission.guard.ts`, `request-actor.ts`, `audit.ts`, `core/auth/step-up.service.ts`; `modules/finance/accounting.controller.ts`, `accounting.service.ts`, `company-wide.ts`, `expense-records.ts`; `modules/sales/invoice-records.ts` (`loadPaymentSettings`, `loadMoneyFormat`), `invoices.service.ts` (`writeOff`), `sales-common.ts`; `modules/purchasing/payables.service.ts` (`recordPayment`); `modules/users/company.controller.ts`, `company.service.ts`; `modules/imports/imports.module.ts`; `packages/db/src/company/organization.ts` (`settings`).
  - **Web:** `lib/api/http/api-methods.ts`, `router.ts`, `transport.ts`; `lib/api/contract.ts`; `lib/api/demo/store.ts` (`updateSettings`, `SETTINGS_LABELS`, `granter`, `assertCan`), `permission-rules.ts` (`SETTINGS_PERMISSIONS`); `components/workspace/workspace-provider.tsx`; `components/step-up-dialog.tsx`; `features/settings/form/settings-form.tsx`, `payments/payments-page.tsx`, `company-profile-page.tsx`.
  - **Tests:** api `company.int`, `accounting.int`, `invoices.int`, `payables.int`, `expenses.int`, `auth-harness.ts`; web `api-rereads.test.ts`, `fake-api.ts`.
- **Planning:** a first plan, a critic's review (three must-fix items and eighteen should items), and a final plan that applies them, written against B6's head `4b78e8b` and GET /company's pushed head `4a0beec`. GET /company has since handed off at `6dbd03c`, so every line number was re-checked here and every edit is anchored on text. The plans live in the session scratchpad, not in the repo, so the plan is restated below.

## Inventory: where Settings reads and writes today (api mode, `6dbd03c`)
| Page | Reads | Writes | Part |
| --- | --- | --- | --- |
| Company profile | shell `settings.profile` (DemoStore) | `updateSettings("profile")` (DemoStore) | **1** |
| Number format | shell `settings.numbers` (DemoStore) | `updateSettings("numbers")` (DemoStore) | **1** |
| Payments | shell `settings.payments` (DemoStore) | `updateSettings("payments")` (DemoStore); the API's customer and supplier payments read the server's own row | **1** |
| Expenses | shell `settings.expenses`, `settings.sharedCosts` (DemoStore) | `updateSettings("expenses")`, `("sharedCosts")` (DemoStore); the API's expenses read the server's row | **1** (approval), 4 (shared costs) |
| Sales and documents; Localization and tax (Region, Currency, Sales tax, Payroll) | shell `settings.localization` | `updateSettings("localization")` | 2, 3 |
| Warehouses and showrooms, Stock rules | `list("locations")`, shell `settings.inventory` | `saveLocation`, `updateSettings("inventory")` | 4, with stock adjustments |
| HR | shell and `getSettings()` | `updateSettings("hr")` (DemoStore); time-off policies on the API | 5 |
| Branding | shell `settings.branding` | `updateSettings("branding")` | 6 |
| Email and notifications, Outbox | shell `settings.email`, DemoStore | DemoStore | with the bell and Outbox |
| Users, Security roles, Audit log, Billing, Data import | the API | the API | done |
| Meetings, Connect a database | not in api mode | none | out |

Other readers of the settings, all DemoStore's today: the provider (`NumberSettingsProvider`, branding), the invoice page's own `getSettings()` (the payment sheet's approval line and Update status's Write off), the quote page's own read, documents (`invoice-model.ts`, `receipt-pdf.tsx`, `po-pdf.tsx`), HR screens, date formats and report PDFs.

## Scope: six parts
All of Settings in one PR would be about 40 product files, a new API module, versioned tax tables, a control-database time zone, a storage upload and the payroll lock, with four different security reviews. So it is split:
1. **This PR:** the read, Company profile, Number format, Payments, Expense approval. The most used (every number, every document, every payment and write-off), the lowest risk (plain JSON rows), and the base every later part extends (the module, the read, the write pattern, the shared rules table, the web's served-sections switch). It ends the silent no-op on two fraud controls.
2. Sales and documents, and Localization's Region, Currency and Payroll tabs (the time zone's second copy is a likely stop-and-ask).
3. The Sales tax tab (versioned tax rows).
4. Warehouses and showrooms, and Shared costs.
5. HR settings (the pay-period lock).
6. Branding (control `tenant_branding`, the logo upload).

The email section goes with the bell and Outbox, and the stock rules with stock adjustments. Out: Settings → Meetings (ADR 0051 part 4), billing writes, platform admin, Data import's later parts, the Settings → Accounting screen, `GET /settings/defaults` with seeding at provisioning, and `PATCH /me`.

## Plan (short)

### Shared (packages/shared; plain functions, no Zod)
- `settings/sections.ts`: `SETTINGS_SECTIONS` (keys, feature, module and audit label per section; the one source for the API guards and DemoStore), `API_SETTINGS_SECTIONS` (`profile`, `numbers`, `payments`, `expenses`), `SETTINGS_READERS` and `readableSections` (who gets which section), `profileFor` (the EIN only for `settings.company.manage`), `SETTINGS_SCOPE_MESSAGE`, the numbers wire (`numbersToWire`, `numbersFromWire`), and `SettingsAnswer`.
- `settings/section-rules.ts`: the content rules with the words both modes show (`companyProfileProblem`, `numberSettingsProblem`, `paymentSettingsProblem`, `expenseSettingsProblem`, the `settingsSectionProblem` dispatcher, which also carries the overtime check moved out of DemoStore), with the patterns and messages.
- `decimal-text.ts`: `MONEY_TEXT`.

### The API: a new `settings` module
- `GET /settings` (`@AnyCompanyMember()`, `no-store`): the served sections each person reads, cut by `readableSections` and `profileFor`; a section never saved is answered as the API acts on it.
- `PUT /settings/profile`, `/numbers`, `/payments`, `/expenses`: keys and module from `SETTINGS_SECTIONS`, then in the handler the switch (404), data scope `all` (403), the strict Zod body (400), the shared rule (400), for Payments the step-up (403 `step_up_required`, after the content checks), then the save under `FOR UPDATE` with one audit entry in the same transaction.

### The web
- `API_METHODS` gets `getSettings` (the served sections from `GET /settings` merged over DemoStore's, through `settingsFromAnswer`) and `updateSettings` (a served section is a PUT, then a read; any other section stays on DemoStore).
- `saveSection` makes a refused settings save show its message and keep the draft (`SettingsForm`), the Payments page gets `stepUp`, and Company profile builds its form rules from the shared patterns and messages.
- DemoStore's `updateSettings` checks the same module, keys, switch, scope and content rules in the API's order (this line first said "keys, module"; the API checks the module first, corrected in review round 4).

### Tests (red first)
- **Shared** R1 to R11 (`settings-sections.test.ts`) and R9 (`decimal-text.test.ts`).
- **API** A0 to A15 (`settings.int.test.ts`).
- **Web unit:** W1 to W7 (`settings-answer.test.ts`), SF1 to SF3 (`save-section.test.ts`), D1 to D8 (`demo-settings.test.ts`), two `api-rereads` cases.
- **Api-mode e2e:** E1 to E3 (`tests/e2e-api/settings.spec.ts`), with the step-up helpers moved to `flows/checks.ts`.
- **Demo e2e:** S1 in `tests/e2e/settings.spec.ts`.
- **Mutations** M1 to M23 on the final code.

### Stages (one commit each, pushed)
0. This log and the spec (docs only), the draft PR.
1. Red tests, no product code (no commit).
2. The change: 2a shared and API, 2b web, each with its unit and API tests and checks; the mutations; 2c the e2e specs.
3. Api-mode and demo e2e (green).
4. Docs: ADR 0059, api-contract.md, the delta row, data-model.md, FEATURES.md.
5. Full checks, the whole demo and api-mode suites, reviews, handoff.

## Decisions and why
Planned decisions, each the safest option found. Decisions taken while building go under "Decisions taken during the build".

- **D1, six parts, part 1 first** (Scope above).
- **D2, a new `settings` API module with explicit `PUT /settings/<section>` routes,** one per section, not the contract's `PUT /settings/:section`. Each route declares its own permission and module, so the route inventories (`permissions.int`, `isolation.int`) see them; an unknown section is Nest's 404; nothing clashes with `@Controller("settings/accounting")`.
- **D3, `GET /settings` answers each section only to people who read it** (the narrowest read every screen still gets; Q2):
  - `profile` and `numbers` to every member: documents and every `<Num>`;
  - the **EIN** is `""` unless the person holds `settings.company.manage`: only Company profile reads it, and no document prints it;
  - `payments` to holders of `sales.invoice.view` or `settings.payments.manage`: the invoice page (payment sheet, Update status) and the Payments page;
  - `expenses` to holders of `settings.expenses.manage`: only Settings → Expenses reads it, and telling every member the approval line makes it easy to split an expense under it.
  - **Accepted residual:** the audit log's "Changed company profile" rows carry the EIN in `before` and `after`; holders of `settings.audit.view` (Owner, Manager, Accountant, HR manager) read them. Rule 5 does not make the EIN sensitive. Q2.
- **D4, every settings save needs data scope `all`,** in the API (part 1's routes) and in DemoStore (every section). Settings bind the whole company, as the books do (ADR 0040). No default role is affected: every holder of a settings key has scope `all`. A blueprint-delta row records it.
- **D5, saving Payments needs a step-up** (a code within 5 minutes), in both modes' screens and on the API. The two-person check and the write-off limit are fraud controls over money in and money out, and their key is an MFA key; the import precedent (ADR 0057) took a step-up beyond the spec as the safest option. Expense approval gets none (its key isn't an MFA key; Q1). Spec rule 23 grows by one item, and the `auth.step-up` register row changes (D17).
- **D6, the number format's decimals travel as a list** (`decimals: { kind, places }[]`) in the GET, the PUT body, the PUT answer and the audit entry. `unitCost` is a reserved `SENSITIVE_FIELDS` name, so `decimals.unitCost` would be stripped for anyone without product cost; the strongest case is the HR Suite Owner, who has no product cost at all, so even a default Owner's Number format save would fail on a missing kind. Stored rows keep `NumberSettings`, which `loadMoneyFormat` reads.
- **D7, Reset to default stays on DemoStore** (`getDefaultSettings` unrouted). In api mode only accounts with a fixture twin open the shell (GET /company D15), and DemoStore's defaults are that fixture's originals, which the API was seeded with. A real `GET /settings/defaults` comes with country-pack defaults at provisioning (Q4).
- **D8, the content rules are plain functions in packages/shared,** and the API adds strict Zod shapes in its own module. packages/shared has no Zod dependency, and adding one is an ask-before. DemoStore runs the same rules, so both modes refuse the same values with the same words.
- **D9, readers, modules and product switches filter the answer; page switches gate only the PUT.** Profile and numbers stay answered while their page's switch is off, because the rest of the app uses them; their PUT answers 404 then.
- **D10, a section never saved is answered as the API acts on it:** the US number format, expense approval off, a blank profile, and payments as "every payment waits, nothing can be written off" (`approvalRequired: true`, threshold `""`, `writeOffMax: "0.00"`, `PAY-`, `RF-`), while the API refuses payments until the row exists (409). Q9.
- **D11, no control-database write.** `tenants.legal_name` keeps what provisioning wrote (Q5).
- **D12, the number format keeps the company's own locale and currency.** A PUT that changes either is refused, compared with the company's stored format or, when nothing is stored, the US pack's `defaultNumberSettings()`. No literals (rule 12; Q7). The dispatcher takes the current section, which part 2 needs for the time zone too.
- **D13, amounts are stored as sent** once they pass `MONEY_TEXT`. `""` means "every payment" or "no limit", as before. Each refusal names its field.
- **D14, ADR 0059 "Settings on the API"** holds part 1's decisions and the plan of the later parts. 0058 stays reserved.
- **D15, unmoved pages keep saving to the browser in api mode,** as today (Q6).
- **D16, a refused settings save shows its message and keeps the draft** (critique must-fix 1). Today `SettingsForm.save` has no `catch`; with a step-up, the dialog's `submit` catches the rejection and writes it into a dialog that `save`'s `finally` has just closed, so nothing is shown. A pure `saveSection` catches it and shows the toast (the `ApiError`'s words, or "<Title> was not saved. Try again."), in both modes, with or without a step-up. This also fixes the silent Currency and Sales tax tabs.
- **D17, the `auth.step-up` register row changes** (`/feature-change` step 6; the key is kept). Its screens text adds "payments", its note adds Settings → Payments ("on the API it always needs the code, whatever the switch (ADR 0059)"), and its tests add `settings.spec.ts`. `features.ts` is unchanged and the sync test runs. **Step 2's owner confirmation is replaced by the queue's safest-default rule** (the owner is asleep), as the import PR did; steps 3 (ADR 0059), 4 (FEATURES.md text) and 8 (the delta row names `auth.step-up`) are done.
- **D18, payment and refund prefixes must differ** (case-insensitive). `refunds` has no unique number index, so equal prefixes would give a payment and a refund the same number.
- **D19, the routes read `SETTINGS_SECTIONS`** for keys, module and switch (rule 4). A0 checks each handler's metadata against the table.
- **D20, no `deleted_at` filter** in the answer or the save's lock, the same as every settings loader. Settings rows are never soft-deleted (`DELETE /settings/:section` isn't built), and the unique group index holds one row per group anyway.
- **D21, the Payments threshold is checked even while approval is off** and its input is disabled. Only an old demo overlay can hold a value that fails, the toast names the field, and the person can turn approval on, fix it and turn it off. Accepted.
- **D22, stacked on GET /company (#50) (the orchestrator's decision).** The final plan was written against GET /company's pushed head `4a0beec` and said this branch is built on it once it hands off. It handed off at `6dbd03c` and holds B6 (`merge-base --is-ancestor origin/fix/sales-quote-resave origin/feat/web-company-from-api` is true); its one open PR is #50 (draft). The orchestrator cut this branch with `git switch -q --no-track -c feat/settings-sections-api origin/feat/web-company-from-api`, the safest option while nothing can merge: STATUS and BRANCHES stay linear, and the shared files can't conflict later. The PR body says it is stacked on #50 and must merge after #45 to #50.
- **D23, tests red first, never committed red.** feature.md step 4 hands the API and Playwright tests to the test-writer subagent. This session runs as a subagent without one, so the builder writes them from the final plan's test section, as GET /company did.
- **D24, STATUS and BRANCHES are left to the orchestrator,** which applies "For STATUS" below at handoff.

### Decisions taken during the build
- **B1, A6 and A7 run in a provisioned company, not on Summit.** The plan put the "server acts on it" cases on the harness's Summit. They run in `payco`, a provisioned company set up as `accounting.int.test.ts` sets one up (a branch, a warehouse, a tile, Summit's localization, a Colorado tax rule and Summit's four rows), with fresh invoices, a fresh billed supplier and a services vendor. The safer reading: the cases don't depend on Summit's seeded open balances or pending payments, and Summit's own rows are still exercised end to end by E1 to E3 in api mode.
- **B2, A7's expense needs a services vendor.** The first green run failed A7 with "Choose an active vendor of services."; the vendor is now inserted as `expenses.int.test.ts` inserts one. Nothing in the product changed.
- **B3, the shared message tables have a few entries the plan didn't list.** `PROFILE_MESSAGES.position` (a map position that isn't a pair of numbers), `PAYMENT_MESSAGES.approvalRequired`, `EXPENSE_MESSAGES.approvalRequired` and `NUMBER_MESSAGES` (each kind once, the negative style, compact dashboards), so every content rule refuses with words even where TypeScript (DemoStore) or Zod (the API) normally stops the value first. "Give each kind of number once." is one shared string, used by the API's Zod and by the shared rule (an unknown kind in the stored record).
- **B4, the decimals list's `.max(7)` carries "Give each kind of number once."**, so an eight-entry list with a duplicate gets the same words as a missing kind (A3b).
- **B5, the tolerant web read also defaults places that aren't a whole number** (`numbersFromWire`). The API's write checks the list strictly first, so this only matters for a newer or broken answer.
- **B6, `save` takes an `answered` mapper, not a value.** The audit's `before` is read under the row lock inside the transaction, so it needs the same mapping as `after` (the number format as the wire list).
- **B7, A15 deletes `bareco`'s numbers row first.** Vitest runs the cases in file order, and A2 saved that row earlier; deleting it behind the API's back gives A15 its "never saved" company again.
- **B8, red D4 matched a seeded entry.** Summit's fixture history holds a "Changed number format" row (`sm-aud-0007`), so D4 now checks only the entry its own save added.
- **B9, E2 counts audit entries before and after.** The plan counted "exactly 2 from `since`'s minute"; a heal PUT in the same minute would have made it 3. The count is taken right after the heal and compared with the count at the end (two more).
- **B10, `confirmStepUp` settles both waits of its race** (the dialog closing, or "That code is not right"), so the wait that loses is never an unhandled rejection.
- **B12, A14 holds the row so the lock is pinned.** The first mutation run left M15 (the save's `FOR UPDATE` removed) uncaught: the two parallel saves didn't interleave, and one of them wrote the value both would have read anyway. A14 now saves a third value first, then holds the numbers row from its own transaction while both saves start (750 ms), so without the save's lock both read the same `before` and the audit chain breaks. It passed three runs in a row with the lock, and M15 is caught. Committed on its own (`1b30ddc`).
- **B13, M19's first anchor broke the file.** Removing the `superRefine` call also removed the comma after `.max(…)`, so the mutated file didn't load ("no tests"). The anchor now keeps the comma; M19 is caught by A3b (six kinds pass Zod and `numbersFromWire` fills the seventh).
- **B14, `company.spec.ts`'s `putRole` uses the moved `putWithStepUp`,** the same logic it had (no duplicated code). Its red-run pass was with its own copy; the stage 3 green run covers the shared one.
- **B11, the UI check of the Payments step-up.** The dialog is the existing `StepUpDialog` (Radix: focus moves in, returns to Save; it is already used by roles, users, Currency and Sales tax), so no new markup or tokens. S1 and E2 drive it; the a11y and responsive specs run in stage 3's demo subset.
- **B15, an e2e proof for the one path only the e2e specs pin** (stage 3, throwaway). Table 7.8's "the saver's own shell follows without a reload" has no unit pin, so one mutation was built and run: the web's `PUT /settings/<section>` sent through `requestAsRead` (no re-read). E1 then failed at step 3, "Expected pattern: /^\$[\d,]+$/, Received string: \"$40.00\"" (Grace's own list kept its cents), so E1 step 3 pins the shell's re-read. The file was restored with `git checkout --` (`git diff --quiet` true); E1's clean-up put the number format back; every later api-mode run rebuilt.
- **B16, a throwaway probe of Summit's settings** (`apps/web/tests/e2e-api/zz-settings-probe.spec.ts`, never committed, removed at the end): Dana's `GET /settings` after the runs. After the green run it answered exactly the four served sections at Summit's seeded values (payments `true`/`1000.00`/`5.00`/`PAY-`/`RF-`, expenses `true`/`1000.00`, the seven decimals, `minus`, compact, `en-US`, `USD`, `office@summitfloor.example`, an EIN of the right shape). This is the plan's "a `readAs(GET /settings)` as Dana shows the four sections back at Summit's values".
- **B17, no flow to bring back from fixme.** The orchestrator's stage text says "with the flow back from fixme"; `grep -rn fixme apps/web/tests/e2e-api apps/web/tests/e2e` finds none on this branch (B2, B3 and B1 brought F1, F2 and F5 back earlier). The flows that record customer and supplier payments and expenses under Summit's rules (F1, F2, F7) run in stage 3's `settings-flows`.
- **B18, the whole demo suite was run too.** The orchestrator's stage text names stages 3 and 4, the full checks and the whole api-mode suite; the plan's stage 5 also runs the whole demo suite before the final api-mode build. The demo subset took 6 minutes, so the whole demo suite (10 minutes) was run in the plan's order, between the full checks and `settings-all-final`, whose `--build` then rebuilt api mode over the demo build.

## Which test pins which path
Test ids: R (shared), A (API), W, SF and D (web units), E (api-mode e2e), S1 (demo e2e), M (mutations), EP1 (B15).

| Path | Pinned by |
| --- | --- |
| The routes declare the shared table | A0; M20 |
| GET answers each section to its readers; the EIN only to the profile manager; module and product switch filter | A1, A8, A9b, R10, R11, E1 step 4, E3 step 2; M4, M5, M17, M18, M23 |
| Nothing stripped by name (numbers as a list) | A1, R6, W4; M4 |
| Never-saved fallbacks | A2 |
| Each PUT's permission, every role, both products | A3, A4, A5, A7 |
| The wire's own number checks | A3b; M19 |
| Module below; ceiling below | A5 (HR), A7 (HR), A9b, D7, D7b; A10; M6, M22 |
| Company-wide scope (API and DemoStore) | A9 (each of the four routes, Payments before any step-up; review round 2), D2; M3, M13, M25 to M28 |
| Switch off → 404; DemoStore's order (module, keys, switch) | A8, D3, D3b, D7b (review round 4); M7 |
| Strict bodies and shared content rules (both modes) | A4, A4b (an unknown field on each route; review round 2), A5, A7b (the expense amounts on the route; review round 2), A15, R2 to R5, D1, D8, S1; M8, M9, M11, M21, M24, M29 to M32 |
| Payments step-up after the content checks, on screen and on the API | A5, E2 step 2 (no request from the page; a direct PUT is refused before any code), S1, SF4, SF5; M1, M2 |
| A refused save is shown and the draft kept | SF1 to SF4, S1, E2 step 2, E3 step 3; M16 |
| The server acts on the saved rules (customer and supplier payments, write-off, numbering, expenses) | A6, A7 |
| The locale rule compares with the stored row, not the defaults (rule 12; review round 3) | A15 (an en-CA company), D8b, R3; M33 to M35 |
| Own company only | A11 |
| Audit per write; the lock orders writes | A3, A14, E2 step 7; M10, M15 |
| Web: served sections merged, others DemoStore's, unknown ignored | W1, W2, W6; M12, M14 |
| The saver's own shell follows without a reload; another person's on load | E1 steps 3 and 4, E2 step 4, E3 step 2; EP1 (E1 step 3) |
| What isn't offered, the API refuses | E1 step 5, E2 step 5 |
| `/settings/accounting` unaffected | A13 |
| Demo behaviour otherwise unchanged | D4 to D6, stage 3's demo subset |

## Owner questions
None blocks the build; each has its safest default taken.

- **Q1, step-up for settings saves.** Taken: Payments only (fraud controls under an MFA key, over customer and supplier payments). Expense approval has none, as the spec says. Add it to Expenses, or to every settings save?
- **Q2, who reads the settings.** Taken (narrow): profile without the EIN and the number format to everyone; the EIN to `settings.company.manage`, plus audit-log readers through profile-change rows; payment rules to `sales.invoice.view` or `settings.payments.manage`; expense approval to `settings.expenses.manage`. Widen any of these (for example the EIN to HR for W-2 work), or mask the EIN in the audit rows too?
- **Q3, company-wide scope** for every settings save. Taken: yes; no default role is affected. Confirm.
- **Q4, Reset to default on the API.** Taken: it reads the demo's originals, which equal the seeded values. Build `GET /settings/defaults` from the country pack, and seed the settings at provisioning?
- **Q5, the legal name in two places.** Taken: the company profile is the one documents print, and the console keeps the sign-up name. Sync the console's copy on save (a control-database write)?
- **Q6, pages not yet on the API, in api mode.** Taken: they keep saving in the browser until their part. Hide them like Settings → Meetings, or show a one-line note?
- **Q7, the number format** keeps the company's own locale and currency (US English and US dollars for every company today). Confirm.
- **Q8, the order of the later parts:** 2 Localization and documents, 3 Sales tax, 4 Locations and shared costs, 5 HR, 6 Branding; email with the bell and Outbox; stock rules with stock adjustments. The Settings → Accounting screen has no part yet. Change the order?
- **Q9, a company that never saved Payments** is shown "every payment waits, nothing written off", while the API refuses payments until it is saved. Confirm, or show "not set up" instead?
- **Q10, separation of duties.** With `settings.payments.manage`, the Accountant, who also records and approves payments, can switch the two-person check off, raise or empty the threshold, and raise or empty the write-off limit, then switch them back. The step-up and audit record this but don't stop it. Taken: no change. Should loosening these controls (approval off, the threshold up or empty, the write-off limit up or empty) be Owner-only? Related: `PUT /settings/accounting` uses the same key with no step-up.

## For STATUS
The orchestrator applies these at handoff (this session leaves docs/STATUS.md and docs/BRANCHES.md alone). Re-read STATUS first; anchor on the quoted text. This branch's draft PR is #51.

- **"In progress" and "Next three tasks" item 2:** "then Settings" gains "(part 1 of 6: draft PR #51, `feat/settings-sections-api`, stacked on #50)"; the bell and the Outbox follow Settings' parts, or the owner's order (Q8).
- **"Done": a Settings part 1 entry** (on merge): "Settings part 1 on the API (queue item 2, task 2), PR #51 (ADR 0059). In api mode `GET /settings` gives the company profile and number format to every member (the EIN only to the profile's manager), the payment rules to people who see invoices or manage payments, and expense approval to its managers, each by module and product switch, with the number format's decimals as a list; `PUT /settings/profile`, `/numbers`, `/payments` (with a step-up) and `/expenses` save them with their own module and key, company-wide scope, strict bodies and shared rules, under a row lock with one audit entry; the web merges these sections over DemoStore's and routes their saves, so the shell, documents, the payment sheet and Update status follow the server, and the server's customer and supplier payments, write-offs and expenses apply what the pages save; a refused settings save now shows its message on every settings page, and Payments and Expense approval run the shared rule before the step-up or the request, so a refused value never costs an authenticator code. DemoStore applies the same module, key, switch, scope and content rules, in the API's order (module first). Other sections stay in the browser until their part. No schema change, migration or dependency; nothing in core, providers, packages/db or the web's session. Checks: …", filled from the "Checks" bullet below.
- **Checks** (for the Done entry's "Checks: …"): `pnpm lint` and `pnpm typecheck` clean; `pnpm test`: shared 75 files and 1,136 tests, web 47 and 365 (367 after review round 1), api unit 17 and 124, db 5 and 18, providers 1 and 11; `pnpm test:api`: api 37 files and 694 tests, db 8 and 59, providers 1 and 2; `pnpm test:hooks` 15; 23 of 23 mutations caught, plus the e2e proof EP1; api-mode `settings.spec.ts` (E1 to E3) green with invoices, purchasing, expenses, company, company-standing and login (18), again on the used database (3), the flows (8) and the whole api-mode suite on a fresh build (49 of 49); demo subset 271 passed and 1 skipped (flooring) and 7 (hr); the whole demo suite 445 passed and 7 skipped (flooring; every skip is a switched-off feature or a data condition in a file this branch doesn't touch) and 67 (hr). Summit's four sections were back at their seeded values after the runs. After review round 1 (web only): web lint and typecheck clean, web units 47 files and 367 tests, the api-mode set again on a fresh build (18 of 18), and the demo subset again (271 passed and 1 skipped, and 7). After review round 2 (API tests and specs): the full checks again (lint and typecheck clean; shared 1,136, web 367, api unit 124, db 18, providers 11; `pnpm test:api` api 37 files and 696 tests, db 59, providers 2; hooks 15), 32 of 32 mutations caught (M24 to M32 new, eight of which survived round 1's tests), and api-mode `settings.spec.ts` on a fresh build (3 of 3). After review round 3 (tests only): the full checks again (web 368; `pnpm test:api` api 37 files and 696 tests) and M33 to M35 caught by the new A15 and D8b (35 mutations in all). After review round 4 (DemoStore's order): web lint and typecheck clean, web units 47 files and 369 tests, api-mode `settings.spec.ts` on a fresh build (3 of 3), and the demo subset again (271 passed and 1 skipped, and 7). CI could not run (Actions blocked by billing).
- **Close or update:**
  - "Settings default inputs keep a bare point as typed (`12.`) …": for Payments and Expenses, both modes now refuse it with a message that names the field; Documents' percents remain for part 2.
  - "When `PUT /settings/:section` moves to the API, it must refuse `overtimeRuleProblem`": "the overtime check lives in the shared `settingsSectionProblem`; part 2's payroll route must call it".
  - B6's tax-rate note (`ratePct` numeric(18,8) answered raw): "for Settings part 3".
  - "Settings at provisioning": add "`GET /settings` answers safe values for a company without rows (ADR 0059 D10); seeding at provisioning and `GET /settings/defaults` wait for the owner (Q4)".
  - GET /company's "Still DemoStore's in the api-mode shell: … branding and number format (`getSettings()`, the Settings task)": the number format and profile moved; branding is part 6.
- **New follow-ups:**
  - **Settings parts 2 to 6** (ADR 0059 "Later parts"), each with its asks. Part 2's time zone is a likely stop-and-ask (control `tenants.time_zone`). Part 2's web side: a per-tab ApiClient method or a server-side diff, never a client diff of the half-DemoStore copy.
  - **Unmoved settings pages save in the browser only in api mode** (Branding, Sales and documents, Localization and tax, Warehouses and showrooms, Shared costs, HR settings, Email, Stock rules). Q6.
  - **The Expenses page is mixed in api mode:** approval on the API, Shared costs in the browser until part 4.
  - **Reset to default** reads DemoStore's originals in api mode; `resetSettings` is unrouted.
  - **The legal name in two places** (Q5).
  - **The Payments page says "customer payments",** but its two-person check also governs supplier payments, in both modes. Reword the page in a later screen pass (sales.md rule 31 and purchasing.md say so since review round 2).
  - **`PUT /settings/accounting` takes `settings.payments.manage` with no step-up,** although it decides where money posts. Add one, and decide whether its scope message should be the settings one (Q10's neighbour).
  - **One older "sales.md Appendix A" cite:** `apps/web/tests/unit/decimal-zero-reads.test.tsx` (older than this branch) names an appendix sales.md doesn't have. The code's many "spec Appendix A" cites mean the blueprint's Appendix A and are fine. Point this one at the blueprint or sales.md's rule numbers in a docs sweep.
  - **Pattern sweeps:** move the controllers' `MONEY` copies to `MONEY_TEXT`, and the two email copies (`packages/shared/src/import/fields.ts`, `apps/web/src/lib/api/demo/notification-actions.ts`) to `EMAIL_TEXT`.
  - **The settings read path** in the API's own modules still casts the JSON. Reading through the shared rules is a hardening step.
  - **Reserved names:** each later part checks its section's property names against `SENSITIVE_FIELDS` (A1's key walk extends to it).
  - **The bell's and Outbox's DemoStore messages** format money with DemoStore's number format; this goes with that task.
  - **The Settings → Accounting screen** (ADR 0040) still has none.
- **Owner questions:** a new block, "Owner questions (PR #51, Settings part 1; none blocks)", with Q1 to Q10 above.
- **BRANCHES:** a `feat/settings-sections-api` row: "B (Claude)", "Queue item 2, task 2, Settings part 1 of 6: company profile, number format, payments and expense approval on the API (main checkout; stacked on #50)", "Draft" then the state at handoff, the PR, "see the branch".

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `settings/logs` folder, and api-mode runs in `flows/logs`.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `git fetch origin`; `git log -3 origin/feat/web-company-from-api`; `merge-base --is-ancestor origin/fix/sales-quote-resave origin/feat/web-company-from-api`; `gh pr list --head feat/web-company-from-api` | GET /company's newest commit is its handoff (`6dbd03c`); it holds B6; one PR, #50 (draft); the tree was clean; main is `d0e4e20` |
| 0 | `git switch -q --no-track -c feat/settings-sections-api origin/feat/web-company-from-api` | branch made at `6dbd03c` |
| 0 | `docker ps`; ports 3000 and 4000 | the compose PostgreSQL on 5432 and the api e2e one on 5433 up; both ports free |
| 0 | `pnpm exec prettier --check` on this log and the spec | clean (Markdown is in `.prettierignore`, so this checks nothing) |
| 0 | commit 0 (`230a4d4`), pushed with `-u` by naming the branch; `rev-parse --abbrev-ref feat/settings-sections-api@{upstream}` | pushed; `origin/feat/settings-sections-api` |
| 0 | `gh pr create --draft --base main --head feat/settings-sections-api … --body-file settings/pr-body.md` | draft PR #51 |
| 1 | `heavy.sh pnpm --filter @workspace/shared exec vitest run test/settings-sections.test.ts test/decimal-text.test.ts`, before the change | red as expected: 11 failed (R1 to R11 "… is not a function" or "undefined"; R9 "Cannot read properties of undefined (reading 'test')": no `MONEY_TEXT`) |
| 1 | `heavy.sh pnpm --filter api exec vitest run --project integration test/settings.int.test.ts`, before the change | red as expected: 39 failed, 1 passed (A13, `/settings/accounting`). Every route `{"code":"not_found","message":"Cannot GET /settings"}` (or PUT); A0 "Cannot find module … settings.controller"; the rest "numbersToWire is not a function" |
| 1 | `heavy.sh pnpm --filter web exec vitest run` on the three new unit files and `api-rereads.test.ts`, before the change | red as expected: `save-section.test.ts` cannot import its module; W1 to W6 "numbersToWire is not a function"; D1, D2, D3, D4, D7, D8 resolved or found no export; `api-rereads` 7 failed (151 cases against 149 methods, "c.getSettings is not a function"). D3b, D5, D6 and W7 passed: they pin behaviour that must not change (B8 for D4) |
| 1 | `heavy.sh pnpm --filter web exec tsc --noEmit -p tsconfig.json`, with the red unit files kept aside and the e2e type stub | clean |
| 1 | `heavy.sh flows/api-e2e.sh settings-red --build -- tests/e2e-api/settings.spec.ts tests/e2e-api/company.spec.ts` | builds 6 s; exit 1 after 28 s: 3 failed, 4 passed. E1, E2 and E3 at their heal, "GET /settings answered 404: Cannot GET /settings" (the expected red: the setup needs the new route); `company.spec.ts` E1 to E4 passed with the moved step-up helpers. Ports free after |
| 1 | `heavy.sh bash settings/e2e-demo.sh red` (demo build, then S1, one worker) | build 10 s; exit 1 after 62 s: S1 at step 2, "waiting for getByRole('dialog', { name: 'Confirm it is you' }).getByLabel('Authenticator code')" (no step-up dialog on Payments). Ports free after |
| 1 | the red files put back (moved and copied back, the shared type import restored); `git status --short` | exactly the stage's files |
| 2a | the targeted shared tests after the change | 2 files, 16 passed |
| 2a | `heavy.sh pnpm --filter api exec vitest run --project integration test/settings.int.test.ts` | first run 39 passed, 1 failed (A7: "Choose an active vendor of services.", B2); after the test fix 40 passed |
| 2a | `heavy.sh settings/checks.sh s2`: shared `test`, `typecheck`, `lint`; api `typecheck`, `lint`, `test` | shared 75 files and 1,136 tests, typecheck and lint exit 0; api typecheck 0, unit 17 files and 124 tests; api lint first exit 1 (two unused names in the new test), then 0 after the fix |
| 2a | `heavy.sh pnpm --filter api exec vitest run --project integration` on `settings`, `permissions`, `isolation`, `accounting`, `invoices`, `payables`, `expenses`, `users` and `company` | 9 files, 169 passed in 39 s. The permission and isolation route inventories (`listRoutes`) pick the five new routes up with no edit |
| 2a | `pnpm exec prettier --write` on the stage's files | two test files reformatted, the rest unchanged |
| 2a | commit 2a (`f3530b6`), pushed by naming the branch | pushed |
| 2b | the targeted web unit tests after the change | 4 files, 26 passed |
| 2b | `heavy.sh settings/checks.sh s2b web:test web:typecheck web:lint` | web 47 files and 365 tests; typecheck 0; lint 0 with 2 warnings (unused names in W2), fixed; eslint and W1 to W7 again clean |
| 2b | `pnpm exec prettier --write` on the stage's files | one test file reformatted |
| 2b | commit 2b (`eb66bf3`), local until the mutations ran | committed |
| 2b | `heavy.sh python3 settings/mutate.py M1` … `M23` (background, one run; every mutated file restored with `git checkout --`) | 21 of 23 caught at first; M15 not caught (B12) and M19's file didn't load (B13) |
| 2b | A14 strengthened (B12); `settings.int.test.ts` again | 40 passed, three runs in a row |
| 2b | `mutate.py M15 M19` again | both caught: M15 at A14 (the second save's `before` is not the first's `after`), M19 at A3b ("expected [ 200, undefined ] to deeply equal [ 400, 'invalid_request' ]") |
| 2b | api `lint`, `typecheck` after the A14 change; commit `1b30ddc`; 2b's commit and it pushed | exit 0; pushed |
| 2c | `prettier --write` on the four e2e files; `heavy.sh pnpm --filter web exec eslint` on them; `web:typecheck` | unchanged; eslint exit 0, no warnings; typecheck exit 0 |
| 2c | commit 2c (`2be13e0`), pushed | pushed |
| 3 | `heavy.sh flows/api-e2e.sh settings-green --build -- tests/e2e-api/settings.spec.ts invoices.spec.ts purchasing.spec.ts expenses.spec.ts company.spec.ts company-standing.spec.ts login.spec.ts` | builds 14 s; exit 0, **18 passed** in 61 s (first green run of E1 to E3: E1 7.7 s, E2 7.3 s, E3 4.5 s; `company.spec.ts` E1 to E4 pass with the shared `putWithStepUp`). Ports free after |
| 3 | `heavy.sh flows/api-e2e.sh settings-probe-1 -- tests/e2e-api/zz-settings-probe.spec.ts` (B16, throwaway) | 1 passed: Dana's `GET /settings` has exactly `expenses`, `numbers`, `payments`, `profile`, all at Summit's seeded values |
| 3 | `heavy.sh flows/api-e2e.sh settings-again -- tests/e2e-api/settings.spec.ts` (the now used database, no rebuild) | exit 0, **3 passed** in 23 s (E1 7.4 s, E2 7.6 s, E3 3.6 s) |
| 3 | `heavy.sh flows/api-e2e.sh settings-flows -- tests/e2e-api/flows` | exit 0, **8 passed** in 74 s (F1 to F7, F3 twice): customer and supplier payments and expenses under Summit's rules |
| 3 | EP1 (B15): the settings PUT through `requestAsRead`; `heavy.sh flows/api-e2e.sh settings-ep1-mutant --build -- tests/e2e-api/settings.spec.ts -g "E1 "`; `git checkout --` the file | caught: exit 1, E1 at step 3 (line 162), "Received string: \"$40.00\""; restored (`git diff --quiet`); clean-up healed |
| 3 | `heavy.sh bash settings/e2e-demo.sh subset` (demo build, one worker) | build 11 s; exit 0. Flooring **271 passed, 1 skipped** in 329 s (S1 1.3 s; the skip is `notifications.spec.ts`'s own `test.skip` when the first open invoice was already sent, a file this branch doesn't touch); hr **7 passed** in 5 s. Ports free after |
| 3 | `grep -rn fixme apps/web/tests/e2e-api apps/web/tests/e2e` | none (B17) |
| 4 | ADR 0059 (new); api-contract.md (a "Settings, part 1" section, the Permissions paragraph, Bodies, supplier payments, `/settings/accounting` rows, "Company and settings" rows); the delta row; data-model.md "Settings groups"; FEATURES.md `auth.step-up` and `sales.payments` (text only); this log (B15 to B18, table, commands) | written |
| 4 | `heavy.sh pnpm --filter @workspace/shared exec vitest run test/features.test.ts` | 1 file, **7 passed** (the register and `features.ts` still agree; `settings.spec.ts` exists for the `auth.step-up` row) |
| 4 | `pnpm exec prettier --check` on the six docs | `*.md` is in `.prettierignore`, so this checks nothing (recorded, as stage 0) |
| 4 | commit `215998b`, pushed by naming the branch | pushed |
| 5 | the probe moved out of the tree (B16); `heavy.sh bash settings/full.sh` | exit 0 in 230 s: `pnpm lint` 0 (3 of 6 tasks from turbo's cache, inputs unchanged), `pnpm typecheck` 0 (3 of 6 cached), `pnpm test` 0 (shared 75 files and 1,136 tests, web 47 and 365, api unit 17 and 124, db 5 and 18, providers 1 and 11), `pnpm test:api` 0 in 186 s (api 37 files and 694 tests, db 8 and 59, providers 1 and 2), `pnpm test:hooks` 0 (15) |
| 5 | `heavy.sh bash settings/e2e-demo.sh all` (B18) | build 5 s; exit 0 after 594 s. Flooring **445 passed, 7 skipped** in 522 s (the skips: three installation tests and two stock-adjustment tests behind switched-off features, the tax-jurisdiction report behind its switch, and the notifications test's own data skip; none of those files changed on this branch); hr **67 passed** in 66 s. Ports free after |
| 5 | `heavy.sh flows/api-e2e.sh settings-all-final --build` (after the last product change, `2be13e0`'s tree; nothing but docs changed since) | builds 12 s; exit 0, **49 passed** of 49 in 213 s, no skip, no flake (E1 to E3 and F1 to F7 among them). Ports free after |
| 5 | the probe copied back; `heavy.sh flows/api-e2e.sh settings-probe-2 -- tests/e2e-api/zz-settings-probe.spec.ts`; the probe removed; `git status --short` | 1 passed: Summit's four sections at their seeded values; tree clean |

### Mutations (stage 2, on the committed change)
Each made one change, ran its tests, and was restored (`git diff --quiet` true after each). Caught means every command exited non-zero with the expected test failing.

| # | Mutation | Caught by |
| --- | --- | --- |
| M1 | the payments PUT's `stepUp.require` removed | A5: "owner: expected [ 200, undefined ] to deeply equal [ 403, 'step_up_required' ]" |
| M2 | the step-up moved before the content check | A5: "expected [ 403, 'step_up_required', … ] to deeply equal [ 400, 'invalid_request', … ]" |
| M3 | `requireWholeCompany` returns at once | A9: "expected 200 to be 403" |
| M4 | the number format answered as the stored record | A1 flooring owner: the answer's `numbers` is not the wire list |
| M5 | `readableSections`' module test removed | R10 (HR owner gets payments); A1 hr owner |
| M6 | `@RequireModule` removed from the payments PUT | A5: "expected [ 403, 'step_up_required' ] to deeply equal [ 403, 'module_not_enabled' ]" |
| M7 | `requireFeature` removed from the numbers PUT | A8: "numbers: expected 200 to be 404" |
| M8 | `MONEY_TEXT` takes `12.` | R9, A5 and D1 ("promise resolved … instead of rejecting") |
| M9 | the decimals range check removed | R3: "expected null to be 'Choose between 0 and 4 decimals for M…'" |
| M10 | the save's audit entry removed | A3 flooring owner: "one audit entry per save: expected [] to have a length of 1" |
| M11 | `.strict()` removed from the profile body | A4: the unknown top-level field answered 200 |
| M12 | `settingsFromAnswer` takes every key of the answer | W2: the answer's `localization` replaced DemoStore's |
| M13 | DemoStore's scope check removed | D2: "promise resolved … instead of rejecting" |
| M14 | `updateSettings` routes every section to the API | W6: a localization save reached the API |
| M15 | the save's `FOR UPDATE` removed | A14, after B12 |
| M16 | `saveSection`'s catch removed | SF2: "promise rejected … instead of resolving" (and SF3) |
| M17 | `readableSections`' readers test removed | R10; A1 flooring warehouse |
| M18 | `profileFor` returns the profile unchanged | R11; A1 flooring sales: "expected '33-4974049' to be ''" |
| M19 | the numbers body's kinds-once check removed | A3b, after B13 |
| M20 | the numbers PUT takes `settings.company.manage` | A0: "expected [ 'settings.company.manage' ] to deeply equal [ 'settings.numbers.manage' ]" (and A3) |
| M21 | the equal-prefix rule removed | R4; A5 |
| M22 | DemoStore's module check removed | D7: Harbor's Owner saved payments |
| M23 | `readableSections`' product-switch test removed | R10; A8: "expected { … } to not have property 'payments'" |
| M24 | review round 2: `check(expenseSettingsProblem(expenses))` removed from the expenses PUT | A7b: "12.: expected [ 200, undefined, undefined ] to deeply equal [ 400, 'invalid_request', …(1) ]" (survived round 1's tests) |
| M25 | review round 2: `requireWholeCompany(access)` removed from the profile PUT | A9: "profile: expected [ 200, { …(7) } ] to deeply equal [ 403, { code: 'forbidden', …(1) } ]" (survived round 1's tests) |
| M26 | review round 2: the same call removed from the numbers PUT | A9 "numbers: expected [ 200, … ]" (round 1's A9 caught it too) |
| M27 | review round 2: the same call removed from the payments PUT | A9: "payments: expected [ 403, …(1) ] to deeply equal [ 403, { code: 'forbidden', …(1) } ]" (the step-up answered instead; survived round 1's tests) |
| M28 | review round 2: the same call removed from the expenses PUT | A9: "expenses: expected [ 200, …(1) ] …" (survived round 1's tests) |
| M29 | review round 2: `.strict()` removed from the payments body | A4b: "expected [ 403, 'step_up_required' ] to deeply equal [ 400, 'invalid_request' ]" (survived round 1's tests) |
| M30 | review round 2: `.strict()` removed from the expenses body | A4b: "expected [ 200, undefined ] …" (survived round 1's tests) |
| M31 | review round 2: the numbers body's top-level `.strict()` removed | A4b (survived round 1's tests) |
| M32 | review round 2: the decimals entry's `.strict()` removed | A4b (survived round 1's tests) |
| M33 | review round 3: `saveNumbers` compares with `defaultNumberSettings()`, not the stored row | A15: "(en-US, USD)", expected 400 to be 200 (survived round 2's tests) |
| M34 | review round 3: `SettingsService.current` always answers the defaults | A15, the same (survived round 2's tests) |
| M35 | review round 3: DemoStore compares the number format with `defaultNumberSettings()` | D8b: the en-US save resolved instead of being refused (survived round 2's tests) |

## Outcome
Stages 0 to 4 are done, and the full checks and both whole e2e suites pass. No stop-and-ask item came up: no control-database write, no Zod in packages/shared, no seeding at provisioning, and no table, migration or dependency change. Nothing was red, so stage 3 needed no spec fix and has no commit of its own.

| Commit | Subject |
| --- | --- |
| `230a4d4` | docs(settings): plan for Settings part 1 on the API [skip ci] |
| `f3530b6` | feat(api): Settings part 1, GET /settings and PUT for profile, numbers, payments and expenses [skip ci] |
| `eb66bf3` | feat(web): Settings part 1 reads and saves its sections through the API; a refused save says why [skip ci] |
| `1b30ddc` | test(api): A14 holds the settings row so the save's row lock is pinned [skip ci] |
| `2be13e0` | test(e2e): Settings part 1 specs, red on GET /company's head; the green run is stage 3 [skip ci] |
| `d043fc7` | docs(sessions): Settings part 1, stages 0 to 2: red and green runs, mutations, decisions [skip ci] |
| `215998b` | docs: Settings part 1 on the API (ADR 0059, api-contract, spec, delta, data model, FEATURES) [skip ci] (the spec itself changed in `230a4d4`; this commit's subject follows the plan) |
| this commit | docs(sessions): Settings part 1 outcome, full checks and both suites [skip ci] |

**Left for the orchestrator:** `/review`; a fresh read-only security-reviewer on `origin/feat/web-company-from-api...HEAD` focused on the PR body's "Security-review focus" (no packages/db change, so no schema-reviewer); `/handoff` with STATUS and BRANCHES from "For STATUS" above (that commit carries no `[skip ci]`); then, in queue order after #45 to #50 have merged and `origin/main` is merged in, ready, CI and the self-merge. The PR body was refreshed with these results.

## Review round 1
One finding, confirmed by a skeptic; fixed in `ba3bf41`.

**The finding (should_fix, correctness):** a refused Payments value still cost an authenticator code on screen. `SettingsForm`'s Save opened the step-up dialog at once, and `StepUpDialog` spends the code on `POST /auth/step-up` before `onConfirm` sends the PUT. So "12." in "Only above this amount" spent a code, then got the API's 400. The code can't be used again, so the corrected save waited up to 30 s for the next one, and the repeat counted towards the 5-failure lockout. The spec and ADR 0059 D5 promised the opposite. The API's own order (content rules, then the step-up) only protected direct API calls. E2 step 2 and S1 had encoded the costly path.

**The fix:**
- `save-section.ts`: a pure `nextSaveStep(draft, problem, stepUp, notify)`. It runs the section's shared rule first. A refused draft shows the rule's words in a toast and returns `"refused"`, so there is no dialog and no request. Otherwise it returns `"step-up"` or `"save"`.
- `SettingsForm` takes an optional `problem` and calls `nextSaveStep` from Save.
- Payments passes `paymentSettingsProblem`; Expense approval passes `expenseSettingsProblem`. These are the rules the API and DemoStore already run, with the same words.
- Spec "The step-up" and ADR 0059 D5 and section 6 ("Four screen edits") now say how the promise is kept, on screen and on the API.

**Tests (each red before the fix, green after):**
- SF4 and SF5 (`save-section.test.ts`): red with "nextSaveStep is not a function".
- Demo S1: Save shows the refusal with no dialog. Red at the message ("element(s) not found": the dialog had opened instead).
- Api-mode E2 step 2: the page sends no PUT and no `POST /auth/step-up`, the message shows, the dialog stays closed and the draft stays. A direct PUT of the same body answers 400 `invalid_request` with the same words before any code. Red at the message.
- Api-mode E3 step 3: a refused expense amount shows its words and sends no PUT. Red: `["PUT"]` was sent.

**Decisions and why (each the safest option):**
- **R1-1, fix the screen rather than reword the docs.** Keeping the promise means a refused value wastes no code and doesn't count towards the lockout. The access editor already works this way (spec "One permission matrix"; ADR 0053 item 17).
- **R1-2, a pure `nextSaveStep` rather than logic inside the component.** The web unit suite has no DOM renderer (it uses `renderToStaticMarkup`), so a pure step is what a unit test can pin. The screen behaviour is pinned by S1, E2 and E3.
- **R1-3, Expense approval passes its rule too** (the finding's suggestion). It has no step-up, so this only saves a refused request, with the same words. Company profile already checks in the browser with the same patterns and messages (its own form). Number format's steppers can't go out of range, and no page edits its locale or currency. Neither gets `problem`.
- **R1-4, a toast, not a disabled Save (`canSave`).** A disabled button doesn't say why; the toast gives the shared rule's words, as the access editor does.
- **R1-5, E2 step 2 keeps a direct PUT.** The api-mode e2e still pins the API's order (400 before any code) and that its words match the page's.
- **R1-6, no shared or API code changed**, so the full checks were not re-run (the task's rule). The API controller's comment about its order is still true and was left alone. Ran instead: web lint, web typecheck, the whole web unit suite, the api-mode set with a rebuild, and the demo subset with a rebuild.
- **Residual:** for these four sections, the on-screen path where the API refuses a settings save is now pinned only by SF1 to SF3. S1 and E2 used to drive it. Payments' and Expense approval's page rules equal the API's, so that path now runs only if a newer API rule differs. Company profile's refusals still reach `saveSection` that way.
- **Tooling note:** the push guard reads git's stash subcommand that saves changes as a push and blocks it. For the red e2e runs, the new unit file was set aside by copy instead, because the Next build typechecks `tests/unit`.

| Command (all through `heavy.sh`) | Result |
| --- | --- |
| `pnpm exec vitest run tests/unit/save-section.test.ts` (before the fix) | red as expected: SF4 and SF5 "nextSaveStep is not a function"; 3 passed |
| `settings/e2e-demo.sh review1-red` (demo build, S1, product code unchanged) | build 4 s; S1 failed in 16 s at the refusal message (the dialog opened instead). Ports free after |
| `flows/api-e2e.sh settings-review1-red --build -- tests/e2e-api/settings.spec.ts` | builds 12 s; exit 1 after 41 s: E2 failed at the message, E3 failed with `["PUT"]` sent, E1 passed; clean-ups quiet. Ports free after |
| `pnpm exec vitest run tests/unit/save-section.test.ts` (after) | 5 passed |
| `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm exec vitest run` (web) | clean, clean, 47 files and 367 tests passed (19 s together); Prettier clean on the changed files |
| `flows/api-e2e.sh settings-review1 --build -- settings, invoices, purchasing, expenses, company, company-standing, login` | builds 6 s; exit 0, **18 passed** in 67 s (E1 8.0 s, E2 8.1 s, E3 4.2 s). Ports free after |
| `settings/e2e-demo.sh review1` (demo build, the stage 3 subset) | build 12 s; flooring **271 passed, 1 skipped** in 340 s (S1 1.0 s; the skip is `notifications.spec.ts`'s own, as in stage 3); hr **7 passed** in 6 s. Ports free after |

| Commit | Subject |
| --- | --- |
| `ba3bf41` | fix(web): a refused Payments or expense value says why before any step-up, so it never costs a code [skip ci] |
| this commit | docs(sessions): Settings part 1, review round 1 [skip ci] |

## Review round 2
Two findings, both should_fix and both confirmed by a skeptic. Neither changed runtime behaviour: the first is API test coverage, the second is module specs and one comment.

**Finding 1 (correctness): the API tests left some route-level protections unproved.** The controller was correct, but the suite didn't pin three things:
- the expenses PUT's content rule: no API test sent a refused amount;
- data scope on three of the four PUTs: A9 covered only numbers, and M3 mutated only the shared helper;
- strict bodies outside the profile: no unknown field was sent to the other three routes.

**The fix (tests only, in `apps/api/test/settings.int.test.ts`):**
- **A7b:** `PUT /settings/expenses` with "12.", "-5", "1e3", "abc" and "12.345", each with approval on and off, answers 400 `invalid_request` with `EXPENSE_MESSAGES.approvalThreshold`. The number 1000 answers 400. The row and the audit count are unchanged.
- **A9 now loops over all four sections.** For each one, a branch-scope role holding the section's key gets 403 with `SETTINGS_SCOPE_MESSAGE`; the row and the audit count are unchanged. After that:
  - the role is set to scope `all`;
  - Payments now answers `step_up_required`, which proves the scope refusal came before any step-up;
  - after a step-up, Payments saves;
  - the other three save at once.
- **A4b:** one unknown field per section, plus one inside a number-format decimals entry. Each answers 400 before any step-up, and nothing is stored or audited.

**Finding 2 (correctness): seven module specs named the deleted `settingsPermissions` or `SETTINGS_PERMISSIONS`.** The affected specs were sales.md, purchasing.md, finance-expenses.md, hr.md, inventory.md, meetings.md and notifications.md. Separately, `paymentSettingsProblem` cited a "sales.md Appendix A" that doesn't exist.

**The fix (docs, plus one comment):**
- Each of the seven rows now names `SETTINGS_SECTIONS.<section>` in `packages/shared/src/settings/sections.ts`. The Payments and expense rows also name their PUT route and data scope `all`, and the Payments rows name the step-up.
- sales.md rule 31 and its field table now state the amounts rule (`MONEY_TEXT` or empty), the prefix pattern, the distinct prefixes compared without case, the step-up after those checks, and that the same settings govern supplier payments (purchasing.md rule 28).
- finance-expenses.md rule 4 and its field table now say that the threshold is empty or `MONEY_TEXT`, that the rule runs even while approval is off, and that there is no step-up.
- The purchasing.md row says the one rule governs customer and supplier payments.
- The JSDoc of `paymentSettingsProblem` now cites "sales.md rules 28 and 31". This log's Inputs line made the same mistake and is corrected too.

**Decisions and why (each the safest option):**
- **R2-1, red before the fix, as mutations.** Finding 1 is about missing tests, so no product test could fail before the fix. The proof is mutants instead. Nine route-level mutants (M24 to M32: each route's own call removed, one at a time) were run against round 1's tests, with the old test file put back for that run. Eight survived; M26, numbers' scope, was already caught by A9. Against the new tests, all nine are caught. M3 and M11 are still caught.
- **R2-2, A9 sends each section's stored value back.** So the save allowed at the end changes nothing that a later case reads, and the test works when run alone.
- **R2-3, A7b goes beyond the finding's list.** It adds "abc", the reviewer's case that would make decimal.js throw on every new expense, and "12.345". Each runs with approval on and off, because the rule checks the threshold either way (D21).
- **R2-4, A4b also covers the profile and one decimals entry.** That makes it one table per route, and it pins the entry's `.strict()` (M32). Zod strips unknown keys by default, so a dropped `.strict()` would store nothing extra. The test pins the 400 contract that api-contract.md states.
- **R2-5, the optional spec lines were taken.** These are the finding's own fix. They are worded from the code (`MONEY_TEXT`, `DOCUMENT_PREFIX_TEXT`, D21) and only describe what both modes already do, so the plan of record is unchanged and needs no blueprint-delta row.
- **R2-6, left as history:** ADR 0059 and `packages/shared/test/settings-sections.test.ts` name `SETTINGS_PERMISSIONS` as the map that was replaced. That is history, not a pointer.
- **R2-7, out of scope:** the code's other "spec Appendix A" cites (about 40 files) mean the blueprint's Appendix A, which exists, so they stay. One older test names "sales.md Appendix A". It predates this branch, so it is a new follow-up in "For STATUS" and was not edited here.
- **R2-8, what was re-run.** Shared and API code changed (a comment, and the API test), so the full checks were re-run, as the task's rule requires.
  - The api-mode settings spec was rebuilt and re-run, because `packages/shared` is in the build.
  - The demo e2e was not re-run: no web file changed, and the only shared change is a comment.

| Command (all through `heavy.sh`) | Result |
| --- | --- |
| `pnpm --filter api exec vitest run --project integration test/settings.int.test.ts` | 42 passed (40 before, plus A4b and A7b; A9 rewritten) in 17 s |
| round 1's test file put back from `HEAD~1`; `python3 settings/mutate.py M24 … M32`; the test file restored with `git checkout --` | 8 survived (exit 0, 40 of 40 passed each), M26 caught by the old A9; tree clean after |
| `python3 settings/mutate.py M24 … M32` on the committed new tests | 9 of 9 caught, each file restored (messages in the mutation table) |
| `bash settings/full.sh` | exit 0 in 223 s: `pnpm lint` 0, `pnpm typecheck` 0 (3 of 6 cached each), `pnpm test` 0 (shared 75 files and 1,136 tests, web 47 and 367, api unit 17 and 124, db 5 and 18, providers 1 and 11), `pnpm test:api` 0 (api 37 files and 696 tests, db 8 and 59, providers 1 and 2), `pnpm test:hooks` 15 of 15 |
| `python3 settings/mutate.py M3 M11` | both still caught: M3 at A9 (profile first), M11 at A4 and A4b |
| `flows/api-e2e.sh settings-review2 --build -- tests/e2e-api/settings.spec.ts` | builds 13 s; exit 0, **3 passed** in 27 s (E1 8.6 s, E2 8.3 s, E3 4.6 s). Ports free after |

| Commit | Subject |
| --- | --- |
| `e0843b3` | test(api): every settings route proves its own scope, strict body and, for expenses, its content rule [skip ci] |
| `4d05a9d` | docs(specs): settings rows point at SETTINGS_SECTIONS; Payments and expense approval rules written down [skip ci] |
| this commit | docs(sessions): Settings part 1, review round 2 [skip ci] |

## Review round 3
One finding, should_fix and confirmed by a skeptic. It was about test coverage only, so no runtime behaviour changed.

**Finding (correctness): the API tests didn't pin rule 12's wiring.** `saveNumbers` compares the sent locale and currency with `SettingsService.current(tenant, "numbers")`, which returns the stored row or, when there is none, the defaults. Every API test company stored, or fell back to, en-US/USD, which is also the literal default. A mutant that compared with `defaultNumberSettings()` instead of the stored row would therefore pass A2, A3, A11 and A15. Only the shared units (R3, with an en-CA current value) pinned the rule itself. DemoStore's D8 had the same gap, because Summit is en-US too.

**The fix (tests only):**
- **A15** (`apps/api/test/settings.int.test.ts`) now gives otherco a stored en-CA format, written behind the API's back.
  - A save that keeps en-CA answers 200 and is stored.
  - A save that sends en-US answers 400 `invalid_request`, naming "(en-CA, USD)". The row is unchanged.
- **D8b** (`apps/web/tests/unit/demo-settings.test.ts`) is the finding's optional demo case. It opens Summit with an en-CA format through a hoisted override of `loadCompanyFixtures`, the same pattern as the file's `OFF` switch override, reset after each test.
  - A save that sends en-US is refused with "(en-CA, USD)".
  - A save that keeps en-CA is stored.

**Decisions and why (each the safest option):**
- **R3-1, red before the fix, as mutations.** The product code was already correct, so no product test could fail before the fix. The proof is mutants instead, as in R2-1:
  - **M33:** the controller compares with `defaultNumberSettings()`.
  - **M34:** `SettingsService.current` always answers the defaults.
  - **M35:** DemoStore compares the number format with `defaultNumberSettings()`.

  All three survived round 2's tests, which were put back from `HEAD~1` for that run. All three are caught by the new A15 and D8b.
- **R3-2, otherco and not a new company.** Provisioning a sixth company costs a database and about 10 s.
  - otherco is the suite's "another company", and A15 runs after A11, its only other user.
  - A15 writes the en-CA row itself, so the case still works when run alone (`-t A15`).
- **R3-3, both directions.** Keeping en-CA pins that the stored row is accepted. Sending en-US pins that the default is refused. Either one alone would catch M33 and M34, but the pair also pins the message's "(en-CA, USD)".
- **R3-4, the demo case overrides the loader and leaves Summit's fixture alone.** All three demo companies are en-US. Changing a fixture would change the demo for everyone. The override is scoped to D8b by a hoisted value that `afterEach` clears. DemoStore keeps its overlay in memory under Node (no `localStorage`), so nothing leaks into later cases.
- **R3-5, what was re-run.** API and web test code changed, so the full checks ran.
  - No product, shared or web source file changed, so the api-mode and demo e2e were not rebuilt or re-run. Their inputs are byte for byte the same as round 2's run.
  - No STATUS, BRANCHES or blueprint-delta change: this round only adds tests.

| Command (all through `heavy.sh`) | Result |
| --- | --- |
| `pnpm --filter web exec vitest run tests/unit/demo-settings.test.ts` | 10 passed (9 before, plus D8b) |
| `pnpm --filter api exec vitest run --project integration test/settings.int.test.ts` | 42 passed (A15 extended) in 17 s |
| round 2's two test files put back from `HEAD~1`; `python3 settings/mutate.py M33 M34 M35`; the test files restored with `git checkout --` | 3 survived: M33 and M34 at 42 of 42, M35 at 9 of 9. Tree clean after |
| `python3 settings/mutate.py M33 M34 M35` on the committed new tests | 3 of 3 caught, each file restored: M33 and M34 at A15 ("(en-US, USD)": expected 400 to be 200), M35 at D8b ("promise resolved instead of rejecting") |
| `bash settings/full.sh` | exit 0 in 218 s. `pnpm lint` 0 and `pnpm typecheck` 0 (api and web ran, 4 of 6 cached each). `pnpm test` 0: shared 75 files and 1,136 tests, web 47 and 368, api unit 17 and 124, db 5 and 18, providers 1 and 11. `pnpm test:api` 0: api 37 files and 696 tests, db 8 and 59, providers 1 and 2. `pnpm test:hooks` 15 of 15 |

| Commit | Subject |
| --- | --- |
| `c684d00` | test(settings): the locale rule is pinned to the company's stored format on the API and in the demo [skip ci] |
| this commit | docs(sessions): Settings part 1, review round 3 [skip ci] |

## Review round 4
One finding, should_fix and confirmed by a skeptic. DemoStore refused in a different order from the API, so a few saves got different words in the two modes. Both modes refused, so nothing was loosened.

**Finding (correctness): DemoStore checked the keys before the module.**
- **The API.** `permissionDecision` (`apps/api/src/core/access/permission.guard.ts`) returns `module_not_enabled` before `forbidden`. The Payments and Expenses PUTs carry `@RequireModule("core")`.
- **DemoStore.** `updateSettings` called `assertCan(rule.keys)` first.
- **The effect in Harbor (HR Suite, no `core`):**
  - A Payments save by the HR manager got "Your role does not allow this…". The API answers "This part of the product is not switched on for your company."
  - An Expenses save by anyone got the role message, the Owner included. `effectivePermissions` drops the `core` key `settings.expenses.manage`, so no one in Harbor holds it.
- **The docs.** Five statements claimed the API's order: the store's JSDoc, ADR 0059 section 7, spec rule 7, the spec's Real build bullet and the blueprint-delta row. The plan (plan-final.md S9) and this log's plan had the same mistake about which order the API uses.

**The fix:**
- **`apps/web/src/lib/api/demo/store.ts`:** `updateSettings` now checks the module, then the keys (`assertCan`), then the switch, scope and content rules. The JSDoc names that order and `permissionDecision`.
- **D7b** (`apps/web/tests/unit/demo-settings.test.ts`) checks that each of these saves gets the module's words:
  - Harbor's Owner saving Expenses.
  - Harbor's HR manager (`hb-usr-02`) saving Payments.
  - Harbor's HR manager saving Expenses.

  D7 now uses the same `MODULE_REFUSAL` constant.
- **Docs now name the real order** (module, key, switch, scope, content):
  - ADR 0059: section 7, and section 3's guard cells for Payments and Expenses.
  - The spec: rule 7, and the Real build bullets "Which pages save on the API" and "The demo".
  - `docs/api-contract.md`: the two route rows.
  - The blueprint-delta row.
  - This log's plan line, the test map, and the "For STATUS" Done entry and Checks.

**Decisions and why (each the safest option):**
- **R4-1, the code's order wins over the plan's words.** The plan said DemoStore uses "the API's order: keys, then module", which got the API's order wrong. Its intent was one order and the same words in both modes, so the plan of record is unchanged and needs no new blueprint-delta row. The existing row was corrected instead.
- **R4-2, the module comes first for every section, not only Payments and Expenses.**
  - `permissionDecision` applies this order to every route.
  - Profile, numbers and the other `platform` sections have a module every company holds, so nothing changes for them.
  - For `hr` and `meetings` (still browser-only), a company without the module now gets the module's words, which is what their API routes will answer.
- **R4-3, `assertCan` is kept.** Inlining the key check would save one in-memory `granter` call, but it would copy the role message into a second place.
- **R4-4, red before the fix.** D7b failed at its first assertion (Harbor's Owner, Expenses) with the role message. The fix is the reordering itself, so the code before the fix is the mutant D7b catches. D3b (keys before the switch) is unchanged and still passes, which pins that the module check moved only ahead of the keys.
- **R4-5, what was re-run.** One web product file changed (`store.ts`), so:
  - web lint, typecheck and every web unit test ran;
  - api-mode `settings.spec.ts` ran on a fresh build;
  - the demo subset ran again, because DemoStore's `updateSettings` runs on every section's save.

  No shared or API code changed, so `pnpm test:api` and the shared suites were not re-run. A5 already pins the API's module-first answer for every Harbor role.
- **R4-6, not raised again:** Q10 (the Accountant may loosen the controls they work under) and audit-log readers seeing settings values. This finding gives no new reason for either.

| Command (all through `heavy.sh`) | Result |
| --- | --- |
| `pnpm --filter web exec vitest run tests/unit/demo-settings.test.ts`, before the fix | exit 1: D7b failed, "expected … 'This part of the product is not switc…' but got 'Your role does not allow this. Ask an…'"; 10 passed |
| the same, after the fix | 11 passed |
| `prettier --check` on the six changed files (not through the lock) | clean |
| `bash settings/checks.sh r4 web:lint web:typecheck web:test` | 21 s. lint 0, typecheck 0, web units 47 files and 369 tests |
| `flows/api-e2e.sh settings-review4 --build -- tests/e2e-api/settings.spec.ts` | builds 8 s; exit 0, **3 passed** in 25 s (E1 8.6 s, E2 7.5 s, E3 4.2 s). Ports free after |
| `bash settings/e2e-demo.sh review4` (a new mode: the stage 3 subset) | build 12 s; flooring **271 passed, 1 skipped** in 324 s (S1 1.0 s; the skip is `notifications.spec.ts`'s own, as before); hr **7 passed** in 5 s. Ports free after |

| Commit | Subject |
| --- | --- |
| `517b805` | fix(settings): DemoStore checks the module before the keys, as the API does [skip ci] |
| this commit | docs(sessions): Settings part 1, review round 4 [skip ci] |
