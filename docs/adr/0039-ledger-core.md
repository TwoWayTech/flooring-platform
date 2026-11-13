# ADR 0039: The company ledger, part 1 (LedgerService and sales postings)

- **Status:** accepted, 2026-11-14
- **Context:** the owner's second work queue, task 6: P12 ledger with finance-expenses (docs/real-build-plan.md week 14). ADR 0038 held every sales write that records money or an invoice behind `requireLedger`, because CLAUDE.md rule 10 asks for a balanced journal entry with every financial event. This part builds the ledger and replaces that gate. The blueprint's posting rules (pages 24, 25, 34 and 48) are summarised in ADR 0023, because this session could not open the PDF.

## Decision
- **Schema (company migration 0002):**
  - `ledger_accounts`: a chart of accounts. Postings name an account by a stable `key`; a company may rename one or add its own.
  - `journal_entries` and `journal_lines`: both append-only. An entry is unique by source and event, so nothing posts twice; a reversal names the entry it undoes.
  - `period_closes`: append-only. The newest row's date is the last closed day, and reopening is a new row with an earlier date.
  - **Database guarantees:**
    - each line is one-sided and not negative;
    - at commit, each entry has two or more lines and balances (deferred constraint triggers);
    - nothing is dated on or before the closed day;
    - no update, delete or truncate.

    These stop application bugs, not someone who owns the database, as with audit_log.
- **Default accounts** (`DEFAULT_ACCOUNTS` in packages/shared):
  - cash, receivables, inventory;
  - payables, sales tax payable, customer credit, accrued payroll;
  - owner's equity;
  - sales, sales returns;
  - cost of goods sold, and the expense accounts from ADR 0023, plus bad debt.

  They are made on first use, which is safe to repeat, so existing companies need no data migration. The accountant may rename them or add more (STATUS).
- **LedgerService** (`core/ledger`):
  - `post` checks the draft with the shared `postingProblem`, refuses a closed day with 409 `period_closed`, and writes the entry and its lines in the caller's transaction, so the document and its entry commit together.
  - `reverse` posts the swapped lines of an earlier entry on the void day. It does nothing when that event never posted, such as a payment that was never confirmed.
  - `trialBalance` gives every account's totals through a day, and whether debits equal credits.
- **Sales postings** (`packages/shared/src/accounting/postings.ts`):

  | Event | Debit | Credit |
  | --- | --- | --- |
  | Invoice issued | Accounts Receivable (total) | Sales (subtotal, at the selling location); Sales Tax Payable (tax) |
  | Credit note issued | Sales Returns (subtotal); Sales Tax Payable (tax) | Customer Credit (total) |
  | Payment confirmed | Cash (amount) | Accounts Receivable (up to the balance); Customer Credit (any extra) |
  | Write-off | Bad Debt | Accounts Receivable |
  | Credit applied | Customer Credit | Accounts Receivable |
  | Refund | Customer Credit | Cash |
  | Void invoice, credit note or payment | The reversal of its entry, on the void day | |

  - **Dates:** an invoice and a credit note post on their issue day, a payment on the day the customer paid, and adjustments and voids on the company's day.
  - **Pending payments:** they post nothing until a second person confirms them.
  - **Deposits:** a deposit is a payment on an invoice that already exists, so it reduces the receivable. The blueprint's Customer Deposits account (page 25) has no use while an invoice always comes before its deposit.
  - **Retainage:** an invoice with retainage is refused here; contract billings post with the contracts module.
- **Credit notes settle their own invoice first.** This was the open decision from the PR #15 security review. A new credit note is applied to its own invoice's open balance as credit applied, with its posting, and only the rest becomes customer credit. Refundable credit therefore always comes from money received.

  As a result, a note applied this way cannot be voided, because neither the note nor the applied credit has a reversal.

  Two more rules keep note credit within money received (PR #16 security review):
  - an invoice with a write-off takes no credit note;
  - a confirmed payment on an invoice with a live credit note cannot be voided.
- **Voiding a payment posts what the void changes now**, not a mirror of the original split. The entry credits Cash for the whole amount and debits Customer Credit for the overpayment that disappears, with the rest to Accounts Receivable. When two payments overpay an invoice and the first is voided, both accounts therefore still match the documents.
- **Concurrency:** posting holds a shared advisory lock and closing a period an exclusive one, so no posting slips in behind a close. Closes are ordered by id, because UUID v7 sorts by time. A period can't be closed through a day that hasn't come yet.
- **No lines added later:** lines may only join an entry created in the same transaction.
- **Routes** (modules/finance):
  - `GET /ledger/trial-balance?through=` needs `reports.financial.view` and company-wide data scope, because the books cannot be cut to one branch (PR #16 review). It writes nothing.
  - `GET /ledger/period-close` shows the last closed day.
  - `POST /ledger/period-close` needs `settings.company.manage` (Owner) and is audited as "Closed books" or "Reopened books".
- **Not in this part:**
  - **Part 2:** expenses on the API, with recurring drafts and their postings.
  - **Part 3:** bills and supplier payments; receipt, stock-correction and cost-of-goods postings, with the costing method as a company setting.
  - **Later:** screens for the trial balance and the period close.
  - **Opening balances:** the ledger starts empty at go-live. Seeded history and imported records have no entries until the import posts an opening-balance entry (STATUS).
