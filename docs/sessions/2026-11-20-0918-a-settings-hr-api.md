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

## Build decisions (B1…)

- **B1. `payFrequencyProblem` takes `Pick<Employee, "state" | "flsaStatus" | "status">[]`** instead of `Employee[]` (backward compatible), so the API passes the three columns it reads under the lock instead of the whole record (pay rates included).
- **B2. `HrSettingsInput`** (the frequency as plain text) is what the strict body produces, as 2a's `PayrollInput`; the controller narrows it to `HrSettings` once `hrSettingsProblem` passed.
- **B3. `SettingsService`:** `save`, `current` and `valueOf` are typed over `DefaultedSection` (every served section but `hr`, D7); the new `saveHr` and `save` share one private `write` (upsert and audit), so no write or audit logic is duplicated.
- **B4. The schedule lock is 409 `conflict`** (the standard code for "state changed underneath"); the content rules and the monthly rule are 400 `invalid_request` (the monthly rule is 400 at approval too).
- **B5. Facts are "any live row" queries** (`deleted_at IS NULL`, `LIMIT 1`) on `pay_periods`, `timesheets` and `clock_entries`, read in the save's transaction after the row lock; employees are read for the three columns only.
- **B6. Part 1's A1** now compares part 1's four sections only (its companies never saved HR); part 5's H1 covers `hr` for every default role of both products.
- **B7. The page's helpers** ("Workweek starts on", "Pay frequency") say they are fixed once hours or a pay period exist, so the 409 isn't a surprise; text only.
- **B8. The e2e specs restore Summit's section as they found it** (read at the start), not a written-out fixture, because the seed shifts fixture dates.

## Commands and results

- `npx vitest run test/hr-settings-rules.test.ts test/settings-sections.test.ts` (packages/shared): 17 passed.
- `npx vitest run tests/unit/demo-hr-settings.test.ts tests/unit/settings-answer.test.ts tests/unit/settings-dispatch.test.ts` (apps/web): 7 and 19 passed.
- `npx vitest run --project integration --maxWorkers=2 test/settings-hr.int.test.ts` (apps/api): 26 passed, first run.
- `pnpm typecheck`, `pnpm lint` (root): clean after the first commit and after review round 1.
- `pnpm test` (root): shared 1187, web 438 (HD3b included), api unit 126, db 18, providers 11, all passed.
- API integration, after round 1: settings-hr, hr, portal, payroll, california-pay, imports: 150 passed; settings, permissions, isolation with settings-hr: 110 passed; settings-localization: passed.
- Mutations (`mutate.mjs` in the scratchpad: one at a time, restored after each): see "Mutations".

## Mutations

20 mutations, one at a time, each restored. HM1 to HM17 and HM19, HM20 caught on the first run; **HM18 survived** (DemoStore ignoring timesheets and punches: every demo workweek case also had pay periods), so HD3b was added (Summit with hours but no pay periods) and HM18 is now caught.

| Id | Mutation | Caught by |
| --- | --- | --- |
| HM1 | schedule lock never refuses | H6, H9 |
| HM2 | no monthly rule | H8 |
| HM3 | no step-up | H1, H5 |
| HM4 | no scope check | H11 |
| HM5 | no content rule on the API | H4 |
| HM6 | no switch check | H10 |
| HM7 | facts read before the row lock, outside the transaction | H9 |
| HM8 | deleted rows count | H6, H7 |
| HM9 | clock punches don't count | H7 |
| HM10 | audit `before` always null | H5 |
| HM11 | never-saved section answered | H2 |
| HM12 | a pay period doesn't fix the workweek | HR4 |
| HM13 | the anchor isn't locked | H6 |
| HM14 | duplicate holiday dates pass | H4 |
| HM15 | any year passes | HR2 |
| HM16 | monthly rule judged on every save | H8 |
| HM17 | DemoStore skips the records check | HD3 |
| HM18 | DemoStore ignores hours | HD3b (added) |
| HM19 | anchor not checked | H4 |
| HM20 | dispatcher skips hr | HD2 |

## Owner questions (none blocks; each with its safest default taken)

- **Q1. Changing the schedule on purpose.** Taken: refused once a pay period exists (frequency, anchor) or hours or a period exist (workweek). A company that must change its pay frequency or workweek has no path but support. Build "a new schedule from a chosen date" (close the open period, start the new cadence the day after, record the change for the FLSA records)?
- **Q2. A step-up on every HR save,** holidays and the portal switches included. Taken: yes (payroll-relevant). Ask for it only when the workweek, frequency, anchor or a pay-visibility switch changes?
- **Q3. Show the schedule lock on the page.** Taken: the page runs the content rule before the code, but the lock is judged by the store or the API, so its words show after the code (the step-up stays valid 5 minutes). Add a light read (whether a pay period or hours exist) so the page can show the fields as fixed?
- **Q4. Hours writers and a workweek change at once.** Taken (security review round 1, the safest option): timesheet saves, uploads, clock-in and clock-out take the `hr` row `FOR SHARE` first and answer 409 when the workweek or clock setting changed under them. This touches the HR module (`timesheets.service.ts`, `hr-records.ts`). Keep it, or accept the narrow race instead?

## Security review

**Round 1** (fresh read-only security-reviewer, on `9669b21`): no blocking finding.
- *Should-fix:* timesheet saves, uploads, clock-in and clock-out read the workweek before their transaction and never lock the `hr` row, so a company's first hours could land on a workweek changed meanwhile, and the schedule lock would then keep the bad sheet. **Fixed (D11):** `holdHrRules` (hr-records.ts) takes the row `FOR SHARE` first in each of the four transactions and refuses with 409 if the workweek or clock setting changed. Tests H16 (timesheet save), H17 (clock-in, clock-out); mutations HM22 to HM24 caught. The upload has no race test of its own (the same one-line call).
- *Note 2:* two first saves at once: the second passed its checks on no row and then overwrote the first through `ON CONFLICT DO UPDATE`. **Fixed (D12):** Settings → HR's first save inserts with `ON CONFLICT DO NOTHING` and refuses with 409 (`SAVED_MEANWHILE`). Test H15; mutation HM21 caught.
- *Note 3:* `lockGroup` doesn't filter `deleted_at` while the HR loaders do. Kept: settings rows are never soft-deleted (ADR 0059 D20), as every settings save already does.
- *Note 4:* in api mode, for a company that never saved HR, the page's monthly gate compares with DemoStore's copy while the API compares with nothing. Kept: it fails closed (the API answers 400 with the same words).

**Round 2** (fresh read-only security-reviewer, on `17a81ca`): **clean**, no blocking or should-fix finding. Notes kept: (1) settings rows are never soft-deleted, so `lockGroup` and `holdHrRules` not filtering `deleted_at` is unreachable (D20); (2) `holdHrRules` also compares `clockEnabled` for timesheet saves and uploads, so a clock switch flipped in the same milliseconds gives a 409 to retry; (3) a clock-out refused that way leaves the punch open, as the existing clock-off rule does; (4) in api mode a company that never saved HR sees DemoStore's copy on the page (D7), while the server stays authoritative. No deadlock cycle: nothing takes the `hr` row after an employee lock or the payroll advisory lock.

## For STATUS (the orchestrator applies these)

- **Done (on merge):** "Settings part 5 (queue item 2, task 2), PR #<n> (ADR 0059, 2026-11-20 part 5 section). Settings → HR saves on the API (`PUT /settings/hr`, `settings.hr.manage`, module `hr`, scope `all`, a step-up, one audit entry) with the same rules and words in DemoStore. The pay frequency and anchor are fixed once a pay period exists and the workweek once hours or a period exist (409, under the `hr` row's lock); monthly with California non-exempt staff is refused on a change. Timesheet and clock writes hold the `hr` row and answer 409 if it changed under them. No schema, migration or dependency change."
- **Change:** part 1's residual risk list loses "HR settings" from the sections still saving in the browser in api mode.
- **Owner questions:** "Owner questions (Settings part 5; none blocks)" with Q1 to Q4 above.
- **BRANCHES:** a `feat/settings-hr-api` row: "A (Claude)", "Queue item 2, task 2, Settings part 5: Settings → HR on the API (worktree `C:\dev\fp-5`; stacked on #60)", the state at handoff, the PR once opened, "see the branch".

## Reviewer summary (ready to paste with `gh pr review <n> --comment --body-file`)

Security review (security-reviewer, read-only), Settings part 5, Settings → HR on the API.
Round 1: no blocking finding. One should-fix: timesheet and clock writes didn't hold the `hr` row, so a company's first hours could land on a workweek changed meanwhile. Fixed: they take it `FOR SHARE` and answer 409 if it changed (H16, H17). Note 2: two first saves at once could overwrite each other. Fixed: 409 (H15). Notes 3 and 4 kept: settings rows are never soft-deleted, and the page's never-saved monthly gate fails closed.
Round 2: clean (no blocking or should-fix). Notes: settings rows are never soft-deleted; a clock switch flipped in the same milliseconds gives an hours writer a 409 to retry; no deadlock cycle (nothing takes the hr row after an employee or payroll lock).
Checked sound: module `hr` then `settings.hr.manage` from packages/shared; switch, scope `all`, strict body and content rules before any database work; the schedule lock, monthly rule and step-up under the same `FOR UPDATE` that opening a pay period takes; one audit entry with the locked `before`; the company only from the session; ADR 0050 unaffected; no `SENSITIVE_FIELDS` name answered; DemoStore applies the same rules and words.

## E2E (written, not run: the orchestrator owns ports 3000 and 4000)

- Api mode: `apps/web/tests/e2e-api/settings-hr.spec.ts` (E1 HR saves a switch with a step-up, the employee reads it, a duplicate holiday is refused before any code; E2 the pay frequency is fixed once a pay period exists, on screen and on the API, and Sales is refused). Each restores Summit's section as it found it.
- Demo: `apps/web/tests/e2e/hr-workspace.spec.ts` (the existing "Settings → HR changes what employees see" now confirms the code; the schedule lock; a duplicate holiday refused before any code).
- Commands, when allowed: api mode through the orchestrator's runner for `tests/e2e-api/settings-hr.spec.ts` plus `settings.spec.ts` (part 1's shared answer); demo: `pnpm build` with `NEXT_PUBLIC_DATA_SOURCE=demo`, then `pnpm --filter web exec playwright test tests/e2e/hr-workspace.spec.ts --project=flooring --project=hr --workers=2`.

## Stacked on part 4a, and the e2e runs (coordinator's go-ahead)

| Step | Command | Result |
| --- | --- | --- |
| merge | `git fetch -q origin`, `git merge origin/feat/settings-locations-api` (head `3c3a04b`, a real merge) | conflicts only where both parts added text: `packages/shared/src/index.ts` (both exports), ADR 0059 (the "Later parts" rows: 4a's row 4, part 5's row 5; both sections, 4a first), api-contract, settings-and-permissions, blueprint-delta (both kept, 4a first). No code conflict; `API_SETTINGS_SECTIONS` and `SETTINGS_READERS` untouched by 4a. Merge commit `04a2760`; part 5's ADR status now says it stacks on 4a |
| checks | `pnpm typecheck`, `pnpm lint`, `pnpm test` | clean; shared 1201, web 449, api 126, db 18, providers 11 passed |
| API | `npx vitest run --project integration --maxWorkers=4` settings-hr, settings, settings-locations, settings-localization, permissions, isolation, hr, portal, payroll, california-pay, imports, inventory | 12 files, 300 tests passed |
| ports | `netstat -ano` for :3000 and :4000 before and after every run | nothing listening each time |
| builds | `NEXT_PUBLIC_DATA_SOURCE=api pnpm --filter web build`, `pnpm --filter api build` | both exit 0 |
| api e2e | `e2e-api.mjs C:/dev/fp-5 tests/e2e-api/settings-hr.spec.ts tests/e2e-api/settings.spec.ts` | first run 4 passed, 1 failed: E2 found Tamara already enrolled by E1 (`resetAuthAround` resets per describe). Fixed in the spec only (`6f08ce5`): each test in its own describe with its own reset. Rerun: 5 passed |
| api e2e | `e2e-api.mjs C:/dev/fp-5 tests/e2e-api` (the whole api-mode suite) | 59 passed (6.8m) |
| demo build | `NEXT_PUBLIC_DATA_SOURCE=demo pnpm --filter web build` | exit 0 |
| demo e2e | `E2E_WORKERS=2 npx playwright test` hr-workspace, hr, portal, settings, screens, a11y `--project=flooring --project=hr` | 195 passed (4.4m) |

No product code changed in the merge or the e2e step (one spec file only), so no further security review round was needed.

## Independent security review (coordinator) and its fixes

The independent review of part 5 passed (0 blocking) with two should-fix items and two notes.

- **Should-fix 1: race tests for the upload and the clock-out.** Added **H18** (a timesheet upload while the workweek changes: 409, no timesheet, no "Uploaded timesheet hours" entry; the same upload sent again afterwards is saved, so the refusal came from the race and not from the rows) and **H19** (a clock-out while the clock is switched off: 409, the punch stays open, timesheets unchanged). The test employee now carries its sign-in's email so an own upload finds them. Mutations with `mutate-hr5.mjs` (my own runner; the shared scratchpad's `mutate.mjs` had been replaced by part 4b's session, and it was not used on this tree): removing the upload's hold fails H18 (HM25); removing the clock-out's hold fails H17 and H19 (HM24). Each file was restored.
- **Should-fix 2: `holdHrRules` reads the live row.** The `FOR SHARE` select now filters `isNull(settings.deletedAt)`, as `loadHrRules` and `loadPaySchedule` do. `lockGroup` keeps no filter, and its JSDoc now says why (settings rows are never soft-deleted, D20; the unique group index allows one row per group).
- **Note (kept): the monthly rule reads employees without locking them.** An employee moved to California non-exempt in the same instant as a change to monthly can pass the save; approving the run still refuses it (`lockPayable` judges the locked people with `payFrequencyProblem`).
- **Note (kept): in api mode a company that never saved HR sees DemoStore's copy on the page,** and the page's monthly gate compares with it. This is display only: the API judges against no row and the server's HR loaders answer 409 until the first save (D7).

Checks: `pnpm typecheck`, `pnpm lint` clean; API integration settings-hr, hr (the timesheet and clock cases), portal with `--maxWorkers=2`: 92 passed; settings-hr again after H18's success case: 31 passed. No e2e, `next build` or Playwright (ports 3000/4000 belong to another builder).

**Security review round 3** (fresh read-only security-reviewer, on `0bb7424..3a8ee79`): **clean**, no blocking or should-fix finding. Its notes were applied: H18 now ends with a successful upload, and `lockGroup` explains why it doesn't filter `deleted_at`.
