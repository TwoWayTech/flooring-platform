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
(Filled in at each stage.)

## Owner questions
None blocks the build.

- **Q1, CI time.** F2 and the new F3 stale-save test add about 20 to 25 s to each `verify` run. Keep them in `verify` (the open Q1 of PR #42)?
- **Q2, the save-then-submit window.** An upload from elsewhere that lands in the milliseconds between a Submit's save and its submit gets submitted. Those hours are newer, never older, and the approver sees them. Closing the window needs a submit body, which is a second contract change. Wanted?
- **Q3, form tests.** `apps/web` has no React Testing Library or jsdom, so the form's wiring is pinned only by e2e. Add them? That is a new dependency, so it needs approval.
- **Q4, typed hours.** A mistyped `"7..5"` still saves as 0 hours, as it does today (`Number(text) || 0`). Refuse such text on the form instead?
- **Q5, after a 500.** The re-read is still skipped, because a 500 may or may not have committed (the PR #37 note). Re-read after a 500 too?

## For STATUS

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `b2/logs` folder.

| Stage | Command | Result |
| --- | --- | --- |
