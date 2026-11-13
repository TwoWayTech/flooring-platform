# ADR 0036: Purchasing on the API, part 1

- **Status:** accepted, 2026-11-14
- **Context:**
  - The owner's second work queue, task 4: P11 purchasing (docs/product-spec/purchasing.md).
  - The company schema already holds every purchasing table.
  - Bills and supplier payments are financial events. CLAUDE.md rule 10 says each posts a balanced journal entry through LedgerService, which arrives with P12 (task 6).

## Decision
- **Split:** part 1 moves the supplier directory, purchase orders and goods receipts. Bills, supplier payments and their queue move with the ledger.
- **API (`apps/api/src/modules/purchasing`, module `core`):**
  - **Directory:** suppliers and contacts (list, add, edit, status). The supplier picker's add-on-the-fly needs only a name, with the safe defaults of pay on order and no credit. There is one primary contact per supplier, handed to the oldest active sales rep when the primary leaves (ADR 0022). A supplier with an open order stays active.
  - **Orders:** list, create as a draft or ordered, send a draft, and cancel with a reason. Cancelling is refused once goods have arrived. An order may only receive into a warehouse.
  - **Receipts:** list, and record against an order. It uses the shared `receiptProblem` and `receiptStock`: never more than is still due, damaged units stay out of stock, and broadloom arrives as rolls. Receipts write the stock movements and rolls under the same per-company stock lock as inventory (ADR 0035). A roll number already in stock is refused.
  - **Money:**
    - line costs (`unitCost`) are stripped without `inventory.product.view_sensitive`;
    - the order `total` is removed unless the person holds that key or `purchasing.bill.view`, as the spec says.
  - **Email:** a placed order emails the rep, or the supplier's own address, through NotificationService (`po.sent`). A failure to queue it is logged and never undoes the order.
  - **Audit:** every write is audited in its own transaction.
- **Seed:**
  - Summit's suppliers, contacts, orders and receipts are seeded with the deterministic `seedId`s.
  - Products get their supplier; a database seeded before suppliers is filled in.
- **Web:**
  - The Purchasing page reads through `purchasingData()`.
  - The directory, order and receipt methods are in API_METHODS.
  - Bills and supplier payments come back empty in api mode until P12.

## Consequences
- **Bills tab:** the Bills tab and the payments queue are empty in api mode until P12.
- **Suppliers with bills:** a supplier with an unpaid bill could be deactivated, because bills are not on the server yet. The check comes with P12.
- **Supplier credit limit:** `creditLimit` is reserved for customer credit in `SENSITIVE_FIELDS`. So the supplier routes declare their own rule with `@SensitiveFieldKeys` (handler level only), and show it to holders of `inventory.product.view_sensitive` or `purchasing.bill.view`, as the spec says. A credit limit sent by someone who cannot see it is ignored, so an edit never changes it blind (PR #13 security reviews).
