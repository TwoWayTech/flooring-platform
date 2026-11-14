# Session 2026-11-14 10:10, A (Claude): P12 part 3, bills, supplier payments and stock postings

The owner's queue of 2026-11-14, task 3. Branch `feat/ledger-bills-supplier-payments`, from main at `1ba1019` (PR #20 merged).

## Prompt used
The owner's queue of 2026-11-14: P12 part 3 (supplier bills and payments, stock and cost-of-goods postings), following .claude/commands/feature.md; open points take the safest option and go to docs/blueprint-delta.md.

## Read first
docs/product-spec/purchasing.md (rules 18 to 34, Bill and SupplierPayment, audit), ADR 0036, 0039, 0040, 0041; the PR #20 review notes (lock the bill row; never post bills an expense raised).

## Plan
The schema already has `supplier_bills`, `bill_receipts`, `payments_made` and `payment_allocations`; no migration.
1. **Shared** (`accounting/stock-postings.ts`): receipt (Inventory per warehouse / Goods Received Not Billed), bill (GRNB for the received value, the difference to Inventory, Accounts Payable for the total), supplier payment (AP / the method's bank), stock correction (Inventory / Inventory Adjustments), cost of goods (COGS / Inventory, posted by inventory part 2), and the moving average cost. Two default accounts: Goods Received Not Billed (2050) and Inventory Adjustments (5100).
2. **API** (`modules/purchasing`):
   - `GET /bills`, `GET /supplier-payments` (`purchasing.bill.view`; payments also with `purchasing.payment.*`).
   - `POST /purchase-orders/:id/bills` (`purchasing.bill.create`): every unbilled receipt of the order, the supplier's invoice as a file, match issues stored; posts.
   - `POST /supplier-payments` (`purchasing.payment.record`) with proof, allocated oldest due first or to chosen bills, up to what is unpaid, each bill row locked; waits for a second person above the payment approval rule; posts when confirmed.
   - `POST /supplier-payments/:id/review` (`purchasing.payment.approve`, never the recorder) and `/void` (`purchasing.payment.void`), the void crediting back the bank it was paid from.
   - Goods receipts post their received value, and boxed goods take the moving average cost; stock corrections post at cost.
   - The expense void locks the bill row before it checks for payments.
3. **Seed:** the rest of Summit's bills and its supplier payments with their allocations (no journal entries: the ledger starts at go-live).
4. **Web:** `purchasingData()` returns bills and supplier payments from the API; `enterBill`, `recordSupplierPayment`, `reviewSupplierPayment`, `voidSupplierPayment` in API_METHODS; the payments queue reads supplier rows from the API.
5. **Tests:** unit (done), API integration, Playwright api mode.

## Safest options taken (blueprint-delta)
- **Price difference on a bill:** posted to Inventory (capitalised), not to a variance account; a question for the accountant.
- **Cost of goods:** the posting rule is here; it is posted when stock is cut or issued, which arrives with inventory part 2.
- **Average cost:** boxed goods keep a moving average on the product; rolls keep their own cost per sq ft.
- **Purchasing data scope:** none, as purchasing part 1 (the spec gives purchasing no scope).
