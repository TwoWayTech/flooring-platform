# ADR 0035: Inventory on the API, part 1

- **Status:** accepted, 2026-11-13
- **Context:** the owner's second work queue, task 3: P11 inventory (docs/product-spec/inventory.md).
  - The company schema already holds every inventory table.
  - Half of the module starts from an invoice: reservations, cutting or issuing reserved stock after a confirmed payment, Ready to cut, and the quick invoice from Cut roll. Invoices move with sales (task 5).

## Decision
- **The split:** part 1 moves everything that needs no invoice. Part 2 comes with sales.
- **API (`apps/api/src/modules/inventory`, module `core`):**
  - **Reads:** `GET /products`, `GET /rolls` (with cuts), `GET /stock-movements`, `GET /locations` and `GET /transfers`. Cost (`cost`, `costPerSqFt`) is stripped by the response interceptor for anyone without `inventory.product.view_sensitive`.
  - **Writes:** `POST /transfers`, `POST /transfers/:id/receive`, `PATCH /rolls/:id` (the bin only) and `POST /stock/corrections` (`inventory.stock.correct`, Owner by default).
  - **Rules:** they reuse the shared `validateTransfer`, `startTransfer` and `receiveTransfer`, and port the demo's correction rule.
  - **Locking:** every stock change runs under one advisory lock per company, so two writes can never spend the same stock or take the same number.
  - **Audit:** every write is audited in its own transaction.
- **Seed:** Summit's catalog, rolls, cuts, ledger and transfers are seeded into its company database with the deterministic `seedId`s. Products have no supplier until purchasing seeds suppliers (task 4).
- **Web:**
  - **Reads:** the Inventory and roll pages read through a new ApiClient method, `inventoryData()`, not `list(...)`. Other modules' screens keep their demo lists and ids until they move, as Settings did (ADR 0034).
  - **Writes:** `createTransfer`, `receiveTransfer`, `correctStockCount` and the new `moveRoll` go to the API.
  - **Until sales moves:** reservations, adjustments and holds come back empty in api mode, and a list the person may not see comes back empty, as the demo hides it.

## Consequences
- **Ready to cut is empty in api mode.** Cutting or issuing from an invoice stays on the demo until part 2.
- **Product creation and editing have no screen** (spec: "No screen calls it"), so they are not exposed yet.
- **Mixed data in api mode.** A quote or invoice still shows demo products until sales moves, so its product links do not match the API's ids.
