# Session 2026-11-09: feature batch 2, Batches F to H, deploy and live run

## What was done
Tests ran on a production build with 2 workers, in three chunks of spec files, one server at a time, stopped after each run.

| Item | Commit | What |
| --- | --- | --- |
| F | 6dacf4f | Meeting buttons are named by their visible time and title (a11y); meetings.spec matches them by pattern. Batch F suite green. |
| G1, G2 | 4fc5be3 | Data import wizard for eight kinds (customers, addresses, suppliers, products, rolls and stock, open invoices, open bills, employees) in Settings and Platform admin → Company; CSV and Excel templates; files read and written in a Web Worker (Papa Parse 5.5.3, SheetJS 0.20.3 from its CDN tarball); columns auto-matched and saved; cells validated by type; dry run with a 50-row preview; import with an error CSV; history with Undo; matching on external ID, SKU or email. Connect a database with a simulated test and nothing stored; docs/specs/data-integration.md. ADR 0019. `CATEGORY_LABELS` moved to shared; `saveBlob` moved to `lib/save-blob.ts`. |
| G suite | 3e1c17c | 283 e2e green in three chunks; 209 unit. |
| H | ed55f2b | Seed data: a signed-off job from an accepted quote with no invoice (J-4041) and four stock adjustments (ADJ-0004 waits for approval), added after every seeded builder so existing records are byte-identical. Job costing moved to shared (`jobCostFrom`, `jobFromInvoice`). Schedule installation on an invoice and Start job on the job card. Reconciliation: payables total, adjustments behind movements, commissions from rules × confirmed payments. Flow 1 (`flows.spec.ts`); flows 2 to 6 tagged `@flow` where they already lived. |
| H docs | 16d2153 | Demo script rewritten for batch 2 and the live addresses; presenter guide adds Stock adjustments, Sales team and Data import (both hosts); README.demo.md: what the demo shows, data import, tests on a production build in parts. Batch H suite: 284 e2e, 213 unit. |
| Deploy | none | `npx vercel deploy --prod`: Ready, aliased to both hosts. The suite against both live addresses: 284 of 284 (195, 43 and 46 in three chunks). |

## Tests changed on purpose
- `stock.spec.ts`: the approval test approves its own adjustment by number, since the seed now has a pending one too, and the attention link may read "adjustments".
- `reconciliation.test.ts`: 40 seeded jobs plus one not invoiced; new checks as listed above.
- `import.spec.ts`, `flows.spec.ts`: new.

## Decisions and assumptions
- Import access is `settings.import.manage` (Owner by default); the platform admin may import into any company. Kinds follow the company's modules. Demo limits: 10 MB, 2,000 rows, first sheet of a workbook.
- Customers need an external ID or email to import (so a second import updates); suppliers also match by name; boxed stock rows are counts and write the difference; existing rolls only update bin and dye lot; opening invoices are one untaxed line; app-made invoices and bills with payments are skipped.
- Undo is refused when an imported record changed or is used elsewhere since.
- Flow 1 needed a way from a new sale to installation, so Schedule installation and Start job were added (not named in the spec). It sets a 60 % deposit: with 50 %, the ledger rightly shows Deposit paid after voiding, since the other half covers the deposit.
- Connect a database stores nothing; its sample tables are invented.

## Left out
- Editing invoice lines before the first confirmed payment (plan K-6); returns reversing a cut; an HR payroll export beyond the Team CSV; Keystone has no draft quotes in the seed (Summit has two); seeded receipts carry no stock movements.

## Next
Nothing left in feature batch 2. Next session: demo feedback (docs/feedback-demo.md) or a new batch.
