# 2026-11-21 19:45, A: invoice, payment and receivables click-through fixes

Branch `fix/sales-invoice-click-through`. Closes click-through findings #12, #14, #16, #17, #18, #19, #27 and #36 (docs/click-through-notes.md).

## Goal

Fix what the api-mode click-through found on invoices, payments and receivables.

## What changed

- **#12 proof files.** `ProofFilesField` reads each picked or dropped file's first 16 bytes and checks it with `proofFileProblem` (new in `packages/shared/src/file-types.ts`, the server's rule and words); a refused file is not attached and the reason shows inline. The server check on save is unchanged. `retryToast` (`apps/web/src/lib/api/retry.ts`) offers Try again only when a retry could help: never for a `DemoRuleError` or an API 4xx other than 408 and 429. Used by Record payment, Refund, Supplier payment, `ReasonDialog` and the new `ConfirmDialog`.
- **#14.** Record payment's preview reads "Balance after verification" when the payment will wait (`balanceAfterLabel`).
- **#16, #27.** The invoice summary's figures come from `summaryFigures`: Total, Paid, Credits and Written off when there are some, Remaining. Two to a row at phone width with Remaining on its own row, a row from `sm` up. The live credit notes for the invoice are linked (CR-xxxx).
- **#17.** Cut and Issue on an invoice's Stock panel ask first (`ConfirmDialog`, `stockIssueWords`), naming the formatted length and the roll; the toast formats the length. The Cut roll dialog's toast formats the length too.
- **#18.** Customers and receivables shows an "Over credit limit" pill and an "Over credit limit only" switch, only to viewers who see the credit limit (`overCreditLimit`: a limit of 0 means none was set). No new server field.
- **#19.** Invoices answer `createdAt` (minute, UTC on the API; the demo's credit notes get one too). `customerStatement` orders by day, then recorded time when both lines have one, then billed before settled.
- **#36.** Payments to verify marks the viewer's own payments in the first column and its summary counts only what the viewer may verify, adding how many of their own wait for someone else (`queueSummary`).

## Checks run

- `pnpm --filter @workspace/shared --filter web --filter api typecheck`: passed.
- `pnpm --filter @workspace/shared --filter web --filter api lint`: passed.
- `packages/shared` vitest: 88 files, 1267 tests passed.
- `apps/web` vitest: 82 files, 590 tests passed (after regenerating docs/coverage.md for the new spec).
- `pnpm --filter api test:api test/invoices.int.test.ts --maxWorkers=1`: 16 passed.
- Playwright was not run locally (shared laptop); CI's `e2e` runs the new and changed specs.

## Follow-up (coordinator's answers)

- Ready to cut (`/inventory?view=ready`) asks first too, with the same dialog and words; `stock.spec.ts`, `flows-batch3.spec.ts` and `f1-sales-quote-to-cut.spec.ts` confirm the cut.
- The blueprint-delta row moved to the PR body; docs/blueprint-delta.md is main's.
- #36's explanation accepted: in the click-through the count read 3 of 4, so the Owner's own row was most likely labelled in the Decide column, off-screen to the right at 894 px. The label is now in the first column as well.
