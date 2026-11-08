# Feature register

One row per feature of the demo. Each key is a switch in `packages/shared/src/features.ts`: setting its `enabled` to `false` hides the feature's screens, menu items, tabs, buttons, command-palette actions, presenter-guide steps and attention checks in both products. A unit test (`packages/shared/test/features.test.ts`) fails if this table and the code disagree on a key, product, module, status or screens, or if a permission key, data collection or test file named here does not exist.

To add, change or remove a feature, use `/feature-change` (`.claude/commands/feature-change.md`).

## Columns

- **Key**: the switch name in code and in ADRs. Never reuse a removed key.
- **Product**: `flooring`, `hr`, or `both` for platform features every product has (Settings, sign-in, the app shell, Meetings).
- **Module**: the module a company must have switched on (Platform, Core, Retail, Wholesale, Installation, HR, Meetings), as in the permission catalog.
- **Status**: `demo` shown in the demo; `build` confirmed for the real product; `later` deferred; `removed` dropped (always switched off).
- **Screens**: routes the feature owns. `/path` is the page with any view, `/path?view=x` one view of it, `/path/*` every page below it. Shell features own no route; their place in the app is described instead.
- **Permission keys**: what a role needs to use the feature (`packages/shared/src/permissions/catalog.ts`).
- **Data**: the collections the feature reads and writes through the ApiClient.
- **Tests**: Playwright specs in `apps/web/tests/e2e` and unit tests in `packages/shared/test`.

## Register

| Key | Product | Module | Status | Screens | Permission keys | Data | Tests | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dashboard.store` | flooring | core | demo | `/` | `dashboard.overview.view`, `sales.margin.view_sensitive` | `invoices`, `expenses`, `products`, `rolls`, `jobs` | `dashboard.spec.ts`, `sellers.test.ts` | Key figures, revenue and margin chart, needs attention, today's jobs, best and slow sellers. Sales sees own sales without margin. Off: people land on their first other page. |
| `inventory.products` | flooring | core | demo | `/inventory?view=products` | `inventory.product.view`, `inventory.product.view_sensitive` | `products`, `rolls` | `inventory.spec.ts` | Catalog with price, cost (sensitive) and stock. The default Inventory tab. |
| `inventory.rolls` | flooring | core | demo | `/inventory?view=rolls`, `/inventory/rolls/*` | `inventory.roll.view`, `inventory.roll.cut`, `inventory.roll.edit` | `rolls`, `products`, `invoices` | `inventory.spec.ts`, `rolls.test.ts` | Roll list and filters, cut roll (a leftover under 12 ft becomes a remnant), move, print label, low-roll attention check. |
| `sales.quotes` | flooring | core | demo | `/sales?view=quotes`, `/sales/quotes/*` | `sales.quote.view`, `sales.quote.create`, `sales.quote.edit`, `retail.room.measure` | `quotes`, `customers`, `products`, `settings` | `quote.spec.ts`, `quotes.test.ts` | Quote list and quote builder: room canvas (Retail), product and labor lines, tax by job-site state, deposit. |
| `sales.invoices` | flooring | core | demo | `/sales?view=invoices`, `/sales/invoices/*` | `sales.invoice.view`, `sales.invoice.create`, `sales.invoice.export`, `sales.payment.view` | `invoices`, `payments`, `quotes` | `quote.spec.ts`, `number-format.spec.ts`, `tax-documents-overtime.test.ts` | Invoice list and status filter, invoice view, print and PDF, overdue attention check. Off also hides Convert to invoice. |
| `sales.customers` | flooring | core | demo | `/sales?view=customers` | `customers.customer.view`, `customers.customer.view_sensitive` | `customers`, `invoices`, `payments` | `customers.spec.ts`, `sellers.test.ts` | Receivables aging, customer drawer and statement with CSV, credit limit (sensitive), expiring-certificate attention check. |
| `purchasing.orders` | flooring | core | demo | `/purchasing` | `purchasing.supplier.view`, `purchasing.order.view`, `purchasing.order.create`, `purchasing.order.receive`, `purchasing.bill.view`, `purchasing.bill.create`, `purchasing.bill.pay` | `suppliers`, `purchaseOrders`, `bills`, `billPayments`, `products`, `rolls` | `purchasing.spec.ts`, `purchasing.test.ts` | Suppliers, order, receive into stock (carpet arrives as rolls), enter bill, pay, payables aging. |
| `installation.calendar` | flooring | installation | demo | `/installation` | `installation.job.view`, `installation.job.sign_off`, `installation.job.view_sensitive`, `installation.crew.view` | `jobs`, `crews`, `customers`, `invoices` | `installation.spec.ts`, `sellers.test.ts` | Week by crew and subcontractor, job card with materials, labor, margin (sensitive), photos and sign-off. Off also hides today's jobs on the dashboard. |
| `reports.hub` | flooring | core | demo | `/reports` | `reports.financial.view`, `reports.financial.export`, `reports.sales.view`, `reports.sales.export`, `reports.tax.view`, `reports.tax.export`, `reports.inventory.view`, `reports.inventory.export` | `invoices`, `expenses`, `products`, `rolls` | `reports.spec.ts`, `reports.test.ts` | Profit and loss, sales by category, sales tax by jurisdiction, inventory valuation; CSV and PDF export. |
| `hr.dashboard` | hr | hr | demo | `/`, `/hr` | `hr.overview.view` | `employees`, `timesheets`, `ptoRequests` | `hr.spec.ts` | Home of the HR host; the Overview tab of the Flooring Suite's HR section. |
| `hr.employees` | hr | hr | demo | `/hr/employees` | `hr.employee.view`, `hr.employee.view_sensitive` | `employees` | `hr.spec.ts` | Worker type (W-2 or 1099), pay rate (sensitive), work state, PTO balance. |
| `hr.timesheets` | hr | hr | demo | `/hr/timesheets` | `hr.timesheet.view`, `hr.timesheet.approve` | `timesheets`, `employees` | `hr.spec.ts`, `tax-documents-overtime.test.ts` | Weekly hours, federal and California overtime, approval, overtime attention check. |
| `hr.time-off` | hr | hr | demo | `/hr/time-off` | `hr.pto.view`, `hr.pto.request`, `hr.pto.approve` | `ptoRequests`, `employees` | `hr.spec.ts` | Requests, approve or deny, balance, time-off attention check. |
| `meetings.calendar` | both | meetings | demo | `/meetings` | `meetings.meeting.view`, `meetings.meeting.create` | `meetings`, `users`, `customers`, `suppliers` | `meetings.spec.ts`, `meetings.test.ts` | Week calendar, recurring series, attendees (staff, customers, suppliers), reminders, new meeting. |
| `settings.users` | both | platform | demo | `/settings/users` | `settings.users.view`, `settings.users.manage` | `users`, `roles` | `users.spec.ts` | Invite, seat limit, change roles, disable, reset MFA, last Owner rule. |
| `settings.roles` | both | platform | demo | `/settings/roles` | `settings.roles.view`, `settings.roles.manage` | `roles`, `users` | `roles.spec.ts`, `permissions.test.ts`, `role-matrix.test.ts` | Permission grid by module, data scope, copy and delete; no escalation; Owner locked. |
| `settings.branding` | both | platform | demo | `/settings/branding` | `settings.branding.manage` | `settings` | `branding.spec.ts` | Display name, monogram, brand color with contrast check, floor pattern, logo, default theme. |
| `settings.localization` | both | platform | demo | `/settings/localization` | `settings.localization.manage`, `settings.tax.manage` | `settings` | `localization.spec.ts`, `tax-documents-overtime.test.ts` | Region, currency, sales tax rules per state, payroll rules, document settings. |
| `settings.number-format` | both | platform | demo | `/settings/number-format` | `settings.numbers.manage` | `settings` | `number-format.spec.ts`, `numbers-units-money.test.ts` | Decimals per number kind, negative style, compact dashboard figures. Display only. |
| `settings.company` | both | platform | demo | `/settings/company` | `settings.company.manage` | `settings` | `audit.spec.ts` | Legal name, EIN, contact details and address printed on documents. |
| `settings.audit` | both | platform | demo | `/settings/audit` | `settings.audit.view` | `audit` | `audit.spec.ts` | Every change with who, when, before and after. |
| `admin.access` | both | platform | demo | `/admin`, `/admin/*` | none: platform admin session | `companies` | `admin.spec.ts` | Companies, modules and limits, permission ceiling, effective access preview. Off also hides the Platform admin card on sign-in. |
| `auth.mfa` | both | platform | demo | Sign-in, step 3 | none | `users` | `login.spec.ts` | Simulated authenticator code (any six digits). Off: choosing a persona signs in at once. |
| `auth.step-up` | both | platform | demo | Code dialog before saving roles, currency, tax and MFA resets | none | none | `roles.spec.ts`, `users.spec.ts` | Off: those saves happen without the code check. |
| `shell.company-switcher` | both | platform | demo | Sidebar header, command palette | none | `companies` | `shell.spec.ts` | Switch to another company on the same product as the same role. Off: the sidebar shows the company without a menu. |
| `shell.view-as` | both | platform | demo | Sidebar, command palette, banner | `settings.roles.manage` | `roles` | `shell.spec.ts`, `customers.spec.ts` | See the app with another role's permissions. Owners and people who manage roles. |
| `shell.command-palette` | both | platform | demo | Top bar search, Ctrl K | none | none | `customers.spec.ts` | Go to any allowed page and run allowed actions. |
| `shell.notifications` | both | platform | demo | Top bar bell | none | `invoices`, `rolls`, `customers`, `jobs`, `ptoRequests`, `timesheets` | `dashboard.spec.ts` | The needs-attention items as a list. |
| `shell.presenter-guide` | both | platform | demo | Top bar, command palette, floating panel | none | none | `presenter-guide.spec.ts` | Demo steps per product with talking points. |
| `shell.network-simulation` | both | platform | demo | Presenter guide footer | none | none | `states.spec.ts` | Normal, slow and offline network, to show loading and error states. |
| `demo.reset` | both | platform | demo | Account menu, command palette | none | none | none | Restores every company's generated data, moved to today. |
