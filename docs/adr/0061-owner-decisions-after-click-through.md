# ADR 0061: The owner's decisions after the click-through of 2026-11-21

- **Status:** accepted, 2026-11-21. The owner decided these after reading the click-through of the real product in api mode (docs/click-through-notes.md, PR #77). Each decision is built in its own small PR; the ADRs it names hold the details.
- **Context:** the click-through found 2 blockers, 11 major, 42 minor and 10 wording problems. Some needed a rule only the owner can set: what the seed's books start from, which reports must agree, who records payments, which actions need a fresh authenticator code, how times are shown, and what happens when an accepted quote is repriced.

## Decisions

1. **Opening balances in the dev seed.** `pnpm db:seed` posts one opening-balance journal entry, against a new Opening Balance Equity account, covering the seeded open invoices (receivables), open bills (payables), stock on hand and cash. From the first sign-in the trial balance, the balance sheet accounts and the reports agree, and settling a seeded document no longer drives an account negative. It is a seed only; real companies bring their balances with data import. Details: [ADR 0062](0062-seed-opening-balances.md).
2. **The Business report and Profit and loss give the same profit** for the same period and filters. Why October 2026 differed is found and fixed, and a test compares the two reports' net profit (and its parts) for several periods and filters.
3. **The default Sales role views customer payments but does not record them**, as docs/demo-script.md says. The default role template and Summit's seed change; a company's customised roles are never changed by this.
4. **Step-up consistency.** Approving or reopening a pay period needs a fresh authenticator code. Every action that moves money, pay or access is checked and made consistent; the list is [ADR 0063](0063-step-up-consistency.md).
5. **Every time in the company's time zone**, with the zone named where it matters (audit log, Outbox, clock in and out, timestamps on documents and exports), across all modules. This closes P6 / F-r. Details: [ADR 0064](0064-company-time-zone-everywhere.md).
6. **Loosening the expense-approval check is the Owner's alone, with a step-up**, like the payment controls (PR #57).
7. **Repricing an accepted quote moves it back to Pending**; the customer must accept the new total. This replaces PR #59's "an accepted quote keeps its total" for the case where lines or prices change after acceptance; saving an accepted quote without a price change keeps it Accepted.
8. **Stock adjustments stay switched off** (`inventory.adjustments` stays `removed`); the Owner-only stock count correction stays.
9. **CI:** the `verify` job's `timeout-minutes` rises to 40.
10. **Tax stays awaiting the accountant**: the tax rules and their wording ("Example: confirm with your accountant") are unchanged until the accountant answers.

## Local test seeds (not a product change)

`pnpm db:seed` also seeds, for local testing only and never in production, the HR Suite company Harbor Staffing Co. with its people and data, and a platform admin. Details: [ADR 0065](0065-local-test-seeds.md).

## Consequences

- Real companies are unaffected by decision 1 and by the local seeds: the seed refuses non-local databases, as before.
- Decisions 3, 4 and 6 tighten defaults; existing customised roles keep their permissions.
- Decision 7 means a quote's status can go back from Accepted to Pending; converting needs the new acceptance.
