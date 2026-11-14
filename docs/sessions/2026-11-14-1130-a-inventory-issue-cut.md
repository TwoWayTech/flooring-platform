# Session 2026-11-14 11:30, A (Claude): inventory part 2, issue and cut, quick invoice, commission split

The owner's queue of 2026-11-14, task 4. Branch `feat/inventory-issue-cut`, from main at `3a59524` (PR #21 merged as `881712f`).

## Read first
docs/product-spec/inventory.md rules 13 to 18 and 23, sales.md rule 39, ADR 0038 (reservations), ADR 0042 (cost of goods).

## Plan
No migration: `reservations`, `roll_cuts`, `rolls`, `stock_movements` and `invoice_commission_splits` exist.
1. **`GET /stock-holds`** (`inventory.roll.view` or `inventory.product.view`): active reservations with the invoice number, the customer's name and whether confirmed money is in (rule 14). No sales records beyond those fields (audit U-03).
2. **`POST /reservations/:id/issue`** (`inventory.roll.cut`; `inventory.reservation.override` with a reason before payment, rule 13): cuts the roll with the remnant rule (rules 16, 17) or writes an issue movement, under the stock lock, and posts cost of goods (`costOfGoodsPosting`, ADR 0042) at the roll's own cost or the product's average cost, sold at the invoice's selling location. Audited.
3. **`POST /rolls/:id/invoice`** (`sales.invoice.create`): the quick invoice from a roll (rule 18), priced by the tax engine like a converted quote, posted, and the roll reserved for it.
4. **`PUT /invoices/:id/commission-split`** (`hr.commission.manage` or `sales.invoice.edit`): at most two people, 100% in all, locked after the first confirmed payment (sales rule 39). Audited.
5. **Web:** `listStockHolds`, `issueReservation`, `createRollInvoice`, `setCommissionSplit` in API_METHODS.
6. **Tests:** API integration, Playwright api mode for Ready to cut.

## Safest options taken (blueprint-delta)
- **Stock adjustments with approval** (rule 23) stay hidden: the `inventory.adjustments` switch is off, and the Owner's Correct stock count replaces them (plan A-1). Nothing is built behind a switched-off feature.
- **Override reason:** at least 3 characters on the API too (the demo store had no minimum).
- **Cost of goods on a void:** an invoice whose stock was issued keeps its cost of goods; the goods come back only through a credit note marked as a return (a later task), so voiding such an invoice is refused.

## What was built
As planned (ADR 0043, PR #22). Files:
- `apps/api/src/modules/inventory/stock-issue.{controller,service}.ts`;
- `rollInvoice`, `setCommissionSplit` and the issued-stock check on void in `apps/api/src/modules/sales/invoices.service.ts`, with routes in `invoices.controller.ts`;
- the four web client methods;
- `tests/e2e-api/inventory.spec.ts`, which now opens Ready to cut.

## Reviews
- **Test-writer:** 9 tests, no product bugs. Two changes came from its notes:
  - a missing override permission now answers 403;
  - a roll invoice for a customer with no job site is refused, so tax is never silently nothing (a test checks it).
- **First security review:** 3 blocking, all fixed with tests.
  - `/stock-holds` ignored data scope: an own-scope Sales rep saw every customer and invoice. Now the invoice fields show only within the reader's scope or to people who cut.
  - The commission split took any user id and could drop the rep. Now it takes only active people of the company, keeps the rep unless the caller holds `hr.commission.manage`, and refuses credit notes.
  - A cut that left a remnant stranded the parent roll's other holds, so the remnant could be sold twice. Those holds now move to the remnant.
  - Should-fix items done: in-transit rolls are refused on a roll invoice; the job-site state and ZIP are checked; cost of goods credits the roll's current warehouse; a boxed issue checks on-hand; `validateCut` replaces passing raw errors; the `sales.team`, `inventory.reservations` and `inventory.rolls` switches are checked; the audit says "active".
- **Second security review:** 1 blocking, fixed. The rep could be left a 0.01% share. Now, without `hr.commission.manage`:
  - the rep keeps at least half;
  - nobody but the rep names themselves;
  - a split a commission manager set can't be rewritten or cleared.
  Tests cover all three.
  - Should-fix items done: `convert` and `voidInvoice` take the stock lock before the ledger's shared locks, so the order is the same everywhere (a period close could otherwise deadlock them); a roll invoice needs `inventory.roll.view` too.
- **Third security review:** PASS, no blocking findings. Its two should-fix items were done with the safest option:
  - without `hr.commission.manage`, only the invoice's own rep may set its split, the rep keeps at least half, and a split anyone else created is left alone (checked by `created_by`);
  - roll holds are hidden from `/stock-holds` when `inventory.rolls` is off.
  A test covers the rep-only rule.

## Commands run and results
- `stock-issue.int.test.ts`: 13 of 13 after the review fixes (one run failed in setup while enrolling two MFA users at once; three reruns passed).
- `invoices`, `sales` and `inventory` integration tests: 23 of 23.
- Full lint, typecheck, test and test:api before the review fixes: all pass (API 226, db 31, shared 378).

## What is left
- Returns that put goods back must post the cost back.
- Sales roles hold `inventory.roll.view`, so they can read the holds list; that is the spec's keys as they stand.

## Next prompt
"/resume. Continue the owner's queue of 2026-11-14: contracts (contracts.md, docs/real-build-plan.md week 10)."
