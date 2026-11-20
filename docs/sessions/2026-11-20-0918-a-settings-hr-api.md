# Session 2026-11-20 09:18, A (Claude): Settings part 5, Settings → HR on the API (queue item 2, task 2)

Person: A (Claude), on A's Windows laptop, working unattended. Worktree `C:\dev\fp-5`, branch `feat/settings-hr-api`, based on part 3b (`bb77988`, PR #60). The other checkouts (`C:\dev\flooring-platform`, `fp-work`, `fp-work2`, `fp-3b`, `fp-4a`) belong to others and are not touched.

**ADR 0059 "Later parts" row 5:** `PUT /settings/hr`, `settings.hr.manage`, module `hr`, a step-up, and the save takes the same `FOR UPDATE` on the `hr` settings row that opening a pay period takes. No plan file exists; this log holds the plan.

## Prompt (orchestrator, summarised)

- Settings → HR (`HrSettings`) saves on the API in api mode, the way parts 1, 2a, 2b and 3a moved theirs: `API_SETTINGS_SECTIONS` and `SETTINGS_READERS` (narrowest readers whose screens read it), shared content rules with the same words in both modes, a strict Zod body, scope `all`, the `settings.hr` switch (404 when off), `current` passed to the dispatcher, one audit_log row per save, DemoStore applying the same rules.
- Payroll safety: changing pay frequency, the anchor or the workweek while pay periods exist could corrupt period boundaries; take the safest option and record it. California rules (`hr.payroll.california`, ADR 0050) stay unaffected.
- No schema change, migration or new dependency (stop and report if one seems needed). No plan mode. Never an `.env*` file.
- Do not run e2e, `next build` or Playwright: write the api-mode and demo specs and stop before running them.
- A fresh read-only security-reviewer, repeated until a round is clean.
- Commit after each step; push with exactly `git push -q origin feat/settings-hr-api`. No PR, no merge, no `gh` write. STATUS and BRANCHES are the orchestrator's.

## What the spec and ADRs say

- hr.md "HrSettings": the nine fields; the anchor is "Not on the screen"; rule 14 (`periodFor`: weekly and biweekly count from the anchor); rule 16 (`payFrequencyProblem`: monthly refused with California non-exempt staff); rule 6 (index 0 of a timesheet is the company's workweek start day); rule 21 (holidays seeded from the US pack, read by HR Home and Settings, not by `grossPay`).
- hr.md "Known differences": "Changing the workweek start or pay frequency. Existing timesheets and periods keep their dates. A new frequency creates a new period beside any that already cover those dates." This is the demo's gap; ADR 0047 closed half of it on the API (a new period may not overlap a live one), which means a frequency change after a period exists leaves days that no period can cover.
- ADR 0024: a workweek is a fixed, recurring 168-hour period (FLSA Fact Sheet 23); each workweek stands alone (29 CFR 778.104). A changed start day re-cuts weeks that sheets and approved pay already used.
- ADR 0046: timesheets and the clock read `workweekStartDay` and `clockEnabled` from the `hr` row (409 `settings_missing` without it).
- ADR 0047: `POST /pay-periods` opens a period from `payFrequency` and `payPeriodAnchor` under `FOR UPDATE` on the `hr` row.
- ADR 0050: the monthly block for California non-exempt staff stays on whatever the California switch says.

## Plan (decisions D1…)

- **D1. The route.** `PUT /settings/hr`, keys `SETTINGS_SECTIONS.hr.keys` (`settings.hr.manage`, an MFA key), `@RequireModule("hr")`, `@Audited()`. In the handler, in order: switch `settings.hr` (404), data scope `all` (403), strict body (400), `hrSettingsProblem` (400); then inside the save's transaction, under `SELECT … FOR UPDATE` on the `hr` row (the lock `PayPeriodsService.open` takes): the schedule lock (409 `conflict`, D4), the monthly rule on a frequency change (400, D5), then a step-up (403 `step_up_required`, D3); then the write and one audit entry. Answers the section as saved.
- **D2. Content rules (`hrSettingsProblem`, packages/shared, the same words in both modes).** Workweek start a whole 0 to 6; frequency one of the four; the anchor a real calendar day `yyyy-MM-dd` in 2000 to 2099; holidays at most 100, each a real day in 2000 to 2099 with a name of 1 to 80 characters once trimmed, each date once; the five switches booleans. Names are stored as sent (as part 1).
- **D3. Step-up always** on the API, after every content and lock check (Payments' order, ADR 0059 D5), whatever `auth.step-up` says: the section drives pay periods, overtime weeks and what the portal shows about pay. On screen `stepUp` is on and the page runs `hrSettingsProblem` before the dialog.
- **D4. The schedule lock (safest option).** `hrScheduleProblem(next, current, facts)`: the pay frequency or the anchor may not change once any live pay period exists ("…each day must be paid in exactly one pay period."); the workweek start may not change once any live timesheet, clock entry or pay period exists ("…overtime is worked out per fixed workweek."). Judged on the API under the `hr` row's lock, so a period can't be opened between the check and the write (`open` takes the same lock); 409 `conflict`. DemoStore runs the same rule against its own collections. A never-saved section counts every field as changed. Changing these on purpose (a new schedule from a date) is an owner question (Q1).
- **D5. Monthly with California non-exempt staff** (`payFrequencyProblem`, ADR 0050: stays on whatever the switch) is refused on a change of frequency only, judged on the live employees under the lock (400, its own words). An unchanged frequency is not re-judged, so a company already on monthly can still save holidays and switches (approval still refuses the run). The page's Save gate gets the same "only on a change" reading.
- **D6. Who reads it (`SETTINGS_READERS.hr`).** Module `hr`; readers `hr.overview.view` (HR Home's holidays), `hr.timesheet.view` (Timesheets' workweek), `hr.pto.view` (Time off's team calendar), `hr.portal.view` (My time off's team calendar) and `settings.hr.manage` (the page); not hidden while the `settings.hr` page switch is off, because those screens read it whatever the page says. The API's own readers (pay periods, timesheets, the clock, the portal) read the stored row whatever is answered. No HR property is a `SENSITIVE_FIELDS` name.
- **D7. Never saved.** `GET /settings` leaves `hr` out when the company has no `hr` row (the web keeps DemoStore's copy, as localization's D7); the API acts on none (hours and pay periods answer 409 `settings_missing`). The first save writes the row with a `null` before.
- **D8. Audit.** "Changed hr", target "HR" (the shared label, as DemoStore already writes), `before` the locked row (or null) and `after` the saved section.
- **D9. The web.** `settingsFromAnswer` takes `hr`; `updateSettings("hr")` is routed by `API_SETTINGS_SECTIONS` with no transport change. The page passes `problem` and `stepUp`.
- **D10. DemoStore.** The same module, keys, switch, scope, content rule (through the dispatcher with `current`), then the schedule lock and the monthly rule against its own collections. Its step-up is the dialog alone.

## Commands and results

(filled in as the work goes)

## Owner questions (none blocks; each with its safest default taken)

(filled in as the work goes)
