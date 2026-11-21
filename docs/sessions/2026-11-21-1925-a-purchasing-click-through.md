# 2026-11-21 19:25, A: purchasing click-through fixes

## Goal
Close click-through findings #20 to #25 (Purchasing in api mode at 1280 px), branch `fix/purchasing-click-through`.

## What changed
- #20: `ScrollToTopOnNavigate` (`apps/web/src/components/shell/scroll-to-top.tsx`), mounted in the root providers, so it is app-wide (company app and platform admin). A path change scrolls the window to the top; the first render, back and forward (popstate, the browser restores) and anchor links are left alone. Search-parameter changes (tabs, filters) keep the scroll.
- #21: the orders list's money column is "Not yet billed or unpaid"; the line under the lists reads "$X owed to suppliers on bills.", plus on the orders tab "Owed counts billed amounts only; "Not yet billed or unpaid" also counts goods not billed yet." Labels in `owed-labels.ts`.
- #22: the new order dialog scrolls as a whole (`overflow-y-auto` on the dialog, the lines box `shrink-0` and sideways scroll only). `editableDecimal` (packages/shared `decimal-text.ts`) trims trailing zeros for editing; `AreaQuantityInput` (orders, receipts, quotes, transfers) and the order dialog's starting cost use it.
- #23: the PO panel's lines table has no minimum width, column padding, and the unit wraps under the number instead of running into the next column; it sits in a named `ScrollRegion` ("Order lines").
- #24: `damagedByLine` and `damagedLines` (shared `operations/purchasing.ts`) and `DamagedQuantity` / `DamagedLines` (web). The PO panel shows "1 carton damaged (19.80 sq ft)" under Received and per receipt, the bill form and the bill drawer list damaged lines as "Not billed.". The receive form shows an optional "Damage note" when a line has damage; it is saved in the receipt's existing `note` column (no schema change) and shown on the panel.
- #25: the spec (purchasing.md rule 21) flags differences without blocking and says nothing about holding payment, so this is a warning: the supplier payment sheet shows each chosen flagged bill's match line with "Pay anyway?" and Save stays disabled until "Pay anyway" is ticked. API unchanged.
- Spec purchasing.md rules 21 and the receipt `note` row updated; blueprint-delta row added.

## Checks run
See the PR body for the exact counts.

## Open questions
- Should a flagged bill instead wait for a review (a permission such as `purchasing.bill.approve`) before it can be paid? The spec is silent, so only the warning is built.
- Should the damaged quantity also go into the stored match line on the bill? It is shown beside it instead, so stored text and the API stay as they are.
