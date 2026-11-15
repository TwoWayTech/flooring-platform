# Platform admin: companies and access on the API (draft spec)

**Draft, built under the owner's overnight rule of 2026-11-15; open points took the safest option.** Part 1 is built on `feat/platform-access-api` (PR #34) and recorded in ADR 0052 and the 2026-11-15 row of docs/blueprint-delta.md. Part 3 is specified in "Part 3: audit and support" below, under the same rule. It is being built on `feat/platform-audit-support` and is recorded in ADR 0053. Where the build settled a point this draft left open, the text below says what was built.

Drafted by Claude on 2026-11-15 as P11 step 1 for module 17, "Platform admin and manual billing" (docs/real-build-plan.md). docs/product-spec/settings-and-permissions.md describes the demo's console: who uses it, the "Change company access" workflow, rules 18 and 24, and the edge cases. It has no server design and nothing on billing.

The owner restarted the queue with this module next and is asleep. So this draft is built without the P11 "stop for my approval" step, as `docs/specs/settings-users-access.md` was (docs/blueprint-delta.md, 2026-11-13). Each open point takes the safer side and is recorded in docs/blueprint-delta.md and ADR 0052.

Sources:
- blueprint p4 to p7: the layers of control, super-admin "Company access", and role rules 3, 6 and 8;
- blueprint p13 and p14 (control tables), p16 (admin host), p23 and p24 (billing and plans), p27 to p29 (MFA, super-admin, support access);
- ADR 0030, 0031, 0033 and 0034;
- docs/api-contract.md and docs/data-model.md.

## Parts

| Part | Branch | What | State |
| --- | --- | --- | --- |
| 1 | `feat/platform-access-api` | The platform guard, `/platform/me`, the companies list and detail, change company access, the restricted directory, and the support-access request behind the guard. The /admin console reads and writes the API in api mode | Built in PR #34; acceptance criteria 1 to 18 |
| 2 | `feat/platform-manual-billing` | Plans as data; suspend, reinstate and cancel. Subscriptions and payments wait for the owner | Later, see "Parts 2 to 4" |
| 3 | `feat/platform-audit-support` | The platform audit viewer, support requests in the console with limits, database and maintenance columns, migrate.ts hardening, and the read-only access page for the support role | In progress (draft PR). Specified in "Part 3: audit and support"; acceptance criteria 19 to 39 |
| 4 | `feat/billing-company-standing` | Company side: maintenance and suspended screens, the Owner's banner, a read-only billing page, the Owner's support-access panel | Later |

## Who uses it

- **Platform admin:** a person with a row in `platform_admins` that is `active` and not deleted, whose `role` is `owner` or `support`. Any other role value counts as no admin.
  - Both roles read every /platform page.
  - Only the `owner` role changes a company's access.
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
| `POST /platform/support-grants` | Any platform admin | Yes | `support.requested` | `{ companyId, reason (10 to 500 characters), hours (1 to 72) }`. 201 `{ id }`; 404 for an unknown company |

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
| `userLimit`, `branchLimit` | number or null | `core/access/plan-limits.ts` | Null means no limit (a trial with no plan). The branch limit is not enforced yet |
| `members` | number | Count of control `member` rows | Sign-ins with a membership. This is not seats in use, which needs the company database |
| `database` | `{ status, schemaVersion, hasError }` | `tenant_databases` | `status` and `schemaVersion` are null with no database row. Never the error text: it can quote company data (owner decision on maintenance, 2026-11-13; STATUS follow-up) |

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
| A limit when the company has no subscription row that is not deleted | 422 `rule_broken`, "This company is on a trial with no plan, so it has no limits to change." |
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
  - **Trial with no plan:** the limit inputs are disabled, with "On a trial with no plan there is no limit."
  - **Branch limit:** it reads "Stored, not enforced yet."
  - **Account facts:** status and since when, phase, members ("People who can sign in, not seats in use."), and the database state and schema. With a failed migration it says "Error details are hidden: they can hold the company's data."
  - **Permission ceiling:** one matrix over every offered, visible module of the company's products. As built: the Flooring Suite's modules already include HR's, so a matrix per product would repeat modules. The preview lists pages for each product.
  - **Effective access preview (rule 24):** it works on the draft and the default roles.
  - **Roles, read only:** the default roles.
  - **Users:** "The company's users and custom roles need support access, which isn't available yet."
  - **Save access:**
    - The step-up dialog comes first.
    - Then the page sends only the changed parts, with modules and keys limited to the offered, visible ones.
    - The toast reads "Access saved for {name}. It applies at once." Then the page reads the company again.
    - A refusal shows the API's message.
- **Tabs:** Access only. In api mode the Data import and Connect a database pages are not found, not merely hidden; import is a later item in the queue.

### Demo mode

Behaviour is unchanged, with one exception: the store now checks the same rules (`accessPatchProblem`, through `updatePlatformCompanyAccess`). This closes the edge case "`updateCompanyAccess` has no check in the store". The demo directory still lists the fixture's roles and users, and the demo still writes "Changed company access" to the company's log.

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
- **A support admin sees the editor.** The screen does not know the admin's role, so a support admin can tick boxes and step up before the API's 403 shows in a toast.
- **MFA reset.** A company can't reset a platform admin's MFA (existing, ADR 0034).
- **Members.** The count is of sign-ins, not seats in use.
- **Database errors.** The error text is never shown, only the status and a "has error" flag. The SQLSTATE code comes with part 3, which stores it.
- **Support grants.** A grant still opens nothing.
- **Products.** They are read-only.
- **Limits on a trial with no plan.** It has none, and none can be set without a subscription row, which waits for the owner.

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

**Draft, under the same overnight rule.** Branch `feat/platform-audit-support`, from main at `bb3e81f`. It is recorded in ADR 0053, which takes a new number because this part also changes the `pnpm db:migrate` rollout in packages/db and how old audit rows are read. Where part 3 departs from part 1's text or from the part 3 outline, it is on the safer side. Each departure is listed in "Safer than the outline (part 3)" and recorded in docs/blueprint-delta.md and ADR 0053.

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
| `support.requested` | `{ kind: "support_requested", reason, expiresAt }` | `before` is null or absent. `after` is exactly `{ reason, expiresAt }`, with `reason` a string of 1 to 500 characters and `expiresAt` a string that parses as a date. Otherwise hidden. Also hidden from the support role when another admin asked |
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
  - **Database:** the status label. With an error it adds " · error {code}", or " · error, no code recorded". With no database row it reads "No database".
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
- **Otherwise:** "Company {id} is NOT in maintenance mode{, and its read-only database still serves reads}: turn it on by hand (tenants.maintenance_mode, reason migration_failed); {n} platform admin(s) {…}." The bracketed clause appears only for a read-only database.

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

  It looks like the company tabs and scrolls sideways at 375 px.
- **Audit log (/admin/audit):**
  - **Title and description:** "Platform audit log". The description reads "Every change made in the console, every support request and every failed database update, newest first. Company data and error text are never shown."
  - **Filters:** Company (every company, plus "All companies") and Action (the six actions, by label). Changing a filter starts again from the newest entries. The filters stack at 375 px.
  - **Columns:** When, Who, Company, What and Details. The owner role also gets "Address and device": the IP and the user agent, truncated, with the full value on hover, or "Not recorded" when absent.
  - **Who:** the admin's name, "The company's Owner", "System (database update)" or "Unknown".
  - **What:** "Changed company access", "Asked for support access", "Support access approved", "Support access revoked", "Database update failed" or "Database updated after a failure". An unknown action shows its name.
  - **Details:**
    - Access: "Switched on: …" and "Switched off: …" with module labels; "Added: …" and "Removed: …" with permission labels, or the key for one this build doesn't know; each limit as "from → to"; and "{n} override rows, {m} limit rows written".
    - A request: the reason in quotes, and "Ends {date}".
    - A decision: "Approved" or "Revoked".
    - A failed update: "Error code {code}" or "No error code recorded".
    - A recovered update: "Now on schema {version}".
    - Anything hidden: "Details hidden".
  - **Empty:** "No platform changes recorded yet."
  - **Older entries:** a "Load older entries" button while there is a next page. A failure shows a toast with Try again.
  - **No "Export CSV"** (see "Safer than the outline (part 3)").
- **Support tab (/admin/companies/:id/support).** The company tabs read Access, Support, then the demo-only Data import and Connect a database.
  - **Heading:** the company name, then "Support access".
  - **Panel:** "Ask this company's Owner for read-only access for a few hours. The Owner approves or revokes it in Settings. Approved access doesn't open the company's data yet." The support role also reads "You see your own requests."
  - **The button:** "Ask for support access". It is disabled while the admin's own request for this company is pending or approved, with the hint "You already have an open support request for this company."
  - **Table:** Requested, By ("{name} (you)" for your own), Reason, Ends and Status. Each status has its own icon and tone: pending, approved, revoked and expired. There is no export.
  - **An unknown company:** "This company does not exist."
- **Ask for support access (dialog):**
  - **Fields:** Reason, a text area of 10 to 500 characters with a counter; and Hours, from 1 to 72, default 4.
  - **Hint:** "Don't paste the company's data here: the reason is kept in the platform audit log."
  - **Checked before sending** with `supportRequestInputProblem`. The field in error is marked invalid and gets focus.
  - **Continue** closes the form and opens the step-up dialog ("Asking {name} for support access"). Then the request is sent.
  - **Success:** "Support access requested. {name}'s Owner approves it in Settings." Then the list is read again.
  - **A 409 or 429** shows the API's message.
- **Companies list:** the Database and Maintenance columns ("Database errors and maintenance").
- **Company access (/admin/companies/:id) for the support role:** read only.
  - **A note** (`role="note"`): "Read only: only the platform owner role can change a company's access."
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
The docs stage rewrites these as built:
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

### Edge cases and known limits (part 3)
- **Old rows still hold the text** in the control database: any SQL user, backup or dump sees it. Only the console is redacted (owner question 13).
- **`errorCode` is the newest recorded failure's.** `last_error` has no timestamp. Before part 3, a failure's audit row was written in a separate step after `last_error`, so if that step failed, the code shown can belong to an earlier failure. From part 3 on, the two are written together.
- **Only when both the transaction and the fallback fail,** which in practice means the control database is unreachable, does a read-only database keep serving reads on a half-migrated schema. A claimed database stays `migrating`, so it can't be used. The alert, if it can be sent, and the CLI say so.
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

## Parts 2 to 4 (outline, not built here)

**Part 2: plans and company status.**
- **Safe to build:**
  - plans as data: list, create, edit, retire and restore, with `planProblem` checks; key and product fixed after creation; prices are decimal strings and data, not code (owner, 2026-11-13);
  - suspend, reinstate and cancel through `statusAfter`:
    - each needs a reason, and cancel also needs the typed company name;
    - subscription rows are left alone;
    - `past_due` is derived, never written;
  - a new feature key `admin.billing` through `/feature-change`.
- **Waits for the owner:** creating or changing a subscription, recording a payment and correcting a period.
  - An `active` row counts as paid (`wasPaid` in company-lifecycle.ts). A subscription created before any payment would give a never-paid company the paid ladder: read-only for good after a suspension, and 90 days after a cancel instead of 30.
  - A payment would exist only as an audit row and a moved date, with nothing that can't be edited (CLAUDE.md rule 9).
  - These need the owner's answers on `first_paid_at` or a `platform_payments` table, and an approved billing spec.

**Part 3: audit and support.** Specified in full in "Part 3: audit and support" above.

**Part 4: the company side.**
- `GET /company/standing`: the company comes from the session, with its own membership check, and it answers for locked and maintenance companies too.
- Full-page "under maintenance" and "account suspended" screens.
- The Owner's banner when payment is overdue or the company is read-only.
- A read-only /settings/billing page for the Owner (new key `settings.billing`).
- The Owner's support-access panel on the existing endpoints, saying support can't see data yet.

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
