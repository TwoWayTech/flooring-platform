# ADR 0016: Purchase orders, goods receipts, matched bills and supplier payments

Date: 2026-11-09. Status: accepted.

## Context
Feature batch 2, Batch D: purchase orders need drafts and a full status line (D1); goods are received in parts with damaged units, roll numbers and dye lots, and bills are entered only for what arrived, matched and with the supplier's file (D2); suppliers have terms and credit limits, and supplier payments mirror customer payments (D3). Orders stored draft / sent / received / billed, a receive took the whole order, bills stored `paid`, and a bill could only be paid in full.

## Decision
- `PurchaseOrder.status` stores only draft / ordered / cancelled (with `orderedAt`, `cancelledAt`); Partly received, Received, Billed, Partly paid and Paid come from `poState` over receipts, bills and supplier payments. `PoLine.areaSqFt` records the area for goods ordered by area; `cartonsFor` rounds cartons up ("500 sq ft = 17.5, rounded up to 18 cartons"), and broadloom shows the roll length.
- `GoodsReceipt` (GR-0001): per line good and damaged units and the rolls (number, dye lot, length); `receiptProblem` refuses more than is still to come (damaged units stay owed); `receiptStock` writes receipt movements for boxed goods and rolls for broadloom. The one-step receive is gone.
- `Bill` loses `paid` and gains `receiptIds`, `matchIssues` (a total different from `receivedValue` is flagged, not blocked) and `files` (the supplier's invoice). Bills are entered only for unbilled receipts.
- `SupplierPayment` (SP-0001) replaces bill payments: method, reference, mandatory proof, the company's approval rule, void with a reason, and `allocations` over several bills (`allocate`, oldest due first). `billLedger` and `supplierBalance` (owed, overdue, credit used against the limit, next due) are derived; `payablesSummary` gives Current, Overdue and Due in 7 days, and Reports → Payables aging the buckets.
- `Supplier.terms` is `SupplierTerms` (pay on order, cash on delivery, net 30 / 60 / 90 / 180, monthly statement) with `supplierDueDate`, plus `creditLimit`.
- Permissions keep the catalog's keys (plan K-2): `purchasing.order.view / create / receive`, `purchasing.bill.view / create`, `purchasing.payment.record / approve / void`; Warehouse receives by default. The generic save refuses orders, receipts, bills and supplier payments.
- Fixtures keep every random draw in place (payment draws use the old term lengths), add receipts (every fourth received order partly), bills matched to their receipts, numbered supplier payments with placeholder proofs, credit limits, and one product with a 69-character name to test wrapping. Receipts in the fixtures predate the opening stock counts, so they carry no movements of their own.
- Saved data (schema version 3): an order received in an older demo gets one receipt for what it ordered, its bill points at it and drops `paid`, bill payments become confirmed supplier payments, and old supplier terms map to the nearest new one.

## Consequences
- The order line table scrolls inside its own box with a sticky header and totals; names wrap to two lines then truncate with a tooltip.
