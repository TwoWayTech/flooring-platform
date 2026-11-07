# API contract

Every screen reads and writes data through the `ApiClient` interface in `apps/web/src/lib/api/contract.ts` (CLAUDE.md rule 1). The demo implementation is `DemoStore` (`apps/web/src/lib/api/demo/`): generated fixtures moved to today's date, plus a per-company localStorage overlay. `NEXT_PUBLIC_DATA_SOURCE=demo` selects it. To connect the real API, write an HTTP client that implements the same interface and select it in `apps/web/src/lib/api/index.ts`. Screens do not change.

The tenant always comes from the session, never from a parameter, as it will on the real server. The suggested REST endpoints below are what the real client would call.

## Session (real route handlers, already live in the demo)

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

## Platform (super-admin)

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `listCompanies()` | `GET /platform/companies` | Status, plan, products, modules, ceiling, limits. |
| `updateCompanyAccess(id, patch)` | `PATCH /platform/companies/:id/access` | Modules, ceiling, user and branch limits. Takes effect at once and is written to the company's audit log as "Platform admin". |
| `listCompanyDirectory(id)` | `GET /platform/companies/:id/directory` | Roles and users, read-only. |

## Company and settings

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `getCompany()` | `GET /company` | The open company's platform record. |
| `getSettings()` | `GET /settings` | Branding, localization and tax, number format, profile. |
| `updateSettings(section, value)` | `PUT /settings/:section` | Replaces one section; audited with a before/after summary. |

## Records

`list`, `get` and `save` work on these collections: `roles`, `users`, `products`, `rolls`, `customers`, `quotes`, `invoices`, `payments`, `suppliers`, `purchaseOrders`, `bills`, `billPayments`, `expenses`, `crews`, `jobs`, `employees`, `timesheets`, `ptoRequests`, `commissions`, `meetings`, `audit`.

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `list(collection)` | `GET /:collection` | Filtered by data scope. Own: quotes, invoices, payments and customers of the user as sales rep; jobs led by the user; the user's own timesheets, PTO, commissions and meetings. Branch: sales documents and customers of the user's branch. All: everything. |
| `get(collection, id)` | `GET /:collection/:id` | Undefined when missing or outside scope. |
| `save(collection, item, audit?)` | `PUT /:collection/:id` | Creates or replaces; writes the audit entry when given. Domain actions (cut roll, convert quote) are built on this and documented with their screens. |

## Users and roles

| Method | Real endpoint | Rules enforced |
| --- | --- | --- |
| `inviteUser(input)` | `POST /users` | Seat limit: active and invited users count; disabled users free a seat. |
| `updateUser(id, patch)` | `PATCH /users/:id` | At least one active Owner remains. New roles must hold only permissions the granter holds; only an Owner makes an Owner. |
| `saveRole(role)` | `PUT /roles/:id` | Owner role is locked. No permission the granter does not hold can be added. |
| `deleteRole(id)` | `DELETE /roles/:id` | Default roles cannot be deleted; roles still held cannot be deleted. |
| `recordAudit(entry)` | `POST /audit` | Appends an entry as the signed-in user. |

Rule failures throw `DemoRuleError` with a message written for the presenter; the real client maps HTTP 403 and 409 responses to the same error.

## Domain actions

Added with their screens below.
