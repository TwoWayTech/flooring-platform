# Session 2026-11-15 09:10, B (Claude): platform admin on the API, part 3 (audit, support requests, database errors)

Person: B (Claude), on B's Mac. Branch `feat/platform-audit-support`, from main at `bb3e81f` (platform admin part 1, PR #34, squash-merged). This is the main checkout, not a worktree. This is an unattended overnight run: the owner is asleep, so open points take the safest option and are recorded in docs/blueprint-delta.md and ADR 0053. The meetings build runs at the same time in its own worktree (`/Users/sarah/dev/flooring-platform-meetings`, `feat/meetings-api-moves`, PR #35) and shares the local PostgreSQL. This branch does not touch that worktree, never stops Postgres and never drops a shared database.

## Prompt (owner's queue order and decision rule)
- **Queue (owner, 2026-11-15, recorded in STATUS):** "Then the queue restarts in this order: meetings; platform admin and manual billing; reports; import; cross-module api-mode e2e flows; the whole-product check."
- **STATUS, "Next three tasks" 2:** after part 1 (PR #34), part 3 (`feat/platform-audit-support`) is the platform audit viewer, support requests in the console, the database columns with the SQLSTATE code and the migrate.ts hardening. Part 4 and a reduced part 2 follow. Billing writes wait for the owner.
- **Overnight rule:** the owner is asleep. Pick the safest option and record it in docs/blueprint-delta.md.
- **How the orchestrating session applies the rule to this part:**
  - **Follow the spec.** docs/specs/platform-admin.md is the approved behaviour. Deviate only in the safer direction: less exposure, deny by default, and refuse what can't be done correctly. Record each deviation in docs/blueprint-delta.md and ADR 0053.
  - **No schema, dependency or core changes:** no new or altered table, column, index or trigger, no migration, no new dependency, no behaviour change in `apps/api/src/core/auth` or `core/tenancy`, and no change to provisioning.
  - **Out of scope:** using a support grant to open a company, and all billing.
  - **Process:** heavy commands (integration tests, full typecheck, lint, test, builds, Playwright) run through the scratchpad lock, one at a time across both builds. The owner's local env file is never opened, printed or edited. The orchestrating session updates docs/STATUS.md and docs/BRANCHES.md; this branch does not.

## Inputs
- **Behaviour sources:**
  - docs/specs/platform-admin.md: part 1 as built, and the part 3 outline under "Parts 2 to 4";
  - ADR 0052 ("Later parts", part 3; "For the owner");
  - docs/api-contract.md ("Platform admin (real build, ADR 0052)" and the support-access rows);
  - docs/product-spec/settings-and-permissions.md (the console, rules 18 and 24, the edge cases);
  - docs/STATUS.md: the PR #34 final review notes, the platform admin residual risks, and the PR #10 sixth security review on migrate.ts.
- **The code at `bb3e81f`:** modules/platform (guard, companies, access, support requests, platform audit), the users-side `SupportGrantsService`, `packages/db/src/migrate.ts`, `platform-alerts.ts`, `scripts/migrate.ts`, the control schema, and the /admin screens.
- **Planning:** a part 3 plan, a critic's review of it (three must-fix items C1 to C3 and nineteen should items S1 to S19), and a final plan that applies all of them, each re-checked against the code. Those files are in a temporary scratchpad, so the plan and its decisions are written out below.

## Plan (part 3, short)

### Stages (one commit each, pushed; every commit keeps `pnpm typecheck` green)
0. **Plan:** this log; the "Part 3: audit and support" section of docs/specs/platform-admin.md, with the endpoints, fields, messages, screens, edge cases and acceptance criteria 19 to 39; the part 3 owner questions added to that spec's "Waiting for the owner"; and the draft PR.
1. **Shared** (`packages/shared`):
   - the write and visibility roles in `platform/admin-roles.ts`;
   - the audit allow-list and redaction in a new `platform/audit-details.ts`;
   - the support-grant status, limits and messages in a new `platform/support-grants.ts`;
   - the no-plan wording in `platform/access-patch.ts`;
   - the new types, and unit tests.
2. **API and migrate.ts**, in two commits:
   - (a) `packages/db`: migrate.ts, the alert and the CLI line, plus a test-only `removeSupportGrants`;
   - (b) `apps/api`: `GET /platform/audit`, `GET /platform/support-grants`, the limits on `POST /platform/support-grants`, and `database.errorCode`, with their integration tests.
3. **Web:**
   - the ApiClient methods and the demo store;
   - the platform role in the console, a platform nav, /admin/audit and the Support tab;
   - the Database and Maintenance columns;
   - the read-only access page for the support role and the access editor fixes;
   - unit tests.
4. **Browser tests:**
   - a new api-mode `platform-support.spec.ts`, run twice in a row to prove its clean-up;
   - in the demo: the admin spec, the axe and console screen lists, and the 375 px check for /admin pages.
5. **Docs:** ADR 0053, the delta row, api-contract, the spec as built, data-model, the product spec, the users spec, and the `admin.access` note in docs/FEATURES.md.

After stage 5: `/review`, then a fresh security-reviewer and a fresh schema-reviewer, with each summary posted on the PR. Then the PR is marked ready, `verify` and `e2e` must be green, the PR self-merges under the CLAUDE.md rule, and `/handoff` runs.

### Key decisions (the full list is in "Decisions and why")
- **Endpoints.** Two new GETs and a changed POST, all behind `PlatformAdminGuard` with `@SessionOnly()`:
  - `GET /platform/audit`: newest first, filters for company and action, a keyset cursor, at most 100 a page (default 50). Reads are not audited.
  - `GET /platform/support-grants`: the owner role sees every admin's requests, the support role its own. The status is derived, and the approver is never selected.
  - `POST /platform/support-grants` gains two limits: one open grant per admin and company (409 `grant_open`), and 10 requests per admin in 24 hours (429 `rate_limited`). Both are checked under a `FOR UPDATE` lock on the admin's `platform_admins` row, which also re-checks the admin.
- **The audit log is redacted on read, by a per-action allow-list in packages/shared.** Anything that doesn't fit shows "Details hidden".
  - Every `company.migration_failed` row, old or new, shows only `{ code }`, narrowed in SQL and again in TypeScript.
  - IP and user agent go to the owner role only, and only on platform admins' own rows.
  - The support role doesn't see other admins' support reasons.
  - Company people are never named or identified.
- **`database.errorCode`** on the companies list and detail is the SQLSTATE of the newest recorded failure, and only while `last_error` is set. The error text shows nowhere in the console, for any role.
- **migrate.ts:**
  - `last_error`, maintenance mode and a code-only audit row are written in one control transaction.
  - When that transaction fails, maintenance mode is still turned on, alone.
  - `onFailure` is told whether the failure was recorded, whether the company is in maintenance, and whether the database is read-only. It no longer gets the text.
  - The alert and the CLI say where the company stands. The CLI prints the text only when it couldn't be saved.
- **Web:**
  - The console knows the admin's role from `GET /platform/me`. The access page is read-only for the support role.
  - The protected-key and limit checks run before the step-up, and ticked protected keys can't be unticked.
  - /admin/audit has no CSV export.
  - The demo runs the same shared rules.

## Decisions and why
**Safe options.** Each one is recorded in docs/blueprint-delta.md and ADR 0053 (done in stage 5).

1. **No migration error text in the console, for any role.** The console shows the status, the schema version, `hasError` and the SQLSTATE code. The text can quote a company's row values (the PR #10 sixth review; ADR 0052 "no error text").
2. **Every `company.migration_failed` row is narrowed to `{ code }` twice.** The SQL nulls `before` and keeps `after.code` only when it is a string matching `^[A-Z0-9_]{1,32}$`. The shared allow-list then reads only that field. Old rows hold `{ maintenanceMode, error }` with the full text, so they read `code: null`, and their text never leaves the control database. The companies' `errorCode` subquery is narrowed the same way.
3. **A per-action allow-list, deny by default.** An unknown action, or a known one whose `before` or `after` doesn't fit its shape exactly, shows `{ kind: "hidden" }`. A target id is shown only when it is a UUID; a target type and an action name only when they match their patterns. Old or hand-written rows can't show more than the build expects.
4. **Company people are never named or identified.** An Owner's approval or revocation shows as "The company's Owner". The Owner's user id, name and address are never selected, and the grant list never selects `approved_by`. The console shows no company people today (the restricted directory, ADR 0052).
5. **The actor kind comes from the action,** not from today's `platform_admins` rows. Otherwise a company Owner who later became a platform admin would be shown by name.
6. **IP and device go to the owner role only,** as the spec says, and only on platform admins' own rows. They are not selected at all for the support role.
7. **Reads are not audited.** This is the spec's reading of blueprint p28, "every action". The viewer reads the platform's own log, not company data.
8. **The support role sees only its own support reasons, on both routes.** The grant list is filtered to its own requests, and other admins' `support.requested` rows show "Details hidden", narrowed in SQL. One shared rule, `seesSupportReason`, decides both. The spec says both roles read every page; this is the safer reading. A reason can hold what an admin typed about a company (owner question 5).
9. **The limits run under a lock on the admin's `platform_admins` row.**
   - The lock serialises two parallel requests by the same admin, so a race can't pass either limit.
   - Inside the transaction it re-checks that the admin is active, not deleted and has an accepted role (403 otherwise).
   - Every row counts toward the 24-hour window: revoked, expired and deleted ones too.
   - An approved, unexpired grant also blocks a new request.
   - The lock needs no new table, index or advisory key, and it doesn't block the guard's plain reads.
10. **One transaction in migrate.ts, with a fallback.** `last_error`, maintenance mode and the audit row are written together. If that transaction fails, maintenance mode is still turned on alone, because denying service is the safer failure. Only when both writes fail does the company stay out of maintenance; then `onFailure`, the email subject and the CLI say "NOT in maintenance mode" and what to do by hand. This closes the STATUS gap that a read-only database could keep serving reads on a half-migrated schema.
11. **An existing maintenance reason is kept,** such as a move or a manual null. This is unchanged from today; it is now reported.
12. **The alert never receives the text,** because `CompanyMigrationFailure.error` is removed. The CLI prints the text only when it couldn't be saved to `last_error`, so deploy and CI logs don't keep company data (blueprint p29, "logs without … personal data").
13. **No CSV export of the platform audit log.** Reasons and user agents are free text, and `toCsv` doesn't neutralise cells that start with `=`, `+`, `-`, `@` or a tab (owner question 8; a STATUS follow-up for the app-wide fix).
14. **The support role sees a read-only access page:** no Save button and no step-up, from the shared `mayChangeCompanyAccess`. The API's guard still decides (PR #34 residual risk).
15. **The shared access check runs before the step-up,** and ticked protected keys can't be unticked. A refused change never costs an authenticator code. A company whose ceiling lacks a protected key can still tick it back (PR #34 final review note).
16. **The write-role rule moves to packages/shared** as `PLATFORM_DEFAULT_WRITE_ROLES`, so the guard and the web read one rule (PR #34 security review finding 3).
17. **The no-plan wording no longer says "trial".** The 422 reads "This company has no plan, so it has no limits to change." and the hint "With no plan there is no limit.", because they apply to any company with no live subscription row (PR #34 final review note).
18. **A no-op save in the demo writes nothing,** as the API already does.
19. **Every list is bounded:** audit pages at most 100 entries (default 50), and the support list at most 100 rows.
20. **The e2e cleans up its grants** with a test-only hard delete in setup, teardown and global setup, so the open-grant and 24-hour limits never block a later run on a shared local database. Its audit row stays, because the log is append-only.

**Smaller choices:**
- **A new ADR number, 0053.** ADR 0052 says later parts add sections to it. This part also changes the `pnpm db:migrate` rollout in packages/db and how old audit rows are read, which is more than the platform module, so it takes 0053. ADR 0052 gets a pointer.
- **Limits named in packages/shared.** `SUPPORT_HOURS`, `SUPPORT_REASON` and `SUPPORT_REQUEST_LIMIT` replace the API-only `MAX_SUPPORT_HOURS`, so the API, the dialog and the demo give the same messages.
- **The cursor** is the last entry's id, compared in SQL as `(at, id)`, so entries in the same millisecond page correctly. An id with no row answers 400.
- **Deleted companies still list.** No existence check on `companyId`, so a deleted company's history still shows.
- **Withdrawing a request is not built.** A pending request with a typo blocks that admin for that company until it expires, for at most 72 hours, unless the company's Owner revokes it (owner question 9).
- **Two new cell locks.** `CellLock` in the permission matrix gains `protected` and `read_only`; the role editor never uses them. `read_only` cells have no tooltip wrapper, so a read-only matrix doesn't add about 137 tab stops on Summit.

**The code was checked against the plan.** No contradiction was found at the plan stage. Any one found while building takes the safer reading and is noted for the docs stage.

## Owner questions (new in part 3; ADR 0052's still stand)
In docs/specs/platform-admin.md, "Waiting for the owner", questions 1 to 9 below are numbers 12 to 20. "Owner question" numbers elsewhere in this log refer to this list.

1. **The migration error text:** should anyone ever see it in the console, for example the owner role under an approved support grant, or a scrubbed form? Taken: never in the console. The CLI prints it only when it couldn't be saved to `last_error`.
2. **Old audit rows still hold the full text** in `after`. Purging them means editing an append-only log. Taken: redact on read. The text stays readable to anyone with access to the control database.
3. **A migration for an index on `platform_audit_log (at, id)`,** and the append-only trigger (already asked in ADR 0052).
4. **Company people in the console:** may an Owner's name show as the approver or the actor? Taken: no.
5. **The support role and the audit log.** Taken: the whole log, without addresses and without other admins' support reasons; its own reasons are shown. Should it see more (the spec's "every page") or less?
6. **The maintenance-only fallback** writes no audit row; only the CLI line and the alert say so. Is that enough, or should it also try a code-only audit row?
7. **The limits:** confirm 10 requests per admin in 24 hours, one open grant per admin and company, and that an approved, unexpired grant blocks a new request. Is the 24-hour limit per admin across companies (taken), or also per company?
8. **CSV export of the platform audit log.** Taken: not offered. If it is wanted, cells starting with `=`, `+`, `-`, `@` or a tab must be neutralised first (an app-wide `toCsv` follow-up). Also: how long to keep `platform_audit_log`.
9. **Withdrawing a request.** Taken: no withdraw route. Should an admin be able to withdraw their own pending request?
10. **Still open from ADR 0052:**
    - using a support grant;
    - support requests and approvals in the company's `audit_log`;
    - the admin host;
    - who adds platform admins.

## Outcome
Draft PR #36 (`feat/platform-audit-support` into `main`). Every stage is committed with `[skip ci]` and pushed, so CI has not run on the branch yet.

| Stage | Commit | What |
| --- | --- | --- |
| 0, plan | `997acaf` | The part 3 spec section, the owner questions, this log, the draft PR |
| 1, shared | `9cd420b` | The write and visibility roles, the audit allow-list and `platformAuditView`, the support-grant rules and messages, the no-plan wording, the types, unit tests |
| 2a, db | `16a5c4f` | migrate.ts: one transaction for `last_error`, maintenance and a code-only audit row, the maintenance-only fallback, the `onFailure` flags, the alert's three wordings, the CLI line; `removeSupportGrants` for tests |
| 2b, API | `06c6ad8` | `GET /platform/audit`, `GET /platform/support-grants`, the request limits under the row lock, `database.errorCode`, integration tests |
| 3, web | `645ba62` | The ApiClient methods and DemoStore, the role provider, the platform nav, /admin/audit, the Support tab, the Database and Maintenance columns, the read-only access page and the access editor fixes, unit tests |
| 4, tests | `6641c35` | The api-mode `platform-support.spec.ts`, the demo admin test, /admin/audit and the Support tab in the axe and console lists, the 375 px loop over the admin screens |
| 4, fixes | `9e5e791` | Two test locators (the dialog's fields, the audit rows' column order); no product code |
| 5, docs | the commit that adds this section | ADR 0053, the delta row, api-contract, the spec as built, the product spec, the users spec, data-model, pointers in ADR 0052 and ADR 0033 |

## Decisions taken during the build
Each is in ADR 0053 ("Safest options taken" and "Smaller choices made while building") and the top row of docs/blueprint-delta.md. The planned ones are under "Decisions and why" above.

**Safer than the plan:**
- **Unreadable values deny** (shared): an expiry that can't be read counts as expired and not open; a creation time that can't be read, or one later than now, counts toward the 24-hour window; a count that isn't a number gives the 429; an empty requester id never counts as the viewer.
- **`support.requested` details need an ISO moment** for `expiresAt`, because `Date.parse("1")` succeeds. It is returned in UTC.
- **A migration row's code** is read only from `after.code`, and only as the object's own property.
- **The support list** also passes every row through `seesSupportReason` after the SQL filter.
- **The web re-checks the error code** against the shared pattern before showing it.
- **The console's role reads `support`** without a provider, and the ApiClient never sends an id that is not a UUID.

**Other choices:**
- **One shared mapping,** `platformAuditView`, for the API and the demo, with `PLATFORM_AUDIT_PAGE` and `PLATFORM_AUDIT_QUERY_MESSAGES`; `supportRequestFacts` and `supportGrantExpiresAt` likewise. The API select aliases `companyId: supportAccessGrants.tenantId` for it.
- **The company id message** lives in the API (`platform-params.ts`).
- **`turnMaintenanceOn`** always updates the tenant row with a CASE that keeps an existing reason, so `updated_at` moves even when maintenance was already on (the old code skipped such a row).
- **The fallback's log line** uses the write error's message, which for a database error can include the migration text; only in the not-recorded case, where the CLI prints the text anyway.
- **`MigrationStoppedError`** exposes `recorded` as well as `code`.
- **`apps/web/vitest.config.ts`** compiles JSX itself, because tsconfig's `jsx: "preserve"` made vitest fail on any `.tsx` import. No dependency.
- **Wording:** "Update failed, error 42P01" (a comma, not " · ", and no monospace, per the design brief); "Schema not recorded"; "No entries for these filters."; "No company"; a description in the request dialog; the "rows written" line only above zero.
- **Placement and flow:** the read-only note under the company tabs; after a 409 or 429 the dialog closes and the list is read again; the demo cursor is looked up among all entries; the nav uses `aria-current="true"` for Companies on company pages.
- **docs/FEATURES.md is unchanged:** `admin.access` already screens `/admin` and `/admin/*`, and no switch changed, so its row stays as it is.

**The plan and the code agreed.** No contradiction was found at any stage. One bug was found and fixed in the web stage: the demo's "older entries" cursor was reversed (caught by the new unit tests).

## Commands run
Heavy runs went through the scratchpad lock, one at a time; logs are in the scratchpad's `platform3` folder.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `git fetch origin` | origin/main still `bb3e81f`; no own commits before stage 0 |
| 1 | shared vitest on the three platform test files | 123 passed |
| 1 | `pnpm --filter @workspace/shared exec vitest run` | 1 failure (`limitRows` not yet classified in `access-rules.test.ts`), then 691 passed in 55 files |
| 1 | shared lint; Prettier on 3 files | clean |
| 1 | API guard unit test; eslint on the guard | 6 passed; clean |
| 1 | `pnpm -s typecheck`, then `pnpm -s typecheck --force` | exit 0 both; the first replayed web and db from turbo's cache (the `typecheck` task has no `dependsOn`), so later stages used `--force` (6 of 6 fresh) |
| 2a | db integration `provision-tenant.int.test.ts`; db unit tests; db lint and Prettier | 17 passed; 14 passed; clean |
| 2b | API integration files one at a time: `platform-audit.int`, `platform-support.int`, `platform.int`, `isolation.int`, `users.int` | 8, 10, 19, 15, 17 passed |
| 2b | API unit tests; guard test alone; API lint | 70 passed; 6 passed; clean |
| 2a, 2b | `pnpm -s typecheck --force` after each commit | 6 of 6 tasks passed |
| 2b | web unit tests; shared tests | 33 passed; 691 passed |
| 3 | `pnpm --filter web typecheck` | one test typing error, fixed, then passed |
| 3 | `pnpm --filter web lint` | one React refs error, fixed, then clean |
| 3 | `pnpm --filter web exec vitest run` | 54 passed in 7 files |
| 3 | Prettier on apps/web and packages/shared | clean |
| 3 | demo dev server on port 3000, checked by hand at 1440 and 390 px, light and dark | sign-in, Support tab, audit log and protected-key locks worked; no sideways page scroll; server stopped, ports free |
| 4 | web `tsc --noEmit`, ESLint and Prettier on the e2e folders | clean |
| 4 | db `provision-tenant.int` and `seed.int` | 17 and 14 passed |
| 4 | API `platform.int`, `platform-audit.int`, `platform-support.int`, `isolation.int`, `users.int` | 19, 8, 10, 15, 17 passed |
| 4 | `pnpm -s typecheck`; db unit tests | passed; 14 passed |
| 4 | demo build, then the admin, a11y, console, responsive and roles specs, 1 worker | 240 passed, 1 failed (an ambiguous "Reason" locator) |
| 4 | demo `admin.spec.ts` after the fix, same build | 2 passed |
| 4 | api and web builds, then the api-mode login, users, platform-admin and platform-support specs; then platform-admin and platform-support again; the whole command a second time | 12 and 3 passed, then 12 and 3 passed again |
| 4 | after the runs: listeners on 3000 and 4000; `platform_admins` and `support_access_grants` counts; Summit's `retail.sample.view` ceiling row | none; 0 and 0; allowed and not deleted |
| 5 | shared vitest on `platform-audit`, `support-grants`, `platform-access` and `features` tests | 130 passed (43, 25, 55 and the feature register) |
| 5 | web vitest on `platform-audit`, `demo-platform` and `platform-console` tests | 18, 2 and 18 passed |

Prettier ignores `*.md` in this repository (`.prettierignore`), so the docs stage has no formatter run.

## Review round 1 (three findings, each confirmed by a skeptic)
1. **Web lint failed** (`react/no-children-prop`) on `createElement(PlatformRoleProvider, { role: "owner", children: … })` in the web's `platform-audit` unit test, so CI's `fast` and `verify` would have gone red. Stage 3's "web lint clean" did not hold for the head: the line came in with that same commit. Fix: the file is now `tests/unit/platform-audit.test.tsx` and writes the provider in JSX; `apps/web/vitest.config.ts` runs `tests/unit/**/*.test.{ts,tsx}`; `apps/web/tsconfig.json` includes `tests/**/*.tsx`, so `tsc` still checks the file. Passing the child as `createElement`'s third argument would have needed the provider's props changed, since `children` is required.
2. **The CLI line was lost when the alert failed.** `onFailure` awaited the alert before printing, and when both writes fail the control database is usually unreachable, so the alert throws on its first query and the operator never read "NOT in maintenance mode" (spec, "Edge cases and known limits (part 3)"; AC34). Fix: the new `packages/db/scripts/migrate-report.ts` (`alertPhrase`, `failureLine`, `reportMigrationFailure`) prints the line in a `finally`, ending "0 platform admin(s) NOT emailed (the alert failed)" when the alert threw, and lets the alert's error propagate, so migrateAllCompanies still logs it after the line. New unit `packages/db/test/migrate-report.test.ts` (4 cases, one with a throwing alert). `MigrationStoppedError`'s message is unchanged.
3. **The paging test never put a page boundary between same-`at` or same-millisecond entries.** Fix: it now pages company a at limits 1, 2, 3 and 4. A limit of 1 splits the two rows with the same `at` and the two rows 1 µs apart. Checked by mutation, each reverted: a cursor on `at` alone, and one cut to milliseconds, both now fail the test at limit 1, where they passed before.

Docs: the spec (the CLI line when the alert fails, the edge case, the test mapping), ADR 0053 (the CLI, the cursor's test, the vitest and tsconfig change, the paths and tests), and the delta row (safest option 12, the smaller vitest choice).

| Command | Result |
| --- | --- |
| `eslint tests/unit/platform-audit.test.tsx vitest.config.ts` in apps/web; Prettier on the touched files | clean |
| web vitest on `platform-audit.test.tsx`, then the whole web unit suite | 18 passed; 54 passed in 7 files |
| db vitest unit on `migrate-report` and `platform-alerts`, then the whole db unit project | 7 passed; 18 passed in 5 files |
| API integration `platform-audit.int.test.ts` (lock) | 8 passed |
| the same test against an `at`-only cursor, then a millisecond-cut cursor (lock; the service file restored after) | failed at limit 1 both times, as it should |
| `pnpm lint` (lock), whole repository | exit 0; web, api and db fresh, shared, providers and ui from turbo's cache; Prettier clean |
| `pnpm -s typecheck --force` (lock) | 6 of 6 tasks passed |

## Review round 2 (one finding, confirmed by a skeptic)
1. **"Load older entries" could add the same page twice.** After a failed older page, the toast's Try again kept the failed render's cursor and ignored `loading`. Clicking it alongside the main button, or after the main button's load had already landed, appended the same page again. Duplicates were filtered against the newest page only, so the table got repeated rows and duplicate row ids.
   - **Fix:** the new `apps/web/src/features/admin/audit-paging.ts` (`appendOlderAuditPage`, `auditRows`, `olderAuditCursor`). An answer for a cursor that is no longer the current one is dropped, and the rows are kept unique by id.
   - **The page:** `platform-audit-page.tsx` loads one older page at a time, with a ref shared by the button and Try again. The failure toast has one id; a new load takes it away, and so does unmounting the entries when the filters change.
   - **Safer extra (option 23):** when a re-read of the newest page moves its cursor because new entries arrived, the older pages are set aside and paging starts again below it. Before, the newest page and the older pages could leave a gap between them.
   - **Tests:** 4 new unit cases in `tests/unit/platform-audit.test.tsx` page six demo entries two at a time: two loads of one cursor, a late Try again after the last page, an answer that overlaps the newest page, and a moved newest page.

Docs: the spec ("Older entries", as built, and the test mapping), ADR 0053 (the /admin/audit screen, safest option 23 and the web test count) and the delta row (option 23).

| Command | Result |
| --- | --- |
| web vitest on `platform-audit.test.tsx`, then the whole web unit suite (lock) | 22 passed; 58 passed in 7 files |
| `pnpm --filter web typecheck` (lock) | exit 0 |
| `eslint src/features/admin tests/unit/platform-audit.test.tsx` in apps/web (lock); Prettier on the touched files | clean |
| demo build, then `tests/e2e/admin.spec.ts` on one worker (lock); ports 3000 and 4000 free before and after | 2 passed |

## Review round 3 (one finding, confirmed by a skeptic)
1. **The strict-body test could not catch a missing `.strict()`.** The case for an unknown field in `POST /platform/support-grants` sent `reason: "x"`, which the reason rule refuses anyway, so the 400 came from the reason whether or not `SUPPORT_REQUEST` was strict. Without `.strict()`, zod drops unknown keys, so nothing leaked, but no test proved the spec's "an unknown field answers 400" (spec, "POST /platform/support-grants", Body).
   - **Fix:** the case in `apps/api/test/platform-support.int.test.ts` now sends a body that is valid in every field (`reason: "A reason long enough"`, `hours: 2`) plus `extra: 1`. It asserts 400 with code `invalid_request`, and the existing check that the admin wrote no grant and no `support.requested` row follows it.
   - **Checked by mutation:** with `.strict()` removed from `SUPPORT_REQUEST`, the test fails (`[201, undefined]` instead of `[400, "invalid_request"]`). The controller was restored after the run.
   - No behaviour change, so the spec, ADR 0053 and the delta row are unchanged; the file still has 10 tests.

| Command | Result |
| --- | --- |
| API integration `platform-support.int.test.ts` (lock) | 10 passed |
| the first test of that file with `.strict()` removed from `SUPPORT_REQUEST` (lock; the controller restored after) | failed, as it should |
| `pnpm run typecheck` in apps/api (lock; `test/` is included) | exit 0 |
| `eslint test/platform-support.int.test.ts` in apps/api (lock); Prettier on it | clean |

## Final review (fresh reviewers)
Three fresh read-only reviewers read the branch at 8ed71f3. None found a blocking issue:
- **security-reviewer:** PASS, with 6 notes.
- **correctness:** 1 confirmed should_fix and 7 notes.
- **packages/db:** 1 should_fix, refuted by the skeptic because it is the spec's design, and 1 note.

**Fixed:**
1. **A stale older-page toast after the filters change** (the should_fix). `AuditEntries` is keyed by the filters, and its cleanup dismissed the failure toast. But a "Load older entries" still in flight kept running, and when it failed it showed the toast again over the new filters (or after leaving the page). Its Try again held the unmounted entries' closure.
   - **Fix:** a `live` ref, set false in the existing cleanup effect, and the new pure `runOlderAuditLoad` in `apps/web/src/features/admin/audit-paging.ts`. An answer after unmount adds no page and shows no toast. `loading` is set only while live, and a Try again from unmounted entries does nothing.
   - **Tests:** 2 new unit cases in `tests/unit/platform-audit.test.tsx` (now 24): a live failure shows its toast and a live answer adds its page; after leaving, neither does anything.
2. **Alerts only to known admin roles** (the packages/db note, safest option). `platformAdminEmails` selected every active, non-deleted `platform_admins` row whatever its role. It now also filters with `inArray(role, PLATFORM_ADMIN_ROLES)` from packages/shared, which packages/db already depends on, so no dependency was added.
   - **Test:** the alert case in `packages/db/test/provision-tenant.int.test.ts` now has an owner-role recipient and an active row set to `billing` with plain SQL, which gets no email.
   - **Checked by mutation:** without the filter the case fails, because the `billing` row is emailed. The file was restored after.
3. **Small notes:**
   - the demo's `requestSupportAccess` now checks the fields before the company, as the API's refusal order says, and `demo-platform.test.ts` checks it;
   - the spec maps AC33 to `apps/api/test/platform-audit.int.test.ts` (and the web labels), not `platform.int.test.ts`;
   - the JSDoc in `packages/db/src/migrate.ts` now names the real heading, "pnpm db:migrate when a company fails (packages/db)". So do the same stale references in `platform-alerts.ts` and `scripts/migrate.ts`;
   - the comment in `tests/e2e-api/platform-admin.spec.ts` now says that `platform-support.spec.ts` only checks the "View sample checkout" box is disabled.

Docs: the spec (Older entries as built, who gets the alert, the test mapping) and ADR 0053 (the older pages, the alert's recipients). STATUS and BRANCHES are left to the orchestrating session.

**Left as follow-ups (not changed here):**
- `last_error` holds drizzle's "Failed query" wrapper rather than the driver's reason (pre-existing);
- the maintenance-only fallback writes no audit row and has no retry (owner question 17);
- the lock's re-check uses the accepted roles, which equal the route's roles today;
- one browser's saved table view is shared between the admins who use it, and the filters are not kept in the URL;
- the recorded IP is the immediate peer;
- the support dialog tells 409 and 429 apart by message text;
- `recorded` is false when the claimed status changed mid-run.

| Command | Result |
| --- | --- |
| `pnpm --filter web exec vitest run` | 60 passed in 7 files |
| `pnpm --filter @workspace/db test` | 18 passed in 5 files |
| db integration `provision-tenant.int.test.ts` (lock) | 17 passed |
| the alert case with the role filter removed (lock; `platform-alerts.ts` restored after) | failed, as it should |
| `pnpm -s lint` (lock) | exit 0; 6 of 6 tasks (4 from turbo's cache); Prettier clean |
| `pnpm -s typecheck --force` (lock) | 6 of 6 tasks passed |
| demo build, then `tests/e2e/admin.spec.ts --project=flooring` on one worker (lock); ports 3000 and 4000 free before and after | 2 passed |

## Left
- **Before ready:** `/review`; a fresh security-reviewer (platform authorization, the audit redaction, the support-reason rule, the limits and the lock, the maintenance timing in migrate.ts) and a fresh schema-reviewer (packages/db: migrate.ts, platform-alerts.ts, testing.ts; no schema change), each summary posted with `gh pr review 36 --comment --body-file <file>`; the full `pnpm test` and `pnpm test:api` run (not done yet; every touched integration file ran one at a time; the full `pnpm lint` passed in review round 1); then mark ready and wait for `verify` and `e2e` on the head.
- **For the orchestrating session:** docs/STATUS.md and docs/BRANCHES.md (record PR #34 as merged, the part 3 line and queue, remove the fixed follow-ups, add part 3's residual risks and owner questions, and add the `toCsv` formula-cell follow-up). This branch did not edit them.
- **Not checked by hand:** the support role's read-only access page and the api-mode request with the step-up. Both are covered by `platform-support.spec.ts`, which passed twice in a row.
- **Doubtful or open:**
  - the console's copy says the Owner approves "in Settings", but the web has no Owner screen for support access until part 4;
  - at 1440 px the companies list scrolls sideways inside its table because of the two new columns;
  - the optional STATUS:159 checks (the audit count rising by exactly 1; re-reading Summit after a refused key) were not added;
  - the turbo `typecheck` task has no `dependsOn`, so a change in packages/shared doesn't recheck its users without `--force`.
- **Next:** part 4 (`feat/billing-company-standing`), then a reduced part 2, as STATUS's queue says.
