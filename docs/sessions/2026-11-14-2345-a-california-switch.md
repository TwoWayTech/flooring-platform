# Session 2026-11-14 23:45, A (Claude): California pay rules switch

The owner's instruction of 2026-11-14 says the California overtime and pay rules are not yet reviewed by a qualified person. They must sit behind their feature switch, off by default for real companies, with a "pending payroll review, don't use for real pay" note wherever they are used. Federal weekly overtime is fine to enable. Branch `fix/hr-california-pay-switch`, from main at `7e95918`. Draft PR #29.

## Plan
1. **Shared:** a new key `hr.payroll.california` (off) in `features.ts` and docs/FEATURES.md. Gate `overtimeRuleFor`, add `companyOvertimeRule`, add `californiaOn` to `grossPay` (the flat-sum premium follows the rule), and add `californiaSalaryHours`, `californiaPayNote` and the two notes (`hr/california.ts`).
2. **API:** People save uses `californiaSalaryHours`. Pay-period review returns `warnings`. Timesheet approval and pay lines follow the switch through the shared rule.
3. **Web:** a `CaliforniaPayNote` component on:
   - the timesheet week;
   - pay-period review;
   - Settings → HR;
   - Localization → Payroll (California leaves the picker while off);
   - the employee form.

   The demo store returns `warnings` and uses `californiaSalaryHours`. The presenter guide step follows the switch.
4. **Tests:** shared `california-pay.test.ts` and API `california-pay.int.test.ts`, each with the switch off and on. Existing California tests turn the switch on. `hr.spec.ts` checks the federal rule and the off note. Fixtures regenerated.
5. **Docs:**
   - ADR 0050;
   - hr.md rule 7 and the `salaryHoursPerWeek` row;
   - api-contract review row;
   - blueprint-delta;
   - FEATURES;
   - STATUS (open question, owner's new order);
   - BRANCHES.

## Decisions (ADR 0050, blueprint-delta)
- **Off for every real company:** the register is global and no per-company feature override exists in the control database. The demo-mode store on `main` reads the same register, so it is off there too: no other key turns on in demo mode only. Branch `demo` is untouched.
- **Gate in shared code, deny by default:** the API and demo store need no checks of their own. With the switch off, California as the company rule also means federal.
- **The California refusals stay on whatever the switch says. This is the owner's decision (2026-11-14):** the exempt salary floor, the monthly pay block and the vacation carryover guard.
- **Notes:**
  - pending review whenever the rules are used;
  - an off note with California staff (or California as the company rule) while off;
  - the API's `warnings` on pay-period review;
  - a frozen run's warning follows today's switch.
- **Payroll CSV columns unchanged:** they are a contract with the payroll provider. The note is on the screen that exports them.
- **Fixtures regenerated:** four frozen Harbor pay lines in exported periods changed: hb-emp-0025 twice, hb-emp-0017 and hb-emp-0013. On each line the overtime factor went from 2.00 to 1.50, the premium fell by 25% and gross pay fell by the same amount (for example 775.20 to 770.64).

## Reviews
- **security-reviewer (PR #29): PASS, nothing blocking.** No path applies the California daily overtime, double time, flat-sum premium or 40-hour salary with the switch off. The refusals are unchanged. Nothing outside the code can turn the switch on. The non-blocking findings, and what was done:
  1. Review of a frozen run could now get a 409 if the settings row is missing. **Fixed:** `storedOvertimeRule` reads the rule without refusing, and open runs reuse the rule they already loaded.
  2. The warning counted 1099 contractors and people outside the run. **Fixed:** the note ignores 1099 workers, and the review passes only the run's payable people. A shared test was added.
  3. With the switch on, the pending note is missing from the CSV exports, the approve response and the portal's My pay. **Recorded** as a must-do before the switch is turned on (ADR 0050, STATUS).
  4. With the switch off, a California salary can cover more than 40 hours. **Recorded** as an accepted risk in ADR 0050.
  5. The test helper was duplicated and reset the switch to false. **Fixed:** one helper, `apps/api/test/california-switch.ts`, which restores the switch's previous value.
- **Second security review (fresh, 7ebd427): PASS, 0 blocking; should-fix 1 to 3 done.**
  1. The fixture text was corrected: four frozen Harbor lines changed, not one.
  2. A frozen run's warning now comes from the people on its frozen lines. A new integration test covers a run that paid only Hana, a run that paid Carla, and the switch turned on. ADR 0050 records that the note follows today's switch and that storing the rule used at approval is a follow-up.
  3. `overtimeRuleProblem` refuses California as the company rule while the switch is off, and any value other than the two rules. It has a shared test and is enforced by the demo store's `updateSettings`. No API route saves Localization yet, so the API can't take the value; the future `PUT /settings/:section` must call the check (STATUS). On isolation: Vitest's default per-file isolation, with no concurrent tests, keeps the switch from leaking between tests, as documented in the helper.

## Commands run and results
- `pnpm install --frozen-lockfile`: done.
- `pnpm -s typecheck`: 6 of 6 tasks passed.
- `pnpm -s lint`: 6 of 6 tasks passed. Prettier check on the changed files: clean.
- `pnpm -s test`: all passed (shared 439, api unit 56, web 13, db 11, providers 11).
- `cd apps/api && pnpm -s vitest run --project integration test/hr.int.test.ts test/payroll.int.test.ts test/commissions.int.test.ts test/permissions.int.test.ts test/california-pay.int.test.ts`: 5 files, 118 tests passed.
- `cd packages/db && pnpm -s vitest run test/seed.int.test.ts`: 13 passed.
- After the review fixes, everything above was run again: typecheck, lint, `pnpm -s test` (shared 439, api 56, web 13, db 11, providers 11), the five integration files (118 passed) and the seed test (13 passed).
- Playwright not run locally (low memory). `hr.spec.ts` was updated for the switch-off behaviour.

- After the second review: typecheck and lint 6 of 6 tasks passed; `pnpm -s test` all passed (shared 440, api 56, web 13, db 11, providers 11); the five integration files hr, payroll, commissions, permissions and california-pay: 119 passed.

## Not done
- The pending note on the CSV exports, the approve response and the portal's My pay. This is needed only before the switch is turned on.
- Playwright and screenshots for the changed screens: CI runs them when the PR is marked ready.
- A per-company override for the switch, if the client ever wants it on for one company only.
