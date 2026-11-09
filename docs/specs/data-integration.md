# Data integration: connecting a customer's database

Spec for the real build (feature batch 2, G2). The demo shows the screen with a simulated test; nothing here runs in the browser.

## Recommend the simple path first
Most flooring businesses come from QuickBooks, a point-of-sale system or spreadsheets. Ask them to export customers, products, stock, open invoices and open bills to CSV or Excel and use **Data import** (G1). It needs no network access, no credentials and no IT help, it validates every row before anything is written, and each import can be undone. Offer a live connection only when the data is large, changes daily during a long switch-over, or the customer insists on it.

## Architecture
- **Server-side worker.** A queue worker (not the web app) connects, reads, maps and writes. The browser never talks to the customer's database and never sees credentials after they are entered.
- **Engines.** SQL Server, MySQL and PostgreSQL through their standard drivers, TLS required by default.
- **Read-only user.** The setup guide asks for a user with SELECT on the chosen tables only. The connection test checks that the user cannot write (an `INSERT` in a rolled-back transaction must fail) and warns if it can.
- **Credentials.** Sent once over TLS, stored encrypted with a per-tenant key in a managed key service, never logged, never returned by any API (the screen shows "saved" and offers Replace). Rotating or removing them is audited.
- **Network.** Either an IP allowlist (publish the worker's fixed egress addresses) or an SSH tunnel through a bastion host with a key we generate per tenant. No inbound access to our side is needed.

## Mapping
- After a successful test the worker lists tables and views with row counts and a 5-row sample. The admin maps each table to an entity (the import kinds of G1) and its columns to fields, with the same auto-match by name and saved mappings as the wizard.
- The same `planImport` rules as the wizard decide create, update or skip, so a live sync and a file import never disagree. Matching uses the external ID (the source primary key), SKU or email.

## Schedule
- **One-time migration.** A dry run first (counts and errors per table), then the import, kept as import batches with Undo while nothing has changed since.
- **Nightly sync.** Incremental: only rows whose updated-at column is newer than the last successful run (the column is chosen per table; tables without one are read in full and compared by hash). Runs at 2:00 AM in the company's time zone, outside working hours.

## Conflict rules
- The source wins for fields it owns (names, contact details, prices) until the company switches the sync off for that table.
- The app wins for everything people do in it: quotes, payments, reservations, cuts, approvals. A sync never changes a paid invoice, a cut roll or a confirmed payment; such rows are reported, not written.
- Deleted rows in the source are not deleted here; they are flagged for review.

## Logs and alerts
- Every run records start, end, rows read, created, updated, skipped and failed, with the error report as for a file import.
- The company's Owner and the platform admin get a notification when a run fails, when errors exceed 1 % of rows, or when no run succeeded for 48 hours.
- Connection tests and runs are in the audit log with who started them.

## Out of scope for the demo
No connection, no stored host or credentials, no worker. The demo's test checks the fields and answers with an invented sample database.
