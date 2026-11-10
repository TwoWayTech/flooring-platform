# Demo feedback

Template. Copy it for each demo session (for example `docs/feedback/2026-11-15-summit.md`) and fill it in during or right after the call. Turn each decided request into a `/feature-change` run.

- **Date:**
- **Demo shown:** Flooring Suite and HR Suite at commit `________` (https://flooring-demo-twowaytech.vercel.app, https://hr-demo-twowaytech.vercel.app)
- **Presenter:**

## Attendees

| Name | Company | Role |
| --- | --- | --- |
|  |  |  |

## Requests

Priority is **must-have** (needed before go-live), **later** (wanted, after go-live) or **no** (we will not build it). The decision says what we do and names the feature key from `docs/FEATURES.md`, or the new key it needs.

| # | What | Why | Priority | Decision |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |

## Answers to our open questions

The open decisions from the blueprint ("Open questions and risks"). The first four should be settled before the post-demo build starts. Some are ours to answer rather than the client's; leave those blank here if they did not come up.

| Question | Answer | Answered by |
| --- | --- | --- |
| Platform brand name and domain (placeholder yourplatform.com until then) |  |  |
| Legal entity that contracts with US clients and receives payments |  |  |
| Hours per week each of us can commit |  |  |
| Client's accountant: costing method, chart of accounts, sales tax registrations, rates and states |  |  |
| Which states each client sells and installs in |  |  |
| Payroll provider the client will adopt |  |  |
| Plan prices (monthly and yearly) |  |  |
| Go-live date, and which data is imported (products, customers, suppliers, opening balances) |  |  |
| Client-side person who signs off acceptance testing; contract terms for support, data ownership and hosting costs |  |  |
| Brand names and domains for Flooring Suite and HR Suite |  |  |
| Vercel Hobby for a client-facing demo, or Netlify Free to stay clear of Vercel's non-commercial rule |  |  |
| HR Suite pricing model (for example by employee band) |  |  |
| Claude Team seats instead of two individual plans |  |  |

## Next steps

| Action | Owner | Due |
| --- | --- | --- |
|  |  |  |

## Client notes for feature batch 3

Recorded 2026-11-10 from `docs/specs/feature-batch-03.md`. The notes reached us without the date of the call or the attendees, so those are left out. The client did not rank them; "must-have" means all nine are built in this batch. "Not stated" means the client gave no reason. Decisions are subject to the owner's OK on `docs/specs/feature-batch-03-plan.md`.

| # | What | Why | Priority | Decision |
| --- | --- | --- | --- | --- |
| 1 | Creating a new quote: choose which warehouse it comes from. | Not stated | must-have | Build A2, new key `sales.quote-availability`: Fulfilled from comes first and is required, each line shows availability in that warehouse, and a shortage offers another warehouse or a transfer. |
| 2 | The whole system in square feet, with cartons shown beside it or on hover, especially in purchasing and inventory. | Not stated | must-have | Build A1, new key `units.square-feet`. The area-unit setting goes. Whether a sold line bills whole cartons is plan decision N-2. |
| 3 | The adjustments page isn't needed. | Not stated | must-have | Switch off `inventory.adjustments`; code kept. New key `inventory.stock-correction` for one Owner-only Correct stock count (assumption A-1). |
| 4 | Purchase orders: find or add a supplier, and a new page that lists each supplier's sales reps (the people who answer my calls) with their details; add new reps or companies; in the PO, the supplier and sales rep above, the warehouse on each product line; adding a new one there saves it to that page too. As flexible and easy as possible. | "As flexible and easy as possible" | must-have | Build B1 and B2: new key `purchasing.suppliers`, changes to `purchasing.orders`. Anything added inside a PO is saved to the directory at once. |
| 5 | HR: commission logic (researched), submit timesheets or download the template, a real end-to-end HR area, and an employee portal for timesheets, time off and earnings to date, with commission shown or hidden by the admin, and salary calculated from leave and commission when visible. | Not stated | must-have | Build C1 and C2 in both products: new keys `hr.commissions`, `hr.pay-periods`, `hr.portal`, `hr.clock`, `settings.hr`. Research changes the pay formula and when commission is earned (plan decisions N-3 and N-4). |
| 6 | Installation removed; contracts with other companies instead, with researched logic. | Not stated | must-have | Switch off `installation.calendar`; code kept. Build Batch D: new keys `contracts.register`, `contracts.billing`, `contracts.compliance`, covering customer and subcontractor contracts (assumption D-1). |
| 7 | Meetings: add a customer by email if they aren't in the list, configured somewhere; email logic that makes sense for every kind of user (admin, HR, employee requesting a meeting). | Not stated | must-have | Build Batch E and A4: new keys `meetings.invites`, `meetings.requests`, `settings.meetings`, `settings.notifications`, `settings.outbox`. The demo simulates sending (assumption F-2). |
| 8 | Reports: remove Sales tax by jurisdiction, Inventory valuation, Receivables aging, Payables aging; one report with everything from payments to revenue to warehouses and profit, including what the company pays (taxes, electricity, supplies, fixes) per warehouse and shop, and to which company. | Not stated | must-have | Switch off those four, each with its own key. Build Batch F: new keys `reports.business`, `finance.expenses`, `finance.recurring-expenses`, `settings.cost-sharing`. Whether the other three reports stay is plan decision N-6. |
| 9 | Overall: use the site end to end as a real user, fix workflows that don't make sense and pages with no actions. | Workflows that don't make sense and pages with no actions | must-have | Done for the first pass: `docs/ux-audit.md` has 37 findings. High and medium ones are fixed in the batches, and Batch G repeats the walkthrough. |
