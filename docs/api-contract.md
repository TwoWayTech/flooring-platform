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

Every Nest route needs a signed-in session with an open company, unless it is marked `@Public()` (`GET /health`, `GET /public/branding`) or `@SessionOnly()` (`GET /auth/context`). The guards run globally in this order: SessionGuard, then TenantGuard. So a new route is closed until it says otherwise.

The company always comes from the verified session. A `companyId` or `tenantId` in the path, query, body or headers is never read. Company data is reached only through `TenantConnectionService.db(tenant)`, where `tenant` is the `@CurrentTenant()` context that TenantGuard made.

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
| `GET /audit` | `settings.audit.view` | The newest 500 audit entries (`AuditEntry`) |
| `POST /auth/step-up` | A session (no company needed) | `{ code }`: a TOTP or backup code; valid 5 minutes for this session. 403 `step_up_invalid`, `step_up_mfa_required`; 429 `step_up_locked` after 5 wrong codes in 15 minutes |
| `GET /public/invitations/:token` | Public, 10 a minute per IP | `{ email, companyName, needsPassword }`; 410 `invitation_invalid` |
| `POST /public/invitations/accept` | Public, 10 a minute per IP | `{ token, password? }`: sets the password of a new account (12 to 128 characters), verifies the email, activates the profile. 400 `weak_password`; 410 `invitation_invalid` |
| `GET /support-grants` | The Owner role | The company's support-access requests and their status |
| `POST /support-grants/:id/approve` | The Owner role and a step-up | 409 `grant_closed` |
| `POST /support-grants/:id/revoke` | The Owner role | 409 `grant_closed` |
| `POST /platform/support-grants` | An active platform admin's session | `{ companyId, reason, hours ≤ 72 }` |

A route that needs a step-up answers 403 `step_up_required` without one from the last 5 minutes. Someone whose only factor is a passkey steps up by signing in again with it: a session under 5 minutes old counts. Password reset is Better Auth's `/api/auth/request-password-reset` and `/api/auth/reset-password` (one-hour links, every session ended; 3 emails an hour per address, shared with verification and invitation emails).

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

## Notifications and Outbox (real build, ADR 0032)

Each answers 404 when its feature (`shell.notifications`, `settings.outbox`) is off.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /notifications` | Any company member | The person's own in-app notes, newest first (50) |
| `POST /notifications/read` | Any company member | `{ ids? }`: marks those notes read, or all unread ones; only the person's own |
| `GET /outbox` | Any company member | The messages the person caused or received; every message with `settings.outbox.view`. Someone else's restricted message is redacted without `hr.employee.view` |
| `POST /outbox/:id/retry` | `settings.outbox.view` | Sends a failed message again after checking its address. 409 `not_failed` otherwise |
| `POST /outbox/:id/cancel` | `settings.outbox.view` | Cancels a scheduled message. 409 `not_scheduled` otherwise |

Raising an event is server-side only (`NotificationService.notify`): modules call it when their records change. An Outbox row moves from `queued` (or `scheduled`) to `sent` or `failed`, and from `scheduled` to `cancelled`.

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
| `listCompanies()` | `GET /platform/companies` | Status, plan, products, modules, ceiling, limits. |
| `updateCompanyAccess(id, patch)` | `PATCH /platform/companies/:id/access` | Modules, ceiling, user and branch limits. Takes effect at once and is written to the company's audit log as "Platform admin". |
| `listCompanyDirectory(id)` | `GET /platform/companies/:id/directory` | Roles, users and branding, read-only. Used by the login page and the company access page. |
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
| `list(collection)` | `GET /:collection` | Filtered by data scope. Own: quotes, invoices, payments, credits, write-offs, refunds and customers of the user as sales rep (payments and adjustments follow their invoice, refunds their customer); jobs led by the user; the user's own timesheets, PTO, commissions and meetings. Branch: sales documents and customers of the user's branch. All: everything. |
| `get(collection, id)` | `GET /:collection/:id` | Undefined when missing or outside scope. |
| `save(collection, item, audit?)` | `PUT /:collection/:id` | Creates or replaces; writes the audit entry when given. Refused unless the viewer holds one of the collection's write permissions (`lib/api/demo/permission-rules.ts`); `stockMovements`, `transfers`, `reservations`, `stockAdjustments`, `payments`, `invoiceAdjustments`, `refunds`, `expenses`, `commissions` and `audit` are written only by domain actions. Invoices store no status or paid amount: both come from the ledger (`packages/shared/src/ledger.ts`, ADR 0013). |

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
| `recordPayment(input, files)` | `POST /invoices/:id/payments` (multipart) | Needs `sales.payment.record`. Re-runs `validatePayment` (amount above zero and not above the balance unless the extra becomes credit with `sales.payment.apply_credit`; date not in the future nor before the invoice; reference except for cash; check number; card last 4 only). A reference already used needs `allowDuplicateReference`. One to three proof files, 5 MB each, checked by their first bytes (PDF, JPG, PNG, WebP, HEIC); all are stored or none. Numbers the payment with the payment prefix; with approval on (above the threshold) it starts Pending verification. Audited. |
| `reviewPayment(paymentId, { action: "confirm" } | { action: "reject", reason })` | `POST /payments/:id/review` | Needs `sales.payment.approve`; only a pending payment, never by the person who recorded it; a rejection needs a reason. Audited. |
| `attachPaymentFiles(paymentId, files)` | `POST /payments/:id/files` | Needs `sales.payment.record`; not on voided or rejected payments; at most three files in all. Audited. |
| `getFile(fileId)` | `GET /files/:id` | Needs `sales.payment.view`. Bytes from the file store (IndexedDB in the demo); a seeded payment's proof is a generated placeholder PDF. |
| `voidPayment(paymentId, reason)` | `POST /payments/:id/void` | Needs `sales.payment.void`; a confirmed or pending payment becomes Voided with the reason, stays visible with its files, and the balance comes back. Audited. |
| `markInvoiceSent(invoiceId)` | `POST /invoices/:id/sent` | Needs `sales.invoice.edit`; once, not on a void invoice. Audited. |
| `voidInvoice(invoiceId, reason)` | `POST /invoices/:id/void` | Needs `sales.invoice.void`; refused once any payment is confirmed; pending payments on it are voided too. Audited. |
| `writeOffBalance(invoiceId, reason)` | `POST /invoices/:id/write-off` | Needs `sales.payment.write_off`; the whole remaining balance, up to the company's write-off maximum. Audited. |
| `applyCredit(invoiceId)` | `POST /invoices/:id/credit` | Needs `sales.payment.apply_credit`; applies the customer's credit (overpayments, open credit notes) up to the balance. Audited. |
| `refundCredit(input, files)` | `POST /customers/:id/refunds` (multipart) | Needs `sales.payment.refund`; not above the customer's credit, reference except for cash, proof required; numbered with the refund prefix. Audited. |
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
| `createMeeting(input: MeetingInput)` | `Meeting` | `POST /meetings` | `meetings.meeting.create` | Schedules a meeting and invites every guest (spec E, ADR 0021): one Outbox row and .ics each, SEQUENCE 0. A guest added by email is kept per Settings → Meetings. |
| `updateMeeting(id: string, patch: Partial<Pick<Meeting, "title" \| "notes" \| "location" \| "start" \| "durationMin" \| "reminderMin">>)` | `Meeting` | `PATCH /meetings/:id` | `meetings.meeting.edit` | Edits a meeting (ADR 0021): a significant change raises SEQUENCE and asks every guest again; a title or notes edit keeps it. |
| `cancelMeeting(id: string)` | `Meeting` | `POST /meetings/:id/cancel` | `meetings.meeting.edit` | Cancels a meeting and sends the cancellation (ADR 0021: CANCEL, SEQUENCE + 1, all guests). |
| `removeGuest(meetingId: string, attendeeId: string)` | `Meeting` | `DELETE /meetings/:id/attendees/:attendeeId` | `meetings.meeting.edit` | Removes one guest: they get a CANCEL, everyone else keeps their answer (ADR 0021). |
| `respondToMeeting(meetingId: string, reply: ReplyInput)` | `Meeting` | `POST /meetings/:id/response` | `meetings.meeting.view` | The signed-in person answers an invitation or request (spec E). |
| `simulateReply(outboxId: string, reply: ReplyInput)` | `Meeting` | Demo only; the real build reads the emailed reply | `meetings.meeting.view` for the organiser, `settings.outbox.view` for anyone else | Stands in for a guest's email reply, from the Outbox (spec E, ADR 0021). |
| `decideProposal(meetingId: string, attendeeId: string, accept: boolean)` | `Meeting` | `POST /meetings/:id/attendees/:attendeeId/proposal` | `meetings.meeting.edit` | The organiser accepts or declines a proposed time. Accepting moves the meeting and asks everyone again (ADR 0021). |
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
| `updateMyEmployeeProfile(patch: MyProfilePatch)` | `Employee` | `PATCH /me/employee` | The signed-in person, on their own record | The person's own contact details in the portal. |
| `saveTimesheet(input: TimesheetInput)` | `Timesheet` | `PUT /timesheets/:id` | `hr.timesheet.edit` on one's own sheet, `hr.timesheet.approve` on anyone else's | Saves a week's hours (spec C1, C2). A rejected sheet keeps its status until it is submitted again. |
| `submitTimesheet(id: string)` | `Timesheet` | `POST /timesheets/:id/submit` | `hr.timesheet.edit` on one's own sheet, `hr.timesheet.approve` on anyone else's | Sends a sheet for approval and tells the people who can decide it (spec C2). |
| `decideTimesheets(ids: readonly string[], decision: TimesheetDecision)` | `void` | `POST /timesheets/decisions` | `hr.timesheet.approve` | Approves or rejects submitted sheets (spec C1, ADR 0024). A rejection needs a reason and never changes the hours; nobody decides their own sheet, the same two-person idea as payments. |
| `reopenTimesheet(id: string, reason: string)` | `Timesheet` | `POST /timesheets/:id/reopen` | `hr.timesheet.approve` | Reopens an approved sheet with a reason, until its pay period is exported (ADR 0024). |
| `uploadTimesheets(input: { table: ImportTable; fileName: string; apply: boolean; own: boolean; })` | `TimesheetUploadResult` | `POST /timesheets/upload` | `hr.timesheet.edit` for one's own rows in the portal, `hr.timesheet.approve` otherwise | Bulk hours from the template (spec C1, C2): the same rows and checks as the import wizard. With `apply` false it is a dry run. In the portal only the signed-in person's rows go through. |
| `clockIn()` | `void` | `POST /me/clock-in` | `hr.portal.view` | Clocks in (spec C2); only when the company uses the clock. |
| `clockOut()` | `void` | `POST /me/clock-out` | `hr.portal.view` | Clocks out and adds the hours to this week's draft timesheet (spec C2, ADR 0024). |
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
| `acknowledgePlan(assignmentId: string, signedName: string)` | `void` | `POST /commissions/assignments/:id/acknowledge` | The rep the plan is assigned to | The rep signs their plan; a typed name stands in for e-signature in the demo (Labor Code 2751, ADR 0025). |
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
| `rescheduleMeeting(move: MeetingMove)` | `{ meetings: Meeting[]; conflicts: Conflict[]; undo: MeetingUndo }` | `POST /meetings/:id/reschedule` | `meetings.meeting.edit` | Moves or resizes a meeting occurrence (spec F) and tells the guests (ADR 0021): one occurrence goes out with RECURRENCE-ID, "this and following" splits into a new UID, and "all" updates the series. |
| `undoReschedule(undo: MeetingUndo)` | `Meeting` | `POST /meetings/:id/reschedule/undo` | `meetings.meeting.edit` | Puts a meeting back as it was before a move, removing a series the move split off. |
| `saveSupplier(input: SupplierInput)` | `Supplier` | `PUT /suppliers/:id` | `purchasing.supplier.create` for a new one, `purchasing.supplier.edit` for an existing one | Adds or edits a supplier (spec B1). Only a name is required, so one can be added in the middle of a purchase order and finished later; a supplier added that way has terms of pay on order and no credit (ADR 0022). |
| `setSupplierStatus(id: string, status: Supplier["status"])` | `Supplier` | `POST /suppliers/:id/status` | `purchasing.supplier.edit` | Deactivates or reactivates a supplier (ADR 0022): never deleted, and one with an open order or a balance stays active. Inactive suppliers leave the pickers and stay in history. |
| `saveSupplierContact(input: SupplierContactInput)` | `SupplierContact` | `PUT /supplier-contacts/:id` | `purchasing.supplier.create` for a new one, `purchasing.supplier.edit` for an existing one | Adds or edits a contact (spec B1, B2): a name plus an email or a phone. The first contact of a supplier becomes primary, and marking another clears the old one. |
| `setContactStatus(id: string, status: SupplierContact["status"])` | `SupplierContact` | `POST /supplier-contacts/:id/status` | `purchasing.supplier.edit` | Deactivates or reactivates a contact (ADR 0022). When the primary leaves, the oldest active sales rep takes over, then the oldest active contact. |

## Errors and the simulated network

- Every failure a person should read is an `ApiError`. Reads surface it through `useApiQuery` (status `error`, with `retry`) and `QueryFallback`; a failed save that a screen does not catch is shown as a toast by `useApiErrorToasts`.
- `withSimulatedNetwork` (`lib/api/network.ts`) wraps the client. The presenter guide's Network control sets normal, slow (each call waits 1.5 s) or offline (each call fails with an `ApiError` before it runs, so nothing is saved). It affects the next request only and resets on reload. `setViewer`, `subscribe`, `today` and `openCompany` are not simulated. A real client needs no change: the wrapper only delays or fails calls.
