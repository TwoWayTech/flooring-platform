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
**Safe options.** Each one is recorded in docs/blueprint-delta.md and ADR 0053 when the docs stage lands.

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

## Commands run (this stage)
- `git fetch origin`: origin/main is still `bb3e81f`, and the branch has no commits of its own before this one.
- No code changed in this stage, so no typecheck, lint or tests ran. Prettier ignores `*.md` in this repository (`.prettierignore`).
