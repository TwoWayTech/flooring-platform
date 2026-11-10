# Status

- Current phase: Feature batch 3 (docs/specs/feature-batch-03.md), Phase 0 done. Research ADRs 0020 to 0026, docs/ux-audit.md and docs/specs/feature-batch-03-plan.md are written and pushed. Nothing is built yet. Live sites are still feature batch 2.
- Next step: wait for the owner's OK on docs/specs/feature-batch-03-plan.md (section 1 has the six decisions). After the OK, tick "Owner's OK on the plan" and start item A0 below.
- Deployed URLs: Flooring Suite https://flooring-demo-twowaytech.vercel.app, HR Suite https://hr-demo-twowaytech.vercel.app (one Vercel project, flooring-demo-twowaytech; the spec names were taken, see docs/deploy.md)
- Last session log: docs/sessions/2026-11-10-batch3-phase0.md

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
- [x] A6. Customers: call-centre picker with inline "Add as new customer" (profile incomplete badge), many labelled addresses with defaults, address suggestions behind `AddressProvider` (demo provider with ~300 addresses; Google Places (New) with session tokens when the key is set; README steps), used in quote, invoice, job card, supplier form and company profile
- [x] Batch A: full suite green (222 of 222 on a production build, in four chunks; number-format waits for the search to reach the address before hovering)

#### Batch B: the sales flow
- [x] B1. Quotes Draft and Pending: Draft → Pending → Accepted → Converted / Declined / Expired, Save as draft anywhere, Send runs full validation, list columns (value, salesperson, warehouse, expiry, age) and status filter
- [x] B2. Invoice lifecycle and payments (Appendix A in full): ledger-derived status and balance; Record payment with mandatory proof (IndexedDB file store behind an interface), duplicate-reference warning, overpayment to credit; approval (two-person check, threshold); Payments section, PDF with payments and PAID mark, receipt PDF; void, refund, write-off, apply credit, void invoice, lines locked after a confirmed payment; Update status menu with valid next actions only; Deposit paid label; lifecycle timeline; invoice header (warehouse, job site, job, money summary); everything that must update (lists, customers, statement, dashboard, notifications, Payments received report, quote View invoice, audit, command palette, presenter step); permissions in UI and save logic
- [x] B3. Waste internal only: `sales.waste.view` (Sales off), default waste % per category in settings, customer-facing documents show the billed quantity with waste included and no waste line
- [x] B4. Invoices table: Paid, Remaining, Last payment, Warehouse columns, filterable, totals row
- [x] B5. Customers and receivables simplified: Current / Overdue / Due in 7 days, simple list with filters, info tooltip, detailed aging in Reports → Receivables aging, healthy seeded mix
- [x] B6. Installation complete moves the invoice forward: sign-off adds Installed, sets the held due date, marks sent, notifies payment recorders; Create invoice from this job
- [x] Batch B: full suite green (244 of 244 on a production build, in four chunks; customers-picker.spec now saves a new quote with Save as draft, as B1 intends)

#### Batch C: inventory linked to invoices
- [x] C1. Every stock change has a source document: out by invoice, in by receipt, moves by transfer, otherwise a stock adjustment (reason, `inventory.stock.adjust`, approval above a set quantity); Cut roll picks or creates an invoice, or records an adjustment
- [x] C2. Reserve on invoice, cut after money: reservations on issue (On hand / Reserved / Available), cut only when Deposit paid / Partly paid / Paid, cut in roll history linked to the invoice, remnant rule kept, void releases, return reverses through a credit note, audited overrides, roll picker by warehouse and dye lot with suggestions
- [x] C3. Stock status display: Out of stock (red) and Low stock (amber) badges with words, warehouse filter and column on products and rolls
- [x] Batch C: full suite green (all specs on a production build in four chunks; audit.spec records its cut as an adjustment, since C1 removes the free cut)

#### Batch D: purchasing
- [x] D1. Purchase orders: Save as draft; Draft → Ordered → Partly received → Received → Billed → Partly paid / Paid, Cancelled; layout fix (wrap then truncate with tooltip, own horizontal scroll, sticky header and totals; tested with 60-character names at 1440 and 390 px); order in area units with cartons calculated beside
- [x] D2. Receiving and supplier bills: goods receipts per line (received, damaged, roll numbers, dye lots, warehouse), partial receipts creating stock movements; bills only against received goods, matched to PO and receipt with differences flagged, supplier invoice file attached
- [x] D3. Supplier terms, balances and payments: Pay on order / COD / On account (Net 30, 60, 90, 180, monthly statement) with credit limit; Remaining per PO and bill; balance owed, credit used and next due per supplier; payables Current vs Overdue with aging in Reports; supplier payments with mandatory proof, optional approval, void, partial, multi-bill allocation; purchasing permissions
- [x] Batch D: full suite green (246 of 246 on a production build, three chunks)

#### Batch E: dashboard and sales team
- [x] E1. Dashboard redesign: auto-fit key-figure cards (label, compact value, change vs previous period, sparkline), one period selector and warehouse filter, widgets (revenue and margin with chart / table toggle, pending quotes, receivables, payments to verify, best sellers with own period, metric, category and chart / table toggle, slow movers, today's jobs, top performer)
- [x] E2. Sales performance and commissions: Settings → Commissions rules (paid revenue or gross margin, tiers), Sales → Team per salesperson, Top performer / Employee of the year widget and leaderboard, commission permissions, commission totals in the payroll export
- [x] Batch E: full suite green (all specs on a production build in chunks)

#### Batch F: meetings calendar
- [x] F. Day, week, month and agenda views; drag to move, drag the edge to resize, click an empty slot to create; recurring edit scope (this, this and following, all); attendee conflict warning; Undo toast; keyboard and form alternative; reminders and time zones follow the move
- [x] Batch F: full suite green (all specs on a production build in chunks; meeting buttons are named by their visible time and title)

#### Batch G: data import and database integration
- [x] G1. Import wizard (Platform admin → Company → Data import; Settings → Data import with `settings.import.manage`): choose kind, download template (CSV / Excel), upload (10 MB) parsed in a Web Worker (Papa Parse, SheetJS), map columns with saved mappings, validate per row and cell, preview 50 rows and dry run, import with result report and error CSV, import history with Undo; match on external ID, SKU or email
- [x] G2. Connect a database: engine, host, port, database, read-only user, SSL, table-to-entity mapping with sample preview, schedule; simulated test with banner; no credentials stored in the browser; docs/specs/data-integration.md
- [x] Batch G: full suite green (283 e2e in three chunks on a production build; 209 unit)

#### Batch H: data, tests, docs, deploy
- [x] Fixtures: warehouses and showrooms, customers with several addresses, Draft and Pending quotes, payments with proof files, supplier terms, bills and payments, reservations and cuts linked to invoices, commissions, healthy receivables; reconciliation extended (receivables = open invoices, payables = open bills, stock by warehouse = movements, commissions = rules × confirmed payments)
- [x] Unit tests: the Appendix A list, quote and PO status rules, reservation and cut rules, area-to-carton conversion, commission calculation, tax default resolution, import validation, permission checks in UI and save logic
- [x] E2E 1: quote draft → pending → accepted → invoice → deposit with proof → cut from roll → job complete → final payment → Paid; void one payment → Partly paid
- [x] E2E 2: PO draft → ordered → partial receipt → supplier bill → supplier payment with proof
- [x] E2E 3: new customer typed in the quote builder with a new address from the demo provider
- [x] E2E 4: customer import from CSV with one bad row reported
- [x] E2E 5: meeting dragged to a new time
- [x] E2E 6: company Owner removes a page from the Sales role; Sales no longer sees it
- [x] Docs: FEATURES.md rows, ADRs, blueprint-delta.md, README.demo.md, docs/demo-script.md, presenter-guide steps, STATUS.md
- [x] Batch H: full suite green (284 e2e in three chunks on a production build; 213 unit)

#### End
- [x] Redeploy production (Ready, both hosts aliased)
- [x] Full suite against both live addresses (284 of 284, three chunks)
- [x] Final report: what changed, how to try each item (persona, company, record), anything assumed or left out (docs/sessions/2026-11-09-batch2-g-h-deploy.md)

### Feature batch 3
Spec: docs/specs/feature-batch-03.md. Plan, data model, migration and decisions: docs/specs/feature-batch-03-plan.md. Audit: docs/ux-audit.md (U-numbers below). Each item: feature key and FEATURES.md row, permissions, types and fixtures, ApiClient + DemoStore (permission check inside the action), screen, unit and e2e tests, ADR, blueprint-delta row, commit, push, tick. Removing something means its switch goes off and its code stays. Low-memory testing always: production build, 2 workers, chunks, one server, stopped after. Full suite at the end of every batch.

#### Phase 0: plan
- [x] Spec saved in docs/specs/ and committed
- [x] Research, one ADR per area (0020 to 0026)
- [x] Walkthrough of all nine personas on a production build; docs/ux-audit.md
- [x] Plan: audit, research summary, data model, migration, assumptions with recommendations
- [x] Client notes in docs/feedback-demo.md
- [x] Owner's OK on the plan, including decisions N-1 to N-6 (all recommendations accepted, 2026-11-10)

#### Batch A: cross-cutting changes
- [x] A0. Groundwork: overlay schema 4 with reset and message; `skipIfFeatureOff` for Playwright and Vitest (K-12); root `pnpm start` (K-13); Purchasing role and seeded user, Purchasing and Employee sign-in cards (K-1, U-26); new permission keys and `contracts` module; reservations follow the warehouse holding the stock (U-03)
- [x] A1. Square feet everywhere: area-unit setting removed, helpers kept; products, lines, stock, purchasing, reports and PDFs in sq ft; rolls show length and width in ft with area in sq ft first; carton hint beside or on hover; cartons typed convert to sq ft; whole cartons per N-2; seed prices per sq ft, reconciliation green (U-13, U-36, K-2)
- [x] A2. Warehouse on new quotes: Fulfilled from first and required, default the user's warehouse; each line shows available in that warehouse (sq ft, ≈ cartons); when short, warn and offer another warehouse for the line or a transfer; carries through invoice, reservations and cuts; product picker shows brand, SKU, price and availability (U-14, U-19)
- [x] A3. Switch off Adjustments, Installation and four reports: `inventory.reservations` split out (K-4), one key per report (K-5); Owner-only Correct stock count (A-1); Contracts takes the menu slot; every invoice has a due date (K-3, U-09, U-31, U-37); Installer card gone (K-6); tests skip automatically and flows through installation rewritten
- [x] A4. Email and notification centre (ADR 0020): Settings → Email and notifications with events, toggles, templates and preview; Outbox with banner, statuses and redaction; stored per-user in-app notifications beside the derived Needs attention
- [x] A5. Audit fixes owned by no other item: Sales records deposits and marks sent per N-1 (U-05); only the next valid action on quotes (U-20); invoice links to quote and customer (U-21); Warehouse home and Ready to cut (U-22); transfer product search (U-23); verify count only what the viewer may confirm (U-16); warn about payments already waiting (U-18)
- [x] Batch A: full suite green (283 passed, 7 skipped as switched off, on a production build in six chunks)

#### Batch B: purchasing, suppliers and their sales reps
- [x] B1. Suppliers directory (ADR 0022): type, status, account number, 1099 and W-9 flags, terms, credit, balance; contacts with role, phones, email, WhatsApp flag, preferred method, notes, primary; one tap to call, email or copy; add, edit, deactivate (U-10); supplier import updated
- [x] B2. Purchase order form: supplier search by name, contact, phone or email with Add new supplier inline; Sales rep picker, primary first, with Add new contact inline; lines in sq ft with carton hint, cost per sq ft and Receive into per line; receipts into several warehouses; rep snapshot; PDF and "PO sent" email to the rep; Mark as ordered by phone; PO ↔ receipt ↔ bill ↔ payment links (U-12); batch 2 statuses and layout fix kept
- [x] B3. Finance → Payments to verify (K-7): customer and supplier payments with proof preview, Confirm, Reject, Void; pending state on the bill, no double pay (U-04, U-15); uploader wording, file size and date fixes (U-33 to U-35)
- [x] Batch B: full suite green (287 passed, 7 skipped as switched off)

#### Batch C: HR, end to end, plus an employee portal
- [ ] C1a. HR Home: what needs action, birthdays, anniversaries, holidays; submitted timesheets counted (U-17)
- [ ] C1b. People: directory and profiles, FLSA status, home location, documents, emergency contact, onboarding and offboarding checklists (U-11)
- [ ] C1c. Timesheets: approval queue, reject with reason, bulk approve, CSV and Excel template and upload, overtime by workweek and regular rate, California seventh day, stated workweek start (ADR 0024, U-08)
- [ ] C1d. Time off: policies, accrual ledger, caps with California guards, decline with reason, team calendar, balances (U-24)
- [ ] C1e. Commissions moved to HR (ADR 0025): plans, assignments with acknowledgement, tiers, split, override, draw, clawback, statements, adjustments with reason, credit-note action (K-11); Sales → Team links here (U-07)
- [ ] C1f. Pay periods: review gross pay by the corrected formula (N-3), approve, CSV exports, contractor payments list, required label (U-07)
- [ ] C1g. Settings → HR: pay periods, overtime rules, holidays, policies, employee visibility (U-30)
- [ ] C2. Employee portal in both products: My timesheet (form or template upload, submit), Clock in / out, My time off, My pay, My commission, My documents, My meetings, My profile; own data only; hidden items absent; employees land here (U-01, U-02, U-25)
- [ ] Batch C: full suite green (both products)

#### Batch D: Contracts (ADR 0026)
- [ ] D1. Customer and subcontractor contracts: master and project, schedule of values or milestones, retainage, dates, insurance certificate, W-9 / 1099 flag
- [ ] D2a. Lifecycle: Draft → Sent for signature → Active → Completed → Closed, Expired derived, Terminated with reason; simulated signature with PDF and audit entry
- [ ] D2b. Progress billing: billings per period, retainage held off invoice totals, partial release invoices, tax setting, stored materials, subcontract bills through supplier bills and payments, estimated cost share (K-10)
- [ ] D2c. Change orders with approval and revised contract value
- [ ] D2d. Documents and compliance: attachments, insurance expiry per coverage, lien waivers per payment with exchange rules
- [ ] D2e. Reminders through the notification centre; contract list with filters; contract page with value, invoiced, paid, retained, remaining; Contracts dashboard widget
- [ ] Batch D: full suite green

#### Batch E: meetings with customers and email (ADR 0021)
- [ ] E1. Guests: internal users, customers, customer contacts, supplier contacts, Add guest by email; Settings → Meetings for new-guest handling (E-1, K-8)
- [ ] E2. Invites: Outbox row and `.ics` per guest; stable UID; SEQUENCE on significant changes; cancellations; guest removal; recurring cases; Add to my calendar; one manual import check in Google Calendar and Outlook
- [ ] E3. Replies: Accept, Maybe, Decline, Propose a new time; Simulate reply in the Outbox; organiser accepts or declines a proposal
- [ ] E4. Request a meeting, for every user (U-32); reminder defaults and per-meeting override; privacy and hidden guest lists; batch 2 calendar views and drag and drop kept
- [ ] Batch E: full suite green

#### Batch F: expenses and one business report (ADR 0023)
- [ ] F1a. Finance → Expenses: every field in the spec, receipt required on leaving draft, approval above an amount, Pay later through a linked bill, sales tax payment category (U-06)
- [ ] F1b. Recurring expenses: a draft each period to confirm with the actual amount
- [ ] F1c. Floor area per location; shared costs rule in Settings, split by largest remainder; `journal.ts` postings
- [ ] F2. Business report: Summary, Profit by location, Revenue and margin, Expenses, Cash, Purchases, Taxes, People costs, Stock on hand; period with comparison; filters; chart / table toggle; drill-down; CSV and PDF that match the screen (U-27)
- [ ] Batch F: full suite green

#### Batch G: final walkthrough and polish
- [ ] G1. Seed data per the spec, plus healthy payables and sales across locations (U-28, U-29); reconciliation extended (expenses in the ledger, location profit = company profit, contract invoiced + remaining = value, gross pay = its parts)
- [ ] G2. Unit tests: carton hints and rounding, warehouse availability, commission rules, overtime weekly and daily, gross pay, time-off accrual, retainage and milestone billing, change orders, ICS, expense sharing, report totals
- [ ] G3. E2E flows tagged `@flow`, 1 to 7
- [ ] G4. Repeat the walkthrough for every persona, all companies, both themes and 375 px; update docs/ux-audit.md; fix what is left at high or medium; list low items for later
- [ ] Batch G: full suite green

#### Batch H: the backbone for the real build
- [ ] H1. docs/product-spec/<module>.md for every module
- [ ] H2. docs/data-model.md mapped to the blueprint's PostgreSQL tables
- [ ] H3. docs/api-contract.md up to date
- [ ] H4. FEATURES.md, blueprint-delta.md, README.demo.md, docs/demo-script.md, presenter guide

#### End
- [ ] Redeploy production
- [ ] Full suite against both live addresses, in chunks
- [ ] Git tag `demo-v3`
- [ ] Final report: what changed, how to try each item (persona, company, record), what was assumed or left out

## Decisions
(see docs/adr/)

## Blockers
none
