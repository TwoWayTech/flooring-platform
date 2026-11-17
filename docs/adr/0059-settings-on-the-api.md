# ADR 0059: Settings on the API (part 1: company profile, number format, payments, expense approval)

- **Status:** part 1 accepted, 2026-11-17, on branch `feat/settings-sections-api` (draft PR #51, stacked on #50 and through it on #49, #48, #47, #46 and #45; it merges after them). It is item 2, task 2 of the owner's queue of 2026-11-16. The owner was asleep, so the safest option was taken wherever something was open; each one is listed below and in "For the owner". ADR 0058 stays reserved by the paused whole-product check. Session log docs/sessions/2026-11-17-0700-b-settings-sections-api.md.
- **Context:**
  - Week 5's Settings module (docs/real-build-plan.md, module order row 4) was never built. The API has a company `settings` table with one row per group (`settings_group_uidx`), seeded for Summit, and its modules act on those rows: customer payments, write-offs and supplier payments read `payments` (`loadPaymentSettings`), expenses read `expenses` (`loadExpenseSettings`), and emails and refusal texts read `numbers` (`loadMoneyFormat`). The only settings route was ADR 0040's `GET/PUT /settings/accounting`, which has no screen.
  - **The silent no-op.** `getSettings()` and `updateSettings()` were not in `API_METHODS`, so in api mode every Settings page read and saved DemoStore's copy in the browser. An Accountant who turned the two-person check on, changed the write-off limit or set expense approval saw "Payments saved" while the server kept applying its old rows, for money in (customer payments, write-offs) and money out (supplier payments).
  - **A reserved name.** `unitCost` is in `SENSITIVE_FIELDS` (product cost, ADR 0031), and the number format's `decimals` record has a `unitCost` kind. The global interceptor strips it at any depth for anyone without product cost, the HR Suite Owner included (that key is a `core` key).
  - STATUS: B6's note that tax rates are numeric(18,8) and answered raw (part 3); "Settings default inputs keep a bare point"; "When `PUT /settings/:section` moves to the API, it must refuse `overtimeRuleProblem`"; "Settings at provisioning"; GET /company's D12 (the shell's number format and branding are still DemoStore's) and its note that the time zone has two copies (`tenants.time_zone` and `localization.region`).
  - Precedents: `StepUpService` (roles, users, support grants, import; ADR 0034 and 0057), `AuditService.record` in the caller's transaction (ADR 0031), `AccountingService.save` (insert with `onConflictDoUpdate` on the group), `requireFeature` (`sales-common.ts`), the transport's re-read after every answered write (ADR 0051, 2026-11-16), and GET /company's shell query (ADR 0051 "GET /company").

Code comments cite this ADR by label: `D1` to `D24` are the decisions below, and `Q1` to `Q10` the owner questions.

## Decision

### 1. Scope: six parts, part 1 first (D1)
All of Settings is too big for one review: nine sections, the locations collection, versioned tax tables, a control-database time zone and branding row with a logo upload, and the payroll lock. Part 1 is the settings read plus four plain JSON sections with no side effects: **Company profile** (printed on every document), **Number format** (every `<Num>` and the money in emails), **Payments** (the two-person check, the write-off limit and the prefixes, which customer and supplier payments read on the server) and **Expense approval**. It builds the module, the read, the write pattern, the shared rules table and the web's served-sections switch that later parts extend, and it ends the silent no-op on two fraud controls.

### 2. Shared (`packages/shared/src/settings`, no new dependency; D8)
- **`sections.ts`**
  - `SETTINGS_SECTIONS`: per section, the keys that save it (any one), the feature switch of the page that saves it, the module whose absence refuses the save, and the audit label. It replaces DemoStore's `SETTINGS_PERMISSIONS` and `SETTINGS_LABELS`; the API's decorators spread its keys and module (D19, CLAUDE.md rule 4). Payments is `core` although its key is a `platform` key: the payments feature belongs to Flooring, and `/settings/accounting` takes the same key with module `core`. The two `localization` keys are the demo's whole-section rule; API routes go per tab (parts 2 and 3).
  - `API_SETTINGS_SECTIONS = ["profile", "numbers", "payments", "expenses"]` and `isApiSettingsSection`: the sections the API serves. A later part adds its section here and to `SETTINGS_READERS`, and the web routes it with no other change.
  - `SETTINGS_READERS` and `readableSections`: who reads which section (D3); `profileFor`: the EIN only for `settings.company.manage`; `SETTINGS_SCOPE_MESSAGE` ("Company settings cover the whole company.").
  - The number format's wire (D6): `NumberSettingsWire` with `decimals: { kind, places }[]`, `numbersToWire` (kinds in `NUMBER_KINDS` order) and `numbersFromWire` (tolerant, for the web's read only: an unknown kind is dropped, a missing or non-integer one takes its default). `SettingsAnswer`.
- **`section-rules.ts`**: the content rules, with the words both modes show. `companyProfileProblem`, `numberSettingsProblem(next, current)` (each kind once and in range, the negative style, compact dashboards, and the locale and currency unchanged: D12), `paymentSettingsProblem` (amounts empty or `MONEY_TEXT`, prefixes `DOCUMENT_PREFIX_TEXT`, payment and refund prefixes different ignoring case: D18), `expenseSettingsProblem`, and the dispatcher `settingsSectionProblem(section, value, current)`, which also carries `localization`'s overtime check, moved out of DemoStore. The patterns (`EIN_PATTERN`, `EMAIL_TEXT`, `WEBSITE_TEXT`, `DOCUMENT_PREFIX_TEXT`) and message tables are exported, so Company profile's form builds its inline checks from them.
- **`decimal-text.ts`**: `MONEY_TEXT = /^\d{1,12}(\.\d{1,2})?$/`, plain unsigned money: no bare point, sign, exponent or space.

### 3. The API (`apps/api/src/modules/settings`; D2)

| Route | Guards | Handler checks, in order | Answer |
| --- | --- | --- | --- |
| `GET /settings` | `@AnyCompanyMember()`, `Cache-Control: no-store` | none | `SettingsAnswer`, cut for this person |
| `PUT /settings/profile` | `settings.company.manage` | switch `settings.company` (404) → data scope `all` (403) → strict body (400) → `companyProfileProblem` (400) → save | the saved profile |
| `PUT /settings/numbers` | `settings.numbers.manage` | switch `settings.number-format` → scope → strict body, each kind once → `numberSettingsProblem` against the stored format → save | the saved `NumberSettingsWire` |
| `PUT /settings/payments` | `settings.payments.manage`, module `core` | switch `sales.payments` → scope → strict body → `paymentSettingsProblem` → **step-up** (403 `step_up_required`) → save | the saved `PaymentSettings` |
| `PUT /settings/expenses` | `settings.expenses.manage`, module `core` | switch `finance.expenses` → scope → strict body → `expenseSettingsProblem` → save | the saved `ExpenseSettings` |

- **Explicit paths, not `:section`** (D2): each route declares its own permission and module, so the route inventories (`permissions.int`, `isolation.int`) see them, an unknown section is Nest's 404, and nothing clashes with `@Controller("settings/accounting")`.
- **Strict bodies** (`settings-input.ts`): Zod `.strict()` at every level, with lengths. Strings are stored as sent; the content rule trims to check. Amounts are strings checked against `MONEY_TEXT`, never JSON numbers (D13).
- **The save** (`settings.service.ts`): one transaction. `SELECT … FOR UPDATE` on the group's row (no `deleted_at` filter, as every settings loader: D20), then update, or insert with `onConflictDoUpdate` on the group for two first saves at once; then one `audit_log` entry, "Changed company profile", "Changed number format", "Changed payments" or "Changed expense approval", with `before` (read under the lock) and `after` as the API answers the section (the number format as the wire list), `null` before a first save. `@Audited()` silences the safety-net entry. The section is replaced whole; the last save wins.
- **Data scope `all` for every settings save** (D4): settings bind the whole company, as the books do (ADR 0040). No default role is affected.
- **The step-up for Payments** (D5): the two-person check and the write-off limit are fraud controls over money in and out, and `settings.payments.manage` is an MFA key. The code is asked after the content checks, on screen and on the API: the page runs `paymentSettingsProblem` before it opens the step-up dialog, and the API runs it before it checks the code. So a refused value never costs one (review round 1). Expense approval has none (its key is not an MFA key; Q1).
- **No control-database write** (D11): `tenants.legal_name` keeps what provisioning wrote (Q5).

### 4. Who reads what (D3, D9)
- `profile` and `numbers`: every member (documents and every `<Num>`). The **EIN** is `""` unless the person holds `settings.company.manage`: only Company profile reads it, and no document prints it.
- `payments`: holders of `sales.invoice.view` or `settings.payments.manage` (the invoice page's payment sheet and Update status, and the Payments page).
- `expenses`: holders of `settings.expenses.manage` (only Settings → Expenses reads it; telling every member the approval line makes it easy to split an expense under it).
- A section is left out when its module is off; payments and expenses also when their product feature (`sales.payments`, `finance.expenses`) is off. Profile and numbers stay answered while their page's switch is off, because the rest of the app uses them; their PUT answers 404 then.
- **Accepted residual:** the audit log's "Changed company profile" rows carry the EIN in `before` and `after`, and holders of `settings.audit.view` read them (Q2).
- No property of the answer is a `SENSITIVE_FIELDS` name, and the interceptor still runs.

### 5. A section never saved (D10)
`GET /settings` answers what the API acts on: the US pack's number format, expense approval off, a blank profile, and payments as "every payment waits, nothing can be written off" (`approvalRequired: true`, threshold `""`, `writeOffMax: "0.00"`, `PAY-`, `RF-`), while the API refuses payments until the row exists (409). `numberSettingsProblem` compares the locale and currency with the US pack then (Q7, Q9).

### 6. The web
- **`API_METHODS`:** `getSettings` reads `GET /settings` first, then lays the served sections over DemoStore's copy (`settingsFromAnswer`: only `API_SETTINGS_SECTIONS` are taken, numbers through `numbersFromWire`; anything else in the answer is ignored, so a newer API never widens an older web). `updateSettings` sends a served section to `PUT /settings/<section>` (numbers as the wire list) and reads again; any other section stays on DemoStore. `getDefaultSettings` and `resetSettings` stay unrouted (D7).
- **The shell follows at once.** The provider's one query reads `GET /company` and `GET /settings` together, and the transport re-reads after every answered write, so a saved number format or profile shows on the saver's own open screens without a reload; another person's screens follow on their next write or load. A refused or failed first read shows GET /company's full-page refusal (it fails closed).
- **Four screen edits** (D16): `saveSection` makes a refused save show its message in a toast and keep the draft, on every settings page, with or without a step-up (it also fixes the silent Currency and Sales tax tabs); Payments gets `stepUp`; `SettingsForm` takes the section's shared rule (`problem`), which Save runs before the step-up dialog or the request (`nextSaveStep`), and Payments and Expense approval pass theirs (review round 1); Company profile builds its rules from the shared patterns and messages.

### 7. DemoStore
`updateSettings` checks, for every section and in the API's order: the keys (the role message), the module ("This part of the product is not switched on for your company."), the switch ("This feature is switched off."), data scope `all` (`SETTINGS_SCOPE_MESSAGE`; View as limits it), then `settingsSectionProblem`. It can only refuse more than before. Kept different: DemoStore reads every section in full from its own copy; its step-up is the dialog alone (any six digits); its audit `before` and `after` are `diffSummary` text.

### 8. Smaller decisions
- **D6, numbers as a list** in the GET, the PUT body and answer, and the audit entry; stored rows keep `NumberSettings`, which `loadMoneyFormat` reads.
- **D12, the number format keeps the company's own locale and currency** (rule 12: compared with the stored or pack value, no literals).
- **D15, unmoved pages keep saving in the browser** in api mode until their part (Q6).
- **D17, the `auth.step-up` register row** gains Payments (text only; `features.ts` unchanged). `/feature-change` step 2's owner confirmation is replaced by the queue's safest-default rule.
- **D18, payment and refund prefixes must differ**: `refunds` has no unique number index.
- **D21, the Payments threshold is checked even while approval is off.**
- Build-time choices (the session log's B1 to B14): the "server acts on it" API cases run in a provisioned company; a few extra shared messages so every refusal has words; the save takes an `answered` mapper so the locked `before` maps like `after`; A14 holds the row so the lock is pinned.

## Later parts (proposed order; each its own PR on part 1's pattern; Q8)

| Part | Scope | Notes and asks |
| --- | --- | --- |
| 2 | Sales and documents; Localization's Region, Currency (step-up) and Payroll tabs, `settings.localization.manage` | Per-tab keys, never the whole-section any-of. Documents' prefixes on `DOCUMENT_PREFIX_TEXT`, percents on `PERCENT_TEXT` (max 100), whole days; Payroll calls `overtimeRuleProblem` through the dispatcher; Currency base `USD` only. **Web:** don't diff the half-DemoStore localization copy; give the two pages a per-tab ApiClient method (recommended) or a server-side diff. **Time zone:** second copy in control `tenants.time_zone` (read by `companyClock`); answer it from the control row and refuse a change through the dispatcher's `current`, or **stop and ask** if it must be editable. Security review (deposit, late fee) |
| 3 | Sales tax tab, `settings.tax.manage`, step-up | A changed rule is a new `tax_rules` version; county rates in `tax_jurisdictions`; a shared tax-rate text (B6's note) compared by value. Closes "`settings.tax.manage` is enough to save all of localization". Security review (tax) |
| 4 | Warehouses and showrooms (`POST/PUT /locations`, `settings.locations.manage`, core, scope `all`) and `sharedCosts` (`fixedPctProblem` on the server) | Branch limit stays stored, not enforced, until a branch editor exists. Security review (data scope) |
| 5 | `PUT /settings/hr`, `settings.hr.manage`, module hr, a step-up proposed | Takes the same `FOR UPDATE` on the `hr` row that opening a pay period takes. Security review (payroll) |
| 6 | Branding into control `tenant_branding`, the logo through StorageProvider | A control-database write from a company route; ask first if the logo route touches providers |
| with the bell and Outbox | `email` (sender details), DemoStore's money format in its messages | |
| with stock adjustments | `inventory` (stock rules) | |

Every later part: adds its section to `API_SETTINGS_SECTIONS` and `SETTINGS_READERS` (the narrowest readers whose screens read it), checks its property names against `SENSITIVE_FIELDS` (A1's key walk), passes `current` to the dispatcher, and keeps the route order of section 3. Out: Settings → Meetings (ADR 0051 part 4), billing writes, `GET /settings/defaults` with defaults seeded at provisioning (Q4), the Settings → Accounting screen, `PATCH /me`.

## Consequences
- **Deploy the API before the web.** `GET /settings` is on the shell's first read and the invoice and quote pages' reads; a web that has it against an API that doesn't (404) or a 5xx there keeps everyone out with the refusal page. An older web against a newer API ignores sections and kinds it doesn't know.
- One more light GET per shell load, per answered write and per invoice or quote page load, beside GET /company's.
- **No schema, migration or dependency change;** nothing in `apps/api/src/core`, packages/providers, packages/db, `features.ts` or the web's session. docs/FEATURES.md changes text only.
- **Changed behaviour in the demo too:** a bare point or a sign in a Payments or Expenses amount, and equal payment and refund prefixes, are refused; a role or View as with a scope narrower than `all` can't save settings; a switched-off section, or one whose module the company lacks (Harbor's payments), refuses; saving Payments asks for a code; every refused settings save shows its message.
- **Residual risks:** unmoved sections still save in the browser only in api mode (Branding, Sales and documents, Localization and tax, Warehouses and showrooms, Shared costs, HR settings, Email, Stock rules, Meetings); the Expenses page is mixed (approval on the API, shared costs in the browser); Reset to default reads DemoStore's fixture originals; the bell's and Outbox's money format is DemoStore's until that task; last save wins within a section (both audited); a screen added later that reads `payments`, `expenses` or the EIN for someone outside the readers gets DemoStore's copy in api mode (add the reader); a new prefix starts numbering at 0001.
- **Tests:** packages/shared `settings-sections.test.ts` (R1 to R11) and `decimal-text.test.ts` (R9); apps/api `settings.int.test.ts` (A0 to A15, 40 cases: metadata against the shared table, the per-person answer and its key walk, never-saved answers, every role in both products, strict bodies, the step-up order, module, ceiling, scope and switch, the server applying the saved payment and expense rules, own company only, one audit entry per save, the row lock, `/settings/accounting` unchanged); apps/web units `settings-answer` (W1 to W7), `save-section` (SF1 to SF3), `demo-settings` (D1 to D8) and two `api-rereads` cases; api-mode e2e `tests/e2e-api/settings.spec.ts` (E1 to E3, which heal and restore Summit's values); demo e2e S1 in `tests/e2e/settings.spec.ts`. 23 mutations of the protections, each caught.

## For the owner (none blocks; the safest default is taken)
- **Q1 Step-up for settings saves.** Taken: Payments only. Add it to Expenses, or to every settings save?
- **Q2 Who reads the settings.** Taken: the narrow readers of section 4. Widen any (for example the EIN to HR for W-2 work), or mask the EIN in the audit rows too?
- **Q3 Company-wide scope** for every settings save. Taken: yes; no default role is affected. Confirm.
- **Q4 Reset to default on the API.** Taken: the demo's originals, which equal the seeded values. Build `GET /settings/defaults` from the country pack and seed settings at provisioning?
- **Q5 The legal name in two places.** Taken: the profile is what documents print; the console keeps the sign-up name. Sync the console's copy on save (a control-database write)?
- **Q6 Pages not yet on the API, in api mode.** Taken: they keep saving in the browser until their part. Hide them like Settings → Meetings, or show a one-line note?
- **Q7 Number format** keeps the company's own locale and currency. Confirm.
- **Q8 The order of the later parts** above. Change it?
- **Q9 A company that never saved Payments** is shown "every payment waits, nothing written off" while the API refuses payments. Confirm, or show "not set up"?
- **Q10 Separation of duties.** The Accountant, who records and approves payments, can also loosen the two-person check and the write-off limit with `settings.payments.manage`; the step-up and audit record it but don't stop it. Should loosening (approval off, the threshold up or empty, the write-off limit up or empty) be Owner-only? Related: `PUT /settings/accounting` uses the same key with no step-up.
