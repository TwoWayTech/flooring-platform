# ADR 0063: Step-up consistency for actions that move money, pay or access

- **Status:** accepted, 2026-11-21 (owner's decisions 4 and 6, [ADR 0061](0061-owner-decisions-after-click-through.md); click-through finding #47).
- **Context:** step-up (a fresh authenticator code, valid 5 minutes; ADR 0034) grew one feature at a time: roles, users, MFA resets and support access (ADR 0034), data import and Undo (ADR 0057), the platform console (ADR 0052, 0053, 0056) and several settings sections (ADR 0059). The click-through found that approving a whole pay period, which commits the pay of every employee, needed no code, while saving branding did (#47). The owner asked for one rule, applied everywhere, and for the inventory below.

## The rule

A fresh code is asked for an action that does one of these:

1. **Changes who can do what, or who can sign in:** inviting someone, changing a person's roles, status or branch, resetting their MFA, saving, resetting or deleting a role, approving support access, and every platform console write.
2. **Changes a rule that money, tax or pay follow, or where they go:** Payments, Accounting (bank accounts and payment methods), Sales tax, Currency, the states of operation, Settings → HR, a new overtime rule, Branding and the email sender (a phishing lever); adding, changing or versioning a commission plan, putting someone on a plan, and changing an employee's pay facts (rate, pay type, worker type, overtime status, salaried hours, work state, manager, sign-in link).
3. **Loosens a control:** switching a two-person check off or raising its amount (Payments, Expense approval, Stock rules), raising or clearing the write-off limit, and reopening closed books. Loosening a two-person check is also the **Owner's alone** (403 `owner_only`, asked before the code). Tightening a control needs only the key, unless rule 2 already asks for a code for the whole section (Payments, Settings → HR).
4. **Commits or takes back everyone's pay at once:** approving or reopening a pay period.
5. **Writes or removes many records at once:** a data import and its Undo.
6. **Sends money out or gives up money owed, with no second person:** every refund and every write-off, whatever the amount (the owner's answer of 2026-11-21, below).

A code is **not** asked for routine work on one document: recording, confirming or voiding one payment, a credit note, recording a bill, a supplier payment, an expense, a contract bill or retainage release, a bonus, a contractor payment, one commission statement or adjustment. These are already held by their key (most are MFA keys, so the person signed in with two factors), by the two-person checks and the write-off limit where the company set them, by the separation-of-duties rules, by the audit log, and by reversal through the ledger (CLAUDE.md rule 9). Asking for a code on every one would make daily work a stream of codes, and people stop reading prompts they see all day. Confirming a single payment needs no code.

Every code is asked on the server, **after** the content, state and permission checks of the action, so a refused value never costs a code; screens ask for it with the shared step-up dialog (`StepUpDialog`) and, where they can tell, only when the server will.

## The inventory

"Who" is the default roles holding the key (Flooring Suite and HR Suite); a custom role can hold it too. "Yes" rows marked **new** changed in this ADR.

| Action | Route | Key | Who (default roles) | Step-up | Why |
| --- | --- | --- | --- | --- | --- |
| Invite a user | `POST /users/invite` | `settings.users.manage` | Owner | yes | Rule 1: gives roles to a new account |
| Change roles, status or branch; reset MFA | `PATCH /users/:id` | `settings.users.manage` | Owner | yes (a title alone: no) | Rule 1 |
| Create, save, reset or delete a role | `POST /roles`, `PUT /roles/:id`, `POST /roles/:id/reset`, `DELETE /roles/:id` | `settings.roles.manage` | Owner | yes | Rule 1 |
| Approve support access | `POST /support-grants/:id/approve` | any member; the Owner role is checked | Owner | yes | Rule 1 |
| Revoke support access | `POST /support-grants/:id/revoke` | any member; the Owner role is checked | Owner | no | Ends access: tightens |
| Platform: company access, status (suspend, reinstate, cancel), plans, support requests | `PATCH /platform/companies/:id/access`, `POST /platform/companies/:id/{suspend,reinstate,cancel}`, `POST`/`PATCH /platform/plans…`, `POST /platform/support-grants` | platform admin role | platform owner (and the roles a route allows) | yes | Rule 1 (`PlatformAdminGuard` on every write) |
| Import a file; Undo an import | `POST /imports`, `POST /imports/:id/undo` | `settings.import.manage` | Owner | yes | Rule 5 |
| Check a file; save column choices | `POST /imports/check`, `PUT /imports/mappings/:kind` | `settings.import.manage` | Owner | no | Reads, or saves a preference |
| Payments settings | `PUT /settings/payments` | `settings.payments.manage` | Owner, Accountant | yes, every save; loosening Owner-only | Rules 2 and 3 (ADR 0059 D5, Q10) |
| Expense approval: switch off or raise the amount | `PUT /settings/expenses` | `settings.expenses.manage` | Owner | **new:** yes, and Owner-only | Rule 3; owner's decision 6 |
| Expense approval: keep or tighten | `PUT /settings/expenses` | `settings.expenses.manage` | Owner | no | Tightens |
| Shared costs | `PUT /settings/sharedCosts` | `settings.expenses.manage` | Owner | no | Only splits a report (ADR 0059 part 4b, D3) |
| Accounting: bank accounts and payment methods | `PUT /settings/accounting` | `settings.payments.manage` | Owner, Accountant | yes | Rule 2: where money posts (ADR 0040) |
| Sales tax | `PUT /settings/localization/tax` | `settings.tax.manage` | Owner, Accountant | yes | Rule 2 |
| Currency | `PUT /settings/localization/currency` | `settings.localization.manage` | Owner, Accountant | yes | Rule 2 |
| Region: states of operation change | `PUT /settings/localization/region` | `settings.localization.manage` and `settings.tax.manage` | Owner, Accountant | yes (other Region fields: no) | Rule 2: the default tax rate applies only there |
| Payroll rules: the overtime rule changes | `PUT /settings/localization/payroll` | `settings.localization.manage` | Owner, Accountant | **new:** yes (the holiday calendar alone: no; repairing a missing tab with the federal default: no) | Rule 2: changes everyone's overtime pay |
| Settings → HR | `PUT /settings/hr` | `settings.hr.manage` | Owner, HR manager | yes, every save | Rule 2 (ADR 0059 part 5) |
| Branding | `PUT /settings/branding` | `settings.branding.manage` | Owner | yes | Rule 2: what customers see as the company |
| Email sender | `PUT /settings/email` | `settings.notifications.manage` | Owner | yes | Rule 2: a phishing lever |
| Stock rules: raise or clear the quantity | `PUT /settings/inventory` | `settings.locations.manage` | Owner | yes, and Owner-only | Rule 3 |
| Company profile, number format, Sales and documents, warehouses | `PUT /settings/profile`, `/numbers`, `/localization/documents`, `POST`/`PUT /locations` | their keys | Owner (documents: Owner, Accountant) | no | No money moves and no control changes |
| Close the books | `POST /ledger/period-close` (a later day) | `settings.company.manage` | Owner | no | Tightens |
| Reopen the books | `POST /ledger/period-close` (an earlier day) | `settings.company.manage` | Owner | **new:** yes | Rule 3: lets entries into closed days |
| Approve a pay period | `POST /pay-periods/:id/approve` | `hr.payroll.approve` | Owner, HR manager | **new:** yes | Rule 4; owner's decision 4, #47 |
| Reopen a pay period | `POST /pay-periods/:id/reopen` | `hr.payroll.approve` | Owner, HR manager | **new:** yes | Rule 4 |
| Leave someone out of a run, or bring them back | `POST /pay-periods/:id/exclusions` | `hr.payroll.approve` | Owner, HR manager | no | Shapes a run under review; the approval asks |
| Export a pay period | `POST /pay-periods/:id/export` | `hr.payroll.export` | Owner, Accountant, HR manager | no | Locks a run whose pay was confirmed with a code at approval; moves nothing |
| Open a pay period | `POST /pay-periods` | `hr.payroll.view` | Owner, Accountant, HR manager | no | Opens by the schedule |
| Bonus; void a bonus | `POST /bonuses`, `POST /bonuses/:id/void` | `hr.payroll.approve` | Owner, HR manager | no | One person; paid only through a run's approval |
| Contractor payment: record, pay, void | `POST /contractor-payments`, `/:id/pay`, `/:id/void` | `hr.payroll.approve`, `hr.payroll.export` | Owner, HR manager (pay: also Accountant) | no | One document; someone else pays it (separation of duties); a void reverses |
| Approve a commission statement | `POST /commission-statements/approve` | `hr.commission.approve` | Owner, HR manager | no | One person's month; it reaches pay only through a pay run's approval, which asks |
| Commission adjustment; decide a late reversal | `POST /commission-adjustments`, `POST /commission-reversals/decide` | `hr.commission.adjust`, `hr.commission.approve` | Owner, HR manager | no | One statement, with a reason, audited |
| Add, change or version a commission plan; put someone on a plan | `POST /commission-plans`, `PUT /commission-plans/:id`, `POST /commission-assignments` | `hr.commission.manage` | Owner, HR manager | **new:** yes | Rule 2: a rule pay follows (owner's answer 2) |
| Sign one's own plan | `POST /commission-assignments/:id/acknowledge` | `hr.portal.view` | everyone with a portal | no | Agrees to a plan; changes no rule |
| An invoice's commission split | `PUT /invoices/:id/commission-split` | `hr.commission.manage` or `sales.invoice.edit` | Owner, Manager, Accountant, HR manager | no | One invoice |
| Change an employee's pay facts (rate, pay type, worker type, overtime status, salaried hours, work state, manager, sign-in link) | `PUT /employees/:id` | `hr.employee.edit` (the rate, pay type and hours also need `hr.employee.view_sensitive`) | Owner, HR manager | **new:** yes | Rule 2: a rule pay follows (owner's answer 2) |
| Other employee edits; add a person | `PUT /employees/:id`, `POST /employees` | `hr.employee.edit`, `hr.employee.create` | Owner, HR manager | no | No pay rule changes; a new person's pay is first confirmed when a run that pays them is approved |
| Record a customer payment | `POST /payments` | `sales.payment.record` | Owner, Manager, Accountant, Sales (decision 3 removes Sales) | no | One document; the two-person check holds large ones |
| Confirm or reject a payment | `POST /payments/:id/review` | `sales.payment.approve` | Owner, Accountant | no | The two-person check itself; never one's own |
| Void a payment | `POST /payments/:id/void` | `sales.payment.void` | Owner, Accountant | no | One document, with a reason; reversed in the ledger |
| Refund | `POST /refunds` | `sales.payment.refund` | Owner, Accountant | **new:** yes, whatever the amount | Rule 6: money out with no second person (owner's answer 1) |
| Write off a balance | `POST /invoices/:id/write-off` | `sales.payment.write_off` | Owner, Accountant | **new:** yes, whatever the amount | Rule 6: gives up money owed (owner's answer 1); still within the write-off limit |
| Credit note; void an invoice | `POST /invoices/:id/credit-notes`, `POST /invoices/:id/void` | `sales.invoice.void` | Owner, Manager, Accountant | no | One document, reversed in the ledger |
| Apply a credit | `POST /invoices/:id/apply-credit` | `sales.payment.apply_credit` | Owner, Accountant | no | Moves the customer's own credit between their documents |
| Record a bill | `POST /purchase-orders/:id/bills` | `purchasing.bill.create` | Owner, Manager, Accountant, Purchasing | no | One document, matched to its order |
| Record, confirm or void a supplier payment | `POST /supplier-payments`, `/:id/review`, `/:id/void` | `purchasing.payment.record`, `.approve`, `.void` | Owner, Manager, Accountant (record: also Purchasing) | no | One document; the two-person check holds large ones |
| Record, approve or void an expense; recurring expenses | `POST`/`PUT /expenses…`, `/:id/review`, `/:id/void`, `POST`/`PUT /recurring-expenses…` | `finance.expense.create`, `.approve`, `.void` | Owner, Manager, Accountant (void: Owner, Accountant) | no | One document; expense approval holds large ones |
| Contract bill, retainage release, void a contract bill | `POST /contracts/:id/billings`, `/retainage-releases`, `POST /contract-billings/:id/void` | `contracts.billing.create`, `contracts.billing.void` | Owner, Manager, Accountant | no | One document, reversed in the ledger |
| Stock count correction | `POST /stock/corrections` | `inventory.stock.correct` | Owner | no | One product, Owner-only, with a reason (ADR 0061 decision 8) |

Hours, time off, quotes, orders, transfers and meetings move no money by themselves and are left out.

## Built

- **Server:** `PayPeriodsService.approve` and `reopen` call `StepUpService.require` after every other check, inside the run's transaction and before any write (HrModule imports AuthModule). `PUT /settings/expenses` judges `expenseApprovalLoosened` against the stored row under its lock: a loosening by anyone but an Owner is 403 `owner_only` (`EXPENSE_APPROVAL_OWNER_ONLY`), an Owner's needs a step-up; keeping or tightening needs neither (Stock rules' pattern). `PUT /settings/localization/payroll` needs a step-up when `overtimeRuleChanged`, judged under the row's lock. `POST /ledger/period-close` needs a step-up when the day goes earlier than the one closed, judged under the period lock (`LedgerService.closePeriod` takes a `confirm` callback).
- **Shared:** `approvalCheckLoosened` (one rule for a two-person check, used by `paymentControlsLoosened` and the new `expenseApprovalLoosened`, which counts any change to a malformed stored section as loosening) and `overtimeRuleChanged`, which compares against the rule in effect: a missing tab or rule counts as `DEFAULT_OVERTIME_RULE` (federal), so repairing a row with that rule needs no code (verify run of PR #87, RC2), while a stored rule that is not one of the rules counts any save as a change.
- **Web:** Pay periods asks for the code with `StepUpDialog` before Approve and Reopen; a run that still has timesheets waiting is sent without one, since the server refuses it before the code. After Approve or Reopen the page keeps that period chosen, so Export for payroll is where you were (#47). Expense approval asks for the code and refuses a non-Owner's loosening before it (`SettingsForm`'s `problem` and `stepUp`); Payroll rules asks only when the overtime rule changes. DemoStore applies the Owner-only expense rule; its step-up is the dialog alone.
- **Server, after the owner's answers:** `InvoicesService.writeOff` requires a step-up inside its transaction, after the balance and limit checks and before any write (SalesModule imports AuthModule). `PaymentsService.refund` runs the refund's checks against the credit as it reads now, then the step-up, **before any proof file is stored**, so a refusal writes nothing to storage; the checks run again under the customer's lock. `CommissionsService.savePlan` (add, edit in place or new version) and `assign` require one after their checks. `PeopleService.save` requires one when an edit changes the person's pay facts (`payFactsChanged`: rate, pay type, worker type, overtime status, salaried hours, the work state, which picks the overtime rules, the manager, who is paid overrides on the person's sales, and the sign-in link, which decides whose commission is paid to them; compared as the stored fields are; adding a person does not).
- **Review round 1 (blocking):** `PUT /settings/expenses` now saves with `firstSave: "refuse"`, as Stock rules does. Two first saves at once are both judged against the never-saved answer (approval off), so without it an Owner's "on, 100" and a non-Owner's "on, 10000" both passed as tightenings and the second loosened the first with no Owner rule and no code; now the one that finds the row taken is a 409.
- **Web, after the owner's answers:** a `useStepUp` hook over `StepUpDialog` asks for the code before Refund credit, Write off remaining balance, saving a commission plan (after the shared plan rule), Assign a plan, and an employee save that changes pay facts; the employee form also asks when the API answers `step_up_required` for a change it didn't foresee (a California salary's hours follow the work state).
- **Permissions are unchanged.**

## Tests

- packages/shared `expense-controls.test.ts` (EC1 to EC5, OR1); `payment-controls.test.ts` still passes on the shared rule.
- apps/api: `payroll.int.test.ts` (reopen and approve without a step-up: 403 `step_up_required`, nothing moves; with one: 201), `settings.int.test.ts` A17 (non-Owner loosening 403 `owner_only`; Owner without a step-up 403 `step_up_required`; tightening needs neither; Owner with a step-up 200), `settings-localization.int.test.ts` L6 (a new overtime rule without a step-up is refused), `invoices.int.test.ts` (reopening the books, a write-off and a refund without a step-up are refused and nothing changes; with one they go through), `commissions.int.test.ts` (adding a plan, editing it and putting someone on it without a step-up: 403, nothing written), `hr.int.test.ts` (a new pay rate without a step-up: 403, the rate stays; an edit that keeps the pay facts needs none). Suites that do these as setup step up first (`commissions`, `new-company`, `accounting`, `payroll`, the money model's `money-ops`); `AuthHarness.dropStepUp` forgets a step-up so a refusal can be checked, and `grantLastingStepUp` keeps one for a long suite's setup edits. Review round 1: `settings.int.test.ts` A18 (two first expense-approval saves at once: a 409 or `owner_only`, never a stored loosening; the route passes `"refuse"`), `hr.int.test.ts` (a new work state, manager or sign-in link without a step-up: 403, nothing changes), `invoices.int.test.ts` (a refund refused for its step-up stores no proof file).
- Playwright demo: `invoice-lifecycle.spec.ts` confirms the write-off's code (`confirmDemoStepUp`).
- Playwright api mode: `pay-periods.spec.ts` PP1 (Dana approves and reopens Summit's run in review with codes; the API refuses without one; the period stays chosen with Export for payroll); `settings.spec.ts` E3 (a lower expense amount saves with no code; raising it back asks for one).


## The owner's answers (2026-11-21)

The first version of this ADR asked two questions; the owner answered them by the rule "every action that moves money, pay or access, consistent":

1. **A refund and a write-off move money out**, so both always need a step-up, whatever the amount (rule 6).
2. **Changing a commission plan** (adding, editing or versioning one, putting people on a plan) **and changing an employee's pay rate, salary or pay type** are changes to rules pay follows, so both need a step-up (rule 2). The worker type, overtime status and salaried hours are pay facts too and are treated the same way; so, after review round 1, are the work state (it picks the overtime rules), the manager (paid overrides on the person's sales) and the sign-in link (whose commission is paid to the person).
