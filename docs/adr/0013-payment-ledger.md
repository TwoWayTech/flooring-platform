# ADR 0013: Invoice status and balance from a payment ledger

Date: 2026-11-09. Status: accepted.

## Context
Feature batch 2, item B2 builds Appendix A: customers' payments with mandatory proof, a two-person check, corrections by reversal, and every screen updating from the same numbers. Invoices stored `status` (open / partial / paid / void) and `paid`, so the balance could drift from the payments, and a new invoice stayed Open forever.

## Decision
- **Nothing that can be derived is stored.** `Invoice` loses `status` and `paid` and keeps lifecycle facts only: `createdBy`, `sentAt` / `sentBy`, `voidedAt` / `voidReason`, `depositPct` (from the quote), and for credit notes `creditForInvoiceId` and `refundedAt` (refunded on the spot, else customer credit).
- `packages/shared/src/ledger.ts` computes each invoice's ledger from the records: confirmed paid, pending, credited, written off, `balance = total − confirmed − credits − write-offs` at full precision (rounded only for display), overpaid, overdue and days overdue, Pending verification, Deposit paid, last payment, the PAID date and whether lines are locked. `invoiceStatus` turns it into the leading status and the labels beside it (Overdue with Partly paid; Deposit paid instead of Partly paid; Pending verification leads, so the status filter finds it). `customerCredit` is overpayments plus open credit notes, less credit applied and refunded.
- New records: `Payment` (PAY-0001 number, kind payment or deposit, date, method cash / check / ACH / card / other, check number, card last 4 only, reference, note, proof `FileMeta[]`, status pending / confirmed / rejected / voided, who recorded, reviewed or voided it and why), `InvoiceAdjustment` (write-off or credit applied, with reason) and `Refund` (customer credit paid back, with proof). File bytes live in a `FileStore` (IndexedDB in the demo, behind an interface so object storage can replace it); records keep only metadata.
- `CompanySettings.payments`: approval on / off with an optional threshold, write-off maximum, payment and refund prefixes. Summit approves payments above $1,000; Keystone confirms at once.
- The web app reads every balance through `lib/sales-ledger.ts` (`loadSalesLedger`), so the invoices list, customers, statement, aging, dashboard and Needs attention agree. Payments, adjustments and refunds follow their invoice's (or customer's) data scope, and the generic `save` refuses all three: they change only through their own store calls.
- `customerStatement` lists invoices, confirmed payments, write-offs, credit notes not refunded and refunds with a running balance that closes at open balances minus credit; credit applied only moves credit the statement already shows.
- Fixtures: every seeded payment gets a number, a reference for its method, a placeholder proof PDF and its recorder (the accountant, else the owner); at Summit the owner confirmed payments above the threshold, and the latest three still wait, so "payments to verify" shows. No random numbers are drawn, so no invoice changed and every invoice's derived state equals its old stored status.
- Saved data (schema version 3): invoices drop `status` and `paid` and gain the lifecycle fields (sent when issued; a void one keeps its date); an older payment becomes a confirmed `EARLIER-` payment.

- Receivables (B5): `receivablesSummary` (current, overdue, due in 7 days) and `customerReceivable` in `packages/shared/src/receivables.ts`. `Invoice.dueAt` may be null: with a deposit and an installation to come, the balance is held until the job is done (B6 sets the date) and counts as current. The generator gives such invoices a due date two weeks after issue, holds those whose job is not signed off, and settles late invoices mostly (90 %) so the seed data looks like a healthy business; the reconciliation test checks under 15 % overdue and under 3 % over 90 days.

## Consequences
- Bills keep a stored `paid` until supplier payments (D3) move them onto the same rules.
- A screen that needs a balance must load the ledger; there is no balance field to read by mistake.
