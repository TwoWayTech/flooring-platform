# ADR 0048: Commissions on the API (plans, assignments, statements, adjustments) and how they reach payroll

- **Status:** accepted, 2026-11-14
- **Context:** commissions.md describes plans with tiers, override, draw and clawback; assignments with a simulated signature; monthly statements derived from confirmed payments by one engine (`commissionLines`, `statementChain`); approval by HR; adjustments and reversal decisions; and payment through the next pay run (hr.md rule 19). The schema exists (`commission_plans`, `commission_assignments`, `commission_statements`, `commission_adjustments`; ADR 0025). ADR 0047 put pay runs on the API with commission at `0.00` and refused approval while an approved, unpaid statement waited. ADR 0043 put the invoice commission split on the API. Every financial event posts a balanced entry (CLAUDE.md rule 10); commission is pay (rule 5).

## Decision

### Routes, keys, switches and scope
- **HR → Commissions** (module `hr`, switch `hr.commissions`; keys exactly commissions.md "Who uses it"): `GET /commissions` (`hr.commission.view`) returns the statements of the last twelve months, every plan version, assignments, the company's members by name and invoice numbers in one answer (the screen used to read Users and Invoices, which HR can't); `POST /commission-statements/approve` and `POST /commission-reversals/decide` (`hr.commission.approve`); `POST /commission-adjustments` (`hr.commission.adjust`); `POST /commission-plans`, `PUT /commission-plans/:id` and `POST /commission-assignments` (`hr.commission.manage`). docs/api-contract.md, "Commissions".
- **Flooring Suite only:** commission is paid on sales, which live in `core`; the HR Suite has no Commissions page (commissions.md "Purpose"), so a company without `core` gets 404, as does a switched-off `hr.commissions`.
- **Company-wide:** every HR commission route needs data scope `all`, as payroll does (`requireCompanyWidePayroll`): commission is pay and the default holders (Owner, HR manager) are company-wide; a custom role at branch scope gets 403. The spec does not narrow `listCommissionStatements` by scope, which is only safe for company-wide viewers. A rep reads their own statements and signs their plan in the employee portal, which moves to the API in its own task.
- **Sales → Team:** `GET /commission-totals?from&to` (module `core`, switch `sales.team`, `sales.commission.view`): per person earned, paid and pending in the range (`commissionTotals`); data scope `all` sees everyone, anyone else themselves and the reps on the invoices their scope covers (commissions.md "Who uses it").
- **The commission split** stays where ADR 0043 put it (`PUT /invoices/:id/commission-split`).

### One engine
- The API loads plans, assignments, invoices (with cost, never sent on), payments, credit applied, the manager chain (user → linked employee → `managerId` → that employee's user), frozen months and decisions, and runs the shared `commissionLines`. Statement rows come from a new shared `commissionStatementRows`, which the demo's `statementRows` now calls too, so both build the same rows. `CommissionStatementRow` moved to packages/shared.
- **Contract invoices** are any invoice (commissions.md rule 19, ADR 0045): the progress invoice's subtotal, cost share and total feed `baseOf`; credit notes are netted by `netInvoice`; a release earns nothing.

### Statements
- **Approve** (`statementApprovalProblem`): the month has ended, the statement is open, no reversal waits for review, and every earlier month (in the twelve-month window) with commission or an adjustment is approved first, so a frozen month's carry is final. Under `PAYROLL_LOCK`, then the stored statement row (if any), then the rep's employee.
- **Approved means frozen** (commissions.md edge case "holds only in part", narrowed): adjustments and reversal decisions go only on months after the person's last approved one (`frozenThrough`), and a new assignment may start only after that month ends. The amount the approval posted is what the statement shows from then on and what the run pays (`postedCommission`); live figures can't drift it.
- **Paying:** a statement that pays something needs the rep's sign-in linked to a W-2 employee, because commission is paid only through a pay run; the expense goes to that employee's home location.
- **Reversal decisions** check that the line is a reversal waiting for review on that very statement (closing the edge case "`decideReversal` does not check the line or month").
- **Adjustments:** `adjustmentProblem`; a deduction names a live invoice that person sold (as rep or in its split).
- **Plans:** `commissionPlanProblem` (name, rates 0 to 100 with up to four decimals, money with two, distinct tier points, a draw amount only with a draw, a clawback window of 0 to 3650 days). A new plan starts today as version 1. A plan is edited in place only while no approved or paid statement exists for a month from its start (safer than the demo's "a user on it has a non-draft statement", which missed managers paid overrides under it); otherwise a new version starts today, the old one retires yesterday, people on it move over unsigned, and an assignment starting later is repointed. Version, status and dates are the server's; the web sends only the terms.
- **Assignments:** `assignmentChanges` ends a running assignment the day before and replaces one starting on or after the new date (soft delete); a disabled or removed member can't be assigned; the plan must be active and already in force on that day.

### Separation of duties
- **Never one's own** (the Owner included, as for own pay facts and bonuses): nobody approves, adjusts or decides on their own statement, puts themselves on a plan, or changes a plan they are on. "Own" is the user, or a user whose linked employee is theirs by link or verified email (`selfCheck`).
- **Not what one shaped** (the Owner exempt, as at pay-run approval): nobody approves a statement they adjusted or decided a reversal on, or one whose month is covered by an assignment they made or whose plan (by assignment or by line) they added or changed (rows they created, or their append-only audit entries), or one with a line on a sale whose live commission split they set.
- **Linked deciders:** every write needs a sign-in linked to a live employee unless it is the Owner's (`requireLinkedDecider`).
- **Pay-run approval** keeps ADR 0047's rules; it no longer refuses waiting statements.

### Postings and payroll (`packages/shared/src/accounting/commission-postings.ts`)
- **Approval** (event `commission.approved`, source type `commission_statement`, source id the statement): debit **Commissions** (new default account `commissions_expense`, 6060, expense) at the rep's home location, credit **Accrued Payroll** for `payable`, dated the month's last day. Zero posts nothing. The memo is `Commission statement CS-<last 8 characters of its id>, <month>`: no name, no amount.
- **Reversals and adjustments** post nothing by themselves: commissions.md nets them into the open month's statement (rule 11), whose `payable` is never negative, so a clawback lowers a later approval and a shortfall carries forward. A posted approval is never reversed, because a statement never returns to draft.
- **The pay run** (ADR 0047) now pays approved statements whose `pay_period_id` is null or this run, for the people paid in it: each pays the amount its approval posted, which joins `commissionPay` and gross pay, with the statements' lines allocated to their workweeks for the overtime true-up (`commissionAllocations`, hr.md rule 18). Approval links them (`pay_period_id`), a reopen releases them, an export marks them `paid`; each step is audited without an amount. Someone left out of the run keeps theirs waiting.
- **No double posting:** `payrollPosting` debits Wages for each line's gross pay minus its `commissionPay` (never below zero), because the commission is already in Accrued Payroll. Accrued Payroll therefore ends at the full gross the provider pays; Wages carries wages, bonuses and the overtime true-up, Commissions carries commission. A reopen reverses the payroll entry only; the commission stays accrued for the next approval.
- **Concurrency:** statement approvals, adjustments, decisions, plan saves and assignments take `PAYROLL_LOCK` first, as pay-run approval and reopen do, so a run never reads a statement half-approved and a statement never changes while being approved.

### Sensitive data and audit
- **Margin base:** on a gross margin plan a line's `base` is margin dollars (from the sensitive invoice cost), so `GET /commissions` sends it as `null` without `sales.margin.view_sensitive` (`hideMarginBase`), closing commissions.md edge case "Base is not masked for HR". The screen shows "Hidden". Invoice cost and margin percent are never sent.
- **No amounts in the log:** approval, adjustment (addition or deduction only), decisions, plans' terms, assignments (`ownTarget` true or false, never the figure) and pay-run steps.
- **Notification:** `commission.ready` to the rep after commit, restricted, with no amounts; a failure never undoes the approval.

### Seed
Summit's three plans, four assignments with their signatures, 40 statements (all paid, ten pointing at the seeded run that paid them) and its adjustments (none in the fixtures) are seeded from the fixtures. Seeded history posts no journal entry.

### Web
`commissionData` (one source for HR → Commissions), `listCommissionStatements`, `approveStatement`, `addCommissionAdjustment`, `decideReversal`, `saveCommissionPlan`, `assignPlan` and `teamCommission` go to the API in api mode. `acknowledgePlan`, `issueCreditNote` (already on the API) and My commission stay as they are; signing moves with the portal.

### First security review of PR #27
- **Margin base on split sales:** the first split member's plan sets an invoice's base for everyone in the split, so each line records the `basis` that produced its base, and override and reversal lines carry it on. `hideMarginBase` hides by that basis, not the line's own plan, so a paid revenue co-rep's share of a margin sale (and its override and reversals) shows no margin dollars. Credit-note reversals work out the fall in the base on that basis too.
- **Shaping, widened:** a "Changed commission split" audit entry on an invoice in the statement counts as setting its split, so setting and then clearing one no longer slips past; so does setting the manager (`managerId`, read from "Added employee" and "Edited employee" entries) of the statement's person or of anyone whose override is on it.
- **Managers paid overrides:** nobody changes a plan that pays (or would pay) an override while one of its people reports to them, nor puts their own people on such a plan (the Owner included: it is their own pay).
- **Team totals:** below scope `all`, only lines on invoices the viewer's scope covers count for other reps; the viewer's own lines count whole.
- **Carry:** each person's chain starts at their first line, adjustment or assignment, not at the window's edge, so a deficit or a recoverable draw leaving the twelve-month window still carries. No column stores the carry-out (no schema change in this task); it is derived from the lines and adjustments every time. A stored `carry_out` on `commission_statements`, frozen at approval, is a follow-up (STATUS).
- **Adjustments:** dollars and cents, up to twelve digits, at most 1,000,000.00 either way (`MAX_ADJUSTMENT`).
- **Stranded statements:** the pay-period review lists approved, unpaid statements with something to pay whose rep is no longer linked, is a 1099 contractor or has left (`strandedCommission`); they are never marked paid by themselves.
- **Gross below commission:** a run is refused while someone's gross pay is below the commission it pays (an exempt full-day deduction larger than the salary), naming them and saying what to do (`commissionShortfalls`).
- **MFA:** every `hr.commission.*` key makes MFA mandatory, as the `hr.payroll.*` keys do.
- **Audit:** each assignment a new plan version ends, moves or creates gets its own "Moved commission assignment to new plan version" entry.
- **HR Home:** a 403 from `GET /commissions` reads as no statements, so the dashboard still loads.

## Residual risks
- **Gross clamp at zero:** gross pay never goes below zero, so in a run approved with gross below its commission part of the commission would stay in Accrued Payroll unpaid. Approval now refuses such a run (above); the remaining risk is a run settled outside the app.
- **Derived carry:** until carry-out is stored, an approved month's carry is worked out again from live lines; drift after approval (below) could move a later month's carry-in.
- **Margin is still derivable:** the base is hidden, but commission and the plan's rate are shown, so on a one-tier margin plan base = commission ÷ rate, and with `collected` the margin percent follows. Hiding commission from HR would break their job; a question for the owner.
- **A statement's payable shows to ledger readers:** one Commissions line per statement at the rep's home location. Ledger readers (Owner, Accountant) hold `hr.payroll.view` and see the commission on pay lines anyway.
- **Draws are expensed when approved:** a recoverable draw paid in a short month is booked as commission expense, not as an advance (asset) recovered later. The accountant may prefer an advance account.
- **Postings are dated the month's end:** a statement can't be approved into a closed accounting period (409 `period_closed`); approve before closing the month, or reopen the books.
- **Strict maker-checker:** whoever added a plan can never approve statements under it, so a company needs two HR approvers (or the Owner) per plan's people. Accepted as the task asks.
- **Seeded decisions:** the fixtures' reversal decisions (none today) would name demo line ids, which the API's ids (seed UUIDs) don't match.
- **Drift after approval:** confirmations, voids and credit notes land in the month they happen (rules 2, 9 and 10) and back-dated assignments are refused, so an approved month's lines should not move; if a figure still drifts (say an edited split before the first confirmed payment of an older invoice), the posted amount is what is shown and paid, and the difference is not trued up automatically.
- **Collusion** still defeats separation of duties (ADR 0046).

## Consequences
- Commissions (6060) appears in the chart; LedgerService creates it on first use in existing companies.
- Pay runs on the API pay commission; the approval of a run with waiting statements no longer fails.
- The employee portal (My commission, signing) is the next task; until then `acknowledgePlan` stays on the demo client.
