# 2026-11-21 20:30, A: the dev seed posts opening balances

Branch `feat/db-seed-opening-balances`. ADR 0062. Owner decision 1 (ADR 0061), click-through #13.

## Goal
From the first sign-in, the trial balance balances and each balance-sheet account matches the documents. Settling a seeded document no longer drives Cash, AR or Inventory negative.

## What changed
- `packages/shared/src/accounting/opening-postings.ts`: `openingBalancePosting`. It debits the assets, credits the liabilities, and puts the difference on Opening Balance Equity. New default account `opening_balance_equity` (3900), event `opening_balance.posted`, source `opening_balance`.
- `packages/db/src/seed/opening-balances.ts`: `seedOpening` works out the figures from the fixtures with the screens' shared rules. `seedOpeningBalances` posts the one entry with a stable id, last in `seedCompany`.
- Cash covers everything the seed owes, rounded up to the next $10,000. Summit: $130,000 cash, AR $243,396.38, stock $548,654.55, AP $48,172.83, GRNB $78,758.00, retainage $5,300 / $370, dated 2026-01-07. Harbor: $10,000 cash for approved contractor payments.
- Trial balance sight: a Retainage Payable line counts as a contract posting whatever its source (`CONTRACT_ACCOUNT_KEYS`, `LedgerService.trialBalanceFacts`). `SOURCE_SIGHT.opening_balance = "cost"`.
- Trial balance footnote names the opening entry. Spec reports.md, blueprint-delta row and ADR 0062.

## Tests
- New: `packages/shared/test/opening-postings.test.ts` (unit), `packages/db/test/opening-balances.test.ts` (unit, figures against the shared report rules), `packages/db/test/opening-balances.int.test.ts` (seeded twice: one entry, balanced, AR/AP/Inventory/retainage equal to SQL over the documents, cash covers the debts), `apps/api/test/opening-balances.int.test.ts` (paying a seeded invoice leaves AR non-negative and equal to the remaining balances).
- Updated: `seed.int.test.ts` (one opening entry, not none), `local-seed.int.test.ts` (Harbor's entry), `trial-balance.int.test.ts` (Retainage Payable sight), `trial-balance-sight.test.ts`, `access-rules.test.ts` (two field names classified), the e2e-api trial balance spec (Opening Balance Equity row, footnote), and docs/coverage.md (regenerated).

## Checks run
See the PR body.

## Open questions
- Sales Tax Payable and Accrued Payroll are not opened (ADR 0062 "Left open").
