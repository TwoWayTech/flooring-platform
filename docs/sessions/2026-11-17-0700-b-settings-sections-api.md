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
  - docs/product-spec/sales.md Appendix A (payments: approval, write-off, numbering) and docs/product-spec/purchasing.md (supplier payments use the same rule).
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
- DemoStore's `updateSettings` checks the same keys, module, switch, scope and content rules in the API's order.

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
- **B18, the whole demo suite** (plan stage 5 step 2) is not part of this run's assignment (stages 3 and 4, full checks and the whole api-mode suite). Stage 3's demo subset (every spec that saves a settings section, plus a11y, responsive, shell and login, both products) covers this branch's demo changes; the whole demo suite is left to the orchestrator.

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
| Module below; ceiling below | A5 (HR), A7 (HR), A9b, D7; A10; M6, M22 |
| Company-wide scope (API and DemoStore) | A9, D2; M3, M13 |
| Switch off → 404; DemoStore's order | A8, D3, D3b; M7 |
| Strict bodies and shared content rules (both modes) | A4, A5, A15, R2 to R5, D1, D8, S1; M8, M9, M11, M21 |
| Payments step-up after the content checks | A5, E2, S1; M1, M2 |
| A refused save is shown and the draft kept | SF1 to SF3, S1, E2 step 2; M16 |
| The server acts on the saved rules (customer and supplier payments, write-off, numbering, expenses) | A6, A7 |
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
- **"Done": a Settings part 1 entry** (on merge): "Settings part 1 on the API (queue item 2, task 2), PR #51 (ADR 0059). In api mode `GET /settings` gives the company profile and number format to every member (the EIN only to the profile's manager), the payment rules to people who see invoices or manage payments, and expense approval to its managers, each by module and product switch, with the number format's decimals as a list; `PUT /settings/profile`, `/numbers`, `/payments` (with a step-up) and `/expenses` save them with their own key and module, company-wide scope, strict bodies and shared rules, under a row lock with one audit entry; the web merges these sections over DemoStore's and routes their saves, so the shell, documents, the payment sheet and Update status follow the server, and the server's customer and supplier payments, write-offs and expenses apply what the pages save; a refused settings save now shows its message on every settings page. DemoStore applies the same keys, module, switch, scope and content rules, in the same order. Other sections stay in the browser until their part. No schema change, migration or dependency; nothing in core, providers, packages/db or the web's session. Checks: …" (filled in at the end).
- **Checks so far (stages 0 to 2):** shared 75 files and 1,136 tests; api unit 17 files and 124; web 47 files and 365; lint and typecheck clean in shared, api and web; `settings.int.test.ts` 40 passed, and with `permissions`, `isolation`, `accounting`, `invoices`, `payables`, `expenses`, `users` and `company` 169 passed in 9 files; 23 of 23 mutations caught. E1 to E3 and S1 were run red only; stage 3 runs them green. CI could not run (Actions blocked by billing).
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
  - **The Payments page says "customer payments",** but its two-person check also governs supplier payments, in both modes. Reword the page and the spec in a later screen pass.
  - **`PUT /settings/accounting` takes `settings.payments.manage` with no step-up,** although it decides where money posts. Add one, and decide whether its scope message should be the settings one (Q10's neighbour).
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

## Left for the next stages
Stage 3 (api-mode green runs of `settings.spec.ts` with invoices, purchasing, expenses, company, company-standing and login; the run again on the dirty database; the flows; the demo subset), stage 4 (ADR 0059, api-contract.md, the delta row, data-model.md, FEATURES.md with the features sync test, table 7.8) and stage 5 (full checks, both whole suites, `/review`, the security review, handoff) are the orchestrator's next steps. The e2e specs E1 to E3 have only been run red (at their heal); their first green run is stage 3.
