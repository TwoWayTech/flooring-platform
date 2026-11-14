# ADR 0050: California pay rules behind a switch, off until a payroll review

- **Status:** accepted, 2026-11-14
- **Context:** ADR 0024 added California's pay rules to the US pack: daily overtime over 8 hours, double time over 12, the seventh-day rule, the flat-sum bonus premium and a 40-hour California salary. Its refusals came with it: the exempt salary floor, no monthly pay for non-exempt staff and no carryover limit on vacation. Until now the pay rules applied by themselves to anyone whose work state is CA (`overtimeRuleFor`), with no switch. On 2026-11-14 the owner said: "the California overtime and pay rules are not yet reviewed by a qualified person. They must be behind their feature switch, off by default for real companies, with a clear 'pending payroll review, don't use for real pay' note wherever they're used. Federal weekly overtime is fine to enable." The owner also decided that the California refusal checks stay on whatever the switch says.

## Decision

- **Switch.** `hr.payroll.california` (product `both`, module `hr`, status `build`, `enabled: false`) in `packages/shared/src/features.ts` and docs/FEATURES.md. The register is global and decided at build time. No company in the control database has a feature override (modules and plans only), so off in the register means off for every real company. The demo-mode store on `main` reads the same register, so it is off there too. No other key turns on in demo mode only, and a per-mode switch would be a new mechanism. Branch `demo` is untouched.
- **What the switch gates.** Shared code gates it and denies by default, so the API and the demo store follow it without their own checks:
  - `overtimeRuleFor(state, companyRule, californiaOn = californiaPayOn())` returns `federal` for everyone while the switch is off, even with California chosen as the company rule. That covers daily and seventh-day overtime and double time, on timesheet approval, the week grid and pay lines.
  - `companyOvertimeRule` is the company rule as applied. Screens show it, and the payroll rule picker offers California only while the switch is on. `overtimeRuleProblem` refuses saving `overtimeRule: "california"` while the switch is off, and any value other than the two rules. The demo store's `updateSettings` enforces it. The API has no route that saves Settings → Localization yet, so `PUT /settings/:section` must call it when that route is built (STATUS follow-up). Until then the API ignores a stored `california` while the switch is off.
  - `grossPay` takes `californiaOn` (the switch when left out). The California flat-sum premium needs the rule to be `california`, so with the switch off a flat-sum bonus is spread like any non-discretionary bonus (29 CFR 778.209).
  - `californiaSalaryHours(state)` returns 40 for California only with the switch on. Off, the hours from the form or the stored record stand (API People save and demo store).
- **What stays on (owner's decision, 2026-11-14).** The exempt salary floor warning, the monthly pay block for California non-exempt staff (`payFrequencyProblem`) and the vacation carryover guard (`californiaPolicyProblem`). They only refuse or warn about risky setups.
- **Notes.** `californiaPayNote(employees, companyRule)` gives the note, or nothing when California plays no part:
  - while the switch is on and someone works in California, or California is the company rule: "California pay rules are pending payroll review — don't use them for real pay.";
  - while it is off in the same case: California pay rules are off, people who work in California are paid on the federal weekly rule, and their pay must be checked with the payroll provider.

  `GET /pay-periods/:id/review` returns it in a new `warnings: string[]`, and so does the demo store. The web app shows it, with the existing warning style (`CaliforniaPayNote`), on:
  - the timesheet week;
  - pay-period review;
  - Settings → HR (overtime rule panel; the pending note whenever the switch is on);
  - Localization → Payroll (the pending note while on; the row's helper says the rules are off while off);
  - the employee form for a W-2 person in California.

  The presenter guide's Timesheets step follows the switch.
- **Frozen runs.** The warning on an approved or exported run is worked out from the people on its frozen lines, not from who would be paid in that period today. It reflects the switch as it is now, not as it was when the run was approved. Storing the rule a run was approved under is a follow-up. Its lines keep the figures frozen at approval. Review of a frozen run reads the stored rule without refusing (`storedOvertimeRule`, federal when it was never saved), so a missing settings row cannot block it.
- **Who counts.** On an open run, the review warning counts the run's payable W-2 people only. The screen notes ignore 1099 contractors, because overtime law does not reach them.
- **Fixtures.** `pnpm fixtures` was run again, and `harbor.json` changed (one line of the file, which is minified). Four frozen Harbor pay lines in exported periods changed: hb-emp-0025 twice, hb-emp-0017 and hb-emp-0013. On each line the overtime factor went from 2.00 to 1.50, the premium fell by 25% and gross pay fell by the same amount (for example 775.20 to 770.64). Harbor's demo history now shows federal figures for its California staff. Summit's seed is not affected.

## Consequences

- With the switch off, a California worker's pay may be below what California law requires (no daily overtime, no double time). The notes tell HR to check those people's pay with the payroll provider. STATUS has an open question for the client's accountant or payroll provider.
- Turning the switch on is a one-line change to `enabled: true`, and it applies to every company on that build. Turning it on for one company only would need a per-company override that does not exist today.
- Test isolation: `apps/api/vitest.config.ts` keeps Vitest's default isolation, so each test file has its own `FEATURES`. Tests inside a file run one after another, and `withCaliforniaRules` restores the switch's previous value.
- Tests: `packages/shared/test/california-pay.test.ts` covers the shared rules and `apps/api/test/california-pay.int.test.ts` covers the API, each with the switch off and on. Existing tests that relied on the California rules turn the switch on rather than being weakened. `hr.spec.ts` now checks the federal rule and the off note.
- The payroll CSV exports are unchanged: their columns are a contract with the payroll provider. The notes are on the screen that exports them.
- **Accepted risk (security review of PR #29).** With the switch off, someone who may edit pay can save a California non-exempt salary covering more than 40 hours (up to the form's 60). That lowers the regular rate below what California allows. This follows from "everyone on the federal rule", and the off note covers it. Records saved while the switch was on keep their 40.
- **Before the switch is turned on**, the pending note must also reach the outputs that don't carry it yet: the summary and workweek CSV, the approve response and the portal's My pay (the employee portal task). This is a follow-up in STATUS.
