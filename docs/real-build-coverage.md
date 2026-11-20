# Real-build coverage

What the real product (api mode, the NestJS API and PostgreSQL) does today, item by item, against docs/product-spec/, docs/FEATURES.md and docs/demo-script.md. Written by the whole-product check (ADR 0058, session log docs/sessions/2026-11-16-1241-b-whole-product-check.md) on 2026-11-20, on main plus the stack up to PR #68, after the api-mode browser runs (default suite 68 passed; FC, DS 6 and PGM 9 passed).

- **Done:** the item runs on the API end to end, through its screens in api mode, with API tests and, where it has a screen, api-mode e2e.
- **Partly:** it runs on the API, but part of it still reads or writes DemoStore, has no api-mode e2e, or a new company can't reach it yet. What is missing is named.
- **Missing:** nothing on the API yet.
- **Not on the API by design:** a removed feature, or a demo tool that has no meaning in the real product.

The generated list `docs/coverage.md` holds the per-page and per-route facts this page summarises: it is produced from code and can't drift, while this page is a reading of it. "New company" is what a company made by the setup script (`pnpm db:provision-tenant`) can do through the API: `apps/api/test/new-company.int.test.ts` (FA, a bare company) and `apps/api/test/fresh-setup.int.test.ts` (FS, a company set up through the API with sample CSV data).

## Summary

| | Done | Partly | Missing | Not on the API by design |
| --- | --- | --- | --- | --- |
| Features in docs/FEATURES.md (72) | 39 | 21 | 1 | 11 |
| Demo-script steps (19, 4 personas, 9 HR Suite steps, 5 extras: 37) | 22 | 12 | 0 | 3 |

The real product's biggest gaps are not in single features but across them:

| Gap | What it means | Where it shows |
| --- | --- | --- |
| **G1** web workspace | In api mode the web opens only the demo companies (`toCompanySession` accepts summit, keystone, harbor). A new company's Owner can sign in and enrol MFA, then sees "Your account is ready, but not this workspace." | FC-1 (`tests/e2e-api/check/fresh-company.spec.ts`) |
| **G2** settings at provisioning | A new company has no settings rows. No Localization tab can be saved on its own (409 `settings_missing`, by design: nothing is invented, ADR 0059 D7), so no customer by hand and no quote. The other nine sections and the bank accounts save. | FA-4, FA-12, FS-3 |
| **G3** branches and products | No route adds a branch, so no location can be added (`POST /locations` needs one); products come only through the import. | FA-5, FS-4 |
| **G4** Owner invitation | Provisioning writes no invitation and sends nothing; the Owner can't sign in. | FA-0, FS-2 |
| **G5** mixed pages | 22 pages still read some lists from DemoStore next to API data (the dashboard 17 lists). On Summit the fixtures match the seed, so it is invisible; on any other company those parts show the demo's data. | `docs/coverage.md`, "Mixed pages" |
| **G6** HR Suite in api mode | The api-mode e2e database has no HR Suite company, so the HR host's screens are never walked in api mode. | owner question Q5 |
| **G7** creating a company | No API or console route makes a company; only the setup script does. | F-f |

With G2, G3 and G4 stood in for once each (one Localization row, one branch row, one invitation row), FS shows the rest of the journey works on the API alone: every settings tab and section saves, two locations are added, four invented CSV files import, and an imported tile is ordered, received, billed, quoted, invoiced, paid and issued with the books agreeing with the documents to the cent.

## By feature

### Sales (`docs/product-spec/sales.md`)

| Feature | Verdict | On the API | Missing, or why partly | Evidence |
| --- | --- | --- | --- | --- |
| `sales.quotes` | Partly | Quotes, rooms, status, convert to invoice (4 routes) | A new company can't quote (G2, G3); the API takes part cartons on a boxed line (F-m) | F1, `sales.spec.ts`, FS-6 |
| `sales.quote-availability` | Done | Reads stock through `inventoryData` | No test names the feature; covered by the quote screens' reads | `docs/coverage.md` |
| `sales.invoices` | Done | Invoices, credit notes, void, write-off, sent, apply credit, the commission split (9 routes) | The page also holds the removed installation scheduling's DemoStore calls, which never run; F-t closed (the split saves under the API's ids) | F1, F5, `invoices.spec.ts`, DS-4 |
| `sales.payments` | Done | Payments, proof files, review, void, refunds (10 routes) | Settings → Payments' Reset to default reads DemoStore | `payments` integration, 20 api-mode specs |
| `sales.customers` | Partly | Customers and addresses (3 routes) | Customer pickers on the dashboard, Sales, Inventory and roll pages read DemoStore's list (G5); a new company can't add one by hand until Localization exists (F-n, G2) | FA-4, FS-3 |
| `sales.team` | Partly | `teamCommission` | `/sales` is mixed (roles list from DemoStore) | `sales.spec.ts` |
| `installation.calendar` | Not by design | — | Removed (ADR 0026); its calls on the invoice and Installation pages never run | FEATURES.md |

### Inventory (`docs/product-spec/inventory.md`)

| Feature | Verdict | On the API | Missing, or why partly | Evidence |
| --- | --- | --- | --- | --- |
| `units.square-feet` | Partly | Area stored and sent in sq ft; screens round boxed lines to whole cartons | The API itself accepts part cartons (F-m); `reorderPoint` and widths go out as JSON numbers (F-k) | MI-1 (whole cartons), MI-DEC |
| `inventory.products` | Partly | Products listed with sensitive cost stripped | No route creates or edits a product; only the import (G3); `/inventory` is mixed | FA-5, FS-5, PM-7 |
| `inventory.rolls` | Partly | Rolls, cuts, moves, roll invoices | `/inventory/rolls/*` reads customers from DemoStore (G5) | F1, `inventory.spec.ts` |
| `inventory.transfers` | Done | Create and receive (3 routes) | — | `inventory.spec.ts`, integration |
| `inventory.adjustments` | Not by design | — | Removed; stock corrections replace it | FEATURES.md |
| `inventory.reservations` | Done | Holds and issue (3 routes) | — | F1, MI-1, FS-6 |
| `inventory.stock-correction` | Partly | `POST /stock/corrections` | No api-mode e2e | MI-1 (E9 exact) |
| `inventory.ready-to-cut` | Done | Reads holds on the API | — | F1, `inventory.spec.ts` |
| `inventory.locations` | Partly | `POST` and `PUT /locations`, Stock rules (`PUT /settings/inventory`) | No branch route (G3); a person's default location has no write route; `GET /locations` reads no switch (STATUS) | FA-5, FS-4, `settings-locations.spec.ts` |

### Purchasing and finance (`purchasing.md`, `finance-expenses.md`)

| Feature | Verdict | On the API | Missing, or why partly | Evidence |
| --- | --- | --- | --- | --- |
| `purchasing.suppliers` | Done | Suppliers and contacts (8 routes) | `POST /suppliers/:id/status` and `PUT /supplier-contacts/:id` have no integration test (F-q) | F2, FA-3 |
| `purchasing.orders` | Done | Orders, receipts, bills, supplier payments (12 routes) | — | F2, MI-1, FS-6 |
| `finance.payments-queue` | Done | Reads payments and supplier payments | — | `expenses.spec.ts` |
| `finance.expenses` | Done | Expenses, recurring, approval, void, files (10 routes) | Settings → Expenses' Reset to default reads DemoStore | F7, MI-1, FA-6 |

### Contracts (`contracts.md`)

| Feature | Verdict | On the API | Missing, or why partly | Evidence |
| --- | --- | --- | --- | --- |
| `contracts.register` | Done | 23 routes: draft, send, sign, change orders, close, renew | — | F5, DS-8, MI-4 |
| `contracts.billing` | Done | Billings, retainage release, void (7 routes) | A lower cumulative billing is refused, so the negative posting path is reachable only in shared tests | MI-4 |
| `contracts.compliance` | Partly | Insurance, lien waivers (4 routes) | No api-mode e2e beyond DS-8's look at the tabs | DS-8 |

### HR and the portal (`hr.md`, `employee-portal.md`, `commissions.md`)

| Feature | Verdict | On the API | Missing, or why partly | Evidence |
| --- | --- | --- | --- | --- |
| `hr.dashboard` | Done | `/hr` on the API | The Flooring dashboard's HR part is mixed (G5) | DS-12 |
| `hr.employees` | Partly | 6 routes | No api-mode e2e; never walked on the HR host in api mode (G6) | FA-12, integration |
| `hr.timesheets` | Done | 10 routes | HR Suite host not walked (G6) | F3 |
| `hr.time-off` | Done | 8 routes | HR Suite host not walked (G6) | F4 |
| `hr.pay-periods` | Done | 14 routes, gross pay, approve, reopen, export | "Payroll paid" posting is an accountant question (Q3) | F3, MI-5 |
| `hr.payroll.california` | Partly | Shared daily-overtime rules | No route or e2e names it | unit tests |
| `hr.portal` | Done | My portal (6 routes) | — | DS-P4, `portal.spec.ts` |
| `hr.clock` | Partly | Clock in and out (3 routes) | No api-mode e2e | integration |
| `hr.commissions` | Done | 10 routes | MI-6 not built (commissions file covers its postings) | DS-12, `commissions` integration |
| `settings.hr` | Done | `PUT /settings/hr` (part 5) | Reset to default reads DemoStore | FS-3, `settings-hr.spec.ts` |

### Meetings and notifications (`meetings.md`, `notifications.md`)

| Feature | Verdict | On the API | Missing, or why partly | Evidence |
| --- | --- | --- | --- | --- |
| `meetings.calendar` | Done | 13 routes | — | F6, FA-7 |
| `meetings.invites` | Partly | 6 routes, the iCalendar file | Simulate reply stays on DemoStore | F6 |
| `meetings.requests` | Partly | 2 routes | No api-mode e2e | integration |
| `settings.meetings` | Missing | — | No route; the page is hidden in api mode, and the New meeting form reads its defaults from DemoStore | `docs/coverage.md` |
| `settings.notifications` | Partly | Settings → Email (`PUT /settings/email`) | Notification rules (channels and wording) stay on DemoStore | `notifications.spec.ts` |
| `settings.outbox` | Partly | Outbox list, retry, cancel | Simulate reply and Simulate bounce stay on DemoStore; retry and cancel need only a view key (F-j); a missing message answers a bare 404 (F-i) | `notifications.spec.ts`, DS-11 |
| `shell.notifications` | Done | The bell: list and mark read | — | `notifications.spec.ts` |

### Reports (`reports.md`)

| Feature | Verdict | On the API | Missing, or why partly | Evidence |
| --- | --- | --- | --- | --- |
| `reports.hub` | Done | Options, the trial balance screen | — | `reports.spec.ts`, `trial-balance.spec.ts` |
| `reports.business` | Done | `GET /reports/business` and its export | — | R-checks in MI-2, DS-10 |
| `reports.pnl` | Done | P&L | Expenses leave out purchase tax and write-offs, unlike the ledger (F-a, Q3) | MI-2 R3 |
| `reports.sales-category` | Partly | Sales by category | No api-mode e2e | integration |
| `reports.payments` | Done | Payments report | — | `reports.spec.ts` |
| `reports.tax-jurisdiction`, `reports.inventory-valuation`, `reports.receivables-aging`, `reports.payables-aging` | Not by design | — | Removed (ADR 0055) | FEATURES.md |

### Settings, users and platform (`settings-and-permissions.md`, `import.md`, specs/)

| Feature | Verdict | On the API | Missing, or why partly | Evidence |
| --- | --- | --- | --- | --- |
| `settings.users` | Done | Users, invite, support access | Reads no switch (F-h) | FA-0, `users.spec.ts` |
| `settings.roles` | Partly | Roles (5 routes) | No api-mode e2e; reads no switch (F-h) | FA-2 |
| `settings.audit` | Done | Audit log | Reads no switch (F-h) | FA-10, DS-19 |
| `settings.branding` | Done | `PUT /settings/branding` (part 6) | Reset to default reads DemoStore | `settings-branding.spec.ts` |
| `settings.localization` | Partly | All five tabs (parts 2a, 2b, 3a, 3b) | A company with no Localization row can't save any tab (G2) | FS-3, `settings-localization.spec.ts`, `settings-tax.spec.ts` |
| `settings.number-format` | Done | `PUT /settings/numbers` | — | FS-3, `settings.spec.ts` |
| `settings.company` | Done | `PUT /settings/profile` | — | FS-3, `settings.spec.ts` |
| `settings.import` | Done | 5 routes, dry run, step-up, Undo | Opening balances and stock are later parts (ADR 0057) | FA-9, FS-5, `import.spec.ts` |
| `settings.database` | Not by design | — | Connect a database is simulated in both modes (ADR 0057) | FEATURES.md |
| `settings.billing` | Done | `GET /billing` | — | FA-1 |
| `admin.access` | Done | The platform console's companies, access, status, support | No route creates a company (G7) | platform specs |
| `admin.billing` | Done | Plans | Manual billing only | `platform-billing.spec.ts` |
| `auth.mfa` | Done | Authenticator, passkeys, the QR code (ADR 0060) | — | `passkeys.spec.ts`, `login.spec.ts` |
| `auth.step-up` | Done | `POST /auth/step-up` on every sensitive write | — | FA-0, FS-3 |

### Shell (no spec of its own)

| Feature | Verdict | On the API | Missing, or why partly | Evidence |
| --- | --- | --- | --- | --- |
| `dashboard.store` | Partly | 14 reads on the API | 17 lists still from DemoStore (G5) | PGM-1, DS-1 |
| `shell.company-switcher` | Partly | Companies from `/auth/context` | The switcher and palette list companies from DemoStore (G1) | `docs/coverage.md` |
| `shell.view-as` | Not by design | — | Demo only since PR #50: in api mode it isn't offered, because the API answers only for the signed-in person | DS-15 |
| `shell.command-palette` | Done | Client-side over API data | Its company list as for the switcher | — |
| `shell.tables`, `shell.addresses` | Done | Client-side | — | — |
| `shell.presenter-guide`, `shell.network-simulation`, `demo.reset` | Not by design | — | Demo tools | — |

## By demo-script step

"Summit" is api-mode e2e on the seeded Summit company; "New company" is FA or FS.

| Step | Verdict | Summit (api mode) | New company | Gap |
| --- | --- | --- | --- | --- |
| 1 Dashboard | Partly | DS-1, PGM (loads for every persona, Sales included) | — | G5 (17 DemoStore lists) |
| 2 Quote a job | Done on Summit | F1, `sales.spec.ts` | FS-6 after stand-ins | G2, G3, F-m |
| 3 Deposit with proof | Done | F1 | FS-6 | — |
| 4 Corrections | Done | DS-4 (commission split and credit note) | — | — |
| 5 Cut a roll | Done | F1 | — | — |
| 6 Receivables | Partly | `sales.spec.ts` | — | G5 (customer pickers) |
| 7 Purchasing | Done | F2 | FA-3, FS-6 | — |
| 8 Contracts | Done | F5, DS-8 | MI-4 | — |
| 9 Expenses | Done | F7, DS-9 | FA-6 | — |
| 10 Business report | Done | DS-10, `reports.spec.ts` | FA-8 | F-a (by design) |
| 11 Meetings | Partly | F6, `meetings.spec.ts`, DS-GB (the Outbox on the API) | FA-7 | Simulate reply on DemoStore |
| 12 HR inside Flooring | Done | F3, F4, DS-12 | MI-5 | — |
| 13 Sales team | Partly | `sales.spec.ts` | — | `/sales` mixed |
| 14 Data import | Done | `import.spec.ts` | FA-9, FS-5 (four invented CSV files) | — |
| 15 View as Sales | Not by design | DS-15: not offered in api mode | — | demo tool (PR #50) |
| 16 Security roles | Partly | DS-16 | FA-2 | no api-mode e2e of the roles page |
| 17 Number format | Done | `settings.spec.ts` | FS-3 | — |
| 18 Branding | Done | `settings-branding.spec.ts` | FS-3 | — |
| 19 Audit log | Done | DS-19 | FA-10 | — |
| Priya, Sales | Done | DS-P1 (no sensitive field reaches her) | — | — |
| Cole, Warehouse | Done | DS-P2 | — | — |
| Grace, Accountant | Done | DS-P3 | — | — |
| Bri, Employee | Done | DS-P4 | — | — |
| HR Suite 1 to 9 | Partly | not walked in api mode | FA-12 (an employee; the pay period waits for Settings → HR) | G6 |
| Extra: platform admin | Done | `platform-*.spec.ts` | — | G7 |
| Extra: notifications | Partly | `notifications.spec.ts` | — | rules on DemoStore |
| Extra: seat limit | Done | `users.spec.ts` | — | — |
| Extra: loading and error states | Not by design | — | — | demo tool |
| Extra: phone | Not by design | client layout | — | — |

The HR Suite row counts as nine steps in the summary: steps 1 to 5 and 9 are Partly (on the API, not walked in api mode), 6 to 8 are covered through the Flooring host's portal, meetings and import (Done).

## Not in any feature, from the specs

- **Opening balances** (import parts 3 and 4, ADR 0057): imported and seeded records post no journal entries, so a new company's ledger starts at zero whatever it imports. Missing.
- **The company's day on the client** (`today()` in the company's zone): in flight on its own branch when this was written.
- **Real company deletion** (P17): a deleted company must also stamp `tenant_databases.deleted_at`, or `pnpm db:migrate` stops (F-c, Q8).
- **Dates as UTC minutes with no zone** (F-r): the audit log and several records send `YYYY-MM-DDTHH:mm` in UTC, and screens read it as local time.
