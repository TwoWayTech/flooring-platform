# 2026-11-13, Person A: P11 inventory, part 1

## Goal
Owner's second work queue (2026-11-13), task 3: P11 inventory from docs/product-spec/inventory.md. The module moves from demo data to the real API: schema, API with guards and audit, its web screens in API_METHODS, and tests (API, Playwright api mode, and the company-isolation check).

## Prompt used
The owner's work queue of 2026-11-13 (second), task 3, with blueprint prompt P11 and docs/product-spec/inventory.md.

## Plan
The company schema already holds every inventory table (P9 mapped them from docs/data-model.md), so no migration is needed.

**Split (safest option, recorded in the blueprint delta).** Reservations, the cut or issue of reserved stock, Ready to cut and the quick invoice from Cut roll all start from an invoice and its confirmed payment. Invoices move in task 5 (sales). Until then they stay on the demo. This part covers everything that does not need an invoice:
1. **Seed:** Summit's catalog goes into its company database with the same deterministic ids as the rest of the seed (`seedId`): products, rolls with their cuts, the boxed-stock ledger, and transfers with their lines. Product suppliers are left empty until purchasing seeds them (task 4).
2. **API, `modules/inventory`:**
   - `GET /products` (`inventory.product.view`); cost is stripped without `inventory.product.view_sensitive`, as for every response;
   - `GET /rolls` with their cuts (`inventory.roll.view`; `costPerSqFt` is stripped);
   - `GET /stock-movements` (`inventory.product.view`);
   - `GET /locations` (any member, because every module picks a warehouse);
   - `GET /transfers` (`inventory.transfer.view`);
   - `POST /transfers` (`inventory.transfer.create`) and `POST /transfers/:id/receive` (`inventory.transfer.receive`), using the shared `validateTransfer`, `startTransfer` and `receiveTransfer`, numbered under a lock;
   - `PATCH /rolls/:id` (`inventory.roll.edit`): the bin only (`assertRollEditOnly`);
   - `POST /stock/corrections` (`inventory.stock.correct`, Owner only by default): the demo's rule, written as an approved count adjustment with its movement or roll cut.

   Every write is audited in the same transaction.
3. **Web:**
   - **`inventoryData()`:** a new ApiClient method gives the Inventory page and the roll page their products, rolls, ledger, locations and transfers. Other screens keep `list(...)` from the demo until their modules move, as Settings did in task 2.
   - **API_METHODS:** gains `createTransfer`, `receiveTransfer` and `correctStockCount`, plus `moveRoll`, which replaces the generic save behind Move roll.
   - **Holds in api mode:** reservations and holds stay empty until sales moves.
4. **Tests:** API integration tests (stripping, transfers end to end, refusals, correction, bin-only edits, audit, isolation); a Playwright api-mode test of the Inventory page; unit tests where rules are new.
5. **Docs:** ADR 0035, the API contract, the blueprint delta and STATUS.

## What was built
As planned; see ADR 0035 and PR #12. `Actor`, `actorOf` and `parse` moved to `apps/api/src/core/access/request-actor.ts`, so modules share them.

## Reviews
- **Schema review:** no blocking findings. The should-fix items are done:
  - UTC fixture times;
  - the seed comment;
  - the data-model rows;
  - roll count checks;
  - a test for a count above the books;
  - soft-delete filters when loading by id.
- **First security review:** 1 blocking. Splitting a product over several transfer lines could overspend stock. Fixed in the shared `validateTransfer` (lines are added up per product), with roll-line checks and correction guards.
- **Security re-review:** no blocking findings. Its follow-ups are in STATUS.

## Commands run and results
- `pnpm lint`, `pnpm typecheck` and `pnpm format:check` pass.
- The shared tests pass: 357, plus the new transfer rule cases.
- The API tests pass: 207, plus the follow-up inventory cases (`inventory.int.test.ts`, 8).
- The seed test passes: 5.
- The web's vitest passes: 13.
- Playwright in api mode runs in CI.

## What is left
- Inventory part 2 moves with sales (task 5): reservations, cut or issue, Ready to cut, and the quick invoice from Cut roll.
- The follow-ups are in STATUS under "PR #12 reviews".

## Next prompt
"/resume. Continue the owner's second work queue with task 4, P11 purchasing."
