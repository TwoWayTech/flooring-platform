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
  - **What the server sets:** status, sent and expiry dates change only through `POST /quotes/:id/status`, using the shared `quoteActions` and `quoteSendProblems`. The rep and the number (taken under a lock) are the server's. The branch is always the warehouse's, re-derived whenever the warehouse changes, so data scope follows where the quote is fulfilled from.
  - **States:** a job-site or address state is trimmed, uppercased and must be a real US code. A send needs one. Tax rules match the code exactly, so a lowercase or made-up state would otherwise collect nothing (PR #14 security review).
  - **References:** each roll belongs to its line's product and is in stock; line warehouses and the sold-at location are live. Drawing rooms needs the Retail module and `retail.room.measure`.
  - **Totals:** computed on the server with the shared `computeTotals` and the tax engine (`taxContextFor` → `resolveTaxRule` → `withOverride`). The engine reads the company's own tax rules, county rates and company default, on today's date in the company's time zone. A total sent by the screen is ignored.
  - **Line cost, category and unit:** come from the catalog, never from the request (rule 5; the category decides tax). A line without a product keeps its saved category; adding one or changing its category needs `sales.tax.override`. Cost is stripped without `inventory.product.view_sensitive`.
  - **Moving the job site:** a quote with a tax override cannot change state or county without `sales.tax.override`. Sending prices the quote again on the day it goes out.
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

## A cost the server withheld, on the web (2026-11-16, STATUS B1)
- **Status:** accepted, 2026-11-16, on branch `fix/sales-quote-without-cost` (PR #46, stacked on PR #45). It is the third bug of the owner's queue of 2026-11-16 (STATUS "Api-mode bugs the flows found", B1). ADR 0058 is reserved by the paused whole-product check, so this is a dated section of the sales ADR that set up quote stripping. Session log docs/sessions/2026-11-16-2320-b-quote-without-cost.md.
- **Context:** the API strips `cost` and `unitCost` for anyone without `inventory.product.view_sensitive` (CLAUDE.md rule 5; `SENSITIVE_FIELDS`), so in api mode a salesperson's products and quote lines arrive without them. The web's `lineFor` copied the missing `product.cost` into a new line, and `computeTotals` multiplied by it on every render. `new Decimal(undefined)` threw, and the quote builder showed "This screen stopped working." once a quote had a product line. Saved quotes, the save's answer and a status change's answer broke the same way. The server was already right: `trustedLines` costs every line from the catalog or the saved line and ignores a sent cost.

### Decisions
- **A withheld cost is unknown, never zero** (D1, D2). `computeTotals` takes `ViewedDocLine`, a `DocLine` whose `unitCost` may be absent or null. When any line lacks it, the document's `cost`, `margin` and `marginPct`, and that line's `cost`, are null: never zero (a 100 % margin) and never a sum of the known costs (an understated cost). Amounts, tax and total never depend on cost. One calculator with nullable outputs, so every consumer handles the unknown case at compile time and sales.md rule 13's single calculator stays true.
- **Stored lines keep a required cost** (D3, D4). `DocLine.unitCost` stays `string`. A document being stored takes its cost through `storedCost`, which throws "A document line has no cost, so the document can't be stored." on null. It is used at the four places that store a cost: `invoiceFromQuote`, `invoiceFromJob`, the fixtures' `documentAmounts` and the business-report gate test. None can meet a null today (the API reads `unit_cost NOT NULL` rows or `trustedLines`' lines; DemoStore's lines always carry cost), and throwing beats storing `0`.
- **A new line never fills in a cost** (D7). `lineFor` moved to `packages/shared/src/operations/quotes.ts` as the exported `quoteLineFor`, unit-tested: a product without `cost` gives a line whose JSON has no `unitCost`. The client never sends a cost it doesn't hold, and the server ignores one anyway. Its two identical `measuredFromRooms` branches collapsed into one.
- **A quote's margin needs both keys and a known cost** (D5, D6). `seesQuoteMargin` (shared, next to `SENSITIVE_FIELDS`, CLAUDE.md rule 4) needs `sales.margin.view_sensitive` and `inventory.product.view_sensitive`, because margin is the subtotal less cost and gives the cost away, as the reports' margin flag already says (ADR 0055 S17). `QuoteSummary` shows the Margin row, with Cost under it, only with both keys and a non-null cost; it is hidden, with no "not available" note, as every sensitive field is. In api mode the null check alone hides it, since the server withholds cost; the key rule changes only the demo, where DemoStore sends cost to every browser, and makes the two modes agree. No default role changes; a custom role with the margin key but not product cost loses a quote's margin in the demo.
- **No server change.** An API test pins the contract the client relies on (D13): a line sent without `unitCost` is costed from the catalog, the rep's answers never carry cost, the manager's do, and a cost sent with a save is ignored.
- **DemoStore is unchanged** (D8). It never lacks cost (sales.md known gaps), so the demo can't exercise a withheld cost; its e2e run is regression only.
- **F1 runs again** (D11, D12), with rule 5 checked the other way (Priya's quote request and its answer carry no `unitCost`; her summary shows no margin) and three clean-ups (void the invoice, void the deposit, reject the final payment while it waits). None voids a confirmed final payment, which would post entries after a passing run.

### The audit: every place a withheld cost meets decimal maths
- **Fixed here:** the quote builder (new lines, saved quotes, the save's and status change's answers) and its summary. `quoteLineFor` is the only place the web builds a document line; invoices are built on the server.
- **Safe:** the invoice page and lines, the payment sheet, credit notes, contracts (`estimatedCost` is optional and its input is behind `seesCost`), roll quick invoices, and the reports, which are worked out on the server in api mode.
- **B5, recorded, not fixed:** a salesperson's dashboard (her landing page) shows "This page could not load its data." in api mode, because `GET /invoices` withholds invoice `cost` and `monthlyPnl`, `salesTotals`, `bestSellersIn` and the margin sparkline add or subtract it. Sales → Team's `teamStats` reads it too, but loads today only because its people still come from DemoStore, whose ids match no API invoice. The fix needs this section's unknown-cost rule and the both-keys rule for the margin displays gated by the margin key alone, and it changes `monthlyPnl`, which feeds the API's P&L, so it has its own PR and security review. Its test is committed as `fixme` in `apps/web/tests/e2e-api/sales.spec.ts`.
- **Listed for later:** the cost displays gated only by the shell's `can()` (`product-drawer.tsx`, `roll/roll-page.tsx`, `products-table.tsx`, `rolls-table.tsx`, `purchasing/order-drawer.tsx`) crash in `formatNumber(undefined)` only when the shell's permissions say yes while the server stripped the cost, which no default role reaches; they go with the `GET /company` move (D19). The installation jobs move must handle a withheld `jobCost`, `laborCost` and `jobMargin`.
- **Not B1:** O2, the payment sheet's "Status after" preview (a different screen and rule).

### Follow-ups
- Typed "as received" records, so the contract types say which fields may be withheld (`Product.cost`, `DocLine.unitCost`, `Invoice.cost`, `ContractLine.estimatedCost`, `Employee.payRate`).
- DemoStore stripping cost like the API, so the demo meets the same paths.
- The View as banner's wording for a margin-only role, after B5 (D18).
- B6, found while testing: a saved quote can't be saved again in api mode (the API answers percents at `numeric(18,8)` scale, which its own percent check refuses, and its waste check compares text). Its own PR with a security review.
