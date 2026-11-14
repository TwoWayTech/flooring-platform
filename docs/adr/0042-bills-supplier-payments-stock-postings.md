# ADR 0042: Bills, supplier payments and stock postings (P12 part 3)

- **Status:** accepted, 2026-11-14
- **Context:** purchasing.md describes bills for received goods, supplier payments with proof, approval and void, and derived bill balances. Purchasing part 1 (ADR 0036) put orders and receipts on the API but left bills and payments on the demo, because they post. ADR 0039 gave the ledger, ADR 0040 the bank accounts and average cost, and ADR 0041 the pay-later expense bill.

## Decision
- **Postings** (`packages/shared/src/accounting/stock-postings.ts`), with two new default accounts, Goods Received Not Billed (2050, liability) and Inventory Adjustments (5100, expense):
  - **Goods received:** debit Inventory at each warehouse for the received value at the order's cost (damaged units excluded); credit Goods Received Not Billed. Posted on the company's day of the receipt.
  - **Bill entered:** debit Goods Received Not Billed for the received value it covers; credit Accounts Payable for the bill's total; the difference (the match issue) moves Inventory. A question for the accountant: a purchase price variance account instead.
  - **Supplier payment confirmed:** debit Accounts Payable; credit the bank for its method (`cashAccountFor`, read under the settings lock). A void posts the reversal on the void day, so it credits back the same bank.
  - **Stock count correction:** the change at cost (a roll by its own cost per sq ft, boxed goods by the product's average cost) between Inventory and Inventory Adjustments.
  - **Cost of goods:** `costOfGoodsPosting` (COGS at the selling location, Inventory at the warehouse) is ready; it posts when stock is cut or issued, which arrives with inventory part 2.
  - Bills raised by a pay-later expense (ADR 0041) or a contract billing never post as bills: their own documents posted the payable.
- **Average cost:** a receipt moves a boxed product's cost to the moving average of what is on hand and what arrives at the order's cost. Rolls keep their own cost per sq ft.
- **Routes** (`modules/purchasing`, `purchasing.orders` switch): `GET /bills` (`purchasing.bill.view`); `GET /supplier-payments` (`purchasing.bill.view` or a payment key); `POST /purchase-orders/:id/bills` (`purchasing.bill.create`), every unbilled receipt of the order, the supplier's invoice required, match issues stored; `POST /supplier-payments` (`purchasing.payment.record`) with proof, allocated oldest due first up to each bill's unpaid amount (pending payments count against it); `POST /supplier-payments/:id/review` (`purchasing.payment.approve`, never the recorder); `POST /supplier-payments/:id/void` (`purchasing.payment.void`).
- **Locks:** a payment locks every bill row it may pay `FOR UPDATE`, and an expense void locks its bill row the same way, so neither acts on a balance the other is changing. Bills are entered under a company lock, so an order's receipts go on one bill only. Payment numbers are taken under a lock.
- **Data scope:** none, as purchasing part 1 (purchasing.md "Who uses it").
- **Files:** a bill's invoice and a payment's proof are stored like payment proof (ADR 0038) and read through `GET /files/:id` with the purchasing keys.
- **Web:** `purchasingData()` returns bills and supplier payments from the API; the payments queue reads suppliers, bills and supplier payments through it, so every id comes from one source.

## Consequences
- Seeded bills and payments have no journal entries (the ledger starts at go-live). Subcontract bills and the payments that pay them wait for the contracts module.
- Inventory part 2 posts cost of goods with `costOfGoodsPosting` at the average cost when stock is cut or issued, and must read the settings for the costing method.
