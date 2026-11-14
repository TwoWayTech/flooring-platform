# Session 2026-11-14 15:00, A (Claude): contracts part 2, billings and retainage

The owner's queue of 2026-11-14, task 6. Branch `feat/contracts-billing`, from main at `59ce102` (PR #23 merged).

## Read first
docs/product-spec/contracts.md rules 5 to 19 and the edge cases, ADRs 0039 to 0044.

## Plan
- Progress billings, retainage releases and billing voids on the API, raising a customer invoice or a subcontract bill and posting it in the same transaction.
- Two default accounts: Retainage Receivable (1150) and Retainage Payable (2150).
- Seed the billings, contract invoices with their payments, and subcontract bills.
- `postBilling`, `releaseRetainage` and `voidBilling` in API_METHODS.

The build was handed to a general-purpose subagent with a full brief; tests and reviews follow.

## What was built (ADR 0045)
- `packages/shared/src/accounting/contract-postings.ts`, with unit tests that check balance over 500 combinations:
  - customer invoice: AR and Retainage Receivable against Sales and tax;
  - customer release: AR against Retainage Receivable;
  - subcontract bill: Cost of Goods Sold against AP and Retainage Payable;
  - subcontract release: Retainage Payable against AP.
- `apps/api/src/modules/contracts/contract-billing.service.ts`, with routes `POST /contracts/:id/billings`, `POST /contracts/:id/retainage-releases` and `POST /contract-billings/:id/void`.
- `apps/api/src/modules/sales/invoice-writes.ts`: one invoice writer shared by quotes, roll invoices and contracts.
- A sales invoice void, or a credit note, on a contract billing invoice is refused ("void the billing instead").

## Safest options taken (blueprint-delta)
- Subcontracted work posts to Cost of Goods Sold (a question for the accountant).
- Retainage rates come from the server.
- A negative gross is refused.
- Masters take no billing.
- No void on a closed contract.
- A release is allowed on a terminated contract (edge case 4).
- Credit notes are refused on billing invoices.

## Commands run and results
- typecheck, lint: pass. `pnpm test`: shared 385, api 56, db 11, web 13, providers 11.
- `seed.int.test.ts`: 10 of 10.
- contracts, invoices, payables and accounting integration tests: 46 of 46.

## Reviews
- **Test-writer:** 11 tests, no product bugs.
- **First security review:** 2 blocking.
  - Fixed: retainage could outrun the gross when lines carry different rates, so an invoice or bill could go negative and read as refundable customer credit. A negative document is now refused, with an integration test. The billing void also refuses once credit from its invoice was applied or refunded, as the invoice void does.
  - Already done: the API tests were not yet committed when it looked; they were committed in `ccb9924`.
  - Should-fix items done:
    - a contract invoice's cost and line cost are stripped without `contracts.contract.view_sensitive` too (`contractCostShown`);
    - the bill a void deletes gets its own audit entry, with no money;
    - `updatedAt` is set on the billing's document link.
- **Second security review:** see PR #24.
