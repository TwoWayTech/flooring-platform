# ADR 0052: Platform admin on the API, part 1 (platform guard, companies, change company access, support request)

- **Status:** accepted, 2026-11-15. The owner restarted the queue on 2026-11-15 with "platform admin and manual billing" after meetings, and was asleep during the build. The rule for that run: follow the spec as the approved behaviour, deviate only in the safer direction (less exposure, deny by default, refuse what can't be done correctly), record each deviation in docs/blueprint-delta.md and here, and defer what needs the owner. The safer deviations and the questions under "For the owner" are open for the owner's review. Later parts of this module add sections to this ADR rather than taking new numbers, except part 3, which is recorded in ADR 0053 because it also changes the `pnpm db:migrate` rollout in packages/db and how old audit rows are read, and part 4, which is recorded in ADR 0054 because it adds a session-only route outside /auth and /platform and a new feature key.
- **Context:**
  - docs/real-build-plan.md module 17, "Platform admin and manual billing". docs/product-spec/settings-and-permissions.md describes the demo's console: who uses it, "Change company access", rules 18 and 24, and the edge cases. It has no server design and nothing on billing, so a draft spec was written for this run: docs/specs/platform-admin.md. The P11 "stop for my approval" step could not happen overnight; this follows the precedent of docs/specs/settings-users-access.md (docs/blueprint-delta.md, 2026-11-13), and here it is the overnight rule's choice.
  - Blueprint p4 to p7 (layers of control, super-admin "Company access", role rules 3, 6 and 8), p13 and p14 (control tables), p16 and p28 (an admin subdomain), p23 and p24 (billing and plans), p27 to p29 (MFA, super-admin, support access).
  - ADR 0030 (tenancy), 0031 (permissions, modules, audit), 0033 (company life cycle and maintenance) and 0034 (users, step-up, support access).
  - The control tables exist: `platform_admins` (role is plain text with no CHECK), `platform_audit_log` (with `ip` and `user_agent`, no append-only trigger), `tenant_module_overrides`, `tenant_permission_ceiling`, `tenant_subscriptions`, `plan_limits` and `support_access_grants`. The unique indexes on the overrides and the ceiling ignore `deleted_at`.
  - Before this ADR the console ran on DemoStore only, and `POST /platform/support-grants` sat in the users module with its own inline admin check.
  - The module is split into four parts. This is part 1: the guard, the companies, change company access, the restricted directory and the support request behind the guard, with the /admin console reading and writing the API in api mode.

## Decision

### Routes
All six are `@SessionOnly()` and carry `PlatformAdminGuard` at class level (`apps/api/src/modules/platform/platform.controller.ts`). docs/api-contract.md, "Platform admin (real build, ADR 0052 and ADR 0053)".

| Route | Who | Step-up | Audit |
| --- | --- | --- | --- |
| `GET /platform/me` | Any platform admin | No | None |
| `GET /platform/companies` | Any platform admin | No | None |
| `GET /platform/companies/:id` | Any platform admin | No | None |
| `PATCH /platform/companies/:id/access` | The `owner` role | Yes | `company.access_changed` |
| `GET /platform/companies/:id/directory` | Any platform admin | No | None |
| `POST /platform/support-grants` | Any platform admin | Yes | `support.requested` |

### The platform guard (`modules/platform/platform-admin.guard.ts`, `platform-admins.ts`)
- Session-only routes skip TenantGuard, PermissionGuard and the AuditInterceptor, so this guard is the only authorization layer of /platform and it denies by default. In order:
  1. no verified session: 401 `unauthenticated`. SessionGuard answers first; the guard checks again so a route that ever skips SessionGuard (a method-level `@Public()`) is still closed;
  2. `admin.access` switched off: 404, without reading the admin row (CLAUDE.md rule 13);
  3. not an admin: 403 `forbidden`, "Only platform admins can use this.". An admin is a `platform_admins` row for the user that is `active`, not deleted, and whose role is `owner` or `support` (`isPlatformAdminRole` in packages/shared). Any other role value counts as no admin. The row is read on every request, so deactivating an admin applies to their next request;
  4. a write (any method but GET, HEAD and OPTIONS): a role the route allows, `owner` unless `@PlatformWriteRoles` names more (only the support request adds `support`), otherwise 403 "Only the platform owner role can change this."; then `StepUpService.require`, a step-up from the last 5 minutes (403 `step_up_required`, or `step_up_mfa_required` with no factor).
- SessionGuard's refusals come first: an admin with no factor gets 403 `mfa_enrolment_required` (`MfaPolicy` requires MFA for any active admin row, whatever its role; that stays stricter on purpose).
- Express parses the JSON body before guards run, but guards run before pipes and the handler's Zod check, so a non-admin gets 403 on every /platform route whatever the body.
- The guard attaches a `PlatformActor` (user, role, session, IP, user agent) that `@CurrentPlatformAdmin()` reads; the decorator throws on a route without the guard.

### How a platform route names a company (the tenancy rule 2 exception)
- A route names its target company by `:id`, a UUID checked with `ParseUUIDPipe` (400 otherwise). The support request names it by `companyId` in a strict body.
- The id selects control-database rows only: `tenants`, `tenant_products`, `tenant_subscriptions`, `tenant_module_overrides`, `tenant_permission_ceiling`, `tenant_branding`, `tenant_databases` (status and schema version) and `member` counts. It is never passed to TenantConnectionService and no company database is opened. CLAUDE.md rule 2 is about reaching a company database, so it holds.
- Lint enforces it: a `no-restricted-imports` block for `src/modules/platform/**` keeps the existing company-database bans and adds `@workspace/db/company`, `**/tenancy/tenant-connection.service` and `**/tenancy/tenant-context` (`apps/api/eslint.config.js`). A probe file with five such imports got five refusals there and none under modules/sales.
- A test proves it: detail, directory and PATCH answer 200 for a company whose database is `failed` and for one in maintenance.
- This is the one exception to "the tenant comes only from the verified session" (docs/api-contract.md, Tenancy; ADR 0030 "Guards").

### Change company access (`modules/platform/company-access.service.ts`; `packages/shared/src/platform/access-patch.ts`)
- **Body:** a strict Zod schema that checks shape only (`modules` and `ceiling` string lists no longer than the catalog, `userLimit` and `branchLimit` numbers). Names, the protected keys and the range are checked by `accessPatchProblem`, which the demo store also runs, so both refuse the same things with the spec's messages.
- **Refusals:** a `modules` list without `platform`; a module the products don't offer or a hidden one (rule 18); a key not in the catalog; a key of a module not offered and visible; a `ceiling` list without all five of `settings.users.view`, `settings.users.manage`, `settings.roles.view`, `settings.roles.manage` and `settings.audit.view`; a limit that is not a whole number from 1 to 100,000 (all 400); a limit on a company with no subscription row that is not deleted (422 `rule_broken`); an unknown or deleted company (404).
- **One control transaction**, which first locks the company row (`SELECT … FOR UPDATE`), so saves for one company run one at a time:
  - **Modules:** for each offered, visible module other than `platform`, an override row only where the choice differs from what the plan gives, written with `deleted_at` cleared; a stored override for a module set back to the plan is soft-deleted, so an old "off" never outlives a change back. Hidden modules, modules outside the products and `platform` keep their stored rows.
  - **Ceiling:** only the keys whose `allowed` value changes, among the keys of the offered, visible modules, upserted with `deleted_at` cleared. A missing row counts as not allowed. Roles keep their ticks.
  - **Limits:** written to the override columns of every subscription row that is not deleted, cancelled rows included, because the company's limit is the largest across those rows. The save takes its rows from `PlanLimits.rowsOf`, the same reader `limitsOf` takes the largest over, so the rows written and the rows read cannot drift apart (review round 3). A row whose plan already gives the number gets null. No subscription row is ever created.
  - **Audit:** one `company.access_changed` row in `platform_audit_log` whenever any row was written, none for a save that writes nothing. The answer is the company read again.
- **Effect at once:** the guards read modules, the ceiling and limits on every request, with no cache. A removed key answers 403 on the company's next request that needs it, a module switched off answers `module_not_enabled`, and a lowered user limit refuses the next invitation with `seat_limit`.
- **The last save wins** when two admins edit one company; both saves are audited.

### Reads (`modules/platform/platform-companies.service.ts`)
- **List and detail** take the status, products and phase from `TenantDirectory.access`, modules and the ceiling from `AccessService`, and limits from `PlanLimits`: the same readers the guards use, so the console shows exactly what is enforced. Modules and ceiling keys come back in catalog order.
- **Plan label:** the names of the subscription rows that are not deleted, a cancelled one marked "(cancelled)"; "Trial, no plan" for a trial with none, and "No plan" for a company that is not a trial and has none.
- **Members** is a count of control `member` rows (people who can sign in), not seats in use, which need the company database.
- **Database:** `{ status, schemaVersion, hasError }`. `last_error` is read only as `last_error is not null`, so its text never leaves the control database. A test plants a marker in it and checks no answer contains it.
- **Directory, restricted:** the default role templates of the company's products (`PRODUCT_ROLES`, `roleTemplate`), its pre-sign-in branding without logo storage keys, `users: []` and `restricted: true`. No company database is read.
- **Reads are not audited:** part 1 reads no company data.

### Audit (`modules/platform/platform-audit.service.ts`)
- Every /platform write records the actor, the company, the action, the target, before, after, the IP and the user agent in `platform_audit_log`, inside the write's own control transaction, stamped with `clock_timestamp()` so the order of rows follows the order of commits under the company lock. `created_by` is the actor.
- `company.access_changed`: target `tenant`. `before` holds the effective `userLimit` and `branchLimit` that changed; `after` holds `modulesSwitchedOn`, `modulesSwitchedOff`, `keysAdded`, `keysRemoved`, `userLimit` and `branchLimit`, each only when it changed, plus `overrideRows` (the module override writes and removals) and `limitRows` (each subscription row's new overrides) when there were any. So a save that wrote rows without changing effective access, such as an override set back to the plan, is still on record.
- Nothing is written to the company's own `audit_log`. Writing it from a platform route would open a company database, a tenancy change (owner question).

### Support access request (`modules/platform/support-requests.service.ts`)
- `POST /platform/support-grants` moved from `modules/users/access-requests.controller.ts`. The inline admin check is gone: the guard proves the admin. Both roles may ask, after a step-up. The body is now strict (an unknown field is 400), and the company check runs inside the transaction. It writes `support.requested`, now with the IP and user agent. The Owner's approve and revoke in the users module are unchanged.
- With `admin.access` off it answers 404 like every /platform route.
- A grant still opens nothing.

### Refactors in core/access (no behaviour change; called out for the security reviewer)
- `AccessService` (`core/access/access.service.ts`): the private `modulesOf` and `ceilingOf` bodies became public `companyPlanModules`, `companyModuleOverrides`, `companyModules` and `companyCeiling`. They take a company id and an optional control transaction, keep the same queries in the same order and read the control database only. `modulesOf` delegates; `ceilingOf` is gone and its callers use `companyCeiling`. Any module can now call these with a company id; they return control rows only.
- `PlanLimits.limitsOf` (`core/access/plan-limits.ts`, new, registered in `AccessModule`) replaces `UsersService.userLimit` with the same rule (every subscription row that is not deleted, cancelled ones included, gives its override or its plan's limit; the largest wins; null with none) and adds `branchLimit` by the same rule. The users module now uses it. Its query lives in `PlanLimits.rowsOf`, which returns those rows with their ids, overrides and plan limits; `limitsOf` reduces them and the console's save writes to them, so there is one copy of the query (review round 3).
- Nothing in `core/auth` or `core/tenancy` changed.

### Web (apps/web)
- **ApiClient:** `listPlatformCompanies`, `getPlatformCompany` (null for an unknown company or an id that is not a UUID, which is never sent), `updatePlatformCompanyAccess` and `getPlatformDirectory`, all in `API_METHODS`. The PATCH body is rebuilt from the four fields only. `updateCompanyAccess` and `CompanyAccessPatch` are removed. `listCompanies` and `listCompanyDirectory` stay on DemoStore for the company switcher, the palette and the demo sign-in.
- **Who may open /admin:** in api mode the layout asks `GET /platform/me` with the browser's cookies (`getPlatformGate`, `platformGateOf`). 401 or `mfa_enrolment_required` go to /login, 404 is not found, a known role opens the console, and every other answer (403, an unknown role, a 5xx, a network failure, an unreadable body) goes to /. The API's guard decides again on every request.
- **Pages:** the companies list gains Cancelled, Phase, Products, "No limit" and Members; the access page reads `PlatformCompany` and the directory, with one permission matrix over all the company's products' offered, visible modules; limit inputs are disabled on a trial with no plan; the branch limit says "Stored, not enforced yet."; a restricted directory shows the default roles and says users need support access. Save sends only the changed parts, after the step-up dialog in api mode, then reads the company again. The import and database pages are not found in api mode, and their tabs show in demo mode only.
- **Demo mode** behaves as before, except that the store runs `accessPatchProblem`, keeps hidden modules and keys as stored, and saves without a step-up. It keeps the full fixture directory and the company's "Changed company access" entry. Each demo company has one stand-in plan row (price "0.00") so its limits stay editable; nothing shows it.
- `useFormatDate` falls back to "MMM d, yyyy" outside a company workspace, so a filter chip on /admin no longer needs a WorkspaceProvider. Every console date (tables, filter chips, the company facts, the data import) goes through it, so the format is defined once.

## Safest options taken (also in docs/blueprint-delta.md)
1. **A step-up on every /platform write, the support request included.** The spec asked only for a platform session there. With no admin host the console runs on a company host with the home company's session, so a stolen session or a script on that origin could otherwise file requests in an admin's name. The Owner's approval also needs a step-up (ADR 0034).
2. **A module-local guard that denies by default**, not a new global access level, so core/tenancy does not change. It accepts only the roles `owner` and `support`, answers 401 itself as a backstop, and a metadata test shows every controller whose path starts with `platform` carries `@SessionOnly()` and the guard at class level.
3. **Only the `owner` role writes access;** `support` reads and requests support access. The spec does not separate the roles (owner question).
4. **`:id` names a company for control rows only**, with lint and the failed-and-maintenance test as proof. This is written down as the one exception to tenancy rule 2.
5. **Audit in `platform_audit_log` only.** Company Owners no longer see ceiling changes in their own audit log in api mode (docs/api-contract.md said "written to the company's audit log as Platform admin"; the product spec has a "Changed company access" entry). The demo keeps its entry.
6. **Reads are not audited.** Blueprint p28's "every action in the platform audit log" is read as every change, because part 1 reads no company data.
7. **A restricted directory:** the default role templates and no users, which exposes less than blueprint p6's "read-only list of the company's roles and users". The real directory waits for grant use (blueprint p7 rule 6, p29).
8. **No migration error text in the console, for every role:** only the status, the schema version and `hasError`. The text can quote a company's rows. The SQLSTATE code waits for part 3, because `last_error` stores no code today (part 3 shows it: ADR 0053).
9. **The resulting ceiling must contain the five Users, Security roles and Audit log keys,** not merely "not lose" them. A new company starts with an empty ceiling, and the ceiling binds the Owner too.
10. **Limits go on every subscription row that is not deleted,** cancelled ones included, so a lowered limit takes effect. A company with none answers 422 and no row is created, because any row ends a fresh trial for good.
11. **A module set back to what the plan gives soft-deletes its old override row.**
12. **Hidden modules and their keys are refused in a request and kept as stored,** so the screen filters before it sends.
13. **The /admin import and database pages are not found in api mode**, not merely missing their tabs; import is a later item in the queue.
14. **`admin.access` off also hides the support request** (404); before, the route did not read the switch.
15. **The support request body is strict.**
16. **Every audit row carries the IP and user agent,** and rows are stamped by the database clock at insert.
17. **e2e on the shared database:** the api-mode spec unticks a key nothing else checks (`retail.sample.view`), restores its ceiling row from a snapshot through the database in `afterAll`, and removes the `platform_admins` row; global setup clears a leftover row.
18. **The web gate denies by default:** any answer it does not recognise sends the person to /.

## Kept as the spec says (not safety)
- Changes apply at once, and a user limit may be lowered below the seats in use (product spec, edge cases).
- Products are read-only in the console.
- The Platform module can't be switched off, and its switch stays disabled on screen.
- The demo keeps its directory, its company audit entry and its saves without a step-up, so the demo admin spec's save flow does not change. That spec gained only one assertion, for the console's date format (review round 1); the import spec was not edited.

## Deferred, not invented
- **The admin host** (blueprint p16, p28). The console runs on a company product host; `apps/api/test/users.int.test.ts` says "until the admin host exists (P17)", so deferring it is a change from what was planned.
- **Using a support grant** to open a company read-only. ADR 0034 said P17 must build it; it is a tenancy change.
- **The real company directory:** custom roles and users.
- **Writing the company `audit_log` as "Platform admin"** for access changes and support requests.
- **Adding and removing platform admins.** Today it takes raw SQL and writes no audit.
- **Provisioning from the console**, with the owner's invitation.
- **All billing** (parts 2 to 4 below).
- **Branch-limit enforcement:** stored, not enforced, until Settings → Locations moves to the API. That is a module dependency, not an owner question.
- **The life-cycle dates** (`phaseDates`) move to part 2, with the ladder refactor.

## Later parts
- **Part 2** (`feat/platform-manual-billing`): plans as data (list, create, edit, retire), and suspend, reinstate and cancel through a shared `statusAfter`, leaving subscription rows alone, behind a new switch `admin.billing`. Creating or changing a subscription, recording a payment and correcting a period wait for the owner: an `active` row counts as paid, so a subscription created before any payment would give a never-paid company the paid ladder, and a payment would exist only as an audit row and a moved date, with no record that can't be edited (CLAUDE.md rule 9).
- **Part 3** (`feat/platform-audit-support`, PR #36), built in [ADR 0053](0053-platform-audit-support.md). It covers `GET /platform/audit`, with migration rows as `{ code }` only, old rows included, and IP and user agent for the owner role only; support requests in the console with limits; database and maintenance columns with the SQLSTATE code; migrate.ts hardening; the read-only access page for the support role.
- **Part 4** (`feat/billing-company-standing`, PR #38), built in [ADR 0054](0054-company-standing-billing-support.md). It covers `GET /company/standing` with its own class-level membership guard; the maintenance, unavailable and suspended screens; the Owner's banner; a read-only billing page behind the new switch `settings.billing`; the Owner's support-access panel, saying support can't see data yet.

## For the owner
- **The go-ahead:** PR #34 follows the CLAUDE.md self-merge rule once its reviews are clean.
- **Questions** (also in docs/specs/platform-admin.md, "Waiting for the owner"):
  1. The admin host, the rule that an admin's home company is one the platform controls, and admin sessions on the stricter of the platform's and the company's timeouts.
  2. Using a support grant (read-only access, every read audited).
  3. The real company directory: blueprint p6 against p7 rule 6.
  4. Writing the company `audit_log` as "Platform admin", so Owners see access changes again.
  5. Who adds platform admins. Proposal: a CLI that writes `platform_audit_log`.
  6. Provisioning from the console, with the owner's invitation.
  7. Billing: what "paid" means (`first_paid_at` or an `active` row), the payment record (`platform_payments` or the audit row), invoices, prices, trial length, $0 plans, proration, unlimited plans and employee bands, and approval of the billing spec.
  8. What the `support` role may do compared with `owner` (taken: read and request only).
  9. The step-up on a support request (taken: required).
  10. Products editable per company (taken: read-only).
  11. A check against stale saves when two admins edit one company (taken: the last save wins).

## Residual risks
- **The console runs on a company host.** It uses the home company's cookie and session timeouts, which Owners will be able to edit later. Any script injected on that origin could read every /platform GET with the admin's session; the step-up protects writes only. The home company's Owner can remove the admin's membership, which stops them signing in (availability only).
- **The audit IP is the web proxy's.** Express has no `trust proxy`, so in production `platform_audit_log.ip` holds the proxy's address, as the company audit log already does. Fixing it touches core/auth's client-IP handling.
- **`platform_audit_log` has no append-only trigger**, unlike the company `audit_log`. Adding one is a migration.
- **Company Owners no longer see access changes** in their own log in api mode.
- **The seat limit is checked only on invite.** Enabling a disabled user does not check it, so a lowered limit can be got round by disabling and re-enabling someone.
- **The branch limit is not enforced.**
- **The api-mode company shell** still reads modules and the ceiling from DemoStore until `GET /company` moves, so after a console change a button may look enabled while the API refuses it with 403.
- **Closed by ADR 0053: the support role saw the editor.** The console now knows the admin's role from `GET /platform/me`, and the access page is read only for the support role (no Save, no step-up).
- **Nothing links to /admin in api mode;** an admin types the address.
- **The list costs about ten small control queries per company,** one company after another. Fine at today's count; a follow-up.
- **The feature-off 404** has Nest's default body, `{ code: "not_found", message: "Not Found" }`, as `requireFeature` elsewhere.
- **The error text stays in the control database** in `last_error`, and old `company.migration_failed` audit rows hold it in `after`. Part 3's viewer redacts every row to `{ code }` and new rows hold only the code (ADR 0053); the old rows' text is still readable with SQL access to the control database.
- **Each local api-mode e2e run** adds one `company.access_changed` row to the local `platform_audit_log`, which is append-only by design.

## Consequences
- **No schema or dependency change:** no table, column, index or migration, and no dependency. No behaviour change in core/auth or core/tenancy. Two no-behaviour-change refactors in core/access (above).
- **The support request moved** to modules/platform, now needs a step-up and answers 404 with `admin.access` off. The session-only map in `isolation.int.test.ts` has it at 403 for a non-admin, where it was 400.
- **The docs changed:** docs/specs/platform-admin.md (new), docs/api-contract.md (Tenancy exception and session-only routes, the support row, the Platform section), ADR 0030 and ADR 0034 notes, docs/product-spec/settings-and-permissions.md ("Real build (ADR 0052)" and the renamed calls), docs/specs/settings-users-access.md ("Support access"), docs/data-model.md, docs/FEATURES.md (the `admin.access` note; the switch's key, product, module, status and screens are unchanged) and docs/blueprint-delta.md.
- **Tests:**
  - packages/shared `test/platform-access.test.ts`, 48 cases: the refusals and their order, the protected keys, the 422, the shared limit check (`isAccessLimit`), `moduleOverridesFor` (off, back to the plan, then the plan adds it), `ceilingRowsFor`, `limitOverrideFor` with an active and a cancelled row, a two-product company, `accessDiff`, `inModuleOrder`. `test/access-rules.test.ts` lists `userLimitOverride` and `branchLimitOverride` as not sensitive (they are seat and branch counts).
  - apps/api `test/platform-admin-guard.test.ts`, 6 unit cases: the 401 backstop; 404 while switched off, without reading the admin row; 403 for anyone who is not an active admin with an accepted role; reads without a step-up, with the actor recorded; the owner-only default on writes, checked before the step-up; and a step-up on every write, the support request included.
  - apps/api `test/platform.int.test.ts`, 18 cases: the metadata test; 401 on every route; 403 whatever the body for a non-admin, an inactive, a deleted and a `billing`-role admin; `mfa_enrolment_required`; 404 with the switch off; the support role refused on PATCH; the step-up on PATCH and on the support request; each validation of acceptance criterion 8 with its message, among them a foreign module and a foreign key on an HR-only company and an Installation key on Summit, with no audit row written; the 422 that creates no row; effects at once on Summit (key, module, seat limit); an override soft-deleted back to the plan; limits on an active and a cancelled bigger-plan row, and none on a deleted row; audit rows with IP and user agent, none for a no-op, nothing in the company's `audit_log`; 200 for a failed and a maintenance company; no error text; 400 for an id that is not a UUID and 404 for an unknown or deleted company; both roles requesting support access.
  - `test/isolation.int.test.ts` and `test/users.int.test.ts` updated.
  - apps/web `tests/unit/platform-console.test.ts`, 17 cases: the HTTP paths and the PATCH whitelist, the save logic, the demo mapping and merge, and every gate outcome.
  - apps/web `tests/e2e-api/platform-admin.spec.ts`, 2 tests: sign in and enrol, /admin lists Summit, untick a key, a wrong step-up code, save, the toast, reload, then the import and database pages answer 404 with the not-found page; and a company user (the seeded manager) who opens /admin is redirected to /. The ceiling row is restored and the admin row removed afterwards. Test helpers `setPlatformAdmin`, `removePlatformAdmin`, `snapshotCeilingRow` and `restoreCeilingRow` are in `packages/db/src/testing.ts`, because apps/web has no drizzle dependency.
