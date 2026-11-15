# Session 2026-11-15 12:10, B (Claude): meetings on the API, part 3 (the web)

Module 14 of docs/real-build-plan.md ("Meetings, invites and .ics", spec meetings.md). Part 3, after part 1 (PR #33) and part 2 (PR #35). Branch `feat/meetings-web-api`, from `origin/main` at `8ddf7fa` (part 2, PR #35, on top of platform admin part 1, PR #34), in its own worktree (`../flooring-platform-meetings`), because another build (platform admin part 3, PR #36, `feat/platform-audit-support`) runs in the main checkout. The draft PR is #37, opened right after this log's first commit; its number goes into BRANCHES at the handoff.

## Prompt
- **Queue order** (owner, 2026-11-15, STATUS "Next three tasks"): meetings; platform admin and manual billing; reports; import; cross-module api-mode e2e flows; the whole-product check; the P13 security review last. Meetings part 3 is the web on the API, with api-mode e2e. Part 4 (later occurrences' reminders, contacts and leads as guests, Settings → Meetings on the API) waits for the owner and stays out.
- **Decision rule** (the owner is asleep and asked for the safest option, recorded): meetings.md is the approved behaviour. Deviate only in the safer direction (less exposure, deny by default, refuse what can't be done correctly), and record each deviation in docs/blueprint-delta.md and ADR 0051 "Part 3".
- **Limits:** no new or altered table, no migration, no new dependency, and no behaviour change in `apps/api/src/core/auth` or `core/tenancy`. The only API behaviour change is A.3 below (undo checks the SEQUENCE first), which the contract forces.
- **This laptop:** heavy commands (integration tests, full typecheck, lint, `pnpm test`, `next build`, Playwright) go one at a time through the scratchpad lock. The worktree has no env file, so integration tests get the CI throwaway database variables inline. Api-mode e2e runs against the throwaway PostgreSQL on 5433 with a throwaway seed password, never re-created or reseeded. Ports 3000 and 4000 are checked free before and after every Playwright run. Nothing is built or tested in the main checkout.

## Inputs
- docs/product-spec/meetings.md: views, "Who uses it", the rules, "Edge cases and known limits" and "Real build".
- ADR 0051, parts 1 and 2: "Later parts", the residual risks and the owner questions.
- docs/api-contract.md: "Meetings (real build, ADR 0051)", "Undo answers" and the portal table.
- docs/STATUS.md: "PR #35 final review notes" (the stale undo toast) and "Meetings part 2 residual risks".
- The part 1 and part 2 session logs, and docs/product-spec/notifications.md.
- A first plan, a critic's review of it (six must-fix and sixteen should items) and the final plan. They sit in the session scratchpad, not in the repo, so this log restates the plan.

## Plan

### Scope
- **Shared:** screen rules on meetings as the server shaped them, one copy of the refusal texts, the guest readers moved from the API, `DEMO_PRODID` exported, and `undoProblem` checking the SEQUENCE before the mover.
- **API:** a pure refactor onto those texts and readers (same words, same behaviour), plus the undo check order.
- **ApiClient:** two new methods (`meetingsData`, `myMeetings`). Twelve meetings methods join `API_METHODS`: those two and ten existing ones. Routed writes tell screens to re-read; `useApiQuery` keeps only the newest read.
- **DemoStore:** meetings move onto the shared rules, so the demo and the API refuse and shape alike.
- **Screens:** gating from the shaped meeting, the reader's id from the server, guests from the server, the move dialog on the move rules, Undo by SEQUENCE, "Busy" with a time, a drawer that follows its occurrence, My meetings on its switch and module, and Settings → Meetings hidden in api mode.
- **Not in part 3:** part 4, the company's day for any module (A.5), the Outbox, bell and Simulate reply in api mode (notifications screens).

### Stages and commits (one commit each, pushed)
1. **Start:** this log, then the draft PR.
2. **Shared** (`packages/shared/src/meetings`, `calendar/ics.ts`):
   - `access.ts` gains `shownParty`, `organiserAddressShown`, `changeableAsShown`, `decidableAsShown`, `MEETING_REFUSALS` (the API's texts today) and `changeRefusal` (exactly `lockChangeable`'s choice of words). Existing functions are unchanged.
   - `guest-sight.ts` (new): `readsCustomerGuests` and `readsSupplierGuests`, the API's `readsCustomers` and `readsSuppliers` with their bodies unchanged. Exported from `meetings/index.ts` only, not from `src/index.ts`, which PR #36 edits.
   - **A.3** `moves.ts` `undoProblem`, new order: no record or cancelled → `meeting_changed`; a SEQUENCE mismatch (current against the record's after, client against its before) → `meeting_changed`; not the mover → 403; too old → `undo_expired`. Both orders refuse and write nothing.
   - `ics.ts`: `export const DEMO_PRODID`.
   - Tests: a property test that `changeableAsShown` on a shaped meeting implies `canChangeMeeting` on the stored one (meetings × viewers × sights, hidden lists included), the two M1 fixtures (a branch Manager not on a hidden-list meeting with a customer outside their sight, then inside it), decisions, `changeRefusal`, the guest readers, and a stale undo toast answering `meeting_changed`.
3. **API** (`apps/api/src/modules/meetings`): `lockChangeable` uses `changeRefusal`; `notTheOrganiser` and `cantSeeEveryGuest` go; the zone, decide, answer, request and invites texts come from `MEETING_REFUSALS`; `meeting-records.ts` and `meeting-guests.ts` call the shared guest readers. One integration case: after the owner's move and the manager's newer move, the owner's undo answers 409 `meeting_changed` and writes nothing, and the manager's undo answers 201. Run `meetings`, `meetings-moves`, `permissions` and `isolation`.
4. **Web client, re-reads:** the router gets a `changed` channel (factories take a third argument that existing ones ignore; `subscribe` joins router listeners with DemoStore's). New `latest-run.ts` tickets in `useApiQuery`, so an older read that finishes late is dropped.
5. **Web client, contract and routes:**
   - `MeetingsData` `{ viewerUserId, meetings, guests, colleagues, newGuestHandling }`, `meetingsData()` and `myMeetings()` in `contract.ts`; DemoStore gets both so it still implements `ApiClient`.
   - `meetingsData`: `GET /meetings`, `GET /meeting-guests` (403 or 404 → no guests), `GET /me/meetings` only with requests and invites on (403 or 404 → none), and `GET /auth/context` only when `/me/meetings` gave no answer. `newGuestHandling` is always "none" on the API.
   - `myMeetings`: `GET /me/meetings`, with 403 or 404 read as nothing to show.
   - The ten writes and reads at the contract's paths, with bodies that carry only what the server reads: a guest as `{ kind, id }`, a new guest as `{ email, name }`, a PATCH with only the defined keys, an undo as `{ sequence }` and nothing else.
   - `wrote`: a re-read after a write the server answered, success or a 400, 403, 404 or 409; none after a network failure, 401, 429 or 5xx.
   - Stay on DemoStore in api mode: `simulateReply`, `list` and `get("meetings")`, `updateSettings("meetings")`.
   - Fix the stale "My meetings stays on the demo client" comment above `myPortal`.
6. **DemoStore on the shared rules:** new `demo/meeting-sight.ts` (one subject: the signed-in person with the viewed role's keys and scope; `visibleMeetings`, `guestOptionsFor`, `colleaguesFor`), `demo/meeting-sends.ts` (`deliver` from `sendPlan`, `syncReminder` after every change), `demo/meeting-moves.ts` (reschedule, undo, decide, and an in-memory `MeetingMoveMemo`), `meeting-actions.ts` rewritten on `changeRefusal`, the input, edit, cancel, reply and request rules, and `store.ts` wiring kept beside the existing meetings methods. `FILTERS.meetings` in `scope.ts` goes if nothing else reads it. Every action checks `meetings.calendar`; removals, answers, decisions and Simulate reply also check `meetings.invites`.
7. **Screens:** pure helpers `meeting-rights.ts` (`meetingRights`, `meetingOffers`, injectable `MeetingSwitches`), `use-meeting-viewer.ts`, `time-text.ts`, `conflict-warning.ts`, `current-occurrence.ts` (`keyOf`, `occurrenceAt`, `movedKey`) and `scope-choices.ts` (`moveProblem` per scope with its own reason). Then `meetings-page.tsx` (one `meetingsData` query, the drawer held as an occurrence key), `time-grid.tsx` (`canMove` per meeting, `canCreate`), `use-reschedule.tsx` (refused scopes left out with their reasons, the drawer following the move, Undo refusals shown), `meeting-answers.tsx`, `new-meeting-dialog.tsx` and `guest-picker.tsx` (options from the server, guests only with invites on), My meetings (`myMeetings`, the switch and the module), and Settings → Meetings marked `demoOnly`, left out of menus, search, palette and the access preview in api mode, its route a 404 there.
8. **Tests:** web unit tests in Node with no DOM (router, latest run, the meetings routes and bodies, demo-only menus, the screen helpers, the demo store driven through `new DemoStore` and `openCompany`, and the switches through `vi.mock`); demo e2e additions in `meetings.spec.ts` and `meetings-invites.spec.ts`; one api-mode spec `tests/e2e-api/meetings.spec.ts` (the manager and Priya in two contexts: schedule, Busy, undo, propose, decide, My meetings, the settings 404, cancel), with one `SALES_EMAIL` constant added to `accounts.ts`.
9. **Docs:** ADR 0051 "Part 3", a blueprint-delta row, api-contract, meetings.md and notifications.md as built.
10. **Review:** full checks through the lock, `/review`, then a fresh security-reviewer whose brief names the client gating and its proof, the request bodies, `wrote`, the undo order, the `lockChangeable` and guest-reader refactor, and the demo's rules. No schema change, so no schema-reviewer.
11. **Handoff:** STATUS, BRANCHES and this log; the last commit runs CI; ready; self-merge once `verify` and `e2e` are green.

If the session runs short after stage 7 with the demo e2e green, hand off with the PR as a draft.

### Key points
- **Why the screen gating is safe (M1):** for a non-organiser, `meetingForViewer` shows other guests' addresses exactly when the server found they may change the meeting. The organiser's staff row keeps its address then, and is blanked or left out otherwise. So "the organiser's address is shown" holds exactly when the server would allow the change, given a stored organiser address (control users always have one, and every seeded and fixture meeting has it). An empty one fails closed. The organiser always gets every guest, and a guest they can't read is shown by kind with no address, which `shownParty` reads.
- **The company's day (A.5): no change for meetings.** Every `Meeting` carries its zone, nothing meetings send is refused for a one-day offset (the start bound is 366 days back and 1096 ahead), and times are shown "in" the zone. Changing `today()` in api mode touches about 55 call sites in every module, and doing it for meetings alone would split the calendar's day from DemoStore's shifted data. The STATUS follow-up stays open.
- **Overlap with PR #36:** each meetings addition stays in its own block next to the existing meetings code in `contract.ts`, `demo/store.ts` and `http/api-methods.ts`. `accounts.ts` gets one constant. `global-setup.ts`, `vitest.config.ts`, `tsconfig.json`, `screens.ts`, `responsive.spec.ts` and `packages/shared/src/index.ts` are left alone. Whichever PR lands second merges main in.
- **Not touched:** tables, migrations, dependencies, core/auth, core/tenancy, packages/providers, CLAUDE.md, `.claude/`, `.github/`, FEATURES.md (statuses stay `demo`) and `tests/e2e/helpers.ts`.

## Decisions and why
Each goes into ADR 0051 "Part 3" and the blueprint-delta row.

1. **Controls follow the server's own shaping.** A non-organiser is offered drag, resize, Reschedule, Edit details, Cancel meeting and Remove only when their own keys and scope allow it and the meeting as the server sent it shows the organiser's address. The organiser is checked with `canChangeMeeting` and `shownParty`. Why: the screen can then only hide a control the server would allow, never offer one it refuses; a property test proves it.
2. **Accept time and Decline time show only to the organiser who may change the meeting;** answers, Remove and decisions only while `meetings.invites` is on. Why: the server refuses the rest (part 2), and a switched-off feature is hidden everywhere (rule 13).
3. **The guest picker, "Hide the guest list" and "You're the organiser." show only while invites are on,** and with invites off the form sends no guests. Why: rule 13; the API refuses guests then.
4. **The organiser is never sent as a guest;** a guest travels as `{ kind, id }`, a new guest as `{ email, name }`. Why: the server takes names and addresses from its own records, so the client sends no more than it reads.
5. **The reader's id comes from the server:** `viewerUserId` of `GET /me/meetings`, else `user.id` of `GET /auth/context`, never the demo persona's fixture id. Why: the meetings name people by the session's user id on the API.
6. **The move dialog leaves out every scope the shared `moveProblem` refuses for the drop,** with that rule's own reason; with none left, only the reasons and Cancel. Why: one rule, the shared one, so the screen never offers a move the server refuses for that reason; the server still decides.
7. **Undo sends only the SEQUENCE, and every refusal is shown.** The API checks the SEQUENCE before the mover, so a stale toast after someone else's move answers 409 `meeting_changed`, as api-contract says. Why: the contract gap in the STATUS PR #35 note; both orders refuse and write nothing, and the caller already holds the SEQUENCE, so nothing new is exposed.
8. **"Busy" stays "Busy",** shown with the time the API gives. Why: the screen never fills in a title from anything else it holds.
9. **Request shows only when there is a colleague to ask,** on both pages. On the Meetings page that list comes from `GET /me/meetings`, so a role without the portal key, or with `hr.portal` off, gets no Request, in the demo too. Why: deny by default; no route offers colleagues otherwise (owner question 2).
10. **My meetings honours `meetings.calendar` and the meetings module:** the tab and page are hidden when either is off, the demo refuses as the API does, and the api client reads a 403 or 404 as nothing to show. Why: rule 13 and the module check.
11. **Settings → Meetings and "Save under customer" are hidden in api mode** (menu, settings home, search, palette, access preview; the route answers 404). New guests are never saved as contacts or leads on the API. Why: the page would save to DemoStore while the API reads the stored group; part 4 builds it.
12. **The demo refuses what the API refuses,** shapes every meeting for its reader, warns about no meeting in its own conflicts and names no meeting the mover can't read; the switch checks are the same. Why: one behaviour in both modes, and the demo stops showing private titles.
13. **The demo's undo lives only in memory.** A reload forgets the move and the stale toast is refused in the API's words; the client's copy of the meeting is never applied. Why: the API rebuilds from its own audit record, while the demo's audit entries keep its own text, not a move record to rebuild from, so the memory is the demo's server-side copy.
14. **A re-read follows every routed write the server answered,** refusals (400, 403, 404, 409) included; a network failure, 401, 429 or 5xx triggers none, and the meetings queries keep their data when a re-read fails. Why: a stale screen catches up after a refusal without hammering a failing server.
15. **The newest read wins:** `useApiQuery` drops an older read that finishes after a newer one. Why: with re-reads after writes, an old answer could otherwise overwrite a fresh one.
16. **The drawer follows its occurrence and closes when that occurrence is gone.** Why: it never offers a move against an occurrence that no longer exists, or a second cancel.
17. **Demo View as uses one subject for meetings:** the signed-in person's id with the viewed role's keys and scope, for the list, guest sight, the drawer and every action. Why: mixing a borrowed persona's id with another's sight could show or allow what neither would.
18. **Demo new-guest saving is narrowed** (demo-only): a contact only under a customer the reader can see, a lead only for a reader who holds `customers.customer.create`; otherwise the guest is invited and not saved. Why: no write the reader couldn't make by hand.
19. **The company's day: no change** (A.5 above).
20. **Simulate reply, the Outbox and the bell stay on DemoStore in api mode.** Why: they are the notifications module's screens, not meetings'.

## For the owner (part 3)
Also in ADR 0051 "For the owner (part 3)".

1. **The "may change" signal:** a non-organiser's change controls show only when the server's shaped meeting gives them the organiser's address, which it does exactly for someone who may change it. Should the API send an explicit "may change" flag with each meeting instead (a contract addition, later)?
2. **Request needs the portal:** Request a meeting on the Meetings page needs `GET /me/meetings` (the portal key and switch), in both modes. Should a `GET /meeting-colleagues` route (or `colleagues` on another route) let a role without the portal request from the calendar? Part 3 hides Request for them.
3. **Demo View as:** for meetings it uses the signed-in person with the viewed role's keys and scope, customer sight included; other demo lists borrow the role's first user. Keep, or borrow for meetings too?
4. **Form defaults in api mode:** the New meeting form's default reminder and hide-list checkbox come from the demo's Settings → Meetings until part 4 (Summit's stored group is the same). Fine until then?
5. **Move dialog reasons:** the dialog leaves out the scopes the move rules refuse and shows each rule's reason. Keep, or show them disabled with the reason?
6. **Demo undo:** the demo forgets an undo on reload. Acceptable for a presenter tool?
7. **Demo new guests:** contacts are saved only under a customer the reader can see, and leads only for someone who may create customers. Keep?
8. **Part 2's open questions still stand:** the 5-minute window, a CANCEL to an undone split, past exceptions, held occurrences, "this and following" from the first occurrence, 100 exceptions, declining audited, the caps' status code, the start bound, a "Busy" conflict's time, and Outlook and SEQUENCE.

## Decisions taken during the build
Each is in ADR 0051 "Part 3" and the blueprint-delta row. None changes the API beyond A.3.

### Shared and API (commits 2 and 3)
- **The guest readers take an optional feature register** (default `FEATURES`, as `featureOn` does), so a test can switch `sales.customers` or `purchasing.suppliers` off. The API calls them with the access only, so its behaviour is unchanged. They have their own type, `GuestReaderAccess`.
- **The property test is wider than planned:** every flooring role for each of five people (the organiser, a guest, a branch Manager not on the meeting, the Owner not on it, a warehouse user), plus a hidden-list meeting with a supplier, so "customers only" sight differs from "all". Three fail-closed meetings run in the safety test only: an organiser row with no address, no organiser row, and a readable customer named "Customer" with no address. The exact-match test shows the last as the one place the screen hides a change the server would allow.
- **Step 3 is one commit,** with the refactor and the new integration case in one subject.

### Web client and demo store (commits 4 to 6)
1. **`applyScope` refuses meetings:** it returns no meetings at all, rather than dropping the filter, so a later caller can't read every meeting at scope `all`.
2. **Simulate reply also needs the reader to see the meeting** (`seesMeeting`), on top of "the organiser or `settings.outbox.view`", and matches the guest by recipient kind as well as id. A private meeting the reader is not on gets no Simulate reply (plan C.9).
3. **A demo request goes only to a colleague `colleaguesFor` offers,** as the plan says. That is stricter than the API, which checks the colleague only, so in the demo a request also needs the portal key and switch.
4. **Any answer forgets the undo memory, even a stale one.** On the API every answer writes an audit entry, which already blocks the undo.
5. **A change or move of a split-off series forgets the undo of the move that created it.** On the API its undo checks that the split's last entry is still the split.
6. **New-guest saving is narrowed further:** a lead is saved only for a reader who reads customers (the `core` module, the view key and the switch) as well as creates them.
7. **A request's reminder** is the default from Settings → Meetings, checked against the reminder choices, as the API's settings reader does.
8. **Without the meetings module** the demo's `myMeetings` refuses with "This feature is switched off.", where the API answers 403. The screen hides the page either way.
9. **Ids in request paths are escaped** with `encodeURIComponent`.
10. **Commit 5's placeholders denied by default** (no guests, no colleagues, an empty My meetings) until commit 6 replaced them.

### Screens (commit 7)
1. **Request needs both switches on screen:** `meetingOffers` shows Request only with `meetings.requests` and `meetings.invites` on, the create key and at least one colleague. Both clients already return no colleagues then; this guards the screen too.
2. **"Save under customer" needs a readable customer:** it shows only when new guests become contacts and the options include a customer. Otherwise `customerId` is sent as null.
3. **Undo moves the drawer back:** after a successful Undo an open drawer returns to the occurrence it showed before the move, so an undone split or "all" move does not just close it.
4. **The drawer closes while rendering, not in an effect:** the lint rule `react-hooks/set-state-in-effect` refused the plan's `useEffect`. The page clears the key while rendering, guarded by "data ready and the occurrence is gone". The behaviour is the same, and a meeting that comes back stays closed. (Review round 1 changed the guard: see "Reviews".)
5. **Guarded dialogs:** the Request dialog also needs Request to be offered, and Edit details closes itself if a re-read takes the change away.
6. **With invites off, New meeting still sends the default hidden-list value;** the checkbox is hidden and no guests are sent.

### Fixes (commits 9 to 12)
1. **`04425f1`, a wrong test:** `openSeeded` looked for seeded meetings in the Agenda, which starts today. The fixtures move meetings by whole weeks (`date-shift.ts`), so the Friday and Saturday ones were already past on a Sunday and four tests timed out. It now opens them in the Week view, where they always are.
2. **`47a1581`, a product bug:** a move made from the open meeting drawer offered an Undo that could not be clicked. The drawer is a modal sheet, which turns pointer events off outside itself, and a conflict warning came as a second toast stacked over the Undo. Now the warning is the description of the move's own toast, that toast takes pointer events back, and a click on a toast no longer closes the drawer (`onInteractOutside` ignores `[data-sonner-toaster]`). A new demo test covers it. No API change.
3. **`6bbb6c8`, a wrong test:** the api spec expected HTTP 404 for `/settings/meetings`, but inside the app shell Next answers every not-found page with status 200 (a probe of an unknown address, deleted afterwards, showed the same). The page does call `notFound()`. The test now checks Next's not-found marker in the page, the no-access text, and that no Meeting settings control shows.
4. **`12b40ef`, a wrong test:** the step-up test in `tests/e2e-api/login.spec.ts` could end before its revert was sent, because its `.last()` toast check matched the first change's toast. That left Priya as Accountant, a role that needs MFA, so the meetings spec stopped at the two-step set-up whenever it ran after it, as CI orders the files. The test now waits for the revert's PATCH and expects it to succeed. Running the fixed spec put Priya back to Sales through the product; no SQL and no reseed.
- **Confirmed by the runs:** Priya's proposal survives a move and its Undo; the API's proposal reads "Proposes <day> at 16:00"; switching persona inside one demo browser keeps the demo's data.

## Checks run
Heavy commands went one at a time through the scratchpad lock. Integration tests got the CI throwaway database variables inline and ran against the docker compose PostgreSQL on 5432. Api-mode e2e ran against the throwaway PostgreSQL on 5433 with a throwaway seed password, which was neither re-created nor reseeded. Ports 3000 and 4000 were free before and after every Playwright run. Nothing ran in the main checkout.

- **Plan (commit 1):** no code, so no checks.
- **Shared (commit 2):**
  - the two meetings test files (`meeting-access`, `meeting-moves`): 61 passed;
  - the whole packages/shared suite: 55 files, 678 tests passed;
  - `pnpm -s --filter @workspace/shared typecheck` and ESLint on the touched files: clean;
  - a mutation check: with the `organiserAddressShown` test removed from `changeableAsShown`, three of the new tests failed; the file was restored.
- **API (commit 3):**
  - `pnpm -s --filter api typecheck` and `lint`: clean; Prettier reformatted two shared test files and `meetings.service.ts`, then passed;
  - integration `meetings`, `meetings-moves`, `permissions` and `isolation`: 4 files, 103 tests passed. The log's ERROR lines ("Do not know how to serialize a BigInt" from `sensitive-fields.ts`, "No control.", "declares no permission") come from code this branch does not touch, in tests that pass.
- **Web client and demo store (commits 4 to 6):**
  - `pnpm -s test`, `typecheck` and `lint` in apps/web at each step: exit 0, ending at 9 files and 63 tests; Prettier clean;
  - two mutation checks, files restored after each: letting the reader see every customer failed two demo tests (the M1 case and View as); having Undo send the remembered SEQUENCE instead of the screen's failed the undo test;
  - the store's smoke test passed in Node, so the plan's fallback was not needed.
- **Screens (commit 7):**
  - apps/web `test` (11 files, 70 tests), `typecheck` and `lint`: exit 0; Prettier clean;
  - demo e2e (plan 8.4, a demo build): the seven flooring spec files 196 passed, flows-batch3 flow 6 passed, the HR meetings spec passed;
  - a throwaway spec took screenshots of New meeting and the move dialog at 375 px in light and dark; both read cleanly, and the spec was deleted.
- **Tests (commit 8):** apps/web `test` (11 files, 70), `typecheck` (which covers `tests/`) and `lint`: exit 0. No Playwright run at that step.
- **Fixes (commits 9 to 12):**

| Check | Result |
| --- | --- |
| packages/shared meetings unit tests (8 files) | 144 passed |
| integration `meetings`, `meetings-moves`, `permissions`, `isolation` | 103 passed |
| `pnpm -s typecheck` | exit 0, again after the fixes |
| `pnpm --filter web lint` | exit 0 |
| `pnpm --filter web test` | 70 passed, again after the fixes |
| demo e2e, first run | 199 passed, 4 failed (fix 1) |
| demo e2e after fix 1 | 203, 1 and 1 passed |
| demo e2e, final (a fresh build after fix 2) | 204 (the seven flooring files), 1 (flow 6) and 1 (HR) passed |
| api e2e, first run | the meetings spec failed at Undo (fix 2) |
| api e2e, second run | failed at the not-found check (fix 3) |
| api e2e, third run | the meetings spec passed alone; in the full suite it failed at Priya's sign-in (fix 4) |
| api e2e, final | the meetings spec 1 passed; the full api suite 18 passed |
| the api meetings spec again, to prove its clean-up | 1 passed (9.4 s) |

- **Docs (commit 13):** Markdown only. `prettier --check` on the seven changed docs: clean. No code check re-run, since no code changed.
- **Review round 1 fix (`a37be29`):**
  - apps/web `typecheck`, `lint` and `test` through the lock: exit 0, 11 files and 71 tests. The new `meeting-screens` case drives `followMove` and `drawerOccurrence` through the read before, the read after and the Undo's reads for "All events" and "This and following". Prettier clean.
  - Demo e2e, from a fresh demo build: `meetings`, `meetings-invites`, `states` and `a11y` (flooring) gave 143 passed, the new series test included. Flow 6 passed (1), and the HR meetings spec passed (1).
  - Api e2e (plan 8.5, on the throwaway database on 5433, neither re-created nor reseeded): the meetings spec 2 passed, the new series test included; the full api suite 19 passed.
  - **The new api test is a real repro:** the page from before the fix was put back for one run (a fresh api-mode web build, then only that test), and the test failed at "the drawer shows 11:00 AM" after "All events". The file was then restored, so the web `.next` in the worktree is that build until the next e2e script rebuilds it. Ports 3000 and 4000 were free before and after every run.
- **Review round 2 fix (commit 16):** apps/web `vitest run` on `demo-meetings`, `demo-meetings-switches`, `meeting-screens` and `meetings-api`: 4 files, 34 tests passed. apps/web `typecheck` exit 0, and `eslint` on the two changed files exit 0, both through the lock. Prettier clean. No e2e run: no screen and no behaviour changed.
- **Not run yet:** the full checks (plan 8.3: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:api`), at the review step.

## Reviews
- The plan's full checks, `/review` and a fresh security-reviewer come next. The security-reviewer's brief names the client gating (`changeableAsShown` and the M1 proof), the request bodies, `wrote`, the undo order, the `lockChangeable` and guest-reader refactor, and the demo's rules. There is no schema change, so no schema-reviewer.
- **Review round 1** (correctness). One blocking finding, confirmed by a skeptic, and fixed in `a37be29`:
  - **The finding:** in api mode the drawer closed after a series move made from it with "All events" or "This and following", and after their Undo. `wrote()` only starts the screens' re-read, and `onMoved` then set the drawer's key at once. React rendered that before the re-read answered, so the page looked for the moved occurrence in the read from before the move. That read has neither an "all" shift's new planned time nor a split's new id. After an Undo it still has the shifted series, or the original with its `until`. `occurrenceAt` gave null, and the "gone" rule closed the drawer for good. The demo hid it, because DemoStore's re-read resolves in microtasks before React renders. The tests hid it too: they moved only one-offs and "This event" occurrences, whose key the old read still matches.
  - **The fix:** the drawer state is a `DrawerTarget` (`current-occurrence.ts`), holding the key it follows, the occurrence it showed (`was`) and the read on screen when the write answered (`against`). `followMove` sets it on a move or an Undo. `drawerOccurrence` shows `was` while the read is still `against`, then the occurrence at the key, and closes only when a newer read has neither. The page keeps the shown read in a ref, updated after each render. A toast's Undo, run minutes later from an older render's closure, then compares against the read shown at that time, not the one from when the move was made. The reviewer's other option, a pending key that switches once found, was not taken. Without telling reads apart, a whole-period "all" shift would match the old read at once and show the wrong occurrence until the next read.
  - **No deviation from meetings.md:** this is the approved "the drawer follows its occurrence", now as built in api mode. ADR 0051 "Part 3" (the drawer bullet, safest option 16, the tests list), the delta row's (10) and meetings.md's Part 3 drawer line say so.

- **Review round 2** (correctness). One should-fix finding, confirmed by a skeptic, and fixed in commit 16:
  - **The finding:** splitting the demo's meeting actions into `meeting-actions.ts` and `meeting-moves.ts` copied the private helper `auditTime` into both, which breaks the CLAUDE.md Style rule "no duplicated logic". Both copies write meeting starts into the same audit log, so one changed alone would mix two time formats.
  - **The fix:** `meeting-actions.ts` exports `auditTime`, with a JSDoc, and `meeting-moves.ts` imports it next to the other helpers it takes from there. No behaviour change, so no new test, and no doc beyond this log: the audit text is as before.

## Residual risks
Also in ADR 0051 "Residual risks (part 3)".
- **R1 Client keys and scope in api mode** come from the shell's DemoStore roles until `GET /company` and the roles move. An organiser can see a button the API refuses (a 403 toast, then a re-read); for anyone else the server's address signal guards it. Either way a control can be hidden that the API would allow.
- **R2 No live updates:** other people's changes show on reload, or after the person's own write or refusal.
- **R3 Load:** three GETs per load and per write on the Meetings page, four when `/me/meetings` gives no answer; `GET /meetings` has no date window.
- **R4 The address and name signals** both fail closed: a readable customer literally named "Customer" with no address costs the organiser the button, and a missing organiser address costs everyone else.
- **R5 Api mode's Outbox, bell and Simulate reply** still show DemoStore's rows.
- **R6 Merge order with PR #36:** both change `contract.ts`, `demo/store.ts`, `http/api-methods.ts`, `tests/e2e-api/accounts.ts`, docs/blueprint-delta.md and docs/api-contract.md. Whichever lands second merges main in; the meetings additions sit in their own blocks.
- **R7 The local api e2e database is reused.** Each run adds two cancelled meetings, audit entries and about ten Outbox rows. The first api run timed out, and its clean-up could not cancel the manager's meeting because the `page` fixture had already closed, so "API meeting mwhrsmsd" (2027-01-25) is still confirmed on the local database on 5433; Priya's private meeting from that run was cancelled. Each run picks its own Monday, so later runs are not affected, and CI starts from a fresh database. Signing the manager in through a context the test creates, as Priya's is, would make the clean-up work after a timeout too; not done.
- **R8 The move dialog's pre-check** uses the browser's day and clock, so near the start bound it can differ from the server (a 400 toast, then a re-read).
- **R9 Demo behaviour changes for presenters:** what the API refuses is now refused in the demo; Request needs the portal; a company in an unsupported zone can't book meetings.
- **R10 The company's day** stays the browser's for every module (A.5).
- **R11 `changed` re-runs every subscribed query on the page,** the portal's `GET /me/portal` on My meetings included.
- **R12 A linked guest the reader can't read** still shows its record id and answer (PR #33 note).
- **R13 The newest-read rule** applies to every screen; it only drops answers a newer read supersedes.
- **R14 Not-found status:** in api mode `/settings/meetings` shows the not-found page with status 200, as every not-found page inside the app shell does. Proposed STATUS follow-up: a real 404 status for not-found pages there.
- **R15 Keyboard Undo:** while the drawer is open it keeps focus inside itself, so a keyboard user reaches the move toast's Undo only after Escape, then alt+T.
- **R16 The same pointer problem elsewhere,** on main and left alone: "Try again" toasts shown while the refund, record-payment and supplier-payment sheets are open, and the reason dialog.
- **Demo audit entries** keep the demo's own before and after text, with `meetingAuditTarget` and `guestAuditName` for names; the undo memory is in memory only.

## Outcome
Part 3 is built, tested and documented on `feat/meetings-web-api` (draft PR #37). In api mode the Meetings page, its drawer and dialogs, and My meetings run on the meetings routes; the demo store follows the same shared rules; the one API change is the undo check order. Every deviation from meetings.md is in the safer direction and is recorded in ADR 0051 "Part 3" and the blueprint-delta row.

| # | Commit | What |
| --- | --- | --- |
| 1 | `16c0902` | docs(meetings): part 3 plan and session log |
| 2 | `2e195dd` | feat(shared): screen rules on shaped meetings, refusal texts, guest readers, `DEMO_PRODID`; undo checks the SEQUENCE first |
| 3 | `b09bcaf` | refactor(meetings): the API takes refusal texts and guest readers from shared; test(meetings): a stale undo toast after a colleague's move is `meeting_changed` |
| 4 | `6a4dfba` | feat(web): routed writes tell screens to re-read; the newest read wins |
| 5 | `c59f9ca` | feat(web): meetings contract and `API_METHODS` (twelve methods, `meetingsData` and `myMeetings` new) |
| 6 | `1841dae` | feat(web): the demo store's meetings on the shared rules |
| 7 | `7a94dcb` | feat(web): meetings screens on the server's viewer and the shared rules |
| 8 | `ea5d881` | test(web): meetings demo e2e additions and the api-mode meetings spec |
| 9 | `04425f1` | test(web): open seeded meetings in the week view, where the whole-week shift keeps them |
| 10 | `47a1581` | fix(web): a move's Undo is reachable from the open meeting drawer |
| 11 | `6bbb6c8` | test(web): the api-mode Settings → Meetings check reads the not-found page, not a 404 status |
| 12 | `12b40ef` | test(web): the step-up spec waits until Priya's roles are put back |
| 13 | `a9ab07d` | docs(meetings): ADR 0051 part 3, delta, contract, meetings and notifications specs as built |
| 14 | `a37be29` | fix(web): the meeting drawer waits for the re-read after a series move or its Undo (review round 1) |
| 15 | `492b7f9` | docs(meetings): the drawer waiting for the re-read, as built (review round 1) |
| 16 | this commit | refactor(web): one audit time helper for the demo's meetings (review round 2) |

Docs in commit 13:
- ADR 0051: the "Part 3 (2026-11-15)" section (the ApiClient, who is looking, what the screens offer and why it is safe, re-reading, the demo store, the API change, the company's day, 22 safest options, kept, deferred, owner questions, residual risks R1 to R16, consequences); the title and status; the undo checks reordered in "Part 2"; "Later parts" marks part 3 done; the part 2 residual risks part 3 closes are removed, and part 1's "Api mode" risk is brought up to date.
- docs/blueprint-delta.md: one part 3 row at the top.
- docs/api-contract.md: the portal line, "Parts 1 to 3", the undo row and "Undo answers" in the new order, the web client's routes and bodies, the `meetingsData` and `myMeetings` rows, the `simulateReply` row and the `list` note.
- docs/product-spec/meetings.md: the code list, each demo limit part 3 closes marked "(closed in part 3, ADR 0051)", "Move or resize" as built, and a "Part 3" list under "Real build". The "Scheduled rows turn to sent only when the company is opened" limit is not marked: it stays in the demo.
- docs/product-spec/notifications.md: the meeting rows of "Recipients and triggers, as built" (`deliver`, `syncReminder`, `replyOutcome` and their versions), the reminder note, and "Part 3 adds no event".
- docs/real-build-plan.md: row 14 names the three parts and PR #37.
- Not changed: FEATURES.md (statuses stay `demo`), STATUS.md and BRANCHES.md (left for the handoff).

## Next
- **Review (step 10):** the full checks through the lock (plan 8.3), `/review`, then a fresh security-reviewer with the brief under "Reviews". Fix and review again until nothing blocks, posting each summary with `gh pr review 37 --comment --body-file …`.
- **Handoff (step 11):** STATUS (the PR #37 entry; close the PR #35 stale-toast note and the part 2 residuals part 3 closes; new follow-ups: Request on the Meetings page depends on the portal route, other modules' api-mode screens can adopt `changed`, the company's day stays open for every module, an explicit "may change" flag (owner question 1), and a real 404 status for not-found pages in the app shell), BRANCHES and this log. The last commit runs CI; then ready, wait for `verify` and `e2e` on the head, and self-merge under the CLAUDE.md rule.
- **Merge order with PR #36:** whichever lands second merges `origin/main` in (`git fetch -q origin && git merge origin/main`, never `git pull`).
- **Then:** part 4 waits for the owner; platform admin and manual billing follow in the queue.
