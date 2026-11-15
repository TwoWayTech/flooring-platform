# Session 2026-11-15 06:00, B (Claude): meetings on the API, part 2 (reschedule, undo, proposals, conflicts)

Module 14 of docs/real-build-plan.md ("Meetings, invites and .ics", spec meetings.md). Part 2 of 3. Branch `feat/meetings-api-moves`, from `origin/main` at `1de1e0c` (part 1, PR #33), in its own worktree (`../flooring-platform-meetings`), because another build runs in the main checkout on another branch.

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

### Residual risks
- **Calendars may keep stray overrides:** after an `all` move or an undo, a guest's calendar may keep an override under a RECURRENCE-ID that is no longer an instance (Google). No valid message can cancel it.
- **The daily caps can block a move:** a series with many exceptions and guests sends one REQUEST per guest per exception, so the caps can refuse moving it on a busy day.
- **Undo is short:** it is offered for 5 minutes, to the mover only. Anything later is a new move.
- **The demo keeps its own copies:** it keeps its conflict self-warnings and private titles until part 3.

## Run in this stage
- No code changed, so no checks were run. Prettier checked this log.
