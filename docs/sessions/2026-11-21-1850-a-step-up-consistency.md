# Session 2026-11-21 18:50 (A): step-up consistency

- **Goal:** owner's decisions 4 and 6 (ADR 0061) and click-through #47: one step-up rule for every action that moves money, pay or access, listed in ADR 0063; approving and reopening a pay period need a code; loosening expense approval is the Owner's alone with a code; the approved pay period stays chosen.
- **Changed:**
  - API: `PayPeriodsService.approve`/`reopen` require a step-up after every other check (HrModule imports AuthModule). `PUT /settings/expenses`: loosening (`expenseApprovalLoosened`) is Owner-only (403 `owner_only`) with a step-up; tightening needs neither. `PUT /settings/localization/payroll`: a step-up when the overtime rule changes. `POST /ledger/period-close`: a step-up when it reopens (judged under the period lock via a `confirm` callback on `LedgerService.closePeriod`).
  - Shared: `approvalCheckLoosened` (shared by Payments and Expenses), `expenseApprovalLoosened`, `EXPENSE_APPROVAL_OWNER_ONLY`, `overtimeRuleChanged`.
  - Web: Pay periods asks for the code (StepUpDialog) on Approve and Reopen, not when timesheets still block (the server refuses first), and keeps the period chosen. Expense approval and Payroll rules ask only when the server will. DemoStore applies the Owner-only expense rule.
  - Docs: ADR 0063 (rule and inventory), api-contract rows, FEATURES `auth.step-up` row, blueprint-delta row, coverage regenerated.
- **Tests:** shared `expense-controls.test.ts`; web unit `demo-expense-approval.test.ts`; API payroll, settings A17, settings-localization L6, invoices period close, plus step-up setup in commissions and new-company; Playwright api-mode `pay-periods.spec.ts` PP1 and `settings.spec.ts` E3.
- **Checks run:** see the PR body.
- **Open questions:** ADR 0063 "Open questions" (refunds and large write-offs; commission plans and pay rates).
