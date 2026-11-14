# Session 2026-11-14 08:20, A (Claude): accounting settings (ADR 0040)

The owner's queue of 2026-11-14 starts here: finish `feat/ledger-accounting-settings`, review it, self-merge, then P12 part 2, P12 part 3 and inventory part 2, then contracts, HR with commissions and the employee portal, and meetings.

## Prompt used
"/resume", then the owner: finish `feat/ledger-accounting-settings` (ADR 0040), review it, open the PR, update STATUS and BRANCHES including the stale PR #16 entry, write the session log and self-merge under the CLAUDE.md rule; bring main in first so it has #17. Then continue the queue without stopping.

## Plan
The branch was built in the previous session and not handed off (no log, no PR). This session:
1. Merge main (PR #17 and #18) into the branch.
2. Check that ADR 0040 is complete; run lint, typecheck, unit and API tests.
3. Security review (money, the ledger, permissions), fix what blocks.
4. PR #19, STATUS, BRANCHES, this log; mark ready, CI, self-merge.

## What the branch does (ADR 0040)
- `accounting` settings group: `costingMethod` (`average` only), `salesTaxBasis` (`accrual` or `cash`), `bankAccounts`. Defaults when never saved: average, accrual, no bank accounts.
- `GET` and `PUT /settings/accounting` with `settings.payments.manage` (MFA). Strict Zod body, so no account number can be stored. Audited.
- Each bank account is its own ledger account (`bank:<uuid>`, code 1010 to 1099). A payment method goes to at most one bank account; an unclaimed method posts to Cash and Bank (1000).
- Payments and refunds post cash to `cashAccountFor(settings, method)`. A payment void credits the account the payment first posted to (`LedgerService.postedCashAccount`).
- A bank account with entries can't be removed (409 `bank_account_in_use`).

## Files changed this session
- Review fixes: `apps/api/src/core/ledger/accounting-settings.ts` (schemas, the settings lock), `ledger.service.ts`, `modules/finance/*` (`company-wide.ts`), `modules/sales/payments.service.ts`, `packages/shared/src/accounting/settings.ts`, company migration 0003 and its tests, ADR 0040, docs/data-model.md.
- `packages/shared/test/access-rules.test.ts`: `costingMethod` is classified as not sensitive (the sensitive-field scan caught the new field name).
- `packages/db/src/seed/company.ts`: Prettier.
- docs/STATUS.md, docs/BRANCHES.md: PRs #16 to #18 merged, the queue of 2026-11-14, this branch.

## Commands run and results
- `pnpm typecheck`: passes. `pnpm lint`: passes after Prettier on the seed.
- `pnpm test`: passes (shared 368, api unit 56, db 11, providers 11, web 13, hooks).
- `pnpm test:api`: 178 of 179 on the first run. The one failure was `auth.int.test.ts` "refuses an unverified user, emails a link…": it waits 50 ms for the verification email, which was too short while 14 files ran at once. Run alone: 24 of 24. `accounting.int.test.ts`: 4 of 4.
- Playwright: none, the branch has no screen.

## Reviews
- **First security review:** 1 blocking, fixed. Retiring a bank account could race a payment in flight: the save's in-use check could not see the payment's uncommitted lines, so a line could land on a soft-deleted account, which hid the cash from the trial balance rows and made the payment impossible to void.
  - Fix: postings read the settings with `loadAccountingForPosting`, under a shared advisory lock that the save takes exclusively.
  - Company migration 0003 adds the `journal_lines_live_account` trigger as the database's check.
  - Its should-fix items are done: stored settings are parsed with the Zod schema (409 `settings_invalid`, never the defaults); a missing ledger account and an entry with no cash line answer 409; tests for a refund to a bank, the MFA refusal and a bad stored row.
- **Schema review:** no blocking findings. Done: the trigger locks the account row `FOR SHARE`, so it waits for a retire in flight; a two-connection race test; the error code is checked; the `accounting` settings group is in docs/data-model.md.
- **Second security review:** no blocking findings. Done: GET and PUT `/settings/accounting` need company-wide data scope (`requireCompanyWide`, shared with the ledger routes), with a 403 test for a branch-scoped role that holds the key; `remove` locks the accounts `FOR UPDATE` before its in-use check; bank names with a run of 6 or more digits are refused (rule 14); the `ledger_account_missing` message no longer shows the internal key; a test that a payment confirmed on review posts to its bank.
- **Third security review:** see PR #19.

## What is left
- The Settings → Accounting screen comes with the Settings module (ADR 0040).
- Done here: `auth.int.test.ts` now waits for the verification email with `vi.waitFor` instead of a fixed 50 ms.

## Next prompt
"/resume. Continue the owner's queue of 2026-11-14: P12 part 2, expenses on the API with recurring drafts and postings (finance-expenses.md)."
