# Feature batch 3: Phase 0 plan

Plan for `docs/specs/feature-batch-03.md`, written 2026-11-10. Nothing in the batch is built until the owner approves this plan. Approving it approves every recommendation below unless the owner says otherwise. Where this plan and an ADR differ, the plan wins, and the ADR is corrected when its item is built.

## 1. Decisions for the owner

These change what gets built, or reverse something already decided. Each has a recommendation.

| Id | Question | Recommendation | If you say no |
| --- | --- | --- | --- |
| N-1 | **Can Sales record a deposit?** The spec's Sales day ends in "deposit with proof", and flow 1 is a Sales flow. Batch 2 Appendix A set this off by default, so today a new invoice is a dead end for Sales (U-05). | Turn `sales.payment.record` on for Sales. A payment recorded by Sales always waits for a second person, whatever the amount. Sales can also Mark as sent. | Sales keeps Print and PDF, the page says "Accounts records the deposit", and flow 1 signs in as the Accountant for that step. |
| N-2 | **Does a sold line bill whole cartons?** 500 sq ft of a 23.64 sq ft carton needs 22 cartons, which is 520.08 sq ft. The spec says partial cartons round up "when ordering" and does not say what the customer pays. | Quotes and invoices bill whole cartons, as they do today: "500 sq ft needed, 22 cartons = 520.08 sq ft billed". Stock then stays in whole cartons. | Bill exactly 500 sq ft, and the warehouse carries part-open cartons, which needs a rule for leftovers. |
| N-3 | **Gross pay formula.** The spec's formula in C1 underpays anyone with commission and overtime, loses overtime when a pay period splits a workweek, and double-counts unpaid leave for hourly staff. | Use the corrected formula in ADR 0024. Example at $20/h: 46 hours with $230 commission is $1,225, not the spec's $1,210. | Build the spec's formula as written, labelled as simplified. |
| N-4 | **When is commission "earned"?** The spec says on confirmed payment and also claws back later. Under California Labor Code 221, as read in the cases in ADR 0025, taking back earned wages is the weak form. | Advanced when the payment is confirmed, earned when the 90-day clawback window closes, written in the plan with a simulated signed acknowledgement. Counsel to confirm before real use. | "Earned on confirmation" as written, with a note that clawback needs legal review. |
| N-5 | **Can a rep on a margin plan see their commission base?** A margin plan cannot be checked without it, but CLAUDE.md rule 2 hides margin. Showing commission per invoice already lets a rep work the margin out. | Allow it for the rep's own lines only. Cost and margin percent still need `view_sensitive`. | Margin plans show totals only, and a rep cannot check their own pay. |
| N-6 | **Do the other three reports stay?** The spec removes four. Client note 8 asks for "one report with everything", and the Business report repeats Profit and loss and Payments received. | Follow the spec: Business report first and default; Profit and loss, Sales by category and Payments received stay, each with its own switch. | Switch them off too; it is one line each. |

## 2. What the audit found

Full list with pages and fixes: `docs/ux-audit.md`. All nine personas were walked on a production build of `0305fc9`: 14 high, 18 medium, 5 low.

The pattern: the demo works for people who sell and approve, and stops for people who only do one job.

- **Whole roles cannot do their work.** Employees land on a no-access page and cannot enter hours (U-01, U-02). HR cannot reach commissions, pay periods or an export (U-07). The Accountant cannot record an expense (U-06).
- **Three real defects.** Supplier payments above the approval limit can never be confirmed or voided, because no screen calls those actions, and the bill can be paid twice (U-04). Warehouse staff see held rolls as free and cannot cut for a paid invoice, because reservations follow the invoice's branch (U-03). Invoices due "after installation" would never become due once Installation is off (U-09).
- **Dead ends.** PO, bill and payment do not link (U-12), invoices do not link to the quote or customer (U-21), and supplier and employee rows open nothing (U-10, U-11).
- **Seed data.** Payables are 64% overdue (U-28), and every Summit invoice is in one warehouse, so location profit would be empty (U-29).

| Finding | Fixed in |
| --- | --- |
| U-03, U-05, U-16, U-18, U-20, U-21, U-22, U-23, U-26 | A0 and A5 |
| U-13, U-36 | A1 |
| U-14, U-19 | A2 |
| U-09, U-31, U-37 | A3 |
| U-04, U-10, U-12, U-15, U-33, U-34, U-35 | B1 to B3 |
| U-01, U-02, U-07, U-08, U-11, U-17, U-24, U-25, U-30 | C1, C2 |
| U-32 | E |
| U-06, U-27 | F1, F2 |
| U-28, U-29 | G |

## 3. Research summary

One ADR per area, each with links. All are `proposed` until this plan is approved.

| Area | ADR | What matters most |
| --- | --- | --- |
| Notifications and email | [0020](../adr/0020-notification-and-email-centre.md) | The bell is derived today, so "your time off was approved" needs a stored per-user list. Each event needs a recipient rule. One Outbox row per recipient, stored as a snapshot. No pay amounts in email. |
| Meeting invites | [0021](../adr/0021-meeting-invites-and-ics.md) | SEQUENCE rises only for time, recurrence, status or location changes, because Outlook discards all responses when it rises. Add Maybe. A proposed time waits for the organiser. Importing an `.ics` is a snapshot, and only an emailed invite can update. |
| Suppliers and contacts | [0022](../adr/0022-supplier-directory-and-contacts.md) | Contacts are their own records so an order can point at one. Snapshot the rep when the order is placed. A phone-only rep cannot get an email, so add Mark as ordered by phone. Warn about duplicates, never block. |
| Expenses and location profit | [0023](../adr/0023-expenses-and-location-profit.md) | Paying sales tax to the state is not an expense. Showrooms need `soldAtLocationId` or they earn nothing. People costs must count in net profit. Cents split by largest remainder, so locations add up exactly to the company. |
| HR, overtime, portal | [0024](../adr/0024-hr-timesheets-overtime-and-portal.md) | Overtime is per workweek on the regular rate, including commission. See N-3. California's seventh-day rule is missing from `overtime.ts`. 1099 workers leave the pay period. Monthly periods cannot serve California non-exempt staff. |
| Commissions | [0025](../adr/0025-sales-commission-plans.md) | A testable order of operations for one confirmed payment, rounded on running totals. Marginal tiers by default. See N-4 and N-5. "Invoice voided" and "written off" are not real clawback triggers; the payment void and the credit note are. |
| Contracts | [0026](../adr/0026-contracts-and-progress-billing.md) | Retainage stays out of `Invoice.total` until a release invoice, so the ledger, aging and "customers owe" need no change. Retainage is capped in some states. Tax treatment is a per-contract setting. Bill per period, not per line. |

**Limits on this evidence.**
- `dir.ca.gov` and `leginfo` refused automated readers, so California rules rest on search excerpts, FindLaw copies and third-party copies of DLSE letters. Each is marked in its ADR.
- Only federal and California employment law was researched, as the spec named. Summit's staff are in Colorado and Harbor's in Florida, and the demo keeps them on the federal rule.
- Gusto's and BambooHR's help centres were closed to the tools, so those facts come from search excerpts. RFMS and QFloors publish little.
- No `.ics` file has been tried in a real Gmail or Outlook mailbox. ADR 0021 requires one manual import before sign-off.
- Nothing here is legal advice. All rules stay labelled "Example: confirm with your accountant / payroll provider / counsel".

**Research additions left out of this batch**, to keep it to demo size: the personal My notifications page (0020), sharing rules per expense category (0023), bond in lieu of retainage and California's SB 440 claim flow (0026), a hosted answer page for external guests (0021, real build only).

## 4. Data-model changes

Types live in `packages/shared/src/types`. Every change gets its ADR above, or a short new one when the item is built.

| Record | Change | Source |
| --- | --- | --- |
| `Product` | Area goods: `unit: sq_ft`, `price` and `cost` per sq ft. `sqFtPerCarton` stays as packaging data. | A1 |
| Quote and invoice lines | Area goods in sq ft. Line gains `locationId` when it differs from the document's warehouse. | A1, A2 |
| `Quote`, `Invoice` | `soldAtLocationId`. Invoice: `dueAt` always set, `commissionSplit`, `contractId`, `billingId`, `retainageWithheld`, `retainageReleased`, proportional `cost` on contract billings. | 0023, 0025, 0026, K-3 |
| `StockMovement`, `Reservation`, `Transfer` | Boxed goods in sq ft, always whole cartons. Rolls stay in ft, with sq ft as the main figure. | K-2 |
| `Customer` | `lifecycle: customer \| lead`. New collection `customerContacts`. | E, K-8 |
| `Supplier` | `contactName` goes. Adds `type` (goods, services, utility, government), `status`, `accountNumber`, `track1099`, `taxForm`, `notes`. | 0022, K-9 |
| `SupplierContact` (new) | Name, role, mobile, office phone, email, WhatsApp flag, preferred method, notes, primary, status. | 0022 |
| `PurchaseOrder` | `contactId`, `contactSnapshot`, `supplierRef`, `buyerId`, `placedVia`. `PoLine` in sq ft with its own `locationId`. | 0022, B2 |
| `GoodsReceipt` | `ReceiptLine.locationId`, so one receipt can fill two warehouses. | B2, flow 2 |
| `Bill` | `contractId`, `billingId`, `kind`, `gross`, `retainageWithheld`, `retainageReleased`, `expenseId`. | 0023, 0026 |
| `Employee` | `flsaStatus`, `exemptionBasis`, `salaryHoursPerWeek`, `commissionVisible`, `homeLocationId`, profile fields, documents, emergency contact. `ptoBalanceHours` goes. | 0023, 0024 |
| `Timesheet` | `rejected` status, `submittedAt`, `decidedBy`, `decidedAt`, `rejectionReason`, `source`, `history`. | 0024 |
| `PtoRequest` | `policyId`, decision fields, `cancelled` status. | 0024 |
| New HR records | `TimeOffPolicy`, `TimeOffEntry` (ledger), `PayPeriod`, `PayPeriodLine`, `Bonus`, `ClockEntry`. | 0024 |
| Commissions | New `CommissionPlan`, `CommissionAssignment`, `CommissionLine`, `CommissionStatement`, `CommissionAdjustment`. The `commissions` collection and `settings.commissions.rules` go. | 0025 |
| Contracts (new) | `Contract`, `ContractLine`, `ChangeOrder`, `ContractBilling`, `LienWaiver`, `InsuranceCertificate`, `SignatureRecord`. | 0026 |
| `Meeting`, `Attendee` | Meeting: `uid`, `sequence`, `rescheduleSequence`, `status`, `kind`, `private`, `hideGuestList`, `allowProposals`. Attendee: `email`, `role`, `partStat`, response fields, `proposal`. New `meetingResponses`. | 0021 |
| `Expense` | Rewritten: number, date, supplier, category (12 plus `sales_tax_payment`), location, amount, tax, method, reference, files, status, settlement, recurring link. New `RecurringExpense`. | 0023 |
| `Location` | `floorAreaSqFt`. | F1 |
| Notifications (new) | `notificationRules`, `outboxMessages`, `inAppNotifications`. | 0020 |
| `CompanySettings` | Adds `email`, `hr`, `meetings`, `expenses`, `sharedCosts`. Removes `region.areaUnit` and `commissions`. | A1, 0020 to 0025 |
| Derived, nothing stored | `packages/shared/src/journal.ts` derives postings from documents. | 0023 |
| Roles and permissions | New Purchasing system role (K-1). New keys follow `module.resource.action`: suppliers and contacts, HR commissions and pay periods, contracts, expenses, notifications, Outbox, stock correction. A new `contracts` module; Summit and Keystone both get it. | K-1 |

## 5. DemoStore migration

- `OVERLAY_SCHEMA_VERSION` goes to 4, on the existing upgrade chain and storage prefix.
- **The v3 to v4 step resets each company's saved changes, with the existing message** ("Your saved demo changes came from an older version of the demo, so this company was reset to fresh data."). Batch 2's rule allows a reset when data cannot upgrade cleanly, and it cannot here: the fixtures themselves change underneath the overlay (prices, units, suppliers, expenses, HR), so upgraded records would sit in a mix of old and new data. Only a browser's own demo experiments are lost.
- That reset also clears those files from the IndexedDB file store, so no orphan proofs remain.
- Table preferences already tolerate missing columns. Removed columns (roll area in sq yd) simply drop out.
- The fixture generator keeps its seed and adds new data without disturbing existing random draws wherever it can. Regenerated prices change seeded totals, so tests that assert a seeded amount are updated and named in their commits.

## 6. Appendix A assumptions

| Id | Assumption | Recommendation |
| --- | --- | --- |
| A-1 | Stock corrections without the Adjustments page | Agree: one Owner-only **Correct stock count** on the roll and the product, with a mandatory reason and an audit entry, under `inventory.stock.correct`. The Adjustment option leaves Cut roll, and Warehouse loses `inventory.stock.adjust`. Existing ADJ movements stay in the ledger so on hand still adds up; they appear in stock history as corrections. |
| A-2 | Square feet only | Agree. Imports still accept a file in sq yd and convert it, so a customer's data can come in. |
| D-1 | Contracts cover both directions | Agree. |
| C-1 | Gross pay only | Agree, with the corrected formula (N-3). |
| C-2 | Commission hidden from employees by default | Agree, as the client asked. The setting carries a note that hiding the portal page does not replace a signed plan or wage statements. |
| E-1 | New guests saved as customer contacts by default | Agree. The form asks which customer. If none is picked, the guest stays on the meeting and is not saved. |
| F-1 | Shared costs by revenue share | Agree. |
| F-2 | Outbox simulates email | Agree. |

## 7. Conflicts and gaps, resolved

| Id | Issue | Resolution |
| --- | --- | --- |
| K-1 | The spec has a Purchasing persona, but no such role exists. | Add a Purchasing system role with a seeded user and login card. |
| K-2 | Price precision. Rounding today's carton prices to cents per sq ft would change the amount on 544 of the 763 seeded area invoice lines. | Regenerate the seed with cent prices per sq ft, so stored documents stay exact and the reconciliation test holds. Carton prices become derived hints. Stock in sq ft follows CLAUDE.md rule 4. |
| K-3 | With Installation off, "due after installation" has no end. | Every invoice gets a due date: issue date plus the customer's terms. The 18 seeded Summit invoices with none are given one, and Installed leaves the timeline. Contract invoices follow their own terms. |
| K-4 | The `inventory.adjustments` row in FEATURES.md also describes reservations and cuts, which must stay. | Split it: `inventory.reservations` keeps holds, cut / issue and On hand / Reserved / Available; `inventory.adjustments` is only the page and is switched off. |
| K-5 | `reports.hub` is one key for seven reports. | One key per report, so the four can be switched off. |
| K-6 | What "Installation off" leaves behind. | Labor and installation stay as products on quotes, since tax rules and revenue depend on them. Jobs and crews stay in the code and data, unseen. Installer users keep their login and use the portal. Their sign-in card goes. |
| K-7 | Where Expenses goes (the spec leaves this to the plan). | A new **Finance** menu with **Payments to verify** (customer and supplier payments, U-04 and U-15) and **Expenses**. Rent is not purchasing, and the approval queue had no home. Contracts takes Installation's menu slot. |
| K-8 | Meetings need "customer contacts" and "leads", and neither exists. | `customerContacts` as a small collection. A lead is a `Customer` with `lifecycle: lead`, profile incomplete. |
| K-9 | ADRs 0022 and 0026 define the supplier differently. | One set of fields: `type` from 0022 (a subcontractor is a Services supplier with a subcontract) and `taxForm` from 0026, with **no tax ID stored at all**, so 0026's `tinLast4` is dropped. |
| K-10 | Commission on contract billings. | Progress invoices earn on gross when paid, and a release earns nothing, so commission comes early by the retained amount. Accept this for the demo and record it. Billings carry a share of estimated cost so margin plans are not paid on 100%. |
| K-11 | Clawback needs a credit note, but no store action creates one. | Add the action in Batch C. |
| K-12 | Switched-off features have no test-skip mechanism today. | Add a `skipIfFeatureOff(key)` helper for Playwright and `describe.skipIf` for Vitest in A0. |
| K-13 | The spec says `pnpm start`, but the root package has no such script. | Add it in A0. Also add the low-memory rule to CLAUDE.md (done in Phase 0). |

## 8. How each item is built

As in batch 2: feature key in `packages/shared/src/features.ts` and a row in `docs/FEATURES.md`; permission keys and default roles; types and generator; ApiClient method and `docs/api-contract.md` row; DemoStore with a permission check inside the action; screen; unit tests; a Playwright spec and `screens.ts` entries; ADR status updated; `docs/blueprint-delta.md` row; lint, typecheck, unit tests; commit, push, tick STATUS.md. The full suite runs at the end of each batch, in chunks, on a production build.

**New keys planned:** `units.square-feet`, `sales.quote-availability`, `inventory.reservations`, `inventory.stock-correction`, `reports.business` and one per existing report, `settings.notifications`, `settings.outbox`, `purchasing.suppliers`, `finance.payments-queue`, `finance.expenses`, `finance.recurring-expenses`, `settings.cost-sharing`, `hr.commissions`, `hr.pay-periods`, `hr.portal`, `hr.clock`, `settings.hr`, `contracts.register`, `contracts.billing`, `contracts.compliance`, `meetings.invites`, `meetings.requests`, `settings.meetings`.

**Switched off, code kept, status `removed`:** `inventory.adjustments`, `installation.calendar`, and the four reports.

**Tests I expect to change on purpose**, each named in its commit: `flows.spec.ts` (flow 1 passes through installation), `installation.spec.ts` (skips), `dashboard.spec.ts` (today's jobs, attention), `reports.spec.ts`, `stock.spec.ts`, `login.spec.ts` (Installer card, new cards), `localization.spec.ts` (area unit), `purchasing.spec.ts` (PO form), `hr.spec.ts`, `meetings.spec.ts`, `presenter-guide.spec.ts`, `commissions.test.ts`, the fixture snapshot and reconciliation figures.

**New dependencies:** none expected. Excel, PDF, charts and forms already use libraries in the repo.

**Size:** this is at least as large as batch 2. It is built in spec order, committed and pushed per item, so `/continue` resumes across sessions.
