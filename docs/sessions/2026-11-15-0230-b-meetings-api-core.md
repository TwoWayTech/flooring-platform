# Session 2026-11-15 02:30, B (Claude): meetings on the API, part 1 (core, invites, .ics, reminders)

Module 14 of docs/real-build-plan.md ("Meetings, invites and .ics", spec meetings.md, depends on module 5; week 18 in the schedule). Part 1 of 3. Branch `feat/meetings-api-core`, from `origin/main` at `0aba18e`, in its own worktree (`../flooring-platform-meetings`), because another build runs in the main checkout on `feat/hr-pay-reasons-and-history`. Draft PR (link added below once opened).

## Prompt
- A workflow run while the owner is asleep. The instruction it relays: follow docs/product-spec/meetings.md as the approved behaviour. Deviate only in the safer direction (less data exposure, deny by default, input and volume limits, refusing what can't be done correctly), and record each deviation in docs/blueprint-delta.md. Defer what can't be done safely; don't invent it. No change to existing tables and no new dependency.
- docs/STATUS.md says the queue is paused until the owner says so. This run's go-ahead came through the workflow, so the PR stays a draft until the owner confirms it.
- Inputs: five reader reports, a first plan and a critic's review of it. They sit in the session scratchpad, not in the repo; this log is the corrected plan.
- Scope: shared rules, the API routes, emailed .ics, reminders, the Summit seed, tests and docs. The web does not change, and the demo keeps working.

## Plan

### Corrections to the first plan (critic A1 to A5)
- **A1:** the 5 in row 14 of the build plan is the "Depends on" column (module 5, the notifications core), not an estimate. The three-part split stays; we sized the parts ourselves.
- **A2:** this branch overlaps the HR branch in `docs/data-model.md`, `packages/db/test/seed.int.test.ts` and `packages/shared/src/index.ts`. Rebase before marking ready. Part 1 touches neither `packages/db/src/seed/hr.ts` nor `apps/web`.
- **A3:** staff guests are seeded with `userOf(fixtureUserId)`, which is `seededUserId` = `seedId("user:<id>")`, never with `seedId(id)`.
- **A4:** the Owner is the reader who can open a private meeting's invite in `GET /outbox`, because the Owner holds both `settings.outbox.view` and `hr.employee.view`. The fix is under "Core changes".
- **A5:** reminders go to staff guests only. That is already spec rule 10, not a change.

### Tables
- `meetings`, `meeting_attendees` and `meeting_responses` are used as they are (company migration 0000), with no migration.
- Read only:
  - company: `settings` (group `meetings`), `user_profiles`, `user_roles` and `role_permissions` (who is an active member), `customers`, `customer_contacts`, `suppliers`, `supplier_contacts`;
  - control: `user` (names and emails) and `tenants.time_zone` (`companyClock`);
  - `outbox_messages`, through NotificationService only.
- Times:
  - `start`, `responded_at` and `proposed_start` are stored as instants and converted through `meetings.time_zone`;
  - the wire and the shared rules keep the spec's local `YYYY-MM-DDTHH:mm`;
  - `exceptions` and `proposal.start` stay local in jsonb.
- Ids:
  - `Attendee.id` on the wire is `party_id` for a linked guest and `meeting_attendees.id` for an email guest. Both are UUIDs, and `:attendeeId` is looked up only inside its own meeting.
  - `meeting_responses.attendee_id` holds the attendee row id.
- `updated_at` is set from `databaseNow(tx)` on every meeting write. It becomes the DTSTAMP and part of the invite version.
- There is no reminders table: a reminder is a `scheduled` `outbox_messages` row.

### Shared rules (`packages/shared`), with unit tests
- **`calendar/zones.ts`:**
  - `zonedToInstant` (strict, for input): a time in the spring-forward gap is a problem; a time that happens twice takes the earlier instant (RFC 5545 3.3.5).
  - `zonedToInstantLenient` (for occurrences derived from a rule): a time in the gap uses the offset from before the gap.
  - `instantToZoned`.
  - `supportedMeetingZone`: the zone's canonical name (Intl `resolvedOptions`) when it is one of the 7 zones in `ics.ts`, otherwise null.
- **`calendar/ics.ts`:**
  - control characters (a lone CR included) are stripped from every text value;
  - CN is also stripped, has `"` turned into `'`, and is capped in length;
  - ATTENDEE and ORGANIZER lines are written only for a valid email;
  - an optional `prodId`: the API uses `-//Platform//Meetings//EN`, and the demo keeps its own;
  - DTEND is the start instant plus the length, not wall-clock time;
  - a monthly series that starts after day 28 gets DTSTART on its second occurrence and its first as an RDATE. That way the file matches `meetingOccurrences` (RFC 5545 3.8.5.3: DTSTART must lie on the rule). A series that ends before its second occurrence gets no RRULE.
- **`meetings/access.ts`:**
  - `seesMeeting`: the spec's "Who sees which meeting" table, with the attendee kind checked;
  - `canChangeMeeting`: holds the edit key, sees the meeting, and is the organiser or has a data scope wider than own;
  - `meetingForViewer`: hides and blanks fields for the viewer (Decisions 3).
- **`meetings/input.ts`:** `meetingInputProblem`, `guestLimitProblem`, `replyProblem`, `proposalProblem`, and `DEFAULT_MEETING_SETTINGS`.
- **`meetings/replies.ts`:**
  - `replyOutcome`: rules 7 and 8, and a request moving to confirmed or cancelled;
  - `significantChange`: rule 6.
- **`meetings/sends.ts`:** `sendPlan`, one entry per guest. It covers the Part 1 rows of the spec's sends table: schedule, edit, significant edit, cancel and remove guest.
- **`meetings/reminders.ts`:** `nextReminder(meeting, now)` returns `{ occurrence, scheduledFor, expiresAt }`, or null when `scheduledFor <= now` (rule 10).
- **`types/meetings.ts`:** `GuestOption` and `MyMeetings`.
- **Unit tests:**
  - zones: round trips for the 7 zones, the gap, the overlap, aliases;
  - ics: CN injection, a lone CR, a bad email dropped, PRODID, DTEND on the fall-back day, the day-30 RDATE;
  - access: the 9 role templates × data scope × private;
  - input, replies, reminders (an occurrence in a DST gap);
  - sends: one case per Part 1 row.

### Core changes (shared pieces that reviewers should check)
- **`notification-rules.ts`:**
  - `emailAttachments`: an .ics becomes a `Uint8Array` with the content type `text/calendar; method=<METHOD>; charset=UTF-8`; a PDF that has only an href is skipped;
  - `visibleOutboxRow`: a restricted row whose source is a meeting is redacted for every reader who is not involved, holders of `hr.employee.view` and the Owner included (A4);
  - `expired(values, now)`.
- **`notification.service.ts`:**
  - `sendJob` passes the attachments on;
  - `NotifyInput.expiresAt` is stored in `values` as `outbox.expiresAt`, so no column is added;
  - `sendJob`, and therefore Retry, cancels an expired row and sends nothing;
  - `cancelScheduled(tenant, event, source)` cancels a source's scheduled rows with one update.
- **`packages/providers`:** no change, since `resend.ts:27` already turns a `Uint8Array` into a Buffer.

### API (`apps/api/src/modules/meetings/`)
- **Files:**
  - `meetings.module.ts`: imports NotificationsModule; registered in `app.module.ts`;
  - `meetings.controller.ts`: `@RequireModule("meetings")`, strict Zod bodies, `requireFeature` first in each handler;
  - `meetings.service.ts`;
  - `meeting-records.ts`: rows to the wire shape, then viewer shaping;
  - `meeting-guests.ts`: resolves guests;
  - `meeting-sends.ts`;
  - `meeting-reminders.ts`;
  - `meetings-common.ts`: `lockMeeting` (404 when missing or out of scope), `auditMeeting`, settings.
- **Every route:**
  - answers 404 when `meetings.calendar` is off;
  - takes the tenant only from TenantConnectionService;
  - checks `:id` with ParseUUIDPipe.
- **Every write:**
  - carries `@RequirePermission` and `@Audited`;
  - writes its audit entry in the same transaction;
  - sends and syncs reminders after commit, with one try/catch per guest.

| # | Route | Needs | Rules | Audit | Sends |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET /meetings` | `meetings.meeting.view` | `seesMeeting`; cancelled meetings left out; `meetingForViewer` | None | None |
| 2 | `GET /meeting-guests` | `meetings.meeting.create`; switch `meetings.invites` | `GuestOption[]`: active staff (id and name, no email); customers and their contacts with `customers.customer.view` and `seesCustomer`; suppliers and their contacts with `purchasing.supplier.view` | None | None |
| 3 | `GET /me/meetings` | `hr.portal.view`; switch `hr.portal` | `{ viewerUserId, meetings: [{ meeting, next }], colleagues }`. Only meetings where the caller is organiser or a live staff guest, not cancelled, with the next occurrence from the company's today, up to 366 days ahead. `colleagues` holds active members with `meetings.meeting.view` as `{ id, name }`, and only when the caller holds create and `meetings.requests` and `meetings.invites` are on | None | None |
| 4 | `POST /meetings` | `meetings.meeting.create` | Strict body. The zone comes from `companyClock`; 409 `time_zone_unsupported` outside the 7 zones. The server adds the organiser (accepted) and resolves every guest. Any guest needs `meetings.invites` (400 when off). Guest caps apply. `hideGuestList` is forced (Decisions 4). `allowProposals` = the setting AND the organiser holds edit | `Scheduled meeting`: null → `{ start, guests }` | `meeting.invite` REQUEST, CONFIRMED, SEQUENCE 0, to every guest except the organiser, in-app for staff; reminders synced |
| 5 | `PATCH /meetings/:id` | `meetings.meeting.edit` and `canChangeMeeting` (403) | Strict `{ title, notes, location, start, durationMin, reminderMin }`. A cancelled meeting is refused. A change of nothing writes nothing. A change to start, length or location is significant: +1, `rescheduleSequence` = the new sequence, and every answer and proposal is reset, the organiser's included. A new start is checked against the zone, and `recurrenceProblem` runs only when start changes. A repeating meeting with exceptions refuses a start or length change until Part 2 | `Edited meeting`: `{ start, changed }` → `{ start, changed }` | REQUEST "Updated" to every guest; reminders synced |
| 6 | `POST /meetings/:id/cancel` | edit and `canChangeMeeting` | Refused (400) when already cancelled; +1, and `rescheduleSequence` = the new sequence | `Cancelled meeting`: status → `cancelled` | CANCEL, CANCELLED, to every guest; reminders cancelled |
| 7 | `DELETE /meetings/:id/attendees/:attendeeId` | edit and `canChangeMeeting`; switch `meetings.invites` | The organiser can't be removed and the meeting must not be cancelled. An attendee not on this meeting gives 404. The row is soft-deleted; +1 | `Removed meeting guest`: `{ guest }` → null | CANCEL with no STATUS, listing that guest only, sent to them only; reminders synced |
| 8 | `POST /meetings/:id/response` | `meetings.meeting.view`; switch `meetings.invites` | The caller must be a live staff guest, not the organiser, on a meeting that is not cancelled. The answer is `accepted`, `tentative` or `declined`. A proposal forces `tentative` and needs `allowProposals`, no recurrence, a time that exists in the zone and 15 to 1440 minutes. Note at most 500 characters. Logged in `meeting_responses`. On a request, Accept confirms it and Decline cancels it, each +1 | `Answered meeting`: old → new answer | `meeting.reply` or `meeting.proposed` to the organiser (email and in-app), version = the response id; a request answer syncs reminders |
| 10 | `POST /meeting-requests` | `meetings.meeting.create`; switches `meetings.requests` and `meetings.invites` | `withUserId` must be an active member holding view, and not the caller. 30 minutes and "To be agreed" are fixed. Saved tentative, kind `request`; `hideGuestList` = private; no reminder while tentative | `Requested meeting`: null → `{ with }` (just "Colleague" when private) | `meeting.requested` to the person asked (email and in-app), version `request` |
| 11 | `GET /meetings/:id/calendar.ics` | `meetings.meeting.view` | `seesMeeting` and not cancelled, otherwise 404. JSON `{ fileName, text }`: PUBLISH, no ATTENDEE, no STATUS, the current UID and SEQUENCE | None | None |

- **Not in Part 1:**
  - Part 2: `reschedule` and `undo` (undo to be rebuilt on the server from the last "Moved meeting" audit row, critic B3) and `decideProposal`.
  - Never on the API: `simulateReply` (stays demo-only) and a delete route (`meetings.meeting.delete` stays unused).
  - Deferred: Settings → Meetings on the API, and saving guests as contacts or leads.
- **Guests:** resolved on the server.
  - Ignored when the client sends them: names and emails of linked guests, and `partStat`, `role`, `respondedAt`, `respondedSequence`, `note` and `proposal` on every guest (critic B4). An entry for the organiser is dropped.
  - staff: must be an active member; name and email come from the control `user` table.
  - customer and customer contact: need `customers.customer.view` (which needs the core module) and `seesCustomer` on the customer.
  - supplier and supplier contact: need `purchasing.supplier.view`.
  - Any other linked guest gives 404.
  - New email guest:
    - the address must pass `validEmail` and be at most 254 characters;
    - each address counts once;
    - an active member's address becomes that staff guest;
    - any other address is an external guest with `party_id` null, named as given or by the email.
- **Invites:**
  - one `notify` per guest, carrying `{ kind: "ics", fileName, text }`;
  - version `${sequence}-${method}-${recurrenceId ?? ""}-${updatedAt in ms}`;
  - `restricted` = private, and `meeting.sequence` is in the values;
  - STATUS:TENTATIVE while a request is tentative;
  - nothing is sent while `meetings.invites` is off.
- **Reminders (`syncReminders`):**
  - Triggers: create, PATCH, cancel, remove guest, and an answer to a request.
  - It runs in its own transaction that holds the meeting row lock. It re-reads the meeting, calls `cancelScheduled`, then raises `meeting.reminder` for the next occurrence.
  - Recipients: the live staff guests except the organiser.
  - Settings: actor null, no in-app note, `expiresAt` = the occurrence's start, `restricted` = private.
  - Version: `${sequence}-reminder-${occurrence}-${uuidv7}`, so a re-sync is never swallowed by the dedupe key (critic B1).
  - None while invites are off, for a cancelled meeting or for a tentative request.
  - Only the next occurrence is covered. A cron for later occurrences and for the seeded series comes in Part 4.

### Seed
- `packages/db/src/seed/meetings.ts` with `seedMeetings(tx, demo)`, called last in `seedCompany`.
- Meetings:
  - id: `seedId(fixture.id)`;
  - owner and `createdBy`: `userOf`;
  - the fixture's uid;
  - `start`: `zonedToInstant(start, timeZone)`, which stops the seed if a problem comes back.
- Attendees:
  - id: `seedId("<meeting>:guest:<index>")`;
  - `party_id`: `userOf` for staff (A3), `seedId` for customers, suppliers and contacts, and null for `ext-` guests.
- No responses and no Outbox rows. Every insert ends with `onConflictDoNothing`.
- `seed.int.test.ts` checks:
  - 12 meetings and every attendee;
  - staff party ids are control users;
  - Riley Chen is external with a null `party_id`;
  - the weekly huddle, 2026-10-02 14:00 in Denver, is 20:00Z;
  - the day-30 monthly meeting is kept as the fixture has it.

### Tests
- **Unit:** the shared tests above, plus `apps/api/test/outbox-attachments.test.ts` and the Outbox rules (private redaction, expiry).
- **`apps/api/test/meetings.int.test.ts`** (AuthHarness, laid out like `portal.int.test.ts`):
  - Access:
    - 401, 403 and 404 for each switch, and `module_not_enabled`;
    - scope: Employee own, Manager branch, the attendee kind checked;
    - a private meeting is hidden from the Owner in `/meetings`, `calendar.ics` and `/outbox`;
    - a removed guest loses a private meeting;
    - seeded staff guests match the users who sign in;
    - a second company gets 404.
  - Create:
    - validation and the DST gap;
    - the 50 and 20 caps per meeting and the 50-a-day cap;
    - client-sent organiser and guest fields are ignored;
    - a customer out of scope gives 404; a customer guest in an HR Suite company is refused;
    - an unsupported zone gives 409;
    - 09:00 America/Chicago in November is stored as 15:00Z;
    - one row per guest except the organiser, restricted when private, in-app for staff;
    - the sent attachment has METHOD:REQUEST, the UID, SEQUENCE:0 and a `text/calendar` type;
    - a hidden list shows one ATTENDEE, and a customer guest forces the hidden list;
    - a lone CR is stripped;
    - the reminder is scheduled at start − reminderMin;
    - the audit entry holds no emails.
  - Switches: with invites off, guests are refused, guest routes give 404 and nothing is sent; requests give 404 when either switch is off.
  - PATCH:
    - a title edit keeps SEQUENCE, a start edit adds 1 and resets answers;
    - a cancelled meeting is refused;
    - a Sales guest with edit gets 403, a Manager may change it;
    - a reminderMin change from 15 to 60 leaves exactly one scheduled reminder (B1);
    - a title edit on the day-30 monthly meeting works;
    - a move to day 29 or later is refused;
    - a series with exceptions refuses a new start.
  - Cancel: CANCEL to all, a second cancel refused, reminders cancelled.
  - Remove guest: only that guest gets the CANCEL; the organiser can't be removed.
  - Response:
    - only a staff guest may answer, never the organiser, and `needs-action` is refused;
    - the proposal rules;
    - a response row is written;
    - two guests' replies give two rows to the organiser (B2);
    - a request accepted is confirmed and gets reminders; declined, it is cancelled.
  - Request:
    - asking oneself is refused;
    - length and place are fixed;
    - `meeting.requested` is sent.
  - Calendar file: PUBLISH with no ATTENDEE; a cancelled meeting gives 404.
  - `/me/meetings`: own, upcoming, next occurrence.
  - Hidden fields: a linked customer's name is blanked for Warehouse; other guests' reply notes are blanked.
  - A reminder whose meeting has started is cancelled on Retry and not sent (critic F).
- **Must stay green:** `isolation`, `permissions`, `notifications`, `seed` and `table-rules` integration tests.
- **Not run:** Playwright, since no screen changes.

### Docs
- **ADR 0051:** still the next free number; check again before ready.
- **api-contract:**
  - a new "Meetings (real build, ADR 0051)" section;
  - the rows at :496-504;
  - :429, so meetings are written only by actions.
- **meetings.md:** a "Real build" section; :488 is stale.
- **data-model:**
  - :172: there is no reminders table;
  - :173, :213 and :316: the meaning of the attendee id.
- **notifications.md:**
  - the .ics is emailed;
  - reminder rows are cancelled and replaced;
  - expiry;
  - private-meeting rows are redacted.
- **environment.md:** reminders need at least one instance with `JOBS_ENABLED=true`, and an expired reminder is dropped.
- **blueprint-delta:** one row for each decision marked "delta" below.
- **FEATURES.md:** no change; statuses stay `demo`.

### Order of work (one commit each, pushed)
1. Shared zones, ics and meetings rules, with tests.
2. The core notification changes, with tests.
3. The API routes.
4. Reminders.
5. The seed and its test.
6. The integration tests.
7. Docs.

Then lint, typecheck and tests through the lock, and the security-reviewer and schema-reviewer passes.

## Decisions

### Safer than the spec (each a blueprint-delta row)
1. **Who may change a meeting:** `canChangeMeeting` = the edit key, sees the meeting, and is the organiser or has a scope wider than own.
   - The spec lets any edit holder who sees a meeting change it. This stops an own-scope Sales guest from changing a colleague's meeting.
   - Branch scope does not look at the branch, because meetings have none. The ADR says so.
2. **Private meetings** are invisible to anyone who is neither organiser nor staff guest, the Owner included (spec :51). That holds in `GET /outbox` too: subject, body and .ics are redacted for readers who are not involved, even with `hr.employee.view` (A4). Recipient, status and dates stay visible, as the core rule does for any redacted row.
3. **What a viewer sees** (this also covers critic section C):
   - other guests' emails are blank unless the viewer is the organiser or passes `canChangeMeeting`;
   - a hidden guest list is shown only to those same people (the spec shows it to any edit holder);
   - a linked customer, supplier or contact the viewer can't see shows as "Customer", "Supplier", "Customer contact" or "Supplier contact", with no email;
   - other guests' reply and proposal notes are blank unless the viewer is the organiser.
4. **Hidden guest list:** `hideGuestList` is forced for any guest who is not staff. The spec forces it only for email guests, but customers, suppliers and contacts are outside the company too.
5. **Volume limits:**
   - at most 50 guests and 20 email guests per meeting;
   - at most 50 new email addresses per user per company day, counted from that user's external attendee rows (deleted ones included) under a per-user advisory lock.
6. **Input limits:**
   - title 1 to 200 characters, location up to 200, notes up to 4000, guest name up to 100, reply note up to 500;
   - length 15 to 1440 minutes on create and edit (the spec checks length only on a move);
   - reminder 10, 15, 30 or 60 minutes;
   - `needs-action` refused as an answer.
7. **Switch dependencies:** with `meetings.invites` off, guests are refused (400), the guest routes give 404 and nothing is sent, reminders included. `meetings.requests` needs `meetings.invites` (404 otherwise), so a request can always be answered.
8. **Owned by the server:**
   - the organiser;
   - the zone, from `tenants.time_zone` through `companyClock`, with a 409 outside the 7 zones and no tz library;
   - `allowProposals` = the setting AND the organiser holds edit, so no proposal is offered that nobody could decide;
   - a request's length and place;
   - every guest field.
9. **DST:** a start that doesn't exist on the clock is refused, on create, a PATCH of start and a proposal. A time that happens twice means the earlier one.
10. **Exceptions:** a repeating meeting with exceptions refuses a start or length PATCH until Part 2 sends the exceptions again (critic H).
11. **Cancelled meetings:** the calendar file of a cancelled meeting gives 404.
12. **Reminder expiry:** a reminder is never sent after its occurrence starts. That covers Retry, and a reminder left waiting while no instance ran workers (critic F).
13. **Correct files:**
    - STATUS:TENTATIVE while a request is tentative (the spec writes CONFIRMED);
    - DTEND from the instant;
    - the RDATE for a monthly series that starts after day 28;
    - control characters stripped;
    - a product-neutral PRODID.
14. **Audit:**
    - before and after hold no emails, notes or titles;
    - an email guest is "Email guest";
    - on a private meeting, `targetLabel` is "Private meeting" and people are named only by kind.

### Deferred, not invented
- **Saving new guests as contacts or leads** (rule 11): `newGuestHandling` is ignored on the API, and guests stay guests.
- **Settings → Meetings on the API:** the server reads the stored group. When it is missing, it uses `DEFAULT_MEETING_SETTINGS`: 15 minutes, `none`, proposals off, guest list hidden.
- **Not built:**
  - replies from external guests (no inbound mail or signed link);
  - the iMIP part and mail headers, which would change providers;
  - reminders for later occurrences (Part 4);
  - the indexes and the unique guest key (a later migration).

### Kept as the spec says (not safety)
- Moves don't reset answers (Part 2), and the spec's sends table stands.
- Reminders go to staff guests only (A5). The organiser is left out every time, which is what the demo does at creation; the actor is passed as null, so a re-sync by someone else never drops a guest.
- `meeting.when` has no zone, and RSVP stays TRUE.
- The organiser gets no notice when someone else changes the meeting.
- A cancelled request sends CANCEL to a guest who never had a file.
- `GET /meetings` has no date window.

### For the owner and later parts
- **Before real email** (ADR 0021:81): import one REQUEST and one PUBLISH by hand into Google and Outlook before `EMAIL_PROVIDER=resend` sends meeting invites.
- **Part 3 must:**
  - take the viewer id from `GET /auth/context`, not the fixture id;
  - stop sending the organiser as a guest from the New meeting dialog;
  - gate drag, Reschedule, Edit, Cancel and Remove on `canChangeMeeting`;
  - hide Request when `colleagues` is empty;
  - move the demo onto the shared rules;
  - add the e2e-api spec.
