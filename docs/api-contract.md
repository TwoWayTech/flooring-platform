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
| `POST /employees`, `PUT /employees/:id` | `hr.employee.create`, `hr.employee.edit` | `{ name, title, department, workerType, payType, payRate?, state, email, phone, hiredAt, status, managerId, flsaStatus, exemptionBasis, salaryHoursPerWeek, commissionVisible, homeLocationId, emergencyContact, userId? }`: hr.md rule 2 applied; `payRate`, `payType` and `salaryHoursPerWeek` taken only with view_sensitive, else the stored ones stay; nobody changes the rate, pay type, worker type, FLSA status or salaried hours on their own record; `userId` links a member's sign-in (null unlinks; never one's own). A new person gets the onboarding checklist. Audited |
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
| `GET /pay-periods/:id/review` | `hr.payroll.view` | `{ period, rows: { line, employee, excludedReason }[], blockers, strandedCommission: { statementId, userId, name, month, reason }[], contractors, contractorNames }`: the frozen lines once approved, else every payable person's line worked out now (`grossPay`, with the commission of approved, unpaid statements, ADR 0048) and the weeks that block approval; before approval, `strandedCommission` lists approved, unpaid statements with something to pay whose rep is unlinked, a 1099 contractor or has left (no amounts). `employee` carries work facts and the email only |
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
| `GET /commissions` | `hr.commission.view` | `{ statements: CommissionStatementRow[], plans, assignments, people: { id, name, active }[], invoices: { id, number, salesRepId, isReturn, voidedAt }[] }`: everyone's statements for the last twelve months worked out by the shared engine (`commissionStatementRows`); an approved or paid statement shows the payable its approval posted. Each line carries the `basis` that produced its base (on a split sale, the first member's plan); a line whose basis is `gross_margin` has `base` `null` without `sales.margin.view_sensitive`. No invoice amounts or cost |
| `POST /commission-statements/approve` | `hr.commission.approve` | `{ userId, month }`: an ended, open month with no reversal waiting for review, every earlier month with commission approved first; not one's own (the Owner included); unless the Owner, not one the approver adjusted, decided a reversal on, set the assignment or plan of (created or audited), or set the commission split of a sale in (a live split row or a "Changed commission split" entry), or set the manager of the person or of anyone whose override is on it. A payable above zero needs the rep linked to a W-2 employee. Stores the statement `approved` and posts debit Commissions (6060) at the rep's home location, credit Accrued Payroll, dated the month's end (409 `period_closed` when closed). Emails `commission.ready` (restricted, no amounts) after commit. Audited. Returns `CommissionStatement` |
| `POST /commission-adjustments` | `hr.commission.adjust` | `{ userId, month, amount, invoiceId, reason }`: `adjustmentProblem` (dollars and cents, up to twelve digits, at most 1,000,000.00 either way); one of the last twelve months, after the person's last approved one; a deduction names a live invoice they sold (as rep or in its split). Posts nothing: it nets into the statement. Audited as an addition or deduction |
| `POST /commission-reversals/decide` | `hr.commission.approve` | `{ userId, month, lineId, outcome: "applied" | "waived", reason }`: the line must be a reversal waiting for review on that statement; month open as for adjustments. Recorded as a 0.00 adjustment with `decides`. Audited |
| `POST /commission-plans` | `hr.commission.manage` | `{ name, basis, baseRatePct, monthlyTarget, tierMode, tiers, overridePct, draw, clawbackDays }` (`commissionPlanProblem`): version 1, active, from today. Name and version unique. Audited |
| `PUT /commission-plans/:id` | `hr.commission.manage` | Same body. An active plan only, not one the saver is on, nor one paying (or about to pay) an override while one of its people reports to the saver. Edited in place while no approved or paid statement exists from its start; otherwise version + 1 from today, the old one retired yesterday and its people moved over unsigned. Audited (`Edited commission plan` or `Published new version of commission plan`, plus `Moved commission assignment to new plan version` per assignment ended, moved or created) |
| `POST /commission-assignments` | `hr.commission.manage` | `{ userId, planId, effectiveFrom, monthlyTargetOverride? }`: a member who is not disabled, never oneself, nor one's own report on a plan that pays an override; an active plan already in force that day; after the end of the person's last approved month. Ends a running assignment the day before and replaces one starting on or after it. Unsigned. Audited |
| `GET /commission-totals?from&to` | `sales.commission.view` | Module `core`, and 404 without the `hr` module; switches `sales.team` and `hr.commissions` (404 when either is off). `[userId, { earned, paid, pending }][]` for lines confirmed in the range (`commissionTotals`); data scope `all` sees everyone, anyone else themselves (all their lines) and the reps on invoices their scope covers (only those invoices' lines) |

A statement is paid through a pay run (`POST /pay-periods/:id/approve`, then `/export`): the run pays each approved statement's posted amount and debits Wages only for the rest of the gross, so the commission is expensed once.

## Employee portal (real build, ADR 0049)

Module `hr`, switch `hr.portal` (404 when off), key `hr.portal.view`. Every route acts on the signed-in person: the user from the verified session and the employee linked to their sign-in (`user_profiles.employee_id`). No route takes a person, employee, user or company id. Money and hours are decimal strings. Bodies are strict.

| Route | Needs | Does |
| --- | --- | --- |
| `GET /me/portal` | `hr.portal.view` | `MyPortal` for the signed-in person only (employee-portal.md rules 1 to 11, `portalVisibility`). Narrowed on the server: `visible.pay` needs `hr.pay-periods`; `visible.commission` needs `hr.commissions` and the `core` module; `visible.rates` needs the company setting and `hr.employee.view_sensitive`; `visible.teamCalendar` needs `hr.time-off` and a linked employee; `visible.clock` needs `hr.clock`, `hr.timesheets`, the company's clock setting and a designated workweek. `employee` is one's own record, without `payRate` unless `visible.rates`. `timesheets` (`TimesheetWire`) and `requests` and `balances` for W-2 people only. `pay`: approved or exported runs with one's own stored line, newest first, each `period` with `lines` and `excluded` empty, the line through `ownPayLine` (hidden commission and its true-up leave the total, and `weeks` is empty); rate fields stripped without view_sensitive. `statements`, `assignment` and `plan` only when commission is shown (otherwise empty and null), the margin base hidden without `sales.margin.view_sensitive`. `contractorPayments`: one's own, for a 1099 worker. `teamOut`: for a linked W-2 person, approved requests ending at most 92 days ago or later, of colleagues who have not left, with `kind` `vacation` and `policyId`, `hours`, `note`, `decidedBy`, `decidedAt` and `decisionReason` blank; `teamNames` only the people in it. An unlinked person gets an empty overview |
| `PATCH /me/employee` | `hr.portal.view` | `{ phone, emergencyContact }` (`MyProfilePatch`): nothing else, on the employee linked to one's sign-in (400 when unlinked); trimmed; returns the record as `GET /me/portal` shows it. Audited as `Updated own profile` with the phone before and after and only whether the emergency contact changed; a save that changes nothing writes nothing |
| `POST /commission-assignments/:id/acknowledge` | `hr.portal.view` | `{ signedName }`: switch `hr.commissions` and the `core` module (404 otherwise). Under the payroll lock: the assignment must be the signed-in user's (404 otherwise), running, unsigned, and shown on My commission; the name must be the account's, ignoring case and surrounding spaces. Audited as `Signed commission plan`, no amounts. `{ ok: true }` |

`GET /files/:id` also opens, with `hr.portal.view` and the `hr.portal` switch, the documents of the employee linked to the reader's own sign-in, and no one else's. The clock routes are under "HR, part 1". My meetings stays on the demo client until Meetings moves.

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
| `acknowledgePlan(assignmentId: string, signedName: string)` | `void` | `POST /commission-assignments/:id/acknowledge` | `hr.portal.view`; the rep the plan is assigned to, with My commission shown | The rep signs their plan; a typed name stands in for e-signature in the demo (Labor Code 2751, ADR 0025). |
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
