# Demo script

A 25-minute click path through both products, persona by persona. It follows the steps in the presenter guide (the presentation icon in the top bar), so you can keep the guide open and click each step as you go. Timings are a guide; the optional parts at the end add about 5 minutes.

Everything is dummy data. Companies, people and product brands are invented.

## Before you start (2 minutes, before the audience joins)

- Open the Flooring Suite: `https://flooring-demo.vercel.app` (locally `http://localhost:3000/login`). Open the HR Suite in a second tab: `https://hr-demo.vercel.app` (locally `http://localhost:3000/login?product=hr`).
- If anyone has used this browser for the demo before, sign in as any persona, open the account menu (your initials, top right) and choose **Reset demo data**. Every company goes back to its generated data, moved to today's date.
- Pick the theme you want to show with the theme button in the top bar. Light suits projectors; dark suits screens.
- The sign-in code is any 6 digits; the screen shows the hint 123456.

## 1. Owner of a flooring store (11 minutes)

Sign in: **Summit Floor Co.**, persona **Dana Whitfield, Owner**, code 123456. Then open the presenter guide.

1. **Dashboard.** Revenue and gross margin for 12 months, receivables and open quotes, all computed from invoices and expenses, never typed in. Point at **Needs attention** (overdue invoices, rolls running low, expiring tax certificates, today's jobs) and **Today's jobs** by crew. Hover a figure to see its full value.
2. **Cut a roll.** Needs attention, then **rolls under 20 ft**, or Inventory, then Rolls and remnants. Open a roll, choose **Cut roll**, cut 12 ft for an invoice. The remaining length drops at once; a cut that leaves less than 12 ft becomes a remnant on the remnant rack.
3. **Quote a job.** **New quote**. Pick a customer, **Add room** (12 × 12 ft; drag on the floor plan to draw another, drag a corner to resize). **Add product** (search "Shoreline Plank") and **Add labor or service** (search "Hard surface installation"). Quantities come from the rooms, with waste. Change **State** to New Jersey: installation labor becomes taxed and the total changes. Change it back to Colorado.
4. **Invoice and PDF.** **Convert to invoice**. The invoice shows the same lines and tax. **Download PDF**: the file matches the screen.
5. **Receivables.** Sales, then **Customers and receivables**. The aging bar splits what is owed into current, 30, 60 and 90+ days. Open a customer for their statement and credit limit.
6. **Purchasing.** Purchasing, **Purchase orders**. Open an order with the status Ordered and choose **Receive into stock** (stock goes up; carpet arrives as new rolls). Then type the supplier's bill number and choose **Enter bill**. Under **Bills and payables**, the payables aging updates.
7. **Installation.** The week by crew and subcontractor. Open a job card: materials, labor, margin, photos and sign-off.
8. **Reports.** Profit and loss with date and branch filters; **Sales tax by jurisdiction** reads the rule each invoice stored. **Export CSV** and **Export PDF** are real files.
9. **Meetings.** The week's meetings with staff, customers and suppliers; recurring ones repeat on the calendar. **New meeting** with a supplier, repeating every week, with a reminder.

## 2. The same screens, seen as Sales (2 minutes)

10. **View as Sales.** In the sidebar, **View as**, then **Sales** (or Ctrl K and type "View as Sales"). A banner says what is hidden. Open Inventory: the cost column is gone. Open the dashboard: no margin. The presenter guide greys out steps Sales cannot open. Choose **Stop viewing as** in the banner.

## 3. Settings and controls (5 minutes)

11. **Security roles.** Settings, Security roles. The Owner role is locked. Open **Manager**, tick **View security roles** and **Manage security roles**, save; the change asks for the authenticator code (123456). Then sign out, sign in as **Luis Ortega, Manager**, and open the **Sales** role: permissions Luis does not hold himself, such as Manage branding, are greyed out with "You can only grant permissions you hold". Nobody grants more than they hold. Sign back in as Dana.
12. **Number format.** Settings, Number format. Set money to 0 decimals and save. Invoices now show whole dollars; hover a total to see the exact cents. Totals are stored and computed at full precision, so nothing changes but the display. Set it back to 2.
13. **Branding.** Settings, Branding. Change the brand color (try `#7A3E9D`) and save: buttons, links, the floor pattern and charts change at once, and text stays readable in both themes. A color too light to read is refused.
14. **Audit log.** Settings, Audit log. Every change from this demo is here, with who, when, before and after.

## 4. Other people in the store (3 minutes)

Sign out (account menu), then sign in as each persona.

- **Priya Natarajan, Sales.** The dashboard shows her own sales without margin; reports show sales by category without cost.
- **Marcus Bell, Installer.** Installation shows only his crew's jobs, with no margin.

## 5. HR Suite (5 minutes)

Switch to the HR tab. The HR host has its own sign-in, menus and branding. Sign in: **Harbor Staffing Co.**, **Elena Brooks, Owner**.

1. **HR dashboard.** Headcount, contractors (1099), hours and overtime this week, upcoming time off.
2. **Employees.** Pay rates are visible to the Owner and HR manager only.
3. **Timesheets.** Each worker follows their state's overtime rule: California workers earn daily overtime after 8 hours, and those cells are highlighted.
4. **Time off.** **Approve** a pending request; it lands in the audit log.
5. **Meetings.** Payroll close and recruiter standups repeat on the calendar.
6. **View as Employee.** Only their own timesheets and time off remain.

## Optional extras (about 5 minutes)

- **Platform admin.** Sign out and choose **Platform admin (you)**. Companies lists plans, modules and user limits. Open Summit Floor Co., untick **View sensitive margins** in the permission ceiling and watch the effective access preview, then save. Sign in as Dana: gross margin is gone from the dashboard, even for the Owner. Reset demo data afterwards.
- **Seat limit.** Settings, Users shows 13 of 15 seats. Invite users until the plan is full: the next invite is refused. Disabling the last active Owner is refused too.
- **Loading and error states.** In the presenter guide, set **Network** to Slow and open any screen to show skeletons; set it to Offline and open another to show the error with **Try again**; a save made offline says why it failed and keeps the form open. Set it back to **Normal** (a reload also resets it).
- **Phone.** Narrow the window to phone width: the sidebar becomes a menu, tables scroll sideways inside their panels, and nothing scrolls the page sideways.

## If something goes wrong

- A screen shows "This page could not load its data": check that the guide's Network is **Normal**, then press **Try again**.
- Data looks changed from an earlier run: account menu, **Reset demo data**.
- Lost in View as: the banner at the top has **Stop viewing as**.
