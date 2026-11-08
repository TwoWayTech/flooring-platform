# Status

- Current phase: Feature batch 2 (docs/specs/feature-batch-02.md). Phase 0 plan written (docs/specs/feature-batch-02-plan.md); waiting for the owner's OK
- Next step: once the owner approves the plan (with any changes to its section 3 recommendations), start Batch A with A0 groundwork, then A1 warehouses and showrooms, and build batch by batch without stopping. Optional, unchanged: set DEMO_SESSION_SECRET on Vercel, and connect the GitHub repository (`vercel git connect`) so pushes deploy.
- Deployed URLs: Flooring Suite https://flooring-demo-twowaytech.vercel.app, HR Suite https://hr-demo-twowaytech.vercel.app (one Vercel project, flooring-demo-twowaytech; the spec names were taken, see docs/deploy.md)
- Last session log: docs/sessions/2026-11-08-1900-batch2-phase0-plan.md

## Checklist

### Phase 0: plan
- [x] Versions checked with Context7; tasks below expanded (ADR 0001)

### Phase 1: foundation
- [x] Monorepo: pnpm + Turborepo, apps/web, packages/shared, packages/ui; lint, typecheck, test scripts wired
- [x] packages/shared: keys, permission engine, formatNumber, units, money, US pack, unit tests
  - permission keys `module.resource.action`, modules, products, default roles + data scope
  - effectivePermissions, canGrant, canAssignRole, dataScope, sensitive fields
  - formatNumber + number kinds/defaults; units (sq ft, sq yd, cartons, roll area); money (decimal.js)
  - US pack: 50 states + DC, sales tax example rules (CO, PA, FL, NJ, MD, TX), overtime (federal + CA daily)
  - quote/invoice totals calculator (lines, waste, labor tax by job-site state)
- [x] Seeded fixtures generator (`pnpm fixtures`) and reconciliation test
- [x] DemoStore, apiClient, demo route handlers (login, logout, context), hostname proxy; docs/api-contract.md
- [x] docs/design-plan.md reviewed against the brief
- [x] Design system: tokens, fonts, themes, brand scale from one color, floor pattern, roll gauge, Num
- [x] App shell: sidebar, top bar, command palette, company switcher, view as role, theme toggle, notifications

### Phase 2: Tier 1 screens
- [x] Login, personas, MFA
- [x] Dashboard
- [x] Inventory, roll detail, cut roll
- [x] Quote builder, invoice, PDF
- [x] Settings: users
- [x] Settings: security roles
- [x] Settings: branding
- [x] Settings: localization and tax
- [x] Settings: number format
- [x] Settings: company profile and audit log
- [x] Super-admin: companies and company access
- [x] HR host: dashboard, employees, timesheets, PTO, own settings

### Phase 3: Tier 2 screens
- [x] Customers and receivables
- [x] Suppliers, purchase orders, payables
- [x] Installation calendar and job card
- [x] Reports hub
- [x] Meetings

### Phase 4: Tier 3 polish
- [x] Presenter guide panel
- [x] Empty, loading and error states
- [x] Accessibility and reduced-motion pass
- [x] Visual QA in both themes at 1440 px and 390 px

### Phase 5: ship
- [x] All tests green, production build passes
- [x] docs/demo-script.md
- [x] Deployed: Flooring and HR hosts

### Post-demo setup
- [x] Playwright: one project per product, passing against production (189 tests)
- [x] docs/FEATURES.md and a switch per feature in packages/shared
- [x] docs/feedback-demo.md template
- [x] /feature-change command and docs/blueprint-delta.md
- [x] README.demo.md
- [x] Production redeployed with the feature switches (189 tests pass live; switching one off checked in a browser)

### Feature batch 2
Spec: docs/specs/feature-batch-02.md. Map, data model, migration and assumptions: docs/specs/feature-batch-02-plan.md. Each item: feature key and FEATURES.md row, permissions, types and fixtures, ApiClient + DemoStore (permission check inside the action), screen, unit and e2e tests, ADR for model changes, blueprint-delta row, commit, push, tick. Full suite at the end of every batch.

#### Phase 0: plan
- [x] Spec moved to docs/specs/ and committed
- [x] Plan: map of the code, data-model changes, DemoStore migration, assumptions and conflicts with recommendations
- [x] Owner's OK on the plan

#### Batch A: foundations
- [x] A0. Groundwork (from the plan): overlay `schemaVersion` 2 and v1-to-v2 migration with a reset-and-message fallback; permission checks inside every DemoStore action; new permission keys and actions in the catalog and default roles; stored ceilings and roles upgraded
- [x] A1. Warehouses and showrooms: `locations`, user default warehouse, rolls and carton stock per warehouse and bin (stock movements ledger), transfers (In transit / Received), Fulfilled from / Receive into on quotes, invoices, POs and receipts, warehouse filter and column on every listed screen
- [x] A2. Filters on every table: global search, per-column filters (text, multi-select, ranges), sort, show / hide, chips + result count + Clear filters, filters in the URL, last view per user per table, CSV respects filters, totals row for money
- [x] A3. Company admins control roles and pages: page-permission map (menu, route gate, no-access state), action permissions on buttons, System badge, Reset to default, Duplicate, effective access preview in Settings, new permissions in the matrix inside the ceiling
- [x] A4. Settings easy to read: grouped settings home, plain title + one sentence per page, helper line per control, changed-field highlight, sticky Save / Discard, Reset to default per section, settings search, every change audited (both products)
- [x] A5. Default tax rates: company default rate, state and jurisdiction defaults with effective dates, resolution job site → jurisdiction → state → company, rate source under the tax line, override with `sales.tax.override` + reason + audit, example labels kept
- [ ] A6. Customers: call-centre picker with inline "Add as new customer" (profile incomplete badge), many labelled addresses with defaults, address suggestions behind `AddressProvider` (demo provider with ~300 addresses; Google Places (New) with session tokens when the key is set; README steps), used in quote, invoice, job card, supplier form and company profile
- [ ] Batch A: full suite green

#### Batch B: the sales flow
- [ ] B1. Quotes Draft and Pending: Draft → Pending → Accepted → Converted / Declined / Expired, Save as draft anywhere, Send runs full validation, list columns (value, salesperson, warehouse, expiry, age) and status filter
- [ ] B2. Invoice lifecycle and payments (Appendix A in full): ledger-derived status and balance; Record payment with mandatory proof (IndexedDB file store behind an interface), duplicate-reference warning, overpayment to credit; approval (two-person check, threshold); Payments section, PDF with payments and PAID mark, receipt PDF; void, refund, write-off, apply credit, void invoice, lines locked after a confirmed payment; Update status menu with valid next actions only; Deposit paid label; lifecycle timeline; invoice header (warehouse, job site, job, money summary); everything that must update (lists, customers, statement, dashboard, notifications, Payments received report, quote View invoice, audit, command palette, presenter step); permissions in UI and save logic
- [ ] B3. Waste internal only: `sales.waste.view` (Sales off), default waste % per category in settings, customer-facing documents show the billed quantity with waste included and no waste line
- [ ] B4. Invoices table: Paid, Remaining, Last payment, Warehouse columns, filterable, totals row
- [ ] B5. Customers and receivables simplified: Current / Overdue / Due in 7 days, simple list with filters, info tooltip, detailed aging in Reports → Receivables aging, healthy seeded mix
- [ ] B6. Installation complete moves the invoice forward: sign-off adds Installed, sets the held due date, marks sent, notifies payment recorders; Create invoice from this job
- [ ] Batch B: full suite green

#### Batch C: inventory linked to invoices
- [ ] C1. Every stock change has a source document: out by invoice, in by receipt, moves by transfer, otherwise a stock adjustment (reason, `inventory.stock.adjust`, approval above a set quantity); Cut roll picks or creates an invoice, or records an adjustment
- [ ] C2. Reserve on invoice, cut after money: reservations on issue (On hand / Reserved / Available), cut only when Deposit paid / Partly paid / Paid, cut in roll history linked to the invoice, remnant rule kept, void releases, return reverses through a credit note, audited overrides, roll picker by warehouse and dye lot with suggestions
- [ ] C3. Stock status display: Out of stock (red) and Low stock (amber) badges with words, warehouse filter and column on products and rolls
- [ ] Batch C: full suite green

#### Batch D: purchasing
- [ ] D1. Purchase orders: Save as draft; Draft → Ordered → Partly received → Received → Billed → Partly paid / Paid, Cancelled; layout fix (wrap then truncate with tooltip, own horizontal scroll, sticky header and totals; tested with 60-character names at 1440 and 390 px); order in area units with cartons calculated beside
- [ ] D2. Receiving and supplier bills: goods receipts per line (received, damaged, roll numbers, dye lots, warehouse), partial receipts creating stock movements; bills only against received goods, matched to PO and receipt with differences flagged, supplier invoice file attached
- [ ] D3. Supplier terms, balances and payments: Pay on order / COD / On account (Net 30, 60, 90, 180, monthly statement) with credit limit; Remaining per PO and bill; balance owed, credit used and next due per supplier; payables Current vs Overdue with aging in Reports; supplier payments with mandatory proof, optional approval, void, partial, multi-bill allocation; purchasing permissions
- [ ] Batch D: full suite green

#### Batch E: dashboard and sales team
- [ ] E1. Dashboard redesign: auto-fit key-figure cards (label, compact value, change vs previous period, sparkline), one period selector and warehouse filter, widgets (revenue and margin with chart / table toggle, pending quotes, receivables, payments to verify, best sellers with own period, metric, category and chart / table toggle, slow movers, today's jobs, top performer)
- [ ] E2. Sales performance and commissions: Settings → Commissions rules (paid revenue or gross margin, tiers), Sales → Team per salesperson, Top performer / Employee of the year widget and leaderboard, commission permissions, commission totals in the payroll export
- [ ] Batch E: full suite green

#### Batch F: meetings calendar
- [ ] F. Day, week, month and agenda views; drag to move, drag the edge to resize, click an empty slot to create; recurring edit scope (this, this and following, all); attendee conflict warning; Undo toast; keyboard and form alternative; reminders and time zones follow the move
- [ ] Batch F: full suite green

#### Batch G: data import and database integration
- [ ] G1. Import wizard (Platform admin → Company → Data import; Settings → Data import with `settings.import.manage`): choose kind, download template (CSV / Excel), upload (10 MB) parsed in a Web Worker (Papa Parse, SheetJS), map columns with saved mappings, validate per row and cell, preview 50 rows and dry run, import with result report and error CSV, import history with Undo; match on external ID, SKU or email
- [ ] G2. Connect a database: engine, host, port, database, read-only user, SSL, table-to-entity mapping with sample preview, schedule; simulated test with banner; no credentials stored in the browser; docs/specs/data-integration.md
- [ ] Batch G: full suite green

#### Batch H: data, tests, docs, deploy
- [ ] Fixtures: warehouses and showrooms, customers with several addresses, Draft and Pending quotes, payments with proof files, supplier terms, bills and payments, reservations and cuts linked to invoices, commissions, healthy receivables; reconciliation extended (receivables = open invoices, payables = open bills, stock by warehouse = movements, commissions = rules × confirmed payments)
- [ ] Unit tests: the Appendix A list, quote and PO status rules, reservation and cut rules, area-to-carton conversion, commission calculation, tax default resolution, import validation, permission checks in UI and save logic
- [ ] E2E 1: quote draft → pending → accepted → invoice → deposit with proof → cut from roll → job complete → final payment → Paid; void one payment → Partly paid
- [ ] E2E 2: PO draft → ordered → partial receipt → supplier bill → supplier payment with proof
- [ ] E2E 3: new customer typed in the quote builder with a new address from the demo provider
- [ ] E2E 4: customer import from CSV with one bad row reported
- [ ] E2E 5: meeting dragged to a new time
- [ ] E2E 6: company Owner removes a page from the Sales role; Sales no longer sees it
- [ ] Docs: FEATURES.md rows, ADRs, blueprint-delta.md, README.demo.md, docs/demo-script.md, presenter-guide steps, STATUS.md

#### End
- [ ] Redeploy production
- [ ] Full suite against both live addresses
- [ ] Final report: what changed, how to try each item (persona, company, record), anything assumed or left out

## Decisions
(see docs/adr/)

## Blockers
none
