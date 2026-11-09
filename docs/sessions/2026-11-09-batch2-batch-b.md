# Session 2026-11-09: feature batch 2, Batch A suite and Batch B

## What was done
- The owner approved restarting the tests with low memory use: a production build (`pnpm --filter web build`, `pnpm --filter web start`), 2 Playwright workers (`E2E_WORKERS`, default 2 in `playwright.config.ts`, local server is now `pnpm start`), specs in chunks, one server at a time, stopped afterwards. A dev server left from the last session (1.3 GB) and a leftover Playwright browser were stopped.
- Batch A full suite: 222 of 222 green (fab831d). `number-format.spec` waits for the search to reach the address before hovering.
- Batch B, each item committed and pushed to `main`:

| Item | Commit | What |
| --- | --- | --- |
| B1 | de01fd9 | Quote statuses Draft / Pending / Accepted / Converted / Declined, Expired derived; Save as draft, Send with full validation, Accept, Decline; list columns; dashboard Pending quotes. Saved data schema v3. ADR 0012. |
| B2 | 48de3d1, 14394bb, 0d51251, a68ec0e | Appendix A: ledger-derived status and balance; Record payment with mandatory proof (IndexedDB), approval, Payments section; corrections (void payment, write-off, credit, refund, void invoice, mark sent); Update status menu; timeline; PAID mark and receipt PDF; Payments received report; palette action; presenter step. ADR 0013. |
| B3 | a2df755 | Waste internal: column needs `sales.waste.view`, defaults per category in settings, store refuses changes without it. ADR 0014. |
| B4 | f0b627f | Invoices table: Paid, Remaining, Last payment, Warehouse. |
| B5 | 1ee5ba2 | Receivables Current / Overdue / Due in 7 days; who-owes-what list; aging in Reports; held balances (`dueAt` null); healthy seed receivables. |
| B6 | 84d63e2 | Job sign-off releases the held balance, marks sent, notifies payment recorders; Create invoice from this job. |
| suite | b7a7299 | Batch B: 244 of 244. |

## Tests changed on purpose
- `number-format.spec.ts`: waits for the URL before hovering (race on the faster build); reads Balance due from the printed invoice (the Payments section shows it too).
- `customers.spec.ts`: the aging bar moved to Reports (B5); checks the new Receivables figures.
- `customers-picker.spec.ts`: a new quote saves with Save as draft (B1).

## Decisions
- Overlay schema is version 3; `upgradeOverlay` runs the steps of every version after the saved one, and `CompanyDb` upgrades older data under the current key too.
- Fixture changes avoid new random draws where possible. B5 tuned outcome probabilities: late invoices are mostly (90 %) paid, so about 13 % of the open balance is overdue and under 2 % is over 90 days; no invoice total changed.
- Left for later: editing invoice lines before the first confirmed payment (plan K-6) is not built yet; invoices stay as issued. A fixture job without an invoice (to show Create invoice from this job) comes with Batch H fixtures.

## Next
C1, then C2, C3 and the Batch C suite (see STATUS.md).
