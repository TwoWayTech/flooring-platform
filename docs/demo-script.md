# Demo script

A 40-minute click path through both products, persona by persona. It follows the steps in the presenter guide (the presentation icon in the top bar), so you can keep the guide open and click each step as you go. Timings are a guide; the optional parts at the end add about 5 minutes.

Everything is dummy data. Companies, people and product brands are invented. No email leaves the demo: everything the system would send lands in the Outbox.

## Before you start (2 minutes, before the audience joins)

- Open the Flooring Suite: `https://flooring-demo-twowaytech.vercel.app` (locally `http://localhost:3000/login`). Open the HR Suite in a second tab: `https://hr-demo-twowaytech.vercel.app` (locally `http://localhost:3000/login?product=hr`).
- If anyone has used this browser for the demo before, sign in as any persona, open the account menu (your initials, top right) and choose **Reset demo data**. Every company goes back to its generated data, moved to today's date.
- Pick the theme you want to show with the theme button in the top bar. Light suits projectors; dark suits screens.
- The sign-in code is any 6 digits; the screen hints 123456.
- For the import step, have a small customers CSV ready, or download the template on the spot (step 14).

## 1. Owner of a flooring store (22 minutes)

Sign in: **Summit Floor Co.**, persona **Dana Whitfield, Owner**, code 123456. Then open the presenter guide.

1. **Dashboard.** Pick a period (This month, Last 30 days, This quarter, Year to date or Custom). Each figure card shows its change against the period before and a small trend; receivables, payments waiting for verification and best sellers follow the same period. Point at **Needs attention**: what is waiting for someone today.
2. **Quote a job.** **New quote**. Choose the warehouse it ships from; each line then shows what is available there. Pick a customer, or type a new name to add one with a suggested address. **Add room** (12 × 12 ft), **Add product** (search "Shoreline Plank") and **Add labor or service** (search "Hard surface installation"). Area is in square feet, with cartons beside it. Waste is included but stays internal, off the customer's PDF. Change **State** to New Jersey: labor becomes taxed. Change it back. **Save as draft** (Draft), then **Send / mark pending** with a valid-until date (Pending), then **Mark accepted** and **Convert to invoice**.
3. **Split, then deposit with proof.** On the new invoice the **Stock** panel shows what is reserved for it. Open **Update status** first: **Commission split** shares the sale between two reps, and it is offered only until the first payment is confirmed, so show it now. Then **Update status**, **Record deposit**: the amount is the quote's deposit; attach a receipt (PDF or photo, checked by its real type). Payments over $1,000 wait for a second person (Pending verification) before the balance drops. **Download PDF** matches the screen.
4. **Corrections on an invoice.** Once a payment is confirmed, Commission split and Void leave the **Update status** menu; corrections go through **Issue credit note** for part of an invoice. A credit note becomes customer credit, lowers revenue in every report and reverses commission inside its 90-day window.
5. **Cut a roll.** Inventory, **Rolls and remnants**, open a roll: On hand, Reserved and Available. Every cut has a source, so each foot is accounted for. On an invoice with its deposit in, **Cut** in the Stock panel takes the reserved length; a leftover under 12 ft becomes a remnant.
6. **Receivables.** Sales, **Customers and receivables**: Current, Overdue and Due in the next 7 days, with **Overdue only**. Open a customer for their statement.
7. **Purchasing.** Purchasing, **Suppliers**: **Add supplier**, then open one and **Add contact** for the sales rep who answers your calls. **New purchase order**: find or add the supplier, pick the **Sales rep**, put a warehouse on each line and order flooring by area; the cartons are calculated. **Save as draft**, then **Place order**. **Receive** part of it (some damaged), **Enter bill** with the supplier's file (differences from the order are flagged), then under **Bills and payables**, **Pay** with proof. The supplier's terms set the due date.
8. **Contracts.** Contracts, open **CTR-1001 Ridgeline condos, phase 2**. The **Schedule of values** shows each line's value, what has been billed and what is retained. **Billing** posts a pay application with retainage held off its total; **Release retainage** bills it later. A **Change order** raises the contract value once approved and never touches issued invoices. **Lien waivers** and **Insurance** track compliance. **CTR-1005 Harvest Commons tile setter** is a subcontract waiting for a signature; the signature is a typed name and is labelled as simulated.
9. **Expenses.** Finance, **Expenses**: **New expense** with vendor, category, location and receipt; a large one waits for approval, and nobody approves their own. **Manage recurring** shows rent and utilities that make a draft each period, waiting for the actual amount.
10. **Business report.** Reports opens on last month. One report goes from revenue to net profit, then profit by location with shared costs split, cash, purchases, taxes, people costs and stock. Click any figure to see the records behind it. Filter by location, product category, expense category, salesperson or vendor. **Export CSV** and **Export PDF** print the same rows. Profit and loss, Sales by category and Payments received are alongside it.
11. **Meetings.** **New meeting**: type an email in Guests to add someone who is not in the list, then **Schedule meeting**. Settings, **Outbox** shows the invitation with its calendar file. Back on the calendar, open a meeting: **Edit details**, **Add to my calendar**, and each guest's answer. Drag **Weekly sales huddle** an hour later: a repeating meeting asks **This event**, **This and following events** or **All events**; choose This event, then **Undo** in the message. **Request a meeting** is open to everyone and stays tentative until the other person accepts.
12. **HR, inside the Flooring Suite.** HR, **Pay periods**: gross pay by workweek, **Approve pay period**, then **Export for payroll**. Gross pay only; taxes and net pay stay with the payroll provider. HR, **Commissions**: **Plans**, **People on plans** and **Statements**. **Approve statement** freezes a month; later changes go on an open month.
13. **Sales team.** Sales, **Team**: sales, paid revenue, margin, quotes sent and commission earned, paid and pending per salesperson for the period.
14. **Data import.** Settings, **Data import**, **Customers**: download the **CSV template** or **Excel template**, then upload a file. Columns match by header name (and are remembered); **Check the file** shows the dry run ("Creates 2, updates 0, skips 0; 1 row has errors") with the bad cells underlined. **Import**, download the error report, then **Undo** the import from Import history. **Connect a database** shows how a live connection would be planned; its test uses a sample database and stores nothing.

## 2. The same screens, seen as Sales (2 minutes)

15. **View as Sales.** In the sidebar, **View as**, then **Sales** (or Ctrl K and type "View as Sales"). A banner says what is hidden. Inventory has no cost column, the dashboard no margin, and Sales sees payments but cannot record them by default. The presenter guide greys out steps Sales cannot open. Choose **Stop viewing as** in the banner.

## 3. Settings and controls (6 minutes)

16. **Security roles.** Settings, Security roles. The Owner role is locked. Open **Sales**, untick **View products** and **View rolls**, save (the code is 123456), then View as Sales: Inventory is gone from the menu and its pages say you don't have access. Then open **Manager**, tick **View security roles** and **Manage security roles**, save; the change asks for the authenticator code (123456). Sign in as **Luis Ortega, Manager** and open the **Sales** role: permissions Luis does not hold himself are greyed out with "You can only grant permissions you hold". Sign back in as Dana.
17. **Number format.** Settings, Number format. Set money to 0 decimals and save. Invoices now show whole dollars; hover a total to see the exact cents. Set it back to 2.
18. **Branding.** Settings, Branding. Change the brand color (try `#7A3E9D`) and save: buttons, links, the floor pattern and charts change at once, and text stays readable in both themes.
19. **Audit log.** Settings, Audit log. Every change from this demo is here, with who, when, before and after, including imports and their Undo.

## 4. Other people in the store (3 minutes)

Sign out (account menu), then sign in as each persona.

- **Priya Natarajan, Sales.** Her own customers, quotes and sales, without margin; Sales, Team shows her own commission.
- **Cole Brennan, Warehouse.** Rolls and stock with what is ready to cut, and no cost figures.
- **Grace Liu, Accountant.** Expenses to approve, the Business report, and HR Home with the pay run.
- **Bri Alvarez, Employee.** **My portal**: **Clock in**, **My timesheet**, **Request time off**, **My pay** and **My documents**. HR decides whether commission shows here.

## 5. HR Suite (7 minutes)

Switch to the HR tab. The HR host has its own sign-in, menus and branding. Sign in: **Harbor Staffing Co.**, **Elena Brooks, Owner**.

1. **HR dashboard.** **Needs action** first: timesheets, time off and anything else waiting. Then headcount, contractors (1099), hours and overtime this week, upcoming holidays and time off.
2. **People.** Pay rates are visible to the Owner and HR manager only. Each person has an onboarding checklist and documents.
3. **Timesheets.** The **Weekly grid** follows each worker's state: California workers earn daily overtime after 8 hours, and those cells are highlighted. **To approve** takes one or many at once; **Send back** needs a reason. **Upload hours** takes the template, with a dry run first.
4. **Time off.** **Requests**, **Balances** and **Team calendar**. **Approve** a pending request: the hours post to the balance and the decision lands in the audit log.
5. **Pay periods.** Open a period for gross pay by person and workweek, on the regular rate. **Approve pay period**, then **Export for payroll**, with **Summary CSV** and **Workweek CSV**. **Contractor payments** are separate.
6. **My portal.** The same portal every employee has.
7. **Meetings.** Payroll close and recruiter standups repeat on the calendar; drag one to move it.
8. **Data import.** Settings, Data import offers **Employees** and **Timesheets** here: a second import updates people by email instead of adding them twice.
9. **View as Employee.** Only their own timesheets and time off remain.

## Optional extras (about 5 minutes)

- **Platform admin.** Sign out and choose **Platform admin (you)**. Companies lists plans, modules and user limits. Open Summit Floor Co.: **Access** (modules, ceiling, limits, effective access preview), **Data import** (the same wizard, for onboarding a new customer's data) and **Connect a database**. Untick **View sensitive margins** in the ceiling and save; signed in as Dana, gross margin is gone even for the Owner. Reset demo data afterwards.
- **Notifications.** Settings, Notifications: each event's channels and wording, with a preview. The bell in the top bar shows what reached you.
- **Seat limit.** Settings, Users shows the seats used of the plan. Invite users until the plan is full: the next invite is refused. Disabling the last active Owner is refused too.
- **Loading and error states.** In the presenter guide, set **Network** to Slow and open any screen to show skeletons; set it to Offline to show the error with **Try again**. Set it back to **Normal** (a reload also resets it).
- **Phone.** Narrow the window to phone width: the sidebar becomes a menu, tables scroll sideways inside their panels, and nothing scrolls the page sideways.

## If something goes wrong

- A screen shows "This page could not load its data": check that the guide's Network is **Normal**, then press **Try again**.
- Data looks changed from an earlier run: account menu, **Reset demo data**.
- Lost in View as: the banner at the top has **Stop viewing as**.
- An import cannot be undone because its records were used since (a quote for an imported customer): that is the rule; Reset demo data to start over.
