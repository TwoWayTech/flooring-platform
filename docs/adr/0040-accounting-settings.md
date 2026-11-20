# ADR 0040: Accounting settings and bank accounts (accountant defaults)

- **Status:** accepted, 2026-11-14
- **Context:** ADR 0039 left four questions for the client's accountant (STATUS, "Accountant questions (ledger)"). On 2026-11-14 the owner chose defaults until the accountant answers, each to be a per-company setting:
  - the default chart of accounts;
  - average cost for stock;
  - sales tax on the accrual basis, with cash basis available as a setting;
  - cash split by bank account.

## Decision
- **One settings group, `accounting`, in the company's `settings` table.** It holds `{ costingMethod, salesTaxBasis, bankAccounts }`, with types and rules in `packages/shared/src/accounting/settings.ts`.
  - The group is new, but `settings.group` is a text column, so this needs no schema change.
  - A company that never saves it uses `DEFAULT_ACCOUNTING_SETTINGS`: average cost, accrual, and no bank accounts.
  - The seed does not write it.
- **Chart of accounts:** `DEFAULT_ACCOUNTS` stays as it is (ADR 0039).
- **Costing method:** `average` is the only value. P12 part 3 reads it for receipts and cost of goods. Another method would be a new value with its own rules.
- **Sales tax basis:** the ledger always posts sales tax when invoiced (ADR 0039). On the cash basis, only the sales tax report changes: it counts tax as due in the period the customer pays. This keeps the books consistent whatever the setting, and lets the company switch without restating entries. The report itself arrives with the reports module.
- **Bank accounts:**
  - Each bank account is its own ledger account. Its key is `bank:<uuid>`, its type is asset, and its code is the next free one from 1010 to 1099. Only a name is kept, never an account number (CLAUDE.md rule 14).
  - Each payment method (cash, check, ACH, card, other) goes to at most one bank account. A method no bank account claims posts to the default Cash and Bank account (1000). So a company with no bank accounts behaves exactly as before.
  - Payments and refunds post their cash line to `cashAccountFor(settings, method)`.
  - A payment void credits the cash account the payment first posted to (`LedgerService.postedCashAccount`). The money goes back out of the bank it went into, even after the method moves to another bank.
  - Renaming a bank account renames its ledger account.
  - A bank account with entries can't be removed: 409 `bank_account_in_use`. Taking its methods away stops new postings to it. One with no entries is soft-deleted.
  - Postings read the settings under a shared advisory lock (`loadAccountingForPosting`), and a save takes it exclusively. A save that retires a bank account therefore waits for postings in flight and sees their lines (PR #19 security review).
  - Company migration 0003 adds the `journal_lines_live_account` trigger: no line may name a soft-deleted account.
  - Stored settings are checked with the same Zod schema when read. A row that fails is 409 `settings_invalid`, never the defaults, which would quietly post a bank's money to Cash and Bank.
- **Routes** (modules/finance):
  - `GET /settings/accounting` and `PUT /settings/accounting` need `settings.payments.manage` (Owner and Accountant; it needs MFA).
  - The body is checked with Zod (strict, so unknown fields such as an account number are refused) and with `accountingSettingsProblem`.
  - A save takes an advisory lock, so two saves can't take one code.
  - It is audited as "Changed accounting settings".

## Consequences
- P12 part 2 (expenses) and part 3 (supplier payments) read the settings with `loadAccountingForPosting`, post their cash with `cashAccountFor` and void with `postedCashAccount`.
- A refund void, when one is added, credits back through `postedCashAccount` for the refund, not `cashAccountFor`.
- The settings screen in the web app comes with the Settings module. Until then the API is the only way to set bank accounts.
- When the accountant answers, each default is changed by saving the setting. No code changes are needed, except for a costing method other than average.

## 2026-11-20: the owner's answer on separation of duties
- `PUT /settings/accounting` needs a step-up, like every other save that moves money controls (ADR 0059, Q10). Built with the separation-of-duties task; ADR 0059 "2026-11-20" has the rule for the payment approval and write-off settings.
