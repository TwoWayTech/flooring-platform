# 2026-11-21 19:25, A: a repriced accepted quote goes back to Pending (fix/sales-quote-reprice)

## Goal
Owner decision 7 (ADR 0061) and click-through findings #5 to #9 on the quote builder.

## What changed
- **Decision 7.** `repricesAcceptedQuote` and `savedQuoteStatus` in `packages/shared/src/operations/quotes.ts`: a save of an accepted quote that changes its customer, job-site state or county, tax override, lump sum, deposit, or a line's product, category, unit, quantity or price stores it as Pending, priced under the day's rule, with the audit row "Quote repriced; back to pending" (old and new status and total). Other saves keep Accepted and the accepted total (PR #59's `keepsAcceptedTotal`, which now also counts the deposit). Same on the API (`SalesService.saveQuote`) and in DemoStore. On the API the quote update now writes only from the status it read (`where status = before.status`), so a save racing an accept, decline or conversion answers 409 `quote_state`. The builder shows the warning "Changing this accepted quote sends it back to Pending; the customer must accept the new total." before such a save and hides Convert to invoice meanwhile.
- **#5.** Wording only, in `docs/demo-script.md`: the quick-add form takes name, phone, type and email by design (sales.md rule 40, ADR 0011: "no address"); the job-site address is typed on the quote, and address suggestions live in the customer's address dialog. Chosen over adding address fields to quick add, which would change the `POST /customers` contract.
- **#6.** The Lines table uses a fixed layout with set narrow numeric columns (Quantity 6.5rem, Waste % 5.5rem, Price 5rem, Amount 5.5rem, remove 2.5rem); Item takes the rest (at least about 10rem). The quantity cell's carton hint is compact and the unit sits under the input; the "%" moved to the header ("Waste %").
- **#7.** `trimmedDecimal` in `decimal-text.ts`; the waste and deposit inputs show "8" and "50" instead of "8.000" and "50.00", in wider boxes (4.5rem and 5rem). A blur with the same value by value no longer marks the quote changed.
- **#8.** Stock reads "available": "0.00 sq ft available" in the product picker (no carton hint at zero), "Only … available at …" and "Ship from …, … available" on a line, "No roll has … ft available here".
- **#9.** The builder runs one request at a time (`exclusive`, a ref plus `pending`): Save, Send, Accept, Decline and Convert are disabled while it runs, and after a conversion they stay disabled until the invoice opens. The API already refused a second conversion with 409; a concurrent test now proves it.

## Checks run
- `pnpm turbo run typecheck` and `lint` for shared, api and web: pass.
- `pnpm --filter @workspace/shared test`: 87 files, 1267 tests pass.
- `pnpm --filter web test`: 82 files, 582 tests pass (coverage snapshot regenerated: `invoices.int.test.ts` now covers `PUT /quotes/:id`).
- `pnpm --filter api test`: 18 files, 129 tests pass.
- Integration, `--maxWorkers=1`: `invoices.int.test.ts` 18 pass (new RQ1 to RQ3), `settings-tax.int.test.ts` 34 pass, `sales.int.test.ts` 11 pass.
- Playwright not run locally (shared laptop); the new demo-mode test in `quote-status.spec.ts` typechecks and lints; CI's `e2e` runs it.

## Review round 1 (same PR)
- **Accept names the total the person saw.** `POST /quotes/:id/status` takes `expectedTotal` (money text, required for `accept`). `acceptsShownTotal` in shared; the API checks it and adds `total = <read total>` to the accept UPDATE's WHERE, so a reprice that commits in between is caught too; either way 409 `quote_changed` "This quote changed; review the new total before accepting.", and the quote keeps its status. DemoStore refuses the same way; the builder sends the stored total of the quote it holds. Every API test that accepts now sends the total the send answered (9 files) and so does the api-mode demo-script spec. `docs/api-contract.md` updated.
- **The save's `quote_state` 409 is tested** (RQ5): the test holds the quote row, lets the save read it and wait at its update, declines the quote, and the save answers 409 `quote_state` with nothing written.
- **Reordering lines is not a reprice:** `pricingOf` compares the lines as a sorted list (RP5).
- Checks: typecheck and lint pass; shared `accepted-quote-total` 13 pass; web `demo-tax` and `api-rereads` 19 pass; integration (`--maxWorkers=1`): `invoices` 20, `sales` 11, `settings-tax` 34, `accounting` 6 pass, and the other accepting files below.

## Open questions
- A tax rule that changed since acceptance, with nothing else changed, does not count as a reprice (the quote keeps its accepted total, as PR #59). Confirm that is the owner's intent.
