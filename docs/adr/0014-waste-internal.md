# ADR 0014: Waste is internal; defaults per product category

Date: 2026-11-09. Status: accepted.

## Context
Feature batch 2, item B3: waste % and waste quantity are for the company only. Sales should not see them by default, the quote builder should apply a default silently, and nothing a customer receives may show waste. Waste defaults were hard-coded in the quote builder (12 % carpet, 10 % porcelain tile, 8 % the rest).

## Decision
- `documents.defaultWastePct` (Settings → Sales and documents) holds the waste % per product category (`WasteCategory`, every category but services), seeded with the old hard-coded values so no quote changes. `defaultWastePct(product, defaults)` in `packages/shared/src/operations/quotes.ts` is the one rule for a new line.
- The quote builder's Waste column appears only with `sales.waste.view` (Owner, Manager, Accountant and Warehouse by default; Sales off, plan B-2). Without it a new line takes the default and the quantity shown is the billed quantity, waste included.
- The store refuses a save that changes waste without `sales.waste.view`: a saved line must keep its waste %, and a new line must carry the category default (`wasteChanged` in `lib/api/demo/permission-rules.ts`).
- Customer documents (invoice screen, print, PDF, receipt) print the billed quantity only; they never had a waste line, and a test now keeps it that way.

## Consequences
- Changing the defaults affects new lines only; saved quotes keep their waste.
