# Platform admin: companies and access on the API (draft spec)

**Draft, built under the owner's overnight rule of 2026-11-15; open points took the safest option.** Part 1 is built on `feat/platform-access-api` (PR #34) and recorded in ADR 0052 and the 2026-11-15 row of docs/blueprint-delta.md. Part 3 is built on `feat/platform-audit-support` (PR #36), under the same rule, and recorded in ADR 0053 and its row of docs/blueprint-delta.md; see "Part 3: audit and support". Part 4 is built on `feat/billing-company-standing` (PR #38) under the same rule, and recorded in ADR 0054 and the top row of docs/blueprint-delta.md; see "Part 4: the company side". Part 2 is being built on `feat/platform-manual-billing` under the same rule, reduced to plans and company status, and is recorded in ADR 0056 and its row of docs/blueprint-delta.md; see "Part 2: plans and company status". Where the build settled a point this draft left open, the text below says what was built.

Drafted by Claude on 2026-11-15 as P11 step 1 for module 17, "Platform admin and manual billing" (docs/real-build-plan.md). docs/product-spec/settings-and-permissions.md describes the demo's console: who uses it, the "Change company access" workflow, rules 18 and 24, and the edge cases. It has no server design and nothing on billing.

The owner restarted the queue with this module next and is asleep. So this draft is built without the P11 "stop for my approval" step, as `docs/specs/settings-users-access.md` was (docs/blueprint-delta.md, 2026-11-13). Each open point takes the safer side and is recorded in docs/blueprint-delta.md and ADR 0052 (ADR 0053 for part 3, ADR 0054 for part 4, ADR 0056 for part 2).

Sources:
- blueprint p4 to p7: the layers of control, super-admin "Company access", and role rules 3, 6 and 8;
- blueprint p13 and p14 (control tables), p16 (admin host), p23 and p24 (billing and plans), p27 to p29 (MFA, super-admin, support access);
- ADR 0030, 0031, 0033 and 0034;
- docs/api-contract.md and docs/data-model.md.

## Parts

| Part | Branch | What | State |
| --- | --- | --- | --- |
| 1 | `feat/platform-access-api` | The platform guard, `/platform/me`, the companies list and detail, change company access, the restricted directory, and the support-access request behind the guard. The /admin console reads and writes the API in api mode | Built in PR #34; acceptance criteria 1 to 18 |
| 2 | `feat/platform-manual-billing` | Plans as data (list, create, edit, retire, restore); suspend, reinstate and cancel a company, behind the new key `admin.billing`. Subscriptions and payments wait for the owner | Being built (draft PR, ADR 0056); see "Part 2: plans and company status"; acceptance criteria 64 to 91 |
| 3 | `feat/platform-audit-support` | The platform audit viewer, support requests in the console with limits, database and maintenance columns, migrate.ts hardening, and the read-only access page for the support role | Built in PR #36 (ADR 0053); acceptance criteria 19 to 39 |
| 4 | `feat/billing-company-standing` | The company side: `GET /company/standing` and `GET /billing`, the maintenance, unavailable and suspended screens, the Owner's banner, a read-only billing page (new key `settings.billing`), the Owner's support-access panel | Built in PR #38 (ADR 0054); acceptance criteria 40 to 63 |

## Who uses it

- **Platform admin:** a person with a row in `platform_admins` that is `active` and not deleted, whose `role` is `owner` or `support`. Any other role value counts as no admin.
  - Both roles read every /platform page, with two limits from part 3: the support role doesn't see other admins' support requests or their reasons, and it gets no addresses or devices in the audit log ("Who may call what (part 3)").
  - Only the `owner` role changes a company's access. The support role sees the access page read only (part 3).
  - Both roles may ask a company for support access.
  - MFA is always required (blueprint p27; `MfaPolicy`). Every /platform write also needs a step-up from the last 5 minutes.
- **Company users:** nothing in part 1 is for them. A company user who calls /platform gets 403.
- **Adding or removing platform admins:** nobody does this through the app (owner question 5). Tests insert the rows.

## Stories (part 1)

1. As a platform admin, I see every company with its status, life-cycle phase, plan, products, modules and limits, so I know who is on what.
2. As a platform admin, I open a company and see its modules, permission ceiling, limits, subscriptions, the default roles and an effective-access preview, without seeing the company's own data.
3. As a platform admin with the owner role, I switch a module on or off, tick or untick permissions in the ceiling, and change the user and branch limits. The change applies to the company's next request.
4. As a platform admin, I ask a company's Owner for read-only support access, with a reason and a time. This exists already; it now sits behind the platform guard and a step-up.
5. As the business that runs the platform, I find every change made in the console in the platform audit log: who, when, from which address and device, and what changed.

## Sign-in and the platform session

- **No admin host yet.** Blueprint p16 and p28 call for a separate admin subdomain; it waits for the brand and domain (owner question 1). A platform admin signs in through a company they belong to, as ADR 0034's tests do, and opens /admin on that product host.
- **Session only.** /platform routes are `@SessionOnly()`: they need a session but no open company, and they never use the open company. TenantGuard and PermissionGuard don't apply to them. The platform guard is their only authorization layer, and it denies by default.
- **How a route names a company.** A route names its target company by `:id`, a UUID checked with `ParseUUIDPipe`.
  - The id selects control-database rows only: tenants, products, subscriptions, module overrides, the ceiling, branding and member counts.
  - It is never passed to TenantConnectionService, and no company database is opened. Lint forbids the tenancy, job-tenant and company-schema imports in `apps/api/src/modules/platform`.
  - This is the one exception to "the tenant comes only from the verified session" (docs/api-contract.md, Tenancy). It reaches no company data, so CLAUDE.md rule 2 holds.

## The platform guard

Every /platform route carries it at class level. It runs in this order:

1. **No verified session:** 401 `unauthenticated`. SessionGuard answers first. The guard checks again, so a route that ever skips SessionGuard is still closed.
2. **`admin.access` switched off:** 404 `not_found`.
3. **Not a platform admin:** 403 `forbidden`, "Only platform admins can use this." That means no row with this user, `active = true`, `deleted_at IS NULL` and role `owner` or `support`. The row is read on every request, so deactivating an admin takes effect on their next request.
4. **A write** (any method but GET, HEAD and OPTIONS):
   - It needs a role the route allows: `owner`, unless the route also allows `support`. Only `POST /platform/support-grants` allows `support`. Otherwise 403 `forbidden`, "Only the platform owner role can change this."
   - It needs a step-up from the last 5 minutes: 403 `step_up_required`, or `step_up_mfa_required` for someone with no factor.

SessionGuard's own refusals come before all of these. For example, an admin with no factor gets 403 `mfa_enrolment_required` until they enrol one. Guards run before the handler checks the body, so a non-admin gets 403 on every /platform route whatever the body.

## Endpoints (part 1)

| Method and path | Who | Step-up | Audit action | Answer |
| --- | --- | --- | --- | --- |
| `GET /platform/me` | Any platform admin | No | None | `{ userId, name, email, role }` |
| `GET /platform/companies` | Any platform admin | No | None | `PlatformCompanySummary[]`, by name |
| `GET /platform/companies/:id` | Any platform admin | No | None | `PlatformCompany`. 404 for an unknown or deleted company |
| `PATCH /platform/companies/:id/access` | Owner role | Yes | `company.access_changed` | Body `PlatformAccessPatch`. Answers with the company read again |
| `GET /platform/companies/:id/directory` | Any platform admin | No | None | `PlatformDirectory` |
| `POST /platform/support-grants` | Any platform admin | Yes | `support.requested` | `{ companyId, reason (10 to 500 characters), hours (1 to 72) }`. 201 `{ id }`; 404 for an unknown company. Part 3 adds 403 under the lock, 409 `grant_open` and 429 `rate_limited` |

A bad `:id` (not a UUID) answers 400 `invalid_request`. All of these routes answer 404 while `admin.access` is off, with Nest's default body `{ code: "not_found", message: "Not Found" }`, as `requireFeature` answers elsewhere. The support request's body is strict: an unknown field answers 400.

## Fields

### PlatformCompanySummary (list)

| Field | Type | From | Notes |
| --- | --- | --- | --- |
| `id` | UUID | `tenants.id` | |
| `slug` | string | `tenants.slug` | |
| `name`, `city`, `state` | string | `tenants` | |
| `products` | `ProductKey[]` | `tenant_products` | One product or both |
| `status` | `trial`, `active`, `past_due`, `suspended` or `cancelled` | `tenants.status` | As stored |
| `statusChangedAt` | ISO moment | `tenants.status_changed_at` | |
| `phase` | `full`, `read_only` or `locked` | `companyPhase`, read the same way as TenantGuard | |
| `maintenance` | `{ on, reason }` | `tenants.maintenance_mode`, `maintenance_reason` | Reason `migration_failed`, `move` or null |
| `plan` | string | `plans.name` of the subscription rows that are not deleted | "Trial, no plan" when there are none and the company is a trial; "No plan" when there are none and it is not (it then has no plan modules at all). A cancelled row reads "{name} (cancelled)"; several are joined with commas |
| `modules` | `ModuleKey[]` | `AccessService.companyModules` | Exactly what the guards enforce |
| `userLimit`, `branchLimit` | number or null | `core/access/plan-limits.ts` | Null means no limit (a company with no subscription row that is not deleted). The branch limit is not enforced yet |
| `members` | number | Count of control `member` rows | Sign-ins with a membership. This is not seats in use, which needs the company database |
| `database` | `{ status, schemaVersion, hasError, errorCode }` | `tenant_databases`; `errorCode` from `platform_audit_log` | `status` and `schemaVersion` are null with no database row. `errorCode` (part 3) is the SQLSTATE of the newest recorded failure, only while `hasError`, else null. Never the error text: it can quote company data (owner decision on maintenance, 2026-11-13; STATUS follow-up) |

### PlatformCompany (detail)

Everything in the summary, plus:
- `legalName`, `timeZone`, `region` and `createdAt`;
- `ceiling`: the allowed permission keys (`AccessService.companyCeiling`);
- `subscriptions`: the rows that are not deleted, each `{ id, planKey, planName, product, interval, price, currentPeriodStart, currentPeriodEnd, status, userLimitOverride, branchLimitOverride }`. `price` is a decimal string (CLAUDE.md rule 6).

### PlatformAccessPatch

`{ modules?, ceiling?, userLimit?, branchLimit? }`. The schema is strict, so any other field answers 400.
- **`modules`:** the complete list of modules to have on, among the modules the company's products offer that are visible (rule 18). It must include `platform`.
- **`ceiling`:** the complete list of allowed keys, among the keys of those modules.
- **`userLimit` and `branchLimit`:** whole numbers.
- **Leaving a field out** leaves that part unchanged. The screen sends only the parts that changed.

### PlatformDirectory

The directory is restricted (owner question 3):
- `roles`: the default role templates of the company's products (`PRODUCT_ROLES`, `roleTemplate`), each with key, name, permissions, data scope and the owner flag;
- `users`: always empty;
- `branding`: display name, monogram, brand colour, pattern and default theme, from `tenant_branding`. No logo storage keys;
- `restricted: true`.

No company database is read. The company's custom roles and its users need support access, which opens nothing yet.

## Validations (PATCH access)

`accessPatchProblem` in packages/shared checks these, so the API and the demo store refuse the same things.

| Rule | Answer |
| --- | --- |
| Unknown field, wrong type, a list longer than the catalog | 400 `invalid_request` |
| The `modules` list lacks `platform` | 400 "The Platform module can't be switched off." |
| A module the company's products don't offer, or one that is hidden (rule 18) | 400 "The {label} module isn't offered to this company." |
| A key that is not in the catalog | 400 "{key} is not a permission." |
| A key whose module is not offered and visible | 400 "{key} is outside this company's products." |
| The `ceiling` list lacks one of `settings.users.view`, `settings.users.manage`, `settings.roles.view`, `settings.roles.manage` or `settings.audit.view` | 400 "A company always keeps the Users, Security roles and Audit log permissions, so it can manage its own people." |
| A limit that is not a whole number from 1 to 100,000 | 400 "Enter a whole number from 1 to 100,000." |
| A limit when the company has no subscription row that is not deleted | 422 `rule_broken`, "This company has no plan, so it has no limits to change." (part 3; it said "is on a trial with no plan" before, which was wrong for a company that is not a trial) |
| Unknown or deleted company | 404 `not_found`, "That company does not exist." |

Duplicates in a list are ignored. The five protected keys must be in the result, not merely "not removed". The reason: the ceiling binds the Owner too (`effectivePermissions` has no Owner exemption). Without these keys, a company could not disable a person who left or change a role. Owner status and MFA come from the roles, not from keys, so a ceiling can't take them away.

## What a save does

A save is one control transaction, which locks the company row first (`SELECT … FROM tenants WHERE id = $1 FOR UPDATE`).

- **Modules** (blueprint p4, layer 2; ADR 0031). For each offered, visible module other than `platform`:
  - When it is on in the list and the plan gives it, or off and the plan doesn't, no override is needed. A live override row for it is soft-deleted, so an old "off" never outlives a change back.
  - Otherwise its override row is written with `enabled` true or false, clearing `deleted_at`, because the unique index ignores `deleted_at`.
  - A fresh trial's plan gives every module.
  - Hidden modules and modules outside the products keep their stored rows.
- **Ceiling** (blueprint role rule 3). For each key of the offered, visible modules, `allowed` is whether the list holds it. A row is written only when it changes, and a missing row counts as not allowed. Keys of hidden modules keep their stored rows. Roles keep their ticks: an unticked key is inactive, and ticking it again restores it.
- **Limits.** They are written to the override columns of every subscription row that is not deleted, cancelled ones included, because the limit is the largest across those rows. The save and the limit reader take those rows from one query, `PlanLimits.rowsOf` in `plan-limits.ts`.
  - A row whose plan already gives that number gets null, so an unchanged save pins nothing.
  - No subscription row is ever created. Any row, even a deleted one, ends a fresh trial for good (ADR 0033).
- **Effect at once.** Guards read modules, the ceiling and limits on every request, with no cache.
  - A removed key answers 403 `forbidden` on the company's next request that needs it.
  - A module switched off answers `module_not_enabled`.
  - A lower user limit refuses the next invitation with `seat_limit`. Lowering it below the seats in use is allowed (product spec, edge cases).
- **Nothing written:** no audit row is added. The answer is still 200 with the company. A save can write a row without changing effective access, such as an override set back to what the plan already gives or a limit pinned on a cancelled row; that save is audited.

## Audit

- **Where:** `platform_audit_log` only, in the same control transaction as the change. Each row records the actor (also as `created_by`), the company, the IP and the user agent. It is stamped by the database clock at the insert (`clock_timestamp()`), so a save that waited on the company row lock is stamped after the one that held it.
- **`company.access_changed`:**
  - target type `tenant`, target id the company's id;
  - `before` holds the effective `userLimit` and `branchLimit` that changed;
  - `after` holds `modulesSwitchedOn`, `modulesSwitchedOff`, `keysAdded`, `keysRemoved`, `userLimit` and `branchLimit`, each only when it changed;
  - `after` also holds `overrideRows` (each module override written or removed) and `limitRows` (each subscription row's new `userLimitOverride` and `branchLimitOverride`) when there were any, so the row records exactly what was written;
  - one row whenever any row was written, none otherwise.
- **`support.requested`:** as before, now with the IP and user agent.
- **Reads:** not audited. Part 1 reads no company data. Blueprint p28's "every action in the platform audit log" is read as every change.
- **The company's own `audit_log`:** gets nothing in api mode, so Owners no longer see ceiling changes there.
  - This departs from docs/api-contract.md ("written to the company's audit log as Platform admin") and the product spec's "Changed company access" entry. Writing a company database from a platform route is a tenancy change (owner question 4).
  - The demo keeps its "Changed company access" entry.

## Ledger postings

None. Platform access is not a company's money. Billing in parts 2 to 4 is the platform's own revenue, not an entry in a company's ledger, so CLAUDE.md rule 10 does not apply.

## Feature switch

`admin.access` (both products, Platform module). When it is off:
- /admin and every page below it are not found;
- every /platform route answers 404;
- the "Platform admin (you)" sign-in card is hidden (demo).

Part 1 adds no feature key.

## Screens

### Api mode

- **Layout.** /admin asks `GET /platform/me`:
  - signed out, or MFA still to set up: to /login;
  - not a platform admin: to /;
  - `admin.access` off: not found;
  - anything else (an unknown role, a 5xx, a network failure, an unreadable answer): to /. The API's guard decides again on every request.
- **Companies (/admin).** The columns are:
  - Company and Location;
  - Status, including Cancelled;
  - Phase, Plan and Products;
  - Modules;
  - User limit, which reads "No limit" when null;
  - Members (people who can sign in).

  A row opens the company's access page.
- **Company access (/admin/companies/:id):**
  - **Modules and limits:** the modules come from the company's products. The Platform switch is disabled, and Installation stays hidden by rule 18.
  - **No plan:** the limit inputs are disabled, with "With no plan there is no limit." (part 3; it said "On a trial with no plan" before). A company with a plan never reads this hint, also on the support role's read-only page.
  - **Branch limit:** it reads "Stored, not enforced yet."
  - **Account facts:** status and since when, phase, members ("People who can sign in, not seats in use."), and the database state and schema. With a failed migration it shows "Error code {code}" or "No error code recorded", then "The error text stays in the control database: it can hold the company's data." (part 3).
  - **Permission ceiling:** one matrix over every offered, visible module of the company's products. As built: the Flooring Suite's modules already include HR's, so a matrix per product would repeat modules. The preview lists pages for each product.
  - **Effective access preview (rule 24):** it works on the draft and the default roles.
  - **Roles, read only:** the default roles.
  - **Users:** "The company's users and custom roles need support access, which isn't available yet."
  - **Save access** (owner role only; the support role's page is read only, part 3):
    - The shared `accessPatchProblem` runs first (part 3). A refusal shows as a toast and asks for no code.
    - Then the step-up dialog.
    - Then the page sends only the changed parts, with modules and keys limited to the offered, visible ones.
    - The toast reads "Access saved for {name}. It applies at once." Then the page reads the company again.
    - A refusal shows the API's message.
- **Protected keys** (part 3): a ticked protected key can't be unticked ("Every company keeps this permission"); an unticked one can be ticked.
- **Tabs:** Access and Support (part 3). In api mode the Data import and Connect a database pages are not found, not merely hidden; import is a later item in the queue.

### Demo mode

Behaviour is unchanged, with one exception: the store now checks the same rules (`accessPatchProblem`, through `updatePlatformCompanyAccess`). This closes the edge case "`updateCompanyAccess` has no check in the store". The demo directory still lists the fixture's roles and users, and the demo still writes "Changed company access" to the company's log; from part 3 only when the save changes something, and also as a row of the console's own audit log.

As built:
- **No step-up in the demo.** Save applies at once, as before, so the demo admin spec's save flow does not change. That spec gained only one assertion, for the console's date format.
- **A stand-in plan.** Each demo company has one subscription row at price "0.00", so its limits stay editable. Nothing shows it.
- **No life cycle.** Every demo company shows phase "Full use", maintenance off and no database line. "Members" is the number of fixture users.
- **The import and database pages** stay, with their tabs, in demo mode only.

## Edge cases and known limits

- **Seat limit.** It is checked only on invite. Enabling a disabled user does not check it, so someone can get round a lowered limit by disabling and re-enabling a person.
- **Branch limit.** It is stored, not enforced, until Settings → Locations moves to the API (blueprint p24 asks for enforcement).
- **The api-mode company shell.** It reads modules and the ceiling from the demo store until `GET /company` moves to the API. After a change, a button may still look enabled while the API refuses it with 403.
- **Two admins saving at once.** The last save wins. Both saves are in the platform audit log.
- **A broken company database.** A company whose database failed a migration, or that is in maintenance, still shows and saves, because only the control database is used.
- **The session the console runs on.** With no admin host, the console runs on a company host with the home company's session and timeouts. The step-up protects writes; reads are open to that session.
- **The audit IP.** The API has no `trust proxy` setting, so in production the platform audit log records the web proxy's address, as the company audit log already does. Fixing it touches core/auth.
- **Fixed in part 3: a support admin saw the editor.** The console now knows the role from `GET /platform/me`, and the access page is read only for the support role.
- **MFA reset.** A company can't reset a platform admin's MFA (existing, ADR 0034).
- **Members.** The count is of sign-ins, not seats in use.
- **Database errors.** The error text is never shown, only the status, a "has error" flag and, from part 3, the SQLSTATE code of the newest recorded failure.
- **Support grants.** A grant still opens nothing, in part 3 too.
- **Products.** They are read-only.
- **Limits with no plan.** A company with no subscription row that is not deleted has none, and none can be set without a row, which waits for the owner.

## Acceptance criteria (part 1)

**Access**
1. Without a session, every /platform route answers 401.
2. Every /platform route answers 403 `forbidden`, whatever the body, for a signed-in person who:
   - has no admin row;
   - has an admin row with `active = false`;
   - has an admin row with `deleted_at` set;
   - has a role other than `owner` or `support`.
3. A platform admin with no factor gets 403 `mfa_enrolment_required`.
4. With `admin.access` off, every /platform route answers 404 and /admin is not found.
5. The `support` role gets 403 on `PATCH …/access` and 201 on `POST /platform/support-grants` after a step-up.
6. A write without a step-up from the last 5 minutes answers 403 `step_up_required`.
7. A metadata test shows that every controller whose path starts with `platform`, in any module, carries `@SessionOnly()` and the platform guard at class level.

**Validation**

8. These answer 400: a `modules` list without `platform`, a foreign module, a hidden module, an unknown key, a foreign key, a ceiling without a protected key, and a limit out of range.
9. A limit on a company with no subscription row answers 422. After it, the company still has no subscription row and every module is still on.

**Effect**

10. Changes apply to Summit at once:
    - a removed key answers 403 on the next request that needs it;
    - a module switched off answers `module_not_enabled`;
    - a lowered user limit refuses the next invitation with `seat_limit`.
11. A module set back to what the plan gives has its override row soft-deleted. If the plan later includes the module, it stays on.
12. On a company with an active row and a cancelled row on a bigger plan, the new user limit is the effective one.

**Audit and reads**

13. Each real change writes one audit row with the actor, IP, user agent, before and after. A save that changes nothing writes no row, and nothing is written to the company's `audit_log`.
14. `GET` and `PATCH` answer for a company whose database failed and for one in maintenance.
15. The list and the detail never contain `last_error` text, and the directory holds no users.
16. An unknown or deleted company answers 404, and a non-UUID id answers 400.

**Web**

17. In api mode, a platform admin:
    - signs in through their home company and enrols an authenticator app;
    - opens /admin and sees Summit;
    - unticks a key, steps up, saves and sees the toast;
    - ticks it back.

    A company user who opens /admin is sent to /. The Data import and Connect a database pages are not found.

    As built, `apps/web/tests/e2e-api/platform-admin.spec.ts` covers sign-in and enrolment, Summit in the list, unticking `retail.sample.view`, a wrong step-up code, the save, the toast and the reload. It then opens the Data import and Connect a database pages, which answer 404 with the not-found page. A second test signs the seeded manager in and checks that /admin redirects to /. The key is put back through the database, not the UI (review A6). The gate's answers also have unit tests (`tests/unit/platform-console.test.ts`).
18. The demo-mode admin and import Playwright specs keep passing; CI's `e2e` check runs them. The import spec was not edited. The admin spec gained one assertion, that the console's "since" date reads "MMM d, yyyy" (review round 1), and was otherwise unchanged.

## Part 3: audit and support

**Built under the same overnight rule** on `feat/platform-audit-support` (PR #36), from main at `bb3e81f`; still a draft until the owner approves it. It is recorded in ADR 0053, which takes a new number because this part also changes the `pnpm db:migrate` rollout in packages/db and how old audit rows are read. Where part 3 departs from part 1's text or from the part 3 outline, it is on the safer side. Each departure is listed in "Safer than the outline (part 3)" and recorded in docs/blueprint-delta.md and ADR 0053. Points the build settled are in "As built (part 3)".

Sources:
- **Blueprint:**
  - p7, role rule 6 (support access);
  - p14 (`platform_audit_log`, `support_access_grants`);
  - p28 ("every action in the platform audit log"; "IP and device");
  - p29 ("logs without … personal data"; support access "logged in both audit logs").
- **STATUS:**
  - the PR #10 sixth security review (migrate.ts);
  - the PR #34 final review notes;
  - the platform admin residual risks;
  - finding 3 of PR #34's security review (the write-role rule belongs in packages/shared).
- **ADRs:** ADR 0034 (support access) and ADR 0052 ("Later parts", part 3).

**Bounds:**
- **No schema change.** No new or altered table, column, index or trigger, and no migration. Part 3 reads and writes `platform_audit_log`, `support_access_grants`, `platform_admins`, `tenants` and `tenant_databases` as they are.
- **No new dependency.**
- **No core change.** No behaviour change in `apps/api/src/core/auth` or `core/tenancy`, and none in provisioning: `migrateCompany` and `provision.ts` are unchanged.
- **Out of scope:** using a support grant to open a company, and all billing.

### Stories (part 3)

6. As a platform admin, I read the platform audit log, newest first, by company and by action. I learn who changed what and when, and I see no company data and no database error text.
7. As a platform admin, I open a company's Support tab, see the support-access requests for it and their status, and ask for one with a reason and a time.
8. As a platform admin with the owner role, I see every admin's support requests. I also see the address and device of every change an admin made.
9. As a platform admin with the support role, I see the access page read only, so I am never asked for a step-up for a change I may not make.
10. As a platform admin, I see in the companies list which company database failed to update, with its error code, and which company is in maintenance.
11. As the business that runs the platform, I know where a company stands after a failed `pnpm db:migrate`: either it is in maintenance mode, or the alert and the command's output say plainly that it isn't. The error text stays out of email, the platform audit log and deploy logs.

### Who may call what (part 3)

| What | Owner role | Support role | Step-up |
| --- | --- | --- | --- |
| Read the platform audit log (`GET /platform/audit`) | Every entry. Platform admins' own entries also carry `network` (IP and user agent) | Every entry, without `network`. Another admin's `support.requested` entry reads "Details hidden" | No |
| List support requests (`GET /platform/support-grants`) | Every admin's | Its own only | No |
| Ask for support access (`POST /platform/support-grants`) | Yes | Yes | Yes (unchanged) |
| Change company access (`PATCH /platform/companies/:id/access`) | Yes (unchanged) | No (unchanged); the page is now read only | Yes (unchanged) |

- **One rule for the API and the web.** It lives in `packages/shared/src/platform/admin-roles.ts`:
  - `PLATFORM_DEFAULT_WRITE_ROLES`, which is `["owner"]`. The guard uses it instead of its own copy, with no behaviour change.
  - `mayChangeCompanyAccess(role)`: true when the role is in that list.
  - `seesAuditNetwork(role)`: true for the owner role.
  - `seesAllSupportGrants(role)`: true for the owner role. This is a separate rule from `mayChangeCompanyAccess`, because changing access and seeing other admins' requests are different powers.
  - `seesSupportReason(viewer, requesterId)`: true when `seesAllSupportGrants(viewer.role)` holds, or when the viewer made the request. A missing requester never counts as the viewer.
- **Other roles:** any role value other than `owner` or `support` counts as no admin (unchanged). It gets 403 before these rules run.
- **Safer than part 1's "Both roles read every /platform page":** the support role doesn't see other admins' support reasons, on either route (owner question 16).
- **Company people are never named or identified in the console.** An Owner's approval or revocation shows as "The company's Owner", with no id, name or address. This follows part 1's restricted directory, which shows no company users.

### Endpoints (part 3)

| Method and path | Who | Step-up | Audit action | Answer |
| --- | --- | --- | --- | --- |
| `GET /platform/audit` | Any platform admin | No | None | `PlatformAuditResult` |
| `GET /platform/support-grants` | Any platform admin. The owner role gets every admin's requests, the support role its own | No | None | `PlatformSupportGrant[]`, newest first, at most 100 |
| `POST /platform/support-grants` (changed) | Any platform admin (unchanged) | Yes (unchanged) | `support.requested` (unchanged) | 201 `{ id }`; 400; 403; 404; 409 `grant_open`; 429 `rate_limited` |

All three are `@SessionOnly()` and carry `PlatformAdminGuard` at class level, so the guard runs in its usual order:
1. 401 without a session;
2. 404 while `admin.access` is off, before the admin row is read;
3. 403 for anyone who is not an active owner or support admin, whatever the query or body;
4. on the POST, the role and the step-up.

The audit route has its own controller (`platform/audit`). The metadata test (every `platform*` controller carries `@SessionOnly()` and the guard) and the isolation test's session-only map cover both new GETs.

### GET /platform/audit

**Query.** The schema is strict. An unknown parameter, or a parameter sent twice (it arrives as a list), answers 400 `invalid_request`. Every 400 below is `invalid_request` with the message shown.

| Parameter | Rule | Message on a bad value |
| --- | --- | --- |
| `companyId` | Optional UUID. There is no existence check, so a deleted company's history still lists and an unknown company gives an empty page | "That company id is not valid." |
| `action` | Optional; one of the six actions below | "Choose an action from the list." |
| `before` | Optional; the `id` of the last entry of the previous page. It must be a UUID that names an existing entry, checked with a separate select | "That page of the audit log does not exist. Start from the newest entries." |
| `limit` | Optional; digits only, 1 to 100; default 50 | "Ask for 1 to 100 entries at a time." |

**Order and paging.**
- **Order:** newest first, by `at desc, id desc`.
- **Next page:** the API reads `limit + 1` rows. When the extra row exists, `nextCursor` is the last returned entry's `id`; otherwise it is null.
- **The cursor is compared in SQL:** `(at, id) < (SELECT at, id FROM platform_audit_log WHERE id = $before)`. So `at` keeps its microseconds, and entries written in the same millisecond page correctly.
- **Filters:** a cursor works with any filter, even one taken under another filter. Paging to the end shows every entry exactly once.

**The six actions.** `PLATFORM_AUDIT_ACTIONS` is built from one record in packages/shared.

| Action | Written by | Actor kind |
| --- | --- | --- |
| `company.access_changed` | `PATCH /platform/companies/:id/access` | `platform_admin` |
| `support.requested` | `POST /platform/support-grants` | `platform_admin` |
| `support.approved` | The company's Owner, `POST /support-grants/:id/approve` | `company_user` |
| `support.revoked` | The company's Owner, `POST /support-grants/:id/revoke` | `company_user` |
| `company.migration_failed` | `pnpm db:migrate` | `system` |
| `company.migration_recovered` | `pnpm db:migrate` | `system` |

The actor kind comes from the action, never from today's `platform_admins` rows. So a company Owner who later becomes a platform admin still shows as "The company's Owner" on an approval.

**PlatformAuditResult:** `{ entries: PlatformAuditView[]; nextCursor: string | null }`.

**PlatformAuditView:**

| Field | Type | Rule |
| --- | --- | --- |
| `id` | UUID | The entry's id, which is also the cursor |
| `at` | ISO moment | `platform_audit_log.at` |
| `action` | string | The stored action when it matches `^[a-z_]{1,40}\.[a-z_]{1,40}$`, else `"unknown"` |
| `company` | `{ id, name }` or null | From `tenants`. Null when the entry has no company or the company row is gone |
| `actor` | `PlatformAuditActor` | See below |
| `targetType` | string | The stored type when it matches `^[a-z_]{1,64}$`, else `"unknown"` |
| `targetId` | UUID or null | The stored id when it is a UUID of any version, else null |
| `details` | `PlatformAuditDetails` | See "Redaction" |
| `network` | `{ ip, userAgent }`, each a string or null | Only for the owner role, and only when the actor is a platform admin. Otherwise the key is absent |

**PlatformAuditActor:**
- `{ kind: "platform_admin", userId, name }`: the admin's name comes from the control `user` table, or reads "Former admin" when that row is gone. A platform-admin action with no `actor_user_id` reads `unknown`.
- `{ kind: "company_user" }`: the company's Owner, with no id and no name.
- `{ kind: "system" }`: the migration runner.
- `{ kind: "unknown" }`: an action this build doesn't know.

**Redaction (deny by default).** `platformAuditDetails(action, before, after)` in `packages/shared/src/platform/audit-details.ts` gives `details`. An entry that doesn't fit its action's shape exactly gives `{ kind: "hidden" }`, which the screen shows as "Details hidden".

| Action | `details` | Shape it must fit |
| --- | --- | --- |
| `company.migration_failed` | `{ kind: "migration_failed", code }` | Every row, whatever its shape. Only `after.code` is read, and `code` is that string when it matches `^[A-Z0-9_]{1,32}$`, else null. `before` and every other field are never read. Rows written before part 3 hold `{ maintenanceMode, error }`, so they read `code: null` and their text is never shown |
| `company.migration_recovered` | `{ kind: "migration_recovered", version }` | `version` is kept only when it is a string matching `^\d{4}_[a-z0-9_]{1,80}$` (a migration tag such as `0006_foreign_key_indexes`); otherwise it is null. Nothing else is read |
| `company.access_changed` | `{ kind: "access_changed", modulesSwitchedOn, modulesSwitchedOff, keysAdded, keysRemoved, userLimit, branchLimit, overrideRows, limitRows }` | The allow-list below; otherwise hidden |
| `support.requested` | `{ kind: "support_requested", reason, expiresAt }` | `before` is null or absent. `after` is exactly `{ reason, expiresAt }`, with `reason` a string of 1 to 500 characters and `expiresAt` an ISO moment (as built: stricter than "a string that parses as a date", which `Date.parse("1")` passes), given back in UTC. Otherwise hidden. Also hidden from the support role when another admin asked |
| `support.approved`, `support.revoked` | `{ kind: "support_decided", decision }`, where `decision` is `"approved"` or `"revoked"` | `before` and `after` are both null; otherwise hidden |
| Any other action | `{ kind: "hidden" }` | |

The `company.access_changed` allow-list:
- **`before`:** an object whose only keys are `userLimit` and `branchLimit`. Each is null or a whole number from 0 to 1,000,000. `{}` fits.
- **`after`:** an object whose only keys are these:
  - **The four lists:** `modulesSwitchedOn`, `modulesSwitchedOff`, `keysAdded` and `keysRemoved`. Each holds at most as many strings as the permission catalog has keys. Each string is at most 100 characters and matches `^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$`. This is a pattern, not the catalog, so a retired key still shows.
  - **`userLimit` and `branchLimit`:** as in `before`.
  - **`overrideRows`:** at most 50 items. Each is exactly `{ module, action: "write", enabled }`, with `enabled` true or false, or exactly `{ module, action: "remove" }`. `module` matches the key pattern.
  - **`limitRows`:** at most 50 items. Each is exactly `{ subscriptionId, userLimitOverride, branchLimitOverride }`, with the id a UUID and each override a limit as above.
- **Anything else** (another key, type or length) hides the whole entry.
- **What it gives:**
  - the four lists as stored, with a missing list as `[]`;
  - `userLimit` and `branchLimit` as `{ from, to }`, only when `after` has the key, else null. `from` comes from `before`, and is null when absent;
  - `overrideRows` and `limitRows` as counts only.

**Narrowed in SQL first.** The text of a migration row, the reason of another admin's request, and a company person's id or name never reach the API's memory:
- **`before`** is null for a `company.migration_failed` row. For the support role it is also null on another admin's `support.requested` row.
- **`after`:**
  - for a `company.migration_failed` row it is rebuilt as `{ code }`, and `code` is kept only when it is a string matching the code pattern;
  - for the support role it is null on another admin's `support.requested` row.
- **`actor_user_id` and the actor's name** are selected only for the two platform-admin actions.
- **`ip` and `user_agent`** are selected only for the owner role, and only for the two platform-admin actions.

The shared rule then checks every row again, as a second layer. Plain PostgreSQL only (CLAUDE.md rule 11).

**Not audited.** Reading the log writes nothing.

### Support requests

#### GET /platform/support-grants
- **Query:** strict. `companyId` is an optional UUID ("That company id is not valid."). An unknown company gives `[]`. An unknown parameter answers 400 `invalid_request`.
- **Rows:**
  - grants that are not deleted;
  - for the support role, only its own (`admin_user_id` is the caller);
  - newest first (`created_at desc, id desc`), at most 100.
- **PlatformSupportGrant:**

  | Field | Type | Rule |
  | --- | --- | --- |
  | `id` | UUID | |
  | `company` | `{ id, name }` | From `tenants` |
  | `admin` | `{ userId, name }` | The admin who asked. The name reads "Former admin" when the user row is gone |
  | `mine` | boolean | True when the caller asked |
  | `reason` | string | As typed: 10 to 500 characters |
  | `requestedAt`, `expiresAt` | ISO moment | |
  | `approvedAt`, `revokedAt` | ISO moment or null | |
  | `status` | `pending`, `approved`, `revoked` or `expired` | Derived, never stored |

- **No approver.** `approved_by` holds a company user's id, so it is never selected, and no approver name is shown.
- **Status.** `supportGrantStatus` in `packages/shared/src/platform/support-grants.ts` uses the same order as the Owner's list in Settings, which now uses it too, with no behaviour change:
  1. `revoked` when `revoked_at` is set;
  2. else `expired` when `expires_at` is at or before now;
  3. else `approved` when `approved_at` is set;
  4. else `pending`.
- **Open** (`isOpenSupportGrant`): not revoked, not deleted, and `expires_at` after now. In other words, pending or approved.

#### POST /platform/support-grants (changed)
**Body.** It is strict, with the same fields as in part 1. An unknown field answers 400 `invalid_request`.

| Field | Rule | Message (400 `invalid_request`) |
| --- | --- | --- |
| `companyId` | UUID | "That company id is not valid." |
| `reason` | Trimmed, 10 to 500 characters | "Give a reason of 10 to 500 characters." |
| `hours` | A whole number from 1 to 72 | "Enter a whole number of hours from 1 to 72." |

The bounds and messages live in packages/shared (`SUPPORT_REASON`, `SUPPORT_HOURS`, `SUPPORT_REASON_MESSAGE`, `SUPPORT_HOURS_MESSAGE` and `supportRequestInputProblem`), so the API, the dialog and the demo say the same thing. They replace the API-only `MAX_SUPPORT_HOURS`.

**The limits** (`SUPPORT_REQUEST_LIMIT`, `supportRequestRefusal`):
- **One open grant per admin and company.** A request while the same admin has a pending or approved, unexpired grant for that company answers 409 `grant_open`, "You already have an open support request for this company." Another admin may still ask for the same company.
- **10 requests per admin in 24 hours.** The count covers every grant the admin asked for, across all companies, created within the last 24 hours. Revoked, expired and deleted grants count too. The 11th answers 429 `rate_limited`, "You can send at most 10 support requests in 24 hours. Try again later."

**What a request does.** Everything runs in one control transaction under READ COMMITTED (the default):
1. **Lock the admin's own row:** `SELECT role FROM platform_admins WHERE user_id = $caller AND active AND deleted_at IS NULL FOR UPDATE`. With no row, or a role other than `owner` or `support`, it answers 403 `forbidden`, "Only platform admins can use this." This re-checks the admin inside the transaction, so an admin who is deactivated or given another role while waiting is refused.
2. **Take `now` after the lock,** so a waiting request sees the insert of the one before it.
3. **Check the company** exists and is not deleted. Otherwise 404 `not_found`, "That company does not exist." (unchanged).
4. **Read the facts.** Read the admin's grants, deleted ones included, that were created in the last 24 hours or that are for this company with `expires_at` after now. From those rows, the shared `isOpenSupportGrant`, `supportWindowStart` and `inSupportWindow` give two facts: whether a grant is open for this company, and how many grants fall in the window.
5. **Refuse** with `supportRequestRefusal`: the open grant first (409), then the window (429).
6. **Insert the grant:** `created_at` is now, `expires_at` is now plus the hours, and `created_by` is the admin.
7. **Write the audit row:** `support.requested` with `{ reason, expiresAt }`, the IP and the user agent (unchanged).

**Refusal order.**
1. The guard: 401, the switch-off 404, 403, then the step-up.
2. 400 for the body.
3. In the transaction: 403, 404, 409, then 429.

A refused request writes nothing and doesn't count toward the window.

**Why a row lock.**
- **The race:** two parallel requests by one admin both pass the guard, because a step-up isn't used up.
- **The lock:** both requests hold the same `platform_admins` row (its unique index is on `user_id`, so there is one row per user). The lock therefore serialises reading the facts and the insert, with no new table, index or advisory key.
- **What it doesn't block:** the guard's plain reads. Deactivating an admin waits only for the request in flight.

### Database errors and maintenance
- **`database.errorCode`** on `PlatformDatabaseStatus`, in the list and the detail: `string | null`.
  - **What it holds:** the SQLSTATE or system error code of the company's newest `company.migration_failed` row (by `at`, then `id`).
  - **When it is set:** only while `tenant_databases.last_error` is set (`hasError`), and only when the code matches `^[A-Z0-9_]{1,32}$`. Otherwise it is null.
  - **How it is read:** a subquery selects only `after->>'code'`. The value is narrowed by type and pattern in SQL, then again in TypeScript.
  - **The error text** is never selected. It shows nowhere in the console, for any role.
- **Columns on the companies list (/admin):**
  - **Database:** the status label. With an error it adds ", error {code}" (for example "Update failed, error 42P01"), or ", no error code recorded". With no database row it reads "No database". As built, a comma rather than " · ", and the code is not monospace (docs/design-brief.md).
  - **Maintenance:** "Off", or the reason's label.
  - **The companies CSV export** keeps working. It holds labels and codes only.
- **The company facts:** with an error, "Error code {code}" or "No error code recorded", then "The error text stays in the control database: it can hold the company's data." No role sees an error text panel.

### pnpm db:migrate when a company fails (packages/db)
This changes only the rollout: `migrateAllCompanies`, which `pnpm db:migrate` runs. Provisioning calls `migrateCompany` alone and is unchanged. Tenancy only reads `tenants.maintenance_mode`.

When a company's migration fails:
1. **One control transaction** writes three things:
   - **`tenant_databases.last_error`:** the driver's message, at most 500 characters. Unless the database is read-only, the status also becomes `failed`. As today, the write is conditional on the status the rollout claimed.
   - **Maintenance mode on,** with reason `migration_failed` when it was off. A reason already set is kept, as today: a move, or manual maintenance with no reason.
   - **One `company.migration_failed` audit row** with `after: { maintenanceMode, code }`. `maintenanceMode` is whether maintenance is on now, and `code` is the SQLSTATE or null. Never the text.
2. **If that transaction fails,** maintenance mode is still turned on, alone, in its own statement, with the same rule for the reason. This writes no audit row (owner question 17). Nothing is left stuck: the next successful run ends the maintenance and writes `company.migration_recovered`, as today.
3. **`onFailure`** gets `{ tenantId, code, recorded, maintenance, readOnly }`. It no longer gets the error text.
   - `recorded`: `last_error` now holds this failure. The transaction committed and the claimed status still held.
   - `maintenance`: the company is in maintenance mode now.
   - `readOnly`: the database is read-only.
4. **The rollout stops** with `MigrationStoppedError`, which keeps the original error as its cause. The message depends on whether the failure was recorded:
   - **Recorded:** "Migration stopped at company {id} (error code {code or none}). The full error is in tenant_databases.last_error."
   - **Not recorded:** "Migration stopped at company {id} (error code {code or none}): {text}. It could not be written to tenant_databases.last_error."

   So a deploy or CI log carries the text only when it is nowhere else.

**The alert email** (`platform-alerts.ts`) says where the company stands. `failureStanding` gives `maintenance`; `serving_reads` when the company is not in maintenance and its database is read-only; and `unavailable` otherwise.

- **Who gets it** (as built, final review): every active, non-deleted platform admin whose role is one of the shared `PLATFORM_ADMIN_ROLES`, the roles the console, the guard and the lock accept. A row with any other role is no admin and gets no email.

| Standing | Subject | First line |
| --- | --- | --- |
| `maintenance` | "Migration failed: {name} is in maintenance mode" (unchanged) | As today: "The company database of {name} failed to migrate, so the company is in maintenance mode." and the line after it |
| `serving_reads` | "Migration failed: {name} is NOT in maintenance mode" | "The company database of {name} failed to migrate and maintenance mode could not be turned on. The database is read-only, so its people may still read a half-updated database. Turn maintenance mode on by hand (tenants.maintenance_mode = true, maintenance_reason = 'migration_failed', so the next successful run ends it)." |
| `unavailable` | "Migration failed: {name} is NOT in maintenance mode" | "The company database of {name} failed to migrate and maintenance mode could not be turned on. The database is marked as not ready, so its people can't open the company until it is fixed. Turn maintenance mode on by hand (tenants.maintenance_mode = true, maintenance_reason = 'migration_failed', so the next successful run ends it)." |

- **The code line:** "Error code: {code or none}." Then, when the failure was recorded, " The full error is in tenant_databases.last_error."; when it was not, " The error text could not be saved; it is only in the output of pnpm db:migrate."
- **What it never says:** the email never names `platform_audit_log` as holding the text.
- **Unchanged:** the last line and the idempotency key.

**The command's line** (`packages/db/scripts/migrate.ts`):
- **In maintenance:** "Company {id} is in maintenance mode; {n} platform admin(s) {emailed, or NOT emailed (EMAIL_PROVIDER is memory)}."
- **Otherwise:** "Company {id} is NOT in maintenance mode{ and its read-only database still serves reads}: turn it on by hand (tenants.maintenance_mode, reason migration_failed); {n} platform admin(s) {…}." The bracketed clause appears only for a read-only database.
- **When the alert itself fails** (as built, review round 1): the line is still printed, ending "0 platform admin(s) NOT emailed (the alert failed).", and the alert's error is logged after it. Both writes failing usually means the control database is unreachable, so the alert fails on its first query too; this line is then the only place that says the company is NOT in maintenance mode. The wording lives in `packages/db/scripts/migrate-report.ts`.

### ApiClient (part 3)
- **`listPlatformAudit(query)`:** sends `GET /platform/audit` with only the fields that are set. A `companyId` or `before` that is not a UUID (a demo slug, for example) is never sent; the answer is then `{ entries: [], nextCursor: null }`.
- **`listPlatformSupportGrants(companyId)`:** gives `[]` for an id that is not a UUID. Otherwise it sends `GET /platform/support-grants?companyId=…`, with the id encoded.
- **`requestSupportAccess({ companyId, reason, hours })`:** sends `POST /platform/support-grants` with only those three fields.
- **DemoStore** implements all three.

### Screens (part 3)

#### Api mode
- **The admin's role.** The /admin layout passes the role from `GET /platform/me` to the console (`PlatformRoleProvider` and `usePlatformRole`). Without a provider the role reads `support`, the least privilege. The API's guard still decides every request.
- **Platform nav.** It sits under the console header: `<nav aria-label="Platform">` with two links.
  - "Companies" goes to /admin, and is current on /admin and /admin/companies/*.
  - "Audit log" goes to /admin/audit.

  It looks like the company tabs and scrolls sideways at 375 px. As built, the exact page's link has `aria-current="page"`; Companies has `aria-current="true"` on a company's pages.
- **Audit log (/admin/audit):**
  - **Title and description:** "Platform audit log". The description reads "Every change made in the console, every support request and every failed database update, newest first. Company data and error text are never shown."
  - **Filters:** Company (every company, plus "All companies") and Action (the six actions, by label). Changing a filter starts again from the newest entries. The filters stack at 375 px.
  - **Columns:** When, Who, Company, What and Details. The owner role also gets "Address and device": the IP and the user agent, truncated, with the full value on hover, or "Not recorded" when absent.
  - **Who:** the admin's name, "The company's Owner", "System (database update)" or "Unknown".
  - **What:** "Changed company access", "Asked for support access", "Support access approved", "Support access revoked", "Database update failed" or "Database updated after a failure". An unknown action shows its name.
  - **Details:**
    - Access: "Switched on: …" and "Switched off: …" with module labels; "Added: …" and "Removed: …" with permission labels, or the key for one this build doesn't know; each limit as "from → to", with "No limit" for null; and "{n} override rows, {m} limit rows written", only when either count is above zero (as built; demo saves write no rows). An access entry with none of these reads "No change recorded".
    - A request: the reason in quotes, and "Ends {date}".
    - A decision: "Approved" or "Revoked".
    - A failed update: "Error code {code}" or "No error code recorded".
    - A recovered update: "Now on schema {version}", or "Schema not recorded" (as built).
    - Anything hidden: "Details hidden".
  - **Company column:** "No company" for an entry without one (as built).
  - **Address and device** (owner role): the address, then the device under it; "No address" or "No device" when one of them is missing (as built).
  - **Empty:** "No platform changes recorded yet.", or "No entries for these filters." with a filter set (as built).
  - **Search** (as built): the table's search box filters the entries already loaded; the filters above it ask the server.
  - **Older entries:** a "Load older entries" button while there is a next page. A failure shows a toast with Try again.
    - As built (review round 2): one older page loads at a time, and the button and Try again share that guard. A new load, or new filters, take the failure toast away. A load still running when the filters change, or the page closes, then shows no toast and changes nothing (final review; `runOlderAuditLoad`). An answer for a cursor that another load already moved past is dropped, and the table shows each entry id once, so a late Try again never adds a page twice (`apps/web/src/features/admin/audit-paging.ts`).
    - When the newest page is read again and now ends at another entry, the older pages are set aside and paging starts again below it, so no entry is skipped (safer option 23).
  - **No "Export CSV"** (see "Safer than the outline (part 3)").
- **Support tab (/admin/companies/:id/support).** The company tabs read Access, Support, then the demo-only Data import and Connect a database.
  - **Heading:** the company name, then "Support access".
  - **Panel:** "Ask this company's Owner for read-only access for a few hours. The Owner approves or revokes it in Settings. Approved access doesn't open the company's data yet." The support role also reads "You see your own requests."
  - **The button:** "Ask for support access". It is disabled while the admin's own request for this company is pending or approved, with the hint "You already have an open support request for this company."
  - **Table:** Requested, By ("{name} (you)" for your own), Reason, Ends and Status. Each status has its own icon and tone: pending, approved, revoked and expired. There is no export. Empty: "No support requests for this company yet." A search box filters the rows loaded (as built).
  - **An unknown company:** "This company does not exist."
- **Ask for support access (dialog):**
  - **Description** (as built): "{name}'s Owner gets the request and approves or revokes it. Approved access is read only and ends after the hours you set."
  - **Fields:** Reason, a text area of 10 to 500 characters with a counter; and Hours, from 1 to 72, default 4.
  - **Hint:** "Don't paste the company's data here: the reason is kept in the platform audit log."
  - **Checked before sending** with `supportRequestInputProblem`. The field in error is marked invalid and gets focus.
  - **Continue** closes the form and opens the step-up dialog ("Asking {name} for support access"). Then the request is sent.
  - **Success:** "Support access requested. {name}'s Owner approves it in Settings." Then the list is read again.
  - **A 409 or 429** shows the API's message. As built, the dialog then closes and the list is read again, because another tab or session asked meanwhile. Any other failure brings the form back with the typed text kept.
- **Companies list:** the Database and Maintenance columns ("Database errors and maintenance").
- **Company access (/admin/companies/:id) for the support role:** read only.
  - **A note** (`role="note"`): "Read only: only the platform owner role can change a company's access." As built, it sits under the company tabs, because it applies to the Access tab only.
  - **No step-up:** no "Save access" button and no step-up dialog.
  - **Everything disabled:** module switches, limit inputs and every ceiling box.
  - **The boxes' reason:** each ceiling box gives "Only the platform owner role can change this" in its accessible name, with no tooltip tab stop.
  - **The limit hint** is the one the company would show to the owner role; a planned company never reads the no-plan hint.
- **Company access for the owner role, fixes from the PR #34 review:**
  - **Checked before the step-up:** the save runs the shared `accessPatchProblem` first. A refusal shows its message as a toast and asks for no code.
  - **Protected keys:** a ticked protected key can't be unticked; its box reads "Every company keeps this permission". An unticked protected key can be ticked again, so a company whose ceiling lacks one is never trapped.
  - **The disabled limit hint** reads "With no plan there is no limit."
- **The permission matrix** (shared with the company's role editor) gains two locks, `protected` and `read_only`. The role editor never uses them.

#### Demo mode
The same screens run on DemoStore, through the same shared rules:
- **The audit log** keeps its entries in this browser's local storage, under the key `platform-audit`. It records "Changed company access" and "Asked for support access". Stored rows go through the shared redaction again, so a hand-edited row can't show more.
- **Support requests** are kept in local storage too, under `platform-support`, with the same messages and the same open-grant and 24-hour checks. There is no step-up, like the demo's access save.
- **The demo admin** has the owner role. Its entries show "Platform admin", and "Not recorded" for address and device.
- **A save that changes nothing writes nothing:** no company log entry and no platform row. This matches the API.
- **Reset demo** clears both keys.
- **The Owner approves and revokes in the demo's Settings → Users** since part 4 (PR #38). Before it, a demo request stayed pending until it expired.

### Validations and messages (part 3)

| Where | Rule | Answer |
| --- | --- | --- |
| `GET /platform/audit` | `companyId` not a UUID | 400 "That company id is not valid." |
| | `action` not one of the six | 400 "Choose an action from the list." |
| | `before` not a UUID, or no such entry | 400 "That page of the audit log does not exist. Start from the newest entries." |
| | `limit` not 1 to 100, or not digits | 400 "Ask for 1 to 100 entries at a time." |
| | An unknown or repeated parameter | 400 `invalid_request` |
| `GET /platform/support-grants` | `companyId` not a UUID | 400 "That company id is not valid." |
| | An unknown parameter | 400 `invalid_request` |
| `POST /platform/support-grants` | `companyId` not a UUID | 400 "That company id is not valid." |
| | Reason under 10 or over 500 characters after trimming | 400 "Give a reason of 10 to 500 characters." |
| | Hours not a whole number from 1 to 72 | 400 "Enter a whole number of hours from 1 to 72." |
| | Not an admin any more, checked under the lock | 403 `forbidden`, "Only platform admins can use this." |
| | Unknown or deleted company | 404 `not_found`, "That company does not exist." |
| | An open grant for this admin and company | 409 `grant_open`, "You already have an open support request for this company." |
| | 10 requests by this admin in the last 24 hours | 429 `rate_limited`, "You can send at most 10 support requests in 24 hours. Try again later." |
| `PATCH …/access` (wording only) | A limit when the company has no subscription row that is not deleted | 422 `rule_broken`, "This company has no plan, so it has no limits to change." (it no longer says "trial") |

### Audit (part 3)
- **No new action.** The six actions above are the ones that exist.
- **Reads are not audited:** neither the log nor the support list.
- **`support.requested`** is unchanged. A refused request writes nothing.
- **`company.migration_failed`** rows from part 3 on hold `{ maintenanceMode, code }`. Older rows keep their text, and the console never shows it.
- **The demo** writes its own platform rows, as described in "Demo mode".

### Feature switch (part 3)
`admin.access` covers part 3. When it is off:
- /admin/audit and the Support tab are not found;
- the three routes answer 404.

No new key. The switch's screens are already `/admin` and `/admin/*`.

### What part 3 changes in part 1's text
The docs stage rewrote these in part 1's sections above (done):
- **"Who uses it":** "Both roles read every /platform page" is narrowed for the support role, as described in "Who may call what (part 3)".
- **Fields:** `database` gains `errorCode`.
- **Validations:** the 422 text no longer says "trial".
- **Screens:**
  - the hint "On a trial with no plan there is no limit." becomes "With no plan there is no limit.";
  - "Error details are hidden: they can hold the company's data." becomes the code line;
  - Tabs: Access and Support.
- **Endpoints:** `POST /platform/support-grants` gains 409, 429 and the 403 under the lock.
- **Edge cases:**
  - "A support admin sees the editor" is fixed;
  - "Database errors" gains the code.

### Safer than the outline (part 3)
Each is recorded in docs/blueprint-delta.md and ADR 0053.
1. **No migration error text in the console, for any role.** Only the status, the schema, `hasError` and the code.
2. **Every `company.migration_failed` row is narrowed to `{ code }` twice,** in SQL and by the shared allow-list. Old rows, rows with no code and junk codes read `code: null`. The companies' `errorCode` subquery is narrowed the same way.
3. **A per-action allow-list.** Anything else reads "Details hidden". Target ids show only as UUIDs, and target types and action names only when they match their patterns.
4. **Company people are never named or identified.** No Owner id, name or address is selected, and the support list never selects `approved_by`.
5. **The actor kind comes from the action.**
6. **IP and device go to the owner role only,** on platform admins' own rows, and are never selected for the support role.
7. **The support role sees only its own support reasons,** on both routes, through one shared rule (owner question 16).
8. **The limits run under the admin's row lock,** which re-checks the admin. Every row counts toward the window. An approved, unexpired grant also blocks a new request.
9. **One transaction in migrate.ts, with a maintenance-only fallback.** "NOT in maintenance mode" is said wherever it applies.
10. **The alert never gets the text,** and the CLI prints it only when it couldn't be saved.
11. **No CSV export of the platform audit log.** Reasons and user agents are free text, and `toCsv` doesn't neutralise formulas (owner question 19).
12. **The support role sees the access page read only.** The check runs before the step-up, and ticked protected keys are locked.
13. **The write-role rule lives in packages/shared.**
14. **Every list is bounded:** audit pages at most 100 entries, and the support list at most 100 rows.
15. **A no-op save writes nothing in the demo either.**
16. **The e2e removes its test grants** in setup, teardown and global setup (a test-only hard delete), so the limits never block a later run on a shared local database. Its audit row stays.

### As built (part 3)
Settled while building, all in ADR 0053.

**Safer still** (also in docs/blueprint-delta.md):
- **Unreadable values deny.** An expiry that can't be read counts as expired and not open. A creation time that can't be read, or one later than now, counts toward the 24-hour window. A count that isn't a number gives the 429. An empty requester id never counts as the viewer.
- **`support.requested` details need an ISO moment** for `expiresAt` (see "Redaction").
- **A migration row's code** is read only from `after.code`, and only as the object's own property.
- **The support list** passes every row through `seesSupportReason` again after the SQL filter.
- **The web re-checks the error code** against the shared pattern before showing it.
- **The ApiClient never sends an id that is not a UUID,** and rebuilds the POST body from its three fields.
- **The console's role reads `support`** when no role is known.

**Other choices:**
- **One shared mapping:** `platformAuditView` in packages/shared turns a row into a `PlatformAuditView` for both the API and the demo, with `PLATFORM_AUDIT_PAGE` and `PLATFORM_AUDIT_QUERY_MESSAGES` beside it. The company id message is in the API (`apps/api/src/modules/platform/platform-params.ts`), because the web never sends an id that is not a UUID.
- **A deleted company's grants still list** in `GET /platform/support-grants`, like its audit entries; only deleted grants are left out.
- **`turnMaintenanceOn` always updates the tenant row,** keeping an existing reason, so `updated_at` moves even when maintenance was already on.
- **`MigrationStoppedError`** exposes `code` and `recorded` and keeps the original error as `cause`.
- **The fallback's log line** uses the write error's own message, which for a database error can include the failed query's values and so the migration text. That happens only when the failure couldn't be recorded, when the CLI prints the text anyway.
- **The demo cursor** is looked up among all entries, whatever the filters, as the API does.
- **The web's unit tests** compile JSX in `apps/web/vitest.config.ts` (`oxc`), because tsconfig's `jsx: "preserve"` kept vitest from importing `.tsx` files. No dependency was added. They run `tests/unit/**/*.test.{ts,tsx}`, and tsconfig includes `tests/**/*.tsx`, so a test can write JSX.
- **The companies list is wider:** at 1440 px it scrolls sideways inside its table because of the two new columns; the page doesn't.
- **"Approves it in Settings":** the panel and the toast keep the spec's words. When part 3 was built the web had no Owner screen for support access (only the API's `GET /support-grants`, approve and revoke). Part 4 built it (Settings → Users, Support access panel, PR #38), so the words hold while the company is in full use.

### Edge cases and known limits (part 3)
- **Old rows still hold the text** in the control database: any SQL user, backup or dump sees it. Only the console is redacted (owner question 13).
- **`errorCode` is the newest recorded failure's.** `last_error` has no timestamp. Before part 3, a failure's audit row was written in a separate step after `last_error`, so if that step failed, the code shown can belong to an earlier failure. From part 3 on, the two are written together.
- **Only when both the transaction and the fallback fail,** which in practice means the control database is unreachable, does a read-only database keep serving reads on a half-migrated schema. A claimed database stays `migrating`, so it can't be used. The alert, if it can be sent, and the CLI say so; the CLI says so even when the alert fails.
- **A move's maintenance turned off by hand:** a read-only database whose migration failed during a move then serves its half-migrated schema, because the failure kept the move's reason (unchanged from today).
- **The CLI prints the error text when it couldn't be saved,** so in that one case the text can reach a CI or deploy log.
- **No index on `platform_audit_log.at`.** The unfiltered viewer sorts the whole table for each page, which is fine at today's size (owner question 14).
- **The 24-hour window uses the API server's clock.** `created_at` is set from the same `now`, so several instances whose clocks drift shift the window by the drift.
- **The lock relies on READ COMMITTED,** the default everywhere. REPEATABLE READ for this transaction would break the serialisation.
- **A pending request with a typo** blocks that admin for that company until it expires (at most 72 hours), unless the company's Owner revokes it. There is no withdraw route (owner question 20).
- **Admins can type company data into a reason.** The hint discourages it. The requester and the owner role see the reason, and it is not redacted, because an admin wrote it.
- **The console still runs on a company host.** A script injected there can read `/platform/audit` and the grants with the admin's session. That now includes the reasons the admin may see, admin names and, for the owner role, admin addresses and user agents. This is fixed by the admin host (owner question 1).
- **A deleted company's entries still list,** with its name, because the company row is soft-deleted. A removed admin shows as "Former admin".
- **The demo** keeps its audit rows and grants in one browser's local storage. It has no step-up and no support role.
- **The e2e hard-deletes its test grants.** Their `support.requested` rows stay, with a `target_id` that names a deleted grant. This happens on local databases only, since CI's database is fresh.
- **Other CSV exports** (`toCsv`) don't neutralise cells that start with `=`, `+`, `-`, `@` or a tab. That is a STATUS follow-up, not part 3.

### Acceptance criteria (part 3)

**Access**

19. `GET /platform/audit` and `GET /platform/support-grants` answer:
    - 401 without a session;
    - 403 `forbidden` to anyone who is not an active owner or support admin, with or without a query;
    - 404 with `admin.access` off.
20. The metadata test covers the new controller, and the isolation test's session-only map includes both GETs at 403.

**Audit**

21. Paging and filters:
    - the log is newest first;
    - paging with a cursor shows every entry exactly once, including entries in the same millisecond, under any filter and with a cursor taken under another filter;
    - `companyId` and `action` filter, and 51 entries with no `limit` give 50 and a cursor;
    - a bad `companyId`, `action`, `before` (malformed or unknown) or `limit` (0, 101, 1.5, letters), an unknown parameter, or a repeated one, answers 400 with the messages above.
22. Every `company.migration_failed` entry, old or new, shows only `{ code }`. Planted text in any field never appears in any answer, for either role.
23. An unknown action, or a known one whose fields don't fit its allow-list, shows `{ kind: "hidden" }`. A bad target type reads `"unknown"` and a bad target id reads null.
24. The owner role gets `network` on platform admins' entries only, with the user agent sent. The support role never gets `network`.
25. A company Owner's approval shows as `{ kind: "company_user" }`. Neither role's answer holds the Owner's id, name or the planted address.
26. The support role sees another admin's `support.requested` entry with "Details hidden", and its actor and company kept. Its own requests show their reasons. The owner role sees every reason.
27. Reading writes no audit row, and /admin/audit has no "Export CSV".

**Support**

28. The owner role lists every admin's grants, with `mine` set on its own. The support role lists only its own, with or without `companyId`. No answer holds `approvedBy` or `approved_by`, even after an Owner's approval. At most 100 rows come back.
29. Status is derived: pending, approved, revoked or expired, with revoked first, and an expiry equal to now reads expired. A soft-deleted grant is not listed.
30. A second open request by the same admin for the same company answers 409 `grant_open` and writes no grant and no audit row. After a revocation or an expiry it answers 201. Another admin may ask for the same company.
31. An 11th request by one admin within 24 hours, across companies, answers 429 `rate_limited` and writes nothing. Revoked grants count. Another admin is not affected, and the limit clears once the requests are older than 24 hours.
32. Two parallel requests by one admin for one company give one 201 and one 409, with exactly one grant and one audit row. An admin deactivated, or given an unknown role, while waiting on the lock gets 403 and no grant. An unknown company answers 404 before 409 and 429.

**Database**

33. The list and the detail show the newest failure's SQLSTATE in `database.errorCode` only while `last_error` is set. They show null for an old-format or junk code, and never show text.
34. A failed rollout writes `last_error`, maintenance mode and a `{ maintenanceMode, code }` audit row together. When that fails, maintenance mode is still turned on alone, with no audit row and no `last_error`. `onFailure`, the alert and the CLI say whether the company is in maintenance and whether the failure was recorded. When both writes fail, they say "NOT in maintenance mode".
35. A move's maintenance reason survives a failed migration, and a later successful run leaves it in place.
36. The `MigrationStoppedError` message, and so the CLI, holds the error text only when it could not be written to `last_error`. The alert never holds it.

**Web**

37. In api mode, an owner-role admin:
    - asks Summit for support access with a step-up;
    - sees the request pending and the button disabled;
    - finds it in the audit log, with the "Address and device" column and no export.

    Then, as a support-role admin:
    - the column is gone;
    - the request still shows its reason;
    - the access page is read only, with no "Save access" and a disabled ceiling box.
38. In the demo:
    - the Support tab and the audit log record a request and a saved change;
    - a no-op save writes nothing;
    - /admin/audit and the Support tab pass axe and the console check, and have no sideways scroll at 375 px.
39. On the access page:
    - a ticked protected key can't be unticked;
    - an unticked one can be ticked;
    - a refused change is caught before the step-up.

**As built, the criteria are covered by:**
- 19 and 20: `apps/api/test/platform.int.test.ts` (the 401, 403 and 404 loops and the metadata test pick up the new routes; at least 8 routes and 4 controllers) and `apps/api/test/isolation.int.test.ts`.
- 21 to 27: `apps/api/test/platform-audit.int.test.ts` (8 tests; the paging test pages one company at limits 1 to 4, so page boundaries fall between two entries with the same `at` and between two entries 1 µs apart), `packages/shared/test/platform-audit.test.ts` (43) and `apps/web/tests/unit/platform-audit.test.tsx` (24; four of them page the console's older entries with repeated, late and overlapping answers and a moved newest page, and two show that an answer after the filters change shows no toast and adds nothing).
- 28 to 32: `apps/api/test/platform-support.int.test.ts` (10 tests; the race and the re-check wait on `pg_stat_activity` lock waiters) and `packages/shared/test/support-grants.test.ts` (25).
- 33: `apps/api/test/platform-audit.int.test.ts` (the newest failure code while `last_error` is set, never the text), with the labels in `apps/web/tests/unit/platform-audit.test.tsx`. 34 to 36: `packages/db/test/provision-tenant.int.test.ts` (17 tests), `packages/db/test/platform-alerts.test.ts` and `packages/db/test/migrate-report.test.ts` (the CLI line, including a failed alert).
- 37: `apps/web/tests/e2e-api/platform-support.spec.ts`. 38: `apps/web/tests/e2e/admin.spec.ts`, with /admin/audit and the Support tab in `tests/e2e/screens.ts` (axe and console) and the 375 px loop in `tests/e2e/responsive.spec.ts`; the no-op save in `apps/web/tests/unit/demo-platform.test.ts`. 39: `apps/web/tests/unit/platform-audit.test.tsx` (the locks) and `apps/web/tests/unit/platform-console.test.ts` (`saveProblem` before the step-up).

## Part 4: the company side

**Built under the same overnight rule** on `feat/billing-company-standing` (PR #38), from main at `c763938` (parts 1 and 3 merged); still a draft until the owner approves it. It is recorded in ADR 0054 and the top row of docs/blueprint-delta.md. It takes a new number because it adds a session-only route outside /auth and /platform, and a new feature key. Where part 4 departs from the outline or from the specs it builds on, it is on the safer side. Each departure is listed in "Safer than the outline (part 4)". Points the build settles go in "As built (part 4)".

Sources:
- **Blueprint:**
  - p7, role rule 6 (support access, approved by the Owner);
  - p12 (the maintenance banner, a full-page screen since the owner's decision of 2026-11-13);
  - p23 steps 4 and 5 (past due and the Owner's banner) and p24 (plans and limits);
  - p29 (support access; a company that paid and cancels is read only for 90 days) and p40 (suspended).
- **ADRs:** 0030 (tenancy and the session-only routes), 0033 (the life cycle and maintenance), 0034 (support access), 0052 ("Later parts", part 4; "For the owner" 1, 2 and 7) and 0053 ("Deferred": the Owner's panel).
- **STATUS:** the platform admin residual risks, among them "The console says the Owner approves 'in Settings', but the web has no Owner screen for support access until part 4."

**Bounds:**
- **No schema change.** No new or altered table, column, index or trigger, and no migration. Part 4 reads the control tables that TenantDirectory and `PlanLimits` already read, as they are. packages/db gains test-only helpers.
- **No new dependency.** The overlay uses the existing Radix dialog through packages/ui.
- **No change in `apps/api/src/core/auth` or `core/tenancy`,** not even a comment. Part 4 only imports their existing exports:
  - `TENANCY_REFUSALS`;
  - `TenantDirectory`, `isDatabaseUsable`, `isReadOnly` and the `CompanyAccess` type;
  - `SessionOnly` and the `AuthSession` type;
  - `companyMaintenance()` and `companyUnavailable()`, in tests only.

  `git diff --stat origin/main -- apps/api/src/core/auth apps/api/src/core/tenancy` stays empty.
- **Out of scope:**
  - billing writes (ADR 0052, "For the owner" 7);
  - using a support grant (question 2);
  - the admin host (question 1);
  - prices, invoices and payment details.

### Stories (part 4)

12. As anyone in a company that is under maintenance, whose data isn't available, or that is locked, I see one plain full-page screen that says so, with Try again and Sign out, instead of a page of errors.
13. As the company's Owner, I see a banner when a payment is overdue or the account is read only, with the date it becomes read only or locks, and a link to Billing.
14. As the company's Owner, I open Settings → Billing and read my plan, its current period, its standing and the limits. Nothing there can be changed.
15. As the company's Owner, I see the support-access requests in Settings → Users, and I approve one with a step-up or revoke it. I'm told that support can't see my data yet.

### Who may call what (part 4)

| What | The Owner | Any other member | Step-up |
| --- | --- | --- | --- |
| Read the company's standing (`GET /company/standing`) | Yes | Yes, the same answer, a disabled member included | No |
| Read billing (`GET /billing`) | Yes | No: 403 `forbidden`, "Only an Owner can see billing." | No |
| List support requests (`GET /support-grants`, unchanged) | Yes | No: 403 `forbidden`, "Only an Owner can manage support access." | No |
| Approve a request (`POST /support-grants/:id/approve`, unchanged) | Yes, while the company is in full use | No, as above | Yes |
| Revoke a request (`POST /support-grants/:id/revoke`, unchanged) | Yes, while the company is in full use | No, as above | No |

- **"The Owner"** means `access.isOwner`, read from the company database (`AccessService`). It is false for a disabled profile, and a disabled Owner gets PermissionGuard's 403 `forbidden` before any Owner check.
- **Standing has no Owner flag** and no billing words, for two reasons:
  - disabling a person writes only the company database's `user_profiles`, so a disabled former Owner keeps `owner` in the control `member` row;
  - confirming an active Owner needs the company database, which the standing route must not open.
- **Platform admins** get nothing new. Part 4 adds no /platform route.
- **The web follows the API.** The Billing menu item, the page, the banner and the Support access panel show only for the Owner. The API decides again on every request.

### Endpoints (part 4)

| Method and path | Access | Who | Audit | Answer |
| --- | --- | --- | --- | --- |
| `GET /company/standing` | Session-only, behind `StandingMemberGuard` at class level | Any member of the session's company | None | `CompanyStanding`, with `Cache-Control: no-store` |
| `GET /billing` | Company route: TenantGuard and PermissionGuard (`@AnyCompanyMember()`), then the switch and the Owner check | The Owner | None | `CompanyBilling`, with `Cache-Control: no-store` |
| `GET /support-grants` (unchanged) | Company route | The Owner | None | `CompanySupportGrant[]`, newest first, at most 100 |
| `POST /support-grants/:id/approve` (unchanged) | Company route | The Owner, after a step-up | `support.approved` and "Approved support access" | 204 |
| `POST /support-grants/:id/revoke` (unchanged) | Company route | The Owner | `support.revoked` and "Revoked support access" | 204 |

- **Where:** both new routes live in a new module, `apps/api/src/modules/billing`. `CompanyStandingController` owns `company/standing` and `BillingController` owns `billing`.
- **No company id:** neither route takes one. The company is always the verified session's (`AuthSession.companyId`, Better Auth's `activeOrganizationId`). No path, query, body or header id is read.

#### GET /company/standing

**Why session-only.** TenantGuard refuses before any company handler runs:
- 503 `company_maintenance` in maintenance;
- 503 `company_unavailable` with an unusable database;
- 403 `company_suspended` when locked.

So a company route can't answer in the very states the screens need. Answering through TenantGuard would need a new access level or a bypass flag in core/tenancy, which part 4 doesn't make. Instead:
- **The controller** is `@SessionOnly()` at class level and owns one path.
- **`StandingMemberGuard`,** at class level, repeats TenantGuard's membership checks on control rows only. A handler added to the controller later inherits it (deny by default, the reasoning of ADR 0052).
- **No company database:** the guard and the handler never build a TenantContext, never call TenantConnectionService and never open the company database. Lint forbids those imports in the module (see "Lint (part 4)").
- **Nothing else changes:** no global guard or interceptor is added. TenantGuard and PermissionGuard step aside only for routes that aren't company routes, and only this controller adds one.

It is the only session-only route outside /auth and /platform.

**Refusal order.** SessionGuard runs first, unchanged. Then `StandingMemberGuard` runs in TenantGuard's order. Each of its refusals is `{ code, message }` with TenantGuard's own words (`TENANCY_REFUSALS`), so the route reveals nothing TenantGuard wouldn't.

| Step | When | Answer |
| --- | --- | --- |
| 1 | No session | 401 `unauthenticated`, "Sign in to continue."; or 401 `session_expired` with the timeout's message |
| 2 | A session that must enrol MFA (the route doesn't allow enrolment) | 403 `mfa_enrolment_required`, "Set up two-step sign-in to continue." |
| 3 | The session has no open company | 403 `company_required`, "Choose a company to continue." |
| 4 | The open company is unknown or deleted | 403 `company_required`, as above |
| 5 | The person is not a member of it | 403 `not_a_member`, "You are no longer a member of this company. Sign in again." |
| 6 | The host product header (`x-demo-product`) names a product the company lacks | 403 `product_not_enabled`, "Your company does not have this product." A request without the header skips this step, as in TenantGuard |
| 7 | Otherwise | 200 with the state |

Steps 4 and 5 read control rows only (`TenantDirectory.access` and `isMember`).

**The answer.**
- **Shape:** `CompanyStanding = { state }`. `state` is `full`, `read_only`, `locked`, `maintenance` or `unavailable`. There are no other fields.
- **How it is computed:** the shared `companyStandingState` takes TenantDirectory's own facts and predicates (`maintenanceMode`, `isDatabaseUsable`, `isReadOnly` and the phase).
- **Order:** TenantGuard's. Maintenance first, then unavailable, then locked, then read only, then full.

| Company (control rows) | `state` | What TenantGuard does to a company route |
| --- | --- | --- |
| No subscription rows, status trial or active | `full` | Reads and writes pass |
| A live row inside its ladder's full window: a trial before its end; `active` or `past_due` before its end plus 14 days; a cancelled row before its end | `full` | They pass |
| Every counted row past its full window and still inside its read-only window | `read_only` | GET 200; a write gets 403 `company_read_only` |
| `suspended`, never paid, for less than 30 days | `read_only` | As above |
| `suspended` after paying | `read_only` until the counted rows' own ladder locks (the most generous paid row's end plus 44 days) | As above |
| `cancelled` for less than 30 days (never paid) or 90 days (paid), unless a counted row's ladder locks sooner | `read_only` | As above |
| Database status `read_only` | `read_only` | As above |
| Past the binding ladder's read-only window | `locked` | 403 `company_suspended` |
| Maintenance mode on (`move`, `migration_failed` or no reason), whatever else | `maintenance` | 503 `company_maintenance` |
| Database `provisioning`, `migrating` or `failed`, or no database row | `unavailable` | 503 `company_unavailable` |

"Counted rows" are the live (not deleted) subscription rows, or every row when none is live (`countedSubscriptions`, ADR 0033).

**What it reveals.**
- **To every member, the same:** one of five words about the session's own company. The Owner, a manager, a sales member and a disabled member get the same body.
- **Nothing new:** the session learns each word from TenantGuard anyway, on any company route. A GET shows maintenance, unavailable and locked, and a write shows read only.
- **Never:** anything about billing (no reason, date, plan or status word), and the maintenance reason.
- **Non-members** get 403 `not_a_member`. Other companies can't be named.

**No audit and no switch.**
- It is a read, and session-only routes skip the AuditInterceptor.
- It is how the shell shows TenantGuard's own refusals, like `GET /auth/context`, so turning `settings.billing` off doesn't touch it.

#### GET /billing

**Refusal order.**
1. **SessionGuard, unchanged:** 401, or 403 `mfa_enrolment_required`, as above.
2. **TenantGuard, unchanged:**
   - 403 `company_required`, `not_a_member` or `product_not_enabled`;
   - 503 `company_maintenance` in maintenance;
   - 503 `company_unavailable` with an unusable database;
   - 403 `company_suspended` when locked.

   A read-only company is allowed, because this is a GET.
3. **PermissionGuard:** the route is `@AnyCompanyMember()`. A disabled person gets 403 `forbidden`, "Your role does not allow this. Ask an Owner to change your security role."
4. **The switch:** while `settings.billing` is off, everyone gets 404 `{ code: "not_found", message: "Not Found" }` (`requireFeature`), the Owner included. This runs before the Owner check (CLAUDE.md rule 13).
5. **The Owner check:** anyone else gets 403 `{ code: "forbidden", message: "Only an Owner can see billing." }` (`BILLING_OWNER_ONLY_MESSAGE` in packages/shared).
6. **A company deleted since the guard ran:** 403 `company_required`, "Choose a company to continue."

**What it reads.** Control tables only, as they are:
- **`tenants`:** `status` and `status_changed_at` (not deleted).
- **`tenant_databases`:** `status`, through a left join, for the read-only database case.
- **`tenant_subscriptions`:** every row, deleted ones too, with `status`, `interval`, `current_period_start`, `current_period_end`, `price`, `deleted_at` and the plan. `price` is read only to tell a paid row from a trial, as the life-cycle rule does, and it never leaves the API.
- **`plans` and `products`:** the plan name and the product key.
- **The limits,** from `PlanLimits.limitsOf`: each live row's override, else its plan's limit, then the largest across rows.

These are the columns TenantDirectory reads for the phase, so the page and the guards agree (B-12).

**The answer, `CompanyBilling`:**

| Field | Type | Rule |
| --- | --- | --- |
| `status` | `trial`, `active`, `past_due`, `suspended` or `cancelled` | `tenants.status` as stored |
| `phase` | `full`, `read_only` or `locked` | `companyPhase(facts, now)`, the rule TenantDirectory uses. `locked` never reaches the route |
| `subscriptions` | `CompanyBillingSubscription[]` | The live rows, oldest first (`created_at`, then `id`). `[]` for a fresh trial, and when every row is deleted |
| `limits` | `{ userLimit, branchLimit }`, each a number or null | Null means no limit. The branch limit is stored, not enforced |
| `notice` | `OwnerBillingNotice` or null | See "The Owner's notice" |

**`CompanyBillingSubscription`:** `{ planName, product, interval, currentPeriodStart, currentPeriodEnd, standing }`.
- `product` is a `ProductKey`.
- `interval` is `monthly` or `yearly`.
- The period dates are ISO moments.
- `standing` comes from `subscriptionStanding`:

  | Row status | Period end after now | Period end at or before now |
  | --- | --- | --- |
  | `trial` | `trial` | `trial_ended` |
  | `active` | `current` | `overdue` |
  | `past_due` | `past_due` | `overdue` |
  | `cancelled` | `cancelled` | `cancelled` |
  | Anything else, or an end that can't be read | `unknown` | `unknown` |

**Never returned:**
- a price, a subscription id or a plan key;
- `userLimitOverride` or `branchLimitOverride`;
- a user id;
- seats in use, which live in the company database;
- payment details, because there is no payment record (question 7).

The view's row input type has no price, so the code can't leak one.

**The Owner's notice** (`ownerBillingNotice`), from the phase, `phaseDates` and the counted rows:

```ts
type OwnerBillingNotice =
  | { kind: "payment_overdue"; since: string | null; readOnlyFrom: string | null }
  | { kind: "read_only"; reason: ReadOnlyReason; since: string | null; lockedFrom: string | null };
type ReadOnlyReason = "suspended" | "cancelled" | "payment_lapsed" | "trial_ended" | "database" | "account";
```

- **In full use,** the first of these that holds:
  1. The database is read only: `read_only` with reason `database`, both dates null. It explains a refusal happening now.
  2. A counted `active` or `past_due` row has ended, and the company becomes read only within 14 days: `payment_overdue`. `since` is the latest ended paid row's end; `readOnlyFrom` is set.
  3. The company's status is `past_due`, or a counted row is (blueprint p23 step 4; nothing writes `past_due` today): `payment_overdue`. `since` is the latest ended paid row's end, or null; `readOnlyFrom` is set when the company ever becomes read only.
  4. Otherwise null. This includes a company where another row keeps it in full use past the grace.
- **Read only:** `read_only` with `lockedFrom`, and the first reason that holds:
  1. status `suspended`: `suspended`;
  2. status `cancelled`: `cancelled`;
  3. a counted row is `cancelled`: `cancelled`;
  4. every counted row is a trial: `trial_ended`;
  5. a counted row is `active` or `past_due`: `payment_lapsed`;
  6. the database is read only: `database`;
  7. otherwise: `account`.

  `since` is the latest counted `active` or `past_due` row's end for `payment_lapsed`, so a trial that ended later is never named as the plan's period; the latest counted row's end for `trial_ended`, where every counted row is a trial; and null otherwise. In a read-only phase every paid row has ended, so `payment_lapsed` always has one; with none, `since` is null and the copy says the period has ended without a date.
- **Locked:** null. The route is refused before it runs.

**The dates** (`phaseDates` in `packages/shared/src/permissions/lifecycle-dates.ts`):
- **What they are:** `readOnlyFrom` and `lockedFrom` are the first moments at which `companyPhase` gives that phase or a stricter one. Each is null when the company is already there, or never gets there.
- **How they are found:** a binary search on whole milliseconds between now and a horizon. The horizon is the latest of now, the status change and every row's period end, plus the sum of every `LIFECYCLE_DAYS` value plus one day (165 days today).
- **Why it is exact:**
  - after the horizon every ladder is on its last step, so the phase no longer changes;
  - for fixed facts the phase only ever steps down, so a binary search finds the boundary `companyPhase` itself uses;
  - no period length is assumed, so a yearly row is covered;
  - there is no second copy of the ladder.
- **A consequence:** every counted row's ladder ends in `locked`, so `lockedFrom` is set whenever the phase is read only.

**No audit,** and `Cache-Control: no-store`.

#### The support-access routes (unchanged)
The Owner's panel uses the existing routes (docs/specs/settings-users-access.md, "Support access"). Part 4 changes no behaviour there:
- **Messages:** the service takes them from packages/shared (`SUPPORT_OWNER_ONLY_MESSAGE`, `SUPPORT_CLOSED_MESSAGES`), byte for byte.
- **The view type** becomes the shared `CompanySupportGrant`: `{ id, adminName, reason, requestedAt, expiresAt, status }`. `status` comes from the shared `supportGrantStatus`: pending, approved, revoked or expired. There is no approver and no admin id.
- **Approve** needs a pending, unexpired grant of this company and a step-up from the last 5 minutes.
- **Revoke** needs a pending or approved, unexpired grant of this company, and no step-up.
- **TenantGuard applies to all three,** as to every company route:
  - 503 in maintenance or with an unusable database;
  - 403 `company_suspended` when locked;
  - 403 `company_read_only` on approve and revoke while the company is read only. The list still answers then.

### Validations and messages (part 4)

| Where | Rule | Answer |
| --- | --- | --- |
| Both new routes | No session | 401 `unauthenticated`, "Sign in to continue." |
| | MFA still to set up | 403 `mfa_enrolment_required`, "Set up two-step sign-in to continue." |
| | No open company, or it is unknown or deleted | 403 `company_required`, "Choose a company to continue." |
| | Not a member | 403 `not_a_member`, "You are no longer a member of this company. Sign in again." |
| | The host's product isn't the company's | 403 `product_not_enabled`, "Your company does not have this product." |
| `GET /billing` (as on every company route) | Maintenance | 503 `company_maintenance`, "Your company's account is under maintenance. Please try again later; your data is safe." |
| | No usable database | 503 `company_unavailable`, "Your company's data is not available right now. Please try again in a few minutes." |
| | Locked | 403 `company_suspended`, "Your company's account is suspended, so its data cannot be opened. Your data is kept; contact us to restore access." |
| | A disabled person | 403 `forbidden`, "Your role does not allow this. Ask an Owner to change your security role." |
| `GET /billing` | `settings.billing` off | 404 `not_found`, "Not Found" |
| | Not the Owner | 403 `forbidden`, "Only an Owner can see billing." |
| Support routes (unchanged) | Not the Owner | 403 `forbidden`, "Only an Owner can manage support access." |
| | Approve without a step-up from the last 5 minutes | 403 `step_up_required`, "Confirm it's you with a code from your authenticator app, then try again."; or `step_up_mfa_required`, "Set up an authenticator app or a passkey before you can make this change.", for someone with no factor |
| | Approve a grant that isn't pending, has expired, or belongs to another company | 409 `grant_closed`, "This request is no longer waiting for approval." |
| | Revoke a grant that is revoked, has expired, or belongs to another company | 409 `grant_closed`, "This access has already ended." |
| | A grant id that isn't a UUID | 400 `invalid_request`. The web never sends one: it refuses with the 409's words |
| | Approve or revoke while the company is read only | 403 `company_read_only`, "Your company's account is read-only right now, so changes cannot be saved." |
| The web's panel | The company is read only | No actions, and the note "Support access can't be changed while your company's account is read only. Requests end on their own at the time shown." (`SUPPORT_READ_ONLY_MESSAGE`) |
| DemoStore | `settings.billing` off | "This feature is switched off." |

### ApiClient (part 4)
Five methods, in one commented block at the end of `ApiClient` (`apps/web/src/lib/api/contract.ts`), with their own `import type`:

| Method | Sends | Notes |
| --- | --- | --- |
| `getCompanyStanding()` | `GET /company/standing` | The answer goes through `companyStandingFromWire`: an unknown or missing state reads `unavailable`, and extra fields are dropped |
| `getCompanyBilling()` | `GET /billing` | |
| `listSupportGrants()` | `GET /support-grants` | |
| `approveSupportGrant(grantId)` | `POST /support-grants/:id/approve` | An id that isn't a UUID names no grant. Nothing is sent, and it rejects with "This request is no longer waiting for approval." |
| `revokeSupportGrant(grantId)` | `POST /support-grants/:id/revoke` | The same, with "This access has already ended." |

- **The standing watch** (`withStandingWatch`, a Proxy like `withSimulatedNetwork`):
  - **When it signals:** an ApiClient call fails with an `HttpApiError` whose code is `company_maintenance`, `company_unavailable`, `company_suspended` or `company_read_only`. It signals `StandingGate` and rethrows the same error.
  - **Never watched:** `getCompanyStanding`, because it is what a signal triggers, and `getCompanyBilling`, because a billing reader must never trigger one.
  - **Untouched:** synchronous results (`subscribe`, `today`, `setViewer`) come back as they are. The demo's errors are plain `ApiError`s, so they never signal.
- **DemoStore** implements all five (see "Demo mode").
- **The factories** in `api-methods.ts` take `(http)` only.

### Screens (part 4)

#### Api mode

**On a full page load** (`apps/web/src/app/(app)/layout.tsx`):
- **The server asks.** After the session and the platform redirect, the layout asks `GET /company/standing` on the server (`getServerStanding`). It forwards the host's product header, so the server's answer equals the browser's.
- **Blocked** (`maintenance`, `unavailable` or `locked`): the layout renders only the standing screen, with no shell, no menus and no workspace.
- **Otherwise:** the shell renders inside `StandingGate`, which starts from that answer.
- **Bad answers:**
  - a 200 with an unknown state reads `unavailable` (deny by default);
  - a non-200 or a network failure gives no answer. The shell renders, the API's guard still refuses each request, and the client re-checks on the first refusal.

**The standing screens** (`STANDING_SCREENS` in packages/shared). There is one screen per state, the same for every member, the Owner included. It has no maintenance reason, no dates and no billing words (question 21).

| State | Icon | Title | Text (the API's own) |
| --- | --- | --- | --- |
| `maintenance` | Wrench | "Under maintenance" | "Your company's account is under maintenance. Please try again later; your data is safe." |
| `unavailable` | Cloud off | "Not available right now" | "Your company's data is not available right now. Please try again in a few minutes." |
| `locked` | Lock | "Account suspended" | "Your company's account is suspended, so its data cannot be opened. Your data is kept; contact us to restore access." |

- **Buttons:** "Try again" and "Sign out" (outline). They wrap at 375 px.
- **Page mode** (on load): a card centred in `<main id="main">`.
  - The title is the page's h1, and it takes focus.
  - Try again asks the server again, and is disabled while it runs.
- **Look:** warning tokens for maintenance and unavailable, danger tokens for locked. Icons are `aria-hidden`. Tokens only, in both themes, with no sideways scroll at 375 px.

**While a page is open** (`StandingGate`, in `apps/web/src/features/standing/`):
- **The re-check.** A refusal with one of the four standing codes makes `StandingGate` read standing again. At most one read is in flight, plus one trailing. A failed read keeps what was known.
- **Blocked:** an alert dialog covers the whole viewport (`role="alertdialog"`, the packages/ui `Dialog`), with the same title, text and buttons.
  - Escape and a click outside don't close it.
  - It focuses Try again, traps focus, and hides the rest from assistive technology.
  - It stacks above any dialog already open.
  - The command palette closes, and its shortcut pauses.
- **The open page is never remounted.** The overlay is a sibling of the shell, with no wrapper around the page, so typed input, open dialogs and scroll survive. When the overlay closes, focus goes back where it was.
- **Try again** reads standing again:
  - while still blocked, the dialog stays;
  - once the company is usable, the dialog closes. If a page's read failed meanwhile, the page keeps its own error card, with its own Try again.
- **No polling.** Re-checks are event-driven, so a company that leaves maintenance stays behind the overlay until Try again or the next refused request.
- **Not blocking:** `full` and `read_only` show the shell. `not_a_member` and `company_required` keep today's behaviour, a toast or an error card.
- **Motion:** only the dialog's own fade, which the global `prefers-reduced-motion` rule turns off.

**The Owner's banner** (`OwnerBillingBanner`, inside `<main>`, above the View as banner):
- **When it shows:** all of these hold:
  - `settings.billing` is on;
  - the viewer is the Owner (`access.isOwner`, which follows View as);
  - the page is not /settings/billing, where the page shows the same notice;
  - the company isn't blocked;
  - `GET /billing` gives a notice.

  While loading, on any error, or with a null notice, it shows nothing.
- **When it re-reads:** only when standing moves into `full` or `read_only` from another known state. It never reacts to a raw refusal, so it can't loop behind the overlay.
- **Markup:** `<section role="status" aria-label="Account notice">` with an icon, a bold title, the text, and an "Open billing" link to /settings/billing. The `database` reason has no link.
- **Copy** (`billingNoticeText`):
  - dates go through `useFormatDate()`, in the browser's time zone;
  - `{lock}` is " It locks on {lockedFrom}." when `lockedFrom` is set, and nothing otherwise;
  - the copy never promises the account stays read only.

| Notice | Tone | Title | Text |
| --- | --- | --- | --- |
| `payment_overdue` | Warning | "Payment overdue" | "Your plan's period ended on {since}." (with no `since`: "A payment for your plan is overdue."), then " Your company's account becomes read only on {readOnlyFrom} unless it is renewed." when `readOnlyFrom` is set, then " Contact us to renew." |
| `suspended` | Danger | "Account suspended: read only" | "You and your team can view and export, but not make changes.{lock} Contact us to restore access." |
| `cancelled` | Danger | "Account cancelled: read only" | "You and your team can view and export, but not make changes.{lock} Contact us to reopen it." |
| `payment_lapsed` | Danger | "Plan ended: read only" | "Your plan's period ended on {since}, so your company's account is read only." (with no `since`: "Your plan's period has ended, so your company's account is read only."), then {lock}, then " Contact us to renew." |
| `trial_ended` | Danger | "Trial ended: read only" | "Your trial ended on {since}, so your company's account is read only." (with no `since`: "Your trial has ended, so your company's account is read only."), then {lock}, then " Contact us to choose a plan." |
| `database` | Warning | "Read only for now" | "Your company's data is read only while we work on its database. Changes can't be saved yet." No link |
| `account` | Danger | "Read only" | "Your company's account is read only right now, so changes can't be saved. Contact us if this is unexpected." |

**Billing (/settings/billing)**, the Owner's only, read only:
- **The menu item:** in Settings, Company group, after Company profile. Label "Billing", a credit-card icon, and the description "Your plan, its current period and its limits. Read only, for the Owner." It shows on both hosts, because the HR host has the Company group.
- **Who sees it.** Menu items gain an `ownerOnly` flag. One rule, `itemAllows(item, access)`, decides:
  - the settings nav and the settings home;
  - the command palette;
  - the page gate (`canOpenPage`);
  - the access preview.

  An `ownerOnly` item needs `access.isOwner`, and its `anyOf` is empty. A non-Owner who types the address sees "You don't have access to this page." With the switch off, the page shows "This feature is switched off in this demo."
- **Loading:** "Loading billing". When the read is refused with a standing code, the page asks `StandingGate` to re-check, once, because billing reads aren't watched.
- **The notice,** when there is one, comes first, without the "Open billing" link. The shell banner is hidden on this page.
- **Panel "Account":**
  - "Account status": the console's status pill (Active, Trial, Past due, Suspended or Cancelled);
  - "Access": the console's phase pill (Full use, Read-only or Locked).
- **Panel "Plan":** one block per subscription, with:
  - the plan name, in the display font;
  - the product's name;
  - "Billed monthly" or "Billed yearly";
  - "Current period: {start} to {end}";
  - the standing text:

    | Standing | Text |
    | --- | --- |
    | `current` | "Current period ends {end}" |
    | `past_due` | "Payment overdue; period ends {end}" |
    | `overdue` | "Period ended {end}" |
    | `trial` | "Trial ends {end}" |
    | `trial_ended` | "Trial ended {end}" |
    | `cancelled` | "Cancelled" |
    | `unknown` | "Status unknown" |

  With no subscriptions, a trial reads "No plan yet. Your trial includes every module of your products." Any other company reads "No plan."
- **Panel "Limits":**
  - "Users" and "Branches", each a count (`<Num kind="count">`) or "No limit";
  - "Stored, not enforced yet." under a branch number;
  - a "See seats in use" link to /settings/users.
- **Footer:** "This page is read only. To change your plan, renew or pay, contact us. Prices, invoices and payment details aren't shown here yet."
- **No money is shown** anywhere on the page.
- **At 375 px:** stacked panels and a one-column list. Tokens only.

**Support access (Settings → Users)**, the Owner's only:
- **Where:** a panel under the users table on /settings/users, rendered only for the Owner. It sits under that page's switch, `settings.users`.
- **Title:** "Support access".
- **Description:** "Our support team can ask to see your company's data, read only, for a few hours. Nothing opens unless you approve, and you can end an approval early. Approving doesn't open your data yet: support can't see your company's data in this version."
- **While the company is read only** (standing `read_only`):
  - the note "Support access can't be changed while your company's account is read only. Requests end on their own at the time shown." (`role="note"`) above the table;
  - no Approve or Revoke buttons.
- **Table** (`settings-support-access`). It has no CSV export, because reasons are free text.
  - Columns: Requested (date and time), By (the admin's name), Reason, Ends (date and time), Status (the console's pill: Pending, Approved, Revoked or Expired) and Actions.
  - Empty: "No support requests yet."
- **Actions** (`supportActions`):
  - pending: Approve and Revoke;
  - approved: Revoke;
  - revoked and expired: none;
  - read only: none.
- **Approve.** Its accessible name is "Approve support access for {adminName}". It opens the step-up dialog, "Approving support access for {adminName}". After the code:
  - **success:** the toast "Support access approved. It ends {expiresAt, with the time}. Support can't see your data yet.";
  - **a refusal from the approve call** (409, or 403 `company_read_only`): a toast with the API's message. A wrong code still shows inside the step-up dialog;
  - **either way,** the list is read again and the dialog closes.
- **Revoke.** Its accessible name is "Revoke support access for {adminName}". It opens a confirm dialog:
  - title "Revoke support access?";
  - text "{adminName} loses this access at once.";
  - buttons "Keep" (outline) and "Revoke access".

  There is no step-up, because the API asks for none. Success shows "Support access revoked."; a refusal shows a toast with the API's message. Either way, the list is read again and the dialog closes.
- **Focus:** every button and the banner's link show a visible focus ring. Pills pair an icon with a word.

#### Demo mode
- **No life cycle,** as in the demo console. `getCompanyStanding()` always answers `{ state: "full" }`, so the demo never shows the standing screens, the overlay or a banner. Unit markup tests and the api-mode spec cover them.
- **Billing:**
  - the Owner's page shows the company's stand-in plan (`demoSubscription`) with standing `current`, phase `full`, the company's limits and no notice;
  - it takes no clock, so the end of a month in UTC never shows a false "Payment overdue";
  - the store refuses with "This feature is switched off." while the switch is off, and with "Only an Owner can see billing." for anyone else.
- **Support access:**
  - the panel lists the requests the demo console made for this company (local storage `platform-support`), newest first, at most 100, by "Platform admin";
  - approve and revoke use the shared `supportGrantDecisionRefusal` and messages;
  - each decision writes the company's audit entry ("Approved support access" or "Revoked support access", category security) and the console's platform row (`support.approved` or `support.revoked`, shown as "The company's Owner"), as the API does;
  - the step-up dialog still asks for six digits, which the store doesn't check, like the demo console's save;
  - Reset demo clears both keys.
- **The same Owner rule and messages** as the API, so anyone else reads "Only an Owner can manage support access."

### Audit (part 4)
- **No new action.** Approve and revoke keep their two rows:
  - `support.approved` or `support.revoked` in `platform_audit_log`, which the console shows as "The company's Owner";
  - "Approved support access" or "Revoked support access" (category security) in the company's `audit_log`.
- **Reads are not audited:** standing, billing and the support list.
- **The demo** writes the same two entries.

### Feature switch (part 4)
- **New key `settings.billing`:**
  - both products, the Platform module, status `demo`;
  - screens `/settings/billing`;
  - no permission key, because the page is the Owner's only;
  - placed after `settings.audit` and before `admin.access`, in features.ts and docs/FEATURES.md.
- **When it is off:**
  - `GET /billing` answers 404 to everyone;
  - the Billing menu item, its settings-home card and its palette entry are gone, and the page shows "This feature is switched off in this demo.";
  - the Owner's banner is gone;
  - the standing screens and the overlay stay, and `GET /company/standing` keeps answering, because they show the API's own refusals.
- **The support panel** has no key of its own: it sits under `settings.users`. That switch hides the panel only; `/support-grants` has no switch, which is pre-existing, like the users routes.
- **/feature-change:** its step 2 asks the owner to confirm, which can't happen overnight. The impact summary is in the PR body and ADR 0054, and the key is owner question 27.

### Lint (part 4)
In `apps/api/eslint.config.js`, not in core:
- **`src/modules/billing/**`:** no `@workspace/db/company` and no TenantConnectionService ("Billing reads the control database only (ADR 0054).").
- **`src/modules/billing/company-standing.*`:** also no TenantContext ("The standing route never sees a TenantContext (ADR 0054).").
- **The check:** two temporary probe files, expected to give 2 and 3 errors, deleted after.

In `apps/web/eslint.config.mjs` (final review): `src/**` may not import `@workspace/db/testing` or `@workspace/db/seed`, as `apps/api` already refuses `@workspace/db/testing`; `tests/**` may. The `src/**` block repeats the fixture pattern, because flat config replaces a rule's options, and `src/lib/api/demo/**` may load fixtures but not those two. Checked with temporary probes: one under `src/features` gave 3 errors (testing, seed and a fixture), one under `src/lib/api/demo` gave 1 (testing), one under `tests/` gave none. The probes were deleted.

### Safer than the outline (part 4)
Each is recorded in docs/blueprint-delta.md and ADR 0054.
1. **Standing reveals only TenantGuard's view, the same for every member:** five words, nothing about billing, and no Owner flag.
2. **Standing mirrors TenantGuard's refusals, codes, messages and order** in a class-level guard. It opens no company database, nothing changes in core, and an allow-list pins every session-only handler.
3. **One locked, maintenance and unavailable screen for everyone,** with the API's text and no reason or dates (question 21).
4. **No switch on standing.** `settings.billing` governs the page, its menu item and the banner.
5. **`GET /billing` checks the switch before the Owner:** 404 for everyone while it is off.
6. **No prices, ids, overrides or payment details.** The input type can't carry a price.
7. **"Current period ends", never "paid through".**
8. **No banner for anyone but the Owner** (question 24) **and no trial banner** (question 25). The Owner's overdue banner starts on the first overdue day, which is more notice than blueprint p23's "after the grace", with no extra exposure.
9. **Dates come from `companyPhase` itself,** with an exact horizon. There is no second copy of the ladder, and the copy never promises the account won't lock.
10. **Deny by default on the web.** An unknown answer shows "Not available right now". A failed read leaves the decision to the API's guard.
11. **The overlay never remounts the open screen.** It sits above any open dialog, traps focus and gives it back, and the palette pauses.
12. **No request loops.** Only `StandingGate` reacts to refusals, and only by reading standing, which never signals. Billing reads never signal. The banner re-reads only on a standing change.
13. **The support panel adds no power:**
    - approve needs a step-up, because the API does;
    - revoke needs none;
    - there is no CSV of reasons;
    - the copy says support can't see data yet.
14. **No Owner decision while the company is read only (the deviation).**
    - docs/specs/settings-users-access.md says the Owner "revokes at any time".
    - But approve and revoke are writes, and TenantGuard refuses writes with 403 `company_read_only` while the company is read only.
    - So the panel hides both actions then and says why, instead of offering them only to fail (question 26). A locked company opens no screen at all.
15. **No reads are audited,** and both new routes send `Cache-Control: no-store`.
16. **The demo has no life cycle,** and uses the same messages and Owner rule as the API.
17. **The api-mode e2e touches only Summit's maintenance flag and period dates.**
    - It snapshots them, restores them, and checks them equal afterwards.
    - Global setup moves a stale or crashed Summit toward full use only, logs what it changed, and refuses any other company.
    - Every standing helper in `packages/db/src/testing.ts` that names a company (`readStandingFacts`, `setMaintenance`, `setPeriodEnd`, `insertSupportGrant`, `clearTestStanding`) refuses any slug but `summit`, and `restoreStandingFacts` refuses another company's snapshot (final review).
    - The test requester is a user who can't sign in.

### As built (part 4)
Settled while building, all in ADR 0054.

**Safer still** (also in docs/blueprint-delta.md):
- **Unreadable values deny or say less.** `billingNoticeText` reads an unknown reason as the plain "Read only" notice. The date helpers skip a moment that can't be read instead of throwing. "Every counted row is a trial" needs at least one row. `companyBillingView` copies only `userLimit` and `branchLimit`, so no other limit field reaches the answer.
- **DemoStore's `getCompanyBilling`** refuses with "That company does not exist." when the open company can't be found, instead of asserting it exists.
- **The tests check more than the plan asked:** the guard's unit test shows it looks up only the session's company and lets a member through in every state (the handler answers with the state); S-16 also shows that a company route does open one pool, so "no new pool" means something; S-21 also checks that every /platform handler is session-only and that `BillingController` has no class guards.

**Other choices:**
- **The module** is `apps/api/src/modules/billing` (`BillingModule`, registered after `PlatformModule`), not `modules/platform`, which keeps only the platform guard's routes. `GET /billing` uses the existing `requireFeature`.
- **The web's rules** are `overlayState` (the blocking state, or null for the shell; it replaces the outline's `gateView`), `bannerReread` and `createRecheck`, in `apps/web/src/features/standing/standing-rules.ts`. The server's standing read is the pure `serverStandingOf` (`lib/session/server-standing.ts`).
- **`UnavailablePanel` takes an `onSignOut` prop,** so it stays pure and unit-testable; `CompanyUnavailable` (page mode) and `CompanyUnavailableOverlay` pass `signOut`. `BillingView` and `SupportAccessView` are pure in the same way.
- **No effects with refs** (lint): the banner's re-read counter and StandingGate's new server answer after `router.refresh()` are adjusted during render, and the re-check queue is created once with `useState`. The behaviour is the planned one.
- **The palette closes for good** when the company becomes blocked, so an open palette doesn't come back on its own when the overlay closes.
- **The support panel re-reads by bumping a counter,** not with `query.retry()`, which blanks the table to a skeleton and drops focus. A decision can remove the button that opened its dialog, so focus then lands on the "Support access" heading. Approve's error is caught inside the step-up's `onConfirm` and shown as a toast; Revoke has its own confirm dialog.
- **Layout:** the support table's Reason column is `min-w-48 max-w-sm`, so the Actions column fits at 900 px, with the two buttons stacked on a pending row; the standing screen's title is `text-xl sm:text-2xl`, so "Under maintenance" fits at 375 px.
- **Two period texts:** the plan block reads "Current period: {start} to {end}", and its standing reads "Current period ends {end}".
- **Types and messages:** `SUPPORT_CLOSED_MESSAGES` is a typed `Readonly<Record<…>>` with the API's strings; `BlockingStandingState` and `SupportGrantStep` type the screens and the decisions. Two JSDoc lines in `support-grants.service.ts` that said "revokes at any time" now say TenantGuard refuses both decisions while the company is read only.
- **API tests:** shared helpers in `apps/api/test/support/company-facts.ts`, with an `afterEach` reset that also runs when a test fails. B-12 is checked inside the `billing()` helper on every Owner read, not as a test of its own, and B-5 is split into B-5a to B-5h. In B-13 a second, enrolled Owner revokes, because the first had to step up to approve; the read-only case sends no step-up, since TenantGuard refuses first.
- **The api-mode e2e** reaches Audit log through the Settings nav link, and relies on `#main` and on `QueryFallback`'s `role="alert"` card. The seeded Summit is `active` with one active monthly row at price 0, so a period end 3, 20 and 50 days ago gives overdue, read only and locked. The restore helpers bump `updated_at` on Summit's `tenants` row and its subscription row, which is not a standing fact, so the snapshot leaves it out.
- **PR #37:** the part 4 blocks in `contract.ts`, `api-methods.ts` and `store.ts` each have their own import, so #37's edits to the shared import lists merge cleanly. `pageList`'s signature in `products/pages.ts` will conflict on neighbouring lines, as expected.
- **Checked by hand in the demo** (stage 3): /settings/billing and /settings/users at 375 and 1440 px, light and dark, with no sideways scroll at 375 px; approve with a step-up and revoke; the manager's NoAccess page; Harbor's "HR Standard"; ⌘K lists Billing for the Owner; no console warnings. The notices and the maintenance and suspended cards were checked by injecting their markup, because the demo never shows them.

### What part 4 changes in earlier text
Done in the build's docs stage:
- **Parts:** row 4 reads "Built in PR #38 (ADR 0054); acceptance criteria 40 to 63".
- **Part 3, "As built":** the last bullet ("the web has no Owner screen for support access yet") says the panel is built in part 4.
- **Part 3, "Demo mode":** "No Owner approves in the demo" changes: the Owner approves and revokes in the demo's Settings → Users.
- **docs/specs/settings-users-access.md, "Support access":** "or revokes at any time" becomes "or revokes while the company is in full use, in Settings → Users (Support access panel, ADR 0054). While the company is read only, TenantGuard refuses both; requests end on their own."
- **ADR 0030:** `GET /company/standing` joins the session-only routes, behind its own class-level membership guard on control rows.

### Edge cases and known limits (part 4)
- **Guard drift.** `companyStandingState`'s order restates TenantGuard's. Only the integration tests (S-7 to S-14 and S-18) catch drift.
- **Copy drift.** The three screens' texts repeat API strings in packages/shared. S-20 pins them equal.
- **No MFA backstop on standing.** Session-only routes skip PermissionGuard's MFA check for roles that need MFA. The exposure is the five-word state.
- **Disabled members can read standing.** This is exposure-neutral: on any company route, TenantGuard answers them before PermissionGuard's disabled check.
- **The api-mode Owner flag comes from the demo fixture match,** because the shell still reads DemoStore for the workspace. The API decides either way: a mismatch gives a silent 403, so no banner and no panel. This is the existing "the shell reads DemoStore" follow-up.
- **The watch only sees calls through the ApiClient** (CLAUDE.md rule 1). The billing page re-checks for itself.
- **Request patterns:**
  - one standing read per full page load for everyone, plus one `GET /billing` for the Owner;
  - the banner re-reads only on standing changes, and on DemoStore emits, like every api-backed query;
  - refusals coalesce to one standing read in flight and one trailing.
- **A database that control says is `ready` but can't be used.** Standing reads `full`, so there is no overlay, and company routes fail with their own errors and the screens' error cards. As built (S-15), a stored connection string that can't be decrypted gives 500 `internal_error` (logged as "Unknown encrypted value format"), not 503 `company_unavailable`: existing TenantConnectionService behaviour, unchanged here. A 500 isn't a standing code, so there is no loop.
- **Refusals carry no `Cache-Control: no-store`.** Only the 200 answers of both new routes send it. A refusal holds no company data.
- **Read-only support decisions.** The Owner can't end an approval while the company is read only (question 26). Grants open nothing yet.
- **Self-approval.** A person who is both a platform admin and the company's Owner can approve their own request (question 33).
- **Dates use the browser's time zone,** as elsewhere. The demo's period ends at midnight UTC, so in US time zones its end shows as the day before.
- **A local database seeded more than a month ago** shows Summit as overdue, and as locked after 44 days. The api-mode e2e's global setup refreshes it, for e2e only.
- **A killed e2e run** can leave Summit in maintenance (`move`) or lapsed until the next global setup.
- **Audit rows are append-only.** Each api-mode e2e run adds `support.approved` and `support.revoked` rows to `platform_audit_log` and to Summit's `audit_log`.
- **The overlay has no polling** (see "While a page is open").
- **The demo can't show the screens, the overlay or the banner.** The api-mode e2e asserts them (the overlay at 1440 px, the maintenance page at 375 px with no sideways scroll), but nobody has looked at them by eye at 375 and 1440 px in both themes.
- **A member of several companies** gets only Try again and Sign out on a blocked screen. Api mode has no company chooser to send them to (follow-up).

### Acceptance criteria (part 4)

**Standing (API)**

40. `GET /company/standing` answers (S-1 to S-6):
    - 401 without a session;
    - 403 `company_required` with no open company, or a deleted one;
    - 403 `not_a_member` once the membership is removed;
    - 403 `product_not_enabled` with the HR host's header on a Flooring-only company, and 200 with no header;
    - 403 `mfa_enrolment_required` for an Owner without MFA.
41. For every row of the states table, the body is exactly `{ state }` with the expected word, the same for the Owner and a sales member. The isolation probe's company route answers as TenantGuard should (S-7 to S-14):
    - reads and writes pass in full use;
    - a write gets `company_read_only` when read only;
    - `company_suspended` when locked;
    - 503 `company_maintenance` in maintenance, also while locked;
    - 503 `company_unavailable` with a migrating, provisioning or failed database.
42. A company with no database row reads `unavailable`. One whose database row is `ready` with an unreachable URL reads `full`, while the probe fails. Twenty standing calls for a company never opened before open no pool (S-15, S-16).
43. A `companyId` query and an `X-Company-Id` header naming another company change nothing (S-19).
44. Ten standing calls and ten billing reads add no `audit_log` or `platform_audit_log` row (S-17). Both routes send `Cache-Control: no-store`.
45. Other routes are unchanged (S-18):
    - in maintenance, `GET /users` and `GET /support-grants` answer 503 `company_maintenance`;
    - when locked, they answer 403 `company_suspended`;
    - while read only, `POST /support-grants/:id/revoke` answers 403 `company_read_only`.

    The isolation, permissions, users and platform suites pass unchanged.
46. The session-only handlers are exactly `GET /auth/context`, `POST /auth/step-up`, every `/platform*` route and `GET /company/standing`. The standing controller carries `StandingMemberGuard`, and `GET /billing` is a company route (S-21). The three screen texts equal the API's messages (S-20). `git diff --stat origin/main -- apps/api/src/core/auth apps/api/src/core/tenancy` is empty, and the lint probe gives the expected errors.

**Billing (API)**

47. The Owner of a fresh trial gets exactly `{ status: "trial", phase: "full", subscriptions: [], limits: { userLimit: null, branchLimit: null }, notice: null }` (B-2).
48. A plan row shows its plan name, product, interval, ISO period and `standing: "current"`. The limits equal `PlanLimits.limitsOf`: a row's override wins over its plan's limit even when it is smaller, and the largest row wins (B-3).
49. An `active` row that ended 3 days ago gives `standing: "overdue"` and `payment_overdue`, with `since` the end and `readOnlyFrom` the end plus 14 days, to the exact ISO moment. A `past_due` row ending in 10 days gives `standing: "past_due"` and `payment_overdue` with `since: null` (B-4).
50. Each read-only case gives its reason and its exact `lockedFrom` (B-5):
    - a lapsed paid row: `payment_lapsed`, the end plus 44 days;
    - an ended trial: `trial_ended`, the end plus 30 days;
    - suspended after paying, with a row ending in 20 days: `suspended`, the end plus 44 days;
    - cancelled, where the row's ladder binds: `cancelled`, the end plus 44 days;
    - cancelled, where the status's ladder binds: `cancelled`, the change plus 90 days;
    - a read-only database: `database`, with no dates;
    - deleted rows only: `subscriptions: []` and `payment_lapsed`;
    - a counted cancelled paid row: `cancelled`, the end plus 90 days.

    In every billing case, `phase` equals TenantDirectory's (B-12).
51. With a price of `12345.67` planted on the row, the answer doesn't contain it, and no `id`, `planKey`, `price`, `userLimitOverride` or `branchLimitOverride` key appears at any depth (B-6).
52. A sales member and a manager get 403 `forbidden`, "Only an Owner can see billing.". An Owner disabled in the company database gets 403 `forbidden` from PermissionGuard, and 200 again once enabled (B-7, B-8).
53. With `settings.billing` off, the Owner, a manager and a sales member get 404 `not_found`, while standing still answers, in maintenance too (B-9, B-11).
54. Without a session: 401. With no open company: 403 `company_required`. Locked: 403 `company_suspended`. Maintenance: 503 `company_maintenance`. Read only: 200 (B-1, B-10).
55. The support routes behave as before (B-13):
    - the Owner lists the grant;
    - approve without a step-up answers 403 `step_up_required`; with one, 204; a second approve, 409 `grant_closed`, "This request is no longer waiting for approval.";
    - revoke answers 204; a second revoke, 409, "This access has already ended.";
    - a sales member gets 403, "Only an Owner can manage support access.";
    - in a read-only company, the list answers 200, and approve and revoke answer 403 `company_read_only`.

**Shared rules**

56. `companyStandingState` follows TenantGuard's order over all 16 combinations, and an unknown, missing or malformed wire state reads `unavailable`. `phaseDates` gives the exact moment for every case in the dates table: one millisecond before it, the phase is still the earlier one. Over 500 seeded fact sets it agrees with `companyPhase`, the phase never steps up, and it is constant after the horizon. With a paid row that lapsed 20 days ago and a trial that ended 5 days ago, the notice is `payment_lapsed` with `since` the paid row's end and `lockedFrom` the trial's end plus 30 days, the moment `companyPhase` turns `locked`. No notice text contains "until we restore".

**Web**

57. Unit:
    - the watch signals once for each of the four standing codes and rethrows the same error, never for other errors, and never for `getCompanyStanding` or `getCompanyBilling`;
    - three re-checks during one read make exactly two reads;
    - the banner re-reads only on a change into `full` or `read_only`;
    - a server standing answer of 200 with an unknown state reads `unavailable`, and any other status gives no answer.
58. In api mode, the Owner is on /settings/users. Maintenance starts, and a click on Settings → Audit log shows the "Under maintenance" alert dialog, with no Main navigation. Then:
    - over the next 3 seconds there is at most one billing read, and no more standing reads than refused responses;
    - Try again keeps the dialog while in maintenance;
    - after maintenance ends, Try again closes it. The same `#main` element is still connected, the audit page's own error card is still there, focus is not on the body, and the card's Try again loads the log.

    The same flow works for the manager (api e2e test 1 step 6, test 2 step 2).
59. A full page load in maintenance shows the "Under maintenance" screen with no shell, and no sideways scroll at 375 px. A locked company shows "Account suspended" with the API's text, and Sign out goes to /login (test 2 steps 3 and 4).
60. In api mode the Owner reads Billing: "Flooring Pro", "Billed monthly", "Current period ends" and no notice (test 1 steps 1 to 4).
    - With the period ended 3 days ago, the page shows exactly one notice, "Payment overdue" with "becomes read only on", and the plan reads "Period ended". On /settings/users the shell banner says "Payment overdue", and "Open billing" goes to /settings/billing.
    - With the period ended 20 days ago, the banner reads "Plan ended: read only" with "It locks on".
61. The Owner's Support access panel lists a pending request by "Test Support Agent" (test 1 steps 4 and 5).
    - While the company is read only, it shows no Approve or Revoke, and shows the read-only note.
    - In full use, Approve with a step-up code shows Approved. Revoke, then "Revoke access", shows Revoked.
62. A manager sees no Billing in the Settings nav, "You don't have access to this page." on /settings/billing, and no Support access panel, in api mode (test 2 step 1) and in the demo. `canOpenPage` for every other settings page is unchanged for the Owner and the manager (web unit).
63. In the demo:
    - Summit's Owner reads Billing: "Flooring Pro", "Billed monthly", "Current period ends" and a users limit of 16, with no `$` in the page's main area and no account notice. "See seats in use" goes to /settings/users;
    - Harbor's Owner reads "HR Standard" on the HR host;
    - the Owner approves and revokes a request made in the console. The console's Support tab then shows Revoked, and /admin/audit lists "Support access approved" and "Support access revoked" by "The company's Owner";
    - billing stays `notice: null` and `standing: "current"` across the end of a month in UTC;
    - /settings/billing passes axe and the console check, with no sideways scroll at 375 px, on both hosts.

**As built, the criteria are covered by:**
- 40 to 46: `apps/api/test/company-standing.int.test.ts` (21 tests: 40 is S-1 to S-6, 41 is S-7 to S-14, 42 is S-15 and S-16, 43 is S-19, 44 is S-17, 45 is S-18, 46 is S-20 and S-21), the unit `apps/api/test/company-standing-guard.test.ts` (7), the session-only map in `apps/api/test/isolation.int.test.ts`, and the lint probe (2 and 3 `no-restricted-imports` errors, then deleted). The helpers are in `apps/api/test/support/company-facts.ts`.
- 47 to 55: `apps/api/test/billing.int.test.ts` (20 tests: 47 is B-2, 48 is B-3, 49 is B-4, 50 is B-5a to B-5h with B-12 checked in the helper on every Owner read, 51 is B-6, 52 is B-7 and B-8, 53 is B-9 and B-11, 54 is B-1 and B-10, 55 is the two B-13 tests). The isolation, permissions, users, platform and platform-support suites pass unchanged (15, 25, 17, 19 and 10).
- 56: `packages/shared/test/company-standing.test.ts` (8), `lifecycle-dates.test.ts` (35), `company-billing.test.ts` (46) and `support-grants.test.ts` (31); `company-lifecycle.test.ts` passes unchanged (7).
- 57, and the page rule in 62: `apps/web/tests/unit/company-standing.test.tsx` (41).
- 58 to 61, and 62 in api mode: `apps/web/tests/e2e-api/company-standing.spec.ts` (2 tests), with its state helpers in `packages/db/src/testing.ts`, tested by `packages/db/test/standing-test-helpers.int.test.ts` (5, one checking that every helper taking a slug refuses any company but Summit, as `restoreStandingFacts` does for another company's snapshot), and `tests/e2e-api/global-setup.ts`.
- 62 in the demo, and 63: `apps/web/tests/e2e/billing.spec.ts` (3 Flooring tests and 1 `@hr`), `/settings/billing` in `tests/e2e/screens.ts` for both hosts (axe in both themes, the console check, 375 px), and `apps/web/tests/unit/demo-billing-support.test.ts` (7, the end of a month in UTC among them).

## Part 2: plans and company status

**Being built under the same overnight rule** on `feat/platform-manual-billing` (draft PR), from main at `86c1689` (parts 1, 3 and 4 merged); still a draft until the owner approves it. It is recorded in ADR 0056 (written in the docs stage) and a new top row of docs/blueprint-delta.md. It takes a new number because it adds a feature key, `admin.billing` (/feature-change step 3), as part 4 did; ADR 0052 "Later parts" points to it. It is the outline's part 2, reduced: plans as data, and suspend, reinstate and cancel. Where it departs from the outline or from the specs it builds on, it is on the safer side. Each departure is listed in "Safer than the outline (part 2)". Points the build settles go in "As built (part 2)".

Sources:
- **Blueprint:**
  - p13 (the control tables `plans`, `plan_modules`, `plan_limits` and `tenant_subscriptions`);
  - p23 (manual billing, step 5: suspended) and p24 (plans and limits);
  - p28 ("every action in the platform audit log") and p29 (a company that paid and cancels is read only for 90 days).
- **ADRs:** 0033 (the life cycle), 0052 ("Later parts", part 2; "For the owner" 2, 4, 7 and 11), 0053 (the audit viewer; the lock on the admin's own row) and 0054 (standing, the Owner's notice and `phaseDates`).
- **STATUS:** the platform residual risks and follow-ups, among them "Trial with no subscription stays `full`", and the PR #34 final review notes (a plan with no live limits row gives no limit).
- **The part 2 outline** that stood under "Parts 2 to 4".

**Bounds:**
- **No schema change.** No new or altered table, column, index or trigger, and no migration. Part 2 writes `plans`, `plan_modules`, `plan_limits`, `tenants.status`, `tenants.updated_at` and `platform_audit_log` as they are. `tenants.status_changed_at` is stamped by the existing trigger `tenants_status_changed` (control migration 0003). packages/db gains test-only helpers.
- **No new dependency,** and no `package.json` or lockfile change.
- **No change in `apps/api/src/core`** (auth, tenancy, access). `git diff --stat origin/main -- apps/api/src/core packages/db/src/control packages/db/migrations` stays empty. The only change next to the life-cycle rule is an export in packages/shared, `companyEverPaid`, which `companyPhase` then calls, with no behaviour change.
- **Out of scope** (owner decisions; nothing is invented):
  - **Creating or changing a subscription, recording a payment and correcting a period.** An `active` row counts as paid (`wasPaid` in company-lifecycle.ts), so a subscription created before any payment would give a never-paid company the paid ladder: read only for good after a suspension, and 90 days after a cancel instead of 30. A payment would exist only as an audit row and a moved date, with nothing that can't be edited (CLAUDE.md rule 9). These need the owner's answers on `first_paid_at` or a `platform_payments` table, and an approved billing spec (ADR 0052, "For the owner" 7).
  - **Invoices, what a price means, and $0 plans** (question 7).
  - **Using a support grant** (question 2).
  - **The cuts** in "Safer than the outline (part 2)": suspending or cancelling a company that never had a plan, writing the company's own audit log, plans with no price or no limits, applying a plan change to every company on it, and deleting a plan.

### Stories (part 2)

16. As a platform admin, I see every plan with its product, modules, limits, prices and the number of companies on it, so I know what each plan includes.
17. As a platform admin with the owner role, I create a plan, rename it or change its prices, change the modules and limits of a plan no company uses, and retire or restore a plan, each with a reason and a step-up. A plan in use keeps its modules and limits, so no company's access changes behind its back.
18. As a platform admin with the owner role, I suspend, reinstate or cancel a company with a reason and a step-up, after seeing what each action would do: the next status, whether the company becomes read only, and when it locks. Cancel needs the company's name typed exactly, and deletes nothing.
19. As the business that runs the platform, I find every plan and status change in the platform audit log: who, when, from which address and device, and why. The support role sees these entries without other admins' reasons.

### Who may call what (part 2)

| What | Owner role | Support role | Step-up |
| --- | --- | --- | --- |
| List plans (`GET /platform/plans`) | Yes | Yes | No |
| Create, edit, retire or restore a plan | Yes | No: 403 `forbidden`, "Only the platform owner role can change this." | Yes |
| Read a company's status and what each action would do (`GET /platform/companies/:id/status`) | Yes | Yes | No |
| Suspend, reinstate or cancel a company | Yes | No: 403, as above | Yes |
| Read the reason on a plan or status entry in the audit log | Every reason | Only on entries it wrote (an admin moved from the owner role keeps its own); every other reads "Reason hidden" | No |

- **One rule for the API and the web,** in `packages/shared/src/platform/admin-roles.ts`:
  - `mayManageBilling(role)`: true when the role is in `PLATFORM_DEFAULT_WRITE_ROLES` (`["owner"]`). The console uses it to offer plan and status writes; the guard still decides every request. It is a separate name from `mayChangeCompanyAccess`, because it is a different power, though the list is the same today.
  - `seesAdminReason(viewer, authorId)`: true for the owner role, or when the viewer wrote the entry. An empty author never counts as the viewer. `seesSupportReason` delegates to it, with no behaviour change.
- **Company users** get 403 on every route, whatever the body: the guard runs before the body is read.
- **The acting admin is checked again under a lock.** Every plan and status write starts its control transaction with `lockActingAdmin(tx, userId, roles)` (`apps/api/src/modules/platform/admin-lock.ts`). It reads the admin's own `platform_admins` row (`active`, not deleted) `FOR UPDATE`.
  - No row, or a role that is not `owner` or `support`: 403 `forbidden`, "Only platform admins can use this."
  - A role the route doesn't allow: 403 `forbidden`, "Only the platform owner role can change this."
  - So an admin deactivated, deleted or moved to the support role while their write waits on that lock gets 403, and nothing is written. Under READ COMMITTED the locked row is read again after the other transaction commits; the guard's plain reads are not blocked.
  - Part 3's support request uses the same function: its private `lockAdmin` moves there, with no behaviour change.
- **The console is outside the standing gate.** `app/admin/layout.tsx` checks only the platform gate and `admin.access`; `StandingGate` is in `app/(app)/layout.tsx`. So an admin whose home company is suspended, read only or locked still opens the console and can reinstate it. A locked company still signs in.

### Endpoints (part 2)

| Method and path | Who | Step-up | Audit action | Answer |
| --- | --- | --- | --- | --- |
| `GET /platform/plans` | Any platform admin | No | None | 200 `PlatformPlan[]`, retired plans included, with `Cache-Control: no-store` |
| `POST /platform/plans` | Owner role | Yes | `plan.created` | Body `PlatformPlanInput`. 201 `PlatformPlan` |
| `PATCH /platform/plans/:id` | Owner role | Yes | `plan.changed`; none for a save that changes nothing | Body `PlatformPlanPatch`. 200 `PlatformPlan` |
| `POST /platform/plans/:id/retire` | Owner role | Yes | `plan.retired` | Body `{ reason }`. 200 `PlatformPlan` |
| `POST /platform/plans/:id/restore` | Owner role | Yes | `plan.restored` | Body `{ reason }`. 200 `PlatformPlan` |
| `GET /platform/companies/:id/status` | Any platform admin | No | None | 200 `PlatformCompanyStatus`, with `Cache-Control: no-store` |
| `POST /platform/companies/:id/suspend` | Owner role | Yes | `company.suspended` | Body `{ reason, expectedStatus }`. 200 `PlatformCompany`, read again |
| `POST /platform/companies/:id/reinstate` | Owner role | Yes | `company.reinstated` | Body `{ reason, expectedStatus }`. 200 `PlatformCompany`, read again |
| `POST /platform/companies/:id/cancel` | Owner role | Yes | `company.cancelled` | Body `{ reason, expectedStatus, confirmName }`. 200 `PlatformCompany`, read again |

- **Controllers.** `PlatformPlansController` owns `platform/plans`. `PlatformCompanyStatusController` is a second controller on part 1's `platform/companies` prefix; its paths don't clash with `:id`, `:id/access` or `:id/directory`. Both are `@SessionOnly()` and carry `PlatformAdminGuard` and `@PlatformFeature("admin.billing")` at class level, so a handler added to either later inherits both. They join the existing `PlatformModule`, so there is no new Nest module and `app.module.ts` doesn't change.
- **Ids.** `:id` is a UUID checked with `ParseUUIDPipe`; anything else answers 400 `invalid_request`. A company id selects control rows only, as in part 1 ("How a route names a company").
- **Bodies are strict** (`z.strictObject`): an unknown field answers 400 `invalid_request`. `GET /platform/plans` takes no query; any parameter answers 400.
- **The five action routes** (retire, restore, suspend, reinstate and cancel) answer 200 (`@HttpCode(200)`), not Nest's default 201 for a POST. Only create answers 201.
- **No DELETE.** No route deletes a plan, softly or for good, so a plan in use can never disappear and a key is never freed.
- **Counts.** After part 2, /platform has 17 routes on 6 controllers (8 on 4 before it). The metadata test and the 401, 403 and `admin.access` 404 loops in `platform.int.test.ts`, the session-only map in `isolation.int.test.ts` and S-21 in `company-standing.int.test.ts` cover the new routes. docs/api-contract.md's Tenancy count becomes seventeen.

### The platform guard (part 2): a switch per route

- **`PlatformFeature(key)`** is a decorator in `platform-admin.guard.ts`, which lives under `modules/platform`, not core. It sets the metadata `platform:feature`, which the guard reads with `getAllAndOverride([handler, class])`, so a handler's key wins over its class's.
- **Step 2 of the guard** becomes: `admin.access` is off, **or the route's own key is off**: 404 `not_found` with Nest's default body, still before the admin row is read. A route with no key behaves exactly as before.
- **So with `admin.billing` off,** the nine routes answer 404 to everyone, before the role check and the step-up (CLAUDE.md rule 13), and a non-admin learns only that a switch is off. The switch is read on every request, never once at load, because tests flip it at run time.

The order on the nine routes:
1. SessionGuard: 401 `unauthenticated` (the guard checks again), or 403 `mfa_enrolment_required`.
2. 404 `not_found`, "Not Found", while `admin.access` or `admin.billing` is off.
3. 403 `forbidden`, "Only platform admins can use this."
4. On a write: 403 `forbidden`, "Only the platform owner role can change this." for the support role; then 403 `step_up_required`, or `step_up_mfa_required` for an admin with no factor.
5. 400 `invalid_request`: an `:id` that is not a UUID, or a body of the wrong shape.

Each route's own checks follow, below.

### Plans

#### PlatformPlan

| Field | Meaning |
| --- | --- |
| `id` | The plan's UUID |
| `key` | 2 to 40 lowercase letters, digits and dashes, starting with a letter. Fixed after creation and never reused |
| `name` | 1 to 80 characters, trimmed. Names need not be unique; the key tells two plans apart |
| `product` | `flooring` or `hr`. Fixed after creation |
| `monthlyPrice`, `yearlyPrice` | Decimal strings such as `"0.00"` (CLAUDE.md rule 6). Prices are data, not code (owner, 2026-11-13): nothing is charged from them |
| `modules` | The stored modules in catalog order, with `platform` left out. A hidden module (rule 18) that is stored, such as `installation` on Flooring Pro, is included |
| `maxUsers`, `maxBranches` | Whole numbers, or null when the plan has no live limits row, which means no limit (only possible by SQL). New plans always have one |
| `active` | False once the plan is retired |
| `companies` | How many companies have a subscription row naming the plan, counting deleted rows and deleted companies. Above 0 means the plan is in use |
| `createdAt`, `updatedAt` | ISO moments |

- **No subscription, company id or company name leaves.** `companies` is a count.
- **`PlatformPlanInput`** is `{ key, name, product, monthlyPrice, yearlyPrice, modules, maxUsers, maxBranches, reason }`, every field required.
- **`PlatformPlanPatch`** is `{ name?, monthlyPrice?, yearlyPrice?, modules?, maxUsers?, maxBranches?, reason }`. `reason` is required; every other field is optional, and only the fields sent are checked and changed.

#### The plan rules (`packages/shared/src/platform/plans.ts`)
One copy for the API, the web before the step-up, and the demo.
- **Key:** `^[a-z][a-z0-9-]{1,39}$`, exactly as sent (not trimmed).
- **Name:** trimmed, 1 to 80 characters.
- **Product:** `flooring` or `hr`.
- **Prices:** trimmed, then `^\d{1,11}(\.\d{1,2})?$`: digits with up to two decimals, inside numeric(14,2). No sign, exponent, comma or leading dot, and never a JSON number. Both are typed by the admin: 0.00 only when typed, no default, and no rule that derives the yearly price from the monthly one. Prices are compared with decimal.js, never as floats.
- **Modules:** among the product's visible modules (`offeredModules([product])`). `platform` is accepted and never stored. Duplicates collapse, and the stored order is the catalog's. At least one module besides Platform is needed. A module of the other product, a hidden module and an unknown key are refused.
- **Limits:** whole numbers from 1 to 100,000 (`isAccessLimit`). "Unlimited" can't be created.
- **Reason:** trimmed, 10 to 500 characters (`adminReasonProblem`, the same rule as the support request's, which now aliases it).
- **`planProblem(input)`** checks in this order: key, name, product, monthly price, yearly price, modules, max users, max branches, reason. The first problem answers 400 with its message.
- **`planPatchProblem(plan, patch, inUse)`:** an unknown field 400; each field that is sent, as on create; the reason; then, for a plan in use, a real change of modules (compared as sets of visible modules) or of either limit: 422.
- **`planChanges(plan, patch)`:** only the fields that differ. `"49"` equals `"49.00"`, and the same modules in another order are no change. Null when nothing differs.
- **`planModulesAfter(stored, requested, visible)`:** the requested visible modules plus the stored hidden ones, in catalog order. A hidden module is kept as part 1 keeps hidden overrides.
- **Shapes first.** The API's Zod schemas check shapes only, each with its field's message: a key of at most 40 characters, a name of 200, a product of 10, prices of 20, module keys of 100 and no more modules than the catalog has, a reason of 2,000, and limits that are numbers. Then the shared rule decides.

#### GET /platform/plans
- Every plan that is not soft-deleted, retired ones included, ordered by product key, then name, then key. The list isn't paged: there are a handful of plans.
- One query reads the plans with their product key, their live limits row and the company count; a second reads their live `plan_modules` rows. Unknown module values and `platform` are dropped.
- Prices come back as numeric strings (`"0.00"`).
- `Cache-Control: no-store`. Not audited.
- A fresh seed has `flooring-pro`, `flooring-wholesale` and `hr-standard`, each at `"0.00"` ("zero until the owner sets them"), with the seed's modules and limits. Summit is on Flooring Pro (16 users, 3 branches).

#### POST /platform/plans
In one control transaction:
1. `lockActingAdmin` (403).
2. `planProblem`: 400 with the first problem's message.
3. The product row by key. Missing: 400 "Choose Flooring Suite or HR Suite."
4. A plan with this key, deleted or retired ones included: 409 `conflict`, "A plan with this key already exists. A key can't be reused, even after its plan is retired." A unique violation on `plans_key_uidx` from a parallel create gives the same 409.
5. Insert the `plans` row (prices trimmed), one `plan_modules` row per module (never `platform`) and one `plan_limits` row, each with `created_by` the admin.
6. One `plan.created` audit row (no company, target `plan`).
7. 201 with the plan, read again.

#### PATCH /platform/plans/:id
In one control transaction:
1. `lockActingAdmin` (403).
2. The plan row, not deleted, `FOR UPDATE`. None: 404 `not_found`, "That plan does not exist." This lock conflicts with the `FOR KEY SHARE` lock that a future subscription insert takes through its foreign key, so the in-use check can't race one.
3. Its stored modules (every live row, hidden ones included), its live limits row (which may be absent), and whether it is in use: any subscription row names it, deleted rows included.
4. `planPatchProblem`:
   - `key`, `product` or any other unknown field: 400 "Only a plan's name, prices, modules and limits can change." (the API's strict schema gives the same message);
   - a sent field that breaks its rule: 400 with its message; the reason, likewise;
   - in use, with a real change of modules or limits: 422 `rule_broken`, "This plan is in use, so its modules and limits can't change. Change one company's access on its Access page instead."
5. `planChanges` is null: 200 with the plan, and nothing is written, not even an audit row.
6. Otherwise:
   - update `plans` (name, prices and `updated_at`);
   - upsert each wanted `plan_modules` row with `deleted_at` cleared (`created_by` the admin on insert), soft-delete each removed visible one, and keep each stored hidden one;
   - upsert the `plan_limits` row on `plan_id` with `deleted_at` cleared (`created_by` the admin on insert);
   - one `plan.changed` audit row.
7. 200 with the plan, read again.

Two parallel edits of one plan run one after the other under the plan's lock. The last save wins and both are audited (owner question 46).

#### POST /platform/plans/:id/retire and /restore
In one control transaction: `lockActingAdmin` (403); the plan row `FOR UPDATE` (404); then
- retiring a retired plan: 409 `conflict`, "This plan is already retired.";
- restoring an active plan: 409 `conflict`, "This plan isn't retired.";
- otherwise `active` and `updated_at` change, one `plan.retired` or `plan.restored` row is written, and the answer is 200 with the plan.

Nothing reads `plans.active` for access, so retiring a plan in use changes no company. It marks the plan as not offered for new subscriptions, which the console can't create yet (owner question 44).

#### A plan in use, and what a plan edit reaches
A plan is **in use** when any subscription row names it, a deleted row included. Its modules and limits then stay as they are; its name and prices may change.

| Change | What it reaches |
| --- | --- |
| Name | `plans.name` is read by the Owner's `GET /billing` (`BillingFacts`) and by the console's companies list and detail. The new name shows on the billing page of every company with a row on the plan, deleted rows included, and in the console |
| Prices | Nothing outside the seed reads a plan's prices. No company sees or pays a different amount: each company's price is kept on its own subscription row |
| Modules and limits (only while not in use) | A plan's live `plan_modules` and `plan_limits` rows decide the modules and limits of the companies on it (`access.service.ts`, `PlanLimits`). Only a plan no company has used can change them, so no company's access, limits or ladder changes |
| Retire or restore | Nothing; `plans.active` isn't read for access |

The plan dialog says so for a plan in use: "Renaming shows the new name on the billing page of every company on this plan. Changing a price here doesn't change what any company on this plan pays: each company's price is kept on its own subscription."

**Lock order everywhere:** the admin's own row, then the plan or company row. Nothing locks them the other way, so they can't deadlock.

### Company status

#### GET /platform/companies/:id/status
- **Who:** any platform admin; no step-up; not audited; `Cache-Control: no-store`.
- **404** `not_found`, "That company does not exist.", for an unknown or deleted company.
- **It reads,** without a lock: `select now()` (the database's time), the company's `name`, `status` and `status_changed_at`, and every subscription row (deleted ones included: status, period end, price and `deleted_at`, the columns TenantDirectory reads). Reading writes nothing.
- **The answer, `PlatformCompanyStatus`:**

| Field | Meaning |
| --- | --- |
| `companyId` | The company's id |
| `status` | The stored status text, as it is, even one the console doesn't know. The web sends it back as `expectedStatus` |
| `statusChangedAt` | ISO moment of the last status change |
| `phase` | `full`, `read_only` or `locked`, from `companyPhase` at the database's time |
| `readOnlyFrom`, `lockedFrom` | ISO moments from `phaseDates` at the database's time, or null |
| `actions` | Always three, in the order suspend, reinstate, cancel. Each is `{ action, refusal, next }`: `refusal` is `{ code, message }` (`conflict` or `rule_broken`) or null; `next` is `{ status, phase, readOnlyFrom, lockedFrom }` from `statusAfter`, then `companyPhase` and `phaseDates` on the facts after it, or null when refused |

`companyStatusView` in packages/shared builds it, for the API and the demo.

#### POST /platform/companies/:id/suspend, /reinstate and /cancel

**Bodies** (strict):
- `reason`: trimmed, 10 to 500 characters.
- `expectedStatus`: the `status` the admin saw in the preview, a string of 1 to 40 characters. It is text, not one of the five statuses, so a stored unknown status still reaches the 422 below.
- `confirmName`: cancel only. Trimmed, it must equal the company's name trimmed, case-sensitive. Suspend and reinstate refuse it as an unknown field.

**Refusal order** (each code and message exact):
1. 401 `unauthenticated`; 403 `mfa_enrolment_required` (SessionGuard).
2. 404 `not_found`, "Not Found", while `admin.access` or `admin.billing` is off, before the admin row is read.
3. 403 `forbidden`, "Only platform admins can use this."
4. 403 `forbidden`, "Only the platform owner role can change this." (the support role); 403 `step_up_required` or `step_up_mfa_required`.
5. 400 `invalid_request`:
   - `:id` not a UUID;
   - the body's shape: an unknown field or a wrong type;
   - `expectedStatus` missing, empty, longer than 40 characters or not a string: "Read the company's status again before changing it.";
   - the reason: "Give a reason of 10 to 500 characters."

   These run in the controller (`statusActionBodyProblem`), before the company is read.
6. 403 under the lock on the admin's own row: "Only platform admins can use this." when deactivated or deleted meanwhile, "Only the platform owner role can change this." when moved to the support role.
7. 404 `not_found`, "That company does not exist." (unknown or deleted, read under the lock).
8. Cancel only: 400 `invalid_request`, "Type the company's name exactly to confirm." It needs the locked row's name.
9. 409 `conflict`, "This company's status changed meanwhile. Read it again." (`staleStatusRefusal`).
10. `statusAfter`'s refusals, in its order: 422 `rule_broken` for an unknown status; 409 `conflict` for a transition the table refuses; 422 `rule_broken` for a company that never had a plan; 422 `rule_broken` for a widening.
11. 200 with `PlatformCompany` (part 1's detail), read again after the commit. Its phase comes from `TenantDirectory.access`, so the answer shows exactly what the guards now enforce.

**One control transaction** (READ COMMITTED, the default):
1. `lockActingAdmin` (403).
2. `select now()`: the transaction's start, the moment the trigger will stamp.
3. The company row (`id`, `name`, `status`, `status_changed_at`), not deleted, `FOR UPDATE` (404). Parallel actions on one company run one after the other.
4. Cancel: `confirmNameProblem` with the locked name (400).
5. `staleStatusRefusal(expectedStatus, status, status_changed_at, now)` (409).
6. Every subscription row of the company, deleted ones included.
7. `statusAfter(action, status, { statusChangedAt, subscriptions, now })`. A refusal answers 409 `conflict` or 422 `rule_broken` with its message.
8. `update tenants set status = <next>, updated_at = <now> where id = <id> and status = <current> returning status_changed_at`. No row: the same 409 "changed meanwhile" (defensive; the lock makes it unreachable).
9. One audit row: `company.suspended`, `company.reinstated` or `company.cancelled`, with the company, target `tenant`, `before: { status, statusChangedAt }` and `after: { status, statusChangedAt, reason }`.
10. After the commit: the company's detail, read again.

#### `statusAfter`: the shared rule
`packages/shared/src/platform/company-status.ts`, one copy for the API, the preview and the demo. It reads the stored status as text, `statusChangedAt`, every subscription row (deleted ones included) and `now`, the database's transaction time. Every message is an exported constant (`STATUS_ACTION_MESSAGES`). The first check that applies wins:

1. **An unknown status.** The stored status is not `trial`, `active`, `past_due`, `suspended` or `cancelled` (there is no CHECK on the column): 422 `rule_broken`, "This company's status isn't one the console knows, so it can't be changed here."
2. **The transition.** 409 `conflict` where the table says so:

   | Current | Suspend | Reinstate | Cancel |
   | --- | --- | --- | --- |
   | `trial` | `suspended` | 409 "This company isn't suspended or cancelled, so there is nothing to reinstate." | `cancelled` |
   | `active` | `suspended` | 409, as above | `cancelled` |
   | `past_due` | `suspended` | 409, as above | `cancelled` |
   | `suspended` | 409 "This company is already suspended." | `active` or `trial` (check 5) | `cancelled`, unless check 4 refuses |
   | `cancelled` | 409 "A cancelled company can't be suspended. Reinstate it first if it should be suspended instead." | `active` or `trial` (check 5) | 409 "This company is already cancelled." |

   - Suspending a cancelled company is refused because it would widen: a paid company's 90 days would become read only for good, and an unpaid one's 30 days would start again.
   - The same status twice is always refused, so every action that succeeds really changes the status, and the trigger always stamps `status_changed_at`.
3. **No subscription row ever** (none at all, deleted rows included): 422 `rule_broken`.
   - Suspend and cancel: "This company has never had a plan. Suspending or cancelling it would also switch off every module but Platform, so its people couldn't read or export their data. To limit it now, switch its modules off on its Access page. This waits for the owner's decision."
   - Reinstate: "This company has never had a plan, so the console can't tell what to put back. This waits for the owner's decision."
   - **Why:** the access rule gives a company with no subscription row every product module only while its status is `trial` (`freshTrial` in `access.service.ts`; `planModulesOf` in `access-rules.ts`). For any other status with no rows it gives Platform only. A suspended or cancelled fresh trial would therefore lose every module, and its people couldn't read or export during the read-only days ADR 0033 promises. Changing that rule is a core/access change that widens access (owner question 34). The console can't make a zero-row company suspended or cancelled, so one that is was made by SQL, and SQL undoes it.
   - A company with only deleted rows is not a fresh trial (its modules are already Platform only), so it passes this check.
4. **Never widen** (suspend and cancel only). Take the facts before (`status`, `statusChangedAt`, the rows) and after (the next status, `now`, the same rows). For each target, read only and locked, the moment the company reaches it is `now` when `companyPhase` already gives that phase or a stricter one; otherwise the `phaseReachedAt` moment; or never. If the action would make either moment later: 422 `rule_broken`, "That would give this company more time before it becomes read only or locked than it has now, so nothing was changed."
   - It never fires for suspend or cancel from `trial`, `active` or `past_due`: the status's phase goes from full to stricter, and `companyPhase` keeps the stricter of the status and the rows.
   - It never fires for cancelling a paid suspension: read only for good becomes read only until the earlier of the rows' own lock and the change plus 90 days.
   - It fires for cancelling a never-paid suspension when the status's ladder binds: the cancel would restart the 30 days, or reopen a locked company (owner question 37).
   - It is worked out from `companyPhase` itself, so there is no second copy of the ladder (ADR 0054's rule).
5. **The next status.** Suspend gives `suspended`, cancel gives `cancelled`. Reinstate gives `active` when the company ever paid (`companyEverPaid`: any row, deleted ones included, that is `active` or `past_due`, or `cancelled` with a price above 0), and `trial` otherwise.
   - `past_due` is never written. A company suspended from `past_due` comes back `active`, and its rows say whether a payment is overdue. Its access doesn't change (full either way), but the Owner's "payment overdue" notice goes when its rows are current, because that notice reads the stored `past_due` (owner question 35).
   - With rows present, `active` and `trial` give the same access; the choice changes only the word shown.

The facts after carry `statusChangedAt = now`, what the trigger stamps. The inputs are never changed.

#### Stale status
`staleStatusRefusal(expected, current, statusChangedAt, now)` answers 409 `conflict`, "This company's status changed meanwhile. Read it again.", when:
- `expected` is not the stored status: another admin changed it after this admin read the preview; or
- `now` is earlier than the stored `status_changed_at`: this transaction started before another admin's change committed, so its own stamp would be earlier than the stored one, and it lost the race.

Otherwise null. One copy for the API (under the lock) and the demo. It runs after the 404 and the name check, and before `statusAfter`. The access PATCH has no such check ("the last save wins", question 11); part 2 is stricter.

#### How each result reads
No new reading code: `companyPhase`, part 4's `companyStandingState` and the Owner's notice read the new status as they read any status.

| After | `companyPhase` | Standing (part 4) | The Owner's notice (part 4) | TenantGuard on a company route |
| --- | --- | --- | --- | --- |
| Suspended, ever paid | `read_only` now; `locked` only when its rows' own ladder locks (the last paid row's end plus 44 days) | `read_only` | `read_only`, reason `suspended`, with `lockedFrom` the rows' lock | GET 200; a write gets 403 `company_read_only` |
| Suspended, never paid | `read_only` now; `locked` at the change plus 30 days, or sooner when its rows lock sooner | `read_only`, then `locked` | `read_only`, reason `suspended`, with `lockedFrom`; once locked the route is refused | As above, then 403 `company_suspended`; sign-in and `/auth/context` still work |
| Cancelled, ever paid | `read_only` now; `locked` at the change plus 90 days, or at the rows' lock if sooner | As above | `read_only`, reason `cancelled`, with `lockedFrom` | As above |
| Cancelled, never paid | `read_only` now; `locked` at the change plus 30 days, or sooner | As above | As above | As above |
| Reinstated (`active` or `trial`) | Its rows' phase: `full` while a row is current; `read_only` or `locked` once its plan has lapsed | From the rows | From the rows: `payment_overdue`; `read_only` with `payment_lapsed` or `trial_ended`; or none | As the rows say |

- **Reinstate never extends a period.** Paying ends a lapse, and an admin action ends a suspension. Payments wait for the owner, so a company whose plan has lapsed stays read only or locked after a reinstate.
- **Read only starts the moment the status changes.** The trigger stamps the database's transaction time.

#### What each action changes, and when
- **Exactly** `tenants.status`, `tenants.status_changed_at` (the trigger) and `tenants.updated_at`, plus one `platform_audit_log` row.
- **Nothing else:** no subscription row, module override, ceiling, product, member, session, branding, maintenance flag or `tenant_databases` row, and no company database. No pool is opened.
- **Cancel deletes nothing.** Reinstate undoes it: the status goes back to `active` or `trial` with a new `status_changed_at`, and the subscription rows give the phase.
- **It takes effect** on the company's next request and next job. TenantDirectory reads `tenants` and every subscription row on every request, with no cache; jobs read through it and skip read-only companies. A request already past TenantGuard finishes, as with maintenance (ADR 0033). The web's standing watch reacts to the next refused request and to the next full page load (ADR 0054).
- **Sessions are not revoked.** TenantGuard reads the status on every request, and a locked company still signs in.

#### The company's own audit log
It is not written. It lives in the company's database, which is reachable only through TenantConnectionService with a TenantContext that TenantGuard builds from the verified session's company. Building one from `:id` is what CLAUDE.md rule 2 forbids, and lint bans the company schema, TenantConnectionService, TenantContext and the job tenants in `apps/api/src/modules/platform`. A job would need the same context. So the platform audit log is the record, and the Owner learns of the change from part 4's standing and notice ("Account suspended: read only", "Account cancelled: read only"). Owner question 4 stands, now also for status changes (question 42).

### Validations and messages (part 2)

Every 400 is `invalid_request`, every 404 `not_found`, every 409 `conflict` and every 422 `rule_broken`, with the message shown.

| Where | Rule | Answer |
| --- | --- | --- |
| Any of the nine routes | `admin.access` or `admin.billing` off | 404 "Not Found", before the admin row is read |
| | `:id` not a UUID | 400 |
| | An unknown field in a body, or any query on `GET /platform/plans` | 400 |
| Every write | Not an admin any more, checked under the lock on the admin's row | 403 `forbidden`, "Only platform admins can use this." |
| | Moved to a role the route doesn't allow, checked under the lock | 403 `forbidden`, "Only the platform owner role can change this." |
| | Reason under 10 or over 500 characters after trimming, or not a string | 400 "Give a reason of 10 to 500 characters." |
| Create and edit a plan | Key not 2 to 40 lowercase letters, digits and dashes starting with a letter | 400 "Enter a key of 2 to 40 lowercase letters, digits and dashes that starts with a letter, such as flooring-pro." |
| | Name empty after trimming, or over 80 characters | 400 "Enter a name of 1 to 80 characters." |
| | Product not `flooring` or `hr`, or no such product row | 400 "Choose Flooring Suite or HR Suite." |
| | Monthly price not digits with up to two decimals | 400 "Enter a monthly price such as 49.00: digits with up to two decimals." |
| | Yearly price, likewise | 400 "Enter a yearly price such as 490.00: digits with up to two decimals." |
| | Modules not a list of strings | 400 "Choose the plan's modules." |
| | No module besides Platform | 400 "Choose at least one module besides Platform." |
| | An unknown module key | 400 "{key} is not a module." |
| | A module of the other product, or a hidden one | 400 "The {label} module isn't offered with {product label}." |
| | A limit not a whole number from 1 to 100,000 | 400 "Enter a whole number from 1 to 100,000." |
| Create a plan | The key is taken, by a retired or deleted plan too | 409 "A plan with this key already exists. A key can't be reused, even after its plan is retired." |
| Edit a plan | `key`, `product` or any other unknown field | 400 "Only a plan's name, prices, modules and limits can change." |
| | In use, and the modules or a limit would change | 422 "This plan is in use, so its modules and limits can't change. Change one company's access on its Access page instead." |
| Edit, retire or restore a plan | Unknown or deleted plan | 404 "That plan does not exist." |
| Retire a plan | Already retired | 409 "This plan is already retired." |
| Restore a plan | Not retired | 409 "This plan isn't retired." |
| Status preview and actions | Unknown or deleted company | 404 "That company does not exist." |
| Suspend, reinstate, cancel | `expectedStatus` missing, empty, over 40 characters or not a string | 400 "Read the company's status again before changing it." |
| Cancel | `confirmName` missing, or not the company's name exactly (trimmed, case-sensitive) | 400 "Type the company's name exactly to confirm." |
| Suspend, reinstate, cancel | The status changed since the admin read it, or a later change won the race | 409 "This company's status changed meanwhile. Read it again." |
| | A stored status the console doesn't know | 422 "This company's status isn't one the console knows, so it can't be changed here." |
| Suspend | Already suspended | 409 "This company is already suspended." |
| | Cancelled | 409 "A cancelled company can't be suspended. Reinstate it first if it should be suspended instead." |
| Reinstate | Not suspended or cancelled | 409 "This company isn't suspended or cancelled, so there is nothing to reinstate." |
| Cancel | Already cancelled | 409 "This company is already cancelled." |
| Suspend, cancel | The company never had a subscription row | 422 "This company has never had a plan. Suspending or cancelling it would also switch off every module but Platform, so its people couldn't read or export their data. To limit it now, switch its modules off on its Access page. This waits for the owner's decision." |
| Reinstate | The company never had a subscription row | 422 "This company has never had a plan, so the console can't tell what to put back. This waits for the owner's decision." |
| Suspend, cancel | The action would give more time before read only or locked | 422 "That would give this company more time before it becomes read only or locked than it has now, so nothing was changed." |
| `GET /platform/audit` | `action` not one of the 13, or one of the seven new ones while `admin.billing` is off | 400 "Choose an action from the list." |
| DemoStore, any part 2 method | `admin.billing` off | "This feature is switched off." |

The input checks are shared, one copy for the API, the web before the step-up, and the demo: `planProblem`, `planPatchProblem`, `statusActionBodyProblem`, `confirmNameProblem`, and `statusActionInputProblem` (the body check, then the name check).

### ApiClient (part 2)
Seven methods, in their own commented block after part 4's in `contract.ts`, `http/api-methods.ts` and DemoStore:
- **`listPlatformPlans()`:** `GET /platform/plans`.
- **`createPlatformPlan(input)`:** `POST /platform/plans` with the nine fields, rebuilt.
- **`updatePlatformPlan(planId, patch)`:** `PATCH /platform/plans/:id` with only the fields set, plus `reason`.
- **`retirePlatformPlan(planId, reason)`** and **`restorePlatformPlan(planId, reason)`:** `POST /platform/plans/:id/retire` or `/restore` with `{ reason }`.
- **`getPlatformCompanyStatus(companyId)`:** `GET /platform/companies/:id/status`. Null for an id that is not a UUID (never sent) and for any 404, as `getPlatformCompany` does. The page tells the cases apart (see "Screens").
- **`changePlatformCompanyStatus(companyId, input)`:** `POST /platform/companies/:id/<action>` with `{ reason, expectedStatus }`, plus `confirmName` for cancel only. Answers the company's detail.
- **Ids that are not UUIDs are never sent.** A plan call rejects with "That plan does not exist."; a status action with "That company does not exist."
- **Error codes:** `apiErrorCode(error)` in `lib/api/errors.ts` gives the `code` of an `HttpApiError` or of the demo's `DemoRefusal`, else null. Screens decide on the code, never on the text (PR #36 note). `DemoRefusal` extends `DemoRuleError`, so every existing catch still shows its message.

### Screens (part 2)

#### Api mode
- **Platform nav:** Companies, Plans (`/admin/plans`, only while `admin.billing` is on), Audit log. Plans is current on /admin/plans.
- **Company tabs:** Access, Status (`/admin/companies/:id/status`, only while the switch is on), Support, then the demo-only tabs.
- **Plans (/admin/plans):**
  - The page checks `featureOn("admin.billing")` itself and is not found when it is off: `featureForPath` attributes /admin/plans to `admin.access`, whose `/admin/*` wildcard outranks an exact path, and the admin layout checks only `admin.access`.
  - **Header:** "Plans", with the description "What each plan includes. Prices are data: nothing is charged from here." The owner role gets "New plan".
  - **The support role** reads the note (`role="note"`) "Read only: only the platform owner role can change plans." and gets no actions.
  - **Columns:** Plan (the name, with the key under it in muted text), Product, Modules (labels; a hidden one with "(hidden)"), Users and Branches (`<Num kind="count">`, or "No limit" for null), Monthly and Yearly (`<Num kind="money">`), Companies (`<Num kind="count">`, with an "In use" hint), Status ("Active" or "Retired"). The owner role's row actions: Edit, then Retire or Restore.
  - At 375 px the table scrolls inside its container; the page doesn't.
- **The plan dialog** (create and edit in one form):
  - **Fields:** key (create only; read only on edit), name, product (create only), monthly and yearly price (text inputs with `inputMode="decimal"`; what is typed is sent as typed, with no rounding and no `toFixed`), a switch per visible module of the product (Platform shown on and disabled), the user and branch limits, and the reason.
  - **A plan in use:** the module switches and limit inputs are disabled with "In use by {n} companies: its modules and limits can't change. Change one company's access on its Access page.", and the note on what a rename and a price change reach.
  - **Continue** runs `planProblem` or `planPatchProblem` first. The field in error is marked invalid, described and focused, and no code is asked for.
  - Then the step-up dialog ("Save plan {name}"), the call, the toast "Plan created." or "Plan saved.", and a read again. A refusal shows its message and brings the form back with what was typed.
- **Retire and Restore:** a dialog with the reason, then the step-up. Retiring reads: "Retiring hides nothing and changes no company today: companies on {name} keep it. It marks the plan as not offered for new subscriptions, which the console can't create yet."
- **Company status (/admin/companies/:id/status):**
  - The page checks `featureOn("admin.billing")` first and is not found when it is off.
  - It reads `getPlatformCompany` and `getPlatformCompanyStatus`. No company: "This company does not exist." A company whose status reads null: the error card "The company's status can't be read right now." (a switch mismatch between the web build and the API, or a company deleted meanwhile).
  - **Layout:** Back to companies, the company name, the company tabs, the facts (status, since, phase, with the existing status and phase pills), then a "Status" panel with the three actions in order.
  - **Each action:** its button (Suspend, Reinstate, and Cancel as a destructive button) with the dialog copy under it. A refused action shows its button disabled and the refusal's message in muted text, and never asks for a code.
  - **The support role** sees the panel without buttons, and the note "Read only: only the platform owner role can change a company's status."
  - Under the panel: "Subscriptions, payments and period corrections wait for the owner's billing decisions." For a company that never had a plan, the refusal's text already names its Access page.
- **The status dialog:**
  - **Title:** "Suspend {name}?", "Reinstate {name}?" or "Cancel {name}?".
  - **Body,** from `statusActionText` with the preview's `next`:
    - full: "It is in full use after this.";
    - read only with a lock date: "Read only from now: its people can sign in, read and export, but not change anything. It locks on {date}.";
    - read only with no lock date: "Read only from now: its people can sign in, read and export, but not change anything. It stays read only until it is reinstated.";
    - locked: "Locked from now: its people can sign in but can't open its data.";
    - cancel adds: "Nothing is deleted: its database, people, plans and settings stay. Reinstate puts the status back.";
    - reinstate, when the next phase is not full, adds: "Its plan has ended, so it stays {read only or locked} until a payment is recorded, which the console can't do yet."
  - **Fields:** the reason; for cancel, "Type {name} to confirm".
  - **Continue** runs `statusActionInputProblem` with `expectedStatus` the preview's `status`, then the step-up ("Suspend {name}", and so on), then the call.
  - **Success:** the toast "{name} is suspended.", "{name} is reinstated." or "{name} is cancelled. Nothing was deleted.", then both queries read again. Focus goes to the "Status" heading, because the button may be gone.
  - **A 409 or 422** (`apiErrorCode` is `conflict` or `rule_broken`) shows its message, closes the dialog and reads again: another admin may have acted. Any other failure brings the form back with the text kept.
- **The reason field** is one shared component (`reason-field.tsx`): the text area, the hint "Don't paste the company's data here: the reason is kept in the platform audit log.", a counter and the error. The support request dialog uses it too, with its ids unchanged.
- **Audit log:** the labels "Suspended company", "Reinstated company", "Cancelled company", "Created plan", "Changed plan", "Retired plan" and "Restored plan". Detail lines: "Active → Suspended"; the plan's fields, with prices through `formatNumber(…, "money")`; and "Reason: …", or "Reason hidden" in muted text. While `admin.billing` is off the Action filter doesn't offer the seven.
- **Frontend rules:** existing components and tokens only, in both themes. At 375 px the dialogs are `sm:max-w-md` with a scrolling body, the tables scroll inside their containers, and the nav scrolls sideways. Focus is visible; the Radix dialogs trap and return it. There is no new animation, so `prefers-reduced-motion` holds through the existing components. docs/design-brief.md applies.

#### Demo mode
The same screens run on DemoStore, through the same shared rules and messages, with no step-up, like every demo console write.
- **Every part 2 method** first checks `featureOn("admin.billing")` and otherwise refuses with "This feature is switched off."
- **Plans:**
  - the fixture companies' plans as seeded: Flooring Pro, Flooring Wholesale and HR Standard at "0.00", the fixture's modules (without Platform) and limits, each in use by its fixture companies;
  - created plans and edits are kept in this browser's local storage under `platform-plans`, read defensively (an unreadable entry is dropped);
  - a plan's id in the demo is its key (the HTTP client never sends it);
  - a plan's modules and limits never change a demo company, which holds its own; the fixture plans are each in use, so the API's in-use rule gives the same refusals.
- **Status:**
  - the console's status is kept under `platform-status` (the status and its change time per company);
  - the facts are the company's stand-in subscription row (`demoSubscription`, price "0.00");
  - the companies list and detail show the stored status and the phase `companyPhase` gives; an untouched company keeps the demo's `full`;
  - actions run `statusActionBodyProblem`, the company (404 text), `confirmNameProblem`, `staleStatusRefusal` against the stored status, then `statusAfter`; refusals are `DemoRefusal`s with `conflict` or `rule_broken`.
- **Every write** appends a platform audit row with the API's shapes, shown as "Platform admin" with "Not recorded" for address and device.
- **The demo company's own side doesn't change:** its standing stays `full`, its billing has no notice, and the sign-in list still offers it. The demo has no life cycle (ADR 0054).
- **Every demo company has its stand-in row,** so the "never had a plan" refusal never shows in the demo; a unit test covers it with a constructed fact set.
- **The audit filter** refuses the seven actions while the switch is off, as the API does.
- **Reset demo** clears both new keys.

### Audit (part 2)
Seven new actions, all by a platform admin. `PLATFORM_AUDIT_ACTIONS` lists 13 and `PLATFORM_ADMIN_AUDIT_ACTIONS` 9.

| Action | Target | Company | `before` | `after` | Details |
| --- | --- | --- | --- | --- | --- |
| `company.suspended`, `company.reinstated`, `company.cancelled` | `tenant`, the company id | The company | `{ status, statusChangedAt }` | `{ status, statusChangedAt, reason }` | `{ kind: "status_changed", from, to, reason }` |
| `plan.created` | `plan`, the plan id | None | null | `{ key, name, product, monthlyPrice, yearlyPrice, modules, maxUsers, maxBranches, reason }` | `{ kind: "plan_created", …the same fields, reason }` |
| `plan.changed` | `plan`, the plan id | None | The changed fields' old values | The changed fields' new values and `reason` | `{ kind: "plan_changed", changes: { field, from, to }[], reason }` |
| `plan.retired`, `plan.restored` | `plan`, the plan id | None | `{ active }` | `{ active, reason }` | `{ kind: "plan_active", active, reason }` |

- **Allow-listed exactly:** statuses among the five, ISO moments, keys, names, prices, modules and limits by the plan rules' patterns, and `reason` a string of 1 to 500 characters or null. Anything else reads `{ kind: "hidden" }` ("Details hidden").
- **Reasons** are an admin's free text. For a viewer who is not the owner role, a row of one of the seven actions written by another admin has `after` selected with `reason` set to null in SQL (`jsonb_set` only when `after` is an object; no `?` operator), so the text never reaches the API's memory. `platformAuditView` nulls it again unless `seesAdminReason` holds. The owner role reads every reason. The `support.requested` and migration narrowing is unchanged.
- **Address and device** go to the owner role only, on these rows as on every platform admin's row (part 3).
- **Prices** in details are decimal strings; the console shows them through `formatNumber(…, "money")`.
- **The filter and the switch:** `BILLING_AUDIT_ACTIONS` lists the seven, and `platformAuditActionOn(action)` is false for them while `admin.billing` is off. The web's Action filter, the demo and the API's `action` check all use it, per call. Stored rows of the seven still list and render while the switch is off: they are history (owner question 47).
- **Reads are not audited.** A refusal writes nothing, and a plan save that changes nothing writes no row.
- **The company's own `audit_log` is not written** (see "The company's own audit log").

### Feature switch (part 2)
- **New key `admin.billing`:** "Platform admin: plans and company status", both products, the Platform module, status `demo`, `enabled: true`, screens `/admin/plans` and `/admin/companies/*/status`. It sits right after `admin.access` in `packages/shared/src/features.ts` and docs/FEATURES.md, kept in sync by `features.test.ts`. No permission key: the platform owner role writes.
- **`admin.access` is retitled** "Platform admin: companies, modules and ceilings" (it read "plans, modules and ceilings"). Its key, screens and row are otherwise unchanged; the title is read nowhere else.
- **When `admin.billing` is off:**
  - the nine routes answer 404 to everyone, before the admin row is read;
  - the Plans nav item and the Status tab go, and both pages are not found;
  - the audit log's Action filter stops offering the seven actions, and the API and the demo refuse them as a filter with 400 "Choose an action from the list."; their entries still list;
  - DemoStore's part 2 methods refuse with "This feature is switched off.";
  - the rest of the console (companies, access, support and the audit log) works as before.
- **When `admin.access` is off,** everything under /admin is already gone, and the nine routes answer 404 too.
- **Owner question 43** asks the owner to confirm the key. The /feature-change step-2 impact summary is in the PR body and ADR 0056.

### Safer than the outline (part 2)
Each is recorded in docs/blueprint-delta.md and ADR 0056.
1. **A fresh trial can't be suspended or cancelled, and a company that never had a plan can't be reinstated, from the console** (422). The access rule would leave a suspended or cancelled fresh trial with Platform only, so its people couldn't read or export during the read-only days. The fix is a core/access change (owner question 34). The refusal and the page name the stop-gap: switch its modules off on its Access page, reversibly and audited.
2. **Suspend and cancel never widen.** The shared check refuses any action that would make the company read only or locked later than it already would be, from `companyPhase` itself. Suspending a cancelled company is refused outright.
3. **Reinstate restores what the rows say:** `active` if the company ever paid, else `trial`. `past_due` is never written (owner question 35). Reinstating after a cancel is allowed, because cancel deletes nothing (owner question 36).
4. **Cancel changes only the status, its stamp and `updated_at`,** plus one audit row, and needs the company's name typed exactly. Nothing is deleted, revoked or detached.
5. **A plan in use keeps its modules and limits.** In use means any subscription row, a deleted one included, names it. Name and prices may change: a rename shows on every such company's billing page, and a price changes nothing any company pays (owner question 38).
6. **No plan is ever deleted.** Retire and restore only, both reversible, neither changes a company. A key is never reused (owner question 45).
7. **Every new plan names every field:** both prices typed (0.00 only as typed, no default, no yearly rule), at least one module, and both limits from 1 to 100,000. "No price" needs a migration and "unlimited" an owner decision (owner questions 39 and 40).
8. **`admin.billing` hides everything when off,** answering 404 before the admin row is read, through a route-level switch in the platform guard, so neither the role check nor the step-up reveals the routes.
9. **Every write: the owner role, a step-up, a reason of 10 to 500 characters, and one audit row in the same control transaction,** under row locks (the admin's own row, then the company or the plan). State checks run under the lock, so two admins can't both apply the same action.
10. **Reasons are seen by the owner role and their author only,** narrowed in SQL first and by the shared view again (owner question 41).
11. **No company database is opened,** and the company's own `audit_log` isn't written (CLAUDE.md rule 2; owner question 42). The Owner learns of a suspension or cancellation from part 4's standing and notice.
12. **The console shows the consequences before the step-up.** The server computes the preview from every row, deleted ones included, at the database's time. A refused action is disabled with its reason, and the shared input checks run before any code is asked for.
13. **Both new GETs send `Cache-Control: no-store`.**
14. **The api-mode e2e touches only Summit's status and its own `e2e-` plans.** It never switches the status trigger off on the shared database, moves Summit back to `active` only, and hard-deletes only `e2e-` plans that no subscription row names.
15. **A status action carries the status the admin saw** (`expectedStatus`). If another admin changed it meanwhile, or a later change won the race, it answers 409 and writes nothing. This is stricter than the access PATCH's "last save wins".
16. **The acting admin is checked again under a lock on their own row** in every plan and status write: deactivated, deleted or moved to the support role meanwhile gives 403.
17. **While `admin.billing` is off, the audit log doesn't offer the seven actions as a filter,** in the web, the demo and the API. Their rows stay listed as history (owner question 47).

### As built (part 2)
Filled in by the docs stage: the points the build settles, and anything where the code needed the safer reading.

### Edge cases and known limits (part 2)
- **Clock skew.** The trigger stamps the database's clock, and TenantGuard compares with the API's. If the API's clock runs behind the database's, a cancelled company, or a never-paid suspended one, reads `full` for that gap after the change. A paid suspension is read only whatever the time.
- **Reinstate gives time back.** Reinstating restores full use, and a later suspend starts a new 30 days within the rows' own ladder; it never gives more than the rows allow, because `companyPhase` takes the stricter of the two. Each step is an owner-role write with a step-up, a reason and an audit row.
- **Owners get no email,** and no entry in their own audit log (owner question 42).
- **The demo's company side has no life cycle.** A company suspended in the demo console keeps working on its own side and stays on the demo sign-in list.
- **`featureForPath` attributes /admin/plans to `admin.access`** (wildcard ranking). The admin pages check `admin.billing` themselves, and nothing under /admin uses `pathOn`.
- **The plan list isn't paged.** There are a handful of plans.
- **History stays visible:** audit rows of the seven actions still list while `admin.billing` is off (owner question 47).
- **Each local api-mode e2e run** adds plan and status rows to `platform_audit_log`, which is append-only. A killed run can leave Summit suspended until the next global setup, and an `e2e-` plan until the next clean-up. Moving Summit back stamps a new `status_changed_at`, which doesn't change an `active` company's phase.
- **Plan names aren't unique;** the key tells two plans apart.
- **In use means "ever named",** so a plan used once keeps its modules and limits for good.
- **The `freshTrial` rule** stays as it is (owner question 34), and a fresh trial still has no end (STATUS, "Trial with no subscription stays `full`").
- **The access PATCH** still has neither an actor re-check under a lock nor a stale-save check (question 11); part 2's writes have both. A follow-up.
- **Admins can type company data into a reason.** The hint discourages it, and the support role can't read other admins' reasons.
- **The whole Flooring demo project runs in CI only** for this part (see the acceptance criteria). CI's `e2e` job must be green before the self-merge.

### Acceptance criteria (part 2)

**Access**

64. The nine routes answer 401 without a session. They answer 404 to the owner role, the support role and a non-admin while `admin.billing` or `admin.access` is off, before the admin row is read. They answer 403 `forbidden` to a non-admin, and to an inactive, deleted or other-role admin, whatever the body. The metadata test, the isolation map and S-21 include them.
65. The support role reads `GET /platform/plans` and `GET /platform/companies/:id/status` (200) and gets 403 "Only the platform owner role can change this." on every write. The owner role without a step-up from the last 5 minutes gets 403 `step_up_required`.
66. An owner-role admin who is deactivated, or moved to the support role, while their write waits on the lock on their own row gets 403, and nothing is written.

**Plans**

67. The list holds every plan, retired ones included, with the exact fields. The seeded plans read "0.00". No subscription id, company id or company name appears. It sends `no-store` and writes no audit row.
68. Create answers 201 with the plan. It writes one `plans` row, one `plan_modules` row per module (never `platform`) and one `plan_limits` row, each with `created_by`, and one `plan.created` audit row with no company, the actor, the IP, the user agent and the trimmed reason.
69. Each create refusal answers 400 with its field's message, or 409 for a used key, a retired plan's included. Two parallel creates with one key give one 201 and one 409, one plan and one audit row. A refusal writes nothing.
70. Editing a plan no company uses changes its name, prices, modules and limits. A removed module's row is soft-deleted, and adding it again restores it. A stored hidden module stays. A save that changes nothing answers 200 and writes nothing. A key, a product or an unknown field answers 400 "Only a plan's name, prices, modules and limits can change." Two parallel edits both answer 200 and are both audited, and the stored values are those of the later audit row.
71. Editing a plan in use changes its name and prices only. The new name shows on the billing page of every company on it; no company's access, limits, subscription price, standing or phase changes. A change of modules or limits answers 422; the same modules in another order answer 200 with no change.
72. Retire and restore flip `active`, are audited, answer 409 when the plan is already so, and change no company. No route deletes a plan.
73. An unknown plan answers 404 "That plan does not exist."; an id that is not a UUID, 400.

**Company status**

74. The status preview lists the three actions with their refusals, or their next status, phase and dates, as the shared rule computes them at the database's time. Reading it writes nothing.
75. Suspending a company that paid makes it `suspended` and read only at once. Its reads pass, and its writes get 403 `company_read_only`. Its standing reads `read_only`, and the Owner's notice reads `suspended` with the lock date its rows give. One audit row holds before, after, the reason, the IP and the user agent, and `status_changed_at` is the change's transaction time.
76. Suspending a company that never paid makes it read only, and locked 30 days later, or sooner when its plan's own period runs out first: then 403 `company_suspended` and standing `locked`, while sign-in and `/auth/context` still work.
77. Reinstating sets `active` for a company that ever paid and `trial` otherwise, never `past_due`. A company suspended from `past_due` comes back `active`, and its overdue notice goes when its rows are current. The phase is then its rows', and writes pass while a row is current.
78. Cancelling needs the company's exact name. It makes the company read only, locking 90 days later (paid) or 30 days later (never paid), or sooner when its plan's own period runs out first. Nothing is deleted: its subscription, override, ceiling, product, member and database rows are unchanged, its database still exists and its rows still read. Reinstating restores writes.
79. Each impossible transition answers 409 with its message and writes nothing. Two parallel suspends give one 200, one 409 and one audit row.
80. A status action carries the status the admin saw. When another admin changed it meanwhile, it answers 409 "This company's status changed meanwhile. Read it again." and writes nothing.
81. A company that never had a subscription row answers 422 to suspend, cancel and reinstate, keeps its status and modules, and the message points to its Access page. One with only deleted rows can be suspended.
82. Cancelling a never-paid suspended company, when it would restart its read-only days, answers 422 and writes nothing. A paid suspended company can be cancelled.
83. A stored status the console doesn't know answers 422 to all three actions.
84. The status routes answer for a company whose database failed or is in maintenance. They open no company database pool, write nothing to the company's `audit_log`, and each answer's phase equals TenantDirectory's.

**Audit**

85. The platform audit log lists the seven new actions with their allow-listed details. The support role reads each reason as hidden, narrowed in SQL. The owner role reads every reason. The `action` filter accepts the 13 actions. A shape that doesn't fit reads "Details hidden".
86. While `admin.billing` is off, the Action filter offers only the six other actions, and filtering by one of the seven answers 400 "Choose an action from the list." in the API and the demo. Stored entries still list.

**Web**

87. In api mode, an owner-role admin creates and retires a test plan, suspends Summit with a reason and a step-up, and sees Suspended and Read-only and the Owner's suspended notice. They reinstate Summit and see Active and Full use, and find "Suspended company" with its reason in the audit log. Summit is `active` again afterwards and the test plans are removed. The whole api-mode suite passes in the same run.
88. The support role sees /admin/plans and the Status tab read only, with the note and no write buttons.
89. In the demo, the three plans read "$0.00". A plan is created, edited, retired and restored. Flooring Pro's modules and limits are locked as in use. Summit is suspended, reinstated and cancelled with its typed name, and the audit log lists each. /admin/plans and the Status tab pass axe in both themes and the console check, with no sideways scroll at 375 px.
90. With `admin.billing` off, there is no Plans nav item and no Status tab, both pages are not found, DemoStore refuses with "This feature is switched off.", the API answers 404, and the rest of the console works.
91. A refusal the shared rules can see (a plan field, a reason, the typed name, an action the preview refuses) is caught before the step-up. A refusal the server finds later (409 or 422) closes the dialog and reads again, in both modes.

**Planned coverage** (the docs stage replaces this with "As built, the criteria are covered by"):
- 64: `apps/api/test/platform-admin-guard.test.ts` (G-7 to G-9), P-1, C-1, `apps/api/test/platform.int.test.ts` (the 401, 403 and 404 loops; at least 17 routes and 6 controllers), the session-only map in `apps/api/test/isolation.int.test.ts`, and S-21 in `company-standing.int.test.ts`.
- 65 and 66: P-2, C-2, P-13 and C-18, with the lock helpers in `apps/api/test/support/admin-locks.ts`.
- 67 to 73: `apps/api/test/platform-plans.int.test.ts` (67 is P-3, 68 is P-4, 69 is P-5, 70 is P-6 and P-12, 71 is P-7, 72 is P-8 and P-9, 73 is P-10; P-11 for no company pool and no company audit row) and `packages/shared/test/platform-plans.test.ts` (PL-1 to PL-9).
- 74 to 84: `apps/api/test/platform-company-status.int.test.ts` (74 is C-14, 75 is C-5, 76 is C-6, 77 is C-7, 78 is C-8 and C-9, 79 is C-10 and C-13, 80 is C-13b, 81 is C-11, 82 is C-12, 83 is C-17, 84 is C-15 and C-16; C-3 and C-4 for the 400s and 404s) and `packages/shared/test/company-status.test.ts` (CS-1 to CS-12), with CS-0 in `company-lifecycle.test.ts`.
- 85 and 86: `packages/shared/test/platform-audit.test.ts` (AU-1 to AU-5), `apps/api/test/platform-audit.int.test.ts` (A-9), and `apps/web/tests/unit/platform-audit.test.tsx` (W-8).
- 87: `apps/web/tests/e2e-api/platform-billing.spec.ts` and `tests/e2e-api/global-setup.ts`, with the test-only helpers in `packages/db/src/testing.ts`, tested by `packages/db/test/status-test-helpers.int.test.ts` (H-1 to H-4).
- 88, 90 and 91: `apps/web/tests/unit/platform-billing.test.tsx` (W-1 to W-6) and `apps/web/tests/unit/demo-platform.test.ts` (W-7), with P-1 and C-1 for the API.
- 89: `apps/web/tests/e2e/admin-billing.spec.ts` (D-1 and D-2), and /admin/plans and /admin/companies/summit/status in `tests/e2e/screens.ts` (axe in both themes, the console check, the 375 px loop in `responsive.spec.ts`).
- Locally the touched demo specs, the axe, console and responsive specs, the whole HR project and the whole api-mode suite run. The whole Flooring demo project runs in CI's `e2e` job, which must be green before the self-merge (one 8 GB Mac shared with another build).

## Parts 2 to 4 (outline, not built here)

**Part 2: plans and company status.** Specified in full in "Part 2: plans and company status" above. The outline's reasons for leaving subscriptions and payments to the owner are kept there, under "Bounds".

**Part 3: audit and support.** Specified in full in "Part 3: audit and support" above.

**Part 4: the company side.** Specified in full in "Part 4: the company side" above.

## Waiting for the owner (deferred, not invented)

1. **The admin host** (blueprint p16, p28):
   - the rule that an admin's home company is one the platform controls;
   - admin sessions on the stricter of the platform's and the company's timeouts.
2. **Using a support grant** (ADR 0034: "P17 must build read-only access from an approved, unexpired grant"). A tenancy change.
3. **The real company directory**: custom roles and users. This weighs blueprint p6, which gives a read-only directory, against p7 rule 6, which gives company data only under an approved grant.
4. **Writing the company `audit_log` as "Platform admin"** for access changes and support requests. A tenancy change.
5. **Adding and removing platform admins.** Today this takes raw SQL and is not audited. The proposal: a CLI that writes `platform_audit_log`.
6. **Provisioning from the console**, with the owner's invitation (blueprint p13; STATUS).
7. **All billing**:
   - the meaning of "paid";
   - the payment record;
   - invoices, PDFs and reminders;
   - prices and the plan set;
   - trial length;
   - $0 plans;
   - proration;
   - unlimited plans and employee bands;
   - approval of the billing spec.
8. **What the `support` role may do** compared with `owner` (the safe default: read and request only).
9. **The step-up on a support request** (taken: required, like every /platform write).
10. **Products editable per company.** Read-only for now.
11. **A check against stale saves** when two admins edit one company.

Added by part 3 (ADR 0053):

12. **The migration error text.** Should anyone ever see it in the console, for example the owner role under an approved support grant, or in a scrubbed form? Taken: never in the console. The CLI prints it only when it couldn't be saved to `last_error`.
13. **Old audit rows still hold the full text** in `after`. Purging them means editing an append-only log. Taken: redact on read.
14. **A migration for an index on `platform_audit_log (at, id)`,** and the append-only trigger (already asked in ADR 0052).
15. **Company people in the console.** May an Owner's name show as the approver or the actor? Taken: no.
16. **The support role and the audit log.** Taken: the whole log, without addresses and without other admins' support reasons; its own reasons are shown. Should it see more (part 1's "every page") or less?
17. **The maintenance-only fallback** writes no audit row; only the CLI line and the alert say so. Should it also try a code-only audit row?
18. **The limits.** Confirm 10 requests per admin in 24 hours, one open grant per admin and company, and that an approved, unexpired grant blocks a new request. Taken: the 24-hour limit is per admin across companies. Should it also be per company?
19. **CSV export of the platform audit log.** Taken: not offered. If it is wanted, cells starting with `=`, `+`, `-`, `@` or a tab must be neutralised first, an app-wide `toCsv` fix. Also: how long to keep `platform_audit_log`.
20. **Withdrawing a request.** Taken: no withdraw route. Should an admin be able to withdraw their own pending request?

Added by part 4 (ADR 0054). Each records the option taken; questions 1, 2 and 7 stay open.

21. **Why a company is locked or in maintenance.** Should its Owner see why, and until when? That needs an Owner check without the company database, or a TenantGuard change. Taken: no; one screen with the API's text for everyone.
22. **Prices on the Billing page.** Taken: not shown while prices are open.
23. **"Paid through" or "current period ends"** (depends on question 7). Taken: "Current period ends".
24. **A read-only notice for every member.** Taken: the Owner only.
25. **A trial-ending banner.** Taken: none.
26. **Support decisions in a read-only or locked company.** Should the Owner still approve or revoke support access?
    - TenantGuard refuses writes when the company is read only, and everything when it is locked.
    - Allowing it needs a session-only route that writes control rows, or a TenantGuard change.
    - Taken: read only means the list only, with no actions; locked means nothing. Grants open nothing yet.
27. **The new key `settings.billing`.** Confirm it: status `demo`, the Owner only with no permission key, and the support panel under `settings.users`. The /feature-change step-2 impact summary is in the PR body and ADR 0054.
28. **"Contact us".** A contact address or link, which needs the brand and domain.
29. **A step-up on revoke.** Taken: no; the API is unchanged.
30. **Seats in use on the Billing page.** They live in the company database. Taken: a link to Users.
31. **Shortening an approved grant, or seeing who approved it.** Should an Owner be able to? Taken: no API change.
32. **Requests to a company whose Owner can't answer** (read only or locked). May platform admins still ask? Taken: unchanged. Requests are allowed, open nothing and expire.
33. **Self-approval.**
    - A person who is both a platform admin and a company's Owner can approve their own request. The approve route doesn't compare the approver with the requester, and `platform-support.spec.ts` sets up exactly such a person for Summit.
    - Taken: unchanged, because grants open nothing.
    - It must be refused before grant use is built (question 2).

Added by part 2 (ADR 0056). Each records the option taken; questions 1, 2, 4, 7 and 11 stay open.

34. **Suspending or cancelling a company that never had a plan.**
    - The access rule gives a company with no subscription row every module only while its status is `trial`, and Platform only otherwise, so a suspended or cancelled fresh trial couldn't read or export.
    - Taken: the console refuses (422). The stop-gap is switching its modules off on its Access page.
    - Or should the access rule change so a suspended or cancelled company with no rows keeps its products' modules, read only? That is a core/access change.
35. **Reinstate's status.** Taken: `active` when the company ever paid, else `trial`. A company suspended from `past_due` comes back `active` and loses its overdue notice when its rows are current. Or should it get back the exact status it had before the suspension, read from its audit row?
36. **Reinstate after cancel.** Taken: allowed, because cancel deletes nothing. Should cancel be final?
37. **Cancelling a never-paid suspended company** when it would restart its read-only days. Taken: refused. Confirm.
38. **A plan change for the companies on it.** Taken: a plan in use keeps its modules and limits, and per-company changes stay on the Access page. Or should a plan change apply to every company on it at once, after a confirmation?
39. **Prices.** Taken: required and typed, 0.00 allowed as typed, no "no price" without a migration, and no rule that the yearly price is ten monthly ones. Confirm, and say what a $0 plan means (question 7).
40. **Unlimited plans and employee bands.** Taken: not creatable. A plan with no limits row, only possible by SQL, means no limit today.
41. **Reasons on status and plan entries.** Taken: the owner role and the author see them; the support role sees "Reason hidden". Confirm.
42. **Telling the company.** Should its Owner be emailed, or see an entry in the company's own audit log, when it is suspended, reinstated or cancelled? Taken: neither; the Owner sees part 4's standing and notice (also question 4).
43. **The new key `admin.billing`.** Confirm status `demo`, both products, the Platform module and writes by the owner role only; and the retitle of `admin.access` to "Platform admin: companies, modules and ceilings". The /feature-change step-2 impact summary is in the PR body and ADR 0056.
44. **Retired plans in the list.** Retiring a plan changes nothing today, because subscriptions can't be created yet. Taken: retired plans are listed, marked Retired. Should they be hidden by default?
45. **Deleting a plan.** Taken: a plan is never deleted and its key is never reused. Confirm.
46. **Stale plan edits.** Taken: the last save wins under the plan's lock, and both saves are audited. Should plan edits also carry what the admin saw, as status actions now do (and should the access PATCH, question 11)?
47. **Audit history while `admin.billing` is off.** Taken: the seven actions' rows stay listed, and only the filter stops offering them. Should their rows be hidden too?
