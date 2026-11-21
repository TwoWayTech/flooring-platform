# 2026-11-21 19:30, A: contracts schedule of values

Branch `fix/contracts-schedule-of-values`.

## Goal

Click-through findings #30 to #35 on Contracts (CTR-1001, CTR-1005, Summit, api mode).

## What changed

- **#31** New `packages/shared/src/contracts/schedule.ts` (`scheduleLines`, `releaseAllocation`, `contractSchedule`) and the read `GET /contract-schedule` (`contracts.billing.view`, `contracts.register` + `contracts.billing`, data scope as the billings). The Schedule of values (`schedule-of-values.tsx`) shows Billed to date, Retained and Remaining to bill with a totals row, for people who see billings. `ContractsData` gains `schedule` (DemoStore derives it the same way).
- **#33** Each progress billing's Released shows what of its retainage later releases paid out (oldest billing first per line); a release reads "Release of retainage from billing 1 and 2". Its Gross and Retained cells are blank.
- **#30** The contracts list's Retained column is split into "Customers hold" and "We hold", each totalled on its own.
- **#34** Approving a change order opens `ApproveChangeOrderDialog`: value now, this change, new contract value.
- **#35** Sign dialog wording "Recorded as a typed signature; a signing provider is not connected yet."; the signer starts as the customer's contact (not when it is the company name) or the supplier's active primary contact (`ContractsData.supplierContacts`, from `GET /supplier-contacts`), else empty; the recorded date goes through `formatDate`.
- **#32** CTR-1001's customer (Little Interiors) holds a resale certificate, which is why no tax was charged; the invoice already said "exempt (resale certificate on file)". The Billings panel now says how tax applies (`billingTaxNote`), and a contract invoice with zero tax under a rule prints "Sales tax, not charged (contract billing)". No tax rule changed.
- Spec contracts.md rules 10a, 11a, steps 3 and 6, list columns, rule 13 wording; api-contract.md row; blueprint-delta row; route snapshots and docs/coverage.md regenerated.

## Checks run

- `pnpm --filter @workspace/shared --filter api --filter web typecheck`: pass.
- `pnpm --filter @workspace/shared --filter api --filter web lint`: pass.
- `pnpm --filter @workspace/shared test`: 88 files, 1267 tests pass (new `contract-schedule.test.ts`, 7).
- `pnpm --filter web test`: 82 files, 581 tests pass (new `invoice-contract-tax-label.test.ts`, 2).
- `pnpm --filter api test:api test/contract-billing.int.test.ts --maxWorkers=1`: 16 pass (3 new).
- `test/route-matrix.int.test.ts` (snapshot updated, then 20 pass), `test/new-company.int.test.ts` (19 pass).
- Playwright not run locally (shared laptop); demo `contracts.spec.ts` and api-mode `f5-contract-retainage.spec.ts` updated and typecheck.

## Open questions

- **Insurance warning on activation (#35):** contracts.md's compliance rules (rule 22) say nothing about warning when a subcontract is signed with no certificate, so no warning was added. Owner: should Record signature on a subcontract warn "No insurance certificate on file" (warn, not block)?
- **% complete** per line: not in the spec, not added.
- The filed PDF still says "Simulated signature for the demo. Not a legal signature." (API `signContract`); only the dialog wording was in scope.
