# API contract

Every screen reads and writes data through the `ApiClient` interface in `apps/web/src/lib/api/contract.ts` (CLAUDE.md rule 1). The demo implementation is `DemoStore` (`apps/web/src/lib/api/demo/`): generated fixtures moved to today's date, plus a per-company localStorage overlay. `NEXT_PUBLIC_DATA_SOURCE=demo` selects it. To connect the real API, write an HTTP client that implements the same interface and select it in `apps/web/src/lib/api/index.ts`. Screens do not change.

The tenant always comes from the session, never from a parameter, as it will on the real server. The suggested REST endpoints below are what the real client would call.

## Conventions for apps/api (real build, decided 2026-11-12)

- **Moving a module.** With `NEXT_PUBLIC_DATA_SOURCE=api`, `apps/web/src/lib/api/index.ts` routes each `ApiClient` method listed in `API_METHODS` (`lib/api/http/api-methods.ts`) to apps/api through `HttpTransport`. Every other method stays on DemoStore. A module's pull request adds its methods there. The persona picker and `/api/demo/*` exist only in demo mode.
- **URLs.** No version prefix. Resources are plural and kebab-case (`/purchase-orders`, `/supplier-payments`). `GET /:resource` lists and `GET /:resource/:id` reads. A business action is `POST /:resource/:id/<action>` (`/invoices/:id/void`), never a PATCH of a status field. `/me/...` is the signed-in person's own data.
- **Tenant.** It comes only from the verified session, never from a path, query or body. The API picks the company database through `TenantConnectionService` (P9).
- **Bodies.** JSON with camelCase fields. Every body is checked with a Zod schema from `packages/shared`. Money, quantities and rates are decimal strings, never JSON numbers. Area is in sq ft and length in ft. Dates are `YYYY-MM-DD` and moments are ISO 8601 in UTC.
- **Errors.** Every failure returns `{ code, message, details? }`. `message` is written for the person and shown as it is.

  | Status | Code | When |
  | --- | --- | --- |
  | 400 | `invalid_request` | The body failed validation |
  | 401 | `unauthenticated` | No valid session |
  | 403 | `forbidden` | Product, module, permission or data scope says no |
  | 404 | `not_found` | Also used for records outside the caller's data scope, so their existence does not leak |
  | 409 | `conflict` | State changed underneath, or a duplicate |
  | 422 | `rule_broken` | A business rule refused |
  | 429 | `rate_limited` | Too many requests |
  | 500 | `internal_error` | Unexpected; details are logged on the server only |

  The web client turns all of these into `ApiError`, so screens handle them as they handle a DemoStore rule error.
- **Lists.** Filtered by data scope on the server. Pagination arrives when a module needs it, as `?limit=&cursor=` returning `{ items, nextCursor }`.
- **Sensitive fields.** Cost, margin, pay rate and credit limit are removed by the server without `view_sensitive`. Hiding them on screen is not enough (sales.md, inventory.md).
- **Uploads.** Files go to storage through a signed URL from the StorageProvider. The API stores an `attachments` row and checks the real file type.
- **Docs.** OpenAPI is generated from the controllers at `/docs` (browsable) and `/docs/openapi.json`. `GET /health` is public.

## Authentication (real build, P8, ADR 0029)

In api mode the browser reaches these through the web app's own origin: Next.js rewrites `/api/auth/*` to apps/api's `/api/auth/*` and `/api-proxy/*` to the rest of apps/api, so the session cookie (`better-auth.session_token`, httpOnly, SameSite=Lax, `__Secure-` in production) is first-party on each product host. Better Auth's endpoints answer with Better Auth's own error body, `{ code, message }`, whose codes are upper case, such as `INVALID_EMAIL_OR_PASSWORD`.

| Route | Body / response | Notes |
| --- | --- | --- |
| `POST /api/auth/sign-in/email` | `{ email, password, callbackURL? }` → 200 and the cookie, or 200 `{ twoFactorRedirect: true, twoFactorMethods }` with a short-lived `two_factor` cookie (no session yet) when the account has an authenticator app | 401 `INVALID_EMAIL_OR_PASSWORD`. 403 `EMAIL_NOT_VERIFIED`, which also sends a verification link (at most 3 an hour per address). 403 `not_a_member` when the host names a company the user is not in. 403 `no_company`. 403 `passkey_required` when MFA is mandatory and the only factor is a passkey. 429 `account_locked` after 5 wrong passwords in 15 minutes, for 15 minutes. 429 with no code after 10 attempts a minute from one IP (`rate_limited` in the web client) |
| `POST /api/auth/two-factor/verify-totp` | `{ code }` → 200 and the session cookie | Finishes a sign-in (with the `two_factor` cookie) or confirms set-up (with a session). 401 `INVALID_CODE`. 429 `ACCOUNT_TEMPORARILY_LOCKED` after 5 wrong codes in a row, for 15 minutes. 400 `trust_device_unsupported` for `trustDevice: true`. 10 a minute per IP |
| `POST /api/auth/two-factor/verify-backup-code` | `{ code }` → 200 and the session cookie | Each of the 10 backup codes works once. Same limits as verify-totp |
| `POST /api/auth/two-factor/enable` | `{ password }` → `{ totpURI, backupCodes }` | Starts authenticator-app set-up. It is on once the first code is confirmed with verify-totp |
| `POST /api/auth/two-factor/disable` | `{ password }` | 403 `mfa_required` when MFA is mandatory for the user |
| `POST /api/auth/verify-password` | `{ password }` → 200 | Confirms the password before a passkey is added. The confirmation lasts 5 minutes, on this session only. 10 a minute per IP. Wrong passwords here, and on `change-password` and the two-factor `enable`, `disable`, `get-totp-uri` and `generate-backup-codes`, count towards the sign-in lockout: 429 `account_locked` |
| `/api/auth/passkey/*` | Better Auth passkey plugin | Register: `generate-register-options` and `verify-registration` need a session signed in at most 10 minutes ago and a password confirmed with `verify-password` in the last 5 minutes, otherwise 403 `password_confirmation_required`. `createSession: true` answers 400 `create_session_unsupported`. Adding a passkey emails the account. Sign in: `generate-authenticate-options` and `verify-authentication`, 10 a minute per IP. Also list, rename and delete. Deleting the last factor of a user who must use MFA answers 403 `mfa_required`. The relying party is `PASSKEY_RP_ID`, and user verification (PIN or biometric) is required |
| `POST /api/auth/two-factor/send-otp`, `verify-otp` | 404 | Codes by email or SMS are not offered |
| `POST /api/auth/sign-up/email` | refused | Accounts are invite-only |
| `GET /api/auth/verify-email?token=&callbackURL=` | redirects to `callbackURL` | The link in the verification email |
| `POST /api/auth/organization/set-active` | `{ organizationId }` | Opens one of the user's companies (the chooser). 400 `company_id_required` without a company id (`null` and `organizationSlug` are refused). 403 `not_a_member` for any other company, and 403 `wrong_host` for a company other than the one the host names. It selects among the session's verified memberships, so the tenant still comes from the session (rule 2) |
| `GET /api/auth/organization/list` | the user's organizations | Every other organization endpoint answers 404 |
| `POST /api/auth/sign-out` | → 200 | Deletes the session |
| `POST /api/auth/change-password` | `{ currentPassword, newPassword }` | At least 12 characters |
| `GET /auth/context` | → `{ user: { id, name, email }, company: { id, slug, name } \| null, companies: [...], mfa: { required, totp, passkeys, state } }` | The shared error body. 401 `unauthenticated` without a session; 401 `session_expired` when the company's idle or absolute timeout ended it (the session is deleted). `company` is null until the user chooses one. `mfa.state` is `enrolment_required` when MFA is mandatory and the user has no factor yet |
| `GET /public/branding?host=` | → `{ displayName, monogram, brandColor, pattern, defaultTheme }` | Public, for the login page. 404 `not_found` when the host names no live company. 400 `invalid_request` for a malformed host. The logo arrives with the branding upload (P11) |

**Mandatory MFA (blueprint p27).** Owner, Accountant, HR and active platform admins must use a second factor. Until they have one, their session may only set up an authenticator app or a passkey, read `/auth/context`, choose a company and sign out. Every other Better Auth endpoint and every guarded route answers 403 `mfa_enrolment_required`. The roles are read from `member.role`, which holds the person's company role keys, comma-separated.

**Auth only through the web host.** With `AUTH_PROXY_SECRET` set (required in production), any `/api/auth/*` request that does not carry the web proxy's secret answers 403 `proxy_required`. The web host answers 404 for `/api-proxy/api/auth/*`.

## Tenancy (real build, P9, ADR 0030)

Every Nest route needs a signed-in session with an open company, unless it is marked `@Public()` (`GET /health`, `GET /public/branding`) or `@SessionOnly()`. The session-only routes are `GET /auth/context` and `POST /auth/step-up` (ADR 0034), and the eight /platform routes (ADR 0052 and ADR 0053), which carry `PlatformAdminGuard` at class level as their only authorization layer. The guards run globally in this order: SessionGuard, then TenantGuard. So a new route is closed until it says otherwise.

The company always comes from the verified session. A `companyId` or `tenantId` in the path, query, body or headers is never read. Company data is reached only through `TenantConnectionService.db(tenant)`, where `tenant` is the `@CurrentTenant()` context that TenantGuard made.

**The one exception: platform routes (ADR 0052).** A /platform route names the company it acts on, by `:id` (a UUID, checked with `ParseUUIDPipe`), or by `companyId` in the support request's body and in the query of `GET /platform/audit` and `GET /platform/support-grants` (a UUID, "That company id is not valid." otherwise). That id selects control-database rows only: `tenants`, products, subscriptions, module overrides, the ceiling, branding, database status and member counts. It is never passed to TenantConnectionService, no TenantContext is built from it, and no company database is opened, so CLAUDE.md rule 2 holds. Lint bans the tenancy, tenant-context and company-schema imports in `apps/api/src/modules/platform`, and a test shows these routes answering for a company whose database failed or is in maintenance.

| Status and code | When |
| --- | --- |
| 401 `unauthenticated` | No session, or a host Better Auth does not serve |
| 403 `company_required` | The session has no open company (the chooser), or the company is deleted |
| 403 `not_a_member` | The person was removed from the company during the session |
| 403 `product_not_enabled` | The company lacks the product the web host serves (`x-demo-product`), or one the route requires with `@RequireProduct()` |
| 403 `company_read_only` | A write (anything but GET, HEAD or OPTIONS) to a company in a read-only period (suspended, cancelled, or a lapsed plan; ADR 0033) or whose database is read-only. Reading still works (blueprint p29, p40) |
| 403 `company_suspended` | The company's read-only period is over, so it is locked. Sign-in and `/auth/context` still work, and no data is deleted (ADR 0033) |
| 503 `company_maintenance` | The company is under maintenance (a move or a failed migration): no reads or writes (ADR 0033) |
| 503 `company_unavailable` | The company database is not ready (provisioning, migrating or failed) |

## Permissions, sensitive fields and audit (real build, P10, ADR 0031)

Every company route declares what it needs: `@RequirePermission(...keys)` (any one key from the packages/shared catalog), optionally `@RequireModule(module)`, or `@AnyCompanyMember()` for a person's own information. Effective permissions are role permissions ∩ the company ceiling ∩ enabled modules, worked out by the shared engine on every request.

| Status and code | When |
| --- | --- |
| 403 `forbidden` | The person holds none of the route's keys, or their profile in the company is disabled. Message: "Your role does not allow this. Ask an Owner to change your security role." |
| 403 `module_not_enabled` | The route's module is not on for the company (not in its products or plan, or switched off) |
| 403 `permission_undeclared` | The route declares no permission. This is a bug in the route, refused so it fails closed |

**Sensitive fields.** A company response, and the `details` of a company error, never contains a field listed in `SENSITIVE_FIELDS` (packages/shared) unless the viewer holds the key that reveals it. The list covers product cost, margins, job costing, pay rates, credit limit and contract line estimated cost; ADR 0031 lists every name. The server removes them at any depth, in camelCase or snake_case. These property names are reserved for sensitive values, and job costing uses `jobCost`, `jobMargin` and `jobMarginPct`.

**Audit.** Every successful company write (POST, PUT, PATCH, DELETE) writes an `audit_log` entry: the module's own, with before and after, or the API's safety-net entry (category `data`, the route and the record id). The log is append-only: the database refuses UPDATE, DELETE and TRUNCATE.

## Users, roles, step-up, invitations and support access (real build, P10 part 2, ADR 0034)

Draft spec: docs/specs/settings-users-access.md.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /users` | `settings.users.view` or `settings.users.manage` | Everyone with a profile in the company (`User`) |
| `POST /users/invite` | `settings.users.manage` | `{ name, email, title, roleIds, branchId }`: account, membership, profile `invited`, roles, and an emailed link (7 days, once). 409 `seat_limit`, `already_member`; 403 `not_held`, `owner_only`; 429 `email_limit` |
| `PATCH /users/:id` | `settings.users.manage` | `{ roleIds?, status?, branchId?, title?, mfaEnrolled?: false }`. Roles and MFA reset need a step-up. 409 `last_owner`, `shared_account` (MFA reset of an account in another company) |
| `GET /roles` | `settings.roles.view`, `settings.roles.manage`, `settings.users.view` or `settings.users.manage` | The company's roles with their keys |
| `POST /roles`, `PUT /roles/:id` | `settings.roles.manage` and a step-up | `{ name, description, dataScope, permissions }`. 403 `not_held` (adds a key the editor lacks), `owner_locked` |
| `POST /roles/:id/reset` | `settings.roles.manage` and a step-up | Back to the shipped template, limited to the products. 409 `not_default` |
| `DELETE /roles/:id` | `settings.roles.manage` and a step-up | 409 `system_role`, `role_in_use` |
| `GET /audit` | `settings.audit.view` | The newest 500 audit entries (`AuditEntry`). Entries in `PAY_SENSITIVE_AUDIT_ACTIONS` (commission plan terms; commission adjustment, reversal-decision, bonus and pay-run exclusion reasons) keep their row but read `"Hidden: pay details"` in `before` and `after` unless the viewer may read that entry (`payAuditDetailsVisible`): the Owner always; a holder of `hr.employee.view_sensitive` only when the person the entry is about (a bonus's employee, the excluded employee, the employee a commission statement pays) is inside their data scope by the HR person rule (`seesPersonRecords`). Plan terms, and an entry whose person can't be found, need data scope `all` (owner decisions 2026-11-14 and 2026-11-15, ADR 0048 "Audit visibility"). The screen's CSV export uses this answer |
| `POST /auth/step-up` | A session (no company needed) | `{ code }`: a TOTP or backup code; valid 5 minutes for this session. 403 `step_up_invalid`, `step_up_mfa_required`; 429 `step_up_locked` after 5 wrong codes in 15 minutes |
| `GET /public/invitations/:token` | Public, 10 a minute per IP | `{ email, companyName, needsPassword }`; 410 `invitation_invalid` |
| `POST /public/invitations/accept` | Public, 10 a minute per IP | `{ token, password? }`: sets the password of a new account (12 to 128 characters), verifies the email, activates the profile. 400 `weak_password`; 410 `invitation_invalid` |
| `GET /support-grants` | The Owner role | The company's support-access requests and their status |
| `POST /support-grants/:id/approve` | The Owner role and a step-up | 409 `grant_closed` |
| `POST /support-grants/:id/revoke` | The Owner role | 409 `grant_closed` |
| `POST /platform/support-grants` | A platform admin (role `owner` or `support`) and a step-up | `{ companyId, reason (10 to 500 characters), hours (1 to 72) }`, strict. 201 `{ id }`; 403 if no longer an admin (checked again under a lock on the admin's row); 404 for an unknown company and while `admin.access` is off; 409 `grant_open` while the same admin has an open grant for the company; 429 `rate_limited` after 10 requests by the admin in 24 hours. Behind `PlatformAdminGuard` since ADR 0052; limits since ADR 0053. See "Platform admin (real build, ADR 0052 and ADR 0053)" |

A route that needs a step-up answers 403 `step_up_required` without one from the last 5 minutes. Someone whose only factor is a passkey steps up by signing in again with it: a session under 5 minutes old counts. Password reset is Better Auth's `/api/auth/request-password-reset` and `/api/auth/reset-password` (one-hour links, every session ended; 3 emails an hour per address, shared with verification and invitation emails).

## Platform admin (real build, ADR 0052 and ADR 0053)

Parts 1 (ADR 0052) and 3 (ADR 0053). Spec: docs/specs/platform-admin.md (draft). Every route is `@SessionOnly()`: it needs a session but no open company and never uses the open company. TenantGuard, PermissionGuard and the AuditInterceptor don't apply, so `PlatformAdminGuard`, set at class level, is the only authorization layer. It runs in this order:

1. No verified session: 401 `unauthenticated` (SessionGuard answers first; the guard is the backstop).
2. `admin.access` off: 404 `not_found`, on every route below.
3. Not a platform admin: 403 `forbidden`, "Only platform admins can use this.". An admin has a `platform_admins` row that is `active`, not deleted, with role `owner` or `support`; any other role counts as none. The row is read on every request.
4. A write (not GET, HEAD or OPTIONS): the `owner` role unless the route allows `support` (403 "Only the platform owner role can change this."), then a step-up from the last 5 minutes (403 `step_up_required`, or `step_up_mfa_required`).

SessionGuard's own refusals come first: an admin with no factor gets 403 `mfa_enrolment_required`. Guards run before pipes and the body check, so a non-admin gets 403 whatever the body. `:id` is a UUID (400 `invalid_request` otherwise) and names control-database rows only (see Tenancy). An unknown or deleted company is 404 "That company does not exist.".

| Route | Who | Does |
| --- | --- | --- |
| `GET /platform/me` | Any platform admin | `PlatformMe` `{ userId, name, email, role }`. The web's /admin layout asks it to decide who may open the console |
| `GET /platform/companies` | Any platform admin | `PlatformCompanySummary[]` by name: `id`, `slug`, `name`, `city`, `state`, `products`, `status` (five values, as stored), `statusChangedAt`, `phase` (`full`, `read_only` or `locked`, as TenantGuard reads it), `maintenance { on, reason }`, `plan` (the plan names of the subscription rows that are not deleted, "(cancelled)" marked; "Trial, no plan" or "No plan" with none), `modules` (what the guards enforce), `userLimit` and `branchLimit` (null is no limit), `members` (control memberships, not seats in use), `database { status, schemaVersion, hasError, errorCode }`. `errorCode` is the SQLSTATE of the company's newest `company.migration_failed` audit row, only while `last_error` is set and only when it matches `^[A-Z0-9_]{1,32}$`, else null (ADR 0053). Never the database's error text, for any role |
| `GET /platform/companies/:id` | Any platform admin | `PlatformCompany`: the summary plus `legalName`, `timeZone`, `region`, `createdAt`, `ceiling` (the allowed keys, in catalog order) and `subscriptions` (the rows that are not deleted, each `{ id, planKey, planName, product, interval, price, currentPeriodStart, currentPeriodEnd, status, userLimitOverride, branchLimitOverride }`; `price` is a decimal string) |
| `PATCH /platform/companies/:id/access` | The `owner` role and a step-up | `PlatformAccessPatch` `{ modules?, ceiling?, userLimit?, branchLimit? }`, strict. A field left out stays as it is. See below. Answers with the company read again |
| `GET /platform/companies/:id/directory` | Any platform admin | `PlatformDirectory`, restricted: `roles` (the default role templates of the company's products), `users: []`, `branding` (display name, monogram, colour, pattern, default theme; no logo keys) and `restricted: true`. The company's own roles and users need support access, which opens nothing yet |
| `POST /platform/support-grants` | Either role and a step-up | `{ companyId, reason, hours }` (see "Users, roles, step-up, invitations and support access"). 403 if no longer an admin, 404, 409 `grant_open`, 429 `rate_limited`, in that order; parallel requests by one admin are serialised. Audited `support.requested`. See "Support requests" below |
| `GET /platform/support-grants` | Any platform admin | `PlatformSupportGrant[]`, newest first, at most 100: `{ id, company { id, name }, admin { userId, name }, mine, reason, requestedAt, expiresAt, approvedAt, revokedAt, status }`. Query `companyId?` (a UUID), strict. The owner role gets every admin's requests, the support role only its own. Never the approver |
| `GET /platform/audit` | Any platform admin | `PlatformAuditResult` `{ entries: PlatformAuditView[], nextCursor }`, newest first. Query `companyId?`, `action?`, `before?`, `limit?`, strict. See "Platform audit" below. Not audited |

**Change company access.** `accessPatchProblem` (packages/shared, also run by the demo store) refuses with 400 `invalid_request`:
- a `modules` list without `platform`: "The Platform module can't be switched off.";
- a module the company's products don't offer, or a hidden one (rule 18): "The {label} module isn't offered to this company.";
- a key not in the catalog: "{key} is not a permission."; a key whose module is not offered and visible: "{key} is outside this company's products.";
- a `ceiling` list without all of `settings.users.view`, `settings.users.manage`, `settings.roles.view`, `settings.roles.manage` and `settings.audit.view`: "A company always keeps the Users, Security roles and Audit log permissions, so it can manage its own people.";
- a limit that is not a whole number from 1 to 100,000: "Enter a whole number from 1 to 100,000.".

A limit for a company with no subscription row that is not deleted is 422 `rule_broken`, "This company has no plan, so it has no limits to change." (`ACCESS_NO_PLAN_MESSAGE`; it said "trial" before ADR 0053); no row is ever created.

A save is one control transaction that locks the company row first:
- **modules:** an override row only where the choice differs from the plan, `deleted_at` cleared; a stored override for a module set back to the plan is soft-deleted. Hidden modules and `platform` keep their rows;
- **ceiling:** only the rows whose `allowed` value changes;
- **limits:** the override columns of every subscription row that is not deleted, cancelled ones included, null where the row's plan already gives the number;
- **audit:** one `company.access_changed` row in `platform_audit_log` (actor, company, IP, user agent; `before` and `after` hold the changed modules, keys and limits, plus `overrideRows` and `limitRows` when rows were written), or none when nothing was written. Nothing goes to the company's own `audit_log`.

Guards read modules, the ceiling and limits on every request, so a change applies to the company's next request: 403 for a removed key, `module_not_enabled` for a module switched off, `seat_limit` on the next invitation. Reads are not audited.

**Platform audit (`GET /platform/audit`, ADR 0053).** Query, strict (an unknown or repeated parameter is 400 `invalid_request`):
- `companyId`: a UUID, "That company id is not valid.". No existence check, so a deleted company's history still lists;
- `action`: one of `company.access_changed`, `support.requested`, `support.approved`, `support.revoked`, `company.migration_failed`, `company.migration_recovered`, "Choose an action from the list.";
- `before`: the `id` of the last entry of the previous page; a UUID that names an existing entry, "That page of the audit log does not exist. Start from the newest entries.";
- `limit`: digits, 1 to 100, default 50, "Ask for 1 to 100 entries at a time.".

Order `at desc, id desc`; the cursor is compared in SQL as `(at, id)`, so entries of the same millisecond page correctly under any filter. `nextCursor` is the last entry's id while there are more, else null. Each `PlatformAuditView` is `{ id, at, action, company { id, name } | null, actor, targetType, targetId, details, network? }`:
- **`actor`** comes from the action, never from today's `platform_admins` rows: `{ kind: "platform_admin", userId, name }` ("Former admin" when the user row is gone) for the access save and the support request; `{ kind: "company_user" }`, with no id or name, for the Owner's approve and revoke; `{ kind: "system" }` for migrate.ts; `{ kind: "unknown" }` otherwise;
- **`details`** is a per-action allow-list in packages/shared (`platformAuditDetails`), deny by default: `access_changed` (the four lists, `userLimit` and `branchLimit` as `{ from, to }`, and `overrideRows` and `limitRows` as counts); `support_requested` (`reason`, `expiresAt`); `support_decided` (`decision`); `migration_failed` (`code` only, for every row, old ones included); `migration_recovered` (`version`); and `{ kind: "hidden" }` for anything that doesn't fit its shape exactly;
- **`network`** (`{ ip, userAgent }`) only for the owner role, and only on platform admins' own entries; the key is absent otherwise, and for the support role the columns are never selected;
- **the support role** gets another admin's `support.requested` entry with `details: { kind: "hidden" }`, its actor and company kept;
- `action`, `targetType` and `targetId` show only when they match their patterns (`targetId` a UUID), else `"unknown"` or null.

Migration text, other admins' reasons and company people's ids and names are narrowed out in SQL before the shared mapping checks every row again. Reading writes no audit row. There is no export.

**Support requests (ADR 0053).** The POST runs in one control transaction: it locks the admin's own `platform_admins` row (`FOR UPDATE`) and re-checks it (403 "Only platform admins can use this."), then checks the company (404), then refuses an open grant (pending or approved, unexpired) by the same admin for the same company with 409 `grant_open`, "You already have an open support request for this company.", then 10 requests by the admin in the last 24 hours, across companies and counting revoked, expired and deleted grants, with 429 `rate_limited`, "You can send at most 10 support requests in 24 hours. Try again later.". A refused request writes nothing and does not count. The body's messages are "Give a reason of 10 to 500 characters." and "Enter a whole number of hours from 1 to 72.". The status in both lists is derived, revoked first, then expired (`expiresAt` at or before now), approved and pending.

**Not on the API yet:** using a support grant, the company's own roles and users, plans, billing and company status actions (parts 2 and 4, ADR 0052). The import and database calls below stay on DemoStore; their /admin pages are not found in api mode.

## Inventory, part 1 (real build, P11, ADR 0035)

Every route needs the `core` module. Cost fields (`cost`, `costPerSqFt`) are stripped without `inventory.product.view_sensitive`. Switched-off features answer 404.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /products` | `inventory.product.view` | The catalog (`Product`) |
| `GET /rolls` | `inventory.roll.view` | Rolls and remnants with their cuts (`Roll`) |
| `GET /stock-movements` | `inventory.product.view` | The boxed-stock ledger (`StockMovement`) |
| `GET /locations` | Any company member | Warehouses and showrooms (`Location`). Shared reference data every module picks from, so `@AnyCompanyMember` here does not mean the person's own records |
| `GET /transfers` | `inventory.transfer.view` | Transfers with their lines, newest first |
| `POST /transfers` | `inventory.transfer.create` | `{ fromId, toId, lines: [{ productId, rollId, quantity }], note }`. 400 `invalid_transfer` (same warehouse, a showroom, more than on hand, a part carton, a roll elsewhere or already travelling) |
| `POST /transfers/:id/receive` | `inventory.transfer.receive` | 409 `already_received` |
| `PATCH /rolls/:id` | `inventory.roll.edit` | `{ bin }` only; any other field is 400 |
| `POST /stock/corrections` | `inventory.stock.correct` | `{ productId, rollId, locationId, counted, reason }`: an approved count adjustment. 400 `invalid_correction` |

## Purchasing, part 1 (real build, P11, ADR 0036)

Every route needs the `core` module. Line costs (`unitCost`) are stripped without `inventory.product.view_sensitive`. An order's `total` is left out unless the person holds that key or `purchasing.bill.view`.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /suppliers`, `GET /supplier-contacts` | `purchasing.supplier.view` | The directory |
| `POST /suppliers` | `purchasing.supplier.create` | `SupplierInput`; only a name is required |
| `PUT /suppliers/:id` | `purchasing.supplier.edit` | Missing fields keep their value |
| `POST /suppliers/:id/status` | `purchasing.supplier.edit` | `{ status }`. 409 `supplier_in_use` with an open order |
| `POST /supplier-contacts`, `PUT /supplier-contacts/:id` | create, edit | One primary per supplier |
| `POST /supplier-contacts/:id/status` | `purchasing.supplier.edit` | A leaving primary is replaced |
| `GET /purchase-orders` | `purchasing.order.view` | Orders with their lines, newest first |
| `POST /purchase-orders` | `purchasing.order.create` | `NewPurchaseOrderInput`; a draft, or ordered (emails the rep) |
| `POST /purchase-orders/:id/order` | `purchasing.order.create` | `{ via }`. 409 `not_draft` |
| `POST /purchase-orders/:id/cancel` | `purchasing.order.create` | `{ reason }`. 409 `has_receipts`, `already_cancelled` |
| `GET /receipts` | `purchasing.order.view` | Goods receipts with their lines |
| `POST /purchase-orders/:id/receipts` | `purchasing.order.receive` | `ReceiptInput`: stock movements and rolls come in. 400 when more than is still due, a showroom, or a roll number already in stock |

## Sales, part 1 (real build, P11, ADR 0037)

Every route needs the `core` module and reads through data scope (own, branch, all); anything outside it answers 404. Line costs are stripped without `inventory.product.view_sensitive`, credit limits without `customers.customer.view_sensitive`.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /customers` | `customers.customer.view` | Customers within scope, with addresses and certificate |
| `POST /customers` | `customers.customer.create` | `{ name, phone?, email?, type? }` |
| `PUT /customers/:id` | `customers.customer.edit` | Name, contact, terms and addresses; credit, exemption and rep are never taken from the request |
| `GET /quotes` | `sales.quote.view` | Quotes within scope, with rooms and lines |
| `POST /quotes`, `PUT /quotes/:id` | `sales.quote.create`, `sales.quote.edit` | The server computes the total with the tax engine. 403 for a waste change without `sales.waste.view` or a tax change without `sales.tax.override`. 409 `quote_closed`, `settings_missing` |
| `POST /quotes/:id/status` | `sales.quote.edit` | `{ action: send, accept or decline, expiresAt? }`. 409 `quote_state` |

## Sales, part 2: invoices and payments (real build, P11, ADR 0038)

Each answers 404 when `sales.invoices` (reads, conversion, sent, void, credit notes) or `sales.payments` (payments, write-off, credit, refunds) is off. Records outside the person's data scope answer 404. Invoice `cost` and line `unitCost` are stripped without `inventory.product.view_sensitive`. Proof files are `{ name, data }` with `data` in base64, 1 to 3 files of at most 5 MB, checked by their first bytes. Each route that records money or an invoice posts its journal entry in the same transaction, and answers 409 `period_closed` when its date is in a closed period (ADR 0039).

| Route | Needs | Does |
| --- | --- | --- |
| `GET /invoices` | `sales.invoice.view` | Invoices and credit notes within scope, with lines and commission split |
| `GET /payments` | `sales.payment.view` or `sales.payment.approve` | Payments on invoices within scope, with their files |
| `GET /invoice-adjustments` | `sales.invoice.view` | Write-offs and credit applied, within scope |
| `GET /refunds` | `sales.payment.view` or `sales.payment.refund` | Refunds to customers within scope |
| `GET /reservations` | `inventory.product.view`, `inventory.roll.view` or `sales.invoice.view` | Every hold for stock viewers; otherwise the holds of invoices within scope |
| `POST /quotes/:id/invoice` | `sales.invoice.create` | Converts an accepted quote once: server totals, invoice number, stock holds. 409 `conflict` when already invoiced, `settings_missing` |
| `POST /invoices/:id/sent` | `sales.invoice.edit` or `sales.invoice.create` | Marks it sent once and emails `invoice.sent` |
| `POST /invoices/:id/void` | `sales.invoice.void` | `{ reason }`; refused once money is confirmed or a credit note's credit is spent; voids pending payments and releases holds |
| `POST /invoices/:id/credit-notes` | `sales.invoice.void` | `{ subtotal, reason }`; up to what is not yet credited; tax and cost in proportion |
| `POST /invoices/:id/write-off` | `sales.payment.write_off` | `{ reason }`; the whole balance, up to the write-off maximum |
| `POST /invoices/:id/apply-credit` | `sales.payment.apply_credit` | The customer's credit, up to the balance |
| `POST /payments` | `sales.payment.record` | `RecordPaymentInput` plus `files`. 409 `duplicate_reference` unless `allowDuplicateReference`; 409 `settings_missing` without Settings → Payments |
| `POST /payments/:id/review` | `sales.payment.approve` | `{ action: confirm }` or `{ action: reject, reason }`; never by the recorder (403) |
| `POST /payments/:id/void` | `sales.payment.void` | `{ reason }`; refused when its overpayment was already spent as credit |
| `POST /payments/:id/files` | `sales.payment.record` | `{ files }`; up to 3 in all, not on voided or rejected payments |
| `POST /refunds` | `sales.payment.refund` | `RefundInput` plus `files`; at most the customer's credit |
| `GET /files/:id` | `sales.payment.view`, `sales.payment.approve` (payment proof) or `sales.payment.refund` (refund proof) | A proof file within scope, `inline`, `nosniff`, not cached |

## Ledger (real build, P12 part 1, ADR 0039)

Entries are posted by the modules, never through a route. Money is decimal strings.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /ledger/trial-balance?through=` | `reports.financial.view`, data scope `all` | Every account's debits, credits and balance through a day (all time without one), the totals, and `balanced` |
| `GET /ledger/period-close` | `reports.financial.view` or `settings.company.manage`, data scope `all` | `{ closedThrough }`, the last closed day or null |
| `POST /ledger/period-close` | `settings.company.manage` | `{ through, note }`: closes the books through that day, or reopens to an earlier one. Audited |
| `GET /settings/accounting` | `settings.payments.manage`, data scope `all` | `AccountingSettings`: `{ costingMethod, salesTaxBasis, bankAccounts: [{ key, name, methods }] }`, or the defaults (ADR 0040) |
| `PUT /settings/accounting` | `settings.payments.manage`, data scope `all` | Saves the settings. A new bank account has no `key` and gets one; each method may go to only one bank account. Removing a bank account with entries is 409 `bank_account_in_use`. Audited |

Cash lines post to the bank account for the payment's method, or to Cash and Bank when no bank account claims it. A void credits the account the payment first posted to (ADR 0040).

## Expenses (real build, P12 part 2, ADR 0041)

Behind the `finance.expenses` switch. Money is decimal strings; receipts are base64 in the body, as payment proof (ADR 0038).

| Route | Needs | Does |
| --- | --- | --- |
| `GET /expenses` | `finance.expense.view` | `Expense[]` within data scope: own by recorder, branch by the location's branch; company-wide ones need scope `all` or being the recorder |
| `GET /recurring-expenses` | `finance.expense.view` | `RecurringExpense[]`: all with scope `all`, otherwise those at a location in the reader's branch |
| `POST /expenses` | `finance.expense.create` | `{ date, supplierId, category, locationId, amount, tax, paymentMethod, reference, note, settlement, asDraft, files }`. A draft needs a date and an amount; recording needs a vendor, an amount above zero and a receipt, then confirms (and posts) or waits for approval. No future dates; payroll is refused. Branch scope writes only at a location in its own branch, and a company-wide expense needs scope `all` (403). Audited |
| `PUT /expenses/:id` | `finance.expense.create` | The same body: saves or finishes a draft. A recorded expense is 400. Audited |
| `POST /expenses/:id/review` | `finance.expense.approve` | `{ action: "approve" }` confirms and posts; `{ action: "reject", reason }` returns it to draft. Never the recorder. Audited |
| `POST /expenses/:id/void` | `finance.expense.void` | `{ reason }`: voids a pending or confirmed expense; a confirmed one posts its reversal on the void day; a pay-later one retires its bill, refused while a supplier payment is allocated to it. Audited |
| `POST /recurring-expenses`, `PUT /recurring-expenses/:id` | `finance.expense.create`, data scope `all` | Saves a template (day of month 1 to 31) and raises the drafts it owes. Audited |
| `GET /files/:id` | as for payments, or `finance.expense.view` | An expense receipt, within the expense's data scope |

A daily job raises recurring drafts for every company in its own day. Payroll months are hidden from anyone without `hr.payroll.view`.

## Bills and supplier payments (real build, P12 part 3, ADR 0042)

Behind the `purchasing.orders` switch. No data scope. Files are base64 in the body.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /bills` | `purchasing.bill.view` | `Bill[]`: order, pay-later and (later) subcontract bills |
| `GET /supplier-payments` | `purchasing.bill.view` or a payment key | `SupplierPayment[]` with allocations |
| `POST /purchase-orders/:id/bills` | `purchasing.bill.create` | `{ number, issuedAt, total, files }`: bills every unbilled receipt of the order, stores match issues, posts. Audited |
| `POST /supplier-payments` | `purchasing.payment.record` | `{ supplierId, amount, date, method, reference, note, billIds?, files }`: oldest due first, never more than unpaid; waits above the payment approval rule; posts when confirmed. Audited |
| `POST /supplier-payments/:id/review` | `purchasing.payment.approve` | `{ action: "confirm" }` or `{ action: "reject", reason }`; never the recorder. Audited |
| `POST /supplier-payments/:id/void` | `purchasing.payment.void` | `{ reason }`: a confirmed one posts its reversal. Audited |

Goods receipts post their received value (Inventory against Goods Received Not Billed) and move boxed goods to the moving average cost; stock count corrections post at cost.

## Contracts, part 1 (real build, ADR 0044)

Module `contracts`. Every route needs `contracts.register`; billings also `contracts.billing`, waivers and insurance also `contracts.compliance` (404 when off). Data scope `byRep`: own by rep, branch by the contract's branch; lines, change orders, billings, waivers and certificates follow their contract, and a write outside scope is 404. `estimatedCost` is stripped without `contracts.contract.view_sensitive`. Money is decimal strings.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /contracts`, `GET /contract-lines`, `GET /change-orders` | `contracts.contract.view` | `Contract[]` (with files and signature), `ContractLine[]`, `ChangeOrder[]` with their rows |
| `GET /contract-billings` | `contracts.billing.view` | `ContractBilling[]` with lines and releases. Writes are in part 2 below |
| `GET /lien-waivers`, `GET /insurance-certificates` | `contracts.compliance.view` | `LienWaiver[]`, `InsuranceCertificate[]` with coverages |
| `POST /contracts` | `contracts.contract.create` | `{ direction, kind, customerId, supplierId, title, scope, branchId?, locationId, jobSite, startsAt, endsAt, renewal, retainagePct, storedRetainagePct, bondInLieu, taxTreatment, notes, lines }`: a draft `CTR-`. Rep is the creator, branch the creator's (`branchId` only for someone with no branch and scope `all`). A master stores no value, retainage or lines. Audited |
| `PUT /contracts/:id` | `contracts.contract.edit` | The same body: edits a draft and replaces its lines; rep and branch stay. A line's `estimatedCost` left out (or sent without view_sensitive) keeps the stored one by code. Audited |
| `POST /contracts/:id/send`, `/recall` | `contracts.contract.edit` | Draft to sent (`draftProblem`; emails `contract.signature`), sent to draft. Audited |
| `POST /contracts/:id/sign` | `contracts.contract.approve` | `{ signerName, signerRole }`: simulated signature, sent to active; name of 3 or more characters. Audited |
| `POST /contracts/:id/complete` | `contracts.contract.edit` | Active project to completed. Audited |
| `POST /contracts/:id/close` | `contracts.contract.edit` | `{ overrideReason }`: completed to closed when nothing is held, its invoices and bills are paid and a final waiver is received; overriding a failed check needs `contracts.contract.approve` (403) and a reason. Audited |
| `POST /contracts/:id/terminate` | `contracts.contract.approve` | `{ reason }`: active or completed to terminated. Audited |
| `POST /contracts/:id/renew` | `contracts.contract.create` | A new draft for the next term, linked by `renewedFromId`. Audited |
| `POST /contracts/:id/files` | `contracts.contract.edit` | `{ files }` base64, at most 3 per contract. Read through `GET /files/:id` with `contracts.contract.view` in scope. Audited |
| `POST /contracts/:id/change-orders` | `contracts.change_order.create` | `{ reason, lines: [{ contractLineId, description, category, amountDelta }] }`: `CO-n`, pending, on an active or completed project. Audited |
| `POST /change-orders/:id/decision` | `contracts.change_order.approve` | `{ action: "approve" \| "reject", reason }`: approval runs `changeOrderProblem` (rows on one line added together; a new line above zero) and changes line values or adds lines at once; rejection needs a reason. Change-order routes also need the `contracts.billing` switch. Audited |
| `POST /contracts/:id/lien-waivers` | `contracts.compliance.manage` | `{ type, paymentId, supplierPaymentId, amount, throughDate, statutoryForm }` on a project; unconditional needs a confirmed payment of the contract's party. Audited |
| `PUT /contracts/:id/insurance-certificate` | `contracts.compliance.manage` | `{ producer, holder, additionalInsured, coverages }` on a subcontract; replaces the one certificate. Audited |

## Contracts, part 2: billings (real build, ADR 0045)

Module `contracts`, switches `contracts.register` and `contracts.billing` (404 when off). The contract's data scope applies; outside it is 404. Each billing raises one invoice (customer contract) or one bill (subcontract) and posts `contract_billing.posted` through LedgerService in the same transaction. Responses are `ContractBilling`; estimated costs never appear.

| Route | Needs | Does |
| --- | --- | --- |
| `POST /contracts/:id/billings` | `contracts.billing.create` | `{ periodEnd, lines: [{ contractLineId, completedToDate, storedBalance }] }`: an active or completed project; rates come from the line or contract on the server; `billingProblem` must pass and the gross may not be below zero. Raises and posts the invoice (taxed for the job site; `milestone.invoiced` emailed) or the bill `<contract>-<n>`. Audited |
| `POST /contracts/:id/retainage-releases` | `contracts.billing.create` | `{ amount }`: above zero, up to what is held; shared over the lines; its own invoice or bill. Audited |
| `POST /contract-billings/:id/void` | `contracts.billing.void` | `{ reason }`: only the contract's latest posted billing, not on a closed contract; refused while its invoice has a confirmed payment, credit, a write-off or a live credit note, or a pending or confirmed supplier payment is allocated to its bill. Voids the invoice (and its pending payments) or soft-deletes the bill, and reverses the entry on the void day. Audited |

`POST /invoices/:id/void` and `POST /invoices/:id/credit-notes` refuse a contract billing invoice.

## HR, part 1: people, timesheets and time off (real build, ADR 0046)

Module `hr`, so the same routes serve Flooring Suite companies with HR and HR Suite companies. Switches: People `hr.employees`, Timesheets `hr.timesheets`, the clock `hr.clock`, Time off `hr.time-off`, policy writes `settings.hr` (404 when off). Data scope `ownOrReports`: own employee, plus direct reports at branch scope, everyone at `all`; a write outside it is 404. `payRate` is stripped without `hr.employee.view_sensitive`. Hours are decimal strings everywhere, a timesheet's `days` too: seven strings such as `"7.5"`, at most two decimals (`TimesheetWire`; a JSON number is refused). "One's own" in the refusals below is the employee linked to the sign-in or any employee whose email is the session's verified email. Bodies are strict: unknown fields are refused.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /employees` | any of `hr.employee.view`, `hr.timesheet.view`, `hr.pto.view`, `settings.hr.manage` | `Employee[]` with documents and checklists. Without `hr.employee.view`: only people in scope, with contact, birthday, documents and checklists blank except one's own |
| `POST /employees`, `PUT /employees/:id` | `hr.employee.create`, `hr.employee.edit` | `{ name, title, department, workerType, payType, payRate?, state, email, phone, hiredAt, status, managerId, flsaStatus, exemptionBasis, salaryHoursPerWeek, commissionVisible, homeLocationId, emergencyContact, userId? }`: hr.md rule 2 applied; `payRate`, `payType` and `salaryHoursPerWeek` taken only with view_sensitive, else the stored ones stay; nobody changes the rate, pay type, worker type, FLSA status or salaried hours on their own record; `userId` links a member's sign-in (null unlinks; never one's own); only the Owner changes the link of someone with a commission assignment, an approved or paid statement, or a record that manages someone on an override plan (ADR 0048). A new person gets the onboarding checklist. Setting or changing `managerId` adds a row to the dated manager history, effective from the company's day (never back-dated; ADR 0048). Audited |
| `POST /employees/:id/checklist/:itemId` | `hr.employee.edit` | `{ list, done }`. Audited |
| `POST /employees/:id/offboarding` | `hr.employee.edit` | Status `terminated` and the offboarding checklist; nothing when it exists. Audited |
| `POST /employees/:id/documents` | `hr.employee.edit` | `{ files }` base64, at most 3 per upload. Read through `GET /files/:id` with `hr.employee.view`, or with `hr.portal.view` for one's own (ADR 0049). Audited |
| `GET /timesheets` | `hr.timesheet.view` | `TimesheetWire[]` in scope (`days` as decimal strings) |
| `GET /clock-entries` | `hr.timesheet.view` | `ClockEntry[]`: own below scope `all` |
| `PUT /timesheets` | `hr.timesheet.edit` (own) or `hr.timesheet.approve` | `{ employeeId, weekStart, days }`: a workweek start not in the future, valid hours, someone who uses timesheets; refused when the week is submitted or approved. Audited |
| `POST /timesheets/:id/submit` | `hr.timesheet.edit` (own) or `hr.timesheet.approve` | Draft or sent back to submitted; tells the approvers whose access and scope cover the person, in the app. Audited |
| `POST /timesheets/decisions` | `hr.timesheet.approve` | `{ action: "approve" \| "reject", ids, reason? }`: all or none, submitted only, never one's own; a rejection needs a reason. Emails the employee. Audited with the overtime split |
| `POST /timesheets/:id/reopen` | `hr.timesheet.approve` | `{ reason }`: approved to draft unless an approved or exported pay period overlaps; never one's own. Audited |
| `POST /timesheets/upload` | `hr.timesheet.edit` (`own: true`) or `hr.timesheet.approve` | `{ table, fileName, apply, own }`: `{ rows, counts }`; saves with `apply`. Rows follow the `PUT` rules (refused for a submitted, approved or future week, someone who does not use timesheets, or bad hours); one's own rows need `hr.timesheet.edit` (400 otherwise). Audited |
| `POST /clock/in`, `POST /clock/out` | `hr.portal.view` | Both need the company's clock setting and the `hr.clock` and `hr.portal` switches (ADR 0049). The signed-in person's punch; clock-out always closes it and adds the hours to that week's draft, except into an approved or exported pay period or past 24 hours on the day, when the hours are not added and the answer's `note` says to ask HR. Audited |
| `GET /time-off-policies` | any of `hr.pto.view`, `hr.employee.view`, `settings.hr.manage` | `TimeOffPolicy[]` |
| `GET /time-off-entries`, `GET /pto-requests` | `hr.pto.view` | `TimeOffEntry[]`, `PtoRequest[]` in scope |
| `POST /pto-requests` | `hr.pto.request` (own) or `hr.pto.approve` | `{ employeeId, policyId, start, end, hours, note }`: `timeOffRequestProblem` must pass; pending; tells the approvers whose access and scope cover the person. Audited |
| `POST /pto-requests/:id/decision` | `hr.pto.approve` | `{ action: "approve" \| "deny", reason? }`: pending only, never one's own; approval posts a `used` line. Emails the employee. Audited |
| `POST /pto-requests/:id/cancel` | `hr.pto.request` (own) or `hr.pto.approve` | Pending or approved and not started; an approved one posts an `adjustment` back. Audited |
| `POST /time-off-adjustments` | `hr.pto.approve` | `{ employeeId, policyId, hours, note }`: signed hours, a reason, never one's own balance. Audited |
| `POST /time-off-policies`, `PUT /time-off-policies/:id` | `settings.hr.manage` | A policy without `id`; the California carryover guard applies. Audited as settings |

Hours and the clock need the company's Settings → HR and payroll rule; without them they answer 409 `settings_missing`.

HR part 2 first steps (ADR 0047): `PUT /timesheets`, `POST /timesheets/:id/submit`, the upload and `POST /pto-requests` for someone else also need a sign-in linked to a live employee unless it is the Owner's; nobody but the Owner decides a sheet they saved, uploaded or submitted (each history step carries `byUserId`; `"saved"` is a new history action) or a request they made for someone else; time off whose days overlap an approved or exported pay period can't be requested, approved or (once approved) cancelled; a clock-out into a submitted or approved week closes the punch, adds no hours and answers with a `note`; the `Saved timesheet hours` audit entry keeps the replaced days as `before`.

## HR, part 2: pay periods, bonuses and contractor payments (real build, ADR 0047)

Module `hr`, switch `hr.pay-periods` (404 when off), and data scope `all` only: payroll is company-wide, so anyone else gets 403 `forbidden` whatever their keys. Money is decimal strings. `baseRate`, `regularRate`, `salaryAmount` and `payRate` are stripped without `hr.employee.view_sensitive`; gross pay and the other line amounts need the route's `hr.payroll.view`. Audit entries carry no amounts. Payroll writes about people (exclusions, approve, reopen, bonuses, contractor payments) need a sign-in linked to a live employee unless it is the Owner's, and never touch one's own employee (by link or verified email). Bodies are strict.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /pay-periods` | `hr.payroll.view` | `PayPeriod[]`, newest first, with `excluded` and the frozen `lines` once approved |
| `POST /pay-periods` | `hr.payroll.view` | `{ date? }` (today by default, never later): opens the period holding that day on the pay schedule from Settings → HR (`periodFor`), pay date five days after its end; returns the existing one when it is open already (201 either way). 409 `settings_missing` without a pay frequency. An earlier period than today's needs `hr.payroll.approve` (403 otherwise); 400 when the new period would overlap a live one. The web client calls it with no date before listing, as the demo's `ensureCurrentPeriod`. Audited when it opens one. A write under the read key on purpose, limited to today's period (ADR 0047, residual risks) |
| `GET /pay-periods/:id/review` | `hr.payroll.view` | `{ period, rows: { line, employee, excludedReason }[], blockers, strandedCommission: { statementId, userId, name, month, reason }[], contractors, contractorNames, warnings: string[] }`: the frozen lines once approved, else every payable person's line worked out now (`grossPay`, with the commission of approved, unpaid statements, ADR 0048) and the weeks that block approval; before approval, `strandedCommission` lists approved, unpaid statements with something to pay that no run will pay, judged on the employee the statement pays (stored at approval, else the rep's link today): there is none, its record was removed, it is a 1099 contractor, or they have left (no amounts; `reason` is a sentence saying which). `employee` carries work facts and the email only. `warnings` holds the California pay rules note: pending payroll review while `hr.payroll.california` is on and California plays a part, or off with California staff (ADR 0050) |
| `POST /pay-periods/:id/exclusions` | `hr.payroll.approve` | `{ employeeId, reason }`: leaves someone in the run out with a reason (3 characters), or brings them back with `reason: null`; not on an approved or exported run; the run becomes `in_review`. Audited (`Left out of pay period`, `Brought back into pay period`) |
| `POST /pay-periods/:id/approve` | `hr.payroll.approve` | Ended, no other approved or exported run over any of its days, a pay frequency the staff allow (monthly is refused with California non-exempt staff), no blockers, nobody's gross pay below the commission it pays. Unless the Owner: not a run with a line for the approver, nor one where they left someone out, brought someone back or added a bonus, nor one paying someone they added or whose pay facts they changed since that person was last paid in an approved run, nor any run after they added a time-off policy or changed whether one is paid or its kind since the latest approval by someone else. Approvals and reopens are serialised company-wide; `approved_at` and audit times come from the database clock. Freezes the lines, links the approved commission statements it pays, posts time-off accrual (rule 12) and the payroll entry: debit Wages per home location for gross pay less commission (already accrued at statement approval), credit Accrued Payroll, dated the period's end (409 `period_closed` when the books are closed). Audited with the number of people |
| `POST /pay-periods/:id/reopen` | `hr.payroll.approve` | Approved only (an exported run is 400; so is one that pays something but has no entry, approved before the books started): reverses the payroll entry on today's date, posts negative accrual lines that take back what the run accrued, retires the frozen lines and releases its commission statements to wait for the next run; back to `in_review`. Audited |
| `POST /pay-periods/:id/export` | `hr.payroll.export` | Approved to `exported`, which locks it and marks its commission statements `paid`; exporting again changes nothing. The CSV files are built by the screen from the review. Audited |
| `GET /bonuses` | `hr.payroll.view` | `Bonus[]` (live) |
| `POST /bonuses` | `hr.payroll.approve` | `{ employeeId, amount, kind, periodStart, periodEnd, reason }`: for a W-2 person who has not left, never one's own, not into an approved or exported run; the adder is `approvedBy`. Paid as wages through the run where `periodEnd` falls. Audited without the amount |
| `POST /bonuses/:id/void` | `hr.payroll.approve` | `{ reason }`: retires a bonus whose run is not approved. Audited |
| `GET /contractor-payments` | `hr.payroll.view` | `ContractorPayment[]` (live) |
| `POST /contractor-payments` | `hr.payroll.approve` | `{ employeeId, date, description, amount }`: a 1099 contractor, not dated in the future, never one's own; status `approved`; posts nothing yet. Audited without the amount |
| `POST /contractor-payments/:id/pay` | `hr.payroll.export` | `{ method }` (`cash`, `check`, `ach`, `card`, `other`): approved to `paid` today, not by whoever recorded it unless the Owner; posts debit Contract Labor (6050), credit the method's bank account (`cashAccountFor`). Audited with the method |
| `POST /contractor-payments/:id/void` | `hr.payroll.approve` | `{ reason }`: retires it; a paid one is reversed on the void day, and one paid before the books started (no entry) is refused. Audited |

## Commissions (real build, ADR 0048)

Module `hr` with switch `hr.commissions`, for a Flooring Suite company (no `core` module: 404), and data scope `all` only (403 otherwise): commission is pay; a rep reads their own statements in the portal. Money is decimal strings; months are `yyyy-MM`. Every write takes the company-wide payroll lock, needs a sign-in linked to a live employee unless it is the Owner's, and never touches one's own statement, plan or assignment (by user or by the linked or verified-email employee), the Owner included. Audit entries carry no amounts. Bodies are strict.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /commissions` | `hr.commission.view` | `{ statements: CommissionStatementRow[], plans, assignments, people: { id, name, active }[], invoices: { id, number, salesRepId, isReturn, voidedAt }[] }`: everyone's statements for the last twelve months worked out by the shared engine (`commissionStatementRows`); an approved or paid statement shows the payable its approval posted. An override line goes to the rep's manager on the company's day its payment or applied credit was confirmed, from the dated manager history (owner decision 2026-11-15, ADR 0048). Each line carries the `basis` that produced its base (on a split sale, the first member's plan); a line whose basis is `gross_margin` has `base` `null` without `sales.margin.view_sensitive`. No invoice amounts or cost |
| `POST /commission-statements/approve` | `hr.commission.approve` | `{ userId, month }`: an ended, open month with no reversal waiting for review, every earlier month with commission approved first; not one's own (the Owner included); unless the Owner, not one the approver adjusted, decided a reversal on, set the assignment or plan of (created or audited), or set the commission split of a sale in (a live split row or a "Changed commission split" entry), or set the manager of the person or of anyone whose override is on it. Nobody, the Owner included, approves one carrying an override earned while the manager its own person set was in force (the subject's history row on the line's day), until someone else sets that same manager again. A payable above zero needs the rep linked to a W-2 employee. Stores the statement `approved`, with the employee the rep is linked to then as the one it pays (not in the response), and posts debit Commissions (6060) at the rep's home location, credit Accrued Payroll, dated the month's end (409 `period_closed` when closed). Emails `commission.ready` (restricted, no amounts) after commit. Audited. Returns `CommissionStatement` |
| `POST /commission-adjustments` | `hr.commission.adjust` | `{ userId, month, amount, invoiceId, reason }`: `adjustmentProblem` (dollars and cents, up to twelve digits, at most 1,000,000.00 either way); one of the last twelve months, after the person's last approved one; a deduction names a live invoice they sold (as rep or in its split). Posts nothing: it nets into the statement. Audited as an addition or deduction |
| `POST /commission-reversals/decide` | `hr.commission.approve` | `{ userId, month, lineId, outcome: "applied" | "waived", reason }`: the line must be a reversal waiting for review on that statement; month open as for adjustments. Recorded as a 0.00 adjustment with `decides`. Audited |
| `POST /commission-plans` | `hr.commission.manage` | `{ name, basis, baseRatePct, monthlyTarget, tierMode, tiers, overridePct, draw, clawbackDays }` (`commissionPlanProblem`): version 1, active, from today. Name and version unique. Audited |
| `PUT /commission-plans/:id` | `hr.commission.manage` | Same body. An active plan only, not one the saver is on, nor one paying (or about to pay) an override while one of its people had the saver as manager on any day from the first of the oldest of the last twelve months through today. Edited in place while no approved or paid statement exists from its start; otherwise version + 1 from today, the old one retired yesterday and its people moved over unsigned. Audited (`Edited commission plan` or `Published new version of commission plan`, plus `Moved commission assignment to new plan version` per assignment ended, moved or created) |
| `POST /commission-assignments` | `hr.commission.manage` | `{ userId, planId, effectiveFrom, monthlyTargetOverride? }`: a member who is not disabled, never oneself, nor anyone the assigner managed on any day from the first of the oldest of the last twelve months through today, on a plan that pays an override; an active plan already in force that day; after the end of the person's last approved month. Ends a running assignment the day before and replaces one starting on or after it. Unsigned. Audited |
| `GET /commission-totals?from&to` | `sales.commission.view` | Module `core`, and 404 without the `hr` module; switches `sales.team` and `hr.commissions` (404 when either is off). `[userId, { earned, paid, pending }][]` for lines confirmed in the range (`commissionTotals`); data scope `all` sees everyone, anyone else themselves (all their lines) and the reps on invoices their scope covers (only those invoices' lines) |

Audit entries with plan terms or an adjustment or decision reason (`Added commission plan`, `Edited commission plan`, `Adjusted commission statement`, `Accepted commission reversal`, `Waived commission reversal`), like the bonus and exclusion entries of pay periods, show their before and after in `GET /audit` only to the Owner and to holders of `hr.employee.view_sensitive` whose data scope covers the person the entry is about; plan terms need data scope `all`. Everyone else reads `"Hidden: pay details"` (owner decisions 2026-11-14 and 2026-11-15, ADR 0048 "Audit visibility").

A statement is paid through a pay run (`POST /pay-periods/:id/approve`, then `/export`): the run pays each approved statement's posted amount to the employee stored on it at approval (else, for a statement stored without one, the rep's link today), so a later re-link never moves it, and debits Wages only for the rest of the gross, so the commission is expensed once.

## Employee portal (real build, ADR 0049)

Module `hr`, switch `hr.portal` (404 when off), key `hr.portal.view`. Every route acts on the signed-in person: the user from the verified session and the employee linked to their sign-in (`user_profiles.employee_id`). No route takes a person, employee, user or company id. Money and hours are decimal strings. Bodies are strict.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /me/portal` | `hr.portal.view` | `MyPortal` for the signed-in person only (employee-portal.md rules 1 to 11, `portalVisibility`). Narrowed on the server: `visible.pay` needs `hr.pay-periods`; `visible.commission` needs `hr.commissions` and the `core` module; `visible.rates` is the company setting, for a linked person (owner decision 2026-11-14, ADR 0049); `visible.teamCalendar` needs `hr.time-off` and a linked employee; `visible.clock` needs `hr.clock`, `hr.timesheets`, the company's clock setting and a designated workweek. `employee` is one's own record, never with `payRate`; `ownPayRate` is one's own rate when `visible.rates`, otherwise null (the sensitive-fields strip still applies to every other rate field, pay lines included). `timesheets` (`TimesheetWire`) and `requests` and `balances` for W-2 people only; `balances` `hours` and `pending` as fixed three-place strings. `pay`: approved or exported runs with one's own stored line, newest first, each `period` with `lines` and `excluded` empty, the line through `ownPayLine` (hidden commission and its true-up leave the total, and `weeks` is empty); rate fields stripped without view_sensitive. `statements`, `assignment` and `plan` only when commission is shown (otherwise empty and null), the margin base hidden without `sales.margin.view_sensitive`. `contractorPayments`: one's own, for a 1099 worker. `teamOut`: for a linked W-2 person, approved requests ending at most 92 days ago or later, of colleagues who have not left, with `kind` `vacation` and `policyId`, `hours`, `note`, `decidedBy`, `decidedAt` and `decisionReason` blank; `teamNames` only the people in it. An unlinked person gets an empty overview |
| `PATCH /me/employee` | `hr.portal.view` | `{ phone, emergencyContact }` (`MyProfilePatch`): nothing else, on the employee linked to one's sign-in (400 when unlinked); trimmed; returns the record as `GET /me/portal` shows it. Audited as `Updated own profile` with the phone before and after and only whether the emergency contact changed; a save that changes nothing writes nothing |
| `POST /commission-assignments/:id/acknowledge` | `hr.portal.view` | `{ signedName, planId, planVersion, planUpdatedAt }` (strict; the plan as `GET /me/portal` showed it, `planUpdatedAt` its `updatedAt`): switch `hr.commissions` and the `core` module (404 otherwise). Under the payroll lock: the assignment must be the signed-in user's (404 otherwise), running, unsigned, and shown on My commission; the three plan fields must be the assignment's current plan as it stands (409 `plan_changed` otherwise); the name must be the account's, ignoring case and surrounding spaces. Audited as `Signed commission plan` with `planId` and `planVersion`, no amounts. `{ ok: true }` |

`GET /files/:id` also opens, with `hr.portal.view` and the `hr.portal` switch, the documents of the employee linked to the reader's own sign-in, and no one else's. The clock routes are under "HR, part 1". My meetings has its route, `GET /me/meetings`, under "Meetings (real build, ADR 0051)"; My meetings reads it in api mode (`myMeetings`, ADR 0051 part 3).

## Meetings (real build, ADR 0051)

Parts 1 to 3. These routes are in module `meetings` (403 `module_not_enabled` without it), in both products, and every one answers 404 when `meetings.calendar` is off.

- **Ids:** `:id` and `:attendeeId` are UUIDs. `:attendeeId` is the guest's `Attendee.id`: a linked guest's record id (the user id for staff), or an email guest's own row id. It is looked up only inside its own meeting.
- **Times** on the wire are the meeting's local `YYYY-MM-DDTHH:mm` (meetings.md). They are stored as instants in the company's zone, `tenants.time_zone`. Creating a meeting or a request in a company whose zone is not one of the seven US zones the calendar file knows answers 409 `time_zone_unsupported`.
- **Bodies** are strict. A rule's refusal is 400 `invalid_request` with the rule's own words.
- **Start bound** (review round 1 of PR #35): a start the caller sends (`POST /meetings`, a changed start in `PATCH /meetings/:id`, `POST /meeting-requests`, a proposal in `POST /meetings/:id/response`, an accepted proposal and a move's `start`) must lie from 366 days before the company's today to 1096 days after it, by local date. Otherwise 400 "Choose a start from one year ago up to three years ahead.", and nothing is written. A start the server derives, such as a series shifted by an `all` move, is not bounded.
- **Writes:** a change to an existing meeting locks it first. In the write's own transaction it works out what it will send from the state it commits, checks the daily email limits and writes its audit entry, whose `after.sends` holds `{ outside, total }`, the emails it sends. Invites, notices and the reminder are written after the commit; nothing after the commit can fail the request, and the reply is the meeting as the write committed it.
- **Daily email limits:** at most 200 emails to people outside the company (customers, suppliers, their people and email guests) and 500 meeting emails in all, per person per company day, every send counted, repeats included. They are counted from the person's meetings audit entries under a per-person lock, so actions sent at once count each other. An action over a limit is refused with 400 and writes nothing; one that sends nothing is never refused. A move, an undo and a decision count every email they send, re-sent occurrences and the CANCELs of a removed split included (part 2).
- **Every `Meeting` returned is shaped for the reader** (`meetingForViewer`):
  - the organiser, and anyone who may change the meeting, get every guest with their address;
  - anyone else gets only their own address, with an email guest named by an address read as "Email guest". With a hidden guest list they get only their own row;
  - other guests' notes and proposals go to the organiser only;
  - a customer, supplier or contact the reader can't read shows to every reader as "Customer", "Supplier", "Customer contact" or "Supplier contact", with no address.

"May change it" (`canChangeMeeting`) means holding `meetings.meeting.edit`, seeing the meeting, being able to read every customer, supplier and contact on it (the organiser included), and being its organiser or holding a scope wider than own on a meeting that is not private. A change emails every guest with the changer as the Outbox actor, and `GET /outbox` shows its actor the row whole, so someone who reads a guest only as "Customer" can't change the meeting. Otherwise the answer is 403: "Only someone who can see every guest on this meeting can change it." when that sight is all that is missing, and "Only the organiser can change this meeting." otherwise; 404 for someone who can't see the meeting.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /meetings` | `meetings.meeting.view` | `Meeting[]`: the meetings the reader may see (`seesMeeting`). The organiser and staff guests always see one. Nobody else sees a private meeting, the Owner included. Own scope sees only meetings it is on; branch and all scope see every other one. Cancelled meetings are left out. No date window |
| `GET /meeting-guests` | `meetings.meeting.create`; switch `meetings.invites` | `GuestOption[]` (`{ kind, id, name, email }`). Active colleagues by name, with `email` empty, never the caller. With the `core` module, `customers.customer.view` and `sales.customers`: the customers in the reader's data scope and their contacts. With the `core` module, `purchasing.supplier.view` and `purchasing.suppliers`: suppliers and their contacts |
| `GET /me/meetings` | `hr.portal.view`; switch `hr.portal` | `MyMeetings` `{ viewerUserId, meetings: [{ meeting, next: { start, durationMin, planned } }], colleagues: [{ id, name }] }`. `meetings`: the meetings the caller organises or is a staff guest on, not cancelled, each with its next occurrence on or after today in its zone, up to 366 days ahead, soonest first. `colleagues`: active members who hold `meetings.meeting.view`, never the caller; empty unless the caller holds `meetings.meeting.create` and `meetings.requests` and `meetings.invites` are on |
| `POST /meetings` | `meetings.meeting.create` | `MeetingInput` `{ title, start, durationMin, location, guests, newGuests, recurrence, reminderMin, notes, private, hideGuestList, allowProposals? }`. **Ignored:** everything of a guest but `kind` and `id`, a new guest's `customerId`, and `allowProposals`. **Guests:** the server adds the caller as organiser (accepted) and resolves every guest. Staff must be active members. Customers, suppliers and their contacts must be ones the caller may read (404 otherwise). An address that belongs to an active member becomes that colleague; any other is an email guest, never saved as a contact or lead. Guests need `meetings.invites` (400 when off). **Limits:** title 1 to 200 characters and place up to 200, each on one line; notes up to 4000; 15 to 1440 whole minutes; a reminder of 10, 15, 30 or 60; at most 50 guests and 20 email guests; at most 50 outside addresses per person per company day, and the daily email limits; a start the clock shows (a time the clocks skip is refused) and inside the start bound; the monthly start limit. **Flags:** the list is hidden when asked, when private, or with any guest who is not staff. Proposals are on only when Settings → Meetings allows them and the caller holds `meetings.meeting.edit`. Audited `Scheduled meeting`. Sends `meeting.invite` (REQUEST, SEQUENCE 0, the `.ics` attached) to every guest but the organiser, in-app for staff, and schedules the reminder. 201 `Meeting` |
| `PATCH /meetings/:id` | `meetings.meeting.edit`, and may change it | `{ title?, notes?, location?, start?, durationMin?, reminderMin? }`, with the same limits. A cancelled meeting is refused, and a change of nothing writes nothing. A change of start, length or place raises SEQUENCE and asks every guest again: answers and proposals are reset. A new start is checked only when it changes, the start bound included. On a series, the occurrences moved on their own shift with a new start, and a new start that would take one off the series (a monthly week shift, or past its end) is refused (part 2). So is a new start or length that would put one more than 31 days before its date in the series (400, review round 3 of PR #35), and any edit of a series, a title, place, notes or reminder one included, while one whose time has ended sits at a date in the series that has not, by the database clock (400, review round 3 and the final review of PR #35). Audited `Edited meeting` with the start and the changed field names. `meeting.invite` "Updated" to every guest; after any edit of a series, each occurrence moved on its own that has not ended is sent again as its own REQUEST (RECURRENCE-ID, own time), since its file carries the title, place, notes and reminder too. The reminder is re-synced. `Meeting` |
| `POST /meetings/:id/reschedule` | `meetings.meeting.edit`, and may change it | Part 2. `MeetingMove` `{ meetingId?, planned, start, durationMin, scope }`; a `meetingId` that is not `:id` is 400. `scope` is `this`, `following` or `all`; a one-off moves as `all`. **Refused (400, nothing written):** a cancelled meeting; a start the clocks skip or outside the start bound; a length outside 15 to 1440 whole minutes; a `planned` that is not one of the meeting's occurrences; `following` from the first occurrence (use `all`); a shifted series start the clocks skip or one that breaks the monthly start limit; a move that takes the moved occurrence or an occurrence moved on its own off the series (past its end, or a monthly week shift); `following` that starts at or before the end of the last occurrence the old series keeps; a move that puts an occurrence moved on its own more than 31 days before its date in the series; an `all` or `following` move that would leave an occurrence moved on its own whose time has ended at a date in the series that has not (on either series of a split, by the database clock); `all` from an occurrence moved on its own, one with its own start or length (final review of PR #35); more than 100 occurrences moved on their own; the daily email limits. **Saves:** SEQUENCE + 1; `rescheduleSequence` kept for `this`, set to the new SEQUENCE otherwise; answers and proposals are not reset. `following` ends the old series the day before and inserts a new one (new id and UID, SEQUENCE 0, the same organiser) with a copy of the guests and their answers; its email guests count against the caller's 50 outside addresses a day. **Sends** (`meeting.invite`, none while `meetings.invites` is off): `this` one REQUEST per guest with the RECURRENCE-ID and the occurrence's own time; `all` an "Updated" REQUEST; `following` one per series. After `all` and `following`, each occurrence moved on its own that has not ended is sent again. Reminders re-synced. Audited `Moved meeting` (times only, which Undo reads back) and, for a split, `Split meeting series` on the new series. Returns `{ meetings, conflicts, undo: { previous, createdIds } }`, each meeting shaped for the caller. `conflicts` are `{ name, title, start }` for the moved occurrence's guests booked in another overlapping occurrence that day, worked out from that day only; `title` is "Busy" unless the caller sees that meeting and sees that guest on it, and a row carries nothing else of it |
| `POST /meetings/:id/reschedule/undo` | `meetings.meeting.edit`, and may change it | Part 2. `{ sequence }` only: the SEQUENCE the screen saw before its move (`undo.previous.sequence`); anything else in the body is 400. The meeting is rebuilt from the server's own `Moved meeting` entry, never from the client. Checked in this order (part 3): that move is the meeting's last change and the meeting is not cancelled (409 `meeting_changed`); the meeting's SEQUENCE is the one the move saved and `sequence` the one before it (409 `meeting_changed`); only the person who made the move (403 "Only the person who moved this meeting can undo the move."); at most 5 minutes after it by the database clock (409 `undo_expired`). A series the move split off must be unchanged since and changeable by the caller (409 `meeting_changed` otherwise); it is cancelled and removed with its guests. Any undo, `this` included, is 400 when the restored series would leave an occurrence moved on its own whose time has ended at a date in the series that has not, by the database clock (review round 3 and the final review of PR #35), and nothing is written. Restores start, length, end and occurrences moved on their own; SEQUENCE + 1 and `rescheduleSequence` set to it; answers as the move left them. **Sends:** an "Updated" REQUEST to every guest; after any undo, each occurrence moved on its own that has not ended again (after `this` too, final review of PR #35); after undoing `this`, that occurrence at its restored time, once; a CANCEL (STATUS:CANCELLED) to every guest of a removed split. The reminder is re-synced, and a removed split's are cancelled. The daily email limits apply (400). Audited `Undid meeting move` and `Removed split meeting series`. `Meeting` |
| `POST /meetings/:id/cancel` | `meetings.meeting.edit`, and may change it | Once only: 400 after that. SEQUENCE + 1. Audited `Cancelled meeting`. `meeting.invite` CANCEL (STATUS:CANCELLED) to every guest; waiting reminders are cancelled. `Meeting` |
| `DELETE /meetings/:id/attendees/:attendeeId` | `meetings.meeting.edit`, and may change it; switch `meetings.invites` | Never the organiser, and not on a cancelled meeting. A guest not on this meeting is 404. SEQUENCE + 1; the other answers are kept. Audited `Removed meeting guest`. A CANCEL listing only that guest, sent to them only; the reminder is re-synced. `Meeting` |
| `POST /meetings/:id/response` | `meetings.meeting.view`; switch `meetings.invites` | `{ partStat, note, proposal: { start, durationMin, note } \| null }`. The caller must be a staff guest, not the organiser, on a meeting they see that is not cancelled (400 "Only a guest on this meeting can answer it."). The answer is `accepted`, `tentative` or `declined`, with a note of up to 500 characters. A proposal is stored as a pending Maybe; it needs a one-off meeting that takes proposals, a time the clock shows inside the start bound and 15 to 1440 minutes. Logged in `meeting_responses`. A tentative request is confirmed on Accept and cancelled on Decline (SEQUENCE + 1, reminder re-synced). Audited `Answered meeting`. `meeting.reply` or `meeting.proposed` to the organiser, email and in-app, one per answer. `Meeting` |
| `POST /meetings/:id/attendees/:attendeeId/proposal` | `meetings.meeting.edit`, the organiser, and may change it; switch `meetings.invites` | Part 2. `{ accept }`. Anyone but the organiser who may change the meeting gets 403 "Only the organiser can decide a proposed time.". A guest not on this meeting is 404. With no pending proposal from that guest, on a series or on a cancelled meeting the answer is 400; accepting also needs a proposed start the clock shows, inside the start bound at the time of the decision, and 15 to 1440 minutes. **Accept:** the meeting takes the proposed start and length, SEQUENCE + 1 and `rescheduleSequence` set to it, every answer reset (the organiser's included), the proposal `accepted` and every other proposal cleared; an "Updated" `meeting.invite` REQUEST to every guest; the reminder re-synced. Audited `Accepted proposed time`. **Decline:** the proposal becomes `declined` and nothing else changes; a `meeting.invite` DECLINECOUNTER ("Proposal declined", no STATUS, listing only the proposer) to the proposer only, unless they are no longer an active member. Audited `Declined proposed time`. The daily email limits apply (400). `Meeting` |
| `POST /meeting-requests` | `meetings.meeting.create`; switches `meetings.requests` and `meetings.invites` | `MeetingRequestInput` `{ withUserId, title, start, note, private }`; `durationMin` and `location` are ignored. `withUserId` must be an active member who holds `meetings.meeting.view`, never the caller (400 otherwise), checked before the transaction opens. The start must be inside the start bound. The request is 30 minutes at "To be agreed", with the reminder from Settings → Meetings, tentative, of kind `request`. The list is hidden when private, and proposals are on only when Settings → Meetings allows them and the caller holds `meetings.meeting.edit`, as on `POST /meetings`. Audited `Requested meeting`. `meeting.requested` to the person asked, email and in-app. No `.ics` and no reminder while it waits. 201 `Meeting` |
| `GET /meetings/:id/calendar.ics` | `meetings.meeting.view` | `{ fileName, text }` as JSON, at the contract's path: METHOD:PUBLISH, no ATTENDEE, no STATUS, the current UID and SEQUENCE. ORGANIZER only for a reader who may read guests' addresses (the organiser and anyone who may change the meeting); anyone else's file has none. 404 when the reader can't see the meeting or it was cancelled |

- **Calendar files** carry `PRODID:-//Platform//Meetings//EN`:
  - STATUS:TENTATIVE while a request waits;
  - DTEND from the start instant plus the length;
  - an RDATE for a monthly series that starts after day 28;
  - only guests with a valid address, and only the recipient when the list is hidden or any guest is not staff, whatever the stored flag;
  - no REQUEST for a meeting that is already cancelled.
- **Invite emails** carry the file as a `text/calendar; method=<METHOD>` attachment (see "Notifications and Outbox").
- **Reminders** are scheduled Outbox rows for the next occurrence. They go to staff guests who are still members, never the organiser, and are dropped if not sent by the occurrence's start. A move, an undo and an accepted proposal re-sync them.
- **Undo answers** (part 2): 409 `meeting_changed` when the meeting, or a series the move split off, changed since the move, or the screen's SEQUENCE is not the one before it; 403 `forbidden` for anyone but the person who made the move; 409 `undo_expired` more than 5 minutes after the move. Since part 3 the SEQUENCE is checked before the mover, so a toast for an older move after someone else's newer one answers 409 `meeting_changed`, not 403. Also 400 `invalid_request` over a daily email limit, or when the undo, `this` included, would leave an occurrence already held at a date still ahead.
- **Audit:** a private meeting's entries name it "Private meeting", and no entry holds emails, notes or titles.
- **Not on the API yet:** Settings → Meetings. The server reads the stored group, or the safest defaults where a value is missing (15 minutes, proposals off, list hidden, new guests not saved).
- **Never on the API:** `simulateReply` and a delete route.
- **The web client** (part 3, `apps/web/src/lib/api/http/api-methods.ts`):
  - routes twelve methods: `meetingsData` and `myMeetings` (new), `createMeeting`, `updateMeeting`, `cancelMeeting`, `removeGuest`, `respondToMeeting`, `decideProposal`, `requestMeeting`, `meetingCalendarFile`, `rescheduleMeeting` and `undoReschedule`, each at the route above;
  - sends only what the server reads: a guest as `{ kind, id }`, a new guest as `{ email, name }`, a PATCH with only the fields the screen set, a request without length or place, a move as `{ meetingId, planned, start, durationMin, scope }`, and an undo as `{ sequence }`. The organiser is never sent as a guest;
  - `meetingsData` reads `GET /meetings`, `GET /meeting-guests` (403 or 404 → no guests) and, while `meetings.requests` and `meetings.invites` are on, `GET /me/meetings` (403 or 404 → no colleagues). The reader's id is `viewerUserId` of `GET /me/meetings`, or `user.id` of `GET /auth/context` only when that gave no answer. `newGuestHandling` is always `none`;
  - `myMeetings` reads `GET /me/meetings`, and a 403 or 404 there as nothing to show;
  - `simulateReply`, and `list` and `get` of `meetings` (read only by Simulate reply on the demo Outbox's rows), stay on DemoStore, as do the Outbox and the bell. Settings → Meetings is hidden in api mode until part 4, so `updateSettings("meetings")` is never sent;
  - after a routed write the server answered, a success or a 400, 403, 404 or 409 refusal, the screens read again; a network failure, 401, 429 or 5xx triggers no re-read.

## Issuing stock, the roll quick invoice and the commission split (real build, inventory part 2, ADR 0043)

| Route | Needs | Does |
| --- | --- | --- |
| `GET /stock-holds` | `inventory.roll.view` or `inventory.product.view` | `StockHold[]`: active holds with the invoice number, customer name and `mayIssue` |
| `POST /reservations/:id/issue` | `inventory.roll.cut`; before payment also `inventory.reservation.override` | `{ overrideReason? }` (3 characters or more): cuts the roll (remnant rule) or issues boxed goods, posts cost of goods. Audited |
| `POST /rolls/:id/invoice` | `sales.invoice.create` | `{ customerId, lengthFt }`: a one-line invoice by the sq ft, posted, the roll held for it. Audited |
| `PUT /invoices/:id/commission-split` | `hr.commission.manage` or `sales.invoice.edit` | `{ split: [{ userId, pct }] }`: at most two, 100% in all; locked after the first confirmed payment. Audited |

An invoice whose stock was cut or issued can't be voided.

## Notifications and Outbox (real build, ADR 0032)

Each answers 404 when its feature (`shell.notifications`, `settings.outbox`) is off.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /notifications` | Any company member | The person's own in-app notes, newest first (50) |
| `POST /notifications/read` | Any company member | `{ ids? }`: marks those notes read, or all unread ones; only the person's own |
| `GET /outbox` | Any company member | The messages the person caused or received; every message with `settings.outbox.view`. Someone else's restricted message is redacted without `hr.employee.view`. A private meeting's message is redacted for everyone it does not involve, whatever they hold (ADR 0051): subject, body and attachments are hidden, while recipient, status and dates stay |
| `POST /outbox/:id/retry` | `settings.outbox.view` | Sends a failed message again after checking its address. 409 `not_failed` otherwise |
| `POST /outbox/:id/cancel` | `settings.outbox.view` | Cancels a scheduled message. 409 `not_scheduled` otherwise |

Raising an event is server-side only (`NotificationService.notify`): modules call it when their records change. An Outbox row moves from `queued` (or `scheduled`) to `sent` or `failed`, and from `scheduled` to `cancelled`.

ADR 0051 added the following:
- **Calendar files:** a row's `.ics` attachments go with the email as UTF-8 `text/calendar; method=<METHOD>; charset=UTF-8` files, and a PDF kept only as a link stays in the text.
- **Expiry:** `notify` takes an optional `expiresAt`, kept in the row's values. A worker or Retry that claims the row after that time cancels it instead of sending it, so a meeting reminder never arrives after the meeting starts.
- **Caller's transaction:** `notify` and the new `cancelScheduled(event, source)`, which cancels one source's scheduled rows of one event, can run inside the caller's transaction.

## Session (demo route handlers, demo mode only)

| Route | Body / response | Notes |
| --- | --- | --- |
| `POST /api/demo/login` | `{ kind: "company", companyId, userId, roleKey }` or `{ kind: "platform" }` → `{ session }` | Sets the signed httpOnly cookie `demo_session` (HS256, 8 h). Refuses a company whose product differs from the host's. MFA is checked on the login page first. |
| `POST /api/demo/logout` | → `{ ok: true }` | Clears the cookie. |
| `GET /api/demo/context` | → `{ session }` or 401 | A session made on the other product's host counts as signed out. |

Product by host: `proxy.ts` sets the `x-demo-product` request header. Hosts starting `hr-demo` serve the HR Suite; on localhost `?product=hr` does (remembered in the `demo_product` cookie).

## Lifecycle

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `openCompany(companyId, viewer)` | none (session) | Loads the company the session names. |
| `setViewer(viewer)` | none (session) | Switches "View as role". Data scope then follows that role's first active user. |
| `subscribe(listener)` | WebSocket or polling | Called after every change, so screens refresh. |
| `today()` | server date | Today's date as the data sees it. |
| `resetDemo()` | none | Demo only: restores the fixtures. |
| `takeNotices()` | none | Messages for the person once, such as saved demo changes from an older version that had to be reset. Reading clears them. |

## Platform (super-admin)

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `listCompanies()` | none (demo only) | The demo's companies, for the company switcher, the palette and the demo sign-in. |
| `listCompanyDirectory(id)` | none (demo only) | A demo company's roles, users and branding, read-only. Used by the login page and switching company. |
| `listPlatformCompanies()` | `GET /platform/companies` | `PlatformCompanySummary[]`: status, phase, plan, products, modules, limits, members, database state. |
| `getPlatformCompany(id)` | `GET /platform/companies/:id` | `PlatformCompany`, or null for an unknown company or an id that is not a UUID (never sent). |
| `updatePlatformCompanyAccess(id, patch)` | `PATCH /platform/companies/:id/access` | Modules, ceiling, user and branch limits; only the four fields travel. Takes effect at once. Written to `platform_audit_log` only (ADR 0052); the demo also writes "Changed company access" to the company's own log and its platform audit, and writes nothing for a save that changes nothing (ADR 0053). |
| `listPlatformAudit(query)` | `GET /platform/audit` | One page of the platform audit log, `{ entries, nextCursor }`. Only the fields that are set travel; a `companyId` or `before` that is not a UUID is never sent and gives an empty page. The demo keeps its rows in this browser's local storage (`platform-audit`) and maps them through the same shared redaction. |
| `listPlatformSupportGrants(companyId)` | `GET /platform/support-grants?companyId=` | The company's support requests the admin may see; `[]` for an id that is not a UUID (never sent). The demo keeps its requests in local storage (`platform-support`). |
| `requestSupportAccess(input)` | `POST /platform/support-grants` | `{ companyId, reason, hours }`, only those three fields, after a step-up in api mode. The demo applies the same bounds, messages and limits, with no step-up. |
| `getPlatformDirectory(id)` | `GET /platform/companies/:id/directory` | From the API: the default roles and branding, no users (`restricted: true`). The demo returns its full fixture directory (`restricted: false`). |
| `closeCompany()` | none (session) | The platform pages close the company the store had open, so the platform admin acts as the platform. |
| `importOverview(id)` | `GET /companies/:id/imports` | Import kinds the company's modules allow, saved column mappings and the import history. Company users need `settings.import.manage` in their own company; the platform admin may use any company. |
| `previewImport(id, request)` | `POST /companies/:id/imports/preview` | The dry run of a parsed file and its mapping: each row's result (create, update, skip, error with problems per cell). Writes nothing. |
| `runImport(id, request)` | `POST /companies/:id/imports` | Plans again on the server, writes the valid rows, keeps the batch (IMP-1001) with the replaced versions, audits it. Refused when nothing would be written or the file has more than 2,000 rows (demo). |
| `undoImport(id, batchId)` | `POST /companies/:id/imports/:batchId/undo` | Removes created records and restores replaced ones; refused when any changed since or a new record is used elsewhere. Audited. |
| `saveImportMapping(id, kind, columns)` | `PUT /companies/:id/import-mappings/:kind` | Remembers which header feeds each field for the next file. |
| `testDatabaseConnection(id, input)` | `POST /companies/:id/database/test` | Real build: a server-side worker connects with the encrypted credentials (docs/specs/data-integration.md). Demo: checks the fields and answers with a sample database; the password is never sent and nothing is stored. |

## Company and settings

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `getCompany()` | `GET /company` | The open company's platform record. |
| `getSettings()` | `GET /settings` | Branding, localization and tax, number format, profile. |
| `updateSettings(section, value)` | `PUT /settings/:section` | Replaces one section; audited with a before/after summary. |
| `getDefaultSettings()` | `GET /settings/defaults` | The company's original settings, for Reset to default; the page puts them in its draft and saves through `updateSettings`. |
| `resetSettings(section)` | `DELETE /settings/:section` | Restores one section to the company's original values; audited. |

## Records

`list`, `get` and `save` work on these collections: `roles`, `users`, `locations`, `products`, `rolls`, `stockMovements`, `transfers`, `customers`, `quotes`, `invoices`, `payments`, `invoiceAdjustments`, `refunds`, `reservations`, `stockAdjustments`, `suppliers`, `purchaseOrders`, `receipts`, `bills`, `supplierPayments`, `expenses`, `crews`, `jobs`, `employees`, `timesheets`, `ptoRequests`, `commissions`, `meetings`, `audit`.

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `list(collection)` | `GET /:collection` | Filtered by data scope. Own: quotes, invoices, payments, credits, write-offs, refunds and customers of the user as sales rep (payments and adjustments follow their invoice, refunds their customer); jobs led by the user; the user's own timesheets, PTO, commissions and meetings. Branch: sales documents and customers of the user's branch. All: everything. Meetings follow the meeting rules instead of the scope filter: those `GET /meetings` gives, shaped for the reader (ADR 0051 part 3). |
| `get(collection, id)` | `GET /:collection/:id` | Undefined when missing or outside scope. |
| `save(collection, item, audit?)` | `PUT /:collection/:id` | Creates or replaces; writes the audit entry when given. Refused unless the viewer holds one of the collection's write permissions (`lib/api/demo/permission-rules.ts`); `stockMovements`, `transfers`, `reservations`, `stockAdjustments`, `payments`, `invoiceAdjustments`, `refunds`, `expenses`, `commissions`, `meetings` and `audit` are written only by domain actions. Invoices store no status or paid amount: both come from the ledger (`packages/shared/src/ledger.ts`, ADR 0013). |

## Users and roles

| Method | Real endpoint | Rules enforced |
| --- | --- | --- |
| `inviteUser(input)` | `POST /users` | Seat limit: active and invited users count; disabled users free a seat. |
| `updateUser(id, patch)` | `PATCH /users/:id` | At least one active Owner remains. New roles must hold only permissions the granter holds; only an Owner makes an Owner. |
| `saveRole(role)` | `PUT /roles/:id` | Owner role is locked. No permission the granter does not hold can be added. |
| `resetRole(id)` | `POST /roles/:id/reset` | Default roles only, never Owner. Restores the shipped permissions (inside the product), scope, name and description, through the same no-escalation check as a save. Audited. |
| `deleteRole(id)` | `DELETE /roles/:id` | Default roles cannot be deleted; roles still held cannot be deleted. |
| `recordAudit(entry)` | `POST /audit` | Appends an entry as the signed-in user. |

Rule failures throw `DemoRuleError`, a kind of `ApiError` (`lib/api/errors.ts`), with a message written for the presenter; the real client maps HTTP 403 and 409 responses to `ApiError` too.

## Domain actions

Added with their screens below.

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `createCustomer(input)` | `POST /customers` | Needs `customers.customer.create`. Name required; phone, email and type optional (Homeowner). Company default terms, no address yet, so the profile reads as incomplete. Owned by the person who added it. Audited. |
| `saveCustomer(customer)` | `PUT /customers/:id` | Needs `customers.customer.edit`. Profile and addresses; default billing and job-site ids fall back to the first address. Audited. |
| `saveQuote(quote)` | `PUT /quotes/:id` | Saves content only. A new quote is a Draft with the next number from the company's quote prefix and needs only a customer; status, `sentAt`, `expiresAt` and `invoiceId` stay as stored. Refuses converted and declined quotes. A changed `taxOverride` needs `sales.tax.override` and writes its own audit entry with the reason. Audited. |
| `updateQuoteStatus(quoteId, { action, expiresAt })` | `POST /quotes/:id/status` | `send` (to Pending, after full validation, optional expiry date not in the past), `accept` or `decline`, only as `quoteActions` allows in the quote's state. Needs `sales.quote.edit`. Audited. |
| `convertQuoteToInvoice(quoteId)` | `POST /quotes/:id/invoice` | Refuses quotes already invoiced or declined, and runs full validation (customer, lines, job-site address, warehouse). Recomputes totals under the job-site state's tax rule, stores the rule version, numbers the invoice with the invoice prefix, dates it today with the customer's terms, and marks the quote Converted. Audited. |
| `recordPayment(input, files)` | `POST /payments` (files in base64, ADR 0038) | Needs `sales.payment.record`. Re-runs `validatePayment` (amount above zero and not above the balance unless the extra becomes credit with `sales.payment.apply_credit`; date not in the future nor before the invoice; reference except for cash; check number; card last 4 only). A reference already used needs `allowDuplicateReference`. One to three proof files, 5 MB each, checked by their first bytes (PDF, JPG, PNG, WebP, HEIC); all are stored or none. Numbers the payment with the payment prefix; with approval on (above the threshold) it starts Pending verification. Audited. |
| `reviewPayment(paymentId, { action: "confirm" } | { action: "reject", reason })` | `POST /payments/:id/review` | Needs `sales.payment.approve`; only a pending payment, never by the person who recorded it; a rejection needs a reason. Audited. |
| `attachPaymentFiles(paymentId, files)` | `POST /payments/:id/files` | Needs `sales.payment.record`; not on voided or rejected payments; at most three files in all. Audited. |
| `getFile(fileId)` | `GET /files/:id` | Needs `sales.payment.view`. Bytes from the file store (IndexedDB in the demo); a seeded payment's proof is a generated placeholder PDF. |
| `voidPayment(paymentId, reason)` | `POST /payments/:id/void` | Needs `sales.payment.void`; a confirmed or pending payment becomes Voided with the reason, stays visible with its files, and the balance comes back. Audited. |
| `markInvoiceSent(invoiceId)` | `POST /invoices/:id/sent` | Needs `sales.invoice.edit`; once, not on a void invoice. Audited. |
| `voidInvoice(invoiceId, reason)` | `POST /invoices/:id/void` | Needs `sales.invoice.void`; refused once any payment is confirmed; pending payments on it are voided too. Audited. |
| `writeOffBalance(invoiceId, reason)` | `POST /invoices/:id/write-off` | Needs `sales.payment.write_off`; the whole remaining balance, up to the company's write-off maximum. Audited. |
| `applyCredit(invoiceId)` | `POST /invoices/:id/apply-credit` | Needs `sales.payment.apply_credit`; applies the customer's credit (overpayments, open credit notes) up to the balance. Audited. |
| `refundCredit(input, files)` | `POST /refunds` (files in base64, ADR 0038) | Needs `sales.payment.refund`; not above the customer's credit, reference except for cash, proof required; numbered with the refund prefix. Audited. |
| `signOffJob(jobId, signer)` | `POST /jobs/:id/sign-off` | Needs `installation.job.sign_off`; a started job only. Its invoice's held balance becomes due from today under the customer's terms and an unsent invoice is marked sent. Audited. |
| `scheduleJob(input)` | `POST /installation/jobs` | Schedules the installation of an invoice without a job: crew, day (today or later), start hour; costed from the invoice. Needs `installation.job.create`. Audited. |
| `startJob(jobId)` | `POST /installation/jobs/:id/start` | Starts a scheduled job on or after its day. Needs `installation.job.edit`. Audited. |
| `createInvoiceFromJob(jobId)` | `POST /jobs/:id/invoice` | Needs `sales.invoice.create`; a job without an invoice. Materials at catalog price (else cost), a labor line for the rest of the job's revenue, taxed by the job site, linked to the job. Audited. |
| `issueReservation(reservationId, overrideReason?)` | `POST /reservations/:id/issue` | Needs `inventory.roll.cut`. Only after the invoice has a confirmed payment, or with `inventory.reservation.override` and a reason. Cuts the roll (remnant rule; the cut links the invoice) or writes an issue movement. Audited. |
| `recordAdjustment(input)` | `POST /stock-adjustments` | Needs `inventory.stock.adjust`; a reason (a note for Other); a roll cannot lose more than its free length. Above `settings.inventory.adjustmentApprovalQty` it waits, else it applies at once. Audited. |
| `reviewAdjustment(id, decision)` | `POST /stock-adjustments/:id/review` | Needs `inventory.stock.approve`; not the requester; a rejection needs a reason; approval applies it. Audited. |
| `createRollInvoice({ rollId, customerId, lengthFt })` | `POST /rolls/:id/invoice` | Needs `sales.invoice.create`; up to the roll's free length; one line by the sq yd at the product's price, taxed by the customer's job site, reserving the roll. Audited. |
| `createPurchaseOrder({ supplierId, expectedAt, locationId, lines, asDraft })` | `POST /purchase-orders` | Needs `purchasing.order.create`; saved as a draft or ordered at once; numbered with the PO prefix. Audited. |
| `markOrdered(poId)` / `cancelOrder(poId, reason)` | `POST /purchase-orders/:id/order`, `/cancel` | A draft is ordered; an order nothing has arrived for is cancelled with a reason. Audited. |
| `recordReceipt(poId, { locationId, lines, note })` | `POST /purchase-orders/:id/receipts` | Needs `purchasing.order.receive`; good and damaged units per line, never more than is still to come; writes receipt movements and rolls. Audited. |
| `enterBill(poId, { number, issuedAt, total }, files)` | `POST /purchase-orders/:id/bills` (multipart) | Needs `purchasing.bill.create`; only for unbilled receipts; a total different from the goods received is flagged; the supplier's file is required. Audited. |
| `recordSupplierPayment(input, files)` | `POST /supplier-payments` (multipart) | Needs `purchasing.payment.record`; reference except for cash, proof required, not more than the bills owe; allocated oldest due first; approval as for customer payments. Audited. |
| `reviewSupplierPayment(id, decision)` / `voidSupplierPayment(id, reason)` | `POST /supplier-payments/:id/review`, `/void` | `purchasing.payment.approve` by someone else, or `purchasing.payment.void` with a reason. Audited. |
| `createTransfer(input)` | `POST /transfers` | Needs `inventory.transfer.create`. Both ends must be different warehouses; boxed quantities whole and no more than the sender holds; rolls at the sender and not travelling. Boxed stock leaves the sender at once; rolls are marked in transit. Numbered TR-1001 up. Audited. |
| `receiveTransfer(id)` | `POST /transfers/:id/receive` | Needs `inventory.transfer.receive`. Boxed stock arrives at the receiver; rolls move there to bin Receiving. Audited. |
| `saveLocation(location)` | `PUT /locations/:id` | Needs `settings.locations.manage`. Keeps exactly one default, which must be a warehouse; a location holding stock cannot become a showroom. Audited. |
| `updateMyProfile(patch)` | `PATCH /me` | The signed-in person's own default warehouse (a warehouse, or null for the company default). Audited. |

## Feature batch 3 actions

Every call added by feature batch 3 (docs/specs/feature-batch-03.md), with what it takes, returns and needs. The behaviour column comes from the code's own comments and names the ADR behind each rule.

| Method and input | Output | Real endpoint | Permission | Behaviour |
| --- | --- | --- | --- | --- |
| `whoAmI()` | `string` | `GET /me/id` | Any signed-in user | The signed-in user's id. |
| `saveExpense(input: ExpenseInput, files: File[])` | `Expense` | `PUT /expenses/:id (multipart)` | `finance.expense.create` | Saves a draft, or records an expense: leaving draft needs a receipt, and a large one waits for approval (spec F1). |
| `reviewExpense(id: string, decision: ExpenseDecision)` | `Expense` | `POST /expenses/:id/review` | `finance.expense.approve` | Approves or rejects an expense; nobody approves their own, and a rejection needs a reason (ADR 0023). |
| `voidExpense(id: string, reason: string)` | `Expense` | `POST /expenses/:id/void` | `finance.expense.void` | Voids a confirmed expense with a reason; a pay-later one with payments can't be voided (ADR 0023). |
| `saveRecurringExpense(input: RecurringExpenseInput)` | `RecurringExpense` | `PUT /recurring-expenses/:id` | `finance.expense.create` | Adds or edits a recurring expense (spec F1). |
| `businessReport(filters: BusinessFilters)` | `BusinessReport` | `GET /reports/business` | `reports.financial.view`. Margin rows need `sales.margin.view_sensitive`, People costs `hr.employee.view_sensitive`, Stock on hand `inventory.product.view_sensitive` | The one Business report (ADR 0023). Screen, CSV and PDF print the same rows. |
| `meetingsData()` | `MeetingsData` `{ viewerUserId, meetings, guests, colleagues, newGuestHandling }` | `GET /meetings`, `GET /meeting-guests`, `GET /me/meetings` and, only without its answer, `GET /auth/context` | `meetings.meeting.view` | The Meetings page's data (ADR 0051 part 3): every meeting as the reader may read it, who the reader is in the ids those meetings use, whom they may invite and whom they may ask to meet. Guests are empty without `meetings.meeting.create` or with `meetings.invites` off; colleagues are empty unless a request can be sent. In the demo, the same from the store's shared rules. |
| `myMeetings()` | `MyMeetings` | `GET /me/meetings` | `hr.portal.view` | My meetings (spec C2, ADR 0051): the reader's coming meetings, each with its next occurrence, soonest first, and whom they may ask to meet. With the meetings module, `meetings.calendar` or `hr.portal` off the API refuses (403 or 404), which the client reads as nothing to show; the demo refuses too, and the page and its tab are hidden. |
| `createMeeting(input: MeetingInput)` | `Meeting` | `POST /meetings` | `meetings.meeting.create` | Schedules a meeting and invites every guest (spec E, ADR 0021): one Outbox row and .ics each, SEQUENCE 0. A guest added by email is kept per Settings → Meetings in the demo; the API keeps every guest a guest (ADR 0051). |
| `updateMeeting(id: string, patch: Partial<Pick<Meeting, "title" \| "notes" \| "location" \| "start" \| "durationMin" \| "reminderMin">>)` | `Meeting` | `PATCH /meetings/:id` | `meetings.meeting.edit` | Edits a meeting (ADR 0021): a significant change raises SEQUENCE and asks every guest again; a title or notes edit keeps it. |
| `cancelMeeting(id: string)` | `Meeting` | `POST /meetings/:id/cancel` | `meetings.meeting.edit` | Cancels a meeting and sends the cancellation (ADR 0021: CANCEL, SEQUENCE + 1, all guests). |
| `removeGuest(meetingId: string, attendeeId: string)` | `Meeting` | `DELETE /meetings/:id/attendees/:attendeeId` | `meetings.meeting.edit` | Removes one guest: they get a CANCEL, everyone else keeps their answer (ADR 0021). |
| `respondToMeeting(meetingId: string, reply: ReplyInput)` | `Meeting` | `POST /meetings/:id/response` | `meetings.meeting.view` | The signed-in person answers an invitation or request (spec E). |
| `simulateReply(outboxId: string, reply: ReplyInput)` | `Meeting` | Demo only; reading emailed replies is deferred (ADR 0051) | `meetings.meeting.view` for the organiser, `settings.outbox.view` for anyone else; since ADR 0051 part 3 also sight of the meeting and `meetings.invites` on | Stands in for a guest's email reply, from the Outbox (spec E, ADR 0021), with an answer the shared reply rules allow, at the SEQUENCE the invite was sent with. |
| `decideProposal(meetingId: string, attendeeId: string, accept: boolean)` | `Meeting` | `POST /meetings/:id/attendees/:attendeeId/proposal` | `meetings.meeting.edit` | The organiser accepts or declines a proposed time. Accepting moves the meeting and asks everyone again (ADR 0021). On the API since meetings part 2: only the organiser who may change the meeting (ADR 0051). |
| `requestMeeting(input: MeetingRequestInput)` | `Meeting` | `POST /meeting-requests` | `meetings.meeting.create` | Any user asks someone to meet (spec E): tentative until they accept. Between staff there is no .ics (ADR 0021). |
| `meetingCalendarFile(meetingId: string)` | `{ fileName: string; text: string }` | `GET /meetings/:id/calendar.ics` | `meetings.meeting.view` | Copy for the person's own calendar (ADR 0021): METHOD:PUBLISH, no attendees, same UID and SEQUENCE. |
| `saveContract(input: ContractInput)` | `Contract` | `PUT /contracts/:id` | `contracts.contract.create` for a new one, `contracts.contract.edit` for an existing one | Adds or edits a contract and its schedule; lines can change only while it is a draft (ADR 0026). |
| `sendContract(id: string)` | `Contract` | `POST /contracts/:id/send` | `contracts.contract.edit` | Sends a draft for signature; the lines lock and the other company is told (spec D2). |
| `recallContract(id: string)` | `Contract` | `POST /contracts/:id/recall` | `contracts.contract.edit` | Takes a contract back to draft while it waits for signature. |
| `signContract(id: string, input: SignatureInput)` | `Contract` | `POST /contracts/:id/sign` | `contracts.contract.approve` | Records a simulated signature (spec D2, ADR 0026): typed name, date and an audit record with no IP address, and a PDF filed on the contract. The screen labels it simulated. |
| `completeContract(id: string)` | `Contract` | `POST /contracts/:id/complete` | `contracts.contract.edit` | Marks substantial completion, which starts the retainage clock (ADR 0026). |
| `closeContract(id: string, overrideReason: string \| null)` | `Contract` | `POST /contracts/:id/close` | `contracts.contract.edit`. An override with a reason needs `contracts.contract.approve` | Closes a contract once nothing is held or owed and a final waiver is on file; the Owner may override with a reason. |
| `terminateContract(id: string, reason: string)` | `Contract` | `POST /contracts/:id/terminate` | `contracts.contract.approve` | Ends a contract with a reason; billing stops and held retainage stays until released (spec D2). |
| `renewContract(id: string)` | `Contract` | `POST /contracts/:id/renew` | `contracts.contract.create` | Starts the next term as a new draft linked to this one (ADR 0026). |
| `postBilling(contractId: string, input: BillingInput)` | `ContractBilling` | `POST /contracts/:id/billings` | `contracts.billing.create` | Posts a pay application (spec D2, ADR 0026): one invoice or bill for the period, retainage held off its total. |
| `releaseRetainage(contractId: string, input: ReleaseInput)` | `ContractBilling` | `POST /contracts/:id/retainage/release` | `contracts.billing.create` | Releases held retainage, in part or in full, on its own invoice or bill (spec D2, ADR 0026). |
| `voidBilling(billingId: string, reason: string)` | `ContractBilling` | `POST /contract-billings/:id/void` | `contracts.billing.void` | Voids the latest billing while nothing on it is confirmed (ADR 0026). |
| `saveChangeOrder(contractId: string, input: ChangeOrderInput)` | `ChangeOrder` | `PUT /contracts/:id/change-orders/:orderId` | `contracts.change_order.create` | Saves a change order as a draft or sends it for approval (spec D2). |
| `decideChangeOrder(id: string, decision: { approve: boolean; reason: string })` | `ChangeOrder` | `POST /change-orders/:id/decision` | `contracts.change_order.approve` | Approves or rejects a change order. Approval raises the contract value at once; issued invoices never change (ADR 0026). |
| `recordWaiver(contractId: string, input: WaiverInput)` | `LienWaiver` | `POST /contracts/:id/waivers` | `contracts.compliance.manage` | Records a lien waiver against a payment (spec D2, ADR 0026). |
| `saveCertificate(contractId: string, input: CertificateInput)` | `InsuranceCertificate` | `PUT /contracts/:id/certificates/:certificateId` | `contracts.compliance.manage` | Saves a subcontractor's certificate of insurance (spec D1). |
| `addContractFiles(contractId: string, files: File[])` | `void` | `POST /contracts/:id/files (multipart)` | `contracts.contract.edit` | Adds attachments to a contract (spec D2). |
| `saveEmployee(input: EmployeeInput)` | `Employee` | `PUT /employees/:id` | `hr.employee.create` for a new one, `hr.employee.edit` for an existing one. The pay rate also needs `hr.employee.view_sensitive` | Adds or edits a person (spec C1 People, ADR 0024). The pay rate changes only with hr.employee.view_sensitive. A 1099 worker is outside overtime law, and a California salary always covers 40 hours (Labor Code 515). Someone without a checklist gets one when they are added. |
| `setChecklistItem(employeeId: string, list: "onboarding" \| "offboarding", itemId: string, done: boolean)` | `void` | `PUT /employees/:id/checklists/:list/:itemId` | `hr.employee.edit` | Ticks or unticks a step of a checklist (spec C1). |
| `startOffboarding(employeeId: string)` | `Employee` | `POST /employees/:id/offboarding` | `hr.employee.edit` | Starts offboarding: the checklist appears and the person is marked as having left (ADR 0024). |
| `addEmployeeDocuments(employeeId: string, files: File[])` | `void` | `POST /employees/:id/documents (multipart)` | `hr.employee.edit` | Adds documents to a person's file (spec C1 People). |
| `updateMyEmployeeProfile(patch: MyProfilePatch)` | `Employee` | `PATCH /me/employee` | `hr.portal.view`; the signed-in person, on their own record | The person's own contact details in the portal. |
| `saveTimesheet(input: TimesheetInput)` | `Timesheet` | `PUT /timesheets/:id` | `hr.timesheet.edit` on one's own sheet, `hr.timesheet.approve` on anyone else's | Saves a week's hours (spec C1, C2). A rejected sheet keeps its status until it is submitted again. |
| `submitTimesheet(id: string)` | `Timesheet` | `POST /timesheets/:id/submit` | `hr.timesheet.edit` on one's own sheet, `hr.timesheet.approve` on anyone else's | Sends a sheet for approval and tells the people who can decide it (spec C2). |
| `decideTimesheets(ids: readonly string[], decision: TimesheetDecision)` | `void` | `POST /timesheets/decisions` | `hr.timesheet.approve` | Approves or rejects submitted sheets (spec C1, ADR 0024). A rejection needs a reason and never changes the hours; nobody decides their own sheet, the same two-person idea as payments. |
| `reopenTimesheet(id: string, reason: string)` | `Timesheet` | `POST /timesheets/:id/reopen` | `hr.timesheet.approve` | Reopens an approved sheet with a reason, until its pay period is exported (ADR 0024). |
| `uploadTimesheets(input: { table: ImportTable; fileName: string; apply: boolean; own: boolean; })` | `TimesheetUploadResult` | `POST /timesheets/upload` | `hr.timesheet.edit` for one's own rows in the portal, `hr.timesheet.approve` otherwise | Bulk hours from the template (spec C1, C2): the same rows and checks as the import wizard. With `apply` false it is a dry run. In the portal only the signed-in person's rows go through. |
| `clockIn()` | `void` | `POST /clock/in` | `hr.portal.view` | Clocks in (spec C2); only when the company uses the clock. |
| `clockOut()` | `void` | `POST /clock/out` | `hr.portal.view` | Clocks out and adds the hours to this week's draft timesheet (spec C2, ADR 0024). |
| `requestTimeOff(input: TimeOffInput)` | `PtoRequest` | `POST /time-off` | `hr.pto.request` for oneself, `hr.pto.approve` for anyone else | Requests time off (spec C1, C2). Refused when the balance won't cover it, before the policy's waiting period ends, past its yearly use limit, or for a partial unpaid day of an exempt person, which could not lawfully reduce their salary (29 CFR 541.602, ADR 0024). |
| `decideTimeOff(id: string, decision: TimeOffDecision)` | `PtoRequest` | `POST /time-off/:id/decision` | `hr.pto.approve` | Approves or declines a request (spec C1). Approving posts the hours to the ledger; a decline needs a reason. |
| `cancelTimeOff(id: string)` | `PtoRequest` | `POST /time-off/:id/cancel` | `hr.pto.request` for oneself, `hr.pto.approve` for anyone else | Cancels a request; if it was approved, its hours go back on the balance (ADR 0024). |
| `adjustTimeOff(input: TimeOffAdjustment)` | `void` | `POST /time-off/adjustments` | `hr.pto.approve` | A manual change to a balance, with a reason (ADR 0024: every change is a ledger line). |
| `saveTimeOffPolicy(policy: TimeOffPolicy)` | `TimeOffPolicy` | `PUT /time-off/policies/:id` | `settings.hr.manage` | Adds or edits a policy (Settings → HR). A company with California staff gets the California guards (ADR 0024). |
| `listCommissionStatements()` | `CommissionStatementRow[]` | `GET /commissions/statements` | `hr.commission.view`. Rows are limited to who the viewer may see | One row per person and month, with its state and totals. |
| `teamCommission(range: { from: string; to: string })` | `[string, TeamCommission][]` | `GET /commissions/team` | `sales.commission.view` | Commission for a date range per person the viewer may see, for Sales → Team (ADR 0025). |
| `approveStatement(userId: string, month: string)` | `CommissionStatement` | `POST /commissions/statements/:userId/:month/approve` | `hr.commission.approve` | Approves a month's statement (ADR 0025): only after the month ends, with no line waiting for review, and never by the person it pays. Approved means frozen; later changes go on an open month. |
| `addCommissionAdjustment(input: CommissionAdjustmentInput)` | `void` | `POST /commissions/adjustments` | `hr.commission.adjust` | A manual change to an open statement, with a reason (spec C1). A deduction names its invoice (ADR 0025). |
| `decideReversal(input: { userId: string; month: string; lineId: string; outcome: "applied" \| "waived"; reason: string; })` | `void` | `POST /commissions/reversals/decision` | `hr.commission.approve` | Accepts or waives a reversal outside its window, with a reason (ADR 0025). |
| `saveCommissionPlan(plan: CommissionPlan)` | `CommissionPlan` | `PUT /commissions/plans/:id` | `hr.commission.manage` | Saves a plan (ADR 0025). A plan already used by an approved statement is never edited: the change becomes a new version from today, current assignments move to it and must be signed again. |
| `assignPlan(input: PlanAssignmentInput)` | `CommissionAssignment` | `POST /commissions/assignments` | `hr.commission.manage` | Puts someone on a plan from a date, ending any plan they are on (spec C1). |
| `acknowledgePlan(assignmentId: string, signedName: string, plan: CommissionPlan)` | `void` | `POST /commission-assignments/:id/acknowledge` | `hr.portal.view`; the rep the plan is assigned to, with My commission shown | The rep signs their plan; a typed name stands in for e-signature in the demo (Labor Code 2751, ADR 0025). `plan` is the plan the screen showed; a plan changed since is refused (409 `plan_changed`, ADR 0049). |
| `setCommissionSplit(invoiceId: string, split: { userId: string; pct: string }[])` | `void` | `PUT /invoices/:id/commission-split` | `hr.commission.manage` | Shares an invoice between up to two reps (ADR 0025); locked from the first confirmed payment. |
| `issueCreditNote(invoiceId: string, input: CreditNoteInput)` | `Invoice` | `POST /invoices/:id/credit-notes` | `sales.invoice.void` | Issues a credit note for part of an invoice (plan K-11). It carries the invoice's tax and cost in proportion, becomes customer credit, and reverses commission through the clawback rules. |
| `listPayPeriods()` | `PayPeriod[]` | `GET /pay-periods` | `hr.payroll.view` | Pay periods, newest first. The current one is created when it does not exist yet. |
| `reviewPayPeriod(id: string)` | `PayPeriodReview` | `GET /pay-periods/:id/review` | `hr.payroll.view` | One pay period to review (spec C1): stored lines once approved, otherwise worked out live. |
| `setPayExclusion(id: string, employeeId: string, reason: string \| null)` | `void` | `PUT /pay-periods/:id/exclusions/:employeeId` | `hr.payroll.approve` | Leaves someone out of this run, or brings them back; leaving out needs a reason (ADR 0024). |
| `approvePayPeriod(id: string)` | `PayPeriod` | `POST /pay-periods/:id/approve` | `hr.payroll.approve` | Approves a run (spec C1, ADR 0024): every workweek ending in it must be approved or the person left out. The lines are frozen, approved commission statements join it, and hours-worked and per-period accrual posts to the time-off ledger now. |
| `reopenPayPeriod(id: string)` | `PayPeriod` | `POST /pay-periods/:id/reopen` | `hr.payroll.approve` | Returns an approved run to review before export; its accrual and statements are released (ADR 0024). |
| `exportPayPeriod(id: string)` | `PayPeriod` | `POST /pay-periods/:id/export` | `hr.payroll.export` | Marks a run exported (spec C1): it locks, and its commission statements become paid. |
| `myPortal()` | `MyPortal` | `GET /me/portal` | `hr.portal.view` | Everything the portal shows, for the signed-in person only (spec C2). Hidden areas come back empty. |
| `listStockHolds()` | `StockHold[]` | `GET /stock-holds` | `inventory.roll.view` | Open reservations with what a warehouse needs to cut against them (audit U-03). |
| `saveNotificationRule(rule: Omit<NotificationRule, "updatedAt" \| "updatedBy">)` | `NotificationRule` | `PUT /notification-rules/:key` | `settings.notifications.manage` | Saves a company's choices for one event; refuses unknown tokens (ADR 0020). |
| `resetNotificationRule(key: NotificationEventKey)` | `void` | `DELETE /notification-rules/:key` | `settings.notifications.manage` | Puts one event back to the catalogue's defaults. |
| `listOutbox(all: boolean)` | `OutboxMessage[]` | `GET /outbox` | Own rows for anyone; all rows with `settings.outbox.view`. Restricted rows need `hr.employee.view` or to be one's own | The Outbox as a person may see it (ADR 0020): their own rows, or all with settings.outbox.view; restricted rows are redacted. |
| `retryOutbox(id: string)` | `OutboxMessage` | `POST /outbox/:id/retry` | One's own row, or any row with `settings.outbox.view` | Sends a failed row again, with a fresh failure check. |
| `cancelOutbox(id: string)` | `OutboxMessage` | `POST /outbox/:id/cancel` | One's own row, or any row with `settings.outbox.view` | Cancels a scheduled row. |
| `simulateBounce(id: string)` | `OutboxMessage` | Demo only; the real build gets bounces from the email provider | `settings.outbox.view` | Presenter tool: marks a sent row as bounced, to show where a delivery failure lands. |
| `listMyNotifications()` | `InAppNotification[]` | `GET /me/notifications` | The signed-in person | The person's own in-app notifications. |
| `markNotificationsRead(ids: readonly string[])` | `void` | `POST /me/notifications/read` | The signed-in person, on their own notifications | Marks notifications read, only the person's own. |
| `correctStockCount(input: StockCorrectionInput)` | `StockAdjustment` | `POST /stock-corrections` | `inventory.stock.correct` | Corrects stock to what was physically counted (plan A-1): the difference is written as an approved adjustment with the reason, so on hand still adds up and the change is audited. Boxed goods must stay whole cartons or items. |
| `rescheduleMeeting(move: MeetingMove)` | `{ meetings: Meeting[]; conflicts: Conflict[]; undo: MeetingUndo }` | `POST /meetings/:id/reschedule` | `meetings.meeting.edit` | Moves or resizes a meeting occurrence (spec F) and tells the guests (ADR 0021): one occurrence goes out with RECURRENCE-ID, "this and following" splits into a new UID, and "all" updates the series. On the API since meetings part 2, with conflicts the caller can't read shown as "Busy" (ADR 0051). |
| `undoReschedule(undo: MeetingUndo)` | `Meeting` | `POST /meetings/:id/reschedule/undo` | `meetings.meeting.edit` | Puts a meeting back as it was before a move, removing a series the move split off. On the API since meetings part 2, which rebuilds the earlier state on the server from its own audit entry: the client sends only `{ sequence: undo.previous.sequence }`, and only the mover may undo, within 5 minutes, the meeting's last change (ADR 0051). |
| `saveSupplier(input: SupplierInput)` | `Supplier` | `PUT /suppliers/:id` | `purchasing.supplier.create` for a new one, `purchasing.supplier.edit` for an existing one | Adds or edits a supplier (spec B1). Only a name is required, so one can be added in the middle of a purchase order and finished later; a supplier added that way has terms of pay on order and no credit (ADR 0022). |
| `setSupplierStatus(id: string, status: Supplier["status"])` | `Supplier` | `POST /suppliers/:id/status` | `purchasing.supplier.edit` | Deactivates or reactivates a supplier (ADR 0022): never deleted, and one with an open order or a balance stays active. Inactive suppliers leave the pickers and stay in history. |
| `saveSupplierContact(input: SupplierContactInput)` | `SupplierContact` | `PUT /supplier-contacts/:id` | `purchasing.supplier.create` for a new one, `purchasing.supplier.edit` for an existing one | Adds or edits a contact (spec B1, B2): a name plus an email or a phone. The first contact of a supplier becomes primary, and marking another clears the old one. |
| `setContactStatus(id: string, status: SupplierContact["status"])` | `SupplierContact` | `POST /supplier-contacts/:id/status` | `purchasing.supplier.edit` | Deactivates or reactivates a contact (ADR 0022). When the primary leaves, the oldest active sales rep takes over, then the oldest active contact. |

## Errors and the simulated network

- Every failure a person should read is an `ApiError`. Reads surface it through `useApiQuery` (status `error`, with `retry`) and `QueryFallback`; a failed save that a screen does not catch is shown as a toast by `useApiErrorToasts`.
- `withSimulatedNetwork` (`lib/api/network.ts`) wraps the client. The presenter guide's Network control sets normal, slow (each call waits 1.5 s) or offline (each call fails with an `ApiError` before it runs, so nothing is saved). It affects the next request only and resets on reload. `setViewer`, `subscribe`, `today` and `openCompany` are not simulated. A real client needs no change: the wrapper only delays or fails calls.
