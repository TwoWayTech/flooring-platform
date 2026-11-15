# Session 2026-11-15 12:10, B (Claude): meetings on the API, part 3 (the web)

Module 14 of docs/real-build-plan.md ("Meetings, invites and .ics", spec meetings.md). Part 3, after part 1 (PR #33) and part 2 (PR #35). Branch `feat/meetings-web-api`, from `origin/main` at `8ddf7fa` (part 2, PR #35, on top of platform admin part 1, PR #34), in its own worktree (`../flooring-platform-meetings`), because another build (platform admin part 3, PR #36, `feat/platform-audit-support`) runs in the main checkout. The draft PR is opened right after this log's commit; its number goes into BRANCHES and the later sections of this log.

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

## Owner questions (part 3)
1. **The "may change" signal:** a non-organiser's change controls show only when the server's shaped meeting gives them the organiser's address, which it does exactly for someone who may change it. Should the API send an explicit "may change" flag with each meeting instead (a contract addition, later)?
2. **Request needs the portal:** Request a meeting on the Meetings page needs `GET /me/meetings` (the portal key and switch), in both modes. Should a `GET /meeting-colleagues` route (or `colleagues` on another route) let a role without the portal request from the calendar? Part 3 hides Request for them.
3. **Demo View as:** for meetings it uses the signed-in person with the viewed role's keys and scope, customer sight included; other demo lists borrow the role's first user. Keep, or borrow for meetings too?
4. **Form defaults in api mode:** the New meeting form's default reminder and hide-list checkbox come from the demo's Settings → Meetings until part 4 (Summit's stored group is the same). Fine until then?
5. **Move dialog reasons:** the dialog leaves out the scopes the move rules refuse and shows each rule's reason. Keep, or show them disabled with the reason?
6. **Demo undo:** the demo forgets an undo on reload. Acceptable for a presenter tool?
7. **Demo new guests:** contacts are saved only under a customer the reader can see, and leads only for someone who may create customers. Keep?
8. **Part 2's open questions still stand:** the 5-minute window, a CANCEL to an undone split, past exceptions, held occurrences, "this and following" from the first occurrence, 100 exceptions, declining audited, the caps' status code, the start bound, a "Busy" conflict's time, and Outlook and SEQUENCE.

## Checks run
- Plan stage: no code, so no checks.
