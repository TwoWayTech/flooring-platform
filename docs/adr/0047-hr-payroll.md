# ADR 0047: HR part 2 on the API (pay periods, bonuses, contractor payments and payroll postings)

- **Status:** accepted, 2026-11-14
- **Context:** hr.md "Pay periods" describes runs that are opened on the company's pay schedule, reviewed live from approved timesheets, approved time off and bonuses, then approved (frozen lines, time-off accrual), reopened or exported. The schema exists (`pay_periods`, `pay_period_exclusions`, `pay_period_lines`, `bonuses`, `contractor_payments`; `time_off_entries.pay_period_id`). ADR 0046 put people, timesheets and time off on the API and left pay for this part, with the PR #25 fifth review's should-fix items to do first because pay goes out here. Every financial event posts a balanced entry (CLAUDE.md rule 10); pay is sensitive (rule 5); payroll rules come from settings and the country pack (rule 12).

## Decision

### First steps (PR #25 fifth review)
- **Paid days are closed to time off too:** `inClosedPayPeriod(tx, from, to)` moved to `hr-common.ts` and takes a date range. Requesting time off, approving it and cancelling an approved request are refused when its days overlap an approved or exported pay period.
- **Maker-checker:** nobody decides a timesheet they saved, uploaded or submitted, or a time-off request they made, unless they are the Owner. Each timesheet history step now carries `byUserId` (the jsonb column already holds the list; `"saved"` joins the actions; no schema change), and `sheetMakers` reads it with `timesheets.created_by`; requests use `pto_requests.created_by`.
- **Decimal hours:** `hoursByDate`, `leaveByDate`, the week and bonus hour sums and the full-day count in `pay.ts` use decimal.js; the HR week view, HR Home and `BulkApproveDialog` add hours with `sum`, and `WeekRow.total` is a decimal string.
- **Linked sign-in for others:** saving, submitting or uploading hours, and requesting time off, for someone else need a sign-in linked to an employee unless it is the Owner's (`requireLinkedDecider` in `lockForEdit`, `lockFor` and the upload).
- **Live link:** `viewerEmployeeId` joins `employees` and ignores a soft-deleted employee, so a dead link neither gives branch scope nor passes the linked-sign-in rule.
- **Audit:** `Saved timesheet hours` records the previous days as `before`.
- **Clock-out into a submitted or approved week** closes the punch without adding hours, audits `hoursAdded: false` with `week submitted|approved, hours not added; HR to correct` and answers with a `note`.

### Pay periods
- **Routes** (module `hr`, switch `hr.pay-periods`, keys exactly hr.md "Who uses it"): `GET /pay-periods`, `POST /pay-periods` and `GET /pay-periods/:id/review` (`hr.payroll.view`); `POST /pay-periods/:id/exclusions`, `/approve`, `/reopen` (`hr.payroll.approve`); `/export` (`hr.payroll.export`). docs/api-contract.md, "HR, part 2".
- **Company-wide:** every payroll route needs data scope `all` (`requireCompanyWidePayroll`, like the books' `requireCompanyWide`): the Owner, Accountant and HR manager hold the keys and all three are company-wide; a custom role at branch scope gets 403.
- **Opening a period:** the demo creates the current period while listing. The API never writes on a read, so `POST /pay-periods` opens the period holding a day (today by default) from `payFrequency` and `payPeriodAnchor` in Settings → HR (`periodFor`, rule 14), under a row lock on the settings row, and returns the existing one if it is there. The web client calls it before `GET /pay-periods`; a 4xx (read-only company, no schedule, no access) is ignored and the list still loads.
- **Review** computes each payable person's line (`payableEmployees`, rule 15) with `grossPay` from approved sheets, approved requests, policies and the bonuses whose period ends in the run (`bonusesInRun`), with the company's overtime rule; blockers come from `payRunBlockers`. These three helpers moved from the demo's `pay-actions.ts` to `packages/shared/src/hr/pay-run.ts`, and the demo now calls them. Approved and exported runs show their frozen lines. The person on each row carries work facts and the email the payroll file needs (`payrollPerson`).
- **Approve** (period row locked first, then every payable employee in id order, the order every HR write uses, so no hours, time off or bonus can change under it): the run has ended, `payFrequencyProblem` is null, no blockers, and no approved, unpaid commission statement waits for anyone in it. The lines are frozen into `pay_period_lines`, time-off accrual posts with `pay_period_id` (rule 12), and the payroll entry posts.
- **Separation of duties at approval** (the Owner is exempt, as everywhere in HR): the approver's sign-in must be linked; nobody approves a run that has a line for their own employee (by link or verified email); nobody approves a run they shaped, meaning they left someone out of it, brought someone back into it (read from its append-only audit entries) or added a bonus paid in it. Periods are opened by the schedule, so "the builder" is whoever changed the run's content.
- **Reopen** (approved only; an exported run can't be): the payroll entry is reversed on the reopen day; what the run accrued is taken back by a negative `accrual` line per person and policy, dated the reopen day and linked to the period (the time-off ledger is append-only); the frozen lines are retired (`deleted_at`). Nothing is edited (CLAUDE.md rule 9).
- **Export:** approved to `exported`, which locks the run; the CSV files are built by the screen from the review (`paySummaryTable`, `payWorkweekTable`), and no bank or Social Security data exists to leave (CLAUDE.md rule 14).
- **Exclusions** are audited (`Left out of pay period`, `Brought back into pay period`), unlike the demo, because every business write is (rule 10). Nobody leaves themselves out or brings themselves back; only a person in the run can be left out.

### Bonuses and contractor payments
hr.md has no keys of their own and no screens (edge cases "Bonuses have no entry screen", "Contractor payments are read-only"). Safest option: the routes exist for the next screens, reading needs `hr.payroll.view`, adding and voiding `hr.payroll.approve`, and paying a contractor `hr.payroll.export` (the key that hands pay to the outside world).
- **Bonus:** `POST /bonuses` for a W-2 person who has not left, never one's own, not into an approved or exported run; the person who adds it is its `approvedById` (the column the spec has). It joins the run where its `periodEnd` falls and is paid as wages there, so it posts nothing by itself; the check comes at the run, which its adder may not approve. `POST /bonuses/:id/void` retires a bonus whose run is not approved.
- **Contractor payment:** `POST /contractor-payments` records a payment to make to a 1099 contractor (`approved`), posting nothing; `POST /contractor-payments/:id/pay` with a method moves it to `paid` today and posts; the payer may not be whoever recorded it (unless the Owner). `POST /contractor-payments/:id/void` retires it, reversing a paid one on the void day; a payment paid before the books started (seeded, no entry) is refused, so the books never drift from the record.

### Postings (`packages/shared/src/accounting/payroll-postings.ts`)
- **Approved run** (event `payroll.approved`, source type `pay_period`): debit Wages for the gross pay per home location (`Employee.homeLocationId`, where hr.md says a person's pay counts; null is company-wide), credit Accrued Payroll for the total, dated the period's last day. Bonuses and commission are part of each line's gross, so they are wages. One debit per location, never per person, so the ledger lists no one's pay. The source id is a UUID v5 of the period id and `approved_at`, unique per approval, because the ledger keeps one entry per source and event and a reopened run can be approved again; the reopen recomputes it from the stored `approved_at` to reverse it.
- **Contractor payment paid** (event `contractor_payment.paid`, source type `contractor_payment`): debit **Contract Labor** (new default account `contract_labor`, 6050, expense), credit the bank account for the method (`cashAccountFor`, read with `loadAccountingForPosting`, ADR 0040). A void reverses it into the account it came from.
- **No employer taxes:** hr.md "Purpose" leaves taxes and net pay to the payroll provider and the country pack has no payroll tax rules, so none are posted. Gross pay stays an estimate (`GROSS_PAY_LABEL`).

### Sensitive data and audit
- Pay rates (`payRate`, `baseRate`, `regularRate`, `salaryAmount`) were already in `SENSITIVE_FIELDS` under `hr.employee.view_sensitive`, so the global interceptor strips them from reviews and lines for the Accountant. Gross pay and the other line amounts need `hr.payroll.view`, which every payroll route requires; they are not added to `SENSITIVE_FIELDS`, because the portal will show people their own pay.
- No audit entry carries an amount: runs record status and head count, bonuses kind, dates and reason, contractor payments date, description, status and method.

### Seed
Summit's four pay periods (two exported with 16 frozen lines each, one in review, one open), their exclusions, two bonuses and three contractor payments are seeded from the fixtures, and the 54 accrual lines are linked to their periods (also on a database seeded before this part). Seeded history posts no journal entry.

### Web
`listPayPeriods` (open, then list), `reviewPayPeriod`, `setPayExclusion`, `approvePayPeriod`, `reopenPayPeriod` and `exportPayPeriod` go to the API in api mode; `list("payPeriods" | "bonuses" | "contractorPayments")` too. The Pay periods page already reads one source per view (the list and the review, which carries the contractor payments), so no `payrollData()` was added; bonuses and contractor payments get screens later.

## Residual risks
- **Commission waits for its own task:** the API's lines carry commission `0.00`, and approval is refused while an approved commission statement for someone in the run has no pay period. Seeded statements are all paid, so Summit's runs approve.
- **Base rate on a frozen line is kept to the cent:** `pay_period_lines.base_rate` is `numeric(14,2)` while hr.md says four decimals; the money on the line was computed with the full rate, and the workweek rates in `weeks` keep four decimals. Widening the column needs an owner-approved migration.
- **Accrued Payroll is not cleared on the API:** the payroll provider pays net pay and taxes from the bank outside the app. Until a payroll payment is recorded, Accrued Payroll grows with each run; a payroll expense entered by hand would also debit Wages (`EXPENSE_ACCOUNTS.payroll`), so the accountant must clear Accrued Payroll instead. A question for the accountant.
- **Contract Labor and approval accounting:** an approved contractor payment is not in the books until it is paid (no accrual). The accountant may prefer it as a payable when approved.
- **An external accountant can't pay contractors** without a linked employee record; the Owner (or a linked HR manager) pays. This follows ADR 0046's linked-decider rule.
- **Payroll postings are dated the period's end:** a run can't be approved or reopened into a closed accounting period (409 `period_closed`); reopen the books first.
- **Collusion** still defeats separation of duties (ADR 0046).

## Consequences
- Pay periods leave the demo client in api mode; the employee portal's pay view and commissions stay on the demo until their tasks.
- Contract Labor (6050) appears in the chart; LedgerService creates it on first use in existing companies.
