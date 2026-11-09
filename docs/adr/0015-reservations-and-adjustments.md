# ADR 0015: Stock is reserved by invoices, cut after payment, and adjusted only with a reason

Date: 2026-11-09. Status: accepted.

## Context
Feature batch 2, Batch C: every stock change needs a source document (C1); an invoice reserves the length or cartons it needs and the physical cut waits for confirmed money (C2, plan C-1); products and rolls show On hand, Reserved and Available with Out of stock and Low stock badges (C3). The demo let anyone with `inventory.roll.cut` cut any length with a free-text reference, and roll records could be saved freely.

## Decision
- New collections. `Reservation`: invoice, line, product, roll (or none for boxed goods), warehouse, quantity in the stock unit, `shortBy`, status active / released / issued, and the override reason when stock left before payment. `StockAdjustment`: ADJ-0001, product or roll, warehouse, signed quantity, reason (damage, count correction, samples, other) and note, status pending / approved / rejected with requester and reviewer.
- `packages/shared/src/reservations.ts` holds the rules: `stockNeed` (sq yd of carpet → ft of roll length, to the nearest hundredth so a length sold comes back the same), `rollAvailable` and `availability` (on hand − active reservations), `stockStatus` (out at zero available, low at the reorder point), `rollsForLength` (enough free length at the warehouse, the chosen dye lot first, the shortest that fits), `planReservations` (the chosen roll, else one roll, else several, else short; boxed goods up to what is free), `mayIssue` (a confirmed payment exists) and `adjustmentNeedsApproval`.
- Invoices reserve when issued: quote conversion, Create invoice from this job, and the quick invoice from Cut roll. Voiding releases. `issueReservation` cuts the roll (remnant rule kept; the cut links the invoice through `RollCut.source`) or writes an issue movement, only after `mayIssue`, otherwise with `inventory.reservation.override` and a reason, audited. A short line issues the invoice anyway and shows "Short by X, not reserved".
- The free `cutRoll` call is gone. Cut roll offers: for an invoice that holds the roll, a new invoice for a length of it (`createRollInvoice`), or, with `inventory.stock.adjust`, an adjustment. `recordAdjustment` applies at once up to `settings.inventory.adjustmentApprovalQty` (Settings → Warehouses → Stock rules, 50 by default) and otherwise waits for `inventory.stock.approve` by someone else (`reviewAdjustment`). The generic `save` refuses reservations and adjustments, and a roll save may change only its bin and labels (`assertRollEditOnly`).
- Fixtures: open invoices of the last three weeks reserve in issue order; Keystone's large distributor orders come out partly short, which purchasing (Batch D) answers.
- The quote builder's carpet lines get a roll picker (rolls at the quote's warehouse with enough free length, same dye lot first); the chosen roll travels on `DocLine.rollId`.

## Consequences
- Returns reversing a cut through a credit note are not in the demo UI yet (credit notes exist only in the fixtures).
- A line spread over several rolls is cut roll by roll from the invoice's Stock panel.
