# 2026-11-21 20:30, builder A: seed dates and page fetches

Branch `fix/seed-dates-and-fetches`. Click-through findings #3, #4, #15, #28 and #29.

## Goal

- #3/#4: `pnpm db:seed` moves the fixture dates to the seed day, as DemoStore does, so the dashboard's trends and stock ages are not frozen on Oct 28.
- #15: the demo script shows Commission split before the deposit.
- #28: screens skip reads the person's role can't make (no 403s for Sales).
- #29: fewer and no duplicate API calls on the dashboard, an invoice and a contract.

## What changed

- `packages/db/src/seed/seed-day.ts`: `demoOnDay` runs the shared `dateShift` and `shiftDates` (DemoStore's) onto `anchorDayFor(anchor, day)`, which is the last day with the anchor's weekday on or before the seed day. The shift is in whole weeks, so weekdays, timesheet weeks, biweekly pay periods, time-off entries inside their periods and meeting series all stay lined up. The newest activity lands 0 to 6 days before the seed day. `firstSeedDay` takes the day from the tenant row's `created_at` in the company's zone. A re-seed therefore computes the same shift, and the rows it keeps are never shifted twice. `SeedOptions.seedDay` overrides it. The API test harness and `seed.int.test.ts` pass the fixtures' own anchor, so their fixed-date assertions stay as they were.
- `packages/shared`: `holdsAny` (the engine's any-of rule, which PermissionGuard now calls) and `LIST_READS` / `mayReadList` (each list route's permissions). A web unit test checks them against the API's route-requirements snapshot.
- Web: `ReadGate` learns the effective permissions from every `GET /company` and forgets them on a company switch or close. `readList` / `readListOrOff` skip a read the gate refuses. `HttpTransport` shares an identical GET that is still in flight, and a write the server has answered clears those shared reads. The invoice page no longer reads the whole invoice list first. The dashboard's Contracts widget reads its 4 lists through `list` (contracts, lines, billings and change orders now in SERVED_LISTS) instead of `contractsData`'s 11.
- Docs: demo-script steps 3 and 4, plus the matching row in real-build-coverage.md. Coverage snapshots were regenerated.

## Checks run

See the PR body.

## Open questions

- #4: the shift alone does not fix "887 days in stock". Products whose fixture `createdAt` goes back to 2024-05 and that never sold in the fixtures' 11 months of invoices still show about 870 days, in the demo as well. Changing this needs a decision: use the newest receipt instead of `createdAt` (spec "Dashboard", Slow movers), or regenerate the fixtures.
