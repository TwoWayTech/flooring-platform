# UX audit: the demo walked as its real users

Section 1 of `docs/specs/feature-batch-03.md`. This is the first pass, before any Batch 3 work. Batch G repeats it on the finished build and updates this file.

## How it was done

- **Build:** local production build of commit `0305fc9`, walked on 2026-11-10 with Playwright MCP at 1440 px, one server, stopped afterwards.
- **Sign-in:** the first persona (Owner) went through the real sign-in screen. The others used the demo session route the tests use, because the walk is about daily work, not signing in.
- **Purchasing has no persona.** No such role exists, so that walk used the Manager (Luis Ortega), who holds the purchasing permissions.
- **Employee on the Flooring Suite has no card** on the sign-in screen, so that walk (Bri Alvarez) used the session route.
- **Not covered in this pass:** Keystone Flooring Supply (the spec names Summit), dark theme, and phone width beyond the timesheet page (no sideways scroll there). No console errors were seen on the Harbor pages, the only ones where the console was watched. Batch G covers all companies, both themes and 375 px.

Severity: **high** means a person cannot finish their work, or the screen misleads them about money or stock. **Medium** means they can finish, with extra steps or confusion. **Low** is polish.

## High

| Id | Page | Persona | What happened | Why it is a problem | Fix |
| --- | --- | --- | --- | --- | --- |
| U-01 | `/hr` | Employee (Bri), Sales (Priya) | Bri signs in and lands on "You don't have access to this page". Priya has an HR menu item that opens the same page. The platform admin's access preview says Sales may open HR. | The first screen of a whole role is a refusal, and a menu item leads nowhere. | C2: employees land on My portal. Menu items go to the first page the person may open. |
| U-02 | `/hr/timesheets` | Employee (Bri, Mia), Sales (Priya) | Hours are read-only: no field, no Submit. Mia (Harbor) sees "No timesheets for this week" and a blank week label. | The persona's main job does not exist. | C2: My timesheet with form, template upload and Submit. |
| U-03 | Roll page, Cut roll | Warehouse (Cole) | On roll NM-6016 Cole sees Reserved 0.00 ft, Available 70.00 ft and "No invoice holds this roll yet". The Owner sees the same roll with Reserved 12.55 ft for INV-1220. Cause: reservations follow the invoice's branch (`scope.ts:51`), every Summit invoice is in the Denver branch, and both Warehouse users are in Colorado Springs. | Warehouse staff cannot cut for a paid invoice and see held stock as free. | Batch A: reservations follow the warehouse holding the stock, with just enough of the invoice to cut against it. Add a Ready to cut list (U-22). |
| U-04 | Bills and payables | Accountant (Grace) | Paying bill TV-55021 ($21,392.00) says "it waits for verification", then the row still reads Open, Paid $0.00, with Pay still offered and no sign of the payment. `reviewSupplierPayment` and `voidSupplierPayment` exist in the API, but no screen calls them. | A supplier payment above the approval limit can never be confirmed or voided, and the bill can be paid twice. | Batch B: payments on the bill and supplier, a Pending state on the bill, Confirm / Reject / Void, and the shared queue (U-15). |
| U-05 | New invoice | Sales (Priya) | INV-1221 offers only Print and Download PDF. The timeline says Sent "Not yet" and Deposit "Not yet", with no action and no hint who does it. | The spec's Sales day continues to "deposit with proof"; here it stops. | Plan decision N-1. |
| U-06 | No page exists | Accountant | Nothing records an expense: no page, and "expense" finds nothing in the command palette. Report expenses come only from seed data. | Client note 8, the core of the new report, has no input. | F1. |
| U-07 | Sales Team, Settings Commissions | HR manager (Tamara) | Both refuse with no access. HR has no commission, pay period or export page; the only payroll export is the Sales Team CSV. | HR's day ("review commissions, run a pay period and export it") cannot be done. | C1. |
| U-08 | `/hr/timesheets` | HR manager | Submitted sheets appear only as an Approve button in the status column of a past week, found by opening weeks one at a time. No reject, no bulk approve, no reason. Approve happens in one click. | Waiting work is hidden, and a wrong sheet cannot be sent back. | C1: approval queue, reject with reason, bulk approve. |
| U-09 | Installation, invoice | Sales, Owner | 18 seeded Summit invoices have no due date ("After installation"), and so does a new one (INV-1221, whose terms say Due on receipt, with no job). | With Installation switched off (A3) these balances never become due, and they stay out of overdue figures. | A3: every invoice gets a due date. See plan K-3. |
| U-10 | Suppliers tab | Purchasing | Row click does nothing. No add or edit. One contact name per supplier. | Client note 4 asks for exactly this page. | B1. |
| U-11 | `/hr/employees` | HR manager | Row click does nothing. No add, profile, documents or checklists. | HR cannot manage people. | C1. |
| U-12 | PO, bill, payment | Accountant, Warehouse | The PO drawer lists receipts but not the bill. Bill rows open nothing. Receipts and supplier payments have no links. | The spec requires PO ↔ receipt ↔ bill ↔ payment. | Batch B: linked sections both ways. |
| U-13 | New quote, inventory, purchasing, rolls | Everyone | Sold and ordered in cartons, carpet in sq yd, roll area in sq yd, price "per carton". | Client note 2. | A1. |
| U-14 | New quote | Sales | Fulfilled from is the third field. Lines do not show availability, and there is no warning or offer of another warehouse. | Client note 1. | A2. |

## Medium

| Id | Page | Persona | What happened | Why it is a problem | Fix |
| --- | --- | --- | --- | --- | --- |
| U-15 | Dashboard → Review → invoice | Owner | Payments to verify opens a filtered invoice list, and each payment needs its own invoice page, then Confirm. Confirm takes one click with no prompt to open the proof. | The morning approval run is 3 page visits per payment, and proof can be skipped. | Finance → Payments to verify: customer and supplier payments, proof preview, Confirm / Reject in place. |
| U-16 | Dashboard | Accountant | "2 waiting for a second person", but Grace recorded both and cannot confirm them. | It asks her to act on work she may not do. | Count only what the viewer may confirm; show the rest as waiting for someone else. |
| U-17 | HR home, bell | HR manager | Three submitted timesheets are not counted. The only timesheet check is "with overtime this week" (`attention.ts:191`). | HR is not told about waiting approvals. | C1 Home; new attention check. |
| U-18 | Record payment | Owner | With the full remaining balance already pending, the form prefills that same amount with no warning, and shows Balance after $0.00. | Invites recording a payment twice. | Show what is already waiting, and prefill balance less pending. |
| U-19 | Product picker | Sales | "Shoreline Plank Linen $50.89" and "$136.42" look alike: no brand, SKU, unit or stock. | Easy to pick the wrong product. | A2: brand, SKU, price per sq ft and availability in each result. |
| U-20 | Quote builder | Sales | Convert to invoice is offered on a blank new quote (validation stops it) and on a Pending one, before acceptance. | The button skips the flow's steps and its name appears too early. | Show the next valid action only. |
| U-21 | Invoice | Sales, Owner | No link to the quote or the customer; Q-2283 is plain text. | The spec requires quote ↔ invoice ↔ payments ↔ cuts. | Links in the invoice header. |
| U-22 | Dashboard | Warehouse | Shows slow movers and today's jobs; nothing about POs due, transfers to receive or invoices ready to cut. Warehouse has no Sales menu. | The home page ignores the day's work. | Warehouse widgets; Ready to cut list. |
| U-23 | New transfer | Warehouse | Native list of about 80 products, duplicate names, no search. | Slow and error-prone. | Reuse the product search picker; sq ft with carton hint. |
| U-24 | Time off | HR manager | Deny acts at once, with no reason and no undo. | The employee gets no explanation, and a slip cannot be reversed. | C1: decline with reason. |
| U-25 | Time-off request | Employee | The form shows no balance, hours or result. The list has an Employee column naming only them. | They cannot tell if they have enough. | C2. |
| U-26 | Sign-in | Presenter | No Employee card on the Flooring Suite, and no Purchasing role. | Two personas in the spec cannot be shown. | A0: both cards and the Purchasing role (plan K-1). |
| U-27 | Reports | Owner, Accountant | Figures have no drill-down, and the list runs to seven separate reports. | Client note 8. | F2. |
| U-28 | Payables | Accountant | Seed shows 64.2% of payables overdue and suppliers at 106.8% and 132.9% of credit. Receivables were tuned in batch 2; payables were not. | Looks like a failing business. | Batch G seed. |
| U-29 | Reports (future) | Owner | All 227 Summit invoices are in Denver Central. | Profit by location would be empty for the other locations. | Batch G seed: sales across warehouses and showrooms. |
| U-30 | Settings | HR manager | Tamara and Harbor's HR manager see only Users and Audit log. | Payroll and time-off rules are out of reach for HR. | C1 Settings → HR. |
| U-31 | Dashboard attention | Owner | "2 jobs completed with a balance due" opens every Open invoice. | The link does not show the two. | Removed with A3. |
| U-32 | Meetings | Employee | Can create a meeting but cannot ask someone for one. | Client note 7. | Batch E. |

## Low (left for later unless a batch touches the screen)

| Id | Page | What happened | Fix |
| --- | --- | --- | --- |
| U-33 | Enter bill | The file box says "receipt, bank confirmation or check photo" for a supplier's invoice. | Pass the wording to the shared uploader. |
| U-34 | File lists | A 40-byte file shows as "0.10 MB". | Show KB below 1 MB. |
| U-35 | Pay supplier | Bill due date printed raw: "due 2027-01-09". | Use the date formatter. |
| U-36 | Stock, invoice | "1.00 cartons", "1 cartons". | Goes away with A1. |
| U-37 | Paid invoice | Still says Due "After installation". | Goes away with A3. |

## What worked

- Sign-in, quick add of a customer and address suggestions inside the quote builder.
- Draft → Pending → Accepted → Converted, with View invoice on the quote.
- Roles: untick, Save, code, done in three steps.
- Receive, enter a matched bill, and record a payment with proof.
- Data import from an Excel file: columns auto-matched, one bad row reported, the good row imported, Undo offered.
- Filtered links from the dashboard keep their filters in the URL.

## Rules every fix follows (spec section 1)

- Every page has a clear primary action, or says it is read-only, what it is for, and links to where the action happens.
- No dead ends: quote ↔ invoice ↔ payments ↔ stock cuts; PO ↔ receipt ↔ bill ↔ payment; contract ↔ milestones ↔ invoices.
- Empty states explain and offer the first action. Action names stay the same through a flow.
