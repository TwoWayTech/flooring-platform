# Session 2026-11-14 23:30, A (Claude): employee portal

The owner's queue of 2026-11-14 (docs/real-build-plan.md row 13; week 17 "portal shows own data only"). Branch `feat/hr-employee-portal`, from main at `b7c2163` (PR #27, commissions, merged). Draft PR #28.

## Plan
1. **Shared rules:** `portalVisibility`, `ownPayLine`, `earnedInYear`, `ownStatements`, `teamOutView` in `packages/shared/src/hr/portal.ts`; the demo's `myPortal` uses them; unit tests.
2. **API** (`apps/api/src/modules/hr`): `GET /me/portal` for the session's own person with the spec's known limits closed; `PATCH /me/employee` (phone and emergency contact, audited); `POST /commission-assignments/:id/acknowledge`; clock-out honours the clock setting; `GET /files/:id` opens one's own employee documents.
3. **Web:** the portal methods and the clock in `API_METHODS`; a focused api-mode Playwright spec.
4. **Tests:** `apps/api/test/portal.int.test.ts`.
5. **Docs:** ADR 0049, api-contract "Employee portal", blueprint-delta, spec notes, STATUS, BRANCHES.

## What was built
- Routes: `GET /me/portal`, `PATCH /me/employee`, `POST /commission-assignments/:id/acknowledge` (module `hr`, switch `hr.portal`, key `hr.portal.view`); the person is always the session's user and the employee linked to that sign-in.
- Server-side visibility on top of the company switches: pay needs `hr.pay-periods`; commission needs `hr.commissions` and `core`; the rate needs view_sensitive too; the team calendar a linked W-2 person and `hr.time-off`; the clock `hr.clock`, `hr.timesheets`, a designated workweek.
- Pay rows from approved or exported runs only, periods without others' lines or exclusions, `ownPayLine` (and no weekly breakdown) with commission hidden; statements, assignment and plan absent with commission hidden; team calendar without kind, note, reason, policy, hours or decider, last 92 days on, leavers out; 1099 and unlinked cases.
- Own profile: strict body, trimmed, "Updated own profile" with only whether the emergency contact changed; no-change saves write nothing. No table changed: `employees.phone` and `employees.emergency_contact` already existed.
- Plan signing under `PAYROLL_LOCK`, own running unsigned assignment shown on My commission, the account's name; "Signed commission plan".
- Clock-in and clock-out need `hr.portal`, `hr.clock` and the clock setting.
- Web: `myPortal`, `updateMyEmployeeProfile`, `acknowledgePlan`, `clockIn`, `clockOut` in `API_METHODS`. My meetings stays on the demo client until Meetings moves (the next task); documents open through the existing `getFile` route.

## Safest options taken (ADR 0049, blueprint-delta)
- Pay rate only with the company setting and `hr.employee.view_sensitive` (owner question in STATUS).
- With commission hidden the rep can't sign in the portal; the terms stay on the server (owner question in STATUS).
- One's own margin base hidden without `sales.margin.view_sensitive`.
- Missing HR settings read as switches off; no workweek means no timesheets and no clock.

## Not done
- A local Playwright run (CI runs e2e on ready PRs). `apps/web/tests/e2e-api/portal.spec.ts` was written but not run locally.
- Meetings (next task), and My meetings with it.

## Reviews
- Security review (fresh security-reviewer): 0 blocking; 3 should-fix, all fixed; notes recorded.
  - 1: hidden commission still reached the person through the pay line's `weeks` (allocated earnings and regular rate): `ownPayLine` now empties `weeks` (shared unit test; integration test with a stored weekly breakdown).
  - 2: 1099 workers got the team calendar: `portalVisibility` needs a W-2 person (shared and integration tests).
  - 3: the clock routes ignored `hr.portal`: both now need it (integration test).
  - Notes taken: the team calendar is limited to the last 92 days on and leaves out people who have left (integration test). Recorded in ADR 0049 "Residual risks": override lines on a manager's own statement, margin base derivable as on HR → Commissions, the flat-sum bonus premium inside the true-up, one link per employee enforced by People only (STATUS follow-up for a unique index), leavers keeping the portal, HR form vs portal lost update, commission book cost.
- Second security review (fresh, 0796c03): PASS, 0 blocking; should-fix 1 (sign stale terms) fixed; notes 1–2 fixed, 3–4 accepted.
- Third security review (fresh, 6a1cf1b): PASS, 0 blocking; should-fix 1 (no API test for the 409 `employee_already_linked`) fixed with a portal integration test that feeds the real driver error through `linkedOnce`; notes accepted. Schema review of migration 0004: PASS, 0 blocking (pre-launch, seeded data only, so no tenant has duplicate links; the seed test passes with the index).
  - Should-fix 1: `POST /commission-assignments/:id/acknowledge` takes `{ signedName, planId, planVersion, planUpdatedAt }` and answers 409 `plan_changed` under the lock unless they are the assignment's current plan; `planUpdatedAt` because a plan unused by approved statements is edited in place with the same id and version. Audit `after` records `planVersion`. Web contract, client, demo and My commission pass the plan shown. Integration test: another plan id, another version, and a plan edited between the read and the signature each get 409.
  - Note 1: people who have left get no team calendar and no clock (`portalVisibility`; shared and integration tests).
  - Note 2: time-off `hours` and `pending` as fixed three-place strings (`quantityString` in packages/shared money; API and demo).
- Owner decision 1 (own rate): the setting alone shows one's own rate, sent as `ownPayRate` from the session's employee; the interceptor is unchanged and still strips rates everywhere else (integration tests: setting on without view_sensitive → own rate; off → null; nobody else's rate in any portal route; `GET /employees` still stripped).
- Owner decision 2 (hidden commission): kept; HR → Commissions, People on plans shows "To collect an e-signature, show commission to this person first; otherwise sign on paper." while an assignment is unsigned.
- Owner decision 3 (one sign-in per employee): `user_profiles_employee_uidx` (partial, NULL and deleted rows ignored), migration `0004_user_profiles_one_per_employee.sql`; People save maps a violation to 409 `employee_already_linked`; `packages/db/test/user-profiles.int.test.ts`.

## Commands run and results
- After the third review: `portal.int.test.ts` 15 of 15; typecheck and lint pass.
- `pnpm -s typecheck`: pass.
- `pnpm -s lint`: pass (after formatting `packages/shared/src/hr/portal.ts`).
- `pnpm -s test`: shared 436, api 56, web 13, db 11, providers 11, all pass (after classifying the portal's `rates` flag as not sensitive in `access-rules.test.ts`).
- `cd apps/api && pnpm -s vitest run --project integration test/portal.int.test.ts test/hr.int.test.ts test/commissions.int.test.ts test/payroll.int.test.ts test/permissions.int.test.ts test/isolation.int.test.ts`: first run 141 of 142 (the HR documents test expected 403 where `hr.portal.view` now passes the route and the service answers 404; updated); after the review fixes, 6 files, 142 of 142 (portal 13).
- `cd packages/db && pnpm -s vitest run test/seed.int.test.ts`: 13 of 13 (twice; the seed did not change).
- After the review fixes: typecheck, lint and `pnpm -s test` pass again (same counts).
- After the owner decisions and the second review's fixes (commit `7457e4e`): `pnpm -s typecheck` pass; `pnpm -s lint` pass (after Prettier on `people.service.ts`); `pnpm -s test`: shared 436, api 56, web 13, db 11, providers 11, all pass. `apps/api` integration: `portal.int.test.ts` 14 of 14; `hr`, `commissions`, `payroll`, `permissions`, `isolation` 129 of 129. `packages/db`: `seed.int.test.ts`, `table-rules.int.test.ts` and the new `user-profiles.int.test.ts`, 3 files, 18 of 18. `drizzle-kit generate`: control unchanged; company `0004_user_profiles_one_per_employee.sql` is one `CREATE UNIQUE INDEX ... WHERE employee_id is not null and deleted_at is null`.
