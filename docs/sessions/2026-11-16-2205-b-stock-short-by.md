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
(Filled in as the stages run.)

## Owner questions
None blocks the build.

- **Q1, `Number()` on decimals in the web.** 118 calls in `apps/web/src`. Most compare with zero or feed a chart and give the right answer, but `purchasing/po-pdf.tsx` multiplies `Number(l.quantity) * Number(l.unitCost)` for a PO line's amount on the PDF, which is float money (rule 6). A sweep PR of its own?
- **Q2, the API's shortfall count.** `invoices.service.ts` counts short rows with its own `dec(draft.shortBy).gt(0)`. Switch it to the shared `isShort` in a later API PR?

## For STATUS
(Filled in at the end.)

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `b3/logs` and `flows/logs` folders.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `gh pr create --draft …` | (below) |
