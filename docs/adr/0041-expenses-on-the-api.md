# ADR 0041: Expenses on the API (P12 part 2)

- **Status:** accepted, 2026-11-14
- **Context:** finance-expenses.md describes the demo's expenses: drafts, the receipt rule, approval above an amount, pay later as a linked bill, voids, and recurring drafts raised whenever someone opens the company. Its journal lines were derived and never stored (rule 16). P12 part 1 (ADR 0039) gave the real build a ledger, and ADR 0040 gave bank accounts per payment method.

## Decision
- **Routes** (`modules/finance`, `core` module, `finance.expenses` switch): `GET /expenses` and `GET /recurring-expenses` (`finance.expense.view`); `POST /expenses` and `PUT /expenses/:id` (`finance.expense.create`); `POST /expenses/:id/review` (`finance.expense.approve`); `POST /expenses/:id/void` (`finance.expense.void`); `POST` and `PUT /recurring-expenses` (`finance.expense.create`). Receipts are read through `GET /files/:id` with `finance.expense.view`.
- **Status rules** as the spec: a draft needs nothing; recording runs `expenseProblem` with every receipt; above the company's approval rule, or when the recorder's data scope is `own`, it waits for a second person (never the recorder); a rejection needs a reason and returns it to draft; a recorded expense is never edited.
- **Postings** (`expensePosting`, packages/shared): confirming debits the category's account (`EXPENSE_ACCOUNTS`) for the cost, tax included, at the expense's location, and credits the method's bank account (`cashAccountFor`, read under the settings lock) or, when paid later, Accounts Payable. A void of a confirmed expense posts the reversal on the void day. A pending expense never posted, so its void posts nothing. A sales tax payment debits Sales Tax Payable; payroll debits Wages.
- **Pay later:** confirming raises a `supplier_bills` row (no purchase order, number = expense number, due by the supplier's terms). The bill posts nothing itself, because the expense already credited Accounts Payable; P12 part 3 must not post bills that an expense raised. A void retires the bill, and is refused while any supplier payment that is not void is allocated to it.
- **Recurring drafts:** a daily pg-boss job (`finance.recurring-expenses`, 11:05 UTC) raises the drafts for every served, writable company in that company's day; saving a template raises what it owes at once. A raised draft has no creator, so it shows "Recurring expense" until a person saves it; the template's creator holds the recorder column meanwhile. Safe to repeat: one draft per template and period, ever. Each raised draft writes an audit entry with no actor and the role "Recurring expense" (`AuditService.recordSystem`).
- **Data scope** (the demo had none): an expense is scoped by its recorder (own) and its location's branch (branch). A company-wide expense has no branch, so only company-wide scope or its recorder sees it.
  - Writes (PR #20 security review): a branch-scoped person records only at a location in their own branch; a company-wide expense, a sales tax payment included, needs company-wide scope. Own scope always waits for a second person.
  - Templates: company-wide scope sees and manages them all; anyone else sees only those at a location in their branch and cannot change them, because a template raises drafts in any branch.
  - Payroll months (seeded or imported) are hidden from anyone without `hr.payroll.view`, in the list, the receipt read and every write, because at a small location they reveal pay (CLAUDE.md rule 5).
- **Receipts:** POST `/expenses` and PUT `/expenses/:id` take the 21 MB proof body, like payments (ADR 0038).
- **Numbers:** `EXP-` plus the highest number plus one, taken under a company-wide lock.
- **Web:** the Expenses tab reads `expensesData()` (expenses, templates, vendors, locations), so every id comes from one source.

## Consequences
- Seeded expenses have no journal entries (the ledger starts at go-live, STATUS "Opening balances"); voiding a seeded confirmed expense posts nothing.
- Settings → Expenses (the approval rule) still saves to the demo in api mode until the Settings module moves; the API reads the `expenses` settings row, which the seed writes.
- In api mode the bill that a pay-later expense raises shows on the Purchasing page once bills move with P12 part 3.
