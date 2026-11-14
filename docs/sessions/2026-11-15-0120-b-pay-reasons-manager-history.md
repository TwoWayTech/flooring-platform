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
