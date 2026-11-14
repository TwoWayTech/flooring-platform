# Session 2026-11-14 10:30, A (Claude): P12 part 2, expenses

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
