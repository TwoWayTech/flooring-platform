# Session 2026-11-16 16:51, B (Claude): screens read again after every save, and My timesheet keeps uploaded hours (B2)

Person: B (Claude), on B's Mac. Branch `fix/web-reread-after-write`, from `origin/main` at `0042b89` (main holds every module on the API so far, data import part 1 from PR #41 and the cross-module api-mode flows from PR #42). This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

## Prompt

### The owner's new queue (verbatim)
> Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
> 2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
> 3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
> 4. Then stop and hand off. Don't start P13; the owner does a click-through first.

This session is item 1, the first bug: B2. F2 can come back after B2 alone. F1 also needs B1 and B3, and F5 also needs B4, so those two stay `fixme`, with annotations that name only what still blocks them.

### Per-task rules (owner)
- Read the blueprint prompt first: P11 in docs/real-build-plan.md, "Each module follows prompt P11". Open docs/blueprint/blueprint.pdf p46 only if needed. Also read the product specs involved (docs/product-spec/hr.md for My timesheet and the timesheet upload, plus the specs of the listed screens as needed) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why". Add a docs/blueprint-delta.md row only if the plan of record changes.
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- CLAUDE.md rules apply: rule 1 (screens only through the ApiClient), rule 6 (decimals), JSDoc on exports, no dead code, no duplicated logic.
- ADR numbers: 0058 is reserved by the paused check branch. So this work amends ADR 0051 with a dated section, and uses 0059 only if a new ADR is truly needed.
- **This laptop (8 GB):**
  - Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready` or `rm -rf`.

### The bug as recorded (docs/STATUS.md, "Api-mode bugs the flows found", B2)
- Only the meetings and import factories in `apps/web/src/lib/api/http/api-methods.ts` call `changed` (through `wrote`). So after any other routed write, a screen keeps its old read until a reload.
- **Payroll data loss.** After an upload on My timesheet, the week form keeps the hours it opened with. Submit saves the form first (`my-timesheet.tsx`), so it writes the old hours over the upload and submits them. HR can then approve and pay them.
- **Also:**
  - a customer or supplier added from a picker never shows as chosen;
  - invoice status pills don't change after a payment or a void;
  - Ready to cut keeps the row it cut;
  - a saved PO draft is missing from the list;
  - the contract page stays a draft after Send for signature;
  - HR's queues keep approved weeks and requests;
  - a reopened week shows Approved.

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (spec, failing tests, endpoints with guards and audit, the screen, the security review, the PR, the handoff) and the CI budget.
  - `.claude/commands/feature.md`.
  - docs/product-spec/hr.md: "Timesheets", the "Create or edit hours" guard row, the template upload, rule 22 and the real-build notes.
  - docs/product-spec/employee-portal.md: "Weekly hours", and the clock.
- **Where the bug was found:**
  - docs/STATUS.md B2.
  - The flows session log docs/sessions/2026-11-16-0200-b-e2e-api-flows.md: decisions 46, 47, 56, 61 and 71, and the F3 and F4 reload points ("Loaded again (B2)").
  - ADR 0051 "Re-reading after a write" (part 3) and ADR 0057 (import writes through `wrote`).
- **The code at `0042b89`:**
  - **Client plumbing:** `lib/api/http/transport.ts`, `router.ts`, `api-methods.ts` (146 routed methods), `lib/api/use-api.ts` and `lib/api/index.ts`.
  - **Demo:** `lib/api/demo/timesheet-actions.ts`, plus `demo/store.ts` `act` (DemoStore emits after every successful action).
  - **Screens:** `features/my/my-timesheet.tsx`, `features/my/my-shell.tsx`, and the five hand-made re-reads in admin and settings.
  - **API:** `apps/api/src/modules/hr/timesheets.controller.ts` and `timesheets.service.ts` (`save`, `upload`, `clockOut`, the employee lock and the sheet's `FOR UPDATE`).
  - **Tests:** `apps/web/tests/unit/api-router.test.ts`, `meetings-api.test.ts` and `imports-api.test.ts`; the HR integration tests (`hr.int`, `payroll.int`, `california-pay.int`, `portal.int`); the api-mode flows F1 to F5.
- **Planning:** a first plan, a critic's review (two must-fix items, M1 and M2, and ten should items, S1 to S10), and a final plan that applies them, each checked against the code at `0042b89`. These live in the session scratchpad, not in the repo, so the plan is restated below.

## Plan (short)

### Part 1: every routed write makes the screens read again
- **The HTTP transport decides by verb.**
  - A GET never re-reads.
  - Any other request the server answered re-reads exactly once. That covers a success, and a 400, 403, 404, 409 or 422 refusal.
  - The re-read fires as soon as the response is OK, before the body is parsed: a 2xx whose body fails to parse has still committed.
  - Status 0 (network), 401, 429 and 5xx don't re-read.
- **Four POSTs only read.** They go through a new `requestAsRead`, which never re-reads:
  - `verifyStepUp`;
  - `previewImport`;
  - `listPayPeriods`, which runs inside a read and would otherwise loop;
  - the `uploadTimesheets` dry run.
- **`HttpTransport.withRereads(changed)`.** The router builds this transport once and hands it to every factory. Factories lose their `changed` argument, and `wrote` and its refusal set leave `api-methods.ts`.
- **Five hand-made re-reads in screens:**
  - two are removed (`plans-page.tsx`, and `company-access-page.tsx` with `AccessEditor.onSaved`);
  - the support-request dialog now reads again only after a limit refusal (429), which the transport doesn't re-read;
  - the two focus counters stay, and their comments stay true.
- **A typed, exhaustive unit test** covers all 146 routed methods (`satisfies Record<RoutedMethod, …>`). It fails if a write stops re-reading, if a read starts to, or if a method is added without being classified. A shared fake-API harness serves it and the meetings and import tests.

### Part 2: My timesheet never saves old hours over newer ones
- **Server.** `PUT /timesheets` takes a required `expectedDays`: the seven days the form started from, checked by shape only.
  - The check runs under the existing employee lock and the sheet's `FOR UPDATE`, after today's checks.
  - It answers 409 `timesheet_changed` and writes nothing when the stored hours differ from `expectedDays` and also from the hours being sent.
  - A save of the hours already stored is taken.
  - One shared helper, `overwritesNewerHours`, makes this check for the API and the demo, so the logic is not duplicated.
- **Screen.** A pure model in `features/my/week-hours.ts`:
  - it compares parsed hours only, so `""` or `"7..5"` can't crash the screen;
  - a form with no edits takes newer saved hours;
  - a form with edits shows a notice offering "Use saved hours" or "Keep my hours".
- **Screen wiring:**
  - The form is keyed by week only, and syncs server hours during render, never in an effect.
  - Save and Submit are disabled while a request runs.
  - Focus moves to the notice when it appears.
  - `MyShell` keeps its data if a re-read fails.

### Stages (one commit each, pushed)
| Stage | What |
| --- | --- |
| 0 | This log and the spec amendments (hr.md "Create or edit hours", employee-portal.md "Weekly hours"); then the draft PR |
| 1 | The generic re-read: transport, router, `api-methods.ts`, the fake-API harness, `api-rereads.test.ts`, the router and transport tests, the five hand-made re-reads |
| 2a | Pure pieces, wired to nothing: the shared `sameWeekHours`, `overwritesNewerHours` and `TIMESHEET_CHANGED_MESSAGE` with tests; the web `week-hours.ts` model with tests |
| 2b | The stale-save check, server and client together, so every pushed commit works: the API schema and service, the integration tests, the contract, the factory, the demo check, the form and `MyShell` |
| 3 | E2E: F2 back from `fixme`; F1 and F5 annotations name only B1 and B3, or B4; the B2 reloads in F3 and F4 go; a new F3 stale-save test; demo G3-3 asserts Monday instead of reloading |
| 4 | Docs: a dated section in ADR 0051, pointers in ADR 0046 and 0057, docs/api-contract.md, one docs/blueprint-delta.md row |
| 5 | Full checks, `/review`, a fresh read-only security review (payroll hours), handoff |

## Decisions and why
Planned decisions, each the safest option found. Decisions taken while building go under "Decisions taken during the build".

- **D1, the transport decides by verb.** Rejected: `wrote` in every factory (about 100 edits, and every new write must remember it, which is how B2 happened). Rejected: a list of method names in the router (a new read loops, or B2 comes back). By verb, a new write re-reads by default, and the exhaustive test forces every new method to be classified.
- **D2, four named POST reads** through `requestAsRead`. `listPayPeriods` would loop: read, POST, re-read, POST, and so on.
- **D3, no coalescing.** No screen sends writes in a loop or with `Promise.all`, and no read sends a write except `listPayPeriods`. A coalescer would add timing to every test for a case that doesn't exist.
- **D4, the refusal set is 400, 403, 404, 409 and 422.** Status 0, 401, 429 and 5xx don't re-read:
  - status 0 and 502 to 504 mean the server or gateway is down, so a re-read would fail too, and screens without `keepDataOnError` would drop a dialog holding input;
  - a 500 may have committed, and that stays the open PR #37 note;
  - the re-read fires once `response.ok` holds, before the body is parsed.
- **D5, the server check is by content.**
  - It is required, under the lock, with no schema change.
  - It compares what payroll pays, so a status change never causes a false conflict, and `updated_at` is not used.
  - `expectedDays` is checked by shape only, and a malformed one answers 400 "Reload the page, then save your hours again.".
  - It is required because an optional field would be an unchecked path for payroll hours.
- **D6, a save of the hours already stored is taken.** It writes what is already there, and it removes false refusals from a double click or a quick Save then Submit.
- **D7, Submit still saves first** (employee-portal.md "Weekly hours"). A clean form's save then writes what the server holds or is refused, the audit rows stay as they are, and a week with no sheet is still created.
- **D8, the form takes newer saved hours when clean and asks when edited.** The compare uses parsed hours only (`Number(text) || 0`, today's parse), never decimal.js over typed text, which throws on `""` and `"7..5"`.
- **D9, a render-time adjust, keyed by week only.** The installed react-hooks lint has `set-state-in-effect`, and a key of week plus status would remount the form on its own submit.
- **D10, busy covers Save, Submit and the notice's buttons.** It doesn't cover Upload or the week picker, which live in the parent. The server check already refuses any overlap that would lose hours.
- **D11, focus.** When the notice appears, or a busy action ends, and focus is on `body` or in the actions row, focus moves to the notice's first button, or else back to the button that started the action. Focus never moves while the person types in a day field.
- **D12, `keepDataOnError` on `MyShell`.** Every portal write now re-reads, and a failed re-read must not unmount a form holding typed hours.
- **D13, the hand-made re-reads.** Two are removed, the support dialog is narrowed to the 429 path, and the two focus counters are kept.
- **D14, the F1 and F5 reloads that follow another persona's write stay.** There are no live updates across sessions.
- **D15, the new stale-save test lives in the F3 file.** It shares F3's sweep and the serial runner.
- **D16, stages 2a and 2b.** The server check and the form that sends `expectedDays` land in one commit, so no pushed commit has a form that refuses its own second save.
- **D17, the ADR goes in as a dated section in ADR 0051,** with one-line pointers in ADR 0046 and 0057. 0058 is reserved by the paused check branch, and no new ADR is needed.
- **D18, the JSON-keyed editors were checked in the code, and no new e2e was added.**
  - The editors are `settings/roles/roles-page.tsx` and `admin/company-access-page.tsx`.
  - A refused write now re-reads, but it doesn't change `listSettingsRoles` or `getPlatformCompany` answers, and neither carries a field that changes on each read.
  - So their keys stay equal and they keep their drafts. The api-mode suite covers both pages.
- **One delta row.** It covers the `PUT /timesheets` contract change and the form's new behaviour. The re-read itself carries out the plan of record (screens reflect writes, ADR 0051), so it gets no row.

### Decisions taken during the build

#### Stage 1 (the generic re-read)
- **`API_METHODS` is checked with `satisfies HttpRoutes`, not typed `: HttpRoutes`.** The type annotation widened its keys to every ApiClient method, so `keyof typeof API_METHODS` couldn't name the routed ones. With `satisfies`, each factory is still checked against its ApiClient method, and the test's `CASES` record fails to compile when a method has no case or a case has no method. Checked: renaming one case fails `tsc` with TS2561.
- **A file download sends what it sent before.** `blob` shares the transport's one request step (`exchange`) but keeps no JSON `Accept` header. The JSON headers and body come from a small `jsonInit`.
- **The exhaustive test also checks that each write sends exactly one non-GET.** The plan only inferred that from "one re-read on 200".
- **Mutation checks restore from a scratchpad copy, compared byte for byte, not with `git checkout --`.** The files under test held this stage's uncommitted work, and `git checkout` would have thrown it away.

#### Stage 2a (the pure pieces, wired to nothing)
- **`TIMESHEET_CHANGED_MESSAGE` sits next to `overwritesNewerHours`** in `packages/shared/src/hr/timesheets.ts`, so the API and the demo refuse in the same words.
- **The model's typed-text filter moved from the screen into `typeHours`.** It is the same `/[^\d.]/g`, so the screen will keep no copy.

#### Stage 2b (the stale-save check, server and client together)
- **The API tests were written in this session, not by the test-writer subagent.** feature.md step 4 hands them to that subagent, but this session can't spawn one. They follow the plan's list.
- **One `NO_HOURS` for the API tests.** `apps/api/test/support/timesheet-week.ts` holds the seven `"0"` that `hr.int`, `payroll.int`, `california-pay.int` and `portal.int` send as `expectedDays`, so no file keeps its own copy.
- **Every direct `PUT /timesheets` in the HR tests sends `expectedDays`.** That is 10 in `hr.int`, 2 in `payroll.int`, 1 in `california-pay.int` and 1 in `portal.int`. `saveWeek` reads the stored week through `GET /timesheets` with the same cookie, as planned.
- **The new `hr.int` case:**
  - It uses weeks 18 and 19, which no other case in the file touches.
  - It uploads as Wes himself (`own`), with the email read from `GET /employees`, because a later case changes his email.
  - Beyond the plan, it checks that a plain string as `expectedDays` gets the reload words (400), and that a well-formed `"25"` gets 409, not 400, because the check is by shape only.
- **The notice sits above the day fields.** Its days use the same 4- or 7-column grid as the fields, so each saved day sits over its typed one. The numbers go through `<Num kind="quantity">`, which shows two decimals, as the total does.
  - It follows the app's warning note: `text-warning-ink bg-warning/14`, the warning icon and a sentence.
  - One line explains both choices: "Use saved hours drops your changes. Keep my hours replaces the saved hours when you save."
- **When focus moves.**
  - Focus moves only when `busy` or the notice changes, never on the first render, so opening the page doesn't move it.
  - When the notice closes and nothing was clicked, focus goes to the first button in the actions row (Save) instead of staying on the page body.
- **The focus hook's refs are named `…Ref`.** The installed React Compiler lint rules refuse ref access through an object a hook returns ("Cannot access refs during render").
- **The notice's markup test checks the `disabled=""` attribute.** Checking for the word "disabled" would not work, because the Button's classes contain `disabled:`.
- **The API mutation guards the check, it doesn't delete it.** Deleting the `if` would leave its imports unused and fail the build for the wrong reason, so the mutation puts an always-false condition in front of the check.

#### Stage 3 (e2e)
- **The stale-save test has its own describe in the F3 file**, with its own `resetAuthAround`. Tamara enrols an authenticator at each sign-in, and that needs a person without one, while the main describe resets only before and after all its tests. It is still in the F3 file and on the serial runner (D15).
- **F3's steps are shared helpers, not copies:**
  - `reopenWeek` is split out of `sweep`, because the new test needs only the state reset;
  - `uploadInDialog` serves the main test's step 2 and the new test's step 2;
  - `uploadElsewhere` stands for the second tab: it goes through `postAs`, so the open page is not told to read again;
  - `sendBack` serves both clean-ups, and `isSave`, `nextSave`, `SAVE` and `SUBMIT` serve both tests.
- **Step 1 checks the request too.** `page.waitForRequest` reads the PUT body, and `expectedDays` must equal the field's opening value by value. The 409s are awaited with `page.waitForResponse`, because `waitForAnswer` rejects any answer that is not OK (as planned).
- **The F1 blockers are labelled** "B1, STATUS follow-up." and "B3, STATUS follow-up.", so the annotations name what still blocks F1. F5's names B4 only. Both JSDoc headers say B2 is fixed and point to this log.
- **The step-up test in `login.spec.ts` was red on the first full api-mode run (`b2-all-1`), and this branch caused it.**
  - **The cause.** `DataTable` hands each column's inline `cell` function to TanStack's `flexRender`, which mounts it as a component. The users page builds new columns on every render, so every render remounts every cell. The step-up test opened Priya's actions menu as soon as the first change's toast showed; about 35 ms later the users re-read landed, the page rendered again, and the open menu closed. The test then waited out its 60 s. In demo mode a write's emit re-renders at once, so this never showed; in api mode the re-read now lands a round trip after the write.
  - **The fix in the test.** Before opening the menu again, it waits for Priya's row to show "Accountant". That is the re-read's result, so it also pins B2 on the users page.
  - **The product glitch is recorded, not fixed here.** A row menu opened within a round trip of a write closes (ADR 0051 R8, and a STATUS follow-up). A stable cell renderer in `DataTable` fixes every table, but it is shared by every screen, so it is its own task. That is the safest option for this branch.
  - **The knock-on failures.** The failed test never put Priya back, so she stayed Accountant, a role that needs MFA, on the local api e2e database. `meetings.spec.ts` and the reports test E2E-4 then failed at her sign-in. A throwaway probe (`zz-restore-priya.spec.ts`, scratchpad copy only, removed after the run) put her back to Sales through the product, as the test's own restore does. Nothing was reseeded and no table was touched directly.
- **The run order** follows this session's instructions: one build, F2 alone twice, F3 and F4 together, then the whole suite. The plan's pin check and demo run were kept. They took two more builds, each about 10 s with Turbopack's cache. Each build was checked to hold the branch's code: the notice's words in the web chunks, and `expectedDays` in the API bundle.
- **The pin check** cut the render-time adjust down to `setSeen(key)`, keeping `serverHours` referenced so it still built. The new F3 test failed at step 2 ("the form took the upload": expected "6", received "8"). The file was restored from a scratchpad copy, with no diff.
- **The F1 and F5 variants without B2's workarounds** (`b2/throwaway/make-f1-nob2.py`, `make-f5-nob2.py`) keep only B1's cost patch and B3's log (F1) and B4's body rewrite (F5). F1's three remaining reloads follow another persona's write (Grace's confirmations, D14), so they stay.
  - Both passed with no B2 workaround. F1: the customer added from the quote builder shows as chosen, the invoice pills change after each payment and the void, and Ready to cut drops the cut row, each on the same page. F5: the contract page offers Record signature after Send for signature, and the billing, Paid, Mark completed and the release show in place.
  - F1 and F5 register no clean-ups while they are `fixme`, so each variant run left its records on the local api e2e database (a customer, a quote, an invoice with two payments and a cut; a contract with its billings), as the flows session's variants did. CI's database is fresh.
- **`apps/web/.next` holds the demo build after the demo run.** `api-e2e.sh --build` rebuilds before any api-mode run.

## Which test pins which path
| Path | Pinned by |
| --- | --- |
| Upload over an existing draft, one tab (the STATUS payroll case) | New F3 test, step 3 (step 2 before review round 1; api mode, CI); the pin check failed it on a form that never takes server hours; demo G3-3 (Monday) |
| Upload into a week with no sheet | F3 main test, step 2, on CI's fresh database; model case (g) |
| Edited form, then newer hours: the notice, the choice, focus | New F3 test, step 4; model cases (b) and (c) |
| Clean form, stale Submit from another tab: 409, nothing submitted | New F3 test, step 5; the new `hr.int` case; `demo-timesheets.test.ts` |
| One's own save shows no notice | New F3 test, step 1; model cases (d) and (h) |
| After one's own save, the form shows the saved hours until a new read, never the read from before the save (review round 2) | New F3 test, steps 1 and 2 (the save's re-read held, Monday checked once the save has ended); the third pin check failed step 1 on the round-1 form; model case (l) for the hours themselves |
| A save's answer shows only the hours it wrote (review round 1) | The second new `hr.int` case (another writer commits right after the save's transaction); it failed before the fix |
| An answer that differs from the hours sent is taken like any read (review round 1) | Model case (k): a clean form takes it, an edited one asks, both orders |
| After one's own save, a read back at the opening hours is taken, not skipped (review round 1) | New F3 test, step 2 (the save's re-read held while a second tab puts Monday back); the second pin check failed it on the old form; model case (l) |
| A save of the stored hours is taken | The new `hr.int` case; `demo-timesheets.test.ts` |
| Every write re-reads, and no read does | `api-rereads.test.ts`; F2, F3 and F4 on CI; the users page in `login.spec.ts` |
| The queues, the grid and My time off update in place | F3 steps 3 and 5, F4 steps 2 and 3 |
| Pickers, a PO draft, the order and the receipt update in place | F2 |

## Owner questions
None blocks the build.

- **Q1, CI time.** Measured locally: F2 takes 8.5 to 8.9 s and the new F3 stale-save test 2.6 s, plus its two sign-ins. The whole api-mode suite took 117 s (`b2-all-2`). Keep both in `verify` (the open Q1 of PR #42)?
- **Q2, the save-then-submit window.** An upload from elsewhere that lands in the milliseconds between a Submit's save and its submit gets submitted. Those hours are newer, never older, and the approver sees them. Closing the window needs a submit body, which is a second contract change. Wanted?
- **Q3, form tests.** `apps/web` has no React Testing Library or jsdom, so the form's wiring is pinned only by e2e. Add them? That is a new dependency, so it needs approval.
- **Q4, typed hours.** A mistyped `"7..5"` still saves as 0 hours, as it does today (`Number(text) || 0`). Refuse such text on the form instead?
- **Q5, after a 500.** The re-read is still skipped, because a 500 may or may not have committed (the PR #37 note). Re-read after a 500 too?

## For STATUS
- **Done: B2.** Every routed write makes the screens read again: the HTTP transport decides by verb, and four POST reads go through `requestAsRead` (ADR 0051, "Re-reading after every write, and the timesheet stale-save check", 2026-11-16). My timesheet never saves old hours over newer ones: `PUT /timesheets` takes `expectedDays` and answers 409 `timesheet_changed`, the form takes newer saved hours when clean and asks when edited, and the demo does the same. PR #44, this log.
- **"Api-mode bugs the flows found":** remove the B2 bullet.
  - **F2 runs** since B2.
  - **F1 stays `fixme`** for B1 (the salesperson's quote builder crash) and B3 (the Stock panel's "Short by 0.00 ft"). A throwaway variant with only those two worked around passed.
  - **F5 stays `fixme`** for B4 (the contract form's branch id). A throwaway variant with only B4 worked around passed.
  - B1 and B3 still block F1, and B4 blocks F5.
- **Line 132:** "F1, F2 and F5 wait on the bugs B1 to B4" becomes "F2 runs since B2; F1 waits on B1 and B3, F5 on B4".
- **The flows' leftovers:**
  - "F3 a draft week for Bri" becomes "F3 a sent-back week for Bri (the stale-save test's clean-up)";
  - "F2 (once it runs)" becomes "F2";
  - the throwaway F1 and F5 variants of this session left their records on the local api e2e database only.
- **Q1, verify time:** five flows now run (F2, F3, F4, F6, F7), plus the F3 stale-save test. Measured locally: F2 8.5 to 8.9 s, F3 4.3 to 4.6 s, the stale-save test 2.6 s, F4 4.2 to 4.4 s, F6 13.7 to 14.7 s and F7 4.7 s. The whole api-mode suite took 117 s.
- **The PR #37 note,** reworded for the transport: no re-read after a 500 that may have committed, so a retry can duplicate the record.
- **New follow-ups:**
  - **`DataTable` remounts every cell whenever its page renders again** (`flexRender` mounts each inline `cell` as a component, and pages build new columns per render). In api mode the re-read lands a round trip after each write, so a row menu opened in that window closes. Found by `login.spec.ts`'s step-up test, which now waits for the re-read. The fix is a stable cell renderer in `DataTable`, in its own PR (ADR 0051 R8).
  - The two focus counters (`support-access-panel.tsx`, `company-status-page.tsx`) read twice in api mode. This is harmless.
  - **The save-then-submit window:** an upload from elsewhere landing between a Submit's save and its submit is submitted. Those hours are newer, never older (Q2).
  - **A mistyped `"7..5"` saves as 0 hours** (`Number(x) || 0`), as before (Q4).
  - **A tab left open across the deploy** gets "Reload the page, then save your hours again." on its next save.
  - **Dry runs:** the demo emits after a timesheet upload's dry run, and the API doesn't. This is harmless.

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `b2/logs` folder.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `gh pr create --draft …` | draft PR #44 |
| 1 | `heavy.sh pnpm --filter web exec vitest run` on `api-rereads`, `api-router`, `meetings-api` and `imports-api`, before the fix | red as expected: 9 failed, 29 passed. Every write but the meetings and import ones gave 0 re-reads (first: `inviteUser`); the transport cases failed on the missing `withRereads` and `requestAsRead` |
| 1 | the same four files after the fix | 38 passed |
| 1 | `heavy.sh pnpm --filter web typecheck`, then `lint`, then `test` | clean, clean, 27 files and 247 tests passed |
| 1 | five mutations (`b2/mut-s1.sh`): `listPayPeriods` through `request`; no re-read on success; a re-read on GET; 422 dropped; the re-read after `parse` | each failed `api-rereads` or `api-router` (1, 4, 2, 2 and 1 tests); each file restored byte for byte |
| 1 | `heavy.sh pnpm --filter web exec tsc --noEmit` with one case renamed (`clockIn` to `clockedIn`) | exit 1, TS2561 "Did you mean to write 'clockIn'?"; file restored |
| 1 | `pnpm exec prettier --check` on the 15 changed files | 2 needed `--write` (router, router test); clean after |
| 2a | `heavy.sh pnpm --filter @workspace/shared exec vitest run test/hr-people-time.test.ts`, before and after | red (2 failed: the helpers didn't exist), then 15 passed |
| 2a | `heavy.sh pnpm --filter web exec vitest run tests/unit/my-week-hours.test.ts`, before and after | red (no module), then 10 passed |
| 2a | three model mutations (`b2/mut-s2a.sh`, `b2/mut-dec.py`): a clean form keeps its old hours; `typedHours` through decimal.js; rule 3 keeps the notice | each failed the model test: (a), (g) and (j); (j) with `DecimalError`; (i). Each file restored byte for byte. (A first try of the decimal.js mutation used `require`, which ESM doesn't have, so it was redone with an import.) |
| 2a | `heavy.sh b2/checks.sh s2a`: shared `test`, `typecheck`, `lint`; web `lint`, `typecheck` | shared 70 files and 1,046 tests passed; the rest clean |
| 2a | `pnpm exec prettier --check` on the 4 changed files | clean |
| 2b | `heavy.sh b2/checks.sh s2b`: api `typecheck`, `lint` | clean |
| 2b | `heavy.sh pnpm --filter api exec vitest run --project integration test/hr.int.test.ts test/portal.int.test.ts test/payroll.int.test.ts test/california-pay.int.test.ts` (local PostgreSQL on 5432, already up) | 4 files, 85 tests passed |
| 2b | two API mutations (`b2/mut-s2b-api.sh`): the compare guarded off; the "days equal stored" exemption dropped | each failed the new `hr.int` case (1 of 45); files restored byte for byte |
| 2b | `heavy.sh pnpm --filter web exec vitest run` on `timesheets-api`, `demo-timesheets`, `api-rereads` | 3 files, 11 tests passed |
| 2b | `newer-hours-notice.test.tsx` | first run: the expected numbers were "7.5" while `<Num>` shows "7.50"; then the `disabled` check matched the Button's classes. Both expectations fixed |
| 2b | `heavy.sh b2/checks.sh s2b`: web `lint`, `typecheck`, `test` | lint first refused ref access through the focus hook's returned object (3 errors). After renaming the refs: clean, clean, 31 files and 263 tests passed |
| 2b | two web mutations (`b2/mut-s2b-web.sh`): the demo compare guarded off; the factory without `expectedDays` | `demo-timesheets` failed 2 of 2; `timesheets-api` failed 1 of 2; files restored byte for byte |
| 2b | `heavy.sh b2/checks.sh s2b`: shared `test`, `typecheck`, `lint`; api `test` | shared 1,046 passed; clean; clean; api unit 17 files and 124 tests passed |
| 2b | `pnpm exec prettier --check` on every changed TypeScript file | clean |
| 3 | `pnpm exec prettier --check` on the changed e2e files | clean (F3 formatted with `--write` first) |
| 3 | `heavy.sh pnpm --filter web typecheck`, then `lint` | clean, clean |
| 3 | `heavy.sh flows/api-e2e.sh b2-f2-a --build -- …/f2-purchasing-receipt-to-payment.spec.ts` | both builds in 12 s (Turbopack cache; the notice's words in the web chunks and `expectedDays` in the API bundle confirmed); F2 passed, 8.5 s |
| 3 | `api-e2e.sh b2-f2-b` (F2 alone again, no build) | passed, 8.9 s |
| 3 | `api-e2e.sh b2-f3f4-a` (F3 and F4) | 3 passed: F3 4.6 s, the stale-save test 2.6 s, F4 4.4 s |
| 3 | `api-e2e.sh b2-all-1` (the whole api-mode suite) | exit 1 after 211 s: 28 passed, 3 failed, 2 skipped (F1, F5), 2 did not run (the serial login tests after the failure). `login.spec.ts` step-up timed out at 60 s (Priya's menu closed by the users re-read); `meetings.spec.ts` and reports E2E-4 then failed at Priya's sign-in, because she was left as Accountant. Flows: F2 8.5 s, F3 4.4 s, stale-save 2.6 s, F4 4.3 s, F6 13.7 s, F7 4.7 s |
| 3 | `api-e2e.sh b2-restore-priya` (throwaway probe) | passed; Priya's row read "Accountant" before and "Sales" after, with no reload |
| 3 | `api-e2e.sh b2-login-a -- tests/e2e-api/login.spec.ts`, after the test fix | 6 passed, 11.4 s |
| 3 | `api-e2e.sh b2-all-2` (the whole api-mode suite again) | exit 0 after 117 s: 33 passed, 2 skipped (F1, F5). Flows: F2 8.6 s, F3 4.3 s, stale-save 2.6 s, F4 4.2 s, F6 14.7 s, F7 4.7 s |
| 3 | pin check: `api-e2e.sh b2-pin --build -- …/f3-timesheet-to-pay-period.spec.ts --grep "never saves"` with the form never taking server hours | failed at step 2 as intended ("the form took the upload": expected "6", received "8"); `my-timesheet.tsx` restored from the scratchpad copy, no diff |
| 3 | `heavy.sh b2/e2e-demo.sh` (demo build; `--project=flooring` portal, flows-batch3, hr, hr-workspace, admin, admin-billing; `--project=hr` portal, hr; one worker) | flooring 34 passed (G3-3 among them), hr 6 passed |
| 3 | `api-e2e.sh b2-f1-var --build -- …/zz-f1-nob2.spec.ts`, then `b2-f5-var` | both passed (F1 18.0 s, F5 10.1 s); the specs were deleted after and `git status` lists no `zz-` file |
| 5 | `heavy.sh b2/full.sh` (`pnpm lint`, `typecheck`, `test`, `test:api`, `test:hooks`) | all exit 0. Lint and Prettier clean; typecheck clean; `test`: shared 1,046, web 263 (31 files), api unit 124 (17 files), db 18, providers 11; `test:api`: api 627 (35 files), db 59 (8 files), providers 2; hooks 15 |

## Outcome
B2 is fixed. The final runs above are green: the whole api-mode suite (`b2-all-2`), the demo specs and the full checks. Commits on `fix/web-reread-after-write`, each pushed:

| Commit | Subject |
| --- | --- |
| `b6dc8a3` | docs(hr): plan for B2 and the timesheet stale-save rule in the specs |
| `70cc728` | fix(web): every routed write makes the screens read again (B2) |
| `64f09dd` | fix(portal): the week form's hours model and the shared stale-save rule |
| `3d54cdc` | fix(hr): a timesheet save never overwrites hours saved since the form opened |
| `4d417d4` | test(e2e): F2 runs, F3 and F4 drop their reloads, and a stale timesheet save is refused |
| (this commit) | docs: B2, re-read after every write and the timesheet stale-save rule |

All carry `[skip ci]`. Docs in the last commit:
- ADR 0051: the section "Re-reading after every write, and the timesheet stale-save check (2026-11-16, STATUS B2)", with part 3's first two re-read bullets marked superseded and a header line;
- pointers in ADR 0046 and ADR 0057;
- docs/api-contract.md: a Conventions bullet, the `PUT /timesheets` row, the ApiClient row's path, and the meetings line;
- one docs/blueprint-delta.md row.

## Review round 1
A security reviewer and a correctness reviewer each raised one `should_fix` finding, and a skeptic confirmed both. Nothing was blocking. Both findings come from the same gap: My timesheet took its own save's answer as the hours its form started from.

### Findings
1. **Security, `timesheets.service.ts` (`save`):** the answer was read after the commit, on a fresh connection outside the lock. An upload or a clock-out waiting on the same employee lock could commit its hours N in that gap. The answer then showed N, and the form made N its base while it still showed the hours Bri typed (E), with a "Saved" toast and no notice. Her next Save or Submit sent E with `expectedDays` N, the stored week equalled `expectedDays`, so E replaced N unseen, and was then submitted.
2. **Correctness, `my-timesheet.tsx` (`save`):** the same silent overwrite from the client side. `hoursSaved(current, saved.days)` made the answer the base, and `seen` (the last read the form took) changed only on render. A second case: the form opened with A, Bri saved B, and another writer put the week back to A before her re-read landed. That read matched the old `seen` and was skipped. The form kept showing B with base B, and every Save or Submit got a 409 until a reload or a week change.

### Fixes
- **Server:** `save` returns `this.one(tx, sheetId)` from inside the transaction, so the answer is exactly what this save wrote.
- **Client:** `hoursSaved(state, sent, answer)` makes the hours sent the base, then takes the answer through `serverHours` like any read. The form records the answer as its last read (`setSeen(readKey(saved))`). `weekLocked` and `readKey` move into `week-hours.ts`, so the render check and the save build the key the same way.

### Decisions and why
- **Both fixes, not one.** The server fix closes the first finding on this API, but the form should not depend on the answer being exact. The second case of the second finding (a read back at the opening hours being skipped) is client-only, and the server fix does not reach it. The client fix alone would close the first finding too: a clean form takes N, and an edited one asks. But an answer that matches what was written is a contract a client should be able to rely on. Both together is the safest option.
- **The base after a 200 is the hours sent, not the answer.** A 200 means the server held exactly those hours: it wrote them, or already had them (`overwritesNewerHours` takes a save of the stored hours). Hours have at most two decimals (`hoursTextProblem`), so nothing is rounded between what is sent and what is stored.
- **`seen` becomes the answer's key.** The answer is the read the model took last. With the server fix, it holds the same hours as those sent.
- **`hoursSaved` lost its "settled" rule.** `serverHours` always sets `newer`, either to null or to the read, so the rule was redundant once the answer goes through it. Cases (d) and (h) still pass unchanged, apart from the new argument.
- **Right after its own save, a form with no edits quietly takes another writer's hours.** The toast says "Saved", which is true. This is the rule for any read: nothing is lost, and the form shows what is stored. Recorded, not changed.
- **Submit's answer and the other HR answers still read after the commit.** No form takes them as the hours it started from: a submit locks the form, which then shows the re-read. They are outside the findings, so they are left as they are.
- **How the API test makes the race.** The other writer is a direct update of one time entry, on the same pool, run after the save's transaction resolves and before the service goes on. A spy on `TenantConnectionService.db` arms this for one transaction. There is no timing involved. The test failed before the fix: the answer held the other writer's 6 on Tuesday.
- **How the e2e step makes the race.** `page.route` (times 1) holds the save's re-read of `/me/portal` until a second tab has put Monday back to the hours the form read last. There is no timing here either, and the form must end on those hours whichever of the answer and the re-read comes first (model cases (d), (k) and (l)). Monday's values go 8 (step 1), 4 (the save), 8 (put back), then 6 (the dialog). Each differs from the one before, so no upload is skipped as "Already these hours".
- **The client pin check needed the old unit test too,** because `next build` type-checks `tests/unit`. The three files were copied to the scratchpad first (`b2/r1-fixed/`) and restored after. `git status` then showed only the intended changes.
- **No new ADR and no blueprint-delta row.** The plan of record doesn't change. The details go into ADR 0051's dated section, and the contract row now says the answer is the week as this save wrote it.

### Commands (review round 1)
| Command | Result |
| --- | --- |
| `heavy.sh pnpm --filter api exec vitest run --project integration test/hr.int.test.ts -t "answers a save with the hours it wrote"`, before the server fix | failed as intended: the answer was `8,6,8,8,8,0,0`, expected `8,8,8,8,8,0,0` (1 failed, 45 skipped) |
| the same file with `portal`, `payroll` and `california-pay` int tests, after the fix | 4 files, 86 passed |
| `heavy.sh b2/checks.sh r1a api:typecheck api:lint`; `prettier --check` on both files | clean, clean, clean |
| `heavy.sh pnpm --filter web exec vitest run tests/unit/my-week-hours.test.ts`, the new cases on the old model | failed as intended: (k) the form did not take the answer, (l) no `readKey` (2 failed, 10 passed) |
| the same with `demo-timesheets` and `timesheets-api`, after the fix | 3 files, 16 passed |
| `heavy.sh b2/checks.sh r1b web:typecheck web:lint`; `prettier --check` | clean, clean, clean |
| pin check: `api-e2e.sh b2-r1-pin --build -- …/f3-timesheet-to-pay-period.spec.ts --grep "never saves"` with the old `week-hours.ts`, `my-timesheet.tsx` and unit test (the server fixed) | failed at the new step 2 as intended ("the form took the hours saved after its own": expected "8", received "4"). The first try didn't build, because the new unit test needs the new model; the old test was then swapped in too |
| `api-e2e.sh b2-r1-f3f4 --build -- …/f3-… …/f4-…` with the fix restored | 3 passed: F3 5.1 s, stale-save 2.5 s, F4 4.4 s |
| `heavy.sh b2/e2e-demo-r1.sh` (demo build; `--project=flooring` portal and flows-batch3, `--project=hr` portal; one worker) | flooring 16 passed (G3-3 among them), hr 1 passed |
| `api-e2e.sh b2-r1-all --build` (the whole api-mode suite) | exit 0 after 2.0 min: 33 passed, 2 skipped (F1, F5). Flows: F2 8.7 s, F3 4.5 s, stale-save 2.7 s, F4 4.5 s, F6 13.1 s, F7 4.7 s |
| `heavy.sh b2/full.sh` (`pnpm lint`, `typecheck`, `test`, `test:api`, `test:hooks`) | all exit 0. Lint and Prettier clean; typecheck clean; `test`: shared 1,046, web 265 (31 files), api unit 124 (17 files), db 18, providers 11; `test:api`: api 628 (35 files), db 59 (8 files), providers 2; hooks 15 |

### Commits (review round 1)
| Commit | Subject |
| --- | --- |
| `7ae53ec` | fix(hr): a timesheet save answers with the hours it wrote |
| `8df47f1` | fix(portal): the week form takes its own save's answer as a read |
| (this commit) | docs: B2 review round 1, the save's answer and the form's last read |

## Review round 2
One finding, raised by the security reviewer as blocking and confirmed by a skeptic as `should_fix`. It was a real regression from review round 1's client fix.

### Finding
**`my-timesheet.tsx` (`save`): after every own Save, the form put back the hours from before the save.**
- `save()` recorded the answer as the last read (`setSeen(readKey(saved))`). The `sheet` prop was still the read from before the save until the save's re-read landed, a round trip later.
- So the next render saw that old read as new, and `serverHours` on a clean form took it. Monday showed 6.5 again next to the "Saved" toast.
- A failed re-read (`keepDataOnError`) left it there. A Submit in that window sent 6.5 with `expectedDays` 6.5, and the server, holding 8, answered a false 409. Typing in that window showed a bogus notice holding her own old hours.
- Model case (l) asserted the revert as correct. F3 step 2 passed either way, because the reverted value equalled the hours the second tab put back.

### Fix
- **Reads are told apart by identity, not content.** `WeekForm` gets the portal read itself (`read={portal}`) and keeps the one it took last (`taken`). It runs `serverHours` once per new read object. `useApiQuery` sets a new data object on every successful read (JSON parse in api mode; a new object literal from the demo's `myPortal`), and a failed re-read keeps the same one.
- **`save()` only applies the answer** (`hoursSaved`). It no longer touches the last read. `readKey` is removed, as nothing else used it.
- **Model case (l)** now checks what the model owns: after its own save, the form shows and saves the saved hours (`expectedDays` equal to them, so a quick Submit is not refused); the save's re-read changes nothing; a new read back at the opening hours is taken.
- **F3's stale-save test.** A shared `holdPortalRead` holds the save's re-read, and `saveWithReadHeld` is used in steps 1 and 2. Once the save has ended (answer in, re-read held, Save enabled again), Monday must show the saved hours. Step 1 then releases and checks again. Step 2 then has the second tab put the old hours back, releases, and checks the form takes them.

### Decisions and why
- **The portal object, not the `sheet` object, as the identity.** A week with no sheet reads as `undefined` every time, so `undefined` cannot tell two reads apart. The portal object is new on every answer.
- **Identity covers both rounds' cases.** It never takes the old read again (round 2), and it always takes a new one, even one back at the opening hours (round 1). Taking a read with the same hours as before is harmless: `serverHours` gives the same form, or clears a notice whose hours the typed or base hours already match.
- **The take-each-read-once rule stays in the component, and the e2e pins it.** It is a single comparison, and the bug was in the wiring: which object is compared, and that `save()` leaves it alone. Moving it into the model would only test `===`. `apps/web` has no React Testing Library (Q3), so the F3 test is the pin. With the re-read held, the old form shows the opening hours for as long as the hold lasts, so the check cannot pass by timing.
- **Step 1 holds its re-read too.** A check right after the toast alone would retry until the re-read landed and put the saved hours back, so it would pass on the old form.
- **Step 2 waits for Save to be enabled, not for the toast.** Step 1's "Saved" toast may still show, and a second one would make the toast locator match two elements.
- **If the save's re-read were taken before its answer**, a read holding hours written right after the save would set a notice that the answer then clears. This is not new, and it does not happen in practice: the re-read starts when the PUT's response arrives and needs a round trip, while the answer is already in. Recorded, not changed.
- **No new ADR and no blueprint-delta row.** ADR 0051's dated section gets the identity rule, the third pin check and the test note.

### Commands (review round 2)
| Command | Result |
| --- | --- |
| `heavy.sh flows/api-e2e.sh b2-r2-pin --build -- …/f3-timesheet-to-pay-period.spec.ts --grep "never saves"`, the new test on the round-1 form | failed at step 1 as intended: "the form shows the hours it saved before the save's re-read lands", expected "8", received "5" (the opening hours) |
| `heavy.sh pnpm --filter web exec vitest run` on `my-week-hours`, `demo-timesheets` and `timesheets-api`, after the fix | 3 files, 16 passed |
| `heavy.sh b2/checks.sh r2 web:typecheck web:lint`; `prettier --check` on the four changed files | clean, clean, clean |
| `api-e2e.sh b2-r2-f3f4 --build -- …/f3-… …/f4-… tests/e2e-api/portal.spec.ts` | 4 passed: F3 5.3 s, stale-save 3.0 s, F4 4.5 s, portal |
| `api-e2e.sh b2-r2-all` (the whole api-mode suite) | exit 0 after 135 s: 33 passed, 2 skipped (F1, F5). Flows: F2 8.2 s, F3 4.8 s, stale-save 3.2 s, F4 4.8 s, F6 13.6 s, F7 5.1 s |
| `heavy.sh b2/e2e-demo-r2.sh` (demo build; `--project=flooring` portal and flows-batch3, `--project=hr` portal; one worker) | flooring 16 passed (G3-3 among them), hr 1 passed |
| `heavy.sh b2/full.sh` (`pnpm lint`, `typecheck`, `test`, `test:api`, `test:hooks`) | all exit 0. Lint and Prettier clean; typecheck clean; `test`: shared 1,046, web 265 (31 files), api unit 124 (17 files), db 18, providers 11; `test:api`: api 628 (35 files), db 59 (8 files), providers 2; hooks 15 |

### Commits (review round 2)
| Commit | Subject |
| --- | --- |
| `8b7fb3e` | fix(portal): the week form takes each read once, told apart by identity |
| (this commit) | docs: B2 review round 2, the week form tells reads apart by identity |

## Review round 3 (final, clean)
- Fresh security-reviewer and correctness reviewers read the whole branch at `738e0e9` (0042b89...738e0e9). Neither found anything blocking or should-fix, so no skeptic pass was needed.
- **The security review checked:**
  - `PUT /timesheets`: the check order, the employee and sheet locks, comparison by value, and the shape-only `expectedDays`. A 409 rolls back with no audit row.
  - Who may save whose week is unchanged.
  - The transport: GETs never re-read; an answered non-GET re-reads once (200, 400, 403, 404, 409, 422); 0, 401, 429 and 5xx don't.
  - The four POST reads go through `requestAsRead`.
  - Demo parity, and the tests asserting what they claim.
  - It re-ran the targeted unit tests.
- **The correctness review checked** all 146 routed methods, every `useApiQuery` reader for loops, the form model's cases, each STATUS symptom, and JSDoc. It ran 56 web unit tests, 15 shared tests and the full `hr.int.test.ts` (46 passed).
- **Notes kept for later:**
  - the save-then-submit window (Q2);
  - a row menu closing on the re-read (the `DataTable` follow-up);
  - `onRefused` also reading on the 409 open-request refusal (a second, harmless read);
  - wording in the spec about hours from another tab;
  - the demo saving submitted or closed weeks, which the API refuses (older than this branch);
  - a test name ("calls nothing from a transport built without withRereads") that claims more than it checks.

## Left
- The handoff (this commit; STATUS, BRANCHES and this log) carries no `[skip ci]`, so CI runs. Then PR #44 is marked ready, waits for `verify` and `e2e`, and self-merges under the CLAUDE.md rule, with the round 3 security summary posted as its review comment.
- The `DataTable` follow-up (a stable cell renderer), in its own PR.
- **Next prompt:** "B3, the next task of the owner's queue of 2026-11-16: on a new branch `fix/web-stock-short-by` from an up-to-date main, make the invoice's Stock panel test `shortBy` as a decimal (`dec(r.shortBy).gt(0)`, `invoice-stock.tsx:92`) with a unit test, keep F1 `fixme` until B1 is fixed too, and self-merge under the CLAUDE.md rule."
