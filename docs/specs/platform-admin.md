# Platform admin: companies and access on the API (draft spec)

**Draft, built under the owner's overnight rule of 2026-11-15; open points took the safest option.** Part 1 is built on `feat/platform-access-api` (PR #34) and recorded in ADR 0052 and the 2026-11-15 row of docs/blueprint-delta.md. Where the build settled a point this draft left open, the text below says what was built.

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
| 1 | `feat/platform-access-api` | The platform guard, `/platform/me`, the companies list and detail, change company access, the restricted directory, and the support-access request behind the guard. The /admin console reads and writes the API in api mode | This spec's acceptance criteria |
| 2 | `feat/platform-manual-billing` | Plans as data; suspend, reinstate and cancel. Subscriptions and payments wait for the owner | Later, see "Parts 2 to 4" |
| 3 | `feat/platform-audit-support` | The platform audit viewer, support requests in the console with limits, database and maintenance columns, migrate.ts hardening | Later |
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
- **Limits.** They are written to the override columns of every subscription row that is not deleted, cancelled ones included, because the limit is the largest across those rows (`plan-limits.ts`).
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
- **No step-up in the demo.** Save applies at once, as before, so the demo admin spec does not change.
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

    As built, `apps/web/tests/e2e-api/platform-admin.spec.ts` covers sign-in and enrolment, Summit in the list, unticking `retail.sample.view`, a wrong step-up code, the save, the toast and the reload. The key is put back through the database, not the UI (review A6). The gate's answers, a company user sent to / among them, have unit tests (`tests/unit/platform-console.test.ts`); the not-found data pages have no automated test yet.
18. The demo-mode admin and import Playwright specs keep passing. They were not edited; CI's `e2e` check runs them.

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

**Part 3: audit and support.**
- `GET /platform/audit`, newest first. Migration rows come back as `{ code }` only, old rows included. IP and user agent are for the owner role only.
- The support grants in the console:
  - at most one open grant per admin and company (409);
  - at most 10 requests per admin in 24 hours (429 `rate_limited`).
- Database and maintenance columns with the SQLSTATE code.
- migrate.ts hardening: maintenance in the same transaction as `last_error`, and only the code in the audit row.

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
