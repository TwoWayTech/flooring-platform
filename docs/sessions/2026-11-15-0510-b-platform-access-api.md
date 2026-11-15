# Session 2026-11-15 05:10, B (Claude): platform admin on the API, part 1 (companies and access)

Person: B (Claude), on B's Mac. Branch `feat/platform-access-api`, from main at `253058a`. This is an unattended overnight run: the owner restarted the queue and is asleep, so open points take the safest option and are recorded in docs/blueprint-delta.md and ADR 0052. The meetings build runs at the same time in its own worktree (`/Users/sarah/dev/flooring-platform-meetings`, `feat/meetings-api-core`, PR #33). This branch does not touch it.

## Prompt (owner's queue order and decision rule)
- **Queue (owner, 2026-11-15, recorded in STATUS):** "Then the queue restarts in this order: meetings; platform admin and manual billing; reports; import; cross-module api-mode e2e flows; the whole-product check."
- **The owner's prompt, as the previous session log quotes it:** "Then continue the work queue in the order STATUS gives (meetings, platform admin and manual billing, reports, import, cross-module Playwright api-mode flows, then the whole-product check)."
- **Overnight rule:** the owner is asleep. Pick the safest option and record it in docs/blueprint-delta.md.
- **How the orchestrating session applies the rule to this module:**
  - **Follow the spec.** The spec is the approved behaviour. Deviate only in the safer direction: less exposure, deny by default, and refuse what can't be done correctly. Record each deviation in the delta and in ADR 0052.
  - **No schema, dependency or core changes:** no new or altered table, no migration, no new dependency, and no behaviour change in `apps/api/src/core/auth` or `core/tenancy`. A refactor in `core/access` that changes no behaviour is allowed, and it is called out for the security reviewer.
  - **Deferred, not invented:**
    - the admin host;
    - using a support grant;
    - the real company directory;
    - writing the company `audit_log` as Platform admin;
    - adding platform admins;
    - provisioning from the console;
    - all billing. Parts 2 to 4 are later PRs.

## Inputs
- **Read-only research reports:** the spec and the blueprint, the control schema, platform auth, the admin web screens, and the API recipe.
- **A four-part plan,** and a critic's review of it.
- **What part 1 takes from the review:**
  - its section A items 1 to 7 and its minor fixes;
  - its notes in section B on tenancy rule 2, audit and MFA.

## Plan (part 1, final)
This is the plan re-checked against the review and the code on `253058a`. The draft spec is docs/specs/platform-admin.md.

### 0. Facts it rests on (checked in the code)
- **ADR numbers:** ADRs end at 0050 on main, and 0051 is meetings, so this module takes **0052**. No control migration is added; they end at 0004.
- **Session-only routes:** they skip TenantGuard, PermissionGuard and the AuditInterceptor. A class-level platform guard is therefore their only authorization layer, and the service writes its own audit rows.
- **Unique indexes:** `tenant_permission_ceiling_uidx` and `tenant_module_overrides_uidx` ignore `deleted_at`, so every upsert clears `deleted_at`.
- **The user limit:** `UsersService.userLimit` takes the largest limit over every subscription row that is not deleted, cancelled rows included.
- **The fresh trial:** any subscription row, even a deleted one, ends it for good (`access.service.ts`, `freshTrial`).
- **`tenant_databases.last_error`:** it holds the driver's message text only, with no code (`migrate.ts`, `errorText`). That text can quote company data.
- **The ceiling binds the Owner:** `effectivePermissions` has no Owner exemption. The Owner flag and MFA come from roles, not keys.
- **Hidden modules:** `PRODUCT_MODULES` includes `platform`, and `visibleModules()` hides Installation while its switch is off (rule 18). Summit's fixture modules and ceiling include Installation, so the screen must filter before it sends.

### 1. Shared rules (packages/shared)
- **`src/types/platform.ts`** holds `PlatformMe`, `PlatformAdminRole`, `PlatformCompanySummary`, `PlatformCompany`, `PlatformSubscription`, `PlatformAccessPatch`, `PlatformDirectory` and `PlatformDatabaseStatus`.
  - `id` is a UUID string, not the demo `CompanyId`.
  - `status` is `LifecycleStatus`, which has five values.
  - Limits are `number | null`, and `price` is a decimal string.
- **`src/platform/access-patch.ts`**, with a JSDoc on each export that points to the spec section:
  - `PROTECTED_CEILING_KEYS`: `settings.users.view`, `settings.users.manage`, `settings.roles.view`, `settings.roles.manage` and `settings.audit.view`.
  - `accessPatchProblem(facts, patch, visible)` returns null or a refusal (400 or 422, with the spec's message). `facts` is the products plus whether a subscription row that is not deleted exists.
  - `moduleOverridesFor(products, planModules, requested, visible)` gives each offered, visible module other than `platform` one of three results: write the override, remove it, or leave it.
  - `ceilingChangesFor(products, storedAllowed, requested, visible)` gives the keys whose `allowed` value changes.
  - `limitOverrideFor(planLimit, requested)` gives null when the plan already gives that number.
  - `accessDiff(before, after)` gives the audit row's `after`: `modulesSwitchedOn`, `modulesSwitchedOff`, `keysAdded` and `keysRemoved`.
- **Tests (`test/platform-access.test.ts`)** cover:
  - `platform` missing from the list;
  - a foreign module, and a hidden one, which is refused and also left as stored;
  - an unknown key, a foreign key, and a missing protected key;
  - a limit with no subscription row (422);
  - a limit equal to the plan's, which gives null;
  - a module back to what the plan gives, which removes the override;
  - a two-product company;
  - the diff.

### 2. API refactors in core/access (no behaviour change; call these out for the security reviewer)
- **`AccessService`:** new public `companyModules(companyId, status, products)` and `companyCeiling(companyId)`. The private `modulesOf` and `ceilingOf` delegate to them, so the console shows exactly what the guards enforce.
- **`core/access/plan-limits.ts`:** a `PlanLimits` provider, registered and exported in `AccessModule`. Its `limitsOf(companyId)` returns `{ userLimit, branchLimit }`.
  - The query and the "largest limit" rule are moved unchanged from `UsersService.userLimit`, which now calls it.
  - The branch limit uses the same rule over `branch_limit_override ?? plan_limits.max_branches`.

### 3. API: new module apps/api/src/modules/platform
- **`platform.module.ts`:**
  - imports `AuthModule` (for `StepUpService`) and `UsersModule` (for `SupportGrantsService`, which UsersModule now exports);
  - is registered in `app.module.ts`.
- **`platform-admin.guard.ts`:**
  - `PlatformAdminGuard`, which runs in the order the spec gives:
    1. 401 without `request.authSession`;
    2. 404 while `admin.access` is off;
    3. 403 unless the person has an active, non-deleted row with role `owner` or `support`;
    4. for any write, the route's role (owner unless `@PlatformRoles` says otherwise), then `stepUp.require(session)`.
  - It attaches the actor.
  - `@PlatformRoles(...)` widens which roles may write.
- **`platform-actor.ts`:** `PlatformActor { userId, name, email, role, session, ip, userAgent }` and `@CurrentPlatformActor()`. The decorator throws when the guard did not run.
- **`platform-admins.ts`:** `activePlatformAdmin(control, userId)` returns the role or null, and accepts only `owner` and `support`. `mfa-policy.ts` and `assertMfaResettable` stay as they are: they are core/auth, or differ on purpose.
- **`platform-audit.ts`:** `recordPlatformAudit(tx, actor, entry)` writes the actor, the company, the action, the target, before, after, the IP and the user agent in the caller's transaction.
- **`platform-input.ts`:** a strict Zod `ACCESS_PATCH`, with lists capped at the catalog size and limits as integers from 1 to 100,000. `SUPPORT_REQUEST` moves here.
- **`platform.controller.ts`:** `GET /platform/me`.
- **`companies.controller.ts` and `companies.service.ts`:**
  - **List:** `TenantDirectory.access` per company, so the phase is the one TenantGuard sees. That is N+1 queries, accepted at today's company count and noted as a follow-up. Also `companyModules`, `PlanLimits`, products, plan names and the member count.
  - **Database:** status, schema version, and `last_error IS NOT NULL` only. The text is never selected.
  - **Detail:** also the ceiling and the subscription rows.
  - **Directory:** the default templates and branding, restricted.
  - **PATCH, in one control transaction:**
    1. Lock the company row with `FOR UPDATE`. A missing or deleted company answers 404.
    2. Check with `accessPatchProblem`.
    3. Write: upsert the overrides that are needed and soft-delete the ones that aren't; write the ceiling rows that change; set the limit overrides on every subscription row that is not deleted.
    4. Read the effective access before and after.
    5. Write one audit row, or none when nothing changed.
    6. Answer with the company read again.
- **`support-grants.controller.ts`:**
  - `POST /platform/support-grants` moves here from `users/access-requests.controller.ts`, with `@PlatformRoles("owner", "support")`.
  - `SupportGrantsService.request(actor, companyId, reason, hours)` drops its inline admin check, because the guard's actor proves it.
  - It writes its audit row through `recordPlatformAudit`, which now adds the IP and user agent.
  - Approve and revoke are unchanged.
- **`apps/api/eslint.config.js`:** a block for `src/modules/platform/**` that keeps the company-database rules and also bans:
  - `**/tenancy/tenant-connection.service`;
  - `**/tenancy/tenant-context`;
  - `**/jobs/job-tenants`;
  - `@workspace/db/company`.

### 4. Web (apps/web)
- **`lib/api/contract.ts`:**
  - Add `listPlatformCompanies()`, `getPlatformCompany(id)`, `updatePlatformCompanyAccess(id, patch)` and `getPlatformDirectory(id)`.
  - Remove `updateCompanyAccess` and `CompanyAccessPatch`; only the access page used them.
  - Keep `listCompanies` and `listCompanyDirectory`, because the switcher, the palette, the demo login and `switch-company.ts` call them.
- **`lib/api/http/api-methods.ts`:** the four entries. The PATCH body picks only `modules`, `ceiling`, `userLimit` and `branchLimit`, and ids go through `encodeURIComponent`.
- **`lib/api/demo/store.ts`:**
  - The four methods, built from the fixtures:
    - id = slug, products = `[product]`, phase `full`, subscriptions `[]`;
    - database `ready`, members = the fixture's users.
  - `updatePlatformCompanyAccess` replaces `updateCompanyAccess`:
    - it checks `accessPatchProblem`;
    - it keeps hidden modules and keys as stored;
    - it still writes the demo company's "Changed company access" entry.
- **`lib/session/server.ts`:** `getPlatformAdmin()`.
  - Demo mode: `session.kind === "platform"`.
  - Api mode: `GET /platform/me` with the forwarded cookies and host, read as admin, signed out (no cookie, 401, or MFA still to set up), not an admin (403), or off (404).
  - `getSession` and `toCompanySession` don't change.
- **`app/admin/layout.tsx`:** uses `getPlatformAdmin()`. Signed out goes to /login, not an admin goes to /, and off gives `notFound()`.
- **`app/admin/companies/[id]/page.tsx`:** `id` is a string, and the cast goes.
- **The import and database pages:** `notFound()` in api mode. In demo mode, `notFound()` unless the id is a fixture company id, with no cast.
- **`features/admin/company-admin-nav.tsx`:** the data tabs show in demo mode only.
- **`features/admin/companies-page.tsx`:** a Cancelled status, Phase and Products columns, and "No limit".
- **`features/admin/company-access-page.tsx`:**
  - It reads `getPlatformCompany` and `getPlatformDirectory`, and takes its modules from `products[]`.
  - The ceiling and the preview are per product.
  - On a trial with no plan, the limit inputs are disabled with the hint. The branch limit says "Stored, not enforced yet".
  - On a restricted directory, the Roles and Users panels say why they show only the default roles and no users.
  - **Save:**
    1. the step-up dialog;
    2. only the changed parts, filtered to the offered, visible modules and keys;
    3. the toast;
    4. `query.retry()`, because HTTP writes don't emit.

    A refusal shows the API's message.
- **`components/data-table/filter-chips.tsx`:** check whether a column filter on /admin crashes, because `useFormatDate` needs a WorkspaceProvider. Fix it if it does.

### 5. Tests (one file at a time, heavy runs through the lock)
- **Shared unit:** section 1.
- **API unit:**
  - the guard: the 401 backstop, an unknown role, the owner-only default on writes, and the step-up checked on writes only;
  - a metadata test: every controller whose path starts with `platform`, across AppModule, has `@SessionOnly()` and `PlatformAdminGuard` at class level.
- **API integration (`test/platform.int.test.ts`):**
  - **Setup:**
    - home companies through `harness.addCompany`;
    - admin rows inserted before `enrolled()`;
    - target companies with `tenantProducts` rows;
    - one target with a fake `tenant_databases` row with status `failed`, and one in maintenance.
  - **Cases:**
    - 403 for a non-admin on every /platform route, through `checkedRoutes()` filtered to /platform;
    - 403 for an inactive admin, a deleted one, and one with role `billing`;
    - `mfa_enrolment_required`;
    - 404 with the switch off (the `california-switch.ts` pattern);
    - the support role refused on PATCH;
    - `step_up_required`;
    - the validation refusals;
    - 422 on a trial with no plan, which leaves no row and every module on;
    - the effects at once on Summit (key, module, seat limit);
    - an override soft-deleted when a module goes back to the plan;
    - an active row plus a cancelled row on a bigger plan;
    - the audit row with the IP and user agent, no row for a no-op, and nothing in the company's `audit_log`;
    - 200 for the failed and maintenance targets;
    - no `last_error` text, no users in the directory, 404 for an unknown or deleted company, and 400 for a non-UUID id.
- **`test/isolation.int.test.ts`:** the session-only map gains every new /platform route at 403. `POST /platform/support-grants` goes from 400 to 403.
- **`test/users.int.test.ts`:** the support request now steps the admin up first.
- **Web unit:** the api-router test checks the PATCH whitelist and the paths. A demo-store test checks the shared validation.
- **Playwright, api mode (`apps/web/tests/e2e-api/admin.spec.ts`):**
  - **Account setup:**
    - a test-only `setPlatformAdmin(url, email, role)` in `@workspace/db/testing`;
    - global setup removes any leftover row, then grants the owner role to a seeded Summit user that no other api spec signs in as, and adds that user to `SEEDED_EMAILS`;
    - a global teardown removes the row.
  - **Flow:**
    1. Sign in and enrol TOTP.
    2. /admin lists Summit.
    3. Untick a key that nothing checks: `retail.sample.view`, confirmed by grep at build time.
    4. Step up, save and see the toast. Tick it back.
    5. The key is restored in `finally` through the database, not the UI.
    6. `MANAGER_EMAIL` is sent to /.
    7. `/admin/companies/<id>/import` is not found.
- **Playwright, demo mode:** `admin.spec.ts` and `import.spec.ts` keep passing unchanged.

### 6. Docs
- **New files:**
  - docs/specs/platform-admin.md (done in this step);
  - ADR 0052, which later parts add sections to. It covers:
    - the guard and the roles;
    - the step-up on every write;
    - the `:id` exception;
    - the audit in the platform log only;
    - the restricted directory;
    - no error text;
    - the refactors;
    - the deferrals.
- **docs/blueprint-delta.md:** one 2026-11-15 row with every safe option below.
- **docs/api-contract.md:**
  - the Platform section;
  - the exception to the Tenancy rule, with the list of session-only routes;
  - the support row: the guard and the step-up.
- **docs/data-model.md:** the Company → `PlatformCompany` mapping, `platform_admins` in api mode, and the audit actions.
- **ADRs and specs:**
  - the stale line in ADR 0030 ("only `/auth/context` uses `@SessionOnly()`");
  - the "Support access" section of docs/specs/settings-users-access.md;
  - pointers in docs/product-spec/settings-and-permissions.md: who uses it, "Change company access", the audit entry and the store-check edge case.
- **Feature switch:** the `admin.access` note for api mode in docs/FEATURES.md and `features.ts`, through `/feature-change`.
- **STATUS and BRANCHES:** the orchestrating session updates them (the ADR 0052 reservation, owner questions and follow-ups).

### 7. Process
1. Commit with `[skip ci]` while the PR is a draft.
2. Run `/review`.
3. Run a fresh security-reviewer pass. It covers permissions, auth-adjacent and tenancy-adjacent work, and must see the `core/access` refactors and the lint block.
4. Rebase on main once meetings PR #33 merges; it touches the same shared files.
5. Mark the PR ready.
6. When `verify` and `e2e` are green, self-merge under the CLAUDE.md rule.
7. Run `/handoff`.

## Decisions and why
**Safe options.** Each is recorded in docs/blueprint-delta.md and ADR 0052 when the docs step lands.

- **The guard:**
  - It is local to the module, not a new global `AccessLevel`, so core/tenancy does not change.
  - It accepts only the roles `owner` and `support`, because the column is plain text with no CHECK.
  - It answers 401 itself as a backstop.
- **Every /platform write needs a step-up,** the support-access request included. The approved spec asked only for "a platform session" there.
  - This is safer: the console runs on a company host with the home company's session, so a stolen session or a script on that origin could otherwise file requests in an admin's name.
  - Writes need the owner role unless a route allows support. Only the support request does.
- **A company is named by `:id`** (ParseUUIDPipe) for control rows only. It never reaches TenantConnectionService, lint enforces that, and a test shows GET and PATCH answering for a company whose database failed or is in maintenance.
- **Audit:**
  - Changes are written to `platform_audit_log` only, with the IP and user agent, so company Owners no longer see ceiling changes in api mode (owner question 4).
  - Reads are not audited, because no company data is read.
- **A restricted directory:** the default role templates and no users. This is less exposure than blueprint p6, and the real directory waits for grant use.
- **No migration error text in the console** (review A1): only the status, the schema version and `hasError`. The SQLSTATE code waits for part 3, because `last_error` stores no code today.
- **The resulting ceiling must contain** the five user, role and audit keys (review A5), not merely not lose them.
- **Limit overrides go on every subscription row that is not deleted,** cancelled ones included (review A2). With no such row the answer is 422, and a row is never created.
- **A module set back to what the plan gives** soft-deletes its old override row (review A3).
- **A request may not name a hidden module or key.** Those stay as stored, so the screen filters before it sends.
- **The /admin import and database pages are not found in api mode** (review A7), not merely missing their tabs.
- **e2e on the shared database** (review A6): the ceiling key is restored in `finally` through the database, the admin row is removed in teardown (and leftovers in setup), and the key unticked is one nothing checks.
- **Smaller choices:**
  - "Members" is not seats.
  - `phaseDates` moves to part 2, because it needs the life-cycle ladder refactor.
  - The last save wins.
  - `admin.access` off also hides the support request (404).
  - No new feature key in part 1.
- **The review's minor fixes are taken:**
  - The step-up wording is settled: every write.
  - Guards run before pipes and the handler's Zod check, not before body parsing.
  - The rule reads "a `modules` list that lacks `platform` is refused".
  - "Members" does not mean seats.
- **Changes from the earlier plan:**
  - The spec is named `platform-admin.md`, as the task asked.
  - `database.lastError` is dropped for every role.
  - `phaseDates` moves out of part 1.
  - Limits go on every row that is not deleted.
  - The data pages refuse.
  - A lint block and a metadata test are added.
  - The support request needs a step-up.
- **Built on a draft spec.** The P11 approval stop can't happen overnight. This follows the precedent of `settings-users-access.md`, and here it is the overnight rule's choice.

## Done in this step
- docs/specs/platform-admin.md: the draft spec, with the parts 2 to 4 outline and the owner questions.
- This session log.
- The draft PR.

## Left
- Build plan sections 1 to 5, then the docs in section 6, then the reviews and the merge in section 7.
- **Owner questions** (spec, "Waiting for the owner"):
  - the admin host;
  - grant use;
  - the real directory;
  - company `audit_log` writes;
  - adding platform admins;
  - provisioning from the console;
  - all billing;
  - the support role;
  - the step-up on support requests;
  - products per company;
  - stale saves.
