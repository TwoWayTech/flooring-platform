# Data model

Written from the demo code, 2026-11-10.

This file lists every entity the demo's `DemoStore` holds, how the entities relate, and which PostgreSQL table in the blueprint each one maps to. It also lists what the demo changed. Field-level detail and business rules are in `docs/product-spec/<module>.md`.

## How to read this

- **Entity** is the TypeScript type, with the collection name in brackets. Types are in `packages/shared/src/types/`. The list of collections is `CompanyFixtures` in `packages/shared/src/types/fixtures.ts`.
- **Database** is Control (one shared database) or Company (one database per company), as the blueprint divides them.
- **Blueprint table** names the table in the blueprint's table lists. "New in this demo" means the blueprint has no such table. The blueprint names tables and some columns only. It does not define most columns, so a mapping means "this record belongs in that table", not "the columns match".
- **Key fields** are identifiers, status fields and the fields other rules depend on. Money and quantities are decimal strings.
- **Relationships** use `field -> Entity`. The demo enforces none of them as foreign keys. They hold only because the store actions write them correctly.

## How the demo stores data

There is no database. `DemoStore` (`apps/web/src/lib/api/demo/store.ts`) implements `ApiClient` (`apps/web/src/lib/api/contract.ts`), and `CompanyDb` (`apps/web/src/lib/api/demo/company-db.ts`) holds one company's data.

| Layer | Where | What it holds |
| --- | --- | --- |
| Company fixtures | `packages/shared/fixtures/summit.json`, `keystone.json`, `harbor.json`, loaded by `apps/web/src/lib/api/demo/fixtures.ts` | The 53 collections and the settings of one company, generated from a fixed seed |
| Platform fixtures | `packages/shared/fixtures/platform.json` | The `companies` list |
| Company overlay | localStorage key `fp-demo:v2:<companyId>` (`storage.ts`) | `schemaVersion` (4, `OVERLAY_SCHEMA_VERSION` in `packages/shared/src/migrations/overlay.ts`), `shift`, `settings`, and `records`: a map of collection to id to record |
| Platform overlay | localStorage key `fp-demo:v2:platform` | Companies changed by the platform admin |
| File bytes | IndexedDB database `fp-demo-files`, store `files` (`file-store.ts`) | Uploaded files by id. Records keep only `FileMeta` |

Behaviour that matters when replacing this with a real database:

- `CompanyDb.list` merges fixtures with the overlay. A record in the overlay replaces the fixture record with the same id. A `null` in the overlay is a tombstone that hides a fixture record.
- Fixture dates are moved to today when loaded (`dateShift`, `shiftDates`). Overlay dates are moved from the day they were saved.
- An overlay from an older schema is dropped with a notice, and its files are removed (`upgradeOverlay`, `overlayFileIds`).
- Reset demo clears both localStorage prefixes.

These collections are empty in all three seeded companies, so they only fill during a demo session: `invoiceAdjustments`, `refunds`, `clockEntries`, `meetingResponses`, `commissionAdjustments`, `importBatches`, `importMappings`, `notificationRules`, `inAppNotifications`. Harbor Staffing is an HR-only company, so its flooring collections are also empty. `crews` and `jobs` hold data for Summit only.

## Control database

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Company (`companies`, in `platform.json`) | Control | `tenants`; `tenant_products` for `product`; `tenant_module_overrides` and `plan_modules` for `modules`; `plans`, `plan_limits` and `tenant_subscriptions` for `plan`, `userLimit`, `branchLimit`; `tenant_permission_ceiling` for `ceiling` | `id` (`summit`, `keystone`, `harbor`), `name`, `city`, `state`, `product`, `modules`, `plan`, `status` (`active`, `trial`, `past_due`, `suspended`; the blueprint also has `cancelled`), `userLimit`, `branchLimit`, `ceiling`, `branches`, `createdAt` | Owns one fixtures file, which is one company database. `branches` is embedded here in the demo but belongs in the company database (see Branch) |
| User, identity part (`users`) | Control | `user`, `account`, `session`, `verification`, `two_factor`, `passkey`, `member`, `invitation` | `id`, `companyId`, `name`, `email`, `status` (`invited`, `active`, `disabled`), `mfaEnrolled`, `lastLoginAt` | One user has one company in the demo. The blueprint keeps one user record per person across companies and products |
| Company membership (`User.roleIds`, identity part) | Control | Better Auth `member` | `organizationId` (= `tenants.id`), `userId`, `role` | `role` holds the person's company role keys, comma-separated and sorted (`encodeMemberRoles` in packages/shared), not Better Auth's `owner`/`member`. Sign-in reads it to decide on mandatory MFA before any company database is open (ADR 0029, part 2). The seed sets it only on insert and never overwrites it. Settings → Users keeps it in sync with `user_roles` (P10) |
| Auth attempt (no demo entity) | Control | `auth_attempts` (new, not in the blueprint list) | `kind` (`password_attempt`, written before the password is checked and counted as a failure until a later `password_ok`; `password_ok`; `verification_email`, which also counts reset and invitation emails; `step_up_ok`, subject the session id; `step_up_failed`, subject the user id; `invitation_attempt`, subject the IP), `subject` (email trimmed and lowercased, or the id or IP named), `ip`, `created_at` | Append-only log read by the password lockout, the per-address email limit, step-up (ADR 0034) and the invitation limit. Holds personal data (email, IP, session id). Kept 30 days, then deleted (see Retention) |
| Invitation (`User.status` `invited` in the demo) | Control | `user_invitations` (new, ADR 0034) | `tenant_id`, `user_id`, `token_hash` (SHA-256 of the emailed token; the token is never stored), `expires_at` (7 days), `accepted_at`, `revoked_at` | One open invitation per person and company (partial unique index); a new invitation revokes the open one. Closed invitations are deleted 30 days after they were accepted, revoked or expired (see Retention) |
| Rate-limit bucket (no demo entity) | Control | Better Auth `rate_limit` (library-owned) | `key` (IP and path), `count`, `last_request` | Better Auth's per-IP limiter with database storage, so the limits hold across API instances. Kept 30 days, then deleted (see Retention) |
| Branding (`CompanySettings.branding`) | Control | `tenant_branding` | `displayName`, `monogram`, `brandColor`, `pattern`, `logoDataUrl`, `defaultTheme` | Stored with the company settings in the demo. The blueprint needs it in the control database so the login page can show it before sign-in |

The demo has no platform admin record. The platform admin is a session, not a row (`admin.access` in `packages/shared/src/features.ts`).

### Retention of sign-in security data
Owner decision, 2026-11-13 (ADR 0029, part 2):
- `auth_attempts` rows are deleted 30 days after `created_at`.
- `user_invitations` rows are deleted 30 days after they were accepted, revoked or expired; open ones stay until then (ADR 0034).
- `rate_limit` rows are deleted 30 days after `last_request`. That column is in epoch milliseconds, and the table has no `created_at`, because Better Auth owns it.
- Lockout and MFA events written to `audit_log` follow the audit log's own retention, not the 30 days.
- The delete is the daily `auth.cleanup` pg-boss job (03:17 UTC, ADR 0032).

## Company database

### Organization and access

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Branch (`Company.branches`) | Company | `branches` | `id`, `name`, `city`, `state` | Referenced by `User.branchId`, `Location.branchId`, `Quote.branchId`, `Invoice.branchId`, `Contract.branchId`. Branch drives data scope |
| Location (`locations`) | Company | `locations` | `id`, `name`, `kind` (`warehouse`, `showroom`), `branchId`, `address`, `isDefault`, `displaySamples`, `floorAreaSqFt` | `branchId -> Branch`. Referenced by stock, documents, expenses, `User.defaultLocationId` and `Employee.homeLocationId` |
| Role (`roles`) | Company | `roles`, `role_permissions` | `id`, `companyId`, `key`, `name`, `permissions`, `dataScope` (`own`, `branch`, `all`), `system`, `owner` | Linked to users through `User.roleIds` |
| User, profile part (`users`) | Company | `user_profiles`, `user_roles` | `title`, `roleIds`, `branchId`, `employeeId`, `defaultLocationId` | `roleIds -> Role`, `branchId -> Branch`, `employeeId -> Employee`, `defaultLocationId -> Location`. A user id is the target of `salesRepId`, `recordedById`, `buyerId`, `ownerUserId` and similar fields |

`user_profiles.employee_id` links a sign-in to the person's employee record: one live sign-in per employee, enforced by the partial unique index `user_profiles_employee_uidx` (where `employee_id` is not null and `deleted_at` is null; company migration 0004, owner decision 2026-11-14, ADR 0049). A user has one profile per company (`user_profiles_user_uidx`), so the link is one-to-one.

The blueprint lists `user_profiles` twice with different columns: once with "branch, status, employee link" and once with "branch, data scope, status". The demo keeps data scope on the role and uses the widest of a user's roles (`dataScope` in `packages/shared/src/permissions/`).

### Catalog and inventory

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Product (`products`) | Company | `products`; `categories` and `brands` are a fixed list and a text field here | `id`, `sku`, `name`, `brand`, `collection`, `category`, `unit`, `price`, `cost`, `sqFtPerCarton`, `reorderPoint`, `widthFt`, `attributes` | `supplierId -> Supplier`. Seeded from `Product.supplierId`; a database seeded before purchasing is filled in where `supplier_id` is empty (ADR 0036) |
| Roll (`rolls`) | Company | `rolls`; `roll_cuts` for the embedded `cuts` | `id`, `rollNumber`, `dyeLot`, `widthFt`, `originalLengthFt`, `remainingLengthFt`, `costPerSqFt`, `bin`, `isRemnant`, `receivedAt`, `cuts` | `productId -> Product`, `locationId -> Location`, `transferId -> Transfer` (while travelling), `parentRollId -> Roll` (a remnant's source) |
| StockMovement (`stockMovements`) | Company | `stock_movements` | `id`, `at`, `quantity` (signed), `kind` (`opening`, `receipt`, `issue`, `transfer_out`, `transfer_in`, `adjustment`, `return`), `source` | `productId -> Product`, `locationId -> Location`, `byUserId -> User`. `source.kind` and `source.id` point at a count, receipt, invoice, transfer, adjustment or credit note |
| Transfer (`transfers`) | Company | `transfers`, `transfer_lines` (new in this demo; served by the API since ADR 0035) | `id`, `number`, `status` (`in_transit`, `received`), `lines`, `createdAt`, `receivedAt`, `note` | `fromId`, `toId -> Location`; `createdBy`, `receivedBy -> User`; each line `productId -> Product`, `rollId -> Roll` |
| Reservation (`reservations`) | Company | `reservations` | `id`, `quantity`, `shortBy`, `status` (`active`, `released`, `issued`), `createdAt`, `closedAt`, `overrideReason` | `invoiceId -> Invoice`, `lineId -> DocLine`, `productId -> Product`, `rollId -> Roll`, `locationId -> Location` |
| StockAdjustment (`stockAdjustments`) | Company | New in this demo. `stock_counts` is the nearest table | `id`, `number`, `quantity` (signed), `reason` (`damage`, `count`, `samples`, `other`), `status` (`pending`, `approved`, `rejected`), `requestedAt`, `reviewedAt`, `rejectReason` | `productId -> Product`, `rollId -> Roll`, `locationId -> Location`, `requestedById -> User` |

### Customers and sales

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Customer (`customers`) | Company | `customers`; `addresses` for `addresses`; `exemption_certificates` for `certificate` | `id`, `contactName`, `email`, `phone`, `salesRepId`, `type` (`homeowner`, `dealer`, `contractor`), `name`, `terms`, `creditLimit`, `taxExempt`, `certificate`, `defaultBillingId`, `defaultJobSiteId`, `lifecycle` (`customer`, `lead`), `externalId` | `salesRepId -> User`; `defaultBillingId`, `defaultJobSiteId -> CustomerAddress` |
| CustomerContact (`customerContacts`) | Company | `contacts` | `id`, `name`, `email`, `phone` | `customerId -> Customer`. Can be a meeting guest (`Attendee` kind `customer-contact`) |
| Quote (`quotes`) | Company | `quotes`, `quote_lines`; `measurements`, `measurement_rooms` for `rooms` | `id`, `number`, `status` (`draft`, `pending`, `accepted`, `converted`, `declined`), `createdAt`, `sentAt`, `expiresAt`, `jobSite`, `rooms`, `lines`, `depositPct`, `lumpSum`, `taxOverride`, `total`, `notes` | `customerId -> Customer`, `salesRepId -> User`, `branchId -> Branch`, `locationId -> Location` (ships from), `soldAtLocationId -> Location` (optional, falls back to `locationId`), `Invoice.quoteId -> Quote` (no column on quotes; the API derives `invoiceId`) |
| Invoice (`invoices`) | Company | `invoices`, `invoice_lines`, `invoice_commission_splits` (for `commissionSplit`); a credit note is a row here and not in `credit_notes`. Contract billing invoices are seeded with the contracts module (ADR 0038) | `id`, `number`, `issuedAt`, `dueAt`, `sentAt`, `voidedAt`, `voidReason`, `depositPct`, `isReturn`, `refundedAt`, `jobSite`, `lines`, `taxRule`, `taxSource`, `taxOverride`, `taxExempt`, `subtotal`, `tax`, `total`, `cost`, `retainageWithheld`, `retainageReleased`, `commissionSplit` | `quoteId -> Quote`, `customerId -> Customer`, `salesRepId`, `createdBy`, `sentBy -> User`, `branchId -> Branch`, `locationId -> Location`, `soldAtLocationId -> Location` (optional, falls back to `locationId`), `creditForInvoiceId -> Invoice`, `contractId -> Contract`, `billingId -> ContractBilling`, `commissionSplit[].userId -> User` |
| Payment (`payments`) | Company | `payments_received`; `deposits` for `kind: deposit`; proof `files` are `attachments` rows (`owner_type` `payment`, `purpose` `proof`) | `id`, `number`, `kind` (`payment`, `deposit`), `amount`, `date`, `method`, `checkNumber`, `cardLast4`, `reference`, `files`, `status` (`pending`, `confirmed`, `rejected`, `voided`), `recordedAt`, `reviewedAt`, `voidedAt` | `invoiceId -> Invoice` (exactly one), `customerId -> Customer`, `recordedById -> User`. Referenced by `LienWaiver.paymentId` |
| InvoiceAdjustment (`invoiceAdjustments`) | Company | New in this demo | `id`, `kind` (`write_off`, `credit_applied`), `amount`, `reason`, `byName`, `at` | `invoiceId -> Invoice`, `customerId -> Customer` |
| Refund (`refunds`) | Company | New in this demo | `id`, `number`, `amount`, `date`, `method`, `reference`, `files`, `status` (`completed`, `voided`), `byName`, `at` | `customerId -> Customer` |

### Suppliers and purchasing

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Supplier (`suppliers`) | Company | `suppliers` | `id`, `name`, `type` (`goods`, `services`, `utility`, `government`), `status` (`active`, `inactive`), `accountNumber`, `terms`, `creditLimit`, `categories`, `track1099`, `taxForm`, `externalId` | Parent of `SupplierContact`, `PurchaseOrder`, `GoodsReceipt`, `Bill`, `SupplierPayment`; referenced by `Product`, `Expense`, `RecurringExpense`, `Contract`, `InsuranceCertificate` |
| SupplierContact (`supplierContacts`) | Company | `contacts` | `id`, `name`, `role`, `mobile`, `officePhone`, `email`, `whatsapp`, `preferredMethod`, `isPrimary`, `status` | `supplierId -> Supplier`. Referenced by `PurchaseOrder.contactId` |
| PurchaseOrder (`purchaseOrders`) | Company | `purchase_orders`, `po_lines` | `id`, `number`, `status` (`draft`, `ordered`, `cancelled`; the rest is derived), `createdAt`, `expectedAt`, `orderedAt`, `cancelledAt`, `lines`, `total`, `contactSnapshot`, `supplierRef`, `placedVia` (`email`, `phone`) | `supplierId -> Supplier`, `locationId -> Location`, `contactId -> SupplierContact`, `buyerId -> User`; each line `productId -> Product`, `locationId -> Location` (optional) |
| GoodsReceipt (`receipts`) | Company | `goods_receipts`, `receipt_lines` | `id`, `number`, `receivedAt`, `note`, `lines` (`received`, `damaged`, `rolls`) | `poId -> PurchaseOrder`, `supplierId -> Supplier`, `locationId -> Location`, `receivedById -> User`; each line `poLineId -> PoLine`, `productId -> Product`, `locationId -> Location` (optional) |
| Bill (`bills`) | Company | `supplier_bills`; `bill_lines` is not used | `id`, `number` (the supplier's), `issuedAt`, `dueAt`, `total`, `matchIssues`, `files`, `kind` (`progress`, `retainage_release`), `gross`, `retainageWithheld`, `retainageReleased` | `supplierId -> Supplier`, `poId -> PurchaseOrder` (null on a contract bill or a pay-later expense bill), `receiptIds -> GoodsReceipt`, `contractId -> Contract`, `billingId -> ContractBilling`. A pay-later expense links through `Expense.billId`; a bill has no field pointing back |
| SupplierPayment (`supplierPayments`) | Company | `payments_made`, `payment_allocations` | `id`, `number`, `date`, `method`, `reference`, `files`, `allocations`, `amount`, `status` (`pending`, `confirmed`, `rejected`, `voided`), `recordedAt`, `reviewedAt`, `voidedAt` | `supplierId -> Supplier`, `allocations[].billId -> Bill`, `recordedById -> User`. Referenced by `LienWaiver.supplierPaymentId` |

### Expenses

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Expense (`expenses`) | Company | New in this demo. The blueprint has only a posting rule for "Expense entered" | `id`, `number`, `date`, `category`, `amount`, `tax`, `paymentMethod`, `reference`, `files`, `status` (`draft`, `pending`, `confirmed`, `rejected`, `voided`), `settlement` (`paid`, `on_account`), `dueAt`, `period`, `recordedAt`, `reviewedAt`, `voidedAt` | `supplierId -> Supplier`, `locationId -> Location` (null means company-wide), `billId -> Bill` (pay later), `recurringId -> RecurringExpense`, `recordedById -> User` |
| RecurringExpense (`recurringExpenses`) | Company | New in this demo | `id`, `category`, `amount`, `tax`, `paymentMethod`, `frequency` (`monthly`, `quarterly`, `yearly`), `dayOfMonth`, `startsOn`, `endsOn`, `active` | `supplierId -> Supplier`, `locationId -> Location` |

### Contracts

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Contract (`contracts`) | Company | New in this demo | `id`, `number`, `direction` (`customer`, `subcontractor`), `kind` (`master`, `project`), `title`, `startsAt`, `endsAt`, `renewal`, `originalValue`, `retainagePct`, `storedRetainagePct`, `bondInLieu`, `taxTreatment`, `status` (`draft`, `sent`, `active`, `completed`, `closed`, `terminated`; expired is derived), `signature`, `files` | `masterId`, `parentContractId`, `renewedFromId -> Contract`; `customerId -> Customer`; `supplierId -> Supplier`; `branchId -> Branch`; `locationId -> Location`; `salesRepId -> User` |
| ContractLine (`contractLines`) | Company | New in this demo | `id`, `code`, `description`, `category`, `billing` (`percent`, `milestone`), `scheduledValue`, `retainagePct`, `storedRetainagePct`, `milestoneDueAt`, `estimatedCost` | `contractId -> Contract`, `changeOrderId -> ChangeOrder` |
| ChangeOrder (`changeOrders`) | Company | `change_orders`, which the blueprint places under Installation and ties to a job. Here it belongs to a contract | `id`, `number`, `status` (`draft`, `pending`, `approved`, `rejected`, `void`), `reason`, `lines`, `submittedAt`, `decidedAt`, `decidedBy`, `files` | `contractId -> Contract`; each line `lineId -> ContractLine` (null for a new line) |
| ContractBilling (`contractBillings`) | Company | New in this demo | `id`, `number`, `kind` (`progress`, `release`), `periodEnd`, `status` (`posted`, `void`; there is no draft), `lines`, `releases`, `gross`, `withheld`, `released`, `postedAt`, `postedBy` | `contractId -> Contract`, `invoiceId -> Invoice`, `billId -> Bill`, `lines[].lineId` and `releases[].lineId -> ContractLine` |
| LienWaiver (`lienWaivers`) | Company | New in this demo | `id`, `direction` (`given`, `received`), `type`, `amount`, `throughDate`, `state`, `statutoryForm`, `signedOn`, `files`, `status` (`requested`, `received`, `superseded`) | `contractId -> Contract`, `paymentId -> Payment`, `supplierPaymentId -> SupplierPayment` |
| InsuranceCertificate (`insuranceCertificates`) | Company | New in this demo | `id`, `producer`, `holder`, `coverages` (each with its own `expiresOn`), `additionalInsured`, `files` | `supplierId -> Supplier`, `contractId -> Contract` |

### Ledger (real build, ADR 0039)

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| LedgerAccount | Company | `ledger_accounts` | `id`, `key` (stable, for postings; null on a company's own accounts), `code`, `name`, `type` (`asset`, `liability`, `equity`, `revenue`, `expense`), `active` | Referenced by `journal_lines.account_id` |
| JournalEntry | Company | `journal_entries` (append-only) | `id`, `date`, `event`, `sourceType`, `sourceId`, `sourceNumber`, `memo`; unique by source and event | `reversesId -> JournalEntry`; parent of `journal_lines` |
| JournalLine | Company | `journal_lines` (append-only) | `id`, `debit`, `credit` (one side above zero); the account must be live, not soft-deleted (migration 0003, ADR 0040) | `entryId -> JournalEntry`, `accountId -> LedgerAccount`, `locationId -> Location`, `customerId -> Customer` |
| PeriodClose | Company | `period_closes` (append-only) | `id`, `closedThrough`, `note`; the newest row decides | |

### Installation (switched off, data kept)

`installation.calendar` has status `removed` in `packages/shared/src/features.ts`. These records are kept in the code and seed data, and no screen shows them.

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Crew (`crews`) | Company | `crews`, `subcontractors` | `id`, `name`, `kind` (`crew`, `subcontractor`), `lead`, `members`, `phone` | `lead` is a name, compared with `User.name` in `apps/web/src/lib/api/demo/scope.ts`. There is no user id link |
| Job (`jobs`) | Company | `jobs`, `job_assignments`, `job_materials`, `job_labor`, `job_photos` | `id`, `number`, `date`, `startHour`, `durationHours`, `status` (`scheduled`, `in_progress`, `completed`, `signed_off`), `address`, `scope`, `materials`, `laborHours`, `laborCost`, `revenue`, `photos`, `signedOffAt`, `signedBy` | `customerId -> Customer`, `invoiceId -> Invoice`, `crewId -> Crew` |

### HR

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Employee (`employees`) | Company | `employees`, `pay_rates` | `id`, `companyId`, `name`, `title`, `department`, `workerType` (`w2`, `1099`), `payType` (`hourly`, `salary`, `per_job`), `payRate`, `state`, `hiredAt`, `status` (`active`, `on_leave`, `terminated`), `flsaStatus`, `exemptionBasis`, `salaryHoursPerWeek`, `commissionVisible`, `externalId`, `documents`, `onboarding`, `offboarding` | `managerId -> Employee`, `homeLocationId -> Location`. A user links here through `User.employeeId` |
| Timesheet (`timesheets`) | Company | `timesheets`; `time_entries` for the seven values in `days` | `id`, `weekStart`, `days`, `status` (`draft`, `submitted`, `approved`, `rejected`), `submittedAt`, `decidedAt`, `rejectionReason`, `source` (`form`, `upload`, `clock`), `history` | `employeeId -> Employee` |
| ClockEntry (`clockEntries`) | Company | New in this demo | `id`, `date`, `inAt`, `outAt` | `employeeId -> Employee`. A day's punches fill the draft timesheet |
| PtoRequest (`ptoRequests`) | Company | `pto_requests` | `id`, `start`, `end`, `hours`, `kind`, `status` (`pending`, `approved`, `denied`, `cancelled`), `decidedAt`, `decisionReason` | `employeeId -> Employee`, `policyId -> TimeOffPolicy` |
| TimeOffPolicy (`timeOffPolicies`) | Company | New in this demo | `id`, `name`, `kind`, `paid`, `accrualMethod`, `accrualRate`, `capHours`, `annualUseLimitHours`, `carryoverHours`, `waitingPeriodDays`, `allowNegative` | Parent of `PtoRequest` and `TimeOffEntry` |
| TimeOffEntry (`timeOffEntries`) | Company | New in this demo. It replaces `pto_balances` | `id`, `date`, `kind` (`accrual`, `used`, `adjustment`, `carryover`, `forfeit`, `payout`), `hours` (signed), `note` | `employeeId -> Employee`, `policyId -> TimeOffPolicy`, `requestId -> PtoRequest`, `payPeriodId -> PayPeriod` |
| PayPeriod (`payPeriods`) | Company | New in this demo. `payroll_exports` is the nearest table; here export is a status | `id`, `frequency`, `start`, `end`, `payDate`, `status` (`open`, `in_review`, `approved`, `exported`), `approvedBy`, `approvedAt`, `exportedAt`, `excluded`, `lines` (empty until approved) | `excluded[].employeeId`, `lines[].employeeId -> Employee`. Referenced by `CommissionStatement.payPeriodId` and `TimeOffEntry.payPeriodId` |
| Bonus (`bonuses`) | Company | New in this demo | `id`, `amount`, `kind` (`production`, `flat_sum`, `discretionary`), `periodStart`, `periodEnd`, `approvedBy`, `reason` | `employeeId -> Employee`. Seed data only: there is no entry screen |
| ContractorPayment (`contractorPayments`) | Company | New in this demo | `id`, `date`, `description`, `amount`, `status` (`approved`, `paid`) | `employeeId -> Employee` (a 1099 worker). Never part of a pay period |
| ManagerHistoryRow (real build only, no demo collection) | Company | New in the real build: `employee_manager_history` (append-only; company migration 0005) | `id`, `managerId` (null means no manager), `effectiveFrom` (a day; null means since records began) | `employeeId -> Employee`, `managerId -> Employee` (foreign keys). Indexes on `(employee_id, effective_from)` and, since company migration 0006, on `manager_id` |

`employee_manager_history` is each employee's manager over time, so a commission override goes to the rep's manager on the line's confirmed day, not today's (owner decision 2026-11-15; ADR 0048). Setting or changing a manager on People adds a row dated the company's day of the change (never back-dated); rows are never changed or hidden (append-only by convention, with no trigger, unlike `audit_log`). The row in force on a day is the one with the latest `effective_from` on or before it, a null `effective_from` first, and on a tie the later recorded row; a day before an employee's first row reads that first row; an employee with no row reads `employees.manager_id` (`managerOn` in `packages/shared/src/hr/manager-history.ts`). A null `effective_from` is written only by the backfill and the seed, when a person is added with a manager, or just before a person's first dated row, for the manager they had until then. A dated row's `created_by` is who set that manager, which the self-made manager guard reads; for a since-records-began row the guard reads the last manager change in the audit log before the person's first dated row instead (ADR 0048 "Self-made manager, judged on each line's day"). Migration 0005 backfills one such row per live employee with their manager at the time, and the seed writes the same, so no override worked out before the table changes. Migration 0006 indexes `manager_id`, which the sign-in re-link guard filters on to find everyone an employee has managed (`managesOverridePeople` in apps/api `people.service.ts`). `employees.manager_id` stays the current manager.

### Commissions

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| CommissionPlan (`commissionPlans`) | Company | New in this demo. It replaces `commission_rules` | `id`, `name`, `version`, `status` (`draft`, `active`, `retired`), `effectiveFrom`, `effectiveTo`, `basis` (`paid_revenue`, `gross_margin`), `baseRatePct`, `monthlyTarget`, `tierMode` (`marginal`, `retroactive`), `tiers`, `overridePct`, `draw`, `clawbackDays` | Parent of `CommissionAssignment` |
| CommissionAssignment (`commissionAssignments`) | Company | New in this demo | `id`, `effectiveFrom`, `effectiveTo`, `monthlyTargetOverride`, `acknowledgement` | `userId -> User`, `planId -> CommissionPlan` |
| CommissionStatement (`commissionStatements`) | Company | New in this demo | `id`, `month`, `status` (`draft`, `approved`, `paid`), `approvedBy`, `approvedAt`; in the real build also `employee_id` (stored at approval) | `userId -> User`, `payPeriodId -> PayPeriod`, `employee_id -> Employee` (real build, foreign key, indexed since company migration 0006). Figures are derived |
| CommissionAdjustment (`commissionAdjustments`) | Company | New in this demo | `id`, `month`, `amount`, `reason`, `byName`, `at`, `decides` | `userId -> User`, `invoiceId -> Invoice` (required when negative). `decides.lineId` points at a derived commission line |

The blueprint's `commissions` table has no stored equivalent. Commission lines are computed by `commissionLines` in `packages/shared/src/hr/commission-plans.ts`.

`commission_statements.employee_id` (uuid, nullable; company migration 0005) is the employee the statement pays: the rep's linked live employee (`user_profiles.employee_id`) when the statement is approved, stored then so a later change of sign-in link never moves the pay (owner decision 2026-11-15; ADR 0048 "The employee a statement pays"). It is null on a draft and on a statement approved while its rep had no live link. Migration 0005 fills it on every approved or paid statement from the rep's live link at the time, the employee pay runs paid before the column, and the seed does the same. A statement with none is paid to, and judged stranded on, the rep's link today (`paidEmployee` in apps/api `commission-records.ts`). Migration 0006 indexes the column, which a pay run filters on to find the approved statements that pay its employees (`commissionForRun`). The demo's `CommissionStatement` type has no such field.

### Meetings

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| Meeting (`meetings`) | Company | `meetings`; `meeting_attendees` for `attendees`. The blueprint's `reminders` table is not built: a reminder is a scheduled `outbox_messages` row (ADR 0032, 0051) | `id`, `title`, `start`, `durationMin`, `location`, `recurrence` (`none`, `weekly`, `biweekly`, `monthly`), `reminderMin`, `timeZone`, `until`, `exceptions`, `uid`, `sequence`, `rescheduleSequence`, `status` (`tentative`, `confirmed`, `cancelled`), `kind` (`meeting`, `request`), `private`, `hideGuestList`, `allowProposals` | `ownerUserId -> User`. `attendees[].id` points at a `User`, `Customer`, `Supplier`, `CustomerContact` or `SupplierContact` depending on `attendees[].kind`; for `external` it is not a link |
| MeetingResponse (`meetingResponses`) | Company | New in this demo; `meeting_responses` in the real build | `id`, `method` (`reply`, `counter`), `partStat`, `proposedStart`, `note`, `sequence`, `at`, `stale` | `meetingId -> Meeting`, `attendeeId -> Attendee.id`; in the real build `meeting_responses.attendee_id -> meeting_attendees.id` (the guest's row, not the wire id) |

Real build (ADR 0051):
- **Times:** `meetings.start`, `meeting_attendees.responded_at` and `meeting_responses.proposed_start` are instants (timestamptz), read and written through `meetings.time_zone`. The API and the shared rules keep the demo's local `YYYY-MM-DDTHH:mm`, and `exceptions` and a proposal's `start` stay local, inside jsonb.
- **Guests:** a guest is a `meeting_attendees` row with `party_type` (the attendee kind) and `party_id`:
  - for staff, `party_id` is the control-database user id;
  - for a customer, supplier or contact, it is that record's id;
  - for an email guest it is null.

  On the wire, `Attendee.id` is `party_id`, or the row's own id for an email guest.
- **Removed guests:** a removed guest's row is soft-deleted.
- **Changes:** `meetings.updated_at` is set from the database clock whenever the row is written, and becomes the invite's DTSTAMP.
- **Moves (part 2):** a "this and following" move inserts a `meetings` row for the new series and copies the live `meeting_attendees` rows with their answers (an email guest gets a new row id; `meeting_responses` rows are not copied). An undo soft-deletes that row and its guests. `exceptions` holds at most 100 entries per series. Undo reads the meeting's last `audit_log` entry by `(target_type, target_id)`. No table changes.

### Notifications and email

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| NotificationRule (`notificationRules`) | Company | New in this demo | `id` (the event key, so one rule per event), `enabled`, `channels`, `subject`, `body`, `updatedAt`, `updatedBy` | With no row, the catalogue's defaults apply (`packages/shared/src/notifications/events.ts`) |
| OutboxMessage (`outboxMessages`) | Company | New in this demo | `id`, `eventKey`, `recipient`, `fromName`, `replyTo`, `subject`, `bodyText`, `values`, `attachments`, `status` (`scheduled`, `queued`, `sent`, `failed`, `cancelled`), `failureType`, `createdAt`, `scheduledFor`, `sentAt`, `restricted`, `dedupeKey` | `actorUserId -> User`. `sourceType` with `sourceId` and `recipient.kind` with `recipient.id` are polymorphic links |
| InAppNotification (`inAppNotifications`) | Company | `notifications` | `id`, `eventKey`, `title`, `href`, `createdAt`, `readAt` | `userId -> User` |

### System

| Entity | Database | Blueprint table | Key fields | Relationships |
| --- | --- | --- | --- | --- |
| AuditEntry (`audit`) | Company | `audit_log`. Changes made by the platform admin belong in the control database's `platform_audit_log` | `id`, `at`, `actorName`, `actorRole`, `category` (`role`, `user`, `ceiling`, `settings`, `data`, `security`, `payment`), `action`, `target`, `before`, `after` | None. In the demo the actor is a name, not a user id, and `updateCompanyAccess` in `store.ts` writes ceiling changes into the company's own list. In the real build the actor is `actor_user_id` (a control-database user id) with the role names in `actor_role`, and `audit_log` is append-only: company migration 0001 adds a trigger that refuses UPDATE, DELETE and TRUNCATE from any normal statement (ADR 0031) |
| ImportBatch (`importBatches`) | Company | `import_jobs` | `id`, `number`, `kind`, `fileName`, `at`, `byName`, `mapping`, `counts`, `changes`, `undoneAt`, `undoneBy` | `changes[]` holds a collection, a record id, and the before and after versions, which Undo restores |
| ImportMapping (`importMappings`) | Company | New in this demo | `id`, `kind`, `columns`, `savedAt`, `savedBy` | One saved column mapping for an import kind |
| CompanySettings (`settings`, one per company) | Company, except `branding` | See "Settings groups" below | See below | Read by every module |

## Objects stored inside a parent record

| Object | Parent | Blueprint table | Notes |
| --- | --- | --- | --- |
| `DocLine` | `Quote.lines`, `Invoice.lines` | `quote_lines`, `invoice_lines` | `productId`, `category`, `unit`, `quantity`, `unitPrice`, `unitCost`, `wastePct`, `roomIds`, `rollId`, `sqFtPerCarton`, `locationId`. `Reservation.lineId` points at its `id` |
| `Room` | `Quote.rooms` | `measurement_rooms` | Rectangle in ft. Referenced by `DocLine.roomIds` |
| `CustomerAddress` | `Customer.addresses` | `addresses` | `label` is `home`, `billing`, `job_site` or `delivery` |
| `Certificate` | `Customer.certificate` | `exemption_certificates` | One per customer in the demo |
| `TaxOverride` | `Quote.taxOverride`, `Invoice.taxOverride` | New in this demo | `ratePct`, `reason`, `byName`, `at` |
| `RollCut` | `Roll.cuts` | `roll_cuts` | `source` points at an invoice or adjustment |
| `TransferLine` | `Transfer.lines` | New in this demo | `rollId` is set when a whole roll moves |
| `PoLine` | `PurchaseOrder.lines` | `po_lines` | Referenced by `ReceiptLine.poLineId` |
| `ReceiptLine` | `GoodsReceipt.lines` | `receipt_lines` | Embedded `rolls` create `Roll` records |
| `FileMeta` | Many records, as `files` or `documents` | `attachments` | `id`, `name`, `type`, `size`, `uploadedBy`, `uploadedAt`. Bytes are in the file store |
| `SupplierTaxForm` | `Supplier.taxForm` | New in this demo | No tax ID is stored (plan K-9) |
| `SignatureRecord` | `Contract.signature` | New in this demo | Simulated. Holds document version, hash, signer, consent version and events |
| `BillingLine` | `ContractBilling.lines` | New in this demo | Cumulative figures with rates snapshotted |
| `InsuranceCoverage` | `InsuranceCertificate.coverages` | New in this demo | Each coverage has its own expiry |
| `ChecklistItem` | `Employee.onboarding`, `Employee.offboarding` | New in this demo | |
| `TimesheetEvent` | `Timesheet.history` | New in this demo | |
| `PayPeriodLine`, `PayWeek` | `PayPeriod.lines` | New in this demo | Frozen when the period is approved. Computed live before that |
| `Attendee` | `Meeting.attendees` | `meeting_attendees` | `kind` (`party_type`), `role`, `partStat`, response fields, `proposal`. The row's own id is the wire `Attendee.id` only for an email guest (ADR 0051) |
| `MeetingProposal` | `Attendee.proposal` | New in this demo | |
| `MeetingException` | `Meeting.exceptions` | New in this demo | One occurrence moved, resized or cancelled |
| `OutboxRecipient`, `OutboxAttachment` | `OutboxMessage` | New in this demo | An `.ics` keeps its text inline |
| `ImportChange` | `ImportBatch.changes` | Part of `import_jobs` | |

## Settings groups

`CompanySettings` is one object per company (`packages/shared/src/types/settings.ts`).

| Group | Database | Blueprint table |
| --- | --- | --- |
| `branding` | Control | `tenant_branding` |
| `localization.region` | Company | `locale_settings` |
| `localization.currency` | Company | `currencies_enabled`, `exchange_rates` |
| `localization.tax.rules` | Company | `tax_rules` |
| `localization.tax.jurisdictions` | Company | `tax_jurisdictions` |
| `localization.tax.companyDefault`, `filing`, `certificateTypes` | Company | New in this demo. The blueprint names no table for them |
| `localization.payroll` | Company | `overtime_rules`, `holiday_calendars` |
| `localization.documents` | Company | `document_defaults` |
| `numbers` | Company | `number_format` |
| `profile` | Company | `settings`. Legal name also sits on `tenants` in the blueprint |
| `payments`, `inventory`, `expenses` | Company | `settings`. The approval thresholds are what `approval_rules` would hold |
| `accounting` | Company | `settings`. Real-build group (ADR 0040): `costingMethod`, `salesTaxBasis`, `bankAccounts` (name and methods only; each one is a `ledger_accounts` row keyed `bank:<uuid>`, code 1010 to 1099) |
| `sharedCosts`, `hr`, `meetings`, `email` | Company | `settings`. New groups in this demo |

Country rules are code, not stored data: `packages/shared/src/us-pack/` maps to the control tables `country_packs`, `pack_states` and `pack_tax_models`.

## Derived figures: nothing stored

| Figure | Function | File |
| --- | --- | --- |
| Invoice paid, balance, status | `invoiceLedger`, `invoiceStatus` | `packages/shared/src/ledger.ts` |
| Customer credit | `customerCredit` | `packages/shared/src/ledger.ts` |
| Receivables | `receivablesSummary`, `customerReceivable` | `packages/shared/src/receivables.ts` |
| Quote expired | `quoteState` | `packages/shared/src/operations/quote-status.ts` |
| Contract expired | `contractDisplayStatus` | `packages/shared/src/contracts/rules.ts` |
| Purchase order status past Ordered | `poState` | `packages/shared/src/operations/purchasing.ts` |
| Bill paid and balance, supplier balance, payables | `billLedger`, `supplierBalance`, `payablesSummary` | `packages/shared/src/operations/purchasing.ts` |
| Boxed on hand | `boxedStock`, `boxedOnHand` | `packages/shared/src/stock.ts` |
| Reserved and available | `availability`, `rollAvailable`, `reservedBoxed` | `packages/shared/src/reservations.ts` |
| Time-off balance | `timeOffBalance` | `packages/shared/src/hr/time-off.ts` |
| Pay period lines before approval | `grossPay` | `packages/shared/src/hr/pay.ts` |
| Commission lines | `commissionLines` | `packages/shared/src/hr/commission-plans.ts` |
| Journal lines | `expenseJournal`, `billPaymentJournal` | `packages/shared/src/journal.ts` |
| Business report | `businessReport` | `packages/shared/src/business-report.ts` |
| Next document number | `nextNumber` (highest existing number plus one) | `packages/shared/src/operations/quotes.ts` |

## Changes this demo introduced

| Area | Change from the blueprint | Where | Source |
| --- | --- | --- | --- |
| Units | Square feet is the one area unit, including prices. Rolls stay in ft. `sqFtPerCarton` is copied onto document and PO lines. Boxed goods sell in whole cartons | `Product`, `DocLine`, `PoLine` | ADR 0027, plan N-2, K-2 |
| Warehouses | Warehouses and showrooms are `locations` with a `kind`. Bins are a text field on `Roll` only, while the blueprint's `locations` covers bins | `Location`, `Roll.bin` | ADR 0006 |
| Stock | Boxed goods use the movement ledger. Rolls do not: a roll's length is stored on the roll, and cuts and roll transfers write no `StockMovement` (`movementsFor` in `operations/transfers.ts` skips roll lines). The blueprint says every stock change is a row in `stock_movements` | `Roll`, `StockMovement` | ADR 0006 |
| Stock | `stock_levels` is not used. Levels are derived | `stock.ts` | ADR 0006 |
| Stock | Reservations and transfers are new. Adjustments are kept in the ledger but the screen is off. Corrections are Owner only | `Reservation`, `Transfer`, `StockAdjustment` | ADR 0015, plan A-1 |
| Sales | Quote goes straight to invoice. `sales_orders` is not used | `Quote`, `Invoice` | Demo spec section 5 |
| Sales | Invoice status and balance are never stored. They come from the ledger | `ledger.ts` | ADR 0013 |
| Sales | Credit notes are invoices with `isReturn` and `creditForInvoiceId`. `credit_notes` is not used | `Invoice` | ADR 0013, plan K-11 |
| Sales | A deposit is a `Payment` with `kind: deposit`, against one invoice. `deposits` is not used. Customer payments have no allocations | `Payment` | ADR 0013 |
| Sales | `soldAtLocationId` is optional on quotes and invoices and falls back to `locationId` | `Quote`, `Invoice` | ADR 0023 |
| Sales | Write-offs, applied credit and refunds are new records | `InvoiceAdjustment`, `Refund` | ADR 0013 |
| Sales | `dueAt` is always set today. The type still allows null: `invoiceDueDate` in `operations/quotes.ts` returns null only if `installation.calendar` is on, and it is off | `Invoice` | Plan K-3 |
| Sales | Customers can be leads. Customer contacts are their own collection | `Customer.lifecycle`, `CustomerContact` | Plan K-8 |
| Purchasing | The supplier directory has types, status, W-9 details and contacts as records. No tax ID is stored | `Supplier`, `SupplierContact` | ADR 0022, plan K-9 |
| Purchasing | Only Draft, Ordered and Cancelled are stored on a PO. A PO keeps a snapshot of the rep | `PurchaseOrder` | ADR 0016, ADR 0022 |
| Purchasing | Bills have a total and no lines | `Bill` | Code only |
| Expenses | New. A pay-later expense creates a linked bill with no PO and no receipts. The plan had `Bill.expenseId`; the code has `Expense.billId` instead | `Expense`, `Bill`, `expense-actions.ts` | ADR 0023 |
| Expenses | One shared-cost rule per company. Per-category rules were left out | `SharedCostSettings` | Plan section 3 |
| Contracts | New. Billings have no draft and post directly. Retainage stays off `Invoice.total` until a release: `total = subtotal + tax - withheld + released` | `ContractBilling`, `Invoice`, `Bill` | ADR 0026 |
| HR | Overtime fields, profile fields and checklists on the employee. The single PTO balance is replaced by a ledger. Timesheets gained rejection and history | `Employee`, `Timesheet`, `TimeOffEntry` | ADR 0024 |
| HR | Pay periods, bonuses and contractor payments are new. Contractors never enter a pay period | `PayPeriod`, `Bonus`, `ContractorPayment` | ADR 0024, plan N-3 |
| Commissions | Plans with versions replace rules. Lines are derived | `CommissionPlan` and related | ADR 0025, plan N-4 |
| Meetings | Stable `uid` and `sequence`, replies, proposals, exceptions, private meetings, requests | `Meeting`, `MeetingResponse` | ADR 0018, ADR 0021 |
| Notifications | Rules per event, one Outbox row per recipient as a snapshot, stored in-app notifications. No real email is sent | `NotificationRule`, `OutboxMessage`, `InAppNotification` | ADR 0020 |
| Ledger | No accounts or journal tables. Journal lines are derived and exist only for expenses and bill payments | `journal.ts` | ADR 0023 |
| Import | External ids on customers, suppliers and employees. Batches keep before and after versions for Undo | `externalId`, `ImportBatch` | ADR 0019 |
| Tenancy | Data scope is on the role. Branding sits in company settings. Branches sit on the company record | `Role`, `CompanySettings`, `Company` | Demo build |

## Blueprint tables with no demo equivalent

| Blueprint tables | What the demo has instead |
| --- | --- |
| `tenant_databases` | Nothing. One fixtures file per company |
| `platform_admins`, `support_access_grants` | A platform admin session only |
| `price_lists`, `price_list_items`, `customer_groups` | `Product.price` only |
| `sales_orders`, `order_lines` | Nothing |
| `credit_notes`, `deposits`, `bill_lines`, `stock_levels` | See "Changes this demo introduced" |
| `approvals`, `approval_rules`, `sod_rules` | Reviewer fields on each record and thresholds in settings. Who may review is coded in the actions |
| `tax_categories`, `invoice_tax_lines` | `TaxCategory` is a fixed list. `Invoice` keeps a `taxRule` snapshot and one `tax` amount |
| `accounts`, `journal_entries`, `journal_lines`, `fiscal_periods` | Derived expense journal only |
| `document_sequences` | `nextNumber` |

## Points for the real build

- Every blueprint table has `id` (UUID v7), `created_at`, `updated_at`, `created_by` and soft delete. Demo records have string ids and only the dates each type needs.
- Several "by" fields store a person's name rather than a user id: `recordedBy` (beside `recordedById`), `reviewedBy`, `voidedBy`, `decidedBy`, `approvedBy`, `postedBy`, `byName`, `actorName`, and `Crew.lead`. The real build should store user ids.
- `user_invitations` (control migration 0004) holds one row per invitation: company, user, the SHA-256 of the emailed token (never the token), expiry, accepted and revoked times. `auth_attempts` gains the kinds `step_up_ok` (subject: session id), `step_up_failed` (subject: user id) and `invitation_attempt` (subject: IP), all deleted after 30 days with the rest (ADR 0034).
- `member.role` holds a person's company role keys plus the marker `mfa` when any of their roles needs MFA by content (`MFA_REQUIRED_KEYS`, packages/shared); role assignment and role edits keep it in sync (ADR 0034).
- `tenants.status_changed_at` (a trigger stamps every status change) and `tenants.maintenance_reason` (`migration_failed` or `move`) drive the company life cycle and maintenance mode (control migration 0003, ADR 0033). The life-cycle phase itself is derived on every request, never stored.
- Users live in the control database, and company records point at them by id. Those links cross databases, so they cannot be foreign keys.
- `Attendee.id`, `OutboxMessage.sourceId`, `OutboxRecipient.id`, `MovementSource.id` and `ImportChange.id` are polymorphic and need a type column or separate link tables. `Attendee.id` is stored as `meeting_attendees.party_type` with `party_id` (ADR 0051).
- Money and quantities are decimal strings. The blueprint's column types are `numeric(14,2)` for money, `numeric(14,4)` for unit costs and `numeric(14,3)` for quantities.
- `nextNumber` takes the highest number in use plus one. It is not safe with concurrent writes, so the real build needs `document_sequences`.
- Row-level narrowing per collection is in `apps/web/src/lib/api/demo/scope.ts`. The real API must apply the same filters.
