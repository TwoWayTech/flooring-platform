# ADR 0043: Issuing and cutting held stock, the roll quick invoice and the commission split (inventory part 2)

- **Status:** accepted, 2026-11-14
- **Context:** sales part 2 (ADR 0038) holds stock for an invoice when it is made. inventory.md rules 13 to 18 say when held stock may leave, how a roll is cut (the remnant rule) and how a quick invoice is made from a roll; sales.md rule 39 is the commission split. ADR 0042 left the cost of goods posting for this part.

## Decision
- **`GET /stock-holds`** (`inventory.roll.view` or `inventory.product.view`, `inventory.reservations` switch): every active hold on an invoice that is not void, with only the invoice number, the customer's name and whether confirmed money is in (audit U-03). Warehouse staff see nothing else of sales.
- **`POST /reservations/:id/issue`** (`inventory.roll.cut`): under the customer lock, then the stock lock (the order invoices use).
  - Before confirmed money, it needs `inventory.reservation.override` and a reason of at least 3 characters (the demo store had no minimum).
  - A roll is cut with `cutRoll` (the 12 ft remnant rule); the cut points at the invoice, and a remnant is its own roll in the Remnant rack. Boxed goods leave through an `issue` movement.
  - The cost of goods posts at once (`costOfGoodsPosting`): a roll by its own cost per sq ft, boxed goods by the product's average cost (ADR 0040), sold at the invoice's selling location.
- **Voids:** an invoice whose stock was cut or issued can't be voided; the goods come back only through a return, which a later task adds.
- **`POST /rolls/:id/invoice`** (`sales.invoice.create`): `invoiceFromRoll` priced and taxed like a converted quote, numbered under the invoice lock, posted, and the roll held for it, all under the stock lock so the free length can't be promised twice. The invoice's branch is the creator's, else the customer's rep's.
- **`PUT /invoices/:id/commission-split`** (`hr.commission.manage` or `sales.invoice.edit`): at most two people, each once, each above 0%, 100% in all; locked at the first confirmed payment. Stored in `invoice_commission_splits`, the old rows soft-deleted. Audited.
- **Stock adjustments with approval** (rule 23) are not built: `inventory.adjustments` is off and the Owner's Correct stock count replaces them (plan A-1).
- **Web:** `listStockHolds`, `issueReservation`, `createRollInvoice` and `setCommissionSplit` go to the API in api mode.

## Consequences
- Returns (a credit note that puts goods back) must post the cost back (Inventory against Cost of Goods Sold) when they arrive.
- The commissions module reads the split from `invoice_commission_splits`.
