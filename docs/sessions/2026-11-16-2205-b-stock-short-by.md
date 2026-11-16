# Session 2026-11-16 22:05, B (Claude): the invoice Stock panel reads decimal shortfalls as numbers (B3)

Person: B (Claude), on B's Mac. Branch `fix/web-stock-short-by`, from `origin/main` at `d0e4e20` (B2, PR #44, merged: every routed write makes the screens read again). This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

## Prompt

### The owner's queue of 2026-11-16, item 1 (verbatim)
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.

B2 is merged (PR #44). This session is the second bug, B3. F1 also needs B1, so it stays `fixme`, and its annotation will name only B1.

### Per-task rules (owner)
- Read the blueprint prompt first (P11 in docs/real-build-plan.md), the product specs where the Stock panel is described (docs/product-spec/inventory.md and sales.md) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why".
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- Rule 6: decimal.js through the shared helpers (`dec` in `packages/shared/src/money.ts`); never `parseFloat`, `Number` or `toFixed` on money or quantities.
- **The sweep:** look through `apps/web/src` for the same bug class, a decimal string from the API compared as text with `"0"`, `"0.00"` or the like. Fix each one that compares an API decimal string, with tests, and list any left with the reason.
- **This laptop (8 GB):**
  - Heavy commands run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `rm -rf`.

### The bug as recorded (docs/STATUS.md, "Api-mode bugs the flows found", B3)
- The invoice's Stock panel reads every held line as "Short by 0.00 ft, not reserved".
- It tests `r.shortBy !== "0"` (`invoice-stock.tsx:92`), and the API answers `reservations.short_by`, a numeric(14,3) column, as `"0.000"`.
- Fix: `dec(r.shortBy).gt(0)`, with a unit test. It blocks F1's step 1 check (the Stock panel shows "Reserved").

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (spec, failing tests, endpoints with guards and audit, the screen, the security review, the PR, the handoff) and the CI budget.
  - `.claude/commands/feature.md`.
  - docs/product-spec/inventory.md: rule 11 (the reservation plan: `shortBy` is `"0"` when fully held, a short row has `quantity: "0"`), rule 15 (a short row can't be cut or issued), the `Reservation` fields, and "Invoice page, Stock panel".
  - docs/product-spec/sales.md: rule 19 (conversion reserves stock; a short line is recorded as short and never blocks the sale).
- **Where the bug was found:** docs/STATUS.md B3; the flows session log docs/sessions/2026-11-16-0200-b-e2e-api-flows.md (decision 38, and B3 under "For STATUS"); the B2 log docs/sessions/2026-11-16-1651-b-reread-after-write.md (the F1 annotations).
- **The code at `d0e4e20`:**
  - `apps/web/src/features/invoices/invoice-stock.tsx` (the panel), `packages/shared/src/reservations.ts` (`planReservations`, `mayIssue`), `apps/web/src/lib/api/demo/inventory-actions.ts` (`reservationSummary`, the demo's audit line, with the same text test).
  - The API: `apps/api/src/modules/sales/invoice-records.ts` sends `row.shortBy` as stored; `invoices.service.ts` already counts short rows with `dec(draft.shortBy).gt(0)`.
  - `packages/shared/src/money.ts` (`dec`, `minDec`, `maxDec`, `moneyString`, `quantityString`). There is no `isZero`-style helper; decimal.js's own `isZero()` and `gt(0)` are used through `dec` everywhere.
  - Tests: `packages/shared/test/reservations.test.ts`; the web's markup tests (`newer-hours-notice.test.tsx`, `company-standing.test.tsx`, through `renderToStaticMarkup`); F1 in `apps/web/tests/e2e-api/flows/f1-sales-quote-to-cut.spec.ts`.

## Plan (short)

### The sweep, done before the plan
`grep` over `apps/web/src` for `===`, `!==`, `==` and `!=` next to `"0"`, `"0.00"`, `"0.000"` and the like (also behind a closing bracket), `case "0"`, `includes("0")`, `startsWith("-")`, decimal fields compared with each other, and truthiness tests of decimal fields. What it found:

| Where | What | API string? | Plan |
| --- | --- | --- | --- |
| `features/invoices/invoice-stock.tsx:92` | `r.shortBy !== "0"` | yes (`"0.000"`) | **fix** (B3) |
| `lib/api/demo/inventory-actions.ts:362` | `r.shortBy !== "0"` in the demo's audit line | no, the demo plan's own `"0"` | **fix** with the same shared rule, so no copy of the text test is left |
| `features/invoices/invoice-model.ts:141-142` | `ledger.credited === "0.00"`, `ledger.writtenOff === "0.00"` | yes (`InvoiceLedger` from the API; today it is `moneyString`, so it works by luck of format) | **fix** |
| `features/hr/commissions/commissions-page.tsx:287` | `plan.overridePct !== "0"` | yes (the API sends `dec(row).toString()`, so `"0"` today; the demo keeps what was typed, so `"0.0"` reads as an override) | **fix** |
| `features/customers/customers-table.tsx:69` | `owes(c).overdue !== "0.00"` | no: `customerReceivable` builds it in the browser with `moneyString`, always `"0.00"` for zero, never negative | left |
| `lib/api/demo/payment-actions.ts:93` | `ledger.balance === "0.00"` | no: the demo ledger is `invoiceLedger`, `moneyString` | left |
| `lib/api/demo/permission-rules.ts:125-127, 138` | `wastePct` and `remainingLengthFt` before and after, as text | no: demo-only change detection; a false "changed" only refuses, the safe side | left |
| `features/hr/commissions/statement-sheet.tsx:87` | `amount.trim().startsWith("-")` | no: the text being typed | left |
| `features/quotes/lines-editor.tsx:195` | `line.wastePct ? …` | presence of an optional field, not a zero test | left |

Out of the class but met on the way: 118 `Number(…)` calls in `apps/web/src`, some on quantities and money (`Number(h.quantity) > 0` in Ready to cut, `Number(l.quantity) * Number(l.unitCost)` in `purchasing/po-pdf.tsx`). Only the one inside the Stock panel is changed here (decision D4); the rest is an owner question.

### Stages (one commit each, pushed)
| Stage | What |
| --- | --- |
| 0 | This log; then the draft PR |
| 1 | B3: failing tests first (the shared rule, the panel's markup, the demo's audit line), then `isShort` in `packages/shared/src/reservations.ts`, used by the panel and the demo |
| 2 | The sweep: the invoice model's credit and write-off lines, the commission plan's manager override (the plan's sentence moves into a small `PlanTerms` component so it can be rendered in a test), each with a failing test first |
| 3 | F1: the annotation names only B1, the header says B3 is fixed; a throwaway F1 with only B1 worked around (never committed, deleted after) |
| 4 | Docs: inventory.md's `Reservation` notes and docs/api-contract.md's Bodies convention (decimals at their column's scale, compared by value) |
| 5 | Checks: web lint and typecheck, `b3/full.sh`, the api-mode suite once with `--build` (`b3-all-1`) |
| 6 | This log's outcome, the PR body refreshed |

## Decisions and why
Planned decisions, each the safest option found. Decisions taken while building go under "Decisions taken during the build".

- **D1, the rule lives in `packages/shared/src/reservations.ts` as `isShort`, next to `mayIssue`.** The panel and the demo's audit line both need it, and the demo must not import from a screen. It compares by value with `dec(shortBy).gt(0)`, the STATUS fix and the API's own count (`invoices.service.ts`). A shortfall is never negative (`planReservations` takes it from `need` less what it held, both at least 0), so `gt(0)` and "not zero" agree on every stored value.
- **D2, the API is not changed.** Its one shortfall check is already a decimal compare. Switching it to `isShort` would be a refactor outside `apps/web` with nothing to fix, so it is an owner question instead.
- **D3, the panel test renders the real `InvoiceStock`** with `renderToStaticMarkup`, as `newer-hours-notice.test.tsx` and `company-standing.test.tsx` do. Only `useCan` and the ApiClient module are mocked; the invoice, ledger, products, rolls and locations come from the Summit fixtures, through `loadCompanyFixtures`. So the test pins the panel's wiring, not only the helper.
- **D4, inside the panel, `Number(r.quantity) > 0` becomes `dec(r.quantity).gt(0)`.** Rule 6, in the file this PR changes; the result is the same for every value. The other `Number()` reads in `apps/web/src` are a different class (they compare correctly), so they are left and listed.
- **D5, the sweep fixes the API strings only, as asked.** The invoice model's lines are hidden by `dec(x).isZero()`, which keeps today's meaning (hidden at zero, shown otherwise). The override shows when `dec(x).gt(0)`; a negative override can't be saved (`percentOk`, 0 to 100). The values left in the table above are built in the browser by `moneyString`, are demo-only, or are typed text.
- **D6, the commission plan's sentence moves into `PlanTerms`** (`features/hr/commissions/plan-terms.tsx`), with the same markup, because the page needs the ApiClient and the workspace to render. It is presentation only: no pay rule changes.
- **D7, F1 stays `fixme` for B1.** The annotation keeps only B1's entry and the header says B2 and B3 are fixed. The optional proof is a throwaway copy with only B1's cost patch (taken from the B2 session's `make-f1-nob2.py`), the Stock panel's "Reserved" check kept as committed. It is never committed and is deleted after the run.
- **D8, no ADR and no docs/blueprint-delta.md row.** The plan of record doesn't change. The spec's `Reservation` notes say `"0"` where the API says `"0.000"`, so they get a line, and the API contract's Bodies bullet says decimals arrive at their column's scale and are compared by value.

### Decisions taken during the build

#### Stage 1 (B3)
- **The panel test's data.** It uses the first active roll hold in the Summit fixtures, with its invoice, paid in full through `invoiceLedger` with one confirmed payment of the total, so the panel offers Cut. The held row is that hold as the API sends it (`quantity: "40.000"`, `shortBy: "0.000"`); the short row holds nothing (`rollId: null`, `quantity: "0.000"`, `shortBy: "12.500"`). `useCan` allows everything, and `@/lib/api` is mocked to an empty client, so no DemoStore is built. `next/link` renders without a router.
- **The row text drops the space before a comma.** ", not reserved" is its own text node after `<Num>`, so stripping tags left "12.50 ft , not reserved".
- **The short-row test passes before the fix too.** `"12.500" !== "0"` already reads it as short. It guards the other direction, and rule 15: a short row offers no Cut.
- **The red run failed for B3 itself:** the hold read "Short by 0.00 ft , not reserved", and the demo's audit line read "2 reserved, 1 short" for two full holds. The short-row test failed only on the space before the comma, which was then fixed in the test's helper.

#### Stage 2 (the sweep)
- **`PlanTerms` was split out first, with the text compare unchanged.** So the new test was red for the bug ("Manager override 0.0%." for a plan typed as `"0.0"`), not for a missing module. The page's markup is the same; Prettier only reflowed one JSX line, and the text is the same.
- **A percent shows one decimal** ("2.5%"). The test's first expectation of "2.50%" was the test's error, not the product's.
- **The invoice model keeps "hidden at zero"**: `dec(x).isZero()`, not `gt(0)`. Credit applied and write-offs are sums of positive amounts, so the two agree on every stored value, and `isZero` keeps today's meaning exactly.
- **The interface comment for `credited` and `writtenOff` is unchanged.** A note on reading by value would only repeat the code.

#### Stage 3 (F1)
- **The throwaway copy** (`b3/throwaway/make-f1-b1only.py` in the scratchpad) turns `fixme` into a test, patches only B1 (a `"0"` cost into Priya's products and quotes answers, as the B2 session did), and keeps the committed "Reserved" check, plus a log of the status cell.
- **It passed in api mode** (`b3-f1-var`, 17.7 s). The status cell read "Reserved". B1 is still there: Priya's answers held 120 products and 493 to 494 quote lines without cost. The copy was deleted after the run, and `git status` lists no `zz-` file.
- **Its records stay on the local api e2e database** (a customer, a quote, an invoice with two payments, and a cut of Denver Fieldstone), as the earlier variants' did. F1 registers no clean-ups while it is `fixme`. CI seeds a fresh database.
- **The F1 header cites this log's stage 3** for the throwaway proof.

#### Stage 4 (docs)
- **inventory.md's `Reservation` fields** now give both forms of zero (`"0"` in the demo, `"0.000"` from the API) and point to `isShort`.
- **docs/api-contract.md's Bodies bullet** says decimal text is not canonical, so clients compare by value.

## Owner questions
None blocks the build.

- **Q1, `Number()` on decimals in the web.** 118 calls in `apps/web/src`. Most compare with zero or feed a chart and give the right answer, but `purchasing/po-pdf.tsx` multiplies `Number(l.quantity) * Number(l.unitCost)` for a PO line's amount on the PDF, which is float money (rule 6). A sweep PR of its own?
- **Q2, the API's shortfall count.** `invoices.service.ts` counts short rows with its own `dec(draft.shortBy).gt(0)`. Switch it to the shared `isShort` in a later API PR?

## For STATUS
- **Done: B3.** The invoice's Stock panel reads a shortfall by value: a shared `isShort` (`dec(shortBy).gt(0)`) in `packages/shared/src/reservations.ts`, used by the panel and the demo's audit line. The same-class sweep of `apps/web/src` also fixed the invoice model's "Credit applied" and "Written off" lines (`dec(x).isZero()`) and the commission plan's manager override (`dec(x).gt(0)`, in the new `PlanTerms`). PR #45, this log.
- **"Api-mode bugs the flows found":** remove the B3 bullet. The heading becomes "B2 fixed in PR #44 and B3 in PR #45, so F2 runs; F1 waits on B1, F5 on B4".
  - **F1 stays `fixme` for B1 only.** Its annotation names only B1. A throwaway variant with only B1 worked around passed (`b3-f1-var`, 17.7 s), with the Stock panel reading "Reserved".
- **Line 131** (Next three tasks, item 1): "F1 needs B1 and B3" becomes "F1 needs B1".
- **The flows' leftovers:** the B3 variant's F1 records stay on the local api e2e database: a customer, a quote, an invoice with two payments, and a cut of Denver Fieldstone. CI seeds a fresh database.
- **New follow-ups:**
  - **`Number()` on decimals in `apps/web/src`** (118 calls). Most compare with zero and give the right answer, but `purchasing/po-pdf.tsx` multiplies `Number(l.quantity) * Number(l.unitCost)` for a PO line's amount on the PDF, which is float money (rule 6). Owner question Q1.
  - **The API's shortfall count** (`invoices.service.ts`, `dec(draft.shortBy).gt(0)`) could use the shared `isShort`. Owner question Q2.
  - **Text compares left by design, all outside the bug class:**
    - `customers-table.tsx` overdue, built by `moneyString` in the browser;
    - the demo's `payment-actions.ts` balance and `permission-rules.ts` waste and roll length;
    - `statement-sheet.tsx`'s typed amount.

    They are listed in this log's sweep table.

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `b3/logs` and `flows/logs` folders.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `gh pr create --draft …` | draft PR #45 |
| 1 | `heavy.sh pnpm --filter @workspace/shared exec vitest run test/reservations.test.ts`, before the fix | red as expected: 1 failed (`isShort is not a function`), 9 passed |
| 1 | `heavy.sh pnpm --filter web exec vitest run tests/unit/invoice-stock.test.tsx`, before the fix | red: 3 failed. The hold read "Short by 0.00 ft , not reserved", and the audit line read "2 reserved, 1 short" (B3); the short-row test failed on the test's own space before the comma |
| 1 | both files after the fix (and the helper's comma fix) | shared 10 passed; web 3 passed |
| 1 | `heavy.sh`: web `typecheck`, web `lint`, shared `typecheck` | clean, clean, clean |
| 1 | `pnpm exec prettier --check` on the 5 changed files | 1 needed `--write` (the new test); clean after |
| 2 | `heavy.sh pnpm --filter web exec vitest run tests/unit/decimal-zero-reads.test.tsx`, before the fixes (`PlanTerms` already split out, compare unchanged) | red: 3 failed, 1 passed. "Manager override 0.0%." for `"0.0"`; `"$0.00"` instead of null for credit `"0"`; the test's "2.50%" expectation was wrong (a percent shows "2.5%") |
| 2 | `decimal-zero-reads` and `invoice-stock` after the fixes | 7 passed |
| 2 | `heavy.sh`: web `typecheck`, then `lint`; `prettier --check` on the 4 changed files | clean, clean, clean |
| 3 | `heavy.sh flows/api-e2e.sh b3-f1-var --build -- tests/e2e-api/flows/zz-f1-b1only.spec.ts` (throwaway, only B1 worked around) | both builds in 13 s; 1 passed, F1 17.7 s; the Stock panel's status cell read "Reserved"; the spec was deleted after, and `git status` lists no `zz-` file |
| 3 | `prettier --check` on the F1 spec | clean |
| 5 | `heavy.sh`: web `lint`, then `typecheck`, on the final tree | clean, clean |
| 5 | `heavy.sh b3/full.sh` (`pnpm lint`, `typecheck`, `test`, `test:api`, `test:hooks`) | all exit 0 in 3 min 45 s. `test`: shared 1,047 (70 files), web 272 (33 files), api unit 124 (17 files), db 18, providers 11 (3 of the 5 tasks replayed from Turborepo's cache); `test:api`: api 628 (35 files), db 59 (8 files), providers 2; hooks 15 |
| 5 | `heavy.sh flows/api-e2e.sh b3-all-1 --build` (the whole api-mode suite) | builds in 6 s; exit 0 after 130 s: 33 passed, 2 skipped (F1 for B1, F5 for B4). Flows: F2 9.5 s, F3 4.9 s, the stale-save test 3.1 s, F4 5.0 s, F6 12.8 s, F7 4.9 s |

## Outcome
B3 is fixed, and so are the two other API decimal strings the sweep found. Every check above is green: the full checks (`b3/full.sh`) and the whole api-mode suite (`b3-all-1`). Commits on `fix/web-stock-short-by`, each pushed:

| Commit | Subject |
| --- | --- |
| `721b319` | docs(sessions): plan for B3, the invoice Stock panel's decimal shortfall |
| `e489625` | fix(web): the invoice Stock panel reads a shortfall by value (B3) |
| `bfdf30a` | fix(web): read the invoice's credit and write-off, and a plan's override, by value |
| `3106ea1` | test(e2e): F1 waits on B1 only, now that B3 is fixed |
| `742e647` | docs: decimals are compared by value, and a full hold's shortBy is "0.000" from the API |
| (this commit) | docs(sessions): B3 outcome |

All carry `[skip ci]`.

## Left
- **The handoff** carries no `[skip ci]`, so CI runs (STATUS, BRANCHES, this log). Then PR #45 is marked ready, waits for `verify` and `e2e`, and self-merges under the CLAUDE.md rule.
  - **The review before merge:** `/review` and a fresh read-only reviewer.
  - **Whether a security review is needed** is decided then. This branch changes no server code, permission, posting or pay rule. It touches only how the web reads three decimals it shows, one of them on an invoice and one on a commission plan.
- **Owner questions Q1 and Q2** above.
- **Next prompt:** "B1, the next task of the owner's queue of 2026-11-16: on a new branch from an up-to-date main, stop a salesperson's quote builder crashing when the API withholds cost (no margin without cost, never send cost or a placeholder margin), with a security review, then turn F1 back on from `fixme` and self-merge under the CLAUDE.md rule."
