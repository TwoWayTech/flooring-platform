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
| `takeNotices()` | none | Messages for the person once, such as saved demo changes from an older version that had to be reset. Reading clears them. |

## Platform (super-admin)

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `listCompanies()` | `GET /platform/companies` | Status, plan, products, modules, ceiling, limits. |
| `updateCompanyAccess(id, patch)` | `PATCH /platform/companies/:id/access` | Modules, ceiling, user and branch limits. Takes effect at once and is written to the company's audit log as "Platform admin". |
| `listCompanyDirectory(id)` | `GET /platform/companies/:id/directory` | Roles, users and branding, read-only. Used by the login page and the company access page. |

## Company and settings

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `getCompany()` | `GET /company` | The open company's platform record. |
| `getSettings()` | `GET /settings` | Branding, localization and tax, number format, profile. |
| `updateSettings(section, value)` | `PUT /settings/:section` | Replaces one section; audited with a before/after summary. |
| `getDefaultSettings()` | `GET /settings/defaults` | The company's original settings, for Reset to default; the page puts them in its draft and saves through `updateSettings`. |
| `resetSettings(section)` | `DELETE /settings/:section` | Restores one section to the company's original values; audited. |

## Records

`list`, `get` and `save` work on these collections: `roles`, `users`, `locations`, `products`, `rolls`, `stockMovements`, `transfers`, `customers`, `quotes`, `invoices`, `payments`, `suppliers`, `purchaseOrders`, `bills`, `billPayments`, `expenses`, `crews`, `jobs`, `employees`, `timesheets`, `ptoRequests`, `commissions`, `meetings`, `audit`.

| Method | Real endpoint | Behaviour |
| --- | --- | --- |
| `list(collection)` | `GET /:collection` | Filtered by data scope. Own: quotes, invoices, payments and customers of the user as sales rep; jobs led by the user; the user's own timesheets, PTO, commissions and meetings. Branch: sales documents and customers of the user's branch. All: everything. |
| `get(collection, id)` | `GET /:collection/:id` | Undefined when missing or outside scope. |
| `save(collection, item, audit?)` | `PUT /:collection/:id` | Creates or replaces; writes the audit entry when given. Refused unless the viewer holds one of the collection's write permissions (`lib/api/demo/permission-rules.ts`); `stockMovements`, `transfers`, `expenses`, `commissions` and `audit` are written only by domain actions. |

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
| `cutRoll(rollId, lengthFt, reference)` | `POST /rolls/:id/cuts` | Refuses lengths of 0 or more than is left. Records the cut with the user and time. A full roll's leftover under 12 ft becomes a remnant (new roll record, parent linked) and the roll is used up. Audited. |
| `saveQuote(quote)` | `PUT /quotes/:id` | A new quote gets the next number with the company's quote prefix. Audited. |
| `convertQuoteToInvoice(quoteId)` | `POST /quotes/:id/invoice` | Refuses quotes already invoiced or without lines. Recomputes totals under the job-site state's tax rule, stores the rule version, numbers the invoice with the invoice prefix, dates it today with the customer's terms, and marks the quote invoiced. Audited. |
| `createPurchaseOrder(input)` | `POST /purchase-orders` | Numbers the order with the PO prefix, totals lines in cents, starts as sent. `locationId` is the receive-into warehouse. Audited. |
| `receivePurchaseOrder(poId)` | `POST /purchase-orders/:id/receive` | Cartons become receipt lines in the stock ledger at the receive-into warehouse; broadloom arrives there as new rolls measured in ft (sq yd × 9 ÷ width) with cost per sq ft. Audited. |
| `createTransfer(input)` | `POST /transfers` | Needs `inventory.transfer.create`. Both ends must be different warehouses; boxed quantities whole and no more than the sender holds; rolls at the sender and not travelling. Boxed stock leaves the sender at once; rolls are marked in transit. Numbered TR-1001 up. Audited. |
| `receiveTransfer(id)` | `POST /transfers/:id/receive` | Needs `inventory.transfer.receive`. Boxed stock arrives at the receiver; rolls move there to bin Receiving. Audited. |
| `saveLocation(location)` | `PUT /locations/:id` | Needs `settings.locations.manage`. Keeps exactly one default, which must be a warehouse; a location holding stock cannot become a showroom. Audited. |
| `updateMyProfile(patch)` | `PATCH /me` | The signed-in person's own default warehouse (a warehouse, or null for the company default). Audited. |
| `billPurchaseOrder(poId, billNumber)` | `POST /purchase-orders/:id/bill` | Only received orders; the bill takes the PO total and the supplier's terms. Audited. |
| `payBill(billId)` | `POST /bills/:id/payments` | Pays the open balance in full and records the bill payment. Audited. |

## Errors and the simulated network

- Every failure a person should read is an `ApiError`. Reads surface it through `useApiQuery` (status `error`, with `retry`) and `QueryFallback`; a failed save that a screen does not catch is shown as a toast by `useApiErrorToasts`.
- `withSimulatedNetwork` (`lib/api/network.ts`) wraps the client. The presenter guide's Network control sets normal, slow (each call waits 1.5 s) or offline (each call fails with an `ApiError` before it runs, so nothing is saved). It affects the next request only and resets on reload. `setViewer`, `subscribe`, `today` and `openCompany` are not simulated. A real client needs no change: the wrapper only delays or fails calls.
