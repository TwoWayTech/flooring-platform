# Session 2026-11-15 01:20, B (Claude): owner answers on pay audit, manager history and the paid employee

Person: B (Claude), on B's Mac. Branch `feat/hr-pay-reasons-and-history`, from main at `0aba18e`. Unattended overnight run: the owner said "go" and is asleep, so open points take the safest option and are recorded in docs/blueprint-delta.md.

## Prompt (owner, 2026-11-15, verbatim in part)
"Build the owner's answers to the questions in STATUS, in one small PR:
- Bonus reasons and pay-run exclusion reasons are hidden from anyone without pay access, the same as commission reasons.
- People with pay access see plan terms only within their own data scope; only the Owner sees every rep.
- Both database changes are approved: a dated manager history, and storing the paid employee on each commission statement, with migrations and tests.
Then continue the work queue in the order STATUS gives (meetings, platform admin and manual billing, reports, import, cross-module Playwright api-mode flows, then the whole-product check)."

## Setup (Part A, same night)
Docker Desktop started and set to start at sign-in; `docker compose down -v`, `up -d`, `pnpm db:migrate`, `pnpm db:seed` ("Seeded Summit Floor Co."). lint, typecheck, test and test:api all pass on main (`0aba18e`). A night watchdog (LaunchAgent `local.flooring-watchdog`, outside the repo) logs Docker, Postgres and disk to `~/watchdog.log` every 15 minutes.

## Plan
1. **Shared.**
   - `permissions/pay-audit.ts`: add "Added bonus", "Voided bonus", "Left out of pay period" and "Brought back into pay period" to `PAY_SENSITIVE_AUDIT_ACTIONS`. A new rule decides who reads a pay-sensitive entry's details: the Owner always; otherwise only a holder of `SENSITIVE.payRate`, and then only when the entry's person is inside their data scope (`seesPersonRecords`). An entry about no single person, such as plan terms, needs company-wide scope.
   - `hr/commission-plans.ts`: `managerOf(userId, date)`, so an override line goes to the manager on the line's confirmed day. A shared `managerOn(history, employeeId, date)` picks the latest dated row on or before the day.
2. **DB, migration 0005 (company).**
   - New append-only table `employee_manager_history` (employee, manager or none, `effective_from` date; null means since records began).
   - New column `commission_statements.employee_id` (the employee the statement pays, stored at approval).
   - Backfill: one since-the-start row per live employee with today's manager, and each stored statement's employee from today's sign-in link. This keeps every amount worked out before the migration the same.
3. **API.**
   - People add and edit write a history row on the company's day whenever the manager is set or changes. If a person has no row yet, a since-the-start row with the old manager comes first.
   - `loadManagerOf` reads the history.
   - Approval stores the employee.
   - `commissionForRun` and `strandedCommission` pay or flag the stored employee, not today's link.
   - `GET /audit` resolves each pay-sensitive entry's person: a bonus by its employee, an exclusion by `employeeId` in the entry, a statement by its stored employee or else the rep's link. Plans have no single person.
4. **Web (demo).** `managerOf` takes the day (the demo has today's managers only). The demo audit list hides pay-sensitive details from a non-Owner pay viewer below company-wide scope, because demo entries carry no person id; this is stricter than the API.
5. **Tests.**
   - Shared unit: the pay-audit rule and dated overrides.
   - API unit: the pay-audit action scan, with the reason exemption removed.
   - API integration: a reorg keeps earlier override lines with the old manager; approval stores the employee and a later re-link doesn't move the pay; a scoped pay viewer's audit view; bonus and exclusion reasons hidden from non-pay viewers.
   - DB: the table-rules and seed tests.
6. **Docs.** ADR 0048 updated, data-model, api-contract (`GET /audit`), commissions and hr specs where behaviour changed, blueprint-delta, STATUS (owner questions closed, follow-ups closed), BRANCHES.
7. **Reviews.** schema-reviewer and security-reviewer, each fresh, until no blocking finding; summary posted on the PR.

Out of scope: storing `carry_out` on `commission_statements`. The owner approved the two changes above, not this one, so it stays a STATUS follow-up.

## Outcome
Plan steps 1 to 6 are built on draft PR #32, except the STATUS and BRANCHES edits, which the orchestrating session makes (see "Left" below).

- **Shared** (`a236c47`): the four bonus and pay-run reasons are in `PAY_SENSITIVE_AUDIT_ACTIONS`; `packages/shared/src/permissions/pay-audit.ts` reads a pay-sensitive entry's details for the Owner, or for a `SENSITIVE.payRate` holder whose data scope covers the entry's person (`seesPersonRecords`); an entry about no single person, or whose person can't be resolved, needs scope `all`. `managerOn` in `hr/manager-history.ts`; `CommissionInputs.managerOf(userId, at)`.
- **DB** (`2936590`, `124cc24`):
  - Company migration 0005 adds `employee_manager_history` and `commission_statements.employee_id`, and backfills both. The seed writes the same rows.
  - Company migration 0006 indexes the two new foreign keys, `employee_manager_history.manager_id` and `commission_statements.employee_id` (second review of PR #32). It is a separate generated migration, so a database already on 0005 gets them too.
- **API** (`beaa649`, `41dc910`, `08b3f54`):
  - People add and edit append history rows on the company's day.
  - `loadManagerOf` reads the history on the company's day of each line's confirmed moment.
  - Approval stores the paid employee, and `commissionForRun` and `strandedCommission` use it.
  - `GET /audit` resolves each pay-sensitive entry's person (`pay-audit-subjects.ts`).
  - `selfMadeManager` judges each override line by the history row that paid it.
  - Only the Owner re-links a sign-in with paid statements, or one that manages someone on an override plan.
- **Web demo** (`c4b6894`, `d72214a`): the audit list hides pay details below scope `all` from everyone but the Owner (`audit-view.ts`, stricter than the API). Demo overrides read today's manager.
- **Tests** (`52a1ddc`, `1b1a08c`, `5d7d8e5`, `124cc24`): the shared pay-audit rule and dated overrides; the API audit-action scan; API integration tests for reorgs, the stored employee, re-links, a scoped pay viewer, hidden bonus and exclusion reasons, history writes and the self-made manager; DB tests for the 0005 backfill, the 0006 foreign-key indexes, table rules and the seed; the demo audit rule.
- **Docs** (`87f4d28`, `8050b31`, `124cc24`): ADR 0048, ADR 0047, data-model, api-contract (`GET /audit`), the commissions and hr specs, and blueprint-delta.

## Decisions and why
- **Safest options:** these are recorded in docs/blueprint-delta.md (2026-11-15) and in ADR 0048.
  - Plan terms need scope `all`, and so does an entry whose person can't be resolved.
  - The demo is stricter than the API.
  - The backfill keeps every amount worked out before.
  - Manager changes are never back-dated.
  - `paysActorOverride` looks back over twelve months.
- **Reading taken, not the strictest:** a non-Owner pay viewer at scope `all`, such as the default HR manager, still sees every rep. HR → Commissions already shows them every plan and reason. This is an owner question.
- **Index migration as 0006, not a regenerated 0005:** the drizzle migrator applies migrations by journal time. A database that already ran 0005, such as a local one, would never get indexes added to a regenerated 0005. The schema-reviewer rule also forbids hand-editing.
- **Not built:** a stored `carry_out` on `commission_statements`. It was not approved, so it stays a follow-up.

## Reviews
- **First review of PR #32:** findings on the self-made manager (blocking), the company-day manager lookup and the re-link guard. Fixed in `08b3f54`, `5d7d8e5` and `8050b31`.
- **Second review of PR #32:** two should-fix findings.
  - Foreign-key indexes: fixed in `124cc24`, which adds migration 0006, a test and doc updates.
  - STATUS and BRANCHES not updated: this log is now completed. STATUS and BRANCHES are left to the orchestrating session; the items they need are under "Left".
- Before the PR is marked ready, a fresh schema-reviewer and a fresh security-reviewer run, and their summary is posted on the PR.

## Commands run and results (second-review fixes, final tree)
- `pnpm exec drizzle-kit generate --config drizzle.company.config.ts --name foreign_key_indexes` (in packages/db): wrote `0006_foreign_key_indexes.sql`, with two `CREATE INDEX` statements only.
- `pnpm -s exec vitest run --project integration test/manager-history-backfill.int.test.ts test/table-rules.int.test.ts test/seed.int.test.ts` (in packages/db): 3 files, 20 tests, all pass.
- `cd apps/api && pnpm -s vitest run --project integration test/commissions.int.test.ts`: 42 tests pass.
- `cd apps/api && pnpm -s vitest run --project integration test/hr.int.test.ts test/payroll.int.test.ts test/users.int.test.ts test/permissions.int.test.ts test/portal.int.test.ts`: 5 files, 121 tests, all pass.
- `pnpm --filter @workspace/shared exec vitest run test/pay-audit.test.ts test/commission-plans.test.ts`: 39 tests pass.
- `cd apps/api && pnpm -s vitest run test/pay-audit-actions.test.ts`: 4 tests pass.
- `cd apps/web && pnpm -s exec vitest run tests/unit/demo-audit.test.ts`: 3 tests pass.
- `pnpm -s typecheck`: pass (6 of 6 tasks). `pnpm -s lint`: pass (6 of 6 tasks, Prettier clean).
- Not run here: Playwright and `next build`, because this Mac has too little memory. They run in CI once the PR is ready.

## Left
- **STATUS (orchestrator):**
  - Close the follow-ups "Dated manager history for overrides" and "Commission pay to the employee at approval".
  - Close the PR #30 owner questions on bonus and exclusion reasons and on pay viewers' scope.
  - Add the owner questions and follow-ups that ADR 0048 names:
    - confirm that a non-Owner pay viewer at scope `all` sees every rep;
    - whether a way to waive self-made override lines is wanted;
    - stable override attribution after an Owner re-link, which needs a schema change.
  - Keep the stored `carry_out` follow-up open.
- **BRANCHES (orchestrator):** add `feat/hr-pay-reasons-and-history`, owner B, PR #32, with the last commit.
- **Reviews:** the fresh reviews above, then mark the PR ready and self-merge under the CLAUDE.md rule.
- **Next prompt:** "Resume `feat/hr-pay-reasons-and-history` (PR #32): run fresh schema-reviewer and security-reviewer on the branch, fix any blocking finding, update STATUS and BRANCHES as the session log's 'Left' lists, then mark the PR ready and self-merge when CI is green. Then continue the work queue in STATUS order (meetings first)."
