# Blueprint delta

Changes to the plan in `docs/blueprint/blueprint.pdf` decided after the demo, newest first. `/feature-change` adds a row for every feature added, changed, switched off or removed, so the real build starts from the blueprint plus this log.

| Date | Feature key | Change | Why | ADR | Blueprint section |
| --- | --- | --- | --- | --- | --- |
| 2026-11-08 | `settings.roles`, `admin.access` | One page-permission map; PageGate shows "You don't have access to this page"; default roles get a System badge and Reset to default; Duplicate; the effective access preview is shared with company admins and lists pages, actions and sensitive fields | Feature batch 2, A3 | [0008](adr/0008-page-permissions.md) | Users, roles and super-admin access |
| 2026-11-08 | `shell.tables` | Filter on every column, chips, Clear filters, view in the URL and remembered per person, CSV of filtered rows, totals row; one-off table filters removed | Feature batch 2, A2 | [0007](adr/0007-table-filters-in-the-url.md) | Tables (design brief) |
| 2026-11-08 | `inventory.locations`, `inventory.transfers`, `inventory.products`, `inventory.rolls` | Warehouses and showrooms per branch; boxed stock as a ledger of movements; transfers between warehouses; Fulfilled from / Receive into on quotes, invoices and purchase orders; warehouse filter on inventory and reports; personal default warehouse | Feature batch 2, A1 | [0006](adr/0006-warehouses-and-stock-ledger.md) | Inventory and costing; Branches |
| 2026-11-08 | `settings.roles` | New permission keys for payments, tax override, waste, commissions, stock, transfers, supplier payments and data import; three keys renamed; Sales no longer records payments by default; every store action re-checks permissions; saved demo data gets a schema version | Feature batch 2 (client notes) | [0005](adr/0005-batch2-groundwork.md) | Four layers of control; Default roles |

