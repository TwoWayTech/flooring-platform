# ADR 0053: Platform admin part 3 (platform audit viewer, support requests with limits, migration error codes)

- **Status:** accepted, 2026-11-15. Built overnight on `feat/platform-audit-support` (PR #36) under the owner's rule for this queue: follow the spec as the approved behaviour, deviate only in the safer direction (less exposure, deny by default, refuse what can't be done correctly), record each deviation in docs/blueprint-delta.md and here, and defer what needs the owner. The safer deviations and the questions under "For the owner" are open for the owner's review.
- **Context:**
  - ADR 0052, "Later parts", part 3: `GET /platform/audit` with migration rows as `{ code }` only, old rows included, and IP and user agent for the owner role only; support requests in the console with limits; database and maintenance columns with the SQLSTATE code; migrate.ts hardening. ADR 0052 says later parts add sections to it. This part takes a new number because it also changes the `pnpm db:migrate` rollout in packages/db and how old audit rows are read, which is more than the platform module.
  - The behaviour is docs/specs/platform-admin.md, "Part 3: audit and support", drafted as the first step of this run. As with part 1, the P11 "stop for my approval" step could not happen overnight.
  - docs/STATUS.md:
    - the PR #10 sixth security review of migrate.ts: a read-only database whose migration fails could keep serving reads if maintenance mode failed to turn on, because `last_error` and maintenance were written in separate steps; and the full driver message went into the audit row and the CLI output;
    - the PR #34 final review notes: the 422 and the hint said "trial" for any company with no live subscription row; the shared access check ran only after the step-up; a protected key could be unticked on screen; the demo wrote an audit entry for a save that changed nothing; stale comments in `access-patch.ts` and `users.int.test.ts`;
    - the platform admin residual risks of ADR 0052: the support role saw an editable access page; the error text stays in the control database, so part 3's viewer must redact every row;
    - finding 3 of PR #34's security review: the write-role rule belongs in packages/shared, not only in the API's guard.
  - Blueprint p7 role rule 6 (support access), p14 (`platform_audit_log`, `support_access_grants`), p28 ("every action in the platform audit log"; "IP and device") and p29 ("logs without … personal data"; support access "logged in both audit logs").
  - The tables as they are: `platform_audit_log` (append-only by design, with no trigger; its only index is `(tenant_id, at)`), `support_access_grants`, `platform_admins` (its unique index on `user_id` ignores `deleted_at`, so one row per user), `tenants` and `tenant_databases`. Four writers fill `platform_audit_log`: the access save and the support request (platform admins), the Owner's approve and revoke (company users), and migrate.ts's failed and recovered rows (the system). Rows written before this part hold `{ maintenanceMode, error }` with the full driver text, capped at 500 characters.

## Decision

### Routes
All eight /platform routes are `@SessionOnly()` with `PlatformAdminGuard` at class level, so 401, the switch-off 404 (before the admin row is read) and the non-admin 403 come first, as in ADR 0052. docs/api-contract.md, "Platform admin (real build, ADR 0052 and ADR 0053)".

| Route | Who | Step-up | Audit | Answer |
| --- | --- | --- | --- | --- |
| `GET /platform/audit` (new, its own controller) | Any platform admin; what each role sees is narrowed | No | None | `PlatformAuditResult` `{ entries, nextCursor }` |
| `GET /platform/support-grants` (new) | Any platform admin; the owner role gets every admin's requests, the support role its own | No | None | `PlatformSupportGrant[]`, newest first, at most 100 |
| `POST /platform/support-grants` (changed) | Either role (unchanged) | Yes (unchanged) | `support.requested` (unchanged) | 201 `{ id }`; 400; 403 under the lock; 404; 409 `grant_open`; 429 `rate_limited` |

`GET /platform/companies` and `GET /platform/companies/:id` gain `database.errorCode`. The other part 1 routes are unchanged.

### The platform audit log (`modules/platform/platform-audit.controller.ts`, `platform-audit-query.service.ts`)
- **Query, strict:** `companyId` (a UUID; no existence check, so a deleted company's history still lists), `action` (one of the six actions), `before` (the last entry's id; it must name an existing entry, checked with a separate select) and `limit` (digits only, 1 to 100, default 50). An unknown or repeated parameter is 400 `invalid_request`. Each message is in packages/shared (`PLATFORM_AUDIT_QUERY_MESSAGES`), except the company id's, which is in the API (`platform-params.ts`), because the web never sends an id that is not a UUID.
- **Order and cursor:** `at desc, id desc`, `limit + 1` rows read. The cursor is compared in SQL, `(at, id) < (SELECT at, id FROM platform_audit_log WHERE id = $before)`, so `at` keeps its microseconds and entries of the same millisecond page correctly, under any filter. The integration test pages one company at limits 1 to 4, so page boundaries fall between two entries with the same `at` (only the id tie-break keeps both) and between two entries 1 µs apart (a cursor cut to milliseconds skips one); both broken cursors were tried and fail it (review round 1).
- **Narrowed in SQL first,** so the text never reaches the API's memory:
  - a `company.migration_failed` row has `before` null and `after` rebuilt as `{ code }`, the code kept only when it is a string matching `^[A-Z0-9_]{1,32}$`;
  - `actor_user_id` and the actor's name (a join on the control `user` table) only for the two platform-admin actions, so a company Owner's id or name never leaves;
  - `ip` and `user_agent` only for the owner role (`seesAuditNetwork`), and only on those two actions; for the support role they are not selected at all;
  - for a role that doesn't see every admin's requests, another admin's `support.requested` row has `before` and `after` null.
- **Checked again by one shared mapping,** `platformAuditView` in `packages/shared/src/platform/audit-details.ts`, which the API and the demo both call:
  - `details` comes from `platformAuditDetails(action, before, after)`, a per-action allow-list that denies by default. Anything that doesn't fit its action's shape exactly is `{ kind: "hidden" }`, "Details hidden" on screen. The table is in docs/specs/platform-admin.md, "Redaction".
  - The actor kind comes from the action (`PLATFORM_AUDIT_ACTOR`), never from today's `platform_admins` rows: `platform_admin` with id and name ("Former admin" when the user row is gone), `company_user` (the company's Owner, no id or name), `system`, or `unknown`.
  - `action`, `targetType` and `targetId` are shown only when they match their patterns (a UUID for the id), else `"unknown"` or null.
  - `network` is present only for the owner role on platform-admin rows.
  - Another admin's `support.requested` row is hidden from the support role (`seesSupportReason`), whatever the SQL returned.
- **Reads are not audited,** as in part 1: the viewer reads the platform's own log, not company data.

### Support requests (`modules/platform/support-requests.service.ts`; `packages/shared/src/platform/support-grants.ts`)
- **The list:** grants that are not deleted, for one company when `companyId` is given, and for the support role only its own. The SQL filters, then each row passes `seesSupportReason` again. `approved_by` (a company user) is never selected. Status is derived by the shared `supportGrantStatus` (revoked, then expired, then approved, then pending), never stored (ADR 0013 style). The Owner's list in the users module uses the same function, with no behaviour change.
- **The POST,** in one control transaction under READ COMMITTED:
  1. `SELECT role FROM platform_admins WHERE user_id = $caller AND active AND deleted_at IS NULL FOR UPDATE`. No row, or a role that isn't `owner` or `support`: 403 "Only platform admins can use this.";
  2. `now` is taken after the lock;
  3. the company must exist and not be deleted (404);
  4. the facts: the admin's grants, deleted ones included, created in the last 24 hours or for this company with `expires_at` after now; `supportRequestFacts` gives whether a grant is open for this company and how many fall in the window;
  5. `supportRequestRefusal`: an open (pending or approved, unexpired) grant for this admin and company is 409 `grant_open`; 10 grants in the window, revoked, expired and deleted ones included, is 429 `rate_limited`;
  6. the insert, then `support.requested` with `{ reason, expiresAt }`, the IP and the user agent (unchanged).
- **Why the admin's row:** a step-up isn't used up, so two parallel requests both pass the guard. Both hold the same `platform_admins` row, so the lock serialises the facts and the insert with no new table, index or advisory key, re-checks the admin inside the transaction, and doesn't block the guard's plain reads.
- **One copy of each bound and message** (`SUPPORT_HOURS`, `SUPPORT_REASON`, `SUPPORT_REQUEST_LIMIT` and the four messages) for the API, the dialog and the demo. The API's `MAX_SUPPORT_HOURS` is gone.

### Database error code (`modules/platform/platform-companies.service.ts`)
`database.errorCode` is the code of the company's newest `company.migration_failed` row (by `at`, then `id`), from a subquery that selects only `after->>'code'`, narrowed by type and pattern in SQL and again by the shared `migrationErrorCode`. It is set only while `last_error` is set (`hasError`). The text is never selected, for any role.

### pnpm db:migrate when a company fails (`packages/db/src/migrate.ts`, `platform-alerts.ts`, `scripts/migrate.ts`, `scripts/migrate-report.ts`)
Only the rollout changes (`migrateAllCompanies`). Provisioning (`migrateCompany`, `provision.ts`) and tenancy are unchanged; TenantGuard already blocks on `tenants.maintenance_mode`.
- **One control transaction** (`recordMigrationFailure`) writes `last_error` (with status `failed` unless the database is read-only, conditional on the claimed status, as before), maintenance mode on (`turnMaintenanceOn`) and one `company.migration_failed` row with `after: { maintenanceMode, code }`. Never the text.
- **If that transaction fails,** maintenance mode is still turned on, alone, with no audit row. The next successful run ends it and writes `company.migration_recovered`, as before.
- **`turnMaintenanceOn`** sets reason `migration_failed` only when maintenance was off, so a move's reason, or a manual null, is kept. It always updates the row, so `updated_at` moves even when maintenance was already on (the old code skipped that row).
- **`onFailure`** gets `{ tenantId, code, recorded, maintenance, readOnly }`. `CompanyMigrationFailure.error` is removed, so the alert can never hold the text.
- **The alert** (`failureStanding`: `maintenance`, `serving_reads` or `unavailable`) says "is in maintenance mode" or "is NOT in maintenance mode", what to do by hand in the second case, and either "The full error is in tenant_databases.last_error." or "The error text could not be saved; it is only in the output of pnpm db:migrate." It no longer names `platform_audit_log`. It goes only to active admins whose role is one of the shared `PLATFORM_ADMIN_ROLES`, as the console, the guard and the lock accept (final review).
- **The CLI** says whether the company is in maintenance mode and, when it isn't, how to turn it on by hand (`scripts/migrate-report.ts`). It prints that line even when the alert itself throws, ending "0 platform admin(s) NOT emailed (the alert failed)", and the alert's error is still logged after it. Both writes failing usually means the control database is unreachable, so the alert fails on its first query too, and the line is then the only place that says the company is NOT in maintenance mode (review round 1).
- **`MigrationStoppedError`** keeps the original error as `cause` and exposes `code` and `recorded`. Its message, which the CLI prints, carries the error text only when the text could not be saved to `last_error`.
- `errorCode()` uses the shared `migrationErrorCode`; `startMigrationMaintenance` is gone.

### packages/shared (one rule for the API, the web and the demo)
- `platform/admin-roles.ts`: `PLATFORM_DEFAULT_WRITE_ROLES` (`["owner"]`, which the guard now uses, with no behaviour change), `mayChangeCompanyAccess`, `seesAuditNetwork`, `seesAllSupportGrants` and `seesSupportReason`.
- `platform/audit-details.ts` (new): the six actions and their actor kinds, the code and version patterns, the allow-list, the page bounds and messages, and `platformAuditView`.
- `platform/support-grants.ts` (new): status, "open", the 24-hour window, the bounds, the messages, `supportRequestInputProblem`, `supportRequestFacts` and `supportRequestRefusal`.
- `platform/access-patch.ts`: the 422 is the exported `ACCESS_NO_PLAN_MESSAGE`, "This company has no plan, so it has no limits to change.", and its stale comments are fixed.
- `types/platform.ts`: the audit and support types, and `errorCode` on `PlatformDatabaseStatus`.

### Web (apps/web)
- **ApiClient:** `listPlatformAudit`, `listPlatformSupportGrants` and `requestSupportAccess`, all in `API_METHODS`. An id that is not a UUID is never sent (an empty page or `[]`), and the POST body is rebuilt from its three fields.
- **The role:** the /admin layout passes the role from `GET /platform/me` to `PlatformRoleProvider`; without one the role reads `support`, the least privilege. The API's guard still decides every request.
- **A platform nav** (Companies, Audit log) under the console header.
- **/admin/audit:** filters for company and action on the server, "Load older entries" with Try again, "Address and device" for the owner role only, no CSV export.
  - Older pages (review round 2): one load at a time, a guard shared by the button and Try again; a new load or new filters take the failure toast away, and a load still running when the filters change or the page closes shows no toast and changes nothing (`runOlderAuditLoad`, final review). `features/admin/audit-paging.ts` drops an answer for a cursor that is no longer the current one and shows each entry id once. Before, a Try again left on screen could fetch a page the button had already added, so it showed twice and the table got duplicate row ids.
  - When a re-read of the newest page moves its cursor (new entries arrived), the older pages are set aside, so no entry is skipped between the pages.
- **The Support tab** (/admin/companies/:id/support): the requests the admin may see, and "Ask for support access" with a reason and hours, checked by the shared rule before the step-up. The button is disabled while the admin's own request for the company is open.
- **The companies list** gains Database and Maintenance columns; the company facts show the error code, never the text.
- **The access page:** read only for the support role (a note, no Save, no step-up, every control disabled); the shared access check runs before the step-up; a ticked protected key can't be unticked; the hint reads "With no plan there is no limit.". The permission matrix gains the locks `protected` and `read_only`, which the role editor never uses; `read_only` boxes have no tooltip tab stop.
- **Demo mode** runs the same shared rules. Audit rows and support requests live in the browser's local storage (`platform-audit`, `platform-support`), and Reset demo clears them. A save that changes nothing now writes nothing, as on the API. The demo admin has the owner role and no step-up.

## Safest options taken (also in docs/blueprint-delta.md)
1. **No migration error text in the console, for any role.** Only the status, the schema version, `hasError` and the SQLSTATE code.
2. **Every `company.migration_failed` row is narrowed to `{ code }` twice,** in SQL and by the shared allow-list, which reads only `after.code`, and only as the object's own property. Old rows, rows with no code and junk codes read `code: null`. The companies' `errorCode` subquery is narrowed the same way, and the web checks the code against the shared pattern again before showing it.
3. **A per-action allow-list, deny by default.** Anything else reads "Details hidden". Target ids show only as UUIDs; target types and action names only when they match their patterns.
4. **Company people are never named or identified.** No Owner id, name or address is selected, and the support list never selects `approved_by`.
5. **The actor kind comes from the action,** so a company Owner who later becomes a platform admin is still "The company's Owner" on an approval.
6. **IP and device go to the owner role only, on platform admins' own rows,** and are never selected for the support role.
7. **Reads are not audited** (blueprint p28 read as every change, as in part 1).
8. **The support role sees only its own support reasons, on both routes,** through one shared rule (`seesSupportReason`). Part 1's spec said both roles read every page; a reason can hold what an admin typed about a company. The support list also re-checks each row with the rule after the SQL filter.
9. **The limits run under the admin's `platform_admins` row lock,** which re-checks `active`, not deleted and an accepted role (403). Every grant counts toward the window, revoked, expired and deleted ones included, and an approved, unexpired grant also blocks a new request.
10. **Unreadable values deny.** An expiry that can't be read counts as expired and not open; a creation time that can't be read, or one later than now, counts toward the window; a count that isn't a number gives the 429; an empty requester id never counts as the viewer.
11. **`support.requested` details need an ISO moment** for `expiresAt`, not "a string that parses as a date" (`Date.parse("1")` succeeds). It is returned in UTC.
12. **One transaction in migrate.ts, with a maintenance-only fallback,** because denying service is the safer failure. Only when both fail does a company stay out of maintenance, and then `onFailure`, the email subject and the CLI say "NOT in maintenance mode" and what to do by hand. This closes the STATUS gap of a read-only database serving reads on a half-migrated schema. The CLI says it even when the alert itself fails.
13. **An existing maintenance reason is kept** (a move, or a manual null): unchanged behaviour, now reported.
14. **The alert never gets the text,** and the CLI prints it only when it couldn't be saved to `last_error`, so deploy and CI logs don't keep company data (blueprint p29).
15. **No CSV export of the platform audit log.** Reasons and user agents are free text, and `toCsv` doesn't neutralise cells starting with `=`, `+`, `-`, `@` or a tab.
16. **The support role sees the access page read only,** from the shared `mayChangeCompanyAccess`, and the console's role defaults to `support` when it isn't known. The API's guard still decides.
17. **The shared access check runs before the step-up, and ticked protected keys can't be unticked,** so a refused change never costs an authenticator code. An unticked protected key can be ticked, so no company is trapped.
18. **The write-role rule lives in packages/shared** (`PLATFORM_DEFAULT_WRITE_ROLES`).
19. **Every list is bounded:** audit pages at most 100 entries (default 50), the support list at most 100 rows.
20. **A no-op save writes nothing in the demo either.**
21. **The ApiClient never sends an id that is not a UUID,** and rebuilds the POST body from its three fields.
22. **The e2e removes its test grants** with a test-only hard delete (`removeSupportGrants` in `packages/db/src/testing.ts`) in setup, teardown and global setup, so the limits never block a later run on a shared local database. Its audit row stays, because the log is append-only.
23. **The console shows each audit entry once** (review round 2). One older page loads at a time. An answer for a cursor that another load already passed is dropped, and rows are kept unique by id. When a re-read of the newest page moves its cursor, the older pages are set aside, so no entry is repeated or skipped on screen.

## Kept as the spec says (not safety)
- Any platform admin reads the audit log; IP and device are for the owner role.
- Both roles may ask for support access, after a step-up.
- 10 requests per admin in 24 hours, and one open grant per admin and company. Another admin may still ask for the same company.
- A reason of 10 to 500 characters and 1 to 72 hours.
- The six actions; no new audit action.
- A deleted company's audit entries still list, with its name, because its row is soft-deleted.

## Smaller choices made while building (not safety)
- **The company id message** lives in the API (`platform-params.ts`), not in packages/shared.
- **A deleted company's grants** still list in `GET /platform/support-grants`, like its audit entries; only deleted grants are left out.
- **The demo cursor** is looked up among all entries, whatever the filters, as the API does.
- **The Database column** reads "Update failed, error 42P01" (a comma, not the spec draft's " · ", and the code is not monospace, which the design brief rules out). The facts read "Error code 42P01" or "No error code recorded".
- **The access details' last line,** "{n} override rows, {m} limit rows written", shows only when either count is above zero, so demo saves never show it.
- **New small texts:** "Schema not recorded" for a recovery with no version; "No entries for these filters." with a filter set; "No company" for an entry with no company; a description in the request dialog ("{name}'s Owner gets the request and approves or revokes it. Approved access is read only and ends after the hours you set.").
- **The read-only note** sits under the company tabs, because it applies to the Access tab only.
- **After a 409 or 429** the dialog closes and the list is read again; any other failure brings the form back with the text kept.
- **The nav** marks Companies with `aria-current="true"` on company pages; only the exact page gets `"page"`.
- **The audit page and the Support tab** keep the table's search box, which filters the entries already loaded.
- **apps/web/vitest.config.ts** compiles JSX itself (`oxc: { jsx: { runtime: "automatic" } }`), because tsconfig's `jsx: "preserve"` stopped vitest from importing `.tsx` files. No dependency was added. It runs `tests/unit/**/*.test.{ts,tsx}`, and tsconfig includes `tests/**/*.tsx`, so `platform-audit.test.tsx` writes the role provider in JSX; a `children` prop given to `createElement` failed `react/no-children-prop` (review round 1).
- **The fallback's log line** uses the write error's own message. For a database error that message includes the failed query's values, so it can contain the migration text. That happens only when the failure couldn't be recorded, which is the case where the CLI prints the text anyway.

## Deferred, not invented
- **Using a support grant** to open a company read-only (ADR 0034, ADR 0052): a tenancy change. The console says approved access doesn't open the company's data yet.
- **The Owner's support-access panel in the web.** The dialog and toast say the Owner approves "in Settings"; the API's `GET /support-grants`, approve and revoke exist, but the web screen comes with part 4.
- **Writing support requests or access changes to the company's `audit_log`:** a tenancy change.
- **An index on `platform_audit_log (at, id)` and an append-only trigger:** migrations.
- **Purging the text from old `company.migration_failed` rows:** that edits an append-only log.
- **STATUS:182** (`pnpm db:migrate` parses every provider setting): it touches packages/providers.
- **Neutralising formula cells in `toCsv`** app-wide: a STATUS follow-up.
- **A withdraw route** for a pending request.
- **All billing** (parts 2 and 4).

## For the owner
Also in docs/specs/platform-admin.md, "Waiting for the owner", numbers 12 to 20. ADR 0052's questions still stand.
1. **The migration error text:** should anyone ever see it in the console, for example the owner role under an approved support grant, or in a scrubbed form? Taken: never in the console; the CLI prints it only when it couldn't be saved to `last_error`.
2. **Old audit rows still hold the full text** in `after`. Taken: redact on read; the text stays readable to anyone with access to the control database.
3. **A migration for an index on `platform_audit_log (at, id)`,** and the append-only trigger (already asked in ADR 0052).
4. **Company people in the console:** may an Owner's name show as approver or actor? Taken: no.
5. **The support role and the audit log:** taken: the whole log, without addresses and without other admins' support reasons. More (part 1's "every page") or less?
6. **The maintenance-only fallback** writes no audit row; only the CLI line and the alert say so. Should it also try a code-only audit row?
7. **The limits:** confirm 10 per admin in 24 hours, one open grant per admin and company, and that an approved, unexpired grant blocks a new request. Per admin across companies (taken), or also per company?
8. **CSV export of the platform audit log:** not offered (taken). If wanted, `toCsv` must neutralise formula cells first. Also: how long to keep `platform_audit_log`.
9. **Withdrawing a request:** no withdraw route (taken). A pending request with a typo blocks that admin for that company for up to 72 hours unless the company's Owner revokes it.
10. **Still open from ADR 0052:** using a support grant; support requests and approvals in the company's `audit_log`; the admin host; who adds platform admins.

## Residual risks
- **Old rows still hold the text** in the control database: any SQL user, a backup or a dump sees it. Only the console is redacted.
- **`errorCode` is the newest recorded failure's.** `last_error` has no timestamp. Before this part a failure's audit row was a separate write after `last_error`; if it failed, the code shown can belong to an earlier failure. From this part on they are written together, and a fallback-only failure writes neither.
- **Only when both the transaction and the fallback fail** (in practice, the control database is unreachable) does a read-only database keep serving reads on a half-migrated schema. A claimed database stays `migrating` and unusable. The alert, if it can be sent, and the CLI say so.
- **A move's maintenance turned off by hand** leaves a read-only database whose migration failed during the move serving its half-migrated schema, because the failure kept the move's reason (unchanged).
- **The CLI prints the error text when it couldn't be saved,** and so does the fallback's log line, so in that one case the text can reach a CI or deploy log.
- **No index on `platform_audit_log.at`:** the unfiltered viewer sorts the whole table for each page. Fine at today's size.
- **The 24-hour window uses the API server's clock;** several instances whose clocks drift shift it by the drift.
- **The lock relies on READ COMMITTED,** the default everywhere. REPEATABLE READ for this transaction would break the serialisation.
- **No append-only trigger on the platform audit log** (ADR 0052).
- **The console still runs on a company host.** An injected script there can read `/platform/audit` and the grants with the admin's session, which now includes the reasons the admin may see, admin names and, for the owner role, admin IPs and user agents.
- **Admins can type company data into a reason.** The dialog's hint discourages it; the requester and the owner role see it, unredacted, because an admin wrote it.
- **Other CSV exports** don't neutralise formula cells (STATUS follow-up).
- **The demo's audit rows and grants live in one browser's local storage;** the demo has no step-up and no support role.
- **The e2e hard-deletes its test grants,** leaving `support.requested` rows whose `target_id` names a deleted grant (local databases only; CI's is fresh).
- **The companies list is wider:** at 1440 px it scrolls sideways inside its table because of the two new columns. The page itself doesn't.
- **"Approves it in Settings"** points the admin at an Owner screen the web doesn't have yet (part 4).

## Consequences
- **No schema, dependency or core change:** no table, column, index, trigger or migration, and no dependency. No behaviour change in core/auth or core/tenancy, and none in provisioning. The guard's write roles come from packages/shared with no behaviour change; `users/support-grants.service.ts` uses the shared status, with no behaviour change.
- **`CompanyMigrationFailure.error` is removed** and `MigrationStoppedError` takes `(tenantId, migrated, cause, code, recorded)`. Their only callers are `scripts/migrate.ts` and tests.
- **Rows written from now on:** `company.migration_failed` `after` is `{ maintenanceMode, code }`; older rows keep `{ maintenanceMode, error }`, and the console reads only `code`.
- **Paths touched:** `packages/shared/src/platform/*` and `types/platform.ts`; `packages/db/src/migrate.ts`, `platform-alerts.ts`, `testing.ts`, `scripts/migrate.ts` and `scripts/migrate-report.ts`; `apps/api/src/modules/platform/*` and `modules/users/support-grants.service.ts`; `apps/web/src/features/admin/*`, `features/settings/roles/permission-matrix.tsx`, `app/admin/*`, `lib/api/*`, `vitest.config.ts` and `tsconfig.json` (the tests' `.tsx` files).
- **The docs changed:** docs/specs/platform-admin.md (part 3, as built, and part 1's text where part 3 changes it), docs/api-contract.md, docs/product-spec/settings-and-permissions.md, docs/specs/settings-users-access.md, docs/data-model.md, ADR 0052 and ADR 0033 (pointers here) and docs/blueprint-delta.md. docs/FEATURES.md is unchanged: `admin.access` already screens `/admin` and `/admin/*`, and no switch changed.
- **Tests:**
  - packages/shared: new `test/platform-audit.test.ts` (43 cases: old and new migration rows, planted text, the access allow-list and its refusals, support rows, decisions, unknown actions, the patterns, the actor and the view) and `test/support-grants.test.ts` (25 cases: status order, "open", the bounds at their edges, the refusals, the window at 24 hours plus and minus 1 ms); `test/platform-access.test.ts` now has 55 cases with the no-plan message, "never says trial" and the role rules; `test/access-rules.test.ts` lists `limitRows` as not sensitive. The package: 691 cases in 55 files.
  - packages/db: `test/provision-tenant.int.test.ts`, 17 cases: the read-only failure rewritten (the wrong password gives "28P01"; the audit row is exactly `{ maintenanceMode: true, code }`), the fallback, neither write working, a move's reason surviving, and the alert's three wordings; every test repairs its company in `finally`. New unit `test/platform-alerts.test.ts` for `failureStanding`, and `test/migrate-report.test.ts` (4 cases) for the CLI line, including an alert that throws.
  - apps/api: new `test/platform-audit.int.test.ts` (8 cases) and `test/platform-support.int.test.ts` (10 cases; the race and the re-check wait on `pg_stat_activity` lock waiters), shared helpers in `test/support/platform-admins.ts`; `test/platform.int.test.ts` 19 cases (route and controller counts, the 422 with `ACCESS_NO_PLAN_MESSAGE`, a company whose only subscription row is deleted); the isolation map gains both GETs; the guard unit test uses the shared write roles (6 cases).
  - apps/web: new unit `tests/unit/platform-audit.test.tsx` (22 cases; 4 for the older pages, review round 2) and `tests/unit/demo-platform.test.ts` (DemoStore against in-memory local storage); `tests/unit/platform-console.test.ts` 18 cases. New api-mode `tests/e2e-api/platform-support.spec.ts`; the demo `tests/e2e/admin.spec.ts` gains a support-and-audit test; `tests/e2e/screens.ts` adds /admin/audit and the Support tab to the axe and console checks; `tests/e2e/responsive.spec.ts` loops over every admin screen at 375 px. Runs before the docs stage: the demo build with the admin, a11y, console, responsive and roles specs (240 passed and 1 failed on an ambiguous test locator; after the fix `admin.spec.ts` passed, 2 of 2), and the api-mode login, users, platform-admin and platform-support specs twice in a row (12 and 3 passed each time).
