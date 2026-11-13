# 2026-11-14, Person A: P11 purchasing, part 1

## Goal
Owner's second work queue (2026-11-13), task 4: P11 purchasing from docs/product-spec/purchasing.md. The module moves from demo data to the real API: API with guards and audit, its web screens in API_METHODS, and tests (API, Playwright api mode, and the company-isolation check).

## Prompt used
The owner's work queue of 2026-11-13 (second), task 4, with blueprint prompt P11 and docs/product-spec/purchasing.md.

## Plan
The company schema already holds every purchasing table, so no migration is needed.

**Split (safest option, recorded in the blueprint delta).** Bills and supplier payments are financial events: CLAUDE.md rule 10 says each posts a balanced journal entry through LedgerService, which arrives with P12 (task 6). They move there. This part covers the directory, orders and receipts:
1. **Seed:** Summit's suppliers, contacts, purchase orders with their lines, and goods receipts with their lines, with the seed's deterministic ids. The products' `supplier_id` is filled in now that suppliers exist.
2. **API, `modules/purchasing`:**
   - **Suppliers:** `GET /suppliers` (`purchasing.supplier.view`); `POST /suppliers` and `PUT /suppliers/:id` (create or edit); `POST /suppliers/:id/status`.
   - **Contacts:** `GET /supplier-contacts`, `POST` and `PUT /supplier-contacts`, and status. One primary per supplier, as ADR 0022 says.
   - **Purchase orders:** `GET /purchase-orders` (`purchasing.order.view`); `POST /purchase-orders` (`purchasing.order.create`), as a draft or ordered; `POST /purchase-orders/:id/order`; `POST /purchase-orders/:id/cancel`.
   - **Receipts:** `GET /receipts` (`purchasing.order.view`); `POST /purchase-orders/:id/receipts` (`purchasing.order.receive`). It uses the shared `receiptProblem` and `receiptStock`, writes the stock movements and rolls, and runs under the same per-company stock lock as inventory.
   - **Money fields:** order totals and line costs follow the spec. `unitCost` is stripped without `inventory.product.view_sensitive`, and the order `total` is removed unless the person holds that key or `purchasing.bill.view`.
   - **Audit and email:** every write is audited. A placed order emails the rep through NotificationService (`po.sent`) where the catalogue has it.
3. **Web:** `purchasingData()` for the Purchasing page. The directory, order and receipt methods go into API_METHODS. Bills and payments stay on the demo until task 6.
4. **Tests:** API integration tests and a Playwright api-mode test.
5. **Docs:** ADR 0036, the API contract, the blueprint delta and STATUS.

## What was built
As planned; see ADR 0036 and PR #13. The stock lock moved to `apps/api/src/modules/inventory/stock-lock.ts`. The sensitive-field interceptor gained a per-route rule, `@SensitiveFieldKeys` (handler level only), for the supplier credit limit.

## Reviews
- **Schema review:** no blocking findings. The should-fix items are done:
  - stale text;
  - stable seed times and authors;
  - explicit contact columns;
  - the PO number lock;
  - an audited primary handover.
- **First security review:** 2 blocking.
  - One receipt could list the same order line many times.
  - Roll lengths were not bounded by what arrived.

  Both are fixed in the shared `receiptProblem`, which the demo now uses too.
- **Second security review:** 1 blocking. Supplier credit was hidden by the customer key, so Purchasing edits wiped it. Fixed with the per-route keys, writes ignored when hidden, and the form omitting it.
- **Third security review:** no blocking findings. Its follow-ups are in STATUS.

## Commands run and results
- `pnpm lint`, `pnpm typecheck` and `pnpm format:check` pass.
- API vitest passes: 213 at the first full run, then the purchasing and access-rule suites again after each fix.
- Shared purchasing tests pass, and so does the seed test (6).
- Playwright api mode runs in CI.

## What is left
- Bills and supplier payments move with P12 (task 6).
- Inventory part 2 moves with sales (task 5).
- Follow-ups are in STATUS.

## Next prompt
"/resume. Continue the owner's second work queue with task 5, P11 sales with the tax engine and inventory part 2."
