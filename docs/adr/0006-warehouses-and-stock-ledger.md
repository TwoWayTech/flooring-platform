# ADR 0006: Warehouses, showrooms and a stock ledger

Date: 2026-11-08. Status: accepted.

## Context
Feature batch 2, item A1 (docs/specs/feature-batch-02.md): stock lives in warehouses, showrooms only display samples, stock moves between warehouses on a transfer document, and quotes, invoices and purchase orders say which warehouse they ship from or receive into. Until now a product stored one `cartonsOnHand` number and a roll stored a free-text warehouse name. Companies also have branches, which drive data scope and the branch limit.

## Decision
- New collection `locations`: `{ kind: warehouse | showroom, branchId, address, isDefault, displaySamples }`. Branches stay for data scope and limits; each location belongs to one (plan K-4). Summit's branches are now Denver and Colorado Springs, Keystone's Harrisburg and Lancaster.
- Boxed stock (cartons and items) is a ledger: `stockMovements` with a signed quantity, a kind (opening, receipt, issue, transfer in or out, adjustment, return) and the source document. On hand at a warehouse is the sum of its movements (`boxedStock` in `packages/shared/src/stock.ts`); `Product.cartonsOnHand` is gone. Rolls carry `locationId` and a `transferId` while travelling; their length stays on the roll with its cuts.
- `transfers` move stock between two warehouses: boxed stock leaves the sender when the transfer starts (In transit) and arrives when it is received; a roll moves whole and cannot be cut while travelling. Moving a roll's bin stays a simple move; another warehouse needs a transfer (plan K-11).
- Quotes and invoices carry `locationId` (Fulfilled from), purchase orders `locationId` (Receive into). New documents start from the person's default warehouse (`User.defaultLocationId`, set in Your profile), then the company default.
- Lists and reports get a warehouse column or filter; reports filter by warehouse instead of branch.
- Fixtures: the stock builder turns the catalog's counted cartons into opening movements split between the two warehouses, adds two received transfers and one in transit, without drawing new random numbers, so every earlier record stays the same. Saved version 1 data is upgraded (roll warehouse names map to warehouses, saved carton counts become receipts, old branch id renamed).

## Consequences
- Stock by warehouse is checked in the reconciliation test: never negative, never in a showroom, transfers balance, every roll in a warehouse.
- Batch C adds issues (invoices), adjustments and reservations to the same ledger; batch D adds receipts per goods receipt.
- The permission `settings.locations.manage` belongs to the Core module, so the HR Suite has no warehouses page.
