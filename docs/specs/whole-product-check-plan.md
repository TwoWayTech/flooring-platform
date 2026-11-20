# Final plan: the whole-product check (owner's queue, last item before P13)

> **Status: paused, stages 0 to 7 built.** This is the final, critic-checked plan for draft PR #43, written read-only by B on 2026-11-16 and committed on 2026-11-17 at the owner's stop, so it isn't lost on one laptop. The session log `docs/sessions/2026-11-16-1241-b-whole-product-check.md` (on this branch) says what was built and how to resume. Re-check every file:line against the branch you build on.
>
> **Laptop-only helpers.** `<scratchpad>` and `$S` name B's session folder on B's Mac; nothing in it is in the repo. `heavy.sh <command>` only ran one heavy job at a time: run the command directly. `check/full.sh` ran `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:api` and `pnpm test:hooks`. `api-e2e.sh`, `int.sh`, `mutate.sh`, `turbo-hash.sh` and `scope.sh` were the builder's own runners: write your own from what each step names. The env scripts it mentions were B's local test values and are not needed: use your own `.env.local` (docs/environment.md lists the names).

This plan builds on `check/plan.md` and applies the critique in `check/critic.md`. I re-checked every item against `origin/main 9cb7c73`, `origin/feat/import-api` (PR #41, draft) and `origin/feat/e2e-api-flows` (PR #42, draft), read-only, on 2026-11-16. A builder needs only this file and the code.

## What changed from the first plan

| # | Item | First plan | Final plan | Re-checked at |
| --- | --- | --- | --- | --- |
| 1 | MF-1: retiring a fresh company | Drop the database and set `tenants.deleted_at` | One control transaction sets `tenant_databases.deleted_at` and `tenants.deleted_at`, revokes open invitations and removes the Owner's sign-in rows (session, two_factor, passkey, credential account). Then the database is dropped. FH-1 proves `migrateAllCompanies` skips the retired company. | `packages/db/src/migrate.ts:128-131,149-160` selects only `tenant_databases.deleted_at is null` |
| 2 | MF-2: PM-2 guard chain | `PermissionGuard` alone, with a hand-built tenant | `TenantGuard`, then `PermissionGuard`, on the same `ExecutionContextHost`. `TenantGuard` sets `request.tenant`. The oracle order is product first (TenantGuard), then PermissionGuard's order. | `tenant.guard.ts:59-60` (product); `permission.guard.ts:63` (throws without a tenant) |
| 3 | MF-3: routes with no module | PM-1(b) "every company route has a module"; oracle and PM-4 assume one | (b) allows a reviewed `NO_MODULE_ROUTES` list when every declared key is in module `platform`, or the route is any-member. The oracle checks the module only when one is declared. PM-4 goes through the declared modules only and asserts by name that retail, wholesale and installation have no routes. | `users.controller.ts:68,120,191`, `notifications.controller.ts:30,60`, `billing.controller.ts:18`, `access-requests.controller.ts:48` have no `@RequireModule`; `catalog.ts:98-113` puts those keys in `platform` |
| 4 | MF-4: E13, reports against the ledger | "Equal figure by figure" | Figure by figure (R1–R6). Revenue should equal the ledger. Report cost of goods and P&L expenses are checked against the documents. The ledger's cost of goods and expense accounts are checked on their own. The P&L-to-ledger expense difference is asserted to equal Σ purchase tax exactly, and recorded as finding F-a. | `analytics.ts:127-128` (cost at sale, `e.amount`); `expenses.ts:28` (`expenseCost` = amount + tax); `business-report.ts:371,431` |
| 5 | MF-5: mutations M4 and M5 | M4 removed `unitCost` from `SENSITIVE_FIELDS`, and PM-7 judged leaks by that same map. M5's overpayment might never happen. | PM-7 judges leaks with its own reviewed `MUST_STRIP` list, independent of the map, plus a check that `SENSITIVE_FIELDS ⊇ MUST_STRIP`. The MI-1 prelude always includes an overpayment. | `sensitive-fields.ts:34-38` (the interceptor uses `sensitiveKeyFor`); `access-rules.ts:81-104` |
| 6 | MF-6: MI-1 minimums and refusals | 30 weighted random steps with minimums; refusals allowed by code | A fixed prelude, in a valid order, hits every event kind at least once (overpayment, variance bill, cut and write-off included). Then a random tail. Refusals must match `{ status, code, message: RegExp }`. | `sales-common.ts:25-27`: nearly every refusal is 400 `invalid_request` |
| 7 | MF-7: demo-script coverage on Summit | Mixed pages treated as on the API. Step 4 missing. Flow coverage overstated. | Each DS step reads its page's classification from the generated `page-coverage.json`. A mixed page is reported as a gap. DS-4 is added, on its own invoice. The uncovered sub-steps of steps 8, 9 and 12 get read-only checks or are listed as "not exercised in api-mode e2e". | `use-dashboard-data.ts:84-96`; `api-methods.ts:103-114` (`SERVED_LISTS`); the flows session log, "Left out"; `invoices.spec.ts` and `sales.spec.ts` have one test each |
| 8 | MF-8: Turbo inputs | Root docs and `apps/api/**` | `web#test` inputs add `packages/shared/src/**`, `packages/shared/test/**` and `apps/api/test/**`. `apps/api/src/**` is dropped: the scan reads the route catalog snapshot, not the source. The broader gap goes to the owner (Q6). | `turbo.json`: `test` has no `dependsOn` |
| 9 | Hash check | `touch` a file and compare the Turbo hash | Append a newline, compare, then `git checkout --` the file. Turbo hashes content, so `touch` would prove nothing. | (my re-check) |
| 10 | G4, the Owner's first sign-in (SH-12, SH-13) | `setTestPassword` writes a credential | A test-only helper inserts the invitation that provisioning should have sent: a token whose SHA-256 is stored, valid 7 days. The Owner then sets a password through the product's real accept page and route. No helper writes a credential. FA does the same through `POST /public/invitations/accept`. | `invitations.service.ts:74-115`; `invitation-rules.ts:11-17`; `apps/web/src/app/accept-invite/page.tsx`; STATUS:360 |
| 11 | SH-13: helper safety | Admin URL taken from the environment, with a 5432 fallback | Every helper takes `controlUrl`, `adminUrl` and `encryptionKey` explicitly. It refuses any host but `localhost` or `127.0.0.1`, and any `DB_PROVIDER` but unset or `postgres`. | `testing.ts:22` (fallback) |
| 12 | SH-1: build order | Stop unless both PRs have merged | Fallback: if import has merged and flows is held (Q1, or its 20-minute guard), build everything except DS and PGM, then add those in a later commit or PR. The gate threshold is 20 minutes, matching the flows guard. | Flows log :118 ("stop … if verify would pass 20"); PR #39 verify 19.45 min |
| 13 | SH-2: harness count and timeouts | 5 new API files, 5 Summit seeds | 3 new API files: `route-matrix` (PM-1–PM-7 and MI-DEC), `money-integrity` (MI-1–MI-3) and `new-company` (FA and MI-4–MI-9). Each long test sets an explicit timeout. | `auth-harness.ts:59-80` seeds Summit per harness; `vitest.config.ts` `testTimeout: 30_000` |
| 14 | SH-3: sweeps that send `{}` | Not considered | A 2xx answer to `{}` fails unless the route is on the reviewed `EMPTY_BODY_OK` list. PM-5 runs on its own company, `matrixsw`. | `permissions.int.test.ts:198-214` |
| 15 | SH-4: in-handler checks | Not considered | Taken in part. The snapshot header and the report say "guard decision only". The report lists in-handler rules found by grep (`requireCompanyWide`, Owner-only, separation of duties, data scope). There is no per-route column (see "SHOULD items not taken"). | `ledger.controller.ts:43` |
| 16 | SH-5: feature-switch trace | "About 15" call sites | 197 call sites. Routes whose switch is read in a service after a nil-UUID 404 are listed in `SWITCH_READ_IN_SERVICE` and traced by hand. | `stock-issue.service.ts`, `payments.service.ts`, `contract-billing.service.ts`, `portal.service.ts` |
| 17 | SH-6: clamps | Not considered | The model computes unclamped sums. It asserts that unclamped customer credit is ≥ 0 and unclamped bill balance is ≥ 0, and that every confirmed supplier payment is fully allocated with no allocation above its bill's balance. Invoice overpayment is split exactly (balance and overpaid) and is not treated as a clamp. Negative contract billings stay out of the random run and are checked once in MI-4. | `ledger.ts:70-71,168`; `operations/purchasing.ts:243` |
| 18 | SH-7: stock costs | Taken from movements | The model reads the average cost from `GET /products` (as the Owner) before each issue or correction, and checks the next average with shared `averageCost`. Stock is kept from going negative. Rolls fall inside the E9 tolerance unless the receipt code proves them exact. | `company/inventory.ts:63-83` (no cost on movements); `stock-postings.ts:153-158` |
| 19 | SH-8: E5 | Had a separate "+ tax on releases" term | Σ signed tax over non-void invoices (contract and release invoices are invoices, counted once) − Σ `expenseCost` of confirmed `sales_tax_payment` expenses, plus any tax part of a write-off if `writeOffPosting` has one | `contract-postings.ts` (`contractInvoicePosting`) |
| 20 | SH-9: MI-8 and MI-5 | Payment dated before the close; same company as payroll | MI-8 runs on its own company and reaches `period_closed` with an expense dated yesterday | `ledger.service.ts:255`; `pay-periods.service.ts:360`; `payroll-postings.ts` (`date: run.period.end`) |
| 21 | SH-10: immutability inventory | PUT, PATCH and DELETE only | Every write on an existing record (any verb with a path parameter) is classified in the reviewed `DOCUMENT_WRITES`. The report states that document immutability is enforced by the API only; the DB triggers cover journal tables. | `POST /payments/:id/files`, `/invoices/:id/sent`, `/quotes/:id/status`, `PATCH /rolls/:id` |
| 22 | SH-11: 5xx answers | Not stated | A GAP test pins a 4xx with its exact code. Any 5xx fails, with a link to STATUS. | STATUS:191 |
| 23 | SH-14: process rules | Not stated | The session log and ADR 0058 record why test-only helpers in `testing.ts`, and an ADR instead of a spec, follow the decision rule. Owner question Q7. | CLAUDE.md "Workflow" |
| 24 | SH-15: docs-only PRs skip CI | Coverage read FEATURES.md and the spec contents | Coverage reads `features.ts` and the spec file names only, so a docs-only PR can't leave `coverage.md` stale | `ci.yml` `paths-ignore: ["docs/**", "**/*.md"]` |
| 25 | SH-16: page gates | PG-3 had no data-source mode; nothing linked pages to routes | PG-3 sets `NEXT_PUBLIC_DATA_SOURCE=api`. A new PG-4 is a static join in the default runs: page × role (from `canOpenPage`) against each route the page reaches (from the route-role matrix). | `products-demo-only.test.ts:22-35` |
| 26 | SH-17: PM-7 limits | Not stated | GET routes that need a query get a minimal valid one from a reviewed `QUERY_FOR`. A 400 not in that list fails. The report-figure names stripping doesn't cover are listed. | ADR 0055:20 |
| 27 | SH-18: e2e sign-in limit | Not considered | `resetAuthState([persona])` runs before every e2e sign-in, `marcus.bell` included, so there is no 61-second wait | `accounts.ts:38-50` |
| 28 | SH-19: facts | 16 api-mode specs, about 140 methods, a "documents" settings group, line 150, FA-12 wording | 14 api-mode specs on main; 152 `API_METHODS` keys (157 after import); the settings groups listed in 1.2; `stock-postings.ts:153-158`; FA-12 reworded | `git ls-tree`; `summit.json` |
| 29 | CV-8 counts | "≥ 30 api-mode test files" | ≥ 30 API integration files and ≥ 14 api-mode spec files | 34 int files, 14 spec files on main |
| 30 | `ExecutionContextHost` import | `@nestjs/core/helpers/execution-context-host` | `@nestjs/core/internal`; the helpers path also resolves | `@nestjs/core` 12.4.2 `internal.d.ts:21` |
| 31 | `companyDay` | A new support copy | Import the product's `todayIn` from `src/modules/sales/sales-common.ts` | `sales-common.ts:35-39` |
| 32 | Gap G7 (new) | Not listed | No API or platform-admin route creates a company; provisioning is the CLI script only | `platform.controller.ts`, `company-status.controller.ts`; STATUS:422 |
| 33 | New mutations | M1–M8 | Adds M9 (a page rule key, which PG-3 and PG-4 must catch) and M10 (retire skips `tenant_databases.deleted_at`, which FH-1 must catch). M4 is now judged by `MUST_STRIP`. | |
| 34 | New finding | F-a to F-d | Also F-e: routes with no module and `retail`/`wholesale`/`installation` with no routes, for the coverage report | |

## SHOULD items not taken, or taken differently (and why)

| Item | What was done | Why |
| --- | --- | --- |
| SH-4 (a per-route "in-handler checks" column in `route-requirements.json`) | Taken in part: the "guard decision only" label, and a grep list of in-handler rules in the report | Finding the handler body by regex is fragile, and checks inside services wouldn't be seen anyway. A reviewed list in the report says the same thing without a brittle snapshot column that would churn on unrelated edits. |
| SH-12 ("insert a credential as `addUser` does, or add an Owner with `addUser`") | Replaced with the invitation path (row 10) | The provisioned Owner signs in through the product's own acceptance, so no test code makes a password hash. This is closer to "sign its Owner in" and to the planned P17 behaviour (STATUS:360). |
| SH-13 ("FC needs a variant of the flows' `signInAndEnrol` that takes a password") | FC keeps its own sign-in steps inside `check/fresh-company.spec.ts`, using `nextCode` from main's `accounts.ts` | `kit.ts` isn't merged yet, and FC must not depend on it (the SH-1 fallback). It is a few lines, used once. |
| SH-2 ("merge `fresh-company` into `money-scenarios`") | Taken, under the neutral name `new-company.int.test.ts` | Every test in it runs on a newly provisioned company. The random money run stays in its own file, so the CI gate can trim its tail alone. |

Every other MUST-FIX and SHOULD item was taken as the critic wrote it, with the refinements in the table above.

---

## 0. Setup, order and scope

- **PRs it waits for:** import part 1, PR #41 (`feat/import-api`, ADR 0057), and cross-module flows, PR #42 (`feat/e2e-api-flows`). Both were drafts on 2026-11-16.
- **Branch and worktree:** `feat/check-whole-product`, in a fresh worktree `/Users/sarah/dev/flooring-platform-check`, cut from `origin/main` after the merges.
- **Order and fallback (SH-1):**
  - **Normal:** start once both PRs have merged.
  - **Fallback:** import has merged, and flows is held only on its CI question (Q1) or its 20-minute guard. Then start from the main of that moment and build every stage except stage 7 (DS and PGM, which reuse `flows/kit.ts`). The report marks DS and PGM as "waiting for PR #42". They are added in a later commit, or in a small follow-up PR if this one has merged, once flows merges.
  - **If import hasn't merged:** stop and report.
- **Session log:** `docs/sessions/<YYYY-MM-DD>-<HHMM>-b-whole-product-check.md`, using the build's start time.
- **ADR:** `docs/adr/0058-whole-product-check.md`. Main ends at 0056 and import adds 0057. Check at stage 0 with `git ls-tree --name-only origin/main docs/adr/ | tail -3`.
- **Scope:** tests, test helpers, scripts and docs only.
  - Non-test files changed: `turbo.json` (cache inputs, pass-through env), `.prettierignore` (generated JSON) and `packages/db/src/testing.ts` (test-only helpers, additive).
  - No product code change, no schema change, no dependency, nothing in `apps/api/src/core`, `.github`, `CLAUDE.md` or `.claude/`.
  - Product bugs become STATUS follow-ups. The only exception is a tiny, clearly correct fix outside auth, tenancy, permissions, money and payroll, in its own commit with its own test.
- **Paths:**
  - `S=<scratchpad>`
  - `C=$S/check` (logs in `$C/logs`)
  - `W=/Users/sarah/dev/flooring-platform-check`
- **How commands run:**
  - Heavy commands always go through `$S/heavy.sh`.
  - Integration tests source `$S/reports/int-env.sh` inside the heavy command (port 5432, throwaway CI values).
  - Api-mode e2e sources `$S/meet3/e2e-env.sh` inside its runner. The runner refuses unless `CONTROL_DATABASE_URL` and `TENANT_DB_ADMIN_URL` are both on `:5433`.
  - Neither env script is ever printed. `.env` files are never read, printed or created. The worktree has none, by design. `playwright.api.config.ts` loads them only if they exist.
  - The 5433 container `fp-e2e-worktree` is never re-created or reseeded. Provisioning a new company database on it is allowed. Summit is never written outside the product's own routes.

---

## 1. Facts the plan rests on

### 1.1 What already exists (reused, never duplicated)

| Area | Existing test | What it proves |
| --- | --- | --- |
| Ledger, pure | `packages/shared/test/postings.test.ts:158` | 200 seeded random sequences of sales events and reversals. The trial balance stays at 0, and AR equals the model. No Postgres. |
| Ledger rules | `packages/shared/test/{stock,contract,payroll,commission,expense}-postings.test.ts`, `ledger.test.ts` | Each rule balances. Invoice state and balance are derived (`invoiceLedger`, `customerCredit`). |
| Fixture invariants | `packages/shared/test/reconciliation.test.ts` | On the fixtures: receivables, inventory valuation, payables, and stock equal to movements |
| Week-18 gate | `packages/shared/test/business-report-gate.test.ts` (40 companies) and `apps/api/test/reports.int.test.ts:1093` (R-GATE) | Location profits add up to company profit |
| Reports | `reports.int.test.ts:919` (R-EQ) | Each report equals the shared calculation over Summit's full record |
| DB guarantees | `packages/db/test/ledger.int.test.ts` | Balanced at commit, one-sided lines, no update or delete of journal tables, closed days refuse postings |
| API postings | `apps/api/test/{invoices,payables,expenses,contract-billing,payroll,commissions,stock-issue,accounting}.int.test.ts` | Deterministic trial-balance deltas, and `balanced` on every read |
| Permissions, pure | `packages/shared/test/role-matrix.test.ts` (snapshot), `permissions.test.ts`, `mfa-roles.test.ts` | Templates per role. The Owner holds everything. Sensitive keys are kept from Sales, Warehouse, Installer and Employee. Pay rate is for HR and the Owner only. |
| Permissions, API | `apps/api/test/permissions.int.test.ts` | `AccessService` resolves exactly template ∩ ceiling ∩ modules for every default role of both products. Probe routes cover refusal, deny by default, modules and stripping. The route inventory (`:198`) checks that every route declares a permission, as the Manager only. |
| Isolation | `apps/api/test/isolation.int.test.ts:256-310` | 401 without a session. 403 `company_required` without a company, except the 19 session-only routes. A tenant in the body, query or a header is ignored. The life cycle is enforced. A soft-deleted tenant is refused (`:192`). |
| Stripping | `apps/api/test/access-rules.test.ts` | `stripSensitive` unit tests |
| Invitations | `apps/api/test/users.int.test.ts:190-215` | Invite with a step-up; lookup; a short password refused; accept once (204), then 410 |
| Feature register | `packages/shared/test/features.test.ts` | `FEATURES.md` and `features.ts` agree |
| Web | `apps/web/tests/unit/api-router.test.ts`, `products-demo-only.test.ts` | `API_METHODS` go to the API and everything else to DemoStore. Demo-only pages are hidden in api mode. |
| e2e | `tests/e2e` (demo: `roles.spec.ts`, a11y, responsive); `tests/e2e-api` (14 spec files on main) | After the merges: flows F1–F7 (`tests/e2e-api/flows/`) and the import's api-mode spec, if it lands |

### 1.2 Facts that shape the check

1. **G1: a non-demo company can't open the web app in api mode.**
   - `toCompanySession` accepts only the slugs `summit`, `keystone` and `harbor`. It matches the user to a DemoStore fixture profile by email, and otherwise returns `null` (`apps/web/src/lib/session/api-context.ts:31,39-47`).
   - The login page then shows "Your account is ready, but not this workspace." (`app/login/page.tsx:17`, `features/login/api-sign-in.tsx:43`).
   - The shell reads `getCompany`, `getSettings`, `list("roles")` and `list("users")` from DemoStore (`components/workspace/workspace-provider.tsx:87-93`).
2. **G5: Summit masking.** DemoStore's fixtures are the data the seed wrote into Summit, so api-mode e2e on Summit can't see a screen that still reads DemoStore. Mixed pages include:
   - the dashboard (`features/dashboard/use-dashboard-data.ts:84-96`, which reads quotes, expenses, products, rolls, customers, locations, users and roles through `list`);
   - Needs attention (`lib/attention.ts:154`);
   - the sales, invoice, quote, inventory and roll pages;
   - the shell.

   `SERVED_LISTS` holds only audit, invoices, payments, invoiceAdjustments, refunds, reservations, payPeriods, bonuses and contractorPayments (`api-methods.ts:103-114`).
3. **G4: no Owner invitation at provisioning.** `provisionTenant` makes the Owner an unverified user with no password (`packages/db/src/provision-tenant.ts:82,225,233-235`). STATUS:360 says the invitation comes with the platform-admin screens (P17). The invitation code already exists and works for any user row: `InvitationsService.accept` sets the password, marks the email verified and activates the profile (`invitations.service.ts:74-115`). Only the token's SHA-256 is stored (`invitation-rules.ts:11-17`).
4. **G2 and G3: a new company has no settings, tax rules, branches, warehouses or products.**
   - A quote answers 409 `settings_missing` (STATUS:329).
   - No API route creates locations, products or settings, except `PUT /settings/accounting`. After import part 1, products, customers and suppliers can come in through `POST /imports`; locations still can't.
   - Existing tests bootstrap a company by direct inserts (`invoices.int.test.ts:71-131`, `stock-issue.int.test.ts:78`).
   - `summit.json`'s settings groups are branding, localization, numbers, payments, inventory, hr, expenses, sharedCosts, meetings, email and profile.
5. **G7: no route creates a company.** The platform routes list companies, change access, suspend, reinstate and cancel. Nothing provisions (`platform.controller.ts:90-122`, `company-status.controller.ts:77-118`). STATUS:422 asks the owner about "Provisioning from the console, with the owner's invitation?".
6. **Ledger facts.**
   - Accounts are made on first posting (ADR 0039).
   - Sales tax posts at invoicing whatever the basis (ADR 0040).
   - Bank accounts are `bank:<uuid>`. A void credits the cash account first posted to.
   - The average cost is rounded to 4 dp and resets at stock ≤ 0 (`stock-postings.ts:153-158`).
   - A bill's price difference moves Inventory with no location and doesn't feed the average.
   - A pay run accrues Wages against Accrued Payroll, and nothing pays it out (ADR 0047). Pay runs post on the period's last day.
   - Seeded and imported documents have no journal entries (STATUS:324).
   - Clamps: `invoiceLedger.balance = max(owed, 0)` and `overpaid = max(−owed, 0)`, an exact split. `customerCredit` and `billLedger.balance` are clamped at 0.
   - Credit notes are return invoices (`isReturn`).
7. **Reports read documents, not the ledger** (ADR 0055).
   - `monthlyPnl`: revenue is the signed subtotals of non-void invoices; COGS is the signed invoice `cost`; expenses are Σ `amount` of `countsAsCost` expenses, which leaves out tax (`analytics.ts:119-140`).
   - The Business report and the ledger use `expenseCost` (amount + tax).
8. **Guards.**
   - The chain is `SessionGuard`, then `TenantGuard`, then `PermissionGuard` (`core/request-pipeline.module.ts:25-27`).
   - `TenantGuard` checks: company, membership, product (host header and `@RequireProduct`), maintenance, database status, lock, read-only (`tenant.guard.ts:50-66`).
   - `PermissionGuard` checks: MFA enrolment, then `permissionDecision`. That is undeclared, then module (only when declared), then keys, then disabled profile (`permission.guard.ts:32-41,61-77`).
   - Writes count only handler-level keys (`permission.decorators.ts:49-67`).
   - Only the reports controller has `@RequireProduct("flooring")`.
   - Declared modules: core 11 controllers, hr 7, contracts 1, meetings 1, and one handler with `platform` (`invoices.controller.ts:386`).
   - No `@RequireModule`: users, roles, audit, notifications, outbox, billing, support-grants, plus import part 1's controller. Their keys are in `platform`, or they are any-member.
   - Retail, wholesale and installation have no routes.
   - Feature switches are runtime `featureOn` or `requireFeature` calls (197 call sites; a 404 with no code). Tests flip `FEATURES[key].enabled` in-process (`reports.int.test.ts` `withFeatureOff`).
9. **Routes and roles.**
   - 202 route decorators on main, 207 after import part 1.
   - 9 default flooring roles and 3 HR roles. Owner, Accountant and HR need MFA.
   - Summit has a persona for every flooring role. The installer is `marcus.bell@summitfloor.example`, which isn't in `SEEDED_EMAILS`.
10. **Web client.**
    - Screens call about 175 distinct ApiClient methods.
    - `API_METHODS` has 152 keys, 157 after import.
    - `SERVED_LISTS` isn't exported. The scan probes the `list` factory behaviourally.
    - There are 64 `page.tsx` files and 4 layouts.
11. **CI** (`.github/workflows/ci.yml`; measured on PR #39 and PR #40):
    - `fast` takes about 2 to 3 minutes against a 6-minute timeout. It restores the Turbo cache with restore-keys.
    - `verify` takes 15.25 to 19.45 minutes against a 25-minute timeout. The API step takes 7.6 to 10.0 of that, and the api-mode Playwright step with builds 3.8 to 4.5.
    - `e2e` takes about 21 minutes against a 45-minute timeout.
    - Pushes and PRs that change only `docs/**` or `**/*.md` skip CI.
    - `test` has no `dependsOn`, so dependency source isn't hashed. `test:api` isn't cached and runs in strict env mode.
    - Prettier ignores `*.md` but checks `.json`.
    - Private-repo runners have 2 vCPUs, so fewer harnesses save real time.
12. **The e2e database** (`fp-e2e-worktree`, `127.0.0.1:5433`):
    - `e2e-env.sh` sets `CONTROL_DATABASE_URL`, `TENANT_DB_ADMIN_URL`, `CONNECTION_ENCRYPTION_KEY`, `SEED_USER_PASSWORD` and `BETTER_AUTH_SECRET`, with both URLs on 5433. It sets no `DB_PROVIDER` and no `EMAIL_PROVIDER`.
    - `migrateAllCompanies` skips only `tenant_databases` rows with `deleted_at` set (`migrate.ts:128-131`).
13. **Harness facts.**
    - `AuthHarness.start(modules)` seeds Summit on throwaway databases and sets `EMAIL_PROVIDER=memory` (`auth-harness.ts:59-85`).
    - `provisionCompany(name, products)` provisions for real, with Owner `owner-<slug>@example.test` and no credential (`:107-130`).
    - `addUser({ companyIds, roles })` makes a user with `PASSWORD` (`:220-245`). `signIn(email)` uses `PASSWORD`.
    - `harness.outbox.sent` holds the emails.

---

## 2. Piece 1: the coverage list (generated, can't drift)

### 2.1 What it means
`docs/coverage.md` is generated entirely from code by a Vitest test in `pnpm test`. For every product-spec module, every feature in `features.ts` and every page, it shows:
- whether the page is **on the API**, **mixed** (on the API but still reading some data from DemoStore in api mode) or **demo-only**;
- which ApiClient methods each page reaches, and which stay on DemoStore, with the reason;
- the API routes behind each method, with keys, module, product and switches (from the route catalog snapshot);
- which tests touch each page or route: shared and web unit, API integration, demo e2e, api-mode e2e, flows;
- the gaps.

The same test fails when:
- a screen calls a method that is neither on the API nor on the reviewed demo-only list;
- a web method calls an API path that doesn't exist;
- the document is stale.

**Why generated:** the owner asked for a list that can't drift. **Why only code inputs (SH-15):** docs-only PRs skip CI, so anything read from `docs/` other than the generated file itself could go stale unseen.

### 2.2 Files (all new)
- **`apps/web/tests/unit/coverage/scan.ts`:** a static scan, using `node:fs` and regexes, with no dependency.
  - **Pages:** every `apps/web/src/app/**/page.tsx` gives a route. Groups like `(app)` are dropped and `[id]` becomes `*`. Every `layout.tsx` is "shell".
  - **Import graph:** from each page and layout, follow `./`, `../` and `@/` imports, resolving `.ts`, `.tsx` and `/index`. `src/lib/api/**` is excluded.
  - **Calls:**
    - receivers are `api` (imported from `@/lib/api`), `client`, and any `<name>: ApiClient` parameter;
    - a call is `<receiver>.<method>(`;
    - for `list`, `get` and `save`, a string-literal first argument gives `list:<collection>` (and likewise for `get` and `save`);
    - each call is recorded with file and line.
- **`apps/web/tests/unit/coverage/api-paths.ts`:** what each `API_METHODS` key calls on the API.
  - It reads `api-methods.ts` as text, splits it by top-level key, and extracts `http.request<…>("VERB", "/path" | \`/path/${…}\`)` as `VERB /path/:p`.
  - Methods whose path comes from a helper (`report-paths.ts`) are resolved by the reviewed `RESOLVED_ELSEWHERE` table.
  - Served collections are found by behaviour: `API_METHODS.list(fakeHttp, fakeDemo, noop)(name)` for every `Collections` key (regex over `export interface Collections {…}` in `contract.ts`), recording which fake was called.
- **`apps/web/tests/unit/coverage/demo-only.ts`:** `DEMO_ONLY: Record<string, { reason: string; status: string }>`. Each `status` names a STATUS follow-up or ADR. Seed it, then confirm the whole list during the build:
  - `getSettings` and `updateSettings`: settings not on the API, STATUS:329, real-build-plan week 5;
  - `getDefaultSettings`, `getCompany`, `list:roles`, `list:users`, `listCompanies`: the workspace bridge, G1;
  - `saveLocation` and `list:locations`: G3;
  - `listOutbox`, `retryOutbox`, `cancelOutbox`, `simulateReply`, `simulateBounce`, `listMyNotifications`, `markNotificationsRead`, `saveNotificationRule`, `resetNotificationRule`: ADR 0051 part 3 and the flows "Left out" list;
  - `list:quotes`, `list:products`, `list:customers`, `list:expenses`, `list:rolls`, `list:stockMovements` and others found: G5, mixed pages;
  - `recordAdjustment` and `reviewAdjustment`: `inventory.adjustments` was removed;
  - `scheduleJob`, `startJob`, `signOffJob`, `createInvoiceFromJob`: installation was removed;
  - `testDatabaseConnection`: simulated (ADR 0057);
  - `listCompanyDirectory`, `whoAmI`, `updateMyProfile`, `closeCompany`, `resetDemo`, `save:<collection>`.
- **`CLIENT_LOCAL`:** `openCompany`, `setViewer`, `subscribe`, `takeNotices` and `today`. These are client state, not data. `today` is still tied to the STATUS follow-up "The company's day on the web client".
- **`apps/web/tests/unit/coverage/spec-features.ts`:** the reviewed `SPEC_FEATURES` table, keyed by spec file name (`docs/product-spec/*.md`, plus `docs/specs/platform-admin.md` and `settings-users-access.md`), listing feature keys from `features.ts`. It reads directory listings only, never spec contents.
- **`apps/web/tests/unit/coverage/test-index.ts`:** which tests touch what. Code only.
  - **Demo e2e:** `tests/e2e/**/*.spec.ts`, from `goto("/…")` literals and the `screens.ts` arrays.
  - **Api-mode e2e and flows:** `tests/e2e-api/**/*.spec.ts`, from `goto(` and `"/api-proxy/<path>"` literals.
  - **API integration:** `apps/api/test/*.int.test.ts`. String and template literals starting with `/` are normalised (`${…}` becomes `:p`, the query is dropped) and matched to routes.
  - **Shared and web unit:** `packages/shared/test/*.test.ts` and `apps/web/tests/unit/**/*.test.ts`, from feature-key literals and page-route literals ("named in").
- **`apps/web/tests/unit/coverage/render.ts`:** renders the markdown and `page-coverage.json`. Rows are sorted. There are no dates, timings or line numbers; file paths only.
- **`apps/web/tests/unit/coverage-list.test.ts`:** CV-1 to CV-8.
- **Generated files:**
  - `docs/coverage.md`, never edited by hand;
  - `apps/web/tests/e2e-api/check/page-coverage.json` (page → classification, methods on the API, DemoStore reads), read by DS (MF-7) and the report.
- **Input from piece 3:** `apps/api/test/__snapshots__/route-requirements.json`, the route catalog, which is the source of truth for routes, keys, modules and switches.

### 2.3 Tests
- **CV-1:** every method a screen reaches is in `API_METHODS`, `DEMO_ONLY` or `CLIENT_LOCAL`. The failure lists each `file:line` and says: "Add it to API_METHODS, or to tests/unit/coverage/demo-only.ts with a reason and a STATUS follow-up."
- **CV-2:** every `list:` and `get:` collection a screen reads is served (by the probe) or is in `DEMO_ONLY`.
- **CV-3:** `DEMO_ONLY` has no stale entries: nothing in `API_METHODS`, and nothing no screen calls.
- **CV-4, web to API drift:**
  - every `API_METHODS` key is a member of `ApiClient`;
  - every extracted `VERB /path` exists in `route-requirements.json`;
  - unresolved methods must be in `RESOLVED_ELSEWHERE`.
- **CV-5:** every page route maps to at least one feature through `FEATURES[k].screens`, matched like `pagePatternScore`, or is in the reviewed `NO_FEATURE_PAGES` list (`/login`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/design`, `/[...missing]`, `/admin/**`).
  - Every non-removed feature sits under exactly one spec in `SPEC_FEATURES`, or under "Shell and platform".
  - Every spec file has an entry.
- **CV-6:** every new and existing `apps/api/test/*.int.test.ts` and `tests/e2e-api/**/*.spec.ts` is indexed to at least one route or page, or is in the reviewed `CROSS_CUTTING` list (e.g. `isolation`, `permissions`, `lockout`, `env`, `health`, `route-matrix`).
- **CV-7:** the rendered outputs equal `docs/coverage.md` (`toMatchFileSnapshot("../../../../docs/coverage.md")`) and `page-coverage.json`. CI never writes them. Regenerate with `pnpm --filter web exec vitest run tests/unit/coverage-list.test.ts -u`.
- **CV-8, sanity:** at least 150 distinct screen methods, 60 pages, 180 routes, 30 API integration files and 14 api-mode spec files. This stops a broken regex from making everything vacuous.

### 2.4 What `docs/coverage.md` holds (all generated)
1. A header: generated by `apps/web/tests/unit/coverage-list.test.ts`, with the regeneration command and "do not edit".
2. Summary counts:
   - pages that are API, mixed or demo-only;
   - screen methods on the API or demo-only;
   - routes with and without a screen caller;
   - routes no API test names;
   - api-mode pages with no api-mode e2e.
3. By spec, then by feature: status, pages, API state, and tests of each kind.
4. By page: methods on the API, methods on the demo (with reason ids), tests.
5. The demo-only list, with reasons.
6. API routes: keys, module, product, switches, screen callers, integration tests.
7. Generated gaps:
   - mixed pages, with their DemoStore reads;
   - api-mode pages with no api-mode e2e;
   - routes with no test literal ("needs a look");
   - features with status `demo` or `build` and no route;
   - routes no screen uses (e.g. `GET /ledger/trial-balance`).

### 2.5 Run time and CI
About 2–3 s, in `pnpm test`, so it runs in `fast` and `verify`. Turbo inputs: 9.2.

---

## 3. Piece 2: money-integrity tests

### 3.1 Reading
Over the real API and Postgres, for random sequences of documents, prove that:
- every entry balances, and the trial balance is zero;
- the control accounts equal the balances derived from documents wherever the design says so (exactly which, below);
- posted documents change only by reversal;
- money is a decimal string end to end.

This runs on an **API-only company**: provisioned by the test and bootstrapped with master data and settings only, with no opening stock and no documents. Every money fact goes through the API, so the equalities can be exact.

Existing tests are reused (1.1). This piece adds:
- API-level random runs;
- the reconciliation of control accounts with documents (the PR #16 open item);
- the link between documents and entries;
- reports against the ledger, figure by figure;
- the decimal sweep;
- the immutability inventory.

### 3.2 The equalities, and exactly which hold

| Id | Equality | API-only company | Summit | Why, and conditions |
| --- | --- | --- | --- | --- |
| E1 | Each entry: Σ debit = Σ credit, ≥ 2 lines, each line one-sided and ≥ 0 | exact | exact | DB triggers; also read by SQL |
| E2 | Trial balance: `balanced`, Σ debit = Σ credit, Σ signed balances = 0 | exact | exact | |
| E3 | AR (1100) = Σ `invoiceLedger(i).balance` over non-void, non-return invoices, contract invoices included | exact | run customers only | Seeded invoices posted nothing. The overpaid part sits in E4, an exact split, not a clamp. |
| E4 | Customer Credit (2200) = Σ `customerCredit(c)` | exact, if unclamped credit ≥ 0 for every customer (asserted) | run customers only | ADR 0039 (`credit_applied`) |
| E5 | Sales Tax Payable (2100) = Σ signed tax over non-void invoices (returns negative; contract and release invoices counted once) − Σ `expenseCost` of confirmed `sales_tax_payment` expenses (± any write-off tax part, if `writeOffPosting` has one) | exact | no | ADR 0040; SH-8 |
| E6 | Retainage Receivable (1150) = Σ withheld − Σ released over non-void customer billings. Retainage Payable (2150) likewise over subcontract billings. | exact | no | ADR 0045 |
| E7 | AP (2000) = Σ `billLedger(b).balance` over posted bills (PO, pay-later expense and subcontract bills) | exact, if every confirmed supplier payment is fully allocated and no allocation exceeds its bill's balance (asserted) | run suppliers only | |
| E8 | GRNI (2050) = Σ received value of receipts − Σ received value each bill covers (`receivedValue`) | exact | never | Seeded receipts posted nothing |
| E9 | Inventory (1200) = boxed on hand × model average + rolls remaining × `costPerSqFt` + Σ bill price differences | ± tolerance | never | The tolerance is ½ × 10⁻⁴ × quantity on hand after each average recalculation, plus ½ cent per posting, rounded up to the cent. Rolls are inside the tolerance unless the receipt code proves them exact. Stock never goes negative in the run (asserted; `averageCost` resets at ≤ 0). |
| E10 | Each cash account (1000, `bank:<id>`) = Σ the cash events posted to it. In: confirmed customer payments. Out: completed refunds, confirmed supplier payments, paid expenses, paid contractor payments. A void goes back to the first account. | exact | no | ADR 0040 |
| E11 | Accrued Payroll (2300) = Σ approved, unreversed pay runs' (gross − commission accrued) + Σ approved statements' payable | exact (scenarios only) | no | Nothing pays it out (ADR 0047; Q3) |
| E12 | Sales (4000) = Σ subtotals of non-void, non-return invoices (contract invoices counted once). Sales Returns (4100) = Σ subtotals of non-void return invoices. Bad Debt (6950) = Σ write-offs. COGS (5000) = Σ issue costs (model, at the average when issued) + Σ subcontract gross. Inventory Adjustments (5100) = −Σ correction value (model). Each expense account = Σ `expenseCost` mapped to it. | exact (5000 and 5100 within E9's tolerance) | no | |
| E13 | Reports against the ledger, figure by figure (R1–R6 below) | as stated per row | never | ADR 0055: reports read documents |
| E14 | Documents ↔ entries: each posted document has exactly the entries its events call for; each entry's `(source_type, source_id)` is a run document; each void, reopen or reject posts exactly its reversal, or nothing if nothing was posted | exact | no | Rule 10 |
| E15 | Derived, not stored: listed invoice and bill state and balance equal the shared derivation; no money table has a stored balance or derived-status column outside a reviewed list | exact | exact | ADR 0013, rule 9 |

**E13, figure by figure** (MI-2). The run stays inside one company day, so inside one month. If it doesn't, E13 is skipped with an annotation.

| Row | Report figure | Compared with | Expected |
| --- | --- | --- | --- |
| R1 | P&L revenue (month) | Ledger: 4000 net credit − 4100 net debit for the month | **Equal.** Check that contract billings and voids count the same way on both sides; any difference is a finding. |
| R2 | P&L cost of goods | Σ signed invoice `cost` of the month's non-void invoices (a document equality, R-EQ style) | **Equal to the documents.** Not compared with ledger 5000, which is E12 (cost at issue). The difference is recorded in the report as "by design, ADR 0055". |
| R3 | P&L expenses | Σ `amount` of `countsAsCost` expenses dated in the month (document) | **Equal to the documents.** Also asserted: ledger expense accounts − P&L expenses = Σ tax of those expenses, exactly. This is finding F-a. |
| R4 | Business report revenue and operating expenses | Ledger 4000/4100, and the expense accounts | **Equal.** The Business report uses `expenseCost`. The builder writes the line-to-account table in the test. |
| R5 | Net figures (P&L net, Business report net) | The report's own lines | **Internal consistency only** (revenue − cost − expenses). Not compared with the ledger, because R2 and R3 differ by design. |
| R6 | Location profits | Company profit | **R-GATE on this company** |

**Known non-equalities**, asserted as such and written into the report:
- Summit's whole-company AR, AP, GRNI, Inventory and Cash don't match its documents (Opening balances).
- Summit's reports don't match its ledger.
- Acting on a seeded document makes them drift (PR #16).
- Ledger 5000 differs from the reports' cost of goods (R2).
- Ledger expenses differ from P&L expenses by the purchase tax (R3, F-a).
- Write-offs reach the ledger (6950) but not the P&L.

### 3.3 Files (all in `apps/api/test/support/` unless marked)
- **`sign-in.ts`:**
  - `enrolled(harness, email): { cookie, secret }`, the pattern at `reports.int.test.ts:231`, also returning the TOTP secret;
  - `stepUp(harness, cookie, secret)`, the pattern in `users.int.test.ts`.
- **`fresh-owner.ts`:**
  - `inviteProvisionedOwner(harness, companyId): token`: inserts a `user_invitations` row for the provisioned Owner through `harness.control.db`, with `tokenHash` imported from `src/modules/users/invitation-rules.ts`, a token from `newInvitationToken()`, and an expiry 7 days out;
  - `acceptInvitation(harness, token)`: `POST /public/invitations/accept` with `{ token, password: PASSWORD }`, expecting 204.

  It stands in for the missing provisioning invitation (G4), with a comment pointing to STATUS:360.
- **`ledger-read.ts`:**
  - `trialBalance(call, cookie)`, by key and code;
  - `unbalancedEntries(db)` (SQL over `journal_lines` grouped by entry: `having sum(debit) <> sum(credit) or count(*) < 2`);
  - `entriesBySource(db)`.
- **`company-bootstrap.ts`:** `bootstrapCompany(harness, companyId)`, by direct inserts only (the pattern at `invoices.int.test.ts:71-131`):
  - two branches, each with a warehouse, plus a showroom;
  - every settings group present in `summit.json` (branding, localization without its tax tables, numbers, payments with `approvalThreshold "500.00"`, inventory, hr, expenses, sharedCosts, meetings, email, profile);
  - one CO tax rule;
  - a boxed tile (`sqFtPerCarton "20"`, cost `"2.1000"`) and a carpet roll product (12 ft wide);
  - no stock and no documents.

  It returns the ids. Labelled "stands in for settings at provisioning (G2)".
- **`money-actions.ts`:** request builders. Bodies are copied from existing tests and checked against the controllers' Zod schemas.
  - Sales: quote, send, accept, invoice; payment with a PDF proof; review; void; credit note; write-off; apply credit; refund; void invoice.
  - Purchasing: PO, order, receipt (partial, damaged); bill (exact or with a variance); supplier payment, review, void.
  - Expenses: paid or on account; approve; void.
  - Stock: issue or cut; stock correction.
  - Contracts: contract, sign, billing, release, void billing; subcontract billing.
  - HR: bonus; contractor payment, pay, void; pay period open, approve, reopen.
  - Settings: `PUT /settings/accounting` with bank accounts (step-up if needed); period close.
- **`money-model.ts`:**
  - the seeded LCG of `postings.test.ts:160`;
  - the step table `{ kind, weight, applicable(state), run(state), allowedRefusals: { status, code, message: RegExp, rule: string }[] }`;
  - the step log, printed with the seed on failure;
  - the average-cost tracker (reads `GET /products` as the Owner before each issue or correction, and checks the next average with `averageCost`);
  - `reconcile(state)`: reads `/invoices`, `/payments`, `/invoice-adjustments`, `/refunds`, `/bills`, `/supplier-payments`, `/receipts`, `/expenses`, `/contract-billings`, `/rolls`, `/stock-movements`, `/products`, `/pay-periods`, `/bonuses` and `/contractor-payments`, and computes E3–E12 with `ledgerIndex`, `customerCredit`, `billLedgerIndex`, `receivedValue`, `inventoryValuation`, `boxedOnHand`, and unclamped twins of the clamped sums;
  - `expectReconciled(state)`.
- **`money-prelude.ts`:** the deterministic prelude (3.4).
- **`json-walk.ts`** (shared with piece 3): `decimalProblems(body)`, `MONEY_KEYS`, `INTEGER_KEYS`.
- **`route-lists.ts`** (shared with piece 3): the reviewed lists, including `DOCUMENT_WRITES` (SH-10).
- **`apps/api/test/money-integrity.int.test.ts`:** MI-1 to MI-3.
- **`apps/api/test/new-company.int.test.ts`:** FA-0 to FA-12 (piece 4a) and MI-4 to MI-9.

Day handling: import `todayIn` from `src/modules/sales/sales-common.ts`. No new copy.

### 3.4 Tests
**`money-integrity.int.test.ts`.** One harness. Company `money<seed>` from `harness.provisionCompany` (America/Chicago), then `bootstrapCompany`.
- **Actors:**
  - the provisioned Owner, through `inviteProvisionedOwner`, `acceptInvitation` and `enrolled`;
  - an Accountant (enrolled), Purchasing, Warehouse (branch 1) and Sales (own scope), all from `harness.addUser`.
- **Customers and suppliers** are created through the API.

- **MI-1, prelude then random tail** (timeout 300 s by default, 1,200 s with `WHOLE_CHECK=1`).
  1. **Prelude** (fixed, valid order; every step must succeed):
     - supplier S1; customers C1 and C2;
     - PO1 (tile and roll) ordered; receipt R1 partial with 2 damaged; receipt R2;
     - bill B1 at value; bill B2 with a variance;
     - supplier payment SP1 confirmed in full on B1; SP2 on B2, then voided; SP3 confirmed;
     - I1 (C1, tile) from a quote; payment P1 over the threshold, confirmed by the Accountant; issue I1's tile;
     - I2 (C1) with payment P2 above its balance (**overpayment**) → customer credit; I3 (C1) with **apply credit**;
     - I4 (C2) with a part payment leaving at most `writeOffMax` → **write-off**;
     - I5 (C2) with a partial **credit note**, then a **refund** of the credit;
     - I6 with payment P4 **rejected**, and payment P5 confirmed then **voided**;
     - I7 (service line only) **voided**;
     - I8 (roll line) paid, then **cut**;
     - expense E1 paid under the threshold; E2 on account and approved; E1 **voided**;
     - a `sales_tax_payment` expense;
     - a stock **correction** (−2 cartons);
     - a payment method moved to another bank (ADR 0040).

     Steps that need a different order are reordered in the build. Each change is recorded.
  2. **Random tail:** `MONEY_STEPS` steps (30 by default, 80 with `WHOLE_CHECK=1`), drawn by weight over the same kinds, with `applicable(state)` preconditions. Negative contract billings are excluded.
  3. **Seeds:** `MONEY_SEEDS` defaults to `20261116`; with `WHOLE_CHECK=1` there are 5 seeds. `MONEY_SEED=<n>` replays one.
  4. **After every step:** E1, E2, and MI-DEC on the step's answers.
  5. **After the prelude, every fifth tail step and at the end:** E3–E12, E14, E15, plus the asserted preconditions (unclamped credit ≥ 0, unclamped bill balance ≥ 0, full allocations, no negative stock).
  6. **Refusals:** in the tail, a refusal passes only if it matches an `allowedRefusals` entry on status, code and message. Each entry names its spec rule, e.g. "a payment void refused while a live credit note exists". Anything else fails with the seed and the step log. The prelude allows none.
  7. **At the end:** a count per event kind (prelude plus tail) is asserted ≥ the prelude's set. The tail's distribution is logged.
- **MI-2 (E13 and R-GATE)** on the same company, after MI-1: R1–R6 as in 3.2. The line-to-account table is in the test.
- **MI-3, decimals:** every money key in every answer seen is a decimal string (`^-?\d+(\.\d+)?$`). Any JSON number sits under `INTEGER_KEYS`.

**`new-company.int.test.ts`**, part 2: money scenarios. Each block provisions and bootstraps its own company. Timeouts are 120 s each.
- **MI-4, contracts:**
  - a customer contract with 10 % retainage: two billings, a release, the last billing voided;
  - one lower-cumulative (negative) billing, with the effect `contractInvoicePosting` documents asserted explicitly;
  - a subcontract with retainage: billing → bill → supplier payment.
  - E3, E6, E7, E12 and E14 hold after each step, and the states are as derived.
- **MI-5, payroll** (the patterns in `payroll.int.test.ts`: `person`, `open`, `approveHours`):
  - an hourly and a salaried person; approved hours; a bonus;
  - an ended period approved, reopened (a reversal) and approved again;
  - a contractor payment paid, then voided.
  - E10, E11, E12 and E14 hold.
- **MI-6, commissions:** only if `commissions.int.test.ts`'s setup can be reused in under 60 lines. A statement is approved, so Accrued Payroll grows by its payable, and the pay run leaves the commission out of Wages (E11). Otherwise the report lists it as covered by that file's deltas only.
- **MI-7, immutability:**
  - every route in `DOCUMENT_WRITES` classed "refused once posted" or "state change only", tried on a document posted here, is refused with its documented status, code and message, or changes no money field and no entry;
  - a second void is refused;
  - entry counts and lines are unchanged;
  - voids post their reversal dated today.

  The DB refusal of UPDATE and DELETE is cited from `packages/db/test/ledger.int.test.ts`. The report says document immutability is API-enforced only.
- **MI-8, closed period** (its own company):
  - an expense dated yesterday posts;
  - the Owner closes through yesterday (`POST /ledger/period-close`, step-up if needed);
  - another expense dated yesterday is refused with 409 `period_closed`;
  - voiding the first expense posts its reversal today;
  - E1 and E2 hold.
- **MI-9, bank accounts:**
  - two bank accounts; check payments go to bank A; the check method moves to bank B;
  - a void of an earlier check payment credits bank A;
  - E10 holds per bank.

### 3.5 Run time (local, M-series, under the heavy lock)
- **`money-integrity`, default** (prelude of about 25 operations plus a 30-step tail, reconcile about 8 times): harness about 8 s, total about 35–45 s.
- **With `WHOLE_CHECK=1`** (5 × (prelude + 80)): about 3–4 min.
- **`new-company`:** about 40 s (FA and MI-4–MI-9 on six small companies).

---

## 4. Piece 3: the permission matrix

### 4.1 What exists, and what the matrix adds
- **Already covered (1.1):**
  - templates are snapshotted;
  - `AccessService` resolution is exact per role;
  - every route declares a permission (as the Manager);
  - every route needs a session and a company;
  - the probe routes cover modules, stripping and deny by default.
- **What the matrix adds:**
  1. Every company route × every default role of both products, decided by the real `TenantGuard` → `PermissionGuard` chain and compared with an oracle built only from packages/shared. The outcome is snapshotted for review.
  2. HTTP agrees with the guards.
  3. Module and product switch states over every route that declares a module.
  4. Feature switches traced and flipped per route.
  5. Sensitive-field stripping (judged by an independent list) and decimal strings over every read route × role, on Summit.
  6. Data-scope samples in one place.
  7. Page gates against the API: PG-4, a static join in the default runs, plus an opt-in runtime matrix (PGM).

  Everything here is a **guard decision**. In-handler rules aren't in the snapshot; the report lists them (SH-4).

### 4.2 `apps/api/test/route-matrix.int.test.ts` (one harness; Summit seeded)
**Support files:**
- **`support/route-catalog.ts`:** `routeCatalog(app)`.
  - Mount `DiscoveryModule` through `harness.start([DiscoveryModule])`.
  - For every controller and handler (`DiscoveryService.getControllers()`, `MetadataScanner`, `PATH_METADATA` and `METHOD_METADATA` from `@nestjs/common/constants`), build an `ExecutionContextHost` (from `@nestjs/core/internal`).
  - Read through the real `core/` readers (read-only imports): `accessLevel`, `requiredProduct`, `permissionRequirement` per method, `anyMember`, `isAudited`, and the handler's `@SensitiveFieldKeys`.
  - The catalog must equal `listRoutes()` (`support/routes.ts`) by method and path, excluding `/docs` and `/api/auth/*`.
- **`support/route-oracle.ts`:** `expectedRefusal(route, roleKey, company)`. It uses only `@workspace/shared` (`resolveAccess`, `roleTemplate`, `permissionsForModules`, `enabledModules`, `PRODUCT_MODULES`, `can`) and never imports `permissionDecision`. The order mirrors the chain:
  1. product (host product, or the route's `@RequireProduct`, not in the company's products) → `product_not_enabled` (TenantGuard);
  2. no keys and not any-member → `permission_undeclared`;
  3. a module is **declared** and isn't enabled → `module_not_enabled`;
  4. no declared key held → `forbidden`;
  5. otherwise pass.

  MFA is held (`mfa = { totp: true, passkeys: 0 }`). The MFA and disabled-profile refusals are covered by existing tests and cited.
- **`support/route-lists.ts`:** the reviewed lists. Each entry has a one-line reason.
  - `NO_MODULE_ROUTES`: users, roles, audit, notifications, outbox, billing, support-grants and imports, as found.
  - `CROSS_MODULE_ROUTES`
  - `WRITE_WITH_VIEW_KEY`
  - `DOCUMENT_WRITES`: every write with a path parameter, classed "reversal", "state change only", "refused once posted", "attachment" or "not a money document".
  - `NO_SWITCH_ROUTES`
  - `SWITCH_READ_IN_SERVICE`
  - `EMPTY_BODY_OK`
  - `QUERY_FOR`
  - `SCOPE_RULES`

**Tests and timeouts:**
- **PM-1, catalog and static invariants** (30 s):
  - **(a)** The catalog equals `listRoutes()`.
  - **(b)** Every company route declares a module, or is in `NO_MODULE_ROUTES` with every declared key in module `platform`, or is any-member. M2 must fail here.
  - **(c)** Every key is in `ALL_PERMISSION_KEYS`.
  - **(d)** Every key's module is the route's module, `core` or `platform`, or the route is in `CROSS_MODULE_ROUTES`.
  - **(e)** Every write declares a non-`.view` key, or is in `WRITE_WITH_VIEW_KEY` (e.g. `POST /meeting-requests`, `/me/*`).
  - **(f)** Every write with a path parameter is in `DOCUMENT_WRITES` (SH-10). Every PUT, PATCH and DELETE is too.
  - **(g)** File snapshot `__snapshots__/route-requirements.json`: per `"VERB /path"`, `{ level, product, module, anyOf, anyMember, audited, sensitiveKeys, features }`, sorted. `features` comes from PM-5. Header line: "guard decisions only; see docs/whole-product-check.md for in-handler rules".
- **PM-2, the guard chain against the oracle** (180 s):
  - Companies: `matrixfl` (flooring) and `matrixhr` (`["hr"]`), with one `addUser` per default role of each product.
  - For each company route × role, the request is `{ method, headers: { [PRODUCT_HEADER]: product }, authSession: { user: { id }, companyId, mfa } }` on one `ExecutionContextHost`. Run `app.get(TenantGuard).canActivate(ctx)`, then `app.get(PermissionGuard).canActivate(ctx)`. The pass, or the refusal code, must equal the oracle.
  - Batches of 8 run in parallel.
  - One extra check: `matrixhr` with the `flooring` host header is refused `product_not_enabled` on every company route.
  - File snapshot `__snapshots__/route-role-matrix.txt`: one line per route, `VERB /path  flooring: owner manager …  hr: owner …`.
  - About 2,500 pairs.
- **PM-3, HTTP agrees** (lite: 120 s):
  - Real cookies, `X-Forwarded-Host`, and `PRODUCT_HEADER: hr` for the HR company.
  - **Lite (default):** the flooring Employee and the HR Employee on every company route.
    - Where the oracle refuses: 403 with the oracle's code and the `PERMISSION_REFUSALS` message.
    - Where it passes: no guard refusal (a service's own 403 has another message), no 2xx to `{}` outside `EMPTY_BODY_OK`, and no 5xx.
    - Path parameters get the nil UUID.
  - **Full (`WHOLE_CHECK=1`, 600 s):** every role, with the MFA roles enrolled through `enrolled`. About 2,500 requests.
- **PM-4, module and product switches** (120 s):
  - For each module declared by at least one route, except `platform` (today core, contracts, hr and meetings), a `tenant_module_overrides` row turns it off for `matrixfl`, as `withModuleOff` does.
  - As the Owner, every route declaring that module answers 403 `module_not_enabled`. The `NO_MODULE_ROUTES` controls (e.g. `GET /users`) are unchanged. The override is removed in `finally`.
  - Asserted by name: retail, wholesale and installation have no routes (finding F-e).
  - In `matrixhr`, as the HR Employee: every route declaring a module outside `PRODUCT_MODULES.hr` answers `module_not_enabled`, and every `@RequireProduct("flooring")` route answers `product_not_enabled`.
- **PM-5, feature switches, traced then flipped** (180 s; company `matrixsw` of its own, so the Owner's writes can't touch the other companies):
  - `vi.mock("@workspace/shared", …)` wraps `featureOn` to record the keys read per request. Every other export and the `FEATURES` object identity are kept.
  - As the enrolled Owner, call every company route once: GET with `QUERY_FOR` where listed; writes with `{}`; path parameters with the nil UUID. That gives route → features read.
  - For each (route, feature) pair: set `FEATURES[f].enabled = false`, call again, restore in `finally`, and record "gating" (it became 404) or "shaping".
  - **Asserts:**
    - every company route has a gating feature, or is in `NO_SWITCH_ROUTES` or `SWITCH_READ_IN_SERVICE` with a reason;
    - no route reads a `removed` feature;
    - no 2xx to `{}` outside `EMPTY_BODY_OK`;
    - features land in `route-requirements.json`.
  - **Limits, written in the report:** the trace sees only `featureOn` calls in `apps/api` made before the first refusal. Calls inside packages/shared aren't traced.
  - **Fallback**, if the mock proves unreliable: map `requireFeature("…")` and `featureOn("…")` literals per controller and service file by grep, and flip only those candidates.

**Summit part (PM-6, PM-7, MI-DEC)**, in the same file and harness, using Summit's seeded personas (one per flooring role; MFA roles enrolled; installer `marcus.bell`).

**Support file `support/json-walk.ts`:**
- a deep walk;
- `MUST_STRIP`: a reviewed list of the fields CLAUDE.md rule 5 names (cost, unitCost, averageCost, landedCost, costPerSqFt, productCost, margin, marginPct, grossMargin, grossMarginPct, jobMargin, jobMarginPct, jobCost, laborCost, payRate, hourlyRate, baseRate, regularRate, salary, salaryAmount, creditLimit, estimatedCost, …), each with its key written out as a string literal;
- `leaks(body, held, routeOwnKeys)`: judged by `MUST_STRIP` ∪ `SENSITIVE_FIELDS`, with the route's own `@SensitiveFieldKeys` taking precedence;
- `decimalProblems(body)`, `MONEY_KEYS` and `INTEGER_KEYS`.

**Tests:**
- **PM-6, data-scope samples** (120 s). Routes: `GET /invoices`, `/payments`, `/quotes`, `/customers`, `/expenses`, `/contracts`, `/employees`, `/timesheets`, `/pto-requests`.
  - Each has a row → `ScopedRow` mapper in `SCOPE_RULES`, written from docs/api-contract.md (`byRep`, `ownOrReports`, sales own and branch) and confirmed in the module service first.
  - **No leak:** every row Priya (sales, own), Luis (manager, Denver), Cole (warehouse, Springs) or Bri (employee, own) sees satisfies `scopeAllows`.
  - **No over-filtering:** where the rule is a plain owner-and-branch rule, the persona's ids equal the Owner's ids filtered by the rule. Other routes get the leak check only and are named in the report.
  - Meetings are excluded (`meetings.int.test.ts`).
- **PM-7, sensitive fields** (180 s). Every GET route with no path parameter × every role the PM-2 oracle lets through, with `QUERY_FOR` queries:
  - `SENSITIVE_FIELDS ⊇ MUST_STRIP`, key by key (M4 must fail here);
  - no field the role lacks appears at any depth;
  - the Owner's answers show each `MUST_STRIP` name at least once, or the name is reported "not exercised";
  - a 400 on a route not in `QUERY_FOR` fails, so nothing counts as "exercised" by mistake.
  - The report lists report-figure names stripping doesn't reserve (`cogs`, `netIncome`, `net`, `amount`: protected by `show` flags; ADR 0055:20) as "covered by R-EQ and reports e2e, not by PM-7".
  - About 350 requests.
- **MI-DEC:** `decimalProblems` over every body PM-7 reads.

**Run time:** about 60–75 s locally by default. With `WHOLE_CHECK=1`, about 30 s more.

### 4.3 Page gates (`apps/web/tests/unit/page-gates.test.ts`, in `pnpm test`)
- **PG-1:** every page rule's keys (`apps/web/src/products/pages.ts`, menus and `SUB_PAGES`) are in `ALL_PERMISSION_KEYS`, and their modules are offered with the product.
- **PG-2:** for each product and role, every item `visibleItems` shows opens through `canOpenPage` (ADR 0008).
- **PG-3:** with `NEXT_PUBLIC_DATA_SOURCE=api`, restored after, file snapshot `apps/web/tests/e2e-api/check/page-gates.json`: product → page (`pageList`) → role → `canOpenPage` with the role's shared access (`resolveAccess` over `permissionsForModules(enabledModules([product], null, []))`).
- **PG-4, the static join (SH-16):** for each flooring page and role that PG-3 allows, every API route the page reaches is allowed for that role in `route-role-matrix.txt`, or the (page, method) pair is in the reviewed `TOLERATED_REFUSALS` with how the page handles it (e.g. "panel hidden on 403"). The pages come from `page-coverage.json`'s methods and their routes from `api-paths.ts`. Pages refused while their routes are all allowed are reported, not failed: a UI stricter than the API is safe.

**Run time:** under 1 s.

---

## 5. Piece 4: a fresh company and the demo script in api mode

### 5.1 Reading
Prove that a brand-new company works end to end, not just seeded Summit:
- provisioned;
- its Owner invited and signed in with MFA;
- the demo script's steps run as far as the API allows.

Provisioning is only possible through `provisionTenant` (G7). G1 blocks the web workspace for any non-demo company. So there are three layers:
- **(a)** an API-level test in the default runs, covering every demo-script step that is on the API, on a bare provisioned company;
- **(b)** an opt-in Playwright spec on the throwaway 5433 database: provision, the real accept page, the UI sign-in with MFA, the G1 evidence, writes and a step-up through the web proxy, then retire;
- **(c)** an opt-in demo-script walk on Summit in api mode, plus a page × persona runtime matrix.

Steps a new company can't do are asserted as they behave today, in tests titled `GAP-Gn …` that link to STATUS. A GAP test pins a 4xx and its exact code. A 5xx always fails (SH-11). When someone fixes the gap, the test fails, and they replace it with the spec's behaviour. `test.fail` is never used.

### 5.2 (a) `new-company.int.test.ts`, part 1 (default runs; timeout 60 s each)
Companies: `harness.provisionCompany("freshfl")` with no bootstrap, and `harness.provisionCompany("freshhr", ["hr"])`.
- **FA-0, GAP-G4:**
  - the provisioned Owner's sign-in is refused, with the exact 4xx code observed;
  - no `user_invitations` row exists for them, and `harness.outbox.sent` has nothing for that email;
  - then `inviteProvisionedOwner` stands in for the missing invitation; `acceptInvitation` answers 204; sign-in works; the Owner is enrolled with `enrolled`;
  - a Manager is added through `POST /users/invite` with a step-up and accepted the same way.
- **FA-1:** `/auth/context` names the new company. `/company/standing` is `full`. `GET /billing` (Owner) shows the trial with no plan.
- **FA-2 (step 16):** `GET /roles` lists the 9 default roles, with the Owner locked. A role change with a step-up is accepted.
- **FA-3 (steps 2 and 7):** `POST /customers`, `/suppliers` and `/supplier-contacts` answer 201. `GET /audit` shows each, with the Owner as actor.
- **FA-4, GAP-G2 (steps 2 and 3):** `POST /quotes` answers 409 `settings_missing`, with the exact message (STATUS:329).
- **FA-5, GAP-G3 (steps 5 and 7):**
  - `GET /locations` and `GET /products` answer `[]`;
  - `POST /purchase-orders` is refused with the exact 4xx found;
  - the route catalog has no location create, and no product create outside `/imports`.
- **FA-6 (step 9):** `POST /expenses` (paid, under the threshold). Whichever behaviour the build finds is asserted exactly:
  - it posts: the trial balance is balanced, Cash and the expense account moved by the amount, and the accounts were made on first posting;
  - or it is refused with an exact GAP-G2 4xx.
- **FA-7 (step 11):** a meeting is created and cancelled, or refused with an exact 4xx GAP.
- **FA-8 (step 10):** `GET /reports/options` and `/reports/pnl` answer zeros, or an exact 4xx GAP. A 5xx fails (STATUS:191).
- **FA-9 (step 14, needs import part 1):** a customers CSV body goes through `POST /imports/check`, then `POST /imports` with a step-up, then `POST /imports/:id/undo`.
- **FA-10 (step 19):** the audit log holds every write above, and nothing of Summit's.
- **FA-11, isolation:** a known Summit invoice id answers 404, and no list shows a Summit id.
- **FA-12 (HR Suite, section 5), in `freshhr`:**
  - `POST /employees` answers 201 or an exact GAP;
  - `GET /pay-periods` answers its exact result;
  - the route the web's `listPayPeriods` uses to open the current period (read it from `api-methods.ts`) answers its exact result (success, or the GAP-G2 code for missing HR settings);
  - `GET /time-off-policies` answers `[]`.

**Run time:** about 15–20 s.

### 5.3 (b) Test-only helpers and the fresh e2e company
**`packages/db/src/testing.ts`** (additive; each helper has a JSDoc saying "Tests only"):
- **Patterns:** `FRESH_SLUG = /^e2efresh[a-z0-9]{6,12}$/` and `FRESH_EMAIL = /^owner\.[a-z0-9]+@fresh\.e2e\.example$/`.
- **Guard used by every helper:**
  - the slug and email must match their patterns;
  - `adminUrl` and `controlUrl` hosts must be `localhost` or `127.0.0.1`;
  - `process.env.DB_PROVIDER` must be unset or `postgres`;
  - Summit and every seeded email are refused.
- **`provisionTestCompany({ controlUrl, adminUrl, encryptionKey }, { slug, ownerEmail, products })`:** calls `provisionTenant` with `PostgresServerProvisioner(adminUrl)` and provider `postgres`, as `harness.provisionCompany` does. It never runs `migrateControl`.
- **`inviteTestOwner(controlUrl, slug): token`:** inserts one `user_invitations` row for the company's Owner, valid 7 days. Only the token's SHA-256 is stored, written with Node's `crypto` exactly as `apps/api/src/modules/users/invitation-rules.ts` `tokenHash` does, with a comment pointing there. It refuses if an open invitation exists. It never logs the token.
- **`retireTestCompany({ controlUrl, adminUrl }, slug)`:**
  - in one control transaction: sets `tenant_databases.deleted_at` and `tenants.deleted_at`, and sets `revoked_at` on open invitations;
  - deletes the Owner's `session`, `two_factor`, `passkey` and credential `account` rows (user and member rows stay, for audit references);
  - then drops the database through the provisioner (`companyDatabaseName(slug)`).
- **`sweepTestCompanies({ controlUrl, adminUrl }, olderThanMs)`:** retires live `e2efresh*` tenants older than the threshold (2 h), left by killed runs.

**`packages/db/test/fresh-company-helpers.int.test.ts`** (default runs; a scratch control, as `provision-tenant.int.test.ts` does; 60 s):
- **FH-1:**
  - provision, then invite: one open invitation, its hash equal to SHA-256 of the token, expiring in 7 days;
  - insert a credential and a session for the Owner as test data;
  - retire: the database is gone; both `deleted_at` are set; the invitation is revoked; no sign-in rows are left;
  - `migrateAllCompanies(control, key)` returns without the retired company and throws nothing (MF-1). M10 must fail here.
- **FH-2:** each helper refuses `summit`, a slug or email outside its pattern, a seeded email, a non-local host and `DB_PROVIDER=neon`.
- **FH-3:** the sweep retires only old `e2efresh*` tenants (one has `created_at` backdated).

About 5–8 s.

**`apps/web/tests/e2e-api/check/opt-in.ts`:**
- `checkOnly()`: `test.skip(process.env.WHOLE_CHECK !== "1", "opt-in: WHOLE_CHECK=1")` at describe level.
- `assertThrowawayDb()`: unless `process.env.CI` is set, refuses unless both database URLs are on `:5433`.

**`apps/web/tests/e2e-api/check/fresh-company.spec.ts`** (`@check`, opt-in, serial, 180 s):
- **FC-0, `beforeAll`:**
  - `assertThrowawayDb()`, then `sweepTestCompanies`;
  - provision `e2efresh<run>` (flooring) with Owner `owner.<run>@fresh.e2e.example`, named "Avery Fresh" (invented);
  - `inviteTestOwner` returns the token.
- **FC-1, the Owner's first sign-in, then GAP-G1:**
  - the Owner opens `/accept-invite?token=…` (the real page, which calls `/api-proxy/public/invitations/…`) and sets a per-run password, `randomBytes(18).toString("base64url")`, never logged;
  - they sign in on `/login`, and the MFA set-up runs (secret kept, codes from `nextCode`);
  - the page shows "Your account is ready, but not this workspace.", and `page.goto("/")` comes back to `/login`;
  - annotation: G1, `api-context.ts:42`.
- **FC-2:** `GET /api-proxy/auth/context` names the new company with MFA ok, and `/api-proxy/company/standing` is `full`.
- **FC-3:** `POST /api-proxy/customers` and `/api-proxy/suppliers` answer 201. `GET /api-proxy/audit` shows both, at or after the run's start.
- **FC-4, a step-up through the proxy:** after import part 1, a customers import is checked, committed with `nextCode(secret)` and undone. Otherwise, a role save with a step-up.
- **FC-5:** `GET /api-proxy/invoices` answers `[]`.
- **FC-9, `afterAll`:** `retireTestCompany` unless `KEEP_FRESH=1`, then `resetAuthState([ownerEmail])`.

About 60–90 s.

### 5.4 (c) The demo script on Summit, and the runtime page-gate matrix (opt-in; needs PR #42's `kit.ts`)
**`apps/web/tests/e2e-api/check/demo-script.spec.ts`** (`@check`):
- It reuses the flows' persona pool and `waitForAnswer` from `tests/e2e-api/flows/kit.ts` (names as merged).
- It adds `INSTALLER_EMAIL` to `accounts.ts` additively, unless the flows already added it.
- `resetAuthState([persona])` runs before each sign-in (SH-18).
- Each step:
  - opens its screen as the script's persona and waits for the screen's own `/api-proxy` answer to be 200;
  - asserts there is no "could not load" state and that the key element is present;
  - reads the page's classification from `page-coverage.json`. A mixed page is annotated with its DemoStore reads and counts as a gap in the report (MF-7).
- **Steps:**
  - **DS-1:** dashboard and Needs attention (Dana). Mixed: it reads quotes, products, customers and locations from DemoStore.
  - **DS-4 (step 4, new):** Dana creates her own quote and invoice through `/api-proxy`, with a service line only and the run id in the names. On screen she saves a **Commission split** and issues a partial **credit note**. The API answers show the split saved and the credit note, with the invoice and customer credit as `invoiceLedger` and `customerCredit` derive them. No seeded document is touched.
  - **DS-6:** Customers and receivables (Dana).
  - **DS-8:** the contracts register; seeded CTR-1001 opened from the API list; read-only views of Schedule of values, Change orders, Lien waivers and Insurance; CTR-1005 (the subcontract) shown awaiting signature. Billing and release are covered by F5. Change-order approval, waiver and insurance writes are listed as "not exercised in api-mode e2e (covered by `contracts.int.test.ts`)".
  - **DS-9:** the expenses list. Manage recurring: if it reads DemoStore (check CV), it is a GAP; otherwise it is opened read-only. The expense and approval are covered by F7 and `expenses.int.test.ts`.
  - **DS-12:** HR → Pay periods (gross by workweek, read-only), and Commissions → Plans, People on plans, Statements (read-only), as Grace or Tamara. Approve, Export and Approve statement are not done on Summit (they would post payroll to the shared company; flows decision 14), and are listed as covered by `payroll.int.test.ts`, `commissions.int.test.ts` and MI-5.
  - **DS-13:** Sales → Team (Dana; `teamCommission`).
  - **DS-19:** the audit log (Dana).
  - **DS-P1:** Priya sees her own customers and quotes, with no `MUST_STRIP` field in any answer.
  - **DS-P2:** Cole sees rolls and Ready to cut, with no cost in any answer.
  - **DS-P3:** Grace sees expenses to approve and the Business report.
  - **DS-P4:** Bri's My portal.
- **Cited, not repeated:**
  - steps 2, 3 and 5: F1;
  - step 7: F2;
  - step 8, billing and release: F5;
  - step 9: F7;
  - step 10: `reports.spec.ts`;
  - step 11: F6 and `meetings.spec.ts`;
  - step 12, review figures: F3 and F4;
  - step 14: the import's api-mode spec, if it lands, else FA-9 and FC-4;
  - step 16: `users.spec.ts` and `login.spec.ts`.

  Their pages' classification also goes in the report.
- **GAP steps on screen:**
  - **DS-G17 and DS-G18** (Number format and Branding): Settings are DemoStore in api mode. The save is asserted not to reach the API: no `/api-proxy` write is seen.
  - **DS-G15** (View as): what api mode does is recorded. The API still answers as the real role.
  - **DS-GB:** the bell and the Outbox show DemoStore rows.
- **Out of reach:** the HR Suite (section 5), because Harbor isn't seeded on 5433 (Q5).

**`apps/web/tests/e2e-api/check/page-gate-matrix.spec.ts`** (`@check`), PGM-1:
- For each of the 9 Summit personas × each flooring page in `page-gates.json` with no `*` segment:
  - expected refused: "You don't have access to this page." shows;
  - expected open: the page renders with no "could not load" state and no `/api-proxy` 403 behind a visible error.
- A tolerated 403 (`seenOrOff`) becomes an annotation and must appear in PG-4's `TOLERATED_REFUSALS`.
- Each persona is signed in once, with `resetAuthState` before and after, and the MFA personas enrolled.

**Run time:** DS about 4 min. PGM about 8–10 min (9 × about 45 pages × about 1.2 s; no rate-limit waits).

---

## 6. Piece 5: the report

### 6.1 `docs/whole-product-check.md` (hand-written from the run results)
1. **Verdict table:** one row per piece, with result, counts, GAP ids, link.
2. **What was checked and how to rerun it:** commands for macOS or Linux and for PowerShell (`WHOLE_CHECK=1` for vitest; `tests/e2e-api/check`), and why the opt-in suites aren't in CI (9.1).
3. **Results:**
   - coverage figures, from `docs/coverage.md`;
   - money: the E1–E15 and R1–R6 tables with pass or fail, seeds and steps, findings;
   - matrix: routes, roles and pairs checked, differences, `NO_MODULE_ROUTES`, `NO_SWITCH_ROUTES`, `SWITCH_READ_IN_SERVICE`, leaks, scope results, "not exercised" names, and the "guard decision only" note with the grep list of in-handler rules (`requireCompanyWide`, Owner-only, separation of duties, data scope);
   - fresh company and demo script: one row per demo-script step (1–19, personas, HR Suite, extras), giving the Summit api-mode coverage (spec or flow id), the page classification (API, mixed or demo), the fresh-company result (FA or FC id) and the gap id;
   - page gates: PG-4 tolerated list, PGM result.
4. **Gaps:**
   - G1: the web workspace for non-demo companies;
   - G2: settings, sequences and tax at provisioning;
   - G3: locations, products and settings not on the API;
   - G4: no Owner invitation at provisioning;
   - G5: Summit masking (mixed pages);
   - G6: HR Suite not exercised in api mode;
   - G7: no API or console path to create a company;
   - plus what the tests find.
5. **Risks:** the residual ones from STATUS, by area, plus section 11.
6. **Follow-ups ranked for P13** (6.2).
7. **Owner questions** (6.3).
8. **Appendix:** commands run with counts and times, mutation results, files added.

### 6.2 Ranking of follow-ups (stated in the report)
Collect every bullet in STATUS "Follow-ups (don't forget)" and "Blockers and open questions" (after both merges), plus new findings. Rank within tiers by severity × likelihood, with one line of reason each.
- **T1, security for P13:**
  - the per-IP limit on `GET /public/branding`;
  - the proof routes parse a 21 MB body before the cookie is verified;
  - the CREATE ROLE password in DDL logs;
  - the trial balance shows COGS and Wages to `reports.financial.view` holders;
  - subcontract billing amounts visible to Sales;
  - separation-of-duties gaps;
  - `settings.company.manage` and MFA;
  - any leak, scope or switch finding from PM-5, PM-6 or PM-7.
- **T2, money integrity:**
  - the opening-balance entry;
  - documents that never posted;
  - `credit_note_id`;
  - refund date bounds;
  - the bill price variance;
  - Accrued Payroll is never paid out;
  - F-a, P&L expenses without purchase tax;
  - the float uses in UI money code (UI-1);
  - any E or R row failure.
- **T3, real-company readiness:** G1–G4, G7, the company's day on the client, G6.
- **T4, robustness and operations:**
  - pools after a provider move;
  - orphaned roles;
  - concurrent provisioning;
  - CHECK constraints;
  - F-c, retirement and `tenant_databases`;
  - F-b, Turbo transit node;
  - the merge methods and the required check;
  - test-helper duplication.
- **T5, UX and minor:**
  - destructive-button contrast;
  - the flaky purchasing phone test;
  - F-d, refusal wording on module-less routes;
  - F-e, modules with no routes.

### 6.3 Owner questions
- **Sources:** every "Owner question(s)", "For the owner" and "Accountant question(s)" item in STATUS and ADRs 0039–0058, the flows plan's Q1–Q5, and ADR 0057's questions.
- **Format:** de-duplicated into one numbered table: # | question | source | area | blocks P13 (yes or no).
- **New ones:** section 12.

### 6.4 Other docs
- **ADR 0058:**
  - context;
  - decisions S-1 to S-16 (section 10);
  - the generated artifacts and how to regenerate them;
  - the opt-in flag;
  - the test-only helpers, and why they follow the decision rule (SH-14);
  - consequences: every PR that adds a route or client method regenerates `route-requirements.json`, `route-role-matrix.txt`, `docs/coverage.md`, `page-coverage.json` and `page-gates.json`;
  - residual risks.
- **`docs/blueprint-delta.md`:** one row dated with the build day, keys `—`: "Whole-product check: generated coverage list, route and page matrices in the default tests; long money runs and the e2e check suites opt-in (`WHOLE_CHECK=1`), run before P13's full regression (real-build-plan week 20); ADR 0058." The plan of record changes in two places: the CI budget assumptions, and what "full regression" means.
- **`docs/real-build-plan.md`:**
  - the CI budget table gets the measured verify minutes (9.4);
  - week 20, "full regression", gets "including the whole-product check suites (`WHOLE_CHECK=1`)".
- **`docs/STATUS.md`:**
  - a Done entry;
  - "Next three tasks" item 3 marked done;
  - each finding and gap as a follow-up;
  - the owner questions under Blockers.
- **`docs/BRANCHES.md`:** the branch row.
- STATUS and BRANCHES go in the handoff commit, unless the orchestrating session keeps them, as it did for PR #40.

---

## 7. Money in the UI (UI-1, `apps/web/tests/unit/money-in-ui.test.ts`, in `pnpm test`)
- The scan covers `apps/web/src/{features,components,app}`.
- `parseFloat(` must never appear.
- `Number(` and unary `+` on an expression whose text matches `/amount|total|price|cost|qty|quantity|sales|revenue|pct|rate|balance|paid|hours/i` must be in the reviewed `KNOWN_FLOAT_USES`, each tied to a STATUS follow-up. Seen today:
  - `features/invoices/invoice-stock.tsx:132`;
  - `features/sales/team-table.tsx:52`;
  - `features/invoices/commission-split-dialog.tsx:41`.

  They are money and commission code, so they become follow-ups, not fixes.
- `toFixed` is already banned by ESLint (`apps/web/eslint.config.mjs:28-31`).

---

## 8. New and changed files

| File | Kind | Stage |
| --- | --- | --- |
| `apps/api/test/support/{sign-in,fresh-owner,route-catalog,route-oracle,route-lists,json-walk}.ts` | test support | 1–2 |
| `apps/api/test/route-matrix.int.test.ts`, `__snapshots__/route-requirements.json`, `__snapshots__/route-role-matrix.txt` | test and snapshots | 1–2 |
| `apps/api/test/support/{ledger-read,company-bootstrap,money-actions,money-model,money-prelude}.ts` | test support | 3 |
| `apps/api/test/money-integrity.int.test.ts` | test | 3 |
| `apps/api/test/new-company.int.test.ts` | test | 3–4 |
| `apps/web/tests/unit/coverage/{scan,api-paths,demo-only,spec-features,test-index,render}.ts`, `coverage-list.test.ts`, `page-gates.test.ts`, `money-in-ui.test.ts` | test | 5 |
| `docs/coverage.md`, `apps/web/tests/e2e-api/check/page-coverage.json`, `apps/web/tests/e2e-api/check/page-gates.json` | generated | 5 (refreshed at 6–8) |
| `turbo.json`, `.prettierignore` | tooling | 5 |
| `packages/db/src/testing.ts` (additive), `packages/db/test/fresh-company-helpers.int.test.ts` | test helper and test | 6 |
| `apps/web/tests/e2e-api/check/{opt-in.ts,fresh-company.spec.ts}`, `apps/web/playwright.api.config.ts` (docblock lines only) | e2e | 6 |
| `apps/web/tests/e2e-api/check/{demo-script.spec.ts,page-gate-matrix.spec.ts}`, `apps/web/tests/e2e-api/accounts.ts` (additive `INSTALLER_EMAIL`, if needed) | e2e | 7 |
| `docs/whole-product-check.md`, `docs/adr/0058-whole-product-check.md`, `docs/blueprint-delta.md`, `docs/real-build-plan.md`, the session log, `docs/STATUS.md`, `docs/BRANCHES.md` | docs | 0, 8, 9 |

---

## 9. CI placement, minutes, and the measurement gate

### 9.1 Placement

| Tier | Suites | Runs in | Local time | CI added per run (est.) |
| --- | --- | --- | --- | --- |
| Unit | CV-1–CV-8, PG-1–PG-4, UI-1 | `pnpm test`, so `fast` and `verify` | about 3 s | +3 to 6 s per job |
| A (always in verify) | PM-1, PM-2, PM-4; FA-0–FA-12; MI-1 prelude only; MI-2, MI-3; MI-4–MI-9; FH-1–FH-3 | `pnpm test:api` | about 70 s summed | about +1 to 1.5 min |
| B (verify if the gate allows, else `WHOLE_CHECK`) | PM-3 lite, PM-5, PM-6, PM-7, MI-DEC, and MI-1's 30-step tail | `pnpm test:api` | about 60 s summed | about +1 to 1.5 min |
| C (always opt-in) | PM-3 full; MI-1 with 5 seeds × 80 steps; `tests/e2e-api/check/*` (FC, DS, PGM) | `WHOLE_CHECK=1`, locally and before P13 | about +4 min of integration, plus about 15 min of e2e, plus builds | 0 (the specs show as skipped) |

- **Mechanism:** `describe.runIf(process.env.WHOLE_CHECK === "1")` for tier C. Tier B uses `runIf(process.env.WHOLE_CHECK === "1" || TIER_B_DEFAULT)`, where `TIER_B_DEFAULT` is a constant in `route-lists.ts`. The gate flips it in one commit. `MONEY_STEPS` defaults to 30, or to 0 when tier B is off.
- **Monthly minutes** (verify runs about 23 times a month: 14 on PRs, 9 on main): A+B costs about +46 to +70; A alone about +23 to +35. `fast` gets about +15, or up to about +300 in the worst case if every run crosses a minute boundary. This is checked after the merge.
- **Why the e2e checks are opt-in:** verify already takes 15–19.4 of its 25 minutes, and the flows add 6–9 to the same Playwright step. Changing the workflow is the owner's call (Q1).

### 9.2 Making the drift guard sound under Turbo (`turbo.json`, MF-8)
- **`web#test`:** `"inputs"` gets:
  - `$TURBO_DEFAULT$`
  - `$TURBO_ROOT$/docs/coverage.md`
  - `$TURBO_ROOT$/docs/product-spec/**`
  - `$TURBO_ROOT$/docs/specs/platform-admin.md`
  - `$TURBO_ROOT$/docs/specs/settings-users-access.md`
  - `$TURBO_ROOT$/packages/shared/src/**`
  - `$TURBO_ROOT$/packages/shared/test/**`
  - `$TURBO_ROOT$/apps/api/test/**`

  Turbo 2.11.10 supports `$TURBO_ROOT$`.
- **`@workspace/shared#test`:** `"inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/docs/FEATURES.md"]`. This fixes the same latent gap for `features.test.ts`.
- **`test:api.passThroughEnv`:** add `WHOLE_CHECK`, `MONEY_SEEDS`, `MONEY_STEPS` and `MONEY_SEED`.
- **Hash check (stage 5):** for each of `docs/coverage.md`, `packages/shared/src/features.ts` and `apps/api/test/isolation.int.test.ts`:
  - append a newline;
  - read the `web#test` hash;
  - `git checkout -- <file>`;
  - each must change the hash.
- The broader gap (web and api unit tests not rerun on shared-only changes, fixtures included) is finding F-b and owner question Q6. The cache is never turned off.

### 9.3 `.prettierignore`
Add `apps/api/test/__snapshots__/*.json`, `apps/web/tests/e2e-api/check/page-gates.json` and `apps/web/tests/e2e-api/check/page-coverage.json`. These are generated with `JSON.stringify(…, null, 2)`, and Prettier would collapse the short arrays. `*.md` and `*.txt` are already outside Prettier.

### 9.4 Measurement gate
1. **Before `gh pr ready`:**
   1. Read the latest verify on main: `gh run list --workflow ci.yml --branch main --limit 3 --json databaseId,conclusion,createdAt,updatedAt`, then `gh run view <id> --json jobs`. Note the total and the "API and database tests" step.
   2. Locally, measure the `apps/api` integration wall time with and without the new files (`$C/int.sh` with `--exclude`, both under the lock), and the same for `packages/db`.
   3. Project the CI increase as (local delta) × (CI API step ÷ local full wall), from the same main head.
   4. **If the projected verify is over 20 minutes** (the flows guard's line): set `TIER_B_DEFAULT = false`, record it in ADR 0058 and the session log, and raise Q1.
   5. **If main's verify is already above 20 minutes** (for example, the flows merged by owner decision): tier B is off from the start.
2. **After the ready run:**
   - Check that the first `fast` run after the `turbo.json` change (a full cache miss) finished inside its 6 minutes.
   - If verify took over 22 minutes or timed out, turn tier B off in a new commit and let CI run again. That costs about 40 CI minutes and is recorded.
   - Below 22 minutes, nothing changes. The 2-minute margin absorbs runner variance.

---

## 10. Safest options taken (for ADR 0058 and the session log)
- **S-1:** The new Playwright specs and the long variants are opt-in (`WHOLE_CHECK=1`). The default runs carry bounded guards in tiers A and B. Reason: verify is near its timeout.
- **S-2:** No product change. Gaps are asserted as they behave today, in `GAP-Gn` tests that pin a 4xx with its exact code. A 5xx always fails. `test.fail` is never used.
- **S-3:** The money equalities are proven on an API-only company. Summit's non-equalities, and the by-design report-to-ledger differences, are stated and asserted.
- **S-4:** The matrix oracle uses only packages/shared, never `permissionDecision`. The real guard chain is the defendant. Outcomes are reviewed snapshots.
- **S-5:** The generated artifacts are vitest file snapshots. CI never writes them, and they carry no dates or line numbers.
- **S-6:** `turbo.json` gets inputs for every file the drift guards read, packages/shared included. The cache is never disabled.
- **S-7:** Test-only provisioning helpers:
  - patterns, local hosts only, `postgres` only;
  - Summit and seeded users refused;
  - no password or token logged;
  - **no helper writes a credential**: the Owner sets a password through the product's invitation acceptance.

  The e2e refuses unless both URLs are on `:5433` or CI is set. `migrateControl` is never run from a test.
- **S-8:** Retirement soft-deletes `tenant_databases` and `tenants`, revokes invitations, removes sign-in rows, then drops the database. `migrateAllCompanies` skips it, and this is proven. Leftovers older than 2 h are swept. `KEEP_FRESH=1` keeps a company for debugging.
- **S-9:** No `.github`, `CLAUDE.md` or `.claude/` change. CI and process questions go to the owner.
- **S-10:** Existing tests are not refactored. The copies of `enrolled`, `balances` and `moved` in older files become a follow-up.
- **S-11:** Every demo-only method has a reason and a STATUS reference. A new demo-only call fails until someone decides.
- **S-12:** Float use in UI money code is listed and followed up, not fixed.
- **S-13:** Merge without `--delete-branch`.
- **S-14:** The money run's prelude guarantees every event kind. Refusals match status, code and message, so a weak generator or an unexpected rule can't pass quietly.
- **S-15:** Coverage reads code and file names only, never doc contents, because docs-only PRs skip CI.
- **S-16:** DS and PGM wait for the flows PR rather than duplicate its kit.

## 11. Risks
1. **The verify timeout after the flows PR.** The 9.4 gate and Q1 address it. Worst case: one extra CI round of about 40 minutes.
2. **Churn for other builders.** Five generated artifacts must be regenerated by any PR that adds a route, a client method, a page rule or a role change. The failure messages say how. Covered by ADR 0058 and Q4.
3. **Static scans are regex-based.** CV-8 and the reviewed lists limit false negatives. Routes with no test literal are "needs a look", not failures. Pages are judged per page, not per `?view=`.
4. **The feature trace** sees only `apps/api` reads before the first refusal. Service-side reads are listed and traced by hand.
5. **The E9 tolerance.** A run that exceeds it is a finding; the tolerance is never widened.
6. **Company-day flake.** Money and FA runs use America/Chicago. A run crossing midnight there fails clearly through the same-day check. CI's verify has no retry for integration tests, so a rerun is manual.
7. **Provisioning on 5433.** A killed run leaves a database until the next sweep. Summit and the seed are never touched.
8. **The auth-adjacent helper `inviteTestOwner`.** It is guarded and security-reviewed, and lint bans `@workspace/db/testing` in API and web `src`.
9. **Summit masking** stays for every api-mode spec but the fresh-company one. Mixed pages are reported as gaps.
10. **Size.** Each stage is useful on its own. If the usage limit nears, `/handoff` after the current stage, and the report marks the missing pieces.
11. **R1 (meetings) and DemoStore-derived client keys** may make PGM disagree for reasons outside this branch. Mismatches are reported, not fixed.
12. **PM-2 run time on CI** (about 2,500 pairs × 2 guards). If it passes 90 s on CI, batch per (company, role) and keep the full chain. Shortcutting the guards is never allowed.

## 12. Owner questions (new)
- **Q1, CI.** How should the opt-in check suites run in CI, and how should verify stay under its timeout? Options: a manual or nightly `workflow_dispatch` job; raise verify's timeout; move the api-mode Playwright step into `e2e`. All are `.github` changes the owner makes.
- **Q2, onboarding.** In what order, and before P13 or at launch: G1 (web workspace for non-demo companies), G2 (settings, sequences, tax at provisioning), G3 (locations, products, settings on the API), G4 (the Owner's invitation at provisioning) and G7 (creating a company from the console)?
- **Q3, accountant:**
  - should a "payroll paid" posting exist (cash against Accrued Payroll)?
  - which account takes the bill price variance?
  - should P&L expenses include purchase tax, as the Business report and ledger do (F-a; finance-expenses rule 1)?
- **Q4, process.** Should regenerating the coverage and matrix artifacts go into the CLAUDE.md workflow, `/feature` and `/review`?
- **Q5, HR Suite in api mode.** Seed Harbor Staffing in the api-mode e2e database, so section 5 can run?
- **Q6, Turbo.** Add a transit node (or `dependsOn`) so unit tests rerun on packages/shared-only changes (F-b)?
- **Q7, process rules (SH-14).** Is it acceptable to add test-only helpers in `packages/db/src/testing.ts` that provision, invite and retire companies (auth- and provider-adjacent), and to use ADR 0058 instead of a `docs/specs` draft for a tests-only task? Both were done under the decision rule, following `resetAuthState` and `setPlatformAdmin`.
- **Q8, company deletion.** Should real company deletion also set `tenant_databases.deleted_at`, since `pnpm db:migrate` reads only that column (F-c)?

## 13. Re-check once import (#41) and flows (#42) merge (stage 0, step 4)

**Import, PR #41:**
- Route count (207 expected); `API_METHODS` count (157 expected).
- `imports.controller.ts` has no `@RequireModule` and uses `settings.import.manage` (`platform`), so it belongs in `NO_MODULE_ROUTES`.
- The exact paths `GET /imports`, `POST /imports/check`, `POST /imports`, `POST /imports/:id/undo` and `PUT /imports/mappings/:kind`, and whether they need a step-up.
- Whether an api-mode `import.spec.ts` landed (step 14's citation).
- `apps/api/test/support/summit-tables.ts`: reuse it for PM-6 where it fits.
- ADR 0057's number and "For the owner" items.
- STATUS changes, including the opening-balance stance.
- Whether imports post journal entries. If they do, FA-9's effect on E2 is asserted.

**Flows, PR #42:**
- `kit.ts` (persona pool, `waitForAnswer`, sign-in and enrol helpers), `checks.ts`, `ledger.ts` (`ledgerDelta`), `accounts.ts` additions (installer email?).
- The `@flow` tag.
- The flows' CI decision (Q1): whether verify grew, or the flows moved.
- The measured verify on the merged main, which sets tier B.
- `playwright.api.config.ts` docblock (merge, don't overwrite).
- Flows' coverage of steps 2, 3, 5, 7, 8, 9, 11 and 12 as merged: the DS "cited" list follows what actually landed.

**Both:**
- ADR numbering (0058 free?).
- The STATUS "Next three tasks" wording.
- The owner questions to collect.
- No new routes without a module or switch that the reviewed lists don't yet cover: `-u` shows them.

## 14. Findings to verify in the build (from the critique and the re-check)

| Id | Finding | Evidence | Next step |
| --- | --- | --- | --- |
| F-a | P&L expenses leave out purchase tax; the Business report and the ledger include it | `analytics.ts:128` vs `expenses.ts:28`, `business-report.ts:371` | Money area: STATUS follow-up and Q3, no fix |
| F-b | Turbo doesn't rerun web or api unit tests on a packages/shared-only change | `turbo.json` (no `dependsOn` on `test`) | Q6 |
| F-c | A retired company with a live `tenant_databases` row breaks `pnpm db:migrate` | `migrate.ts:128-131,149-160` | Handled in the helper; Q8 for real deletion |
| F-d | Routes with no `@RequireModule` answer `forbidden`, not `module_not_enabled`, when a module is off | `permission.decorators.ts:61-66`; `engine.ts:25-38` | Wording only, no exposure: T5 |
| F-e | `retail`, `wholesale` and `installation` have permission keys but no routes | `catalog.ts:40-46`; PM-4 | Report it (coverage) |
| F-f | No route creates a company; the console can't provision (G7) | `platform.controller.ts`, `company-status.controller.ts`; STATUS:422 | T3, Q2 |

---

## 15. Build stages, one commit each, with exact commands

**Rules for every stage:**
- Each Bash call starts with `cd /Users/sarah/dev/flooring-platform-check &&`.
- Each commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stage commits carry `[skip ci]`; the handoff commit doesn't.
- Push after each commit, on its own: `git push -q origin feat/check-whole-product`.
- **Before each commit:**
  - `$S/heavy.sh pnpm --filter <pkg> lint` and `$S/heavy.sh pnpm --filter <pkg> typecheck` for each touched package;
  - `pnpm exec prettier --check <changed non-md files>`.
- **Scope check:** `git diff --stat origin/main -- apps/web/src apps/api/src packages/shared/src .github CLAUDE.md .claude` must be empty, except a recorded product-fix commit. `git diff origin/main -- packages/db/src` must touch `testing.ts` only.

### Stage 0: worktree, scripts, plan, draft PR
1. **Preconditions:** `git -C /Users/sarah/dev/flooring-platform fetch -q origin && git -C /Users/sarah/dev/flooring-platform log --oneline -8 origin/main` and `gh pr view 41 --json state,mergedAt` and `gh pr view 42 --json state,mergedAt`.
   - Both merged: normal order.
   - Only #41 merged: the SH-1 fallback (section 0).
   - #41 not merged: stop and report.
2. `git -C /Users/sarah/dev/flooring-platform worktree add -b feat/check-whole-product /Users/sarah/dev/flooring-platform-check origin/main`
3. `cd /Users/sarah/dev/flooring-platform-check && pnpm install --frozen-lockfile > $C/install.log 2>&1`
4. **Re-read** (section 13): the import and flows session logs, STATUS, ADR 0057, `flows/kit.ts`, `checks.ts`, `ledger.ts`, `accounts.ts`, `ci.yml`. Record every name change in the session log's "What changed from the plan".
5. **Scratch scripts** (not committed):
   - **`$C/ports.sh`:** a copy of `$S/platform2/ports.sh` with `R=/Users/sarah/dev/flooring-platform-check`.
   - **`$C/int.sh <label> <pkgdir> [vitest args…]`:**
     - `source $S/reports/int-env.sh` (never echoed);
     - `cd $W/<pkgdir>`;
     - `pnpm -s exec vitest run --project integration "$@" > $C/logs/<label>.log 2>&1`;
     - prints the exit code, seconds, and the `Test Files`/`Tests`/`×` lines only.
   - **`$C/api-e2e.sh <label> [--build] [-- <playwright args>]`:** modelled on `$S/reports/e2e-api.sh`.
     - `free_ports` must succeed;
     - `docker exec fp-e2e-worktree pg_isready -U postgres -d control`;
     - `source $S/meet3/e2e-env.sh`;
     - a `case` check that both URLs contain `localhost:5433/` or `127.0.0.1:5433/`, else exit 4;
     - optional builds: `pnpm -s --filter api build`, then `NEXT_PUBLIC_DATA_SOURCE=api pnpm -s --filter web build`;
     - `cd apps/web && pnpm -s exec playwright test --config playwright.api.config.ts "$@"` to `$C/logs/<label>.log`;
     - prints the summary and the time;
     - a `trap` checks that ports 3000 and 4000 are free afterwards.
   - **`$C/full.sh`:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:api` and `pnpm test:hooks`, with `int-env.sh` sourced, each logged to `$C/logs/full-*.log` with counts (modelled on `$S/reports/full.sh`).
   - **`$C/turbo-hash.sh <file>`:** prints the `web#test` hash, appends a newline to `<file>`, prints the hash again, runs `git checkout -- <file>`, and checks `git status --short` is clean. The hash is read with `pnpm -s exec turbo run test --filter web --dry=json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tasks.find(t=>t.taskId==="web#test").hash))'`.
   - **`$C/mutate.sh`:** see stage 8.
6. Write the session log: prompt, inputs, this plan in short, and the "What changed" table.
7. Commit `docs(check): plan the whole-product check [skip ci]`, then push.
8. Open the draft PR: `gh pr create --draft --base main --head feat/check-whole-product --title "test(check): whole-product check (coverage list, money integrity, permission matrix, fresh company, report)" --body-file $C/pr-body.md`. The body ends with "🤖 Generated with [Claude Code](https://claude.com/claude-code)".

### Stage 1: route catalog and the guard matrix (PM-1 to PM-5)
- **Files:** `support/{sign-in,route-catalog,route-oracle,route-lists}.ts`, `route-matrix.int.test.ts` (PM-1–PM-5).
- **Run:**
  - `$S/heavy.sh $C/int.sh pm-u apps/api test/route-matrix.int.test.ts -u` writes the two snapshots;
  - then twice without `-u`: `pm-a`, `pm-b`;
  - then `WHOLE_CHECK=1 $S/heavy.sh $C/int.sh pm-full apps/api test/route-matrix.int.test.ts`.
- **Review by hand:** `NO_MODULE_ROUTES`, `CROSS_MODULE_ROUTES`, `WRITE_WITH_VIEW_KEY`, `DOCUMENT_WRITES`, `NO_SWITCH_ROUTES`, `SWITCH_READ_IN_SERVICE` and `EMPTY_BODY_OK`, each entry with a reason. Each surprise is a finding.
- **Also run:** `$S/heavy.sh $C/int.sh perm-iso apps/api test/permissions.int.test.ts test/isolation.int.test.ts`.
- **Commit:** `test(api): route catalog and guard matrix against the shared engine [skip ci]`.

### Stage 2: Summit sweep (PM-6, PM-7, MI-DEC)
- **Files:** `support/json-walk.ts`; PM-6, PM-7 and MI-DEC added to `route-matrix.int.test.ts`; `QUERY_FOR`, `SCOPE_RULES` and `MUST_STRIP`.
- **Run:** `rs-a` and `rs-b` (same command as stage 1, without `-u`, after a `-u` if the snapshots change).
- **Record:** every `INTEGER_KEYS` entry and every "not exercised" name.
- **Commit:** `test(api): sensitive-field, decimal and data-scope sweep over every read [skip ci]`.

### Stage 3: money integrity
- **Files:** `support/{ledger-read,company-bootstrap,money-actions,money-model,money-prelude,fresh-owner}.ts`, `money-integrity.int.test.ts`, and `new-company.int.test.ts` (MI-4–MI-9 part).
- **Run:**
  - the default twice: `$S/heavy.sh $C/int.sh mi-a apps/api test/money-integrity.int.test.ts test/new-company.int.test.ts`, then `mi-b`;
  - `WHOLE_CHECK=1 … mi-long`;
  - `MONEY_SEED=<a seed from mi-long> … mi-replay`, which must log the same step sequence.
- **Commits:**
  - 3a: `test(api): money integrity on an API-only company (prelude and random runs) [skip ci]`;
  - 3b: `test(api): money scenarios on new companies (contracts, payroll, immutability, closed period, banks) [skip ci]`.

### Stage 4: a bare new company on the API (FA)
- **Files:** the FA describe in `new-company.int.test.ts`.
- **Run:** `fa-a` and `fa-b` (`test/new-company.int.test.ts`).
- **Commit:** `test(api): a bare new company on the API, with its known gaps [skip ci]`.

### Stage 5: generated coverage list, page gates, money in UI, Turbo
- **Files:** `apps/web/tests/unit/coverage/*`, `coverage-list.test.ts`, `page-gates.test.ts`, `money-in-ui.test.ts`, `docs/coverage.md`, `page-coverage.json`, `page-gates.json`, `turbo.json`, `.prettierignore`.
- **Run:**
  - `$S/heavy.sh pnpm --filter web exec vitest run tests/unit/coverage-list.test.ts tests/unit/page-gates.test.ts -u`, then again without `-u`;
  - `$S/heavy.sh pnpm --filter web test`;
  - `$C/turbo-hash.sh docs/coverage.md`, `$C/turbo-hash.sh packages/shared/src/features.ts` and `$C/turbo-hash.sh apps/api/test/isolation.int.test.ts`: each hash must change, and the tree must be clean after.
- **Review by hand:** `DEMO_ONLY`, `SPEC_FEATURES`, `TOLERATED_REFUSALS` and `KNOWN_FLOAT_USES`, each with a reason and a STATUS reference.
- **Commit:** `test(web): generated coverage list, page gates and the money-in-UI scan [skip ci]`.

### Stage 6: fresh-company helpers and the fresh e2e company (opt-in)
- **Files:** the `testing.ts` helpers, `fresh-company-helpers.int.test.ts`, `check/opt-in.ts`, `check/fresh-company.spec.ts`, the `playwright.api.config.ts` docblock.
- **Run:**
  1. `$S/heavy.sh $C/int.sh fh packages/db test/fresh-company-helpers.int.test.ts`.
  2. `$S/heavy.sh $C/api-e2e.sh e2e-default --build` runs the whole api-mode suite without the flag, as CI does. Every existing test passes, and `check/` shows as skipped.
  3. `WHOLE_CHECK=1 $S/heavy.sh $C/api-e2e.sh fc-a -- tests/e2e-api/check/fresh-company.spec.ts`, then `fc-b`.
  4. After `fc-b`, run `docker exec fp-e2e-worktree psql -U postgres -d control -tAc "select count(*) from tenants t join tenant_databases d on d.tenant_id = t.id where t.slug like 'e2efresh%' and (t.deleted_at is null or d.deleted_at is null)"`. It must print 0. This is a read-only query on the throwaway database.
  5. Regenerate the coverage snapshots (`-u`, as in stage 5), because new test files now exist.
- **Commit:** `test(e2e-api): fresh company end to end with its gaps (opt-in) [skip ci]`.

### Stage 7: demo-script walk and the runtime page-gate matrix (opt-in; needs PR #42)
- **Files:** `check/demo-script.spec.ts`, `check/page-gate-matrix.spec.ts`, `accounts.ts` (additive, if needed).
- **Run:**
  - `WHOLE_CHECK=1 $S/heavy.sh $C/api-e2e.sh ds-a -- tests/e2e-api/check/demo-script.spec.ts`;
  - `WHOLE_CHECK=1 … pgm-a -- tests/e2e-api/check/page-gate-matrix.spec.ts`;
  - regenerate the coverage snapshots.
- **Commit:** `test(e2e-api): demo-script walk and page-gate matrix in api mode (opt-in) [skip ci]`.
- **Fallback (flows not merged):** skip this stage. The report says "waiting for PR #42". Add it in a later commit or follow-up PR.

### Stage 8: whole runs, mutations, the gate, the report
1. `$S/heavy.sh $C/full.sh`, recording the counts.
2. `WHOLE_CHECK=1 $S/heavy.sh $C/int.sh whole-api apps/api test/route-matrix.int.test.ts test/money-integrity.int.test.ts test/new-company.int.test.ts`
3. `WHOLE_CHECK=1 $S/heavy.sh $C/api-e2e.sh whole-e2e` runs the whole api-mode suite with the check specs, once.
4. **Mutation checks**, `$S/heavy.sh $C/mutate.sh`, in the worktree.
   - Each mutation is applied with `sed`, the named test is run, and the mutation is reverted with `git checkout -- <paths>`. `git status --short` must be clean after. Nothing is committed.
   - Each mutation must make its named test fail:
     - **M1:** one `@RequirePermission` key changed on `GET /expenses`. `route-role-matrix.txt` and `route-requirements.json` must fail.
     - **M2:** `@RequireModule("contracts")` removed. PM-1(b), PM-4 and `route-requirements.json` must fail.
     - **M3:** one `requireFeature("finance.expenses")` removed. PM-5 must fail.
     - **M4:** `unitCost` removed from `SENSITIVE_FIELDS`. PM-7 must fail, through the `MUST_STRIP` superset check and the leak to Sales.
     - **M5:** in `paymentPosting`, an overpayment sent to AR. MI-1's prelude E3/E4 must fail.
     - **M6:** the refund's `ledger.post` skipped. E4, E10 and E14 must fail.
     - **M7:** `listOutbox` removed from `DEMO_ONLY`. CV-1 must fail.
     - **M8:** one `API_METHODS` path changed to `/expensez`. CV-4 must fail.
     - **M9:** one page rule's key changed in `apps/web/src/products/pages.ts`. PG-3 (`page-gates.json`) and PG-4 must fail.
     - **M10:** `retireTestCompany` stops setting `tenant_databases.deleted_at`. FH-1 must fail.
5. **The 9.4 gate, steps 1.1–1.5.** If tier B is turned off, commit `test(check): keep the long default sweeps opt-in to fit verify [skip ci]`.
6. **Write the docs:** `docs/whole-product-check.md`, ADR 0058, the blueprint-delta row and the real-build-plan lines. In the session log: results, timings, findings, mutation results, and the "What changed from the plan" table.
7. **If main moved:** `git fetch -q origin && git merge origin/main`. Regenerate all five artifacts, rerun steps 1–3, and rebuild for e2e.
8. Commit `docs(check): the whole-product check report, ADR 0058 and follow-ups [skip ci]`, then push.

### Stage 9: review, handoff, ready, merge
1. Run `/review` on the branch.
2. **Reviewers**, each fresh, read-only and running alone:
   - **security-reviewer:** the permission, stripping and money tests; the test-only provisioning, invitation and retirement helpers; the throwaway-database guards; `turbo.json`.
   - **schema-reviewer:** the `packages/db` changes. There is no schema change. It checks the guards, that the helpers aren't reachable from product code (lint bans `@workspace/db/testing` in API and web `src`), and the retirement transaction.
3. Fix anything blocking in new `[skip ci]` commits, and rerun the affected stage's commands.
4. Post the reviewers' summary: `gh pr review <n> --comment --body-file $C/review-body.md`.
5. **Handoff commit** (`/handoff`): close the session log; update STATUS and BRANCHES per the orchestrator's rule. No `[skip ci]`. Push. `fast` runs. Check it stays under 6 minutes (Turbo's full cache miss).
6. Mark ready: `gh pr ready <n>`.
7. `$S/ci-wait.sh <n> <sha>`: `verify` and `e2e` must be green on the latest head, and `fast` too if it ran. Then apply the post-ready rule in 9.4 step 2. On a third-party outage, retry once after 30 minutes.
8. Merge, run alone: `gh pr merge <n> --squash --match-head-commit <sha>`.
   - No `--delete-branch`: in a worktree it removes the worktree, and delete pushes are blocked. The remote branch stays, and BRANCHES says so.
   - Nothing is committed after the merge. Ports 3000 and 4000 are free. Postgres on 5432 and the 5433 container keep running.
