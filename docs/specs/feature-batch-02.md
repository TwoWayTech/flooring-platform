# Feature batch 2: client notes for the demo

Spec for Claude Code. Save this file as `docs/specs/feature-batch-02.md` in the repo. It turns the client notes into one ordered build. Appendix A is the customer-payments specification, kept word for word; the rest of this file says how it fits with everything else.

## 0. How to work

1. Read `CLAUDE.md`, `docs/FEATURES.md`, `README.demo.md`, `docs/demo-spec.md` and this file before anything else.
2. **Phase 0, plan (then stop for my OK).** In a short plan:
   - Map where things live today: quotes, invoices, statuses, balances, customer statement, receivables aging, inventory and roll cuts, purchasing, dashboard widgets, meetings calendar, notifications, audit log, roles and permissions, settings pages, DemoStore persistence and schema version, seed fixtures, presenter guide, command palette, the "Network" simulation (Normal / Slow / Offline), money, unit and rounding helpers, table component, drawers and forms.
   - List the data-model changes and the DemoStore migration.
   - List every **ASSUMPTION** (Appendix B) and any conflict you see, with your recommendation.
   - Add every item of this file to `docs/STATUS.md` as a checklist under "Feature batch 2", in batch order, so `/continue` can resume.
3. After my OK, build batch by batch in the order below without stopping. For each item: follow the `/feature-change` rules without asking per item (feature key in `packages/shared`, row in `docs/FEATURES.md`, ADR for model changes, entry in `docs/blueprint-delta.md`), add tests, commit and push, tick `STATUS.md`. Run the full suite at the end of every batch.
4. **Demo constraints stay:** front end only; data through `apiClient` and DemoStore (localStorage), files in IndexedDB behind a storage interface; money with the existing decimal helpers; units through `packages/shared/units`; permission checks in the UI **and** in the save logic; reuse existing components and patterns; never add a second way of doing something that already exists.
5. **DemoStore migration:** bump the schema version. Saved browser data from the current demo must upgrade cleanly; if it can't, reset to the new fixtures with a clear message. Seed data must still pass the reconciliation test.
6. **Quality floor:** keyboard accessible, labelled fields, errors next to fields with focus on the first error, 375 px and up, light and dark, reduced motion respected, no console errors. The existing 189 tests keep passing; update a test only when this spec intentionally changes the behaviour it checks, and say which.
7. **End:** redeploy production, rerun the suite against both live addresses, update `README.demo.md`, `docs/demo-script.md` and the presenter guide, and report what changed, how to try each item (persona, company, record), and anything assumed or left out.

---

## Batch A: foundations

### A1. Warehouses and showrooms
- A location is either a **Warehouse** (holds sellable stock, ships to customers) or a **Showroom** (display and samples only; never holds sellable stock).
- Seed: Summit Floor Co. gets 2 warehouses (Denver Central, Colorado Springs) and 2 showrooms; Keystone Flooring Supply gets 2 warehouses and 1 showroom. Invented names and addresses.
- Every roll and carton stock record belongs to one warehouse (and bin).
- **Transfers** between warehouses: a transfer document (from, to, items, status In transit / Received) that moves stock.
- Quotes, invoices, purchase orders and receipts carry a **Fulfilled from / Receive into** warehouse. Default: the user's default warehouse (new user-profile setting), else the company default.
- A **Warehouse filter** and column on inventory, rolls, quotes, invoices, purchase orders, receipts, supplier bills, reports and the dashboard.

### A2. Filters on every table
One standard table behaviour everywhere (extend the existing table component; don't fork it):
- Global search; a filter on **every column** (text contains, multi-select for statuses and types, ranges for numbers, money and dates); sorting; show and hide columns.
- Active filters shown as removable chips, a result count, and **Clear filters**.
- Filters live in the URL, so links and the back button keep them; each user's last view per table is remembered.
- CSV export respects the current filters. Money columns get a totals row for the filtered set where that makes sense.

### A3. Company admins control roles and pages
The platform owner sets each company's ceiling; inside it, the company Owner (and anyone with `settings.roles.manage`) controls what each role can see and do.
- Every page maps to a **view** permission; every action button maps to an action permission. A role without view permission doesn't see the menu item, and opening the URL directly shows the standard "You don't have access to this page" state.
- **Predefined roles stay**: they keep a "System" badge, can't be deleted, can be edited (except Owner), and have **Reset to default**. **Duplicate** creates a custom role from any role.
- The company admin gets the same **effective access preview** the platform owner has: pick a role or user and see every page, action and sensitive field they get.
- Add the new permissions from this batch to the matrix (payments, purchasing, inventory adjustments, waste visibility, commissions, tax override, data import), all inside the existing ceiling logic.

### A4. Settings that stay easy to read
Apply to every settings page in both products:
- Settings home grouped as: Company; People and access; Sales and documents; Inventory and warehouses; Tax and localization; Payments; Commissions; Data import and integrations.
- Each page: a plain title, one sentence saying what it controls, then toggles and checkboxes with a short helper line each. Keep the current tick style of the permission matrix.
- Changed fields are highlighted, with a sticky **Save / Discard** bar; each section has **Reset to default**; a search box finds any setting; every change goes to the audit log.

### A5. Default tax rates
- Settings → Localization and tax: a **company default tax rate** plus default rates per state and jurisdiction, with effective dates (keep the existing rules engine; this adds defaults on top).
- New quotes and invoices fill tax automatically: job-site or ship-to address → jurisdiction rule → state default → company default. Under the tax line, show where the rate came from (e.g. "Default rate for Colorado (example)").
- Changing tax on one document needs `sales.tax.override` (Owner, Accountant by default), asks for a reason, and is audited.
- All seeded rates stay labelled "Example: confirm with your accountant".

### A6. Customers: quick add, many addresses, address suggestions
- **Call-centre style customer picker** in the quote builder, invoice and job card: search by name, phone, email or company; each result shows type and primary address. The last option is **Add "<typed text>" as a new customer**: a small inline form (name required; phone, email and type optional, type defaults to Homeowner). It saves at once as a real customer with a "New, profile incomplete" badge, completed later from the customer drawer.
- A customer has **many addresses**, each with a label (Home, Billing, Job site, Delivery) and defaults for billing and job site. After choosing a customer, the address picker lists their addresses plus **Add new address**.
- **Address suggestions:** the user types freely ("123 Main", "Sacramento, Calif…") and a dropdown suggests full addresses; choosing one fills street, city, state, ZIP, county and coordinates. **Enter manually** is always available. County feeds the tax jurisdiction.
- Put suggestions behind an `AddressProvider` interface with two providers:
  - `demo` (default, works offline, no key): seeded with about 300 realistic US addresses and the US city and state list.
  - `google`: active only when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set. Use Places API (New) Autocomplete with **session tokens**, closed by one Place Details call; US only; 250 ms debounce; start at 3 characters; request only address fields (formatted address, address components, location). Document in `README.demo.md` how to create the key, enable the API and restrict the key to the two Vercel domains.
- Also used in the supplier form and company profile.

---

## Batch B: the sales flow

### B1. Quotes: Draft and Pending
- Statuses: **Draft** (saved, not sent; only a customer name required) → **Pending** (sent, waiting for the customer; optional expiry date) → **Accepted** → **Converted** (to invoice) or **Declined** / **Expired**.
- **Save as draft** is available at every point of quote creation; **Send / mark pending** runs full validation.
- Quote list: status filter and columns for value, salesperson, warehouse, expiry, age.
- Dashboard: a **Pending quotes** metric (count, total value, oldest age) linking to the filtered list (see E1).

### B2. Invoice lifecycle and payments
Build **Appendix A** in full. Client note 9 asks to "change the status to whatever we select" with mandatory fields; reconcile it with Appendix A like this:
- No free status dropdown. The invoice page has an **Update status** menu offering only the valid next actions for its current state: Record deposit, Record payment (partial or full), Mark as sent, Apply credit, Write off remaining balance, Void invoice. Each opens its form with the mandatory information (amount, method, reference, **proof file**, reason where needed). The status then follows from the data, as Appendix A defines.
- Add the label **Deposit paid** when confirmed payments match the quote's deposit (or a payment recorded as a deposit) and a balance remains.
- A **lifecycle timeline** on the invoice page: Created → Sent → Deposit → Installation scheduled → Installed → Paid, each with date and user.
- The invoice header shows: fulfilled-from warehouse, job-site address, linked installation job, and the money summary (total, paid, remaining) prominently.

### B3. Waste is internal only
- Waste % and waste quantity per line are visible only with `sales.waste.view` (Owner, Manager, Accountant, Warehouse by default; **Sales off by default**). Without it, the quote builder applies the default waste % from settings silently.
- New setting: default waste % per product category (Settings → Sales and documents).
- **Customer-facing documents never show waste**: quote and invoice print views, PDFs and anything the customer receives show the billed quantity with waste already included (e.g. 252 sq ft room + 10% waste → billed 277.2 sq ft), with no waste line or percentage.

### B4. Remaining amount in sales tables
Invoices table: add **Paid**, **Remaining**, **Last payment** and **Warehouse** columns next to Status and Due date, all filterable (A2), with a totals row for the filtered set.

### B5. Customers and receivables, simplified
- Replace the five-bucket bar with two clear figures: **Current** (not yet due) and **Overdue** (past due date), plus "Due in the next 7 days".
- A simple list: customer, open balance, overdue amount, days overdue (oldest), next due date, last payment, with filters (type, warehouse, salesperson, overdue only).
- An info tooltip: "Calculated from each invoice's due date."
- The detailed aging (current, 1–30, 31–60, 61–90, 90+) moves to Reports → Receivables aging.
- Seed data looks like a healthy business: most of the open balance current, overdue under about 15%, very little over 90 days.

### B6. Installation complete moves the invoice forward (ASSUMPTION B-1)
- Marking a job **Complete** (with customer sign-off) adds "Installed" to the linked invoice's timeline, makes any held final amount due (due date = completion date + payment terms), marks the invoice as sent with the balance due, and notifies users with `payments.record` ("Job J-1042 completed: $X balance due").
- If the job has no invoice, offer **Create invoice from this job**, prefilled from the job's materials and labour.

---

## Batch C: inventory linked to invoices

### C1. Every stock change has a source document
- Stock goes **out** through a sales invoice, **in** through a purchase receipt, **moves** through a transfer, and changes for any other reason only through a **Stock adjustment** (reason required: damage, count correction, samples, other; needs `inventory.adjust`; above a set quantity it needs approval by Owner or Manager).
- Remove free editing of stock and the standalone "Cut roll". **Cut roll** now asks to pick an invoice (searchable) or **Create a new invoice** (opens a quick invoice prefilled with the roll and length), or, with `inventory.adjust`, record an adjustment with a reason.

### C2. Reserve on invoice, cut after money is received (ASSUMPTION C-1)
- When an invoice is issued, the needed length or cartons are **reserved** from the chosen warehouse and roll. Each roll and product shows **On hand**, **Reserved**, **Available**.
- The physical **cut / issue** is allowed only once the invoice is **Deposit paid**, **Partly paid** or **Paid** (confirmed payments). The cut then reduces stock, appears in the roll's history linked to the invoice, and keeps the existing remnant rule.
- Voiding an invoice releases its reservation; a return reverses a cut through a credit note. Any override needs permission and a reason, and is audited.
- When adding a carpet line to an invoice, the roll picker filters by warehouse and dye lot and suggests rolls with enough available length (same dye lot across rooms of one job).

### C3. Stock status display
- **Out of stock** (available = 0) as a red badge with the words "Out of stock"; **Low stock** (below the reorder point) as an amber badge. Never colour alone.
- Warehouse filter and column on products and rolls.

---

## Batch D: purchasing

### D1. Purchase orders
- **Save as draft** when creating a PO. Statuses: Draft → Ordered → Partly received → Received → Billed → Partly paid / Paid; Cancelled.
- **Layout fix:** long product names wrap to two lines then truncate with a tooltip; the line table scrolls horizontally inside its own container with a sticky header and sticky totals; the page never overflows. Test with 60-character names at 1440 px and 390 px.
- **Area units, not cartons:** order area goods in the company's area unit from Localization (sq ft by default; sq yd or m² if set). Cartons are calculated and shown next to it ("500 sq ft = 21.2, rounded up to 22 cartons"). Rolls: width × length → area.

### D2. Receiving and supplier bills
- **Goods receipt:** record what actually arrived per line (quantity received, damaged, roll numbers and dye lots, receiving warehouse). Partial receipts allowed. Each receipt creates the stock movements.
- **Supplier bill:** recorded only against received goods (what was received is what can be billed), matched to PO and receipt with differences flagged; attach the supplier's invoice file.

### D3. Supplier terms, balances and payments
- Per supplier: payment terms **Pay on order**, **Cash on delivery**, or **On account** (Net 30, 60, 90, 180, or monthly statement), with a credit limit.
- Show **Remaining** per PO and per bill, and per supplier: balance owed, credit used vs limit, next due date. Payables simplified like receivables (Current vs Overdue), detailed aging in Reports.
- **Supplier payments** mirror customer payments (Appendix A rules where they apply): method, reference, **mandatory proof**, optional approval, void instead of delete, partial payments, and paying several bills in one payment with allocation.
- Permissions: `purchasing.view`, `purchasing.create`, `purchasing.receive`, `purchasing.bill`, `purchasing.pay`, `purchasing.approve` with sensible defaults (Owner, Manager, Accountant; Warehouse can receive).

---

## Batch E: dashboard and sales team

### E1. Dashboard redesign
- Key figures in one consistent row of cards that never wrap awkwardly at any width (auto-fit grid with a minimum card width). Each card: label, value with compact formatting and tabular numerals, change vs the previous period, small sparkline.
- **One period selector** for the dashboard (This month, Last 30 days, This quarter, Year to date, Custom) and a **warehouse filter**, placed above or beside the widgets.
- Widgets: Revenue and gross margin (chart / table toggle); **Pending quotes**; Receivables (current vs overdue); **Payments to verify**; **Best sellers** with its own period filter (7 days, 30 days, 90 days, 12 months, custom), a metric toggle (revenue, quantity, margin), a category filter and a chart / table toggle; Slow movers (days since the last sale; a product that never sold counts its days in stock from its newest stock receipt, and from when it was added only if it was never received; owner, 2026-11-21, click-through #4); Today's jobs; Top performer (E2).

### E2. Sales performance and commissions
- Settings → Commissions: a rule per role or per person: percentage of **paid revenue** or of **gross margin**, earned when payments are confirmed, optional tiers.
- Sales → Team: per salesperson: sales, paid revenue, margin, quotes sent, conversion rate, average deal, commission earned / paid / pending; filters for period and warehouse.
- Dashboard **Top performer** widget and leaderboard; when the period is a year it reads **Employee of the year**.
- Permissions: `commissions.view_own` (Sales see only their own), `commissions.view_all` (Owner, Manager, Accountant), `commissions.manage`. Commission totals appear in the payroll export.

---

## Batch F: meetings calendar
- Day, week, month and agenda views.
- **Drag to move** a meeting, **drag its edge to change the duration**, click an empty slot to create one. Recurring meetings ask: this event, this and following, or all.
- Warn about attendee conflicts; an **Undo** toast after every move; a keyboard and form alternative (date and time fields) for accessibility. Reminders and time zones update with the move.

---

## Batch G: data import and database integration

### G1. Import wizard (works in the demo)
Platform admin → Company → **Data import**; also Settings → Data import for company users with `import.manage`.
1. Choose what to import: customers, customer addresses, suppliers, products, rolls and stock (with warehouse), open customer invoices (opening receivables), open supplier bills (opening payables), employees.
2. Download a template (CSV or Excel).
3. Upload CSV or Excel (10 MB demo limit). Parse in a Web Worker: Papa Parse for CSV; for Excel use SheetJS installed from its official CDN package (not the outdated npm release) or exceljs.
4. Map columns: auto-match by header name, adjust by dropdown, save the mapping for next time.
5. Validate: types, required fields, duplicates, unknown warehouses or categories, money and unit formats; errors shown per row and cell.
6. Preview the first 50 rows, then a dry run: "creates X, updates Y, skips Z".
7. Import, then a result report with a downloadable error CSV.
8. Import history with **Undo** for each batch.
Records match on external ID, SKU or email, so a second import updates instead of duplicating.

### G2. Connect a database (designed now, live in the full product)
- A **Connect a database** screen in the same place: engine (SQL Server, MySQL, PostgreSQL), host, port, database, read-only user, SSL; then table-to-entity mapping with a preview of sample rows, and a schedule (one-time migration or nightly sync).
- In the demo, the connection test is simulated with a sample dataset and a clear banner: "Live database connections run on the server in the full product." Never store database credentials in the browser.
- Write `docs/specs/data-integration.md` for the real build: a server-side worker, read-only database user, encrypted credentials, IP allowlist or SSH tunnel, incremental sync on an updated-at column, conflict rules, logs and alerts. Recommend the simplest path first: export their database or spreadsheets to CSV / Excel and use the import wizard.

---

## Batch H: data, tests, docs, deploy
- **Fixtures:** warehouses and showrooms, customers with several addresses, quotes in Draft and Pending, payments with proof files (generated placeholder PDFs and images), supplier terms, bills and payments, reservations and cuts linked to invoices, commissions, a healthy receivables mix. Extend the reconciliation test: receivables = open invoices; payables = open bills; stock by warehouse = movements; commissions = rules × confirmed payments.
- **Unit tests:** everything Appendix A lists, plus quote and PO status rules, reservation and cut rules, area-to-carton conversion, commission calculation, tax default resolution, import validation, and permission checks in both UI and save logic.
- **End-to-end tests:**
  1. Quote draft → pending → accepted → invoice → deposit with proof → cut from roll → job complete → final payment → Paid; void one payment → Partly paid.
  2. PO draft → ordered → partial receipt → supplier bill → supplier payment with proof.
  3. New customer typed in the quote builder with a new address from the demo provider.
  4. Customer import from CSV with one bad row reported.
  5. Meeting dragged to a new time.
  6. Company Owner removes a page from the Sales role; Sales no longer sees it.
- **Docs:** `FEATURES.md` rows for every new feature, ADRs, `blueprint-delta.md`, `README.demo.md`, `docs/demo-script.md`, presenter-guide steps, `STATUS.md`.
- **Deploy** and rerun the suite against both live addresses.

---

## Appendix A: customer payments specification (word for word)

### Goal

Add customer payment recording to the Flooring Suite (Summit Floor Co. / Keystone Flooring Supply). Today an invoice page only has **Print** and **Download PDF**, and a new invoice stays **Open** forever. Users must be able to record that a customer paid, attach proof of payment (mandatory), and have the invoice status, balance, receivables, statements, dashboard and reports all update correctly. Payments must be traceable and reversible, never silently edited or deleted.

Before writing code, read the codebase and tell me in a short plan: where invoices, statuses, balances, the customer statement, receivables aging, notifications, the audit log, roles/permissions, demo seed data, browser persistence and the presenter-guide "Network" simulation (Normal / Slow / Offline) live. Reuse the existing patterns, components (drawers, forms, tables, `k` button styles), money/rounding helpers and permission checks. Don't add a second way of doing something that already exists. Wait for my OK on the plan, then build.

### Core rule: status comes from payments, not from a dropdown

Do not add a free "change status" dropdown. The invoice status is derived from its total, its confirmed payments and its due date, the same way accounting systems (Odoo, QuickBooks, Zoho) do it:

| Status | Rule |
|---|---|
| Draft | Not yet issued (if the app has this state) |
| Open | Issued, no confirmed payment, not past due |
| Partly paid | 0 < confirmed paid < total |
| Overdue | Balance > 0 and today > due date (shows together with "Partly paid" if some was paid) |
| Pending verification | A payment is recorded but not yet confirmed (see approval below); balance doesn't drop until confirmed |
| Paid | Balance = 0 from confirmed payments, credits or write-off |
| Overpaid / Credit | Confirmed paid > total; the extra becomes customer credit |
| Void | Invoice cancelled (only allowed with no confirmed payments) |

`balance = total − confirmed payments − applied credits − write-offs`, computed at full precision with the existing money helpers, and rounded only for display. Existing statuses (Open, Partly paid, Paid, Overdue, Return/CR- credit notes) must keep working, and the seeded demo invoices must keep their current status after migration (create matching seeded payment records for invoices that are already Paid or Partly paid).

### Record payment

On the invoice page, add a primary **Record payment** button next to Print / Download PDF (hidden when balance = 0 or the invoice is Void/Draft, or when the role can't record payments). It opens a drawer/form with:

- **Amount** (required, > 0). Pre-filled with the current balance. Quick buttons: **Full balance**, **Deposit (x %)** using the deposit % from the quote.
- **Payment date** (required). Default today. Not in the future, not before the invoice issue date.
- **Method** (required): Cash, Check, Bank transfer / ACH, Card, Other. Check asks for check number; Card asks for last 4 digits only (never store full card numbers).
- **Reference / transaction ID** (required for everything except cash). Warn about duplicates: same reference already used on any payment in this company. Let the user continue only after confirming.
- **Deposit to** (optional): Undeposited funds, bank account, cash drawer, if the app has accounts. Otherwise skip it.
- **Proof of payment, mandatory**: at least one file (PDF, JPG, PNG, HEIC/WebP if easy). Max 5 MB each, max 3 files. Drag-and-drop plus file picker, preview thumbnail or PDF icon, remove before saving. **Save is disabled until a file is attached.** It must be clear why, e.g. "Attach the receipt, bank confirmation or check photo to continue."
- **Note** (optional).
- Live summary: invoice total, already paid, this payment, **balance after**, and the resulting status.

Rules:
- Amount > balance: show "This is $X more than the balance". Options: record the extra as customer credit (needs permission), or lower the amount. Never let the balance go negative silently.
- Partial payments are allowed, and an invoice can have many payments.
- On save, give the payment a number (PAY-0001, with a prefix setting under Settings → Documents next to the other prefixes), store who recorded it and when, and write an audit-log entry.
- Respect the Offline simulation: saving fails with the app's standard error and **Try again**, and nothing is stored (no orphan files). Slow mode shows the loading state.

### Approval (two-person check)

Add a company setting under Settings → Documents: **Payments need approval** (on/off), plus an optional threshold amount ("only above $X").

- When on, a recorded payment starts as **Pending verification**. Someone with approval permission (Owner, Accountant by default) who is **not the person who recorded it** opens it, views the proof and clicks **Confirm** or **Reject (reason required)**.
- Only confirmed payments reduce the balance and make the invoice Paid.
- Pending payments show on the dashboard "Needs attention" list and in notifications ("3 payments to verify").
- When off, payments are confirmed immediately.

### Payments on the invoice

- A **Payments** section on the invoice page: number, date, method, reference, amount, status (Pending / Confirmed / Rejected / Voided), recorded by, attachment link (opens a viewer; download allowed). Totals: Paid, Balance due.
- The printed invoice and PDF show confirmed payments and the balance due. A fully paid invoice shows a clear **PAID** mark with the date.
- **Download receipt**: a payment receipt PDF for one payment (company details, customer, invoice number, amount, method, reference, remaining balance), styled like the invoice PDF.

### Corrections: never edit or delete, reverse instead

- **Void payment** (permission required, reason required): marks it Voided, keeps it and its file visible with a strikethrough, restores the balance, recomputes the status, and writes an audit entry. Use this for bounced checks and mistakes. Optional: add a "Returned check fee" line using the late-fee setting.
- To correct an amount, void and re-record. Payments can't be edited after confirmation, apart from adding more attachments or a note.
- **Refund** of credit or an overpayment: records an outgoing refund with method, reference and mandatory proof, and reduces customer credit.
- **Write off remaining balance** (Owner/Accountant only, reason required, optional max amount setting such as $5): closes small leftover balances as Paid with a write-off line.
- **Apply customer credit**: if the customer has credit (from an overpayment or a CR- credit note), offer "Apply $X credit" on their open invoices.
- **Void invoice** is only allowed when it has no confirmed payments.
- Once an invoice has any confirmed payment, its lines and prices are locked. Changes go through a credit note.

### Everything that must update

After any payment change, these update from the same calculation, with no separately stored numbers that can drift:

- Invoice status and balance in **Sales → Invoices**, including the Status filter (add Pending verification), plus a new optional **Paid** and **Last payment** column.
- **Customers and receivables**: open balance, overdue, aging buckets (still adding up to the total open), customer credit, and the customer drawer **Statement** with payment lines and a running balance (Export CSV includes them).
- **Dashboard**: Receivables, overdue count, "payments to verify".
- **Notifications**: remove "overdue" once paid, and add pending verification.
- **Reports**: add a **Payments received** report (by date range, method, customer) with CSV and PDF that match the table. If P&L is cash-based anywhere, use confirmed payment dates.
- **Quote**: a quote that was converted to a now-paid invoice shows that status through **View invoice**.
- **Audit log**: payment recorded, confirmed, rejected, voided, refunded, written off, credit applied, file attached, each with the user, time, amount, invoice and reason.
- The **command palette** gets "Record payment" when on an invoice, and the **presenter guide** gets a step "Record a payment with proof".

### Permissions

Add permissions to Security roles and respect the existing permission ceilings set by the platform admin:

- `payments.view`: Owner, Manager, Sales (own customers only, like today), Accountant
- `payments.record`: Owner, Manager, Accountant (Sales optional, off by default)
- `payments.approve`: Owner, Accountant
- `payments.void`, `payments.refund`, `payments.writeoff`, `payments.credit`: Owner, Accountant
- Installer, Warehouse and Employee: no access

Hide the buttons a role can't use, and check permissions again in the save logic, not just in the UI. "View as" must show the right result.

### Files and storage

The demo saves data in the browser only. Store attachments in **IndexedDB** (not localStorage, which is too small), keyed by payment ID, with metadata (name, type, size, uploaded by/at) in the normal data store. Check the real file type, not just the extension. Show a clear error if storage is full. **Reset demo data** clears payment files too. Put file storage behind a small interface, so it can later be replaced with real object storage (for example S3) without touching the UI.

### Quality

- Keyboard accessible, with labeled fields, errors next to fields, and focus moved to the first error. Works at phone width, light and dark themes.
- Unit tests for the status/balance calculation: partial, full, overpaid, voided, pending, write-off, credit, overdue+partial, rounding cents (e.g. 3 × $33.33 on $99.99). Tests for validation (no file means no save, future date, amount ≤ 0, duplicate reference) and the permission checks.
- One end-to-end test: create a quote, convert it to an invoice, record a partial payment with a file, record the rest, check it shows Paid, void one payment, check it shows Partly paid again.
- At the end, list what changed, how to try it in the demo (which persona, which invoice), and anything you left out.

Note for this batch: Appendix A's "aging buckets" now live in Reports → Receivables aging (B5); the Customers and receivables page shows Current and Overdue. Its own "wait for my OK on the plan" is covered by Phase 0 of this file: one plan, one OK.

---

## Appendix B: assumptions to confirm in Phase 0

- **B-1.** Client note 2 ("after the installation → complete of invoice") is read as B6: completing a job moves its invoice to balance due and notifies accounting.
- **B-2.** Sales reps don't see waste by default (B3); an Owner can turn it on in Security roles.
- **B-3.** "Deposit paid" is a label on top of the derived status, not a separate stored status.
- **C-1.** Stock is reserved when an invoice is issued and cut only after a confirmed deposit or payment (C2), as the client asked; overrides need permission and a reason.
- **A-1.** Showrooms never hold sellable stock; samples there are tracked separately.
- **A-2.** The demo address provider is the default; Google suggestions turn on only when an API key is added.
- **G-1.** Live database connections are designed and shown in the demo but run only in the full product, on the server.