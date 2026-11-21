# 2026-11-21 19:45, A: HR click-through fixes

## Goal
Close click-through findings #46, #48, #49, #50, #60, #63 and #65 (docs/click-through-notes.md) on `fix/hr-click-through`, without touching PR #87's pay-period approve/reopen step-up.

## What changed
- #46: `plural` in `packages/shared/src/sentence.ts`; the bulk timesheet approval dialog and its toast read singular for one ("1 flagged sheet is left…"). `attention.ts` uses the shared helper.
- #48: the field exists (`employees.external_id`, set by the employee import). The fixture generator gives every person a Payroll ID (`SM-1001`…), fixtures regenerated (employees only changed), and People → profile shows it read only as "Payroll ID". No schema change.
- #49: `statementFigureColumns` puts Overrides on the Statements list always, and Adjustments, Carried in (negative) and Draw when the month has them, so the row and totals add up to Payable. Title "Dana Whitfield, October 2026" (`month-name.ts`). Reason hint: "Say why. The amount goes in the Amount field."
- #50: Sales → Team column "Commission (incl. overrides)"; Average deal = Sales (credit notes taken off) / deals.
- #60: `roleMfaChange` and `roleMfaWarning` in `packages/shared/src/permissions/mfa.ts`; the role save's step-up dialog shows the warning (new optional `notice` prop on `StepUpDialog`).
- #63: by design: purchasing.md says data scope does not narrow purchasing. The dashboard's Warehouse today counts the user's default warehouse (not a scope), so the panel now names it and says the order list shows every warehouse. No server change.
- #65: HR Home's hours were the newest week with any timesheet; now the current workweek's timesheets, labelled "Timesheet hours, week of …" (`hrHomeFigures`). Headcount and Headcount by department leave 1099 contractors out.
- Specs: hr.md (rule 23, externalId), commissions.md (rules 11, 17), settings-and-permissions.md (Edit a role), purchasing.md. blueprint-delta row.

## Checks run
- `pnpm --filter @workspace/shared --filter web typecheck` and `lint`; api and db typecheck; db lint: pass.
- `pnpm --filter @workspace/shared test`: 88 files, 1269 tests pass. `pnpm --filter web test`: 82 files, 585 tests pass.
- `pnpm --filter @workspace/db test:api test/seed.int.test.ts --maxWorkers=1`: 14 pass.
- Playwright not run locally (shared laptop); demo specs updated for the new labels and typecheck.

## Open questions
- Should HR be able to edit the Payroll ID on the profile? That needs the people API's input to accept `externalId` (a contract change); left read only.
- In the demo with `auth.step-up` off there is no confirmation, so no MFA warning.
