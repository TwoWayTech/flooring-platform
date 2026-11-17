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
(Filled in as the build goes.)

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
The orchestrator applies these at handoff (this session leaves docs/STATUS.md and docs/BRANCHES.md alone). Re-read STATUS first; anchor on the quoted text. This branch's draft PR number is filled in below once it exists.

- **"In progress" and "Next three tasks" item 2:** "then Settings" gains "(part 1 of 6: draft PR #<n>, `feat/settings-sections-api`, stacked on #50)"; the bell and the Outbox follow Settings' parts, or the owner's order (Q8).
- **"Done": a Settings part 1 entry** (on merge): "Settings part 1 on the API (queue item 2, task 2), PR #<n> (ADR 0059). In api mode `GET /settings` gives the company profile and number format to every member (the EIN only to the profile's manager), the payment rules to people who see invoices or manage payments, and expense approval to its managers, each by module and product switch, with the number format's decimals as a list; `PUT /settings/profile`, `/numbers`, `/payments` (with a step-up) and `/expenses` save them with their own key and module, company-wide scope, strict bodies and shared rules, under a row lock with one audit entry; the web merges these sections over DemoStore's and routes their saves, so the shell, documents, the payment sheet and Update status follow the server, and the server's customer and supplier payments, write-offs and expenses apply what the pages save; a refused settings save now shows its message on every settings page. DemoStore applies the same keys, module, switch, scope and content rules, in the same order. Other sections stay in the browser until their part. No schema change, migration or dependency; nothing in core, providers, packages/db or the web's session. Checks: …" (filled in at the end).
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
- **Owner questions:** a new block, "Owner questions (PR #<n>, Settings part 1; none blocks)", with Q1 to Q10 above.
- **BRANCHES:** a `feat/settings-sections-api` row: "B (Claude)", "Queue item 2, task 2, Settings part 1 of 6: company profile, number format, payments and expense approval on the API (main checkout; stacked on #50)", "Draft" then the state at handoff, the PR, "see the branch".

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `settings/logs` folder, and api-mode runs in `flows/logs`.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `git fetch origin`; `git log -3 origin/feat/web-company-from-api`; `merge-base --is-ancestor origin/fix/sales-quote-resave origin/feat/web-company-from-api`; `gh pr list --head feat/web-company-from-api` | GET /company's newest commit is its handoff (`6dbd03c`); it holds B6; one PR, #50 (draft); the tree was clean; main is `d0e4e20` |
| 0 | `git switch -q --no-track -c feat/settings-sections-api origin/feat/web-company-from-api` | branch made at `6dbd03c` |
| 0 | `docker ps`; ports 3000 and 4000 | the compose PostgreSQL on 5432 and the api e2e one on 5433 up; both ports free |
