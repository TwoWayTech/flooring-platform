# Session 2026-11-14 09:05, A (Claude): P12 part 2, expenses

The owner's queue of 2026-11-14, task 2. Branch `feat/finance-expenses`, from main at `f643523` (PR #19 merged as `157f8ae`).

## Prompt used
The owner's queue of 2026-11-14: P12 part 2 (expenses), following .claude/commands/feature.md, with no plan mode; open points take the safest option and go to docs/blueprint-delta.md.

## Read first
docs/product-spec/finance-expenses.md (all of it), docs/real-build-plan.md week 14, ADR 0023, 0039, 0040. The blueprint PDF can't be opened on this machine (no PDF reader), so the spec and ADR 0023 stand in for prompt P12.

## Plan
The schema already has `expenses` and `recurring_expenses`; no migration.
1. **Shared:** `expensePosting` and `EXPENSE_ACCOUNTS` (rule 16): debit the category's account for the cost at the expense's location; credit the method's bank (`cashAccountFor`), or Accounts Payable when paid later. A void reverses on the void day. Unit tests.
2. **API** (`modules/finance`, `finance.expenses` switch, `core` module):
   - `GET /expenses`, `GET /recurring-expenses` with `finance.expense.view`.
   - `POST /expenses` (new draft or record) and `PUT /expenses/:id` (save or finish a draft) with `finance.expense.create`; receipts through StorageProvider (owner type `expense`).
   - `POST /expenses/:id/review` with `finance.expense.approve` (never the recorder), `POST /expenses/:id/void` with `finance.expense.void`.
   - `POST /recurring-expenses`, `PUT /recurring-expenses/:id` with `finance.expense.create`.
   - Confirming posts through LedgerService under the settings lock; a pay-later expense raises its linked bill (`supplier_bills`, no PO), which posts nothing of its own, because the expense already credited Accounts Payable.
   - Numbers `EXP-` under a lock. Every write audited.
   - Recurring drafts: a daily job raises them for every serving company in its own day, and saving a template raises what is due at once.
   - Receipts are read through `GET /files/:id` with `finance.expense.view`.
3. **Seed:** Summit's expenses, recurring expenses and the bills their pay-later expenses link to. Seeded receipts have no bytes, so they are not seeded (ADR 0038).
4. **Web:** a `financeData()` client method (expenses, recurring, suppliers, locations), so the Expenses tab reads one source; `saveExpense`, `reviewExpense`, `voidExpense`, `saveRecurringExpense` in API_METHODS.
5. **Tests:** API integration (permissions, two-person rule, receipt rule, approval threshold, ledger balance and reversal, pay-later bill, data scope, recurring drafts), Playwright in api mode.

## Safest options taken (blueprint-delta)
- **Data scope:** spec "Edge cases" says the demo shows every expense to everyone with view. Here an expense is scoped by its recorder (own) and its location's branch (branch); a company-wide expense is visible only with company-wide scope or to its recorder.
- **Void with a waiting supplier payment:** refused, not only a confirmed one (spec edge case).
- **Void of a pending expense:** allowed, posts nothing (it never posted).
- **Future dates:** refused beyond today in the company's day.
- **Finishing a draft:** the finisher becomes the recorder (as the demo), so the two-person rule compares against them.

## What was built
As planned (ADR 0041, PR #20), with the review changes below. Files: `packages/shared/src/accounting/postings.ts` (`expensePosting`, `EXPENSE_ACCOUNTS`); `apps/api/src/modules/finance/expenses.*`, `expense-records.ts`, `recurring-expenses.job.ts`; `apps/api/src/core/access/audit.ts` (`recordSystem`); `apps/api/src/app.ts` (receipt body size); the receipt branch of `/files/:id`; `packages/db/src/seed/company.ts`; `apps/web/src/lib/api` (`expensesData` and the four expense methods) and `expenses-view.tsx`.

## Reviews
- **Test-writer:** found that a draft could not be saved without new files (the payment proof check needs one file). Fixed: `expenseProblem` decides.
- **First security review:** 2 blocking, both fixed.
  - Data scope was not applied to writes: a branch manager could record at another branch's location or company-wide. Fix: `requireWritableAt` (403).
  - `POST` and `PUT /expenses` had the small body limit, so a real receipt got 413. Fix: both are proof routes.
  - Should-fix items, all done: payroll months hidden from anyone without `hr.payroll.view`; templates scoped (writes need company-wide scope); raised drafts audited (`recordSystem`); the bill id in the expense's audit entries; amounts capped at 11 digits so amount plus tax fits; the file count checked again under the row lock; a re-saved draft's audit keeps its earlier values.
- **Second security review:** see PR #20.

## Commands run and results
- `pnpm lint`, `pnpm typecheck`: pass.
- `pnpm test`: shared 372, api unit 56, db 11, providers 11, web 13, hooks: all pass.
- `pnpm test:api`: 195 of 195 before the review fixes; `expenses.int.test.ts` 17 of 17 after them.
- Playwright api mode (`tests/e2e-api/expenses.spec.ts`): could not run locally. The local database's seeded users no longer take the local seed password, so even the existing purchasing spec fails at sign-in. CI seeds a fresh database and runs it.

## What is left
- P12 part 3 must not post bills that an expense raised, and must lock the bill row in both the void check and the supplier payment allocation (review note).
- Settings → Expenses (the approval rule) still saves to the demo in api mode until the Settings module moves.

## Next prompt
"/resume. Continue the owner's queue of 2026-11-14: P12 part 3, supplier bills and payments with receipt, stock and cost-of-goods postings (purchasing.md, ADR 0039 to 0041)."
