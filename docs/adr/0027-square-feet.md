# ADR 0027: Square feet is the one unit, cartons are a hint

Date: 2026-11-10. Status: accepted.

## Context
Client note 2 asks for the whole system in square feet with cartons beside it or on hover. Boxed goods were sold in cartons and carpet in square yards, with an area-unit setting choosing what lists showed first.

## Decision
- **Products and lines.** Every area good has `unit: sq_ft` with price and cost per sq ft. `sqFtPerCarton` stays as packaging data and is copied to each document line when it is written, so a later change of pack size never rewrites an old document.
- **Whole cartons (plan N-2).** Quotes, invoices and purchase orders round a boxed line up to whole cartons: 500 sq ft of a 23.64 sq ft carton is 22 cartons, 520.08 sq ft. The customer is billed for what ships. The screens do the rounding; the API refuses a part carton rather than round it (2026-11-20, whole-product check F-m).
- **Stock.** The ledger stores boxed goods in sq ft (CLAUDE.md rule 4), always a whole number of cartons; items stay in items; rolls stay in ft of length with area shown first.
- **Input.** `parseAreaEntry` reads "500" as sq ft and "22c", "22 ctn" or "22 cartons" as cartons, through one `AreaQuantityInput`. `CartonHint` is the one way to show the equivalent.
- **Seed.** Prices are regenerated at cents per sq ft. Rounding the old carton prices would have changed 544 of 763 seeded area invoice lines, so the seed itself changed instead (plan K-2), and the random draws stayed the same.
- **Imports** still accept sq yd and cartons and convert them (plan A-2).
- The internal conversion helpers stay, as the spec asks.

## Consequences
- The real build stores `sq_ft_per_carton` on document lines and quantities in sq ft.
- Showing a price per carton is now a derived figure only.
