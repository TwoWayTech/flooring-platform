# ADR 0037: Sales on the API, part 1 (customers, quotes and the tax engine)

- **Status:** accepted, 2026-11-14
- **Context:** the owner's second work queue, task 5: P11 sales with the tax engine (docs/product-spec/sales.md). Sales is the largest module, so it lands in two parts. This one covers customers, quotes and the tax engine. The next covers invoices (conversion, sent, void, credit notes), reservations with the cut or issue (inventory part 2), payments with the two-person check, write-offs, credits and refunds.

## Decision
- **Data scope** (spec "Data scope"): customers and quotes are read and changed only within the person's scope. Own is by rep; branch is by the quote's branch, and for a customer by the rep's branch; all is everything. Anything outside the scope answers 404.
- **Customers:**
  - **Adding:** needs only a name. The person becomes the rep, and the company's default terms apply.
  - **Editing:** changes the name, contact details, terms and addresses. New addresses get server ids, the defaults follow them, and removed addresses are soft-deleted.
  - **Fields never taken from a request:** credit limit, tax exemption, certificate and rep have no edit screen. The credit limit is stripped without `customers.customer.view_sensitive`.
- **Quotes:**
  - **What the server sets:** status, sent and expiry dates change only through `POST /quotes/:id/status`, using the shared `quoteActions` and `quoteSendProblems`. The rep, the branch (the warehouse's) and the number (taken under a lock) are the server's.
  - **Totals:** computed on the server with the shared `computeTotals` and the tax engine (`taxContextFor` → `resolveTaxRule` → `withOverride`). The engine reads the company's own tax rules, county rates and company default, on today's date in the company's time zone. A total sent by the screen is ignored.
  - **Line cost:** comes from the catalog, never from the request (rule 5), and is stripped without `inventory.product.view_sensitive`.
  - **Rights:** a waste change needs `sales.waste.view`. A tax change needs `sales.tax.override`, a valid rate and a reason; who changed it and when are recorded by the server, and the change is audited on its own.
  - **Rooms and lines:** replaced as a whole on each save, with line room links following the rooms' new ids.
  - **Email:** `quote.sent` emails the customer through NotificationService.
- **Settings:** a company with no localization settings yet answers 409 `settings_missing`. This fails closed: no quote is priced without its tax rules.
- **Seed:** Summit's customers with their addresses, contacts and certificates, and its quotes with their rooms and lines.
- **Web:**
  - The Sales and quote pages read through `salesData()`. The quote page reads its products, rolls and stock through `inventoryData()`, so its ids match the API.
  - `createCustomer`, `saveCustomer`, `saveQuote` and `updateQuoteStatus` are in API_METHODS.
  - Invoices stay on the demo until part 2.

## Accountant decisions (STATUS)
- **Where the company collects tax:** which states it is registered in, and its states of operation, stay company settings (Settings → Localization). The safe default collects only where a rule exists for the job site, or the company default in its states of operation.
- **Rates and taxability per state:** these are the accountant's to confirm. The seeded rules carry the demo's example note.
