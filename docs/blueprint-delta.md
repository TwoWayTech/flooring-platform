# Blueprint delta

Changes to the plan in `docs/blueprint/blueprint.pdf` decided after the demo, newest first. `/feature-change` adds a row for every feature added, changed, switched off or removed, so the real build starts from the blueprint plus this log.

| Date | Feature key | Change | Why | ADR | Blueprint section |
| --- | --- | --- | --- | --- | --- |
| 2026-11-08 | `settings.roles` | New permission keys for payments, tax override, waste, commissions, stock, transfers, supplier payments and data import; three keys renamed; Sales no longer records payments by default; every store action re-checks permissions; saved demo data gets a schema version | Feature batch 2 (client notes) | [0005](adr/0005-batch2-groundwork.md) | Four layers of control; Default roles |

