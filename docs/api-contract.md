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

## Errors and the simulated network

- Every failure a person should read is an `ApiError`. Reads surface it through `useApiQuery` (status `error`, with `retry`) and `QueryFallback`; a failed save that a screen does not catch is shown as a toast by `useApiErrorToasts`.
- `withSimulatedNetwork` (`lib/api/network.ts`) wraps the client. The presenter guide's Network control sets normal, slow (each call waits 1.5 s) or offline (each call fails with an `ApiError` before it runs, so nothing is saved). It affects the next request only and resets on reload. `setViewer`, `subscribe`, `today` and `openCompany` are not simulated. A real client needs no change: the wrapper only delays or fails calls.
