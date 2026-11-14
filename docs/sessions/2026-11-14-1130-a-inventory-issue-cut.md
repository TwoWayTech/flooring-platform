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
