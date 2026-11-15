# Session 2026-11-15 06:00, B (Claude): meetings on the API, part 2 (reschedule, undo, proposals, conflicts)

Module 14 of docs/real-build-plan.md ("Meetings, invites and .ics", spec meetings.md). Part 2 of 3. Branch `feat/meetings-api-moves`, from `origin/main` at `1de1e0c` (part 1, PR #33), in its own worktree (`../flooring-platform-meetings`), because another build runs in the main checkout on another branch. Draft PR #35.

## Prompt
- The queue restarted on 2026-11-15 with meetings first (STATUS, "Next three tasks"), and the owner is asleep. The rule for open points is part 1's: follow docs/product-spec/meetings.md as the approved behaviour. Deviate only in the safer direction (less data exposure, deny by default, refusing what can't be done correctly), and record each deviation in docs/blueprint-delta.md and ADR 0051. Make no other behaviour change: moves don't reset answers, and the spec's sends table stands.
- No change to existing tables, no migration and no new dependency. No web change (part 3), no Settings → Meetings, no contacts or leads.
- Inputs:
  - ADR 0051, "Later parts";
  - the part 1 log;
  - meetings.md: the sends table, rules 4, 5 and 13, "Moves and conflicts" and "Differences from ADR 0021";
  - notifications.md;
  - api-contract.md;
  - the earlier plan (section 3, routes 9, 12 and 13) and its critic (B3, D and H), which sit in the session scratchpad, not in the repo.
- This log is the plan. The code reuses part 1's rules (`canChangeMeeting`, `meetingForViewer`, `sendPlan`, the reminder re-sync with deferred queueing, the daily caps and `partySight`) and does not copy them.

## Plan

### Corrections to the earlier plan
- **Q10 (reset answers on a move) is dropped.** The rule keeps the spec: a move does not reset answers or clear a pending proposal.
- **Route 13 (undo from the client's `previous`)** is replaced by critic B3's rebuild from the server's own "Moved meeting" entry. Its sequence check on the client's copy and its "created in the last 15 minutes by the caller" guess are gone (below, "Undo").
- **"This and following" from the first occurrence becomes "all"** is replaced by a refusal. We refuse what can't be done correctly rather than reinterpret the request (Decisions 4).
- **Critic H is settled:**
  - a split copies the guests, and email guests get new row ids;
  - `created_by` is the mover;
  - both series get their reminders;
  - responses are not copied;
  - an undone "this" move sends that occurrence again;
  - an answer that would be lost is avoided by refusing the undo when anything changed since the move.
- **Critic D:** the undo's removal of the split-off series is audited.
- **Critic M:** a `meetingId` in the move body must equal `:id`.

### Tables
- `meetings`, `meeting_attendees` and `meeting_responses` are used as they are, with no migration.
- A "this and following" move inserts one `meetings` row and copies the live `meeting_attendees` rows. An undo soft-deletes them.
- `audit_log` is read, never written to except through `AuditService`:
  - for the daily caps, as in part 1;
  - for undo, by `(target_type, target_id)` on the existing `audit_log_target_idx`.
- `exceptions` keeps its jsonb shape: `{ planned, start, durationMin }`, local times. A cap of 100 exceptions per series bounds the column, the audit entry and the re-sends (Decisions 9).

### Shared rules (`packages/shared/src/meetings`), with unit tests
- **`moves.ts`** (new):
  - **`effectiveScope(meeting, scope)`:** a one-off is always `all` (rule 4).
  - **`isPlannedOccurrence(meeting, planned)`:**
    - for a one-off, `planned` is its start;
    - for a series, `planned` is a date-time the rule plans (`nextPlannedStart` from `start`, up to `until`) that is not a cancelled exception.
  - **`moveProblem(meeting, move)`**, in order. Each problem is a 400 in the rule's own words.
    1. A cancelled meeting is refused.
    2. The new start must be one the clock shows (strict `startProblem`).
    3. The length is 15 to 1440 whole minutes (rule 5, widened by part 1's limit).
    4. `planned` must be an occurrence (`isPlannedOccurrence`).
    5. "This and following" from the first occurrence is refused, pointing to All events.
    6. The resulting series is checked:
       - an `all` move's shifted series start must exist on the clock and pass rule 3;
       - a `following` move's new series start must pass rule 3;
       - the moved occurrence must still be an occurrence of the result. That fails, for example, when it would land past `until`, or a monthly shift changes the week of the month;
       - every shifted exception must still be on its series;
       - a `this` move must not make the series exceed 100 exceptions.
  - **`movedMeetings(meeting, move, { newId, newUid })`** wraps the existing `moveOccurrence` with the sequence rules of the sends table (the demo's `rescheduleMeeting`):
    - the original gets SEQUENCE + 1. `rescheduleSequence` is unchanged for `this`, and set to the new SEQUENCE for `all` and `following`;
    - the split gets the new UID, SEQUENCE 0 and `rescheduleSequence` 0. Its guests are copied with their answers, and an answered guest's `respondedSequence` becomes 0;
    - answers and proposals are never reset.
  - **`movedOccurrenceKey(move, result)`:** which occurrence the move produced. That is `(original, planned)` for `this`, `(original, start)` for `all`, and `(split, start)` for `following`.
  - **`occurrenceConflicts(meetings, moved, guests)`** follows rule 13 on the state after the move:
    - it looks at occurrences on the new start's day that overlap the moved one;
    - it skips only the occurrence the move produced. The demo compares the pre-move key, so after an `all` or `following` move it warns about the meeting itself;
    - it matches guests by kind and id (`sameAttendee`);
    - it returns `{ guest, meeting, start }`.
  - **`conflictForViewer(raw, viewer, sight)`** gives `Conflict` `{ name, title, start }`:
    - `name` is the guest as the mover reads them on the moved meeting. They may change it, so they read every guest;
    - `title` is the other meeting's title only when `seesMeeting` allows it and that guest is listed in `meetingForViewer(other, …)`. Otherwise it is `BUSY_TITLE` ("Busy").
  - **`MoveRecord`:**
    - `moveAuditEntry(before, move, after, createdIds)` builds the "Moved meeting" before and after, which hold times only:
      - before: `{ planned, scope, sequence, series: { start, startsAt, durationMin, until, exceptions } }`, where `startsAt` is the stored instant;
      - after: `{ start, durationMin, scope, sequence, createdIds }`.
    - `parseMoveRecord(before, after)` reads it back through a strict Zod schema, and gives null for anything malformed.
  - **`undoProblem(record, current, ctx)`** returns `{ status, message }` or null. The rules are under "Undo" below. The window is `UNDO_WINDOW_MINUTES` = 5.
  - **`undoneMeeting(current, record)`:**
    - `start`, `durationMin`, `until` and `exceptions` come from the record;
    - SEQUENCE is the current one + 1, and `rescheduleSequence` is set to it (sends table);
    - the guests are untouched. The undo is refused if anything changed since the move, so they are "as they were in the saved copy".
- **`proposals.ts`** (new):
  - **`proposalDecisionProblem(meeting, guest)`:**
    - a cancelled meeting is refused;
    - the guest must have a pending proposal;
    - the meeting must be a one-off;
    - the proposed start must exist on the clock and last 15 to 1440 minutes.
  - **`acceptedProposal(meeting, guest)`:**
    - the meeting takes the proposed start and length;
    - SEQUENCE + 1, and `rescheduleSequence` is set to it;
    - every guest is asked again, the organiser included;
    - the proposer's proposal becomes `accepted`, and every other proposal is cleared (the demo's `decideProposal`).
  - **`declinedProposal(meeting, guest)`:** the proposer's proposal becomes `declined`, and nothing else changes.
- **`access.ts`:** `canDecideProposal(viewer, meeting, sight)` = `isOrganiser` and `canChangeMeeting`.
- **`changes.ts`:**
  - `editProblem` loses part 1's refusal of a start or length change on a series with exceptions. A start change on a series runs the move checks: the shifted exceptions must stay on the series, and the cap applies.
  - `editedMeeting` shifts a series' exceptions with its start through `moveOccurrence(before, before.start, …, "all")`, so there is one shifting rule. Answers still reset per rule 6.
- **`sends.ts`:**
  - `MeetingSendKind` gains `occurrence` and `declineCounter`:
    - `occurrence`: REQUEST "Updated" with RECURRENCE-ID and the occurrence's own time, to every guest;
    - `declineCounter`: DECLINECOUNTER with no STATUS, "Proposal declined", to the proposer only, listing only them.
  - Series moves, undo and an accepted proposal use the `edit` row: REQUEST "Updated" to every guest at the meeting's SEQUENCE, TENTATIVE while a request waits. The removed split series uses `cancel`.
  - `MeetingSend` gains `recurrenceId`, `start` and `durationMin`. `sendIcsInput` and `inviteVersion` pass them, so each occurrence is its own Outbox row.
  - New `exceptionResends(meeting, seriesSends, now)`. For each surviving exception whose occurrence has not ended by `now`, it makes one copy of each series send, with that exception's RECURRENCE-ID, start and length. An exception marked `cancelled` is skipped, since nothing writes one.
- **`audit.ts`:** `MEETING_AUDIT_ACTIONS` holds the new action strings, because undo matches on them. They are "Moved meeting", "Split meeting series", "Undid meeting move", "Removed split meeting series", "Accepted proposed time" and "Declined proposed time".
- **`input.ts`:** `MEETING_LIMITS.exceptionsMax` = 100.
- **The demo is not touched.** Its `attendeeConflicts` and `rescheduleMeeting` keep their behaviour until part 3 moves DemoStore onto the shared rules, which is the same temporary overlap part 1 accepted (critic K).

### API (`apps/api/src/modules/meetings/`)
- **Files:**
  - `meeting-writes.ts` (new) takes part 1's private write helpers out of `MeetingsService`, so both services use them with no behaviour change: `lockVisible`, `lockChangeable`, `loadedIn`, `checkSends`, `afterCommit` and `shaped`. `afterCommit` takes a list of planned invites and meeting ids.
  - `meeting-moves.service.ts` (new): reschedule, undo and decide.
  - `meeting-conflicts.ts` (new):
    - it loads, in the move's transaction, the meetings that share a staff or linked guest with the moved one. That is one query on `meeting_attendees` by party, and email guests never match;
    - it applies `occurrenceConflicts`, then `conflictForViewer` with `partySight` for those meetings.
  - `meeting-undo.ts` (new): reads the last meetings audit entry of a meeting (`target_type` `meeting`, newest `at`, then id) in the caller's transaction.
  - `meeting-sends.ts`: `plan` takes the new kinds and adds `exceptionResends`.
  - `meeting-reminders.ts`: `sync` on a deleted meeting only cancels its waiting rows, with no warning.
  - `meeting-limits.ts`: the lock-order comment. An undo takes two meeting locks, the original's then the split's, both before the sends lock. Nothing locks them the other way, so actions never wait in a circle.
  - `meetings.controller.ts`: three routes with strict Zod bodies, `requireFeature` first, `@RequirePermission` and `@Audited`.
- **Every route:**
  - takes the tenant only from `TenantConnectionService`;
  - checks `:id` and `:attendeeId` as UUIDs;
  - answers 404 with `meetings.calendar` off.
- **Every write:**
  - locks the meeting;
  - applies the shared rule;
  - plans its sends from the state it commits;
  - checks the daily caps under the person's lock;
  - writes its audit entries, all in one transaction, with no second pool connection.
  - After the commit come the invites (deferred jobs, `queueSends` once) and the reminder re-sync, neither of which can fail the request. The reply is the committed state, shaped for the reader.

| # | Route | Needs | Rules | Audit | Sends |
| --- | --- | --- | --- | --- | --- |
| 12 | `POST /meetings/:id/reschedule` | `meetings.meeting.edit`; switch `meetings.calendar`; `canChangeMeeting` (404 unseen, 403 otherwise) | Body `{ meetingId?, planned, start, durationMin, scope }`, strict, with `meetingId` equal to `:id`. `moveProblem`, `movedMeetings`, strict instants for a new series start. A split inserts the new series (owner kept, `created_by` the mover) and copies the live guests, whose email guests go through the daily address cap. Conflicts are worked out in the transaction. Moves don't reset answers. With `meetings.invites` off it moves, warns and sends nothing | `Moved meeting` on the original: the `MoveRecord`, plus `after.sends` with every email of the move. A split adds `Split meeting series` on the new series: null → `{ from, start }` | `this`: `occurrence` (RECURRENCE-ID, own time, +1). `all` or a one-off: `edit` REQUEST at +1, plus `exceptionResends`. `following`: `edit` on the old series (trimmed UNTIL, +1) and on the new one (new UID, 0), each with its `exceptionResends`. Reminders re-synced for each series. Returns `{ meetings, conflicts, undo: { previous, createdIds } }`, each meeting shaped by `meetingForViewer` |
| 13 | `POST /meetings/:id/reschedule/undo` | edit; `meetings.calendar`; `canChangeMeeting` on the meeting and on its split; the person who moved it | Body `{ sequence }`, strict: the SEQUENCE the client saw before the move (`undo.previous.sequence`), used only to refuse a mismatch. Rebuilt from the server's own entry (below). The split-off series and its guest rows are soft-deleted, with status `cancelled` and SEQUENCE 1 | `Undid meeting move`: `{ start }` → `{ start, sends }`. `Removed split meeting series` on the split: `{ start }` → `{ sends }` | `edit` REQUEST at current + 1 to every guest. After an `all` or `following` undo, `exceptionResends` of the restored series. After a `this` undo, `occurrence` for that RECURRENCE-ID at its restored time (the earlier exception, or the series time). CANCEL with STATUS:CANCELLED to every guest of the removed split. The original is re-synced and the split's reminders cancelled. Returns `Meeting` |
| 9 | `POST /meetings/:id/attendees/:attendeeId/proposal` | edit; switches `meetings.calendar` and `meetings.invites`; `canDecideProposal`, i.e. the organiser and `canChangeMeeting` (403 "Only the organiser can decide a proposed time.") | Body `{ accept }`, strict. A guest not on this meeting gives 404. `proposalDecisionProblem` gives 400. Accept: `acceptedProposal`, with the strict instant of the proposed start, and every guest row reset. Decline: `declinedProposal` | `Accepted proposed time`: `{ start }` → `{ start, sends }`. `Declined proposed time`: `{ guest }` → `{ sends }`, with the guest named by `guestAuditName` | Accept: `edit` REQUEST at +1 to every guest, reminder re-synced. Decline: `declineCounter` to the proposer only, unless they are no longer an active member. Returns `Meeting` |
| 5 | `PATCH /meetings/:id` (changed) | as in part 1 | A start or length change on a series with exceptions is no longer refused. The exceptions shift with the start, and a change that would drop one is refused | as in part 1 | `edit` REQUEST, plus `exceptionResends` when the series' start or length changed |

### Conflicts and "Busy"
- **When:** on a move only, after the save, as a warning (rule 13). They are not computed at creation, on PATCH or on an accepted proposal.
- **Computed in the move's transaction** from the state it commits:
  - over the meetings that share a guest with the moved meeting, cancelled ones left out by `meetingOccurrences`;
  - on the new start's day only, skipping only the occurrence the move produced.
- **Shown to the mover:**
  - the guest's name, from the moved meeting;
  - the other occurrence's start;
  - the other meeting's title only when they see that meeting and see that guest on it.
- **"Busy" otherwise:**
  - a private meeting they are not on;
  - an own-scope reader's colleague's meeting;
  - a meeting whose hidden guest list they can't read.
- **A "Busy" row carries nothing else:** no title, id, guests, place, notes or private flag.
- **The start of a "Busy" block** is free/busy information and stays (owner question).
- This closes the spec's limit that "a warning can name the title of a private meeting the viewer cannot see".

### Undo, rebuilt from the audit entry (critic B3)
- In one transaction, `lockChangeable` takes the meeting (404 or 403). Then:
  1. Its last meetings audit entry must be "Moved meeting", and `parseMoveRecord` must read it. Otherwise 409 `meeting_changed`: "This meeting changed after the move, so the move can't be undone."
     - Every change to a meeting writes an entry under its lock: an edit, an answer, a cancel, a guest removal or another move. So "the last entry is the move" means nothing happened since, and the guests' answers are still those of the saved copy.
  2. The entry's actor must be the caller: 403 "Only the person who moved this meeting can undo the move."
  3. The entry must be at most `UNDO_WINDOW_MINUTES` (5) old by the database clock: 409 "This move can no longer be undone."
  4. The current SEQUENCE must equal `after.sequence`, and the body's `sequence` must equal `before.sequence`: 409 `meeting_changed`. This stops a toast for an older move from undoing a newer one.
  5. For a split, each id in `after.createdIds` is locked after the original:
     - it must be live and not cancelled, at SEQUENCE 0;
     - its last entry must be this move's "Split meeting series" (`after.from` equal to `:id`);
     - the caller must be able to change it.
     - Otherwise 409.
- **The restored state** comes only from the record:
  - the stored instant `series.startsAt`, the length, `until` and `exceptions`;
  - SEQUENCE + 1, and `rescheduleSequence` set to it.
- **Nothing in the body but `sequence` is read**, and a strict schema refuses anything else.
- **A second undo** finds "Undid meeting move" as the last entry and gets 409.

### Proposal decisions
- **Only the organiser who may change the meeting** decides. Other readers don't even see other guests' proposals (`meetingForViewer`).
- **Accept** follows the sends table: REQUEST at +1 to every guest, and all answers reset, the organiser's included.
- **Decline** sends DECLINECOUNTER to the proposer, listing only them, at the unchanged SEQUENCE, with no STATUS and no VALARM. Answers are unchanged.
- **A pending proposal survives a move**, as the spec says, and can still be accepted afterwards.

### Series exceptions re-sent (ADR 0021), lifting part 1's refusal
- **When:** after any change of a series' DTSTART, DTEND, RRULE or UNTIL:
  - an `all` move;
  - both series of a split;
  - a PATCH of start or length;
  - an `all` or `following` undo.
- **What:** each surviving exception that has not ended gets one REQUEST per guest, at the series' new SEQUENCE, with its RECURRENCE-ID (the shifted `planned`) and its own time.
- **Why:** Outlook drops a series' exceptions when its rule or time changes, and guests' calendars would otherwise keep them under old RECURRENCE-IDs.
- **What is refused instead:** a shift that would move an exception off its series (a monthly week shift, or past `until`). Nothing would be correct to send for it.

### Reminders
- **Re-synced after the commit:**
  - after a move, for the original and the new series;
  - after an undo, for the original. The removed split's waiting rows are cancelled;
  - after an accepted proposal.
  - PATCH already re-syncs.
- **The sync is part 1's:** the rows are cancelled first, then under the lock again, and the next reminder is raised with a fresh version. The jobs are queued after the commit and skipped when the invites found jobs down.

### Tests
- **Unit (packages/shared):**
  - `meeting-moves.test.ts`:
    - `isPlannedOccurrence`: one-off, weekly, monthly week cap, `until`, a fake `planned`;
    - every `moveProblem` branch, including the DST gap on a shifted series start, the day-30 safety talk refused on `all` but movable with `this`, a monthly week shift and the 100-exception cap;
    - `movedMeetings` sequence rules per scope, with answers and proposals kept;
    - `occurrenceConflicts`: no self-conflict after `all` and `following`, kind and id matching, another occurrence of the same series counting;
    - `conflictForViewer`: private, hidden list and own scope give "Busy", while seen and listed gives the title;
    - a `MoveRecord` round trip and a malformed record;
    - each `undoProblem` refusal, and `undoneMeeting`.
  - `meeting-proposals.test.ts`: decision problems; accept resets everyone and clears other proposals; decline changes only the proposal; `canDecideProposal` (a Manager who may change it but is not the organiser is refused).
  - `meeting-changes.test.ts`: the part 1 exceptions refusal is replaced by "the exceptions shift with the start", plus a refusal when one would drop.
  - `meeting-sends.test.ts`: the `occurrence` and `declineCounter` rows, `exceptionResends` (ended and cancelled exceptions skipped), and one version per RECURRENCE-ID.
  - `ics.test.ts`: a DECLINECOUNTER file (one ATTENDEE, no STATUS, no VALARM), and a RECURRENCE-ID file for the first occurrence of a series that starts after day 28.
- **`apps/api/test/meetings-moves.int.test.ts`** (new; AuthHarness, laid out like `meetings.int.test.ts`):
  - **Access:**
    - 401;
    - 403 without edit, and `module_not_enabled`;
    - 404 with `meetings.calendar` off on all three routes, and 404 on decide with `meetings.invites` off (a move still works then and sends nothing);
    - an own-scope Sales guest gets 403 on a colleague's meeting;
    - someone who can't see it gets 404;
    - another company gets 404;
    - extra body fields and a `meetingId` that isn't `:id` give 400.
  - **Reschedule:**
    - a one-off: +1, answers kept, REQUEST "Updated" with the new DTSTART, the instant stored, the reminder moved, and an audit entry with no title or email;
    - `this`: a RECURRENCE-ID file, `rescheduleSequence` kept, the exception stored;
    - `following`:
      - the new row has a new UID, SEQUENCE 0, the owner kept and `created_by` the mover;
      - the guests are copied, the email guest with a new row id and answers kept;
      - the old `until` is trimmed, with one REQUEST per series;
      - "Split meeting series" is audited, and both series get reminders;
    - `all` with a future and a past exception: the future one is re-sent with its shifted RECURRENCE-ID, the past one not;
    - refusals: `following` from the first occurrence, a fake `planned`, rule 3, the DST gap, a cancelled meeting;
    - the daily cap refuses a move and writes nothing;
    - a private meeting's rows are restricted.
  - **Conflicts:**
    - a colleague's private meeting at the same time reads "Busy" with no title;
    - a meeting the mover sees, but whose hidden list they can't read, reads "Busy";
    - a seen and listed meeting reads its title;
    - there is no self-conflict after `all` and `following`;
    - the response carries no other meeting's place, notes or guests.
  - **Undo:**
    - by the mover in the window: the start, `until` and exceptions are restored, +1, REQUEST to every guest, the split soft-deleted with a CANCEL to its guests and its reminders cancelled, and both entries audited;
    - a `this` undo re-sends the occurrence at its restored time;
    - refusals:
      - another person who may change it (403);
      - after an edit, an answer or a cancel (409);
      - a second undo (409);
      - a body `sequence` mismatch (409);
      - an entry older than five minutes, inserted directly (409);
      - fields of a client copy in the body (400).
  - **Decide:**
    - only the organiser who may change it decides: a Manager who may change it gets 403, and a guest gets 403;
    - no pending proposal or a cancelled meeting gives 400;
    - accept moves the meeting, +1, resets everyone, clears the other proposals, sends REQUEST to all, re-syncs the reminder and audits;
    - decline sends DECLINECOUNTER to the proposer only, keeps the answers and audits;
    - a proposer who left gets nothing.
  - **PATCH:** part 1's "refuses a start or length change on a series with moved occurrences" becomes "shifts and re-sends them"; a monthly week shift is refused.
  - **Pool:** several moves and an undo sent at once on different meetings all answer, with no second pool connection in a transaction.
- **Must stay green:** `meetings`, `isolation` and `permissions` (the route inventories pick the new routes up), `notifications`, `seed` and `table-rules`.
- **Not run:** Playwright, because no screen changes.

### Docs
- **ADR 0051:** a "Part 2" section (routes, conflicts, undo, proposals, exceptions), with the safest options below appended, "Later parts", "For the owner", "Residual risks" and "Consequences".
- **api-contract:**
  - the three rows and the PATCH row in "Meetings (real build, ADR 0051)";
  - "Not on the API yet";
  - the domain-action rows of `rescheduleMeeting`, `undoReschedule` and `decideProposal`.
- **meetings.md "Real build":** part 2 bullets, and the closed limits:
  - the private title in a warning;
  - surviving exceptions not sent;
  - "following" from the first occurrence;
  - the undo removing a split without a CANCEL;
  - `decideProposal` on a cancelled meeting.
- **notifications.md:** a `meeting.invite` row per RECURRENCE-ID, and the "Proposal declined" action as a DECLINECOUNTER.
- **data-model:** a split copies its guests' rows (email guests get new ids). No table change.
- **blueprint-delta:** one dated row for part 2.
- **FEATURES.md:** no change; statuses stay `demo`.

### Order of work (one commit each, pushed)
1. This plan.
2. The shared rules and unit tests.
3. The API: the helper move, the routes, conflicts, undo, decisions and reminders.
4. The integration tests.
5. Docs.

Then lint, typecheck and tests through the lock, a fresh security-reviewer (permissions, data scope, audit), and the PR marked ready.

## Decisions

### Safer than the spec (each in the blueprint-delta row and ADR 0051)
1. **Who may move, undo or decide:** `canChangeMeeting`, as for edits in part 1.
   - The spec's actions check `meetings.meeting.edit` only.
   - Deciding a proposal also needs the organiser. That is the spec's own screen rule ("the screen also needs the viewer to be the organiser"), now enforced on the server.
2. **Undo is rebuilt on the server from its own "Moved meeting" entry** and never from the client's copy (critic B3). It is allowed only when:
   - the move is the last change to the meeting (and to its split);
   - the caller is the person who moved it and may still change it;
   - the move is within 5 minutes by the database clock. The spec has no window, and its toast lasts seconds, so 5 minutes is the tightest bound that survives a slow network and a paused toast;
   - the SEQUENCE the client saw matches.
3. **Conflicts show a meeting the mover can't see, or can't see that guest on, as "Busy":** the guest's name and the start only, with no title, guests, place, notes or id. The spec's warning names any meeting's title, private ones included.
4. **Moves that can't be done correctly are refused:**
   - a `planned` that is not an occurrence;
   - "this and following" from the first occurrence. The old series would keep a DTSTART that RFC 5545 counts as an occurrence, so guests would see the meeting twice;
   - a shifted series start the clock skips, or one that breaks rule 3, and a new series start that breaks rule 3;
   - a move that drops the moved occurrence or an exception;
   - a cancelled meeting;
   - 15 to 1440 minutes.
5. **Surviving exceptions are re-sent** (ADR 0021; the spec's "Differences from ADR 0021" lists them as not sent). This lifts part 1's refusal of a series time edit. Only exceptions that have not ended are re-sent, which bounds the email to guests.
6. **An undo also sends:**
   - a CANCEL to the guests of the split-off series it removes, which closes the spec's "Undo removes a split-off series without sending its guests a cancellation" (RFC 5546 section 3.2.5);
   - after a `this` undo, that occurrence at its restored time.
   - Otherwise guests' calendars keep a meeting that no longer exists. The sends-table rows themselves are unchanged.
7. **New audit entries** (CLAUDE.md rule 10): "Split meeting series", "Removed split meeting series" and "Declined proposed time". The spec leaves declining unaudited. No entry holds titles, emails or notes; the move record holds times only, and a private meeting is "Private meeting".
8. **The daily caps** (part 1) count every email of a move, undo and decision. The copied email guests of a split count as addresses the mover invited that day. An action over a limit is refused and writes nothing.
9. **At most 100 exceptions per series:** a `this` move that would exceed them is refused. It bounds the jsonb, the audit entry and the re-sends.
10. **Strict bodies:** a move's `meetingId`, if sent, must equal `:id`. An undo takes only `{ sequence }`.
11. **Proposal decisions are refused** on a cancelled meeting (the spec does not check), on a series, and for a proposed start the clocks skip (added in the build).
12. **An undo of a split answers 409** whenever the split-off series changed since the move, or the caller may no longer change it (409 rather than 403, decided in the build).

### Kept as meetings.md says (not safety)
- **A move does not reset answers or clear a pending proposal:**
  - `this` keeps `rescheduleSequence`;
  - `all`, `following` and undo set it to the new SEQUENCE;
  - a split copies its guests' answers.
- **The sends table rows** for moves, undo, accept and decline, as written.
- **Accepting a proposal** resets every answer, the organiser's included.
- **The shift is measured from `planned`**, also for an occurrence moved on its own (rule 4). A one-off moves as `all` whatever the scope.
- **Conflicts** only warn, only on a move, and only for the moved occurrence on its day. They are never computed at creation.
- **A moved request** gets a file, TENTATIVE while it waits (part 1).

### Deferred, not invented
- **Cancelling one occurrence:** the spec does not offer it.
- **Conflicts at creation or on PATCH:** not in the spec.
- **Part 3 (web):**
  - Undo sends `{ sequence: undo.previous.sequence }` to `/meetings/:id/reschedule/undo`;
  - the warning renders "Busy";
  - "This and following" is hidden on the first occurrence;
  - Accept time and Decline time show only to an organiser who may change the meeting;
  - DemoStore moves onto these rules.

### For the owner
- Is 5 minutes the right undo window, and should anyone else who may change the meeting be able to undo a colleague's move? Part 2 allows only the mover.
- Should an undone split's guests get a CANCEL? Part 2 sends one.
- Should past exceptions be re-sent after a series move? Part 2 re-sends only those that have not ended.
- Should a "Busy" conflict show its start? Part 2 shows it, as free/busy.
- ADR 0021 notes that Outlook discards answers when SEQUENCE rises, while the spec keeps answers on a move. The spec stands. Revisit it?
- Should "this and following" from the first occurrence be read as All events rather than refused?
- Is 100 exceptions per series right?
- Should declining a proposal stay audited? The spec leaves it unaudited.
- An undo or decision over a daily cap answers 400 `invalid_request`, as part 1's actions do; the spec names no status.

### Residual risks
- **Calendars may keep stray overrides:** after an `all` move or an undo, a guest's calendar may keep an override under a RECURRENCE-ID that is no longer an instance (Google). No valid message can cancel it.
- **The daily caps can block a move:** a series with many exceptions and guests sends one REQUEST per guest per exception, so the caps can refuse moving it on a busy day.
- **Undo is short:** it is offered for 5 minutes, to the mover only. Anything later is a new move.
- **The demo keeps its own copies:** it keeps its conflict self-warnings and private titles until part 3.

## Build (`48eb63e`, `31f6eaf`, `073ac4c`, `eb3eb65`, `dd91811`)
- The shared rules and unit tests, the three routes and the PATCH change, then the integration tests, as planned.
- **Deviations from this plan,** none of which changes behaviour beyond what is listed:
  - `parseMoveRecord` is in the API (`meeting-undo.ts`), not in packages/shared, because packages/shared has no Zod dependency and none may be added.
  - The re-sent exception emails carry no in-app note, so a colleague gets one note per series change, not one per exception.
  - Declining a proposal also moves the meeting's `updated_at`. Without it, a second decline at the same SEQUENCE would merge into the first Outbox row and never be sent.
  - Speed: checking whether dates are occurrences counts weekly steps and walks a monthly rule once for all exceptions (`dd91811`). Before it, a worst-case move check took about 2 seconds while holding the meeting's lock.
  - `MeetingSends`: part 1's `removed` option is now `only` (it also names the proposer), `plan` takes an options object, and `invites` takes a list of plans and queues their jobs once.
  - Decisions 11 and 12 above were settled in the build.

## Tests (`9d850c2`, test-writer)
- Five integration cases added to `apps/api/test/meetings-moves.int.test.ts` (21 in all), reusing its helpers:
  - the reminder put back after an undo, and no title, note, name or email in the move and undo entries;
  - only the last move undone: an older toast gets 409, the newest undoes, and a repeat gets 409;
  - the daily caps on an undo and on an accepted proposal: 400, nothing written;
  - a proposal declined twice: two DECLINECOUNTER rows and two audit entries without notes or titles, SEQUENCE unchanged, and a third decline 400;
  - the 100-exception cap: a 101st "this event" move is 400 and writes nothing.
- No product bug was found. Not covered by a test, checked in the code instead:
  - undo and the decision with the whole module off: `@RequireModule("meetings")` is on the controller class;
  - a decision on a removed proposer: `before.rows` holds only live guest rows, so it is 404 and nothing is written.
- Not covered: conflicts with a cancelled meeting (the spec says nothing).

## Fixes
- None needed: no test showed a product bug, so no commit.

## Docs (this stage)
- ADR 0051: a dated "Part 2" section (routes and checks, moves, conflicts and "Busy", undo, decisions, exceptions sent again, audit, limits, the 12 safest options, kept, deferred, owner questions, residual risks, consequences). The part 1 text it changes points to it, and "Later parts" marks part 2 done and lists what part 3 must do.
- docs/api-contract.md: the three new rows, the changed PATCH row, the undo refusal codes (`meeting_changed`, `undo_expired`), the daily limits and reminders notes, "Not on the API yet", and the domain-action rows of `rescheduleMeeting`, `undoReschedule` and `decideProposal`.
- docs/product-spec/meetings.md "Real build": the part 2 notes, with the limits they close, and the edits and reminders bullets brought up to date.
- docs/product-spec/notifications.md: `meeting.invite` and `meeting.reminder` notes. No event is added.
- docs/data-model.md: what a split and an undo write, the exceptions cap, and undo's read of `audit_log`.
- docs/blueprint-delta.md: one dated part 2 row at the top, listing every safest option.
- Not changed: FEATURES.md (statuses stay `demo`), STATUS.md and BRANCHES.md (left for the hand-off).

## Checks run
- Heavy commands went through the scratchpad lock (`heavy.sh`), with the CI database variables exported, because the worktree has no env file.
- Plan stage: no code, so no checks.
- Build stage:
  - packages/shared `vitest run`: 54 files, 604 tests passed;
  - apps/api `vitest --project unit`: 11 files passed, plus `meeting-undo.test.ts` (2);
  - `meetings-moves.int.test.ts` and `meetings.int.test.ts`: 48 passed, re-run after the last code change;
  - `isolation`, `permissions` and `notifications` integration tests: 60 passed;
  - `pnpm -s typecheck`: 6 of 6 (web and db forced again past the shared cache: both passed);
  - `pnpm -s lint`: passed, Prettier clean.
- Tests stage:
  - `vitest run --project integration test/meetings-moves.int.test.ts`: 21 of 21 (one failure on the first run was the new test's own setup, fixed);
  - the moves and meetings integration files after formatting: 53 of 53;
  - ESLint on the moves test file: clean.
- Fixes stage (`9d850c2`):
  - integration `meetings`, `meetings-moves` and `notifications`: 73 of 73 (the "Error: No control." in the log is the forced failure in `meetings.int.test.ts`);
  - apps/api unit `meeting-undo` and `notification-rules`: 13 of 13;
  - packages/shared `meeting*`, `ics`, `notifications` and `zones`: 158 of 158;
  - `pnpm -s typecheck` and `pnpm -s lint`: exit 0, 6 of 6 each;
  - Prettier `--check` on the meetings module, its tests and the shared meetings code and tests: clean.
- Docs stage: Markdown only (Prettier ignores `*.md`), so no code checks were re-run.
- Not run: `seed` and `table-rules` (no schema, seed or migration change), Playwright and `next build` (no screen changed, and forbidden on this laptop).

## Review round 1 of PR #35 (`26ef472`)
Three findings, each confirmed by a skeptic. All are fixed, with tests.

- **Blocking (security, availability):** `moveConflicts` loaded every live meeting that shared a guest with the moved one, with no date filter, and `meetingOccurrences` walked each series week by week from its first date to the moved day. Nothing bounded the dates (years 1900 to 2999 were valid), so series dated 1900 and a one-off moved to 2999 cost about 16 seconds of shared CPU per request (the skeptic's measurement), inside the move's transaction, holding the meeting's lock and a pooled connection. No email was sent, so no cap applied. Part 1's `nextOccurrence` and `nextReminder` walked the same way. Fixes:
  - **Window, not walk** (`packages/shared/src/operations/meetings.ts`): `onSeriesRule` decides directly whether a date is one of a series' dates, weekly by counting and monthly by working out that month's date. `meetingOccurrences` counts a series' dates inside the window from its start and checks the exceptions (at most 100) on their own. The result is unchanged, the 31-day reach for an occurrence moved earlier included: an oracle test compares it with the old walk on generated series. `isPlannedOccurrence` uses `onSeriesRule` too, so the monthly walk of `dd91811` is gone.
  - **Query bound** (`meeting-conflicts.ts`): the conflict query joins `meetings` and reads only meetings that can hold an occurrence on the moved day (`storedStartBounds`). That changes no result.
  - **Start bound** (`typedStartProblem` in `meetings/input.ts`): a start a person types must lie from 366 days before the company's today to 1096 days after it, on create, on an edit that changes the start, on a request, on a proposal, on accepting one and for a move's new start. The company's today comes from the control database (`companyDay` in `meeting-limits.ts`). The shared rules take `today` as a required argument, so no caller can skip it.
- **Should fix (test):** `lockSplit` refusing had no test. One integration case now answers on, edits (a title, so SEQUENCE stays 0 and only the last audit entry shows it) and cancels the split-off series. Each undo answers 409 `meeting_changed`, both series stay as they were, nothing is sent, and no undo entry is written.
- **Should fix (duplication):** the "ask again" reset of rule 6 was written four times. It is now `ASKED_AGAIN` in `meetings/changes.ts`: the shared `askedAgain` (now exported) spreads it on a guest for an edit and for `acceptedProposal`, and `resetAnswers` in `meeting-writes.ts` writes it to every live guest row for `MeetingsService.update` and `MeetingMoves.decide`.

### Decisions (safer direction, in the blueprint-delta row as item 13 and in ADR 0051)
- **The start bound is a year back and three years ahead.** meetings.md sets none. A year back lets a past occurrence be put right; three years ahead covers any booking the screens offer. It is checked by local date against the company's today.
- **Only typed starts are bounded.** A start a rule derives is not: an "all" move of an old series shifts its first date, which stays old; an undo restores the server's own record; a series that began long ago keeps running and takes edits that leave its start alone. Bounding those would have refused moves of series that are simply old.
- **Accepting a proposal checks the bound again**, against the day of the decision.
- **No behaviour change otherwise:** the window rule and the query bound give the same occurrences and conflicts as before. "Moves don't reset answers" and the sends table are kept.

### Tests added or changed
- packages/shared: `meetings.test.ts` (the oracle against the old walk, with a check that it compared over a thousand occurrences and moved ones among them; a monthly series' far dates; 200 series from 1900 against a day in 2999 under 250 ms); `meeting-input`, `meeting-changes`, `meeting-moves` and `meeting-proposals` (the bound on each rule; a move of an old series as All events still allowed; 200 conflicts from 1900 series under 250 ms). The fixtures gained `TODAY`.
- `apps/api/test/meetings-moves.int.test.ts`, now 24 cases:
  - new: the bound on `POST /meetings`, `POST /meeting-requests`, `PATCH`, a proposal in an answer and a move, with nothing written;
  - new: conflicts three years out with 600 series from 1900 sharing the guest, under 2.5 seconds, the one real overlap found;
  - new: undo refused after the split was answered, edited or cancelled;
  - changed: the "Long runner" series and the 100-exception series start where the bound allows. The first is written directly back to two years ago, the second starts 300 days ago, so neither fails in some months of the year.

### Checks run (this round)
- packages/shared `vitest run`: 54 files, 613 tests passed.
- apps/api `vitest --project unit`: 12 files, 66 tests passed.
- Integration `meetings` and `meetings-moves`: 56 of 56. `isolation`, `permissions` and `notifications`: 60 of 60.
- `pnpm -s typecheck`: 6 of 6; web and db forced past the cache (`turbo run typecheck --force`): both passed.
- `pnpm -s lint`: 6 of 6. Prettier `--check` on the touched code and tests: clean.
- Not run: Playwright and `next build` (no screen changed, and forbidden on this laptop).

## Review round 2 of PR #35
One finding, should fix, confirmed by a skeptic. Fixed, with a test.

- **Should fix (correctness):** `MeetingsService.update` re-sent a series' surviving exceptions only after a start or length change. Each occurrence moved on its own sits in a guest's calendar as its own RECURRENCE-ID override, with the SUMMARY, LOCATION, DESCRIPTION and VALARM it was sent with. RFC 5545 has an override replace its occurrence whole. So after a "this event" move and then a place edit, the guest's calendar probably kept the old place for that week, and after a title edit the old title. A calendar that replaces the whole set on a series-only REQUEST would drop the override instead. Part 2 made this reachable, since "this event" moves now create exceptions on the API.
- **Fix:** every PATCH of a series sends its surviving exceptions again (`resendExceptions: true`), since every field an edit can change (title, notes, place, start, length, reminder) is in the file. The JSDoc of `update`, `InviteOptions.resendExceptions` and the shared `exceptionResends` say why.

### Decisions
- **Re-send rather than only record the gap.** The copies go to the same guests with the same content as the series invite, so nothing new is exposed, and a guest no longer risks going to the old place. It extends safest option 5, which already deviated from meetings.md "Differences from ADR 0021"; the sends-table rows are unchanged. The cost is one email per guest per surviving exception, counted by the daily caps, so an edit of a big series may be refused rather than half sent (ADR 0051 "Residual risks").
- **A reminder-only edit re-sends too,** because the VALARM is in the file and the guest gets the series "Updated" invite anyway.
- **Undo of "this event" is left as it was:** it sends the series REQUEST and that occurrence, not the other exceptions, whose content has not changed. Recorded as a residual risk in ADR 0051, not changed, since the finding did not cover it and it would change that undo's sends.

### Tests added
- `apps/api/test/meetings-moves.int.test.ts`, now 25 cases: a weekly series, one occurrence moved with "this event", then a place, title, notes and reminder PATCH in turn. Each adds exactly one RECURRENCE-ID file per guest, carrying the new value, the occurrence's own time, SEQUENCE 2 and no weekly RRULE, and the stored exception is unchanged.

### Docs
- ADR 0051: "Series exceptions sent again" (when, and why), "Limits (part 2)", a "Review round 2 of PR #35" section, safest option 5, "For the owner (part 2)", "Residual risks (part 2)" and the test count.
- The blueprint-delta part 2 row, meetings.md (edits and "Series exceptions"), api-contract.md (`PATCH /meetings/:id`) and notifications.md (`meeting.invite`).

### Checks run (this round)
- Integration `meetings` and `meetings-moves`: 57 of 57 (the new case failed once on its own assertion: the VTIMEZONE block has an RRULE, so it now checks for no `RRULE:FREQ=WEEKLY`).
- packages/shared `meeting-sends` and `ics`: 42 of 42.
- `pnpm -s typecheck`: 6 of 6. `pnpm -s lint`: 6 of 6. Prettier `--check` on the touched code and test: clean.
- Not run: Playwright and `next build` (no screen changed, and forbidden on this laptop).

## Review round 3 of PR #35
Three findings, each confirmed by a skeptic: one blocking and two should fix. All fixed, with tests (`8ac787d`, `fa192b5`).

- **Blocking (correctness):** rule 4's shift moves each exception's planned time but keeps its own time, and `strandedException` only checked that the shifted planned time was still on the rule. A weekly Friday series whose last Friday was held an hour late, moved to Mondays with "all" (or by a PATCH of the start), tied that held occurrence to tomorrow's Monday. The app then had no meeting tomorrow and no reminder, `exceptionResends` skipped the held occurrence because it had ended, and the new series file gave every guest a plain Monday instance. A shift that put an exception's own time more than 31 days before its planned date also hid it from the calendar, the reminders and the conflict check. Part 1 refused any timing change on a series with exceptions, so part 2 made this reachable.
- **Should fix (correctness):** "this and following" checked only rule 3 on the new start, so the new series could start before the old one's last kept occurrence. Both series then held the same weeks and every guest got both REQUESTs, for years with a far `planned`. The Reschedule form can reach it.
- **Should fix (tests):** no route test split or undid a series with occurrences moved on their own, so the split's stored exceptions, the per-UID re-sends and the undo's restore through the audit entry had shared unit coverage only.

### Fixes
- `packages/shared/src/meetings/moves.ts`:
  - `beyondReach` (an exception's own day more than `MOVED_EARLIER_REACH_DAYS` before its planned day) and `leftBehindProblem` (an exception whose own time has ended by `now` while its planned slot, as the change leaves it, has not), both used by `strandedException`. So they cover an "all" move, the shifted exceptions of a split and PATCH through `shiftedSeriesProblem`;
  - `moveProblem` also runs `leftBehindProblem` on the old series of a split, refuses a "this event" move more than 31 days earlier, and refuses "this and following" at or before `lastKeptEnd` (the latest end among the kept exceptions and the nearest planned date before `planned` that is not one, found by walking back with the new `previousPlannedStart` in `operations/meetings.ts`);
  - `undoneSeriesProblem` refuses an undo of "all" or a split that would leave one behind (400, in `MeetingMoves.undo` after `undoProblem`).
- `hasEnded` in `sends.ts` is the one "has this slot ended" rule, used by `exceptionResends` and by `leftBehindProblem`, so the refusal and the re-sends never disagree.
- `moveProblem`, `editProblem` and `shiftedSeriesProblem` take `now`, the database clock of the change. The routes read `databaseNow` before the check. `editProblem` now checks a length-only change of a series too.

### Decisions (safer direction, in the blueprint-delta row and ADR 0051)
- **Refuse rather than re-send.** The other fix the skeptic named, sending a past-dated override for an ended exception whose planned date is ahead, would change what guests receive; the decision rule keeps the sends. A refusal can hold a series' time, length or rule back until that date's slot ends; "this event" moves still work. Recorded as a residual risk and an owner question.
- **The same check on every change of a series' time or rule,** not only on shifts: the old series of a split (its UNTIL changes), a length-only PATCH (its DTEND changes) and an undo of "all" or a split. Each sends the exceptions again under the same "not ended" bound, so the same held occurrence would be lost the same way. A place, title, notes or reminder edit leaves the time and rule alone and is not checked.
- **The undo's refusal is 400 `invalid_request`,** like a refused move and the daily caps, not a new 409 code: the meeting has not changed since the move, the undo just can't be sent correctly.
- **"This event" more than 31 days earlier is refused too:** the reach limit already hid such an occurrence (a residual risk of round 1), and no move or edit can now make one.
- **The overlapping split is refused at or before the end** of the last kept occurrence, so back to back counts too: the meeting would run twice in a row. Rule 4 does not say, and the demo allows it.

### Tests added
- packages/shared `meeting-moves`: `previousPlannedStart` (weekly, biweekly, monthly, the first date); the overlapping split (the reviewer's earlier weekday, an overlap, back to back, a far `planned`, an exception kept later or earlier, monthly); the reach on "this event" and on "all"; left behind on "all", both series of a split and its undo, with "this event" and a past-keeping shift taken; `meeting-changes`: a PATCH start and a length-only PATCH refused, and the reach on a PATCH. A fixed `NOW` fixture is the database clock.
- `apps/api/test/meetings-moves.int.test.ts`, now 27 cases: a split between an earlier and a later occurrence moved on their own, with the stored exceptions on both rows, one RECURRENCE-ID file per series under its own UID, and the undo restoring start, `until` and both exceptions and re-sending both at SEQUENCE 4; a PATCH start, a PATCH length, an "all" move and an undo refused with the row, the Outbox and the audit log unchanged, and a past-keeping PATCH taken; and two overlapping splits refused in the refusals case, with no series inserted.

### Docs
- ADR 0051: the move refusals, undo check 5, "Series exceptions sent again", a "Review round 3 of PR #35" section, safest options 4 and 5, "For the owner (part 2)", "Residual risks (part 2)" and the test count.
- The blueprint-delta part 2 row, meetings.md ("Moves refused" and "Undo") and api-contract.md (`POST /meetings/:id/reschedule`, `PATCH /meetings/:id`, the undo row and "Undo answers").

### Checks run (this round)
- Integration `meetings-moves`: 27 of 27; `meetings`: 32 of 32. `apps/api` unit `meeting-undo`: 2 of 2.
- packages/shared `vitest run`: 54 files, 619 tests passed.
- `pnpm -s typecheck`: 6 of 6, and web forced past the cache: passed. `pnpm -s lint`: 6 of 6. Prettier `--check` on the touched code, tests and docs: clean.
- Not run: Playwright and `next build` (no screen changed, and forbidden on this laptop).

## Outcome
- Part 2 is built, tested and documented on `feat/meetings-api-moves` (draft PR #35): the reschedule, undo and proposal-decision routes, conflicts with "Busy", the series exceptions sent again (lifting part 1's refusal), and the PATCH change.
- Every deviation from meetings.md is in the safer direction and is recorded in ADR 0051 "Part 2" and the blueprint-delta row. "Moves don't reset answers" and the sends table are kept.
- Review round 1 of PR #35 is fixed (above): occurrences worked out from the window, the conflict query bounded to the moved day, typed starts bounded, the split guard tested and the answer reset written once.
- Review round 2 of PR #35 is fixed (above): every edit of a series sends its surviving exceptions again.
- Review round 3 of PR #35 is fixed (above): an overlapping "this and following", an exception put out of the calendar's reach, and a series change that would leave an occurrence already held at a date still ahead are refused; a split and undo with exceptions is tested at route level.
- **Next:** a fresh security-reviewer pass on the round 1 fixes (the start bound, the conflict query, the window rule); then mark the PR ready, wait for `verify` and `e2e`, and self-merge under the CLAUDE.md rule. Then part 3, the web on the API.
- **Open for the owner:** the questions under "For the owner" above, also in ADR 0051.

## Final checks (orchestrating session, merged head `3f6f7a6`)
- **Merge of main.** `bb3e81f` (platform admin part 1, PR #34) merged in as `3f6f7a6`. One conflict, in docs/blueprint-delta.md: both rows kept, this one first.
- **STATUS and BRANCHES** updated in `0f3e4e3`: the PR #35 entry, the part 2 owner questions and residual risks, PR #34 recorded as merged, and the platform part 3 branch.
- **Full checks** through the lock, with the CI database variables (this worktree has no local env file), all exit 0: `pnpm lint`, `pnpm typecheck`, `pnpm test` (shared 667, api 72, web 33, db 11, providers 11) and `pnpm test:api` (api 465, db 45, providers 2).
- **Not run locally:** Playwright, because no screen changed. CI's `verify` and `e2e` run the demo and api-mode suites.

## Final review of PR #35 (head `0f3e4e3`)
Three should-fix findings on correctness, each confirmed by a skeptic. All three are fixed, with two cheap notes. Owner asleep, so each choice is the safest one and is recorded in ADR 0051 "Part 2" ("Final review of PR #35", safest options 4 to 6, "For the owner (part 2)", residual risks) and in the part 2 row of docs/blueprint-delta.md.

### Fixes
- **"All events" from an occurrence moved on its own** (`packages/shared/src/meetings/moves.ts`): rule 4's shift kept that occurrence at its own time, so it stayed put while the series moved, and the conflict check looked at a slot it did not hold. `moveProblem` now refuses "all" when `planned` names a live exception with its own start or length (`changedOnItsOwn`): 400 "This occurrence was changed on its own. Choose This event, or move another occurrence to move all events.", nothing written. "This and following" from such an occurrence was checked and is not refused: the split drops the exception at `planned`, so the new series starts at the new time and length, the slot the conflict check names.
- **Undo of "this event"** (`MeetingMoves.undoPlans`): its series REQUEST now passes `resendExceptions: true`, as every other series REQUEST does. The restored occurrence's REQUEST goes only when the re-sends do not already carry its RECURRENCE-ID, so one Outbox version is never planned twice and the caps count it once.
- **Held occurrences on every series REQUEST** (`editProblem`, `undoneSeriesProblem`): `leftBehindProblem` now runs on every edit of a series that changes a field and on every undo, "this event" included, with round 3's choice kept (refused until the held occurrence's planned slot ends). `leftBehindProblem` takes the message's last sentence: "Edit the series after that date." for an edit that changes no time, "Move the occurrence back with This event instead." for an undo of "this event".
- **Notes:** `MeetingSends.plan` deduplicates the colleague ids before `activeMembers`; the conflict query (`meetingsSharing`, now exported for its test) reads a series only while its `until` is not before the day, unless it has exceptions, which can be moved past `until`.

### Decisions
- **Refuse, not carry along:** making "all" move the dragged occurrence to the new time would change rule 4's shift; refusing writes nothing wrong and leaves This event and This and following.
- **The length counts too:** a resized-only exception would keep its old length while the series and the conflict check took the new one, so it is refused as well. The message says "changed", as the other exception messages do.
- **"Following" is not refused:** it has no such flaw (above). Its old-UID override past the new UNTIL is the stray-override risk every split carries, now named in the residual risks.
- **One held-occurrence rule for every series REQUEST,** whether or not invites are on, as round 3's rule is; a change of nothing still writes nothing and is never refused.
- **The conflict query is narrowed** rather than its docstring corrected: `until` and the day are both local dates, compared as the shared rule compares them, and series with exceptions stay in.

### Tests added
- packages/shared `meeting-moves`: "all" from a moved and from a resized-only occurrence refused; "all" from another occurrence, "this event" and "this and following" from it taken, the split's dragged occurrence found at the new time by `meetingOccurrences` and named by `movedOccurrenceKey`; an undo of "this event" refused while one is held early, taken once that date passes and with nothing held. `meeting-changes`: a title, place, notes and reminder edit refused while one is held early; taken after the date, with nothing held, with an exception still ahead, on a one-off and with no change.
- `apps/api/test/meetings-moves.int.test.ts`, now 30 cases: "all" from an occurrence moved on its own refused with the row, the Outbox and the audit log unchanged, and "this and following" from it starting at the new time; an undo of "this event" re-sending a second exception at the undo's SEQUENCE, and, after that exception is moved again and undone, it goes once (audit `sends` totals 3 and 2); the held-occurrence case extended with a place and a title edit and an undo of "this event" refused, and a place edit taken once nothing is held; the narrowed conflict query read directly (open, ending that day and moved past its end read, ended not) with the move's warning unchanged.

### Docs
- ADR 0051: the move refusals, conflicts "Which meetings", undo check 5 and its sends, "Series exceptions sent again", a "Final review of PR #35" section, safest options 4 to 6, "Kept as meetings.md says", "For the owner (part 2)" (the held-occurrence question now covers every series edit and undo; a new one on "all" from a moved occurrence), residual risks (the held-occurrence one widened, a new one for "all", the wrong "as before the move" line removed, splits named under stray overrides) and the test count.
- The blueprint-delta part 2 row, meetings.md ("Moves refused", "Undo", "An undo also sends", "Series exceptions") and api-contract.md (`PATCH /meetings/:id`, `POST /meetings/:id/reschedule`, the undo row and "Undo answers").

### Checks run (this round)
- Integration `meetings-moves`: 30 of 30; `meetings`: 32 of 32. `apps/api` unit `meeting-undo`: 2 of 2.
- packages/shared `vitest run`: 55 files, 669 tests passed.
- `pnpm -s typecheck`: 6 of 6, and web forced past the cache: passed. `pnpm -s lint`: 6 of 6, with Prettier clean.
- Not run: Playwright and `next build` (no screen changed, and forbidden on this laptop).
