# Feature batch 3: final client notes, a full user walkthrough, and the backbone for the real build

Spec for Claude Code. Save as `docs/specs/feature-batch-03.md`. This batch finishes the demo and turns it into the **reference implementation** for the real product: once it's done, the demo's rules, screens and data model are what the real build (NestJS, PostgreSQL, per the blueprint) copies.

## 0. How to work

1. Read `CLAUDE.md`, `docs/FEATURES.md`, `README.demo.md`, `docs/STATUS.md`, `docs/specs/feature-batch-02.md`, its plan, and this file.
2. **Research first.** Use web search and fetch to study how established products and standards handle each area below (named in each section). Learn patterns and rules, never copy their screens or text. Record what you learned, with links, in an ADR per area (`docs/adr/`).
3. **Walk the current demo as a real user** before planning (section 1). Use Playwright MCP to click through every persona's daily work on the local production build. Write `docs/ux-audit.md`.
4. **Phase 0 plan, then stop for my OK.** In `docs/specs/feature-batch-03-plan.md`: what the audit found, the research summary, data-model changes and the DemoStore migration, every ASSUMPTION (Appendix A) with your recommendation, and a "Feature batch 3" checklist in `docs/STATUS.md` in batch order so `/continue` can resume. Also copy the client notes below into `docs/feedback-demo.md` (requests table, with decisions), and commit that file.
5. **After my OK,** build batch by batch without stopping. Per item: feature key in `packages/shared`, row in `FEATURES.md`, ADR for model changes, `blueprint-delta.md` entry, tests, commit and push, tick `STATUS.md`.
6. **Removing things:** switch the feature off with its key (hidden from menus, pages, palette, presenter guide, notifications, dashboard and seed views), keep the code, and make that feature's tests skip automatically while its switch is off. Delete code only if I ask later.
7. **Low-memory testing (always):** test against a production build (`pnpm build`, then `pnpm start`), 2 Playwright workers (1 if memory is tight), e2e in chunks by project or folder, one server at a time, stopped after each run. Add this as a rule in `CLAUDE.md` if it isn't there.
8. **Everything from earlier batches still applies:** front end only, `apiClient` + DemoStore, IndexedDB files behind the storage interface, decimal money helpers, units helpers, permission checks in UI and save logic, reuse existing components, no second way of doing something, quality floor (keyboard, labels, 375 px, both themes, reduced motion, no console errors).
9. **End:** final walkthrough (section G), backbone docs (section H), deploy, full suite against both live addresses, git tag `demo-v3`, and a report: what changed, how to try each item (persona, company, record), what was assumed or left out.

---

## 1. The user walkthrough (before planning, and again at the end)

Act as each person below and do their real work end to end, the way they would on a normal day. Note every step that is confusing, takes too many clicks, dead-ends, or leads to a page where nothing can be done.

| Persona | Daily work to walk through |
| --- | --- |
| Owner (Summit) | Morning check on the dashboard; approve payments waiting for verification; review the business report; change what Sales can see |
| Sales | New customer with a new address → quote from a chosen warehouse → send → accepted → invoice → deposit with proof; check own commission |
| Warehouse | Receive a purchase order into a warehouse; cut a roll for a paid invoice; transfer stock between warehouses |
| Accountant | Verify payments; enter and pay supplier bills; record expenses for a warehouse and a showroom; read the business report |
| Purchasing | Find or add a supplier and its sales rep inside a new purchase order; order in sq ft; receive; bill |
| HR manager | Approve timesheets and time off; review commissions; run a pay period and export it |
| Employee | Submit a weekly timesheet (form and template upload); request time off; see own pay and, if allowed, commission |
| Platform admin | Set a company's access; import customers from Excel |
| Harbor Staffing (HR Suite) | Same HR and employee work on the HR site |

For each finding, record: page, persona, what happened, why it's a problem, severity (high, medium, low), the fix. Rules the fixes must follow:
- Every page either has a clear primary action, or is deliberately read-only and says what it's for, with links to where the action happens.
- No dead ends: every record links to the records around it (quote ↔ invoice ↔ payments ↔ stock cuts; PO ↔ receipt ↔ bill ↔ payment; contract ↔ milestones ↔ invoices).
- Empty states explain and offer the first action. Names of actions stay the same through a flow.

Fix every high and medium finding as part of the batches (section G lists any left over).

---

## Batch A: cross-cutting changes

### A1. Square feet everywhere
- **Square feet is the one unit** for area across the system: quantities, prices (price per sq ft), stock, purchasing, reports, PDFs. Remove the area-unit choice from Localization settings (keep the internal conversion helpers).
- Carpet rolls: show length in ft and width in ft, with the area in sq ft as the main figure.
- **Cartons as a hint:** wherever a carton product's quantity appears (purchasing, inventory, quotes, invoices, receipts), show the carton equivalent beside it in muted text or on hover: "500 sq ft ≈ 22 cartons (23.64 sq ft each)". Entering cartons in a quantity field converts to sq ft. Partial cartons round up when ordering.
- Update seed prices to per-sq-ft and keep the reconciliation test green.

### A2. Warehouse on new quotes
- Quote creation starts with **Fulfilled from** (required, defaults to the user's default warehouse).
- Each product line shows **available in that warehouse** (sq ft, ≈ cartons). If it isn't enough, warn and offer: pick another warehouse for this line, or create a transfer.
- The warehouse carries through to the invoice, reservations and cuts.

### A3. Switch off: Adjustments, Installation, four reports
- **Adjustments page:** off. Approval queue, the ADJ records and their dashboard and notification items disappear. See ASSUMPTION A-1 for stock corrections.
- **Installation module:** off (jobs, crews, job card, Schedule installation, Start job, installation sign-off, today's-jobs widget, Installer persona on the login page). Batch D's Contracts takes its menu place.
- **Reports:** Sales tax by jurisdiction, Inventory valuation, Receivables aging and Payables aging: off. Batch F's Business report replaces them.
- Tests for switched-off features skip automatically; flows that passed through installation are rewritten to the new flow.

### A4. Email and notification centre (used by everything below)
Research: how Odoo, QuickBooks, Gusto and calendar standards (iCalendar, RFC 5545) handle notifications, templates and invites.
- **Settings → Email and notifications:** sender name and reply-to; a list of events (quote sent, invoice sent, payment receipt, payment to verify, supplier PO sent, timesheet submitted / approved / rejected, time off requested / decided, commission statement ready, meeting invite / update / cancel / reminder, contract sent for signature / expiring, milestone invoiced) each with an on/off toggle, a template with variables, and a preview.
- **Outbox** (admins see all, users see their own): every email the system would send, with recipient, subject, body preview, attachments (PDF, `.ics`) and status. The demo never sends real email; the real build sends through the `EmailProvider`. Show a banner saying so.
- In-app notifications stay; each event can notify in-app, by email, or both.

---

## Batch B: purchasing, suppliers and their sales reps

Research: supplier and vendor contact management in Odoo, QuickBooks and flooring ERPs (RFMS, QFloors).

### B1. Suppliers directory with contacts
- **Purchasing → Suppliers** becomes a directory: each supplier shows company details, payment terms and credit (from batch 2), balance, and its **contacts**: the sales reps and people who answer your calls.
- A contact has: name, role (sales rep, account manager, accounts receivable, other), mobile, office phone, email, WhatsApp-friendly number flag, preferred contact method, notes, and a **primary** flag. One tap to call, email or copy.
- Add, edit and deactivate suppliers and contacts from the directory. A supplier can also be a service or utility company (type: Goods, Services, Utility, Government) so expenses (batch F) use the same directory.

### B2. The purchase order form
- Header: **Supplier** picker (search by name, contact, phone or email) with **Add new supplier** inline (name required; the rest later, marked "profile incomplete"). Under it, **Sales rep** picker listing that supplier's contacts, primary first, with **Add new contact** inline (name plus email or phone). Anything added inline is saved to the directory at once.
- Lines: product (search), quantity in sq ft (carton hint), unit cost per sq ft, and **Receive into** warehouse per line (defaults to the header warehouse).
- The PO PDF and the "PO sent" email go to the chosen sales rep.
- Keep batch 2's statuses, drafts, receipts, bills, payments and the long-name layout fix.

---

## Batch C: HR, end to end, plus an employee portal

Research: Gusto, BambooHR and Rippling for HR, timesheets, time off and self-service portals; US Department of Labor guidance on overtime (FLSA) and a state example with daily overtime (California); sales commission plan practices (on-collection payout, gross-margin plans, tiers, splits, draws, clawbacks). Applies to the HR module in the Flooring Suite and to the HR Suite.

### C1. HR workspace (where HR lives all day)
- **Home:** what needs action: timesheets to approve, time off to decide, commission statements to approve, pay period status, birthdays and work anniversaries, upcoming holidays.
- **People:** directory and profiles: job title, department, manager, location, employment type (W-2 hourly, W-2 salaried, 1099 contractor), start date, pay type and rate (sensitive), time-off balances, documents, emergency contact. Onboarding and offboarding checklists.
- **Timesheets:** weekly grid per employee; approval queue (approve, reject with reason, bulk approve); **Download template** (CSV and Excel, one row per employee per day) and **Upload** for bulk entry, validated with row errors; overtime worked out from the company's payroll rules (federal weekly rule, state daily rule where set).
- **Time off:** policies (vacation, sick, personal, unpaid) with accrual rules and caps; requests with approve / decline and reason; team calendar; balances.
- **Commissions (moved here from Settings):** commission plans (percentage of paid revenue or of gross margin; tiers by monthly target; split between two reps; manager overrides; optional draw; clawback when an invoice is voided, refunded or written off within a set number of days); commissions are **earned when the customer's payment is confirmed**; monthly statements per rep, approved by HR or Owner, with adjustments that need a reason. Sales → Team keeps the performance view and links here.
- **Pay periods:** pick a period → review each employee's **gross pay** → approve → export CSV for the payroll provider. Gross pay = regular hours × rate + overtime hours × 1.5 × rate (+ double time where the state rule says) + paid time off + approved commissions + bonuses − unpaid leave; salaried staff: salary for the period − unpaid leave days × daily rate. Clearly labelled: "Gross pay estimate. Taxes and net pay are calculated by your payroll provider."
- **Settings → HR:** pay periods (weekly, biweekly, semi-monthly, monthly), overtime rules, holidays, time-off policies, and **employee visibility**: show pay to employees (on / off), show commission to employees (company default plus a per-employee override), show rates.

### C2. Employee portal (every employee, both products)
- A **My portal** area for the Employee role (and a "My" menu for everyone): **My timesheet** (fill the week, or download the template and upload it, then submit), **Clock in / out** (optional per company), **My time off** (balances, request, status), **My pay** (gross pay per period and earned to date this year, with the breakdown: hours, overtime, paid leave, unpaid leave, commission if visible), **My commission** (only if HR made it visible: statements and what's pending payment), **My documents**, **My meetings**, **My profile**.
- Employees see only their own data. Hidden items don't appear at all (not greyed out).

---

## Batch D: Contracts (replaces Installation)

Research: construction and service contract management in the US (Procore-style subcontracts, schedule of values and progress billing, retainage, change orders, certificates of insurance, lien waivers, renewals).

### D1. Two kinds of contract with other companies (ASSUMPTION D-1)
- **Customer contracts:** with builders, general contractors, property managers and dealers: a master agreement (pricing, terms, credit) and/or a project contract (scope, contract value, schedule of values or milestones, retainage %, start and end dates).
- **Subcontractor contracts:** with companies the business hires (installation crews, other trades): scope, rates or fixed price, payment terms, retainage, insurance certificate with expiry date, W-9 / 1099 flag.

### D2. Lifecycle and links
- Statuses: Draft → Sent for signature → Active → Completed → Closed; also Expired and Terminated (reason required). Signature is simulated in the demo (typed name, date, IP-free audit entry) and attached as a PDF.
- **Milestones / progress billing:** each milestone or schedule-of-values line can be invoiced; the invoice holds back the retainage; retainage is released with its own invoice at completion. Invoices and payments from batch 2 handle the money.
- **Change orders:** add or remove scope and value, with approval and a revised contract value.
- **Documents and compliance:** attachments, insurance certificate expiry alerts, lien waivers (conditional or unconditional, progress or final) recorded per payment.
- **Reminders:** contract end and renewal dates, expiring insurance, milestones due, all through the notification centre.
- Contract list with filters (type, company, status, value, end date); contract page shows value, invoiced, paid, retained, remaining.
- Dashboard: a **Contracts** widget (milestones due, expiring soon, retainage held) replaces Today's jobs.

---

## Batch E: meetings with customers and email

Research: invitation and RSVP patterns in Google Calendar and Outlook; iCalendar (`.ics`) invites (METHOD REQUEST and CANCEL, a stable UID, SEQUENCE on updates).

- **Guests:** add internal users, customers, customer contacts and supplier contacts from search. If the email isn't in the system, **Add guest by email** (name optional). What happens to new guests is set in **Settings → Meetings**: save as a new customer contact (pick the customer), save as a new lead, or don't save.
- **Invites:** saving a meeting puts an invite in the Outbox for each guest, with an `.ics` attachment that adds it to any calendar. Moving or editing it sends an update (same UID, higher SEQUENCE); cancelling sends a cancellation.
- **Replies:** guests can accept, decline or propose a new time. In the demo, the Outbox has **Simulate reply** so the organiser sees responses arrive.
- **Requests:** any user can **Request a meeting** with someone (an employee asks HR for a review, Sales asks a manager); the other person accepts, declines or proposes another time.
- **Reminders:** default reminder times in Settings → Meetings, per meeting override.
- **Privacy:** employees see their own meetings and shared calendars only; HR meetings can be private.
- Keep batch 2's calendar views and drag and drop.

---

## Batch F: expenses and one business report

Research: expense tracking and location (branch) profit-and-loss reporting in QuickBooks and Odoo.

### F1. Expenses
- **Finance → Expenses** (or under Purchasing if that reads better; decide in the plan): record an expense with date, vendor (from the suppliers directory, type Services, Utility or Government), category (rent, electricity, water, internet and phone, supplies, maintenance and repairs, fuel and vehicles, insurance, taxes and licences, marketing, professional fees, other), **location** (a warehouse, a showroom, or company-wide), amount, tax, payment method, reference, **receipt file (mandatory)**, note.
- **Recurring expenses** (monthly rent, electricity): generate a draft each period to confirm with the actual amount.
- Optional approval above an amount, reusing the payments approval pattern.
- Each location gets a floor area (sq ft) in Settings → Warehouses and showrooms, used for cost sharing.
- **Shared costs:** company-wide expenses are split across locations by a rule in Settings (by revenue share, by floor area, equally, or fixed percentages; ASSUMPTION F-1).
- Expenses post to the hidden ledger per the blueprint's posting rules.

### F2. The business report (replaces the four removed reports)
One report with sections, a period picker with comparison to the previous period, and filters for location(s), category, salesperson and vendor company:
- **Summary:** revenue, cost of goods, gross profit and %, operating expenses, net profit and %, cash received, cash paid out, customers owe (current / overdue), you owe suppliers (current / overdue).
- **Profit by location:** revenue, cost of goods, direct expenses, shared expenses, net profit, per warehouse and showroom.
- **Revenue and margin** by product category and by salesperson.
- **Expenses** by category, by vendor company and by location.
- **Cash:** payments received by method; payments made to suppliers and for expenses.
- **Purchases** by supplier.
- **Taxes:** sales tax collected vs taxes paid (from expense records).
- **People costs:** gross pay and commissions for the period.
- **Stock on hand** value by warehouse (a compact section, not a separate report).
- Charts with a table toggle, drill-down from any figure to the records behind it, and CSV and PDF exports that match the screen.

---

## Batch G: final walkthrough and polish
- Repeat section 1 for every persona on the finished build, update `docs/ux-audit.md`, and fix what's left at high or medium severity. List anything low-severity left for later.
- Seed data: suppliers with 1–3 contacts each, expenses for every location over 12 months (with receipts), a few recurring expenses, 3 customer contracts and 2 subcontractor contracts at different stages with milestones and retainage, timesheets and time-off for all employees including pending ones, commission plans and statements, meetings with external guests and a pending request, Outbox history. Extend the reconciliation test (expenses in the ledger; location profit adds up to company profit; contract invoiced + remaining = contract value; gross pay = its parts).
- Tests: unit tests for carton hints and rounding, warehouse availability, commission rules (on collection, tiers, split, clawback), overtime (weekly and daily), gross pay, time-off accrual, retainage and milestone billing, change orders, ICS generation (UID, SEQUENCE, CANCEL), expense sharing, report totals; e2e flows tagged `@flow`:
  1. Sales: new customer → quote from a chosen warehouse → invoice → deposit with proof → cut from roll.
  2. Purchasing: add a new supplier and sales rep inside a PO → order in sq ft → receive into two warehouses → bill → pay.
  3. Employee submits a timesheet by template upload → HR approves → pay period shows the gross pay.
  4. Employee requests time off → HR approves → balance and pay update.
  5. Customer contract → milestone invoice with retainage → payment → retainage release.
  6. Meeting with a new guest by email → invite in Outbox → simulated reply.
  7. Expense for a showroom with receipt → business report shows it in that location's profit.

## Batch H: the backbone for the real build
Write these from what the demo actually does, so the real build copies tested behaviour:
- `docs/product-spec/<module>.md` for every module: purpose, who uses it (permissions), workflows and status rules (state diagrams in Mermaid), business rules with formulas, entities and fields, events and audit entries, emails, reports, edge cases.
- `docs/data-model.md`: every DemoStore entity and relationship, mapped to the blueprint's PostgreSQL tables (control vs company database), with the changes this demo introduced.
- `docs/api-contract.md` brought up to date (every `apiClient` call, its input, output and permission).
- `FEATURES.md`, `blueprint-delta.md`, `README.demo.md`, `docs/demo-script.md` and the presenter guide updated.
- Deploy, full suite against both live addresses, tag `demo-v3`, final report.

---

## Appendix A: assumptions to confirm in Phase 0

- **A-1. Stock corrections without the Adjustments page.** With it off, stock changes only through invoices, receipts, supplier returns and transfers. Recommendation: keep one Owner-only "Correct stock count" action inside a roll or product, with a mandatory reason, audited, no separate page. Say if you'd rather have none at all.
- **A-2. Square feet only.** The area-unit setting is removed; sq yd and m² are no longer shown anywhere.
- **D-1. Contracts cover both directions:** customer contracts (you sell to another company) and subcontractor contracts (you hire another company, e.g. installers), since installation is removed.
- **C-1. Gross pay only.** The system calculates gross pay; taxes and net pay stay with the payroll provider, as the blueprint decided.
- **C-2. Commission visibility:** off for employees by default; HR turns it on per company or per employee.
- **E-1. New meeting guests** are saved as customer contacts by default (setting can change it).
- **F-1. Shared costs** split by revenue share by default.
- **F-2. The Outbox simulates email** in the demo; real sending arrives with the real build.

## Client notes, as given (copy into docs/feedback-demo.md)

1. Creating a new quote: choose which warehouse it comes from.
2. The whole system in square feet, with cartons shown beside it or on hover, especially in purchasing and inventory.
3. The adjustments page isn't needed.
4. Purchase orders: find or add a supplier, and a new page that lists each supplier's sales reps (the people who answer my calls) with their details; add new reps or companies; in the PO, the supplier and sales rep above, the warehouse on each product line; adding a new one there saves it to that page too. As flexible and easy as possible.
5. HR: commission logic (researched), submit timesheets or download the template, a real end-to-end HR area, and an employee portal for timesheets, time off and earnings to date, with commission shown or hidden by the admin, and salary calculated from leave and commission when visible.
6. Installation removed; contracts with other companies instead, with researched logic.
7. Meetings: add a customer by email if they aren't in the list, configured somewhere; email logic that makes sense for every kind of user (admin, HR, employee requesting a meeting).
8. Reports: remove Sales tax by jurisdiction, Inventory valuation, Receivables aging, Payables aging; one report with everything from payments to revenue to warehouses and profit, including what the company pays (taxes, electricity, supplies, fixes) per warehouse and shop, and to which company.
9. Overall: use the site end to end as a real user, fix workflows that don't make sense and pages with no actions.
