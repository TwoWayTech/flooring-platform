# ADR 0007: One table behaviour, with the view in the URL

Date: 2026-11-08. Status: accepted.

## Context
Feature batch 2, item A2: every table needs a filter on every column, chips, a result count, Clear filters, filters in the URL, the last view remembered per person, CSV of the filtered rows and totals for money. Tables had one-off filters (an invoice status select, a roll segmented control, a category select, a customer group select, an audit area select), each with its own URL parameter.

## Decision
- `DataTable` is extended in place; no second table component. Each column gets a filter chosen from its values unless the column says otherwise: a range for numbers and money, a date range for ISO dates, a multi-select for at most 15 repeating values, text contains otherwise (`packages/shared/src/table-filters.ts`, unit-tested). Visual columns have none.
- The view (search, sort, filters) lives in the URL under the table's id, for example `sales-invoices.f.state=Overdue` or `sales-invoices.f.total=100..500`, so several tables can share a page and links reproduce a view. `filteredHref` builds such links; "Needs attention" uses it.
- Each person's last view of each table is kept in localStorage (`fp-table-view:<userId>:<tableId>`) and restored when the address has no view for that table.
- Money columns marked `total` get a totals row over the filtered rows; CSV exports the filtered, sorted rows.
- The one-off filters are removed; their meaning moved into columns (roll Type now includes Low and In transit, the customer Certificate column reads Expires soon or Valid). The inventory warehouse select stays as the page filter because it also changes stock figures.
- TanStack Table's automatic page-index reset is turned off: the demo does not paginate, and with derived sort and filter state it re-rendered without end.

## Consequences
- Two e2e tests changed on purpose: the attention links for low rolls and expiring certificates now use the new filter URLs, and the count reads filtered of all rows (3 of 60, 2 of 80).
- The feature switch `shell.tables` turns the column filters off and leaves search, sort and columns.
