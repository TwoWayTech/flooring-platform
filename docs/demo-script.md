# Demo script

A 35-minute click path through both products, persona by persona. It follows the steps in the presenter guide (the presentation icon in the top bar), so you can keep the guide open and click each step as you go. Timings are a guide; the optional parts at the end add about 5 minutes.

Everything is dummy data. Companies, people and product brands are invented.

## Before you start (2 minutes, before the audience joins)

- Open the Flooring Suite: `https://flooring-demo-twowaytech.vercel.app` (locally `http://localhost:3000/login`). Open the HR Suite in a second tab: `https://hr-demo-twowaytech.vercel.app` (locally `http://localhost:3000/login?product=hr`).
- If anyone has used this browser for the demo before, sign in as any persona, open the account menu (your initials, top right) and choose **Reset demo data**. Every company goes back to its generated data, moved to today's date.
- Pick the theme you want to show with the theme button in the top bar. Light suits projectors; dark suits screens.
- The sign-in code is any 6 digits; the screen hints 123456.
- For the import step, have a small customers CSV ready, or download the template on the spot (step 12).

## 1. Owner of a flooring store (18 minutes)

Sign in: **Summit Floor Co.**, persona **Dana Whitfield, Owner**, code 123456. Then open the presenter guide.

1. **Dashboard.** Pick a period (This month, Last 30 days, This quarter, Year to date or Custom). Each figure card shows its change against the period before and a small trend; receivables, payments waiting for verification and best sellers follow the same period. Point at **Needs attention**: overdue invoices, payments to verify, a stock adjustment to approve, jobs signed off this week.
2. **Quote a job.** **New quote**. Pick a customer, or type a new name to add one with a suggested address. **Add room** (12 × 12 ft), **Add product** (search "Shoreline Plank") and **Add labor or service** (search "Hard surface installation"). Quantities come from the rooms; waste is included but stays internal, off the customer's PDF. Change **State** to New Jersey: labor becomes taxed. Change it back. **Save as draft** (Draft), then **Send / mark pending** with a valid-until date (Pending), then **Mark accepted** and **Convert to invoice**.
3. **Deposit with proof.** On the new invoice the **Stock** panel shows what is reserved for it. **Update status**, **Record deposit**: the amount is the quote's deposit; attach a receipt (PDF or photo, checked by its real type). Payments over $1,000 wait for a second person (Pending verification) before the balance drops. **Download PDF** matches the screen.
4. **Cut a roll.** Inventory, **Rolls and remnants**, open a roll: On hand, Reserved and Available. **Cut roll** always has a source: an invoice, a new invoice or an adjustment with a reason. Back on an invoice with its deposit in, **Cut** in the Stock panel takes the reserved length; a leftover under 12 ft becomes a remnant.
5. **Installation.** On the invoice, **Schedule installation** (crew, day, start), open the job, **Start job**, then **Record sign-off**: the balance held until installation is due now, and the timeline shows Installed. Job **J-4041** was installed from an accepted quote with no invoice yet: **Create invoice from this job**.
6. **Receivables.** Sales, **Customers and receivables**: Current, Overdue and Due in the next 7 days, with **Overdue only**. Open a customer for their statement. The five-bucket aging is in Reports, **Receivables aging**.
7. **Purchasing.** Purchasing, **New purchase order**: order flooring by area and the cartons are calculated; **Save as draft**, then **Place order**. **Receive** part of it (some damaged), **Enter bill** with the supplier's file (differences from the order are flagged), then under **Bills and payables**, **Pay** with proof. The supplier's terms set the due date.
8. **Stock adjustments.** Inventory, **Adjustments**: a found pallet of 60 cartons waits because it is above the approval quantity. **Approve** it and on hand follows; every stock change points to its document.
9. **Sales team.** Sales, **Team**: sales, paid revenue, margin, quotes sent and commission earned, paid and pending per salesperson for the period. Commission rules (per role or person, on paid revenue or margin, with tiers) are in Settings, **Commissions**.
10. **Reports.** Profit and loss, **Sales tax by jurisdiction**, **Payments received**, **Receivables aging** and **Payables aging**. **Export CSV** and **Export PDF** are real files.
11. **Meetings.** Drag **Weekly sales huddle** an hour later: a repeating meeting asks **This event**, **This and following events** or **All events**; choose This event, then **Undo** in the message. Drag a meeting's bottom edge to change its length. **Month** and **Agenda** views; the meeting's drawer has a Reschedule form for keyboard users.
12. **Data import.** Settings, **Data import**, **Customers**: download the **CSV template** or **Excel template**, then upload a file. Columns match by header name (and are remembered); **Check the file** shows the dry run ("Creates 2, updates 0, skips 0; 1 row has errors") with the bad cells underlined. **Import**, download the error report, then **Undo** the import from Import history. **Connect a database** shows how a live connection would be planned; its test uses a sample database and stores nothing.

## 2. The same screens, seen as Sales (2 minutes)

13. **View as Sales.** In the sidebar, **View as**, then **Sales** (or Ctrl K and type "View as Sales"). A banner says what is hidden. Inventory has no cost column, the dashboard no margin, and Sales sees payments but cannot record them by default. The presenter guide greys out steps Sales cannot open. Choose **Stop viewing as** in the banner.

## 3. Settings and controls (6 minutes)

14. **Security roles.** Settings, Security roles. The Owner role is locked. Open **Sales**, untick **View products** and **View rolls**, save (the code is 123456), then View as Sales: Inventory is gone from the menu and its pages say you don't have access. Then open **Manager**, tick **View security roles** and **Manage security roles**, save; the change asks for the authenticator code (123456). Sign in as **Luis Ortega, Manager** and open the **Sales** role: permissions Luis does not hold himself are greyed out with "You can only grant permissions you hold". Sign back in as Dana.
15. **Number format.** Settings, Number format. Set money to 0 decimals and save. Invoices now show whole dollars; hover a total to see the exact cents. Set it back to 2.
16. **Branding.** Settings, Branding. Change the brand color (try `#7A3E9D`) and save: buttons, links, the floor pattern and charts change at once, and text stays readable in both themes.
17. **Audit log.** Settings, Audit log. Every change from this demo is here, with who, when, before and after, including imports and their Undo.

## 4. Other people in the store (3 minutes)

Sign out (account menu), then sign in as each persona.

- **Priya Natarajan, Sales.** Her own customers, quotes and sales, without margin; Sales, Team shows her own commission.
- **Cole Brennan, Warehouse.** Adjust stock with a reason; above 50 cartons it waits for an Owner or Manager.
- **Marcus Bell, Installer.** Installation shows only his crew's jobs, with no margin.

## 5. HR Suite (5 minutes)

Switch to the HR tab. The HR host has its own sign-in, menus and branding. Sign in: **Harbor Staffing Co.**, **Elena Brooks, Owner**.

1. **HR dashboard.** Headcount, contractors (1099), hours and overtime this week, upcoming time off.
2. **Employees.** Pay rates are visible to the Owner and HR manager only.
3. **Timesheets.** Each worker follows their state's overtime rule: California workers earn daily overtime after 8 hours, and those cells are highlighted.
4. **Time off.** **Approve** a pending request; it lands in the audit log.
5. **Meetings.** Payroll close and recruiter standups repeat on the calendar; drag one to move it.
6. **Data import.** Settings, Data import offers only **Employees** here: a second import updates people by email instead of adding them twice.
7. **View as Employee.** Only their own timesheets and time off remain.

## Optional extras (about 5 minutes)

- **Platform admin.** Sign out and choose **Platform admin (you)**. Companies lists plans, modules and user limits. Open Summit Floor Co.: **Access** (modules, ceiling, limits, effective access preview), **Data import** (the same wizard, for onboarding a new customer's data) and **Connect a database**. Untick **View sensitive margins** in the ceiling and save; signed in as Dana, gross margin is gone even for the Owner. Reset demo data afterwards.
- **Seat limit.** Settings, Users shows the seats used of the plan. Invite users until the plan is full: the next invite is refused. Disabling the last active Owner is refused too.
- **Loading and error states.** In the presenter guide, set **Network** to Slow and open any screen to show skeletons; set it to Offline to show the error with **Try again**. Set it back to **Normal** (a reload also resets it).
- **Phone.** Narrow the window to phone width: the sidebar becomes a menu, tables scroll sideways inside their panels, and nothing scrolls the page sideways.

## If something goes wrong

- A screen shows "This page could not load its data": check that the guide's Network is **Normal**, then press **Try again**.
- Data looks changed from an earlier run: account menu, **Reset demo data**.
- Lost in View as: the banner at the top has **Stop viewing as**.
- An import cannot be undone because its records were used since (a quote for an imported customer): that is the rule; Reset demo data to start over.
