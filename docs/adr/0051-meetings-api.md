# ADR 0051: Meetings on the API, part 1 (calendar, guests, invites, answers, requests, calendar files and reminders)

- **Status:** proposed, 2026-11-15. This was written during a workflow run while the owner was asleep. The run relayed a rule: follow meetings.md as the approved behaviour, deviate only in the safer direction and record each deviation in docs/blueprint-delta.md, and defer what can't be done safely. docs/STATUS.md has the queue paused until the owner says so, so PR #33 stays a draft. This ADR becomes accepted when the owner confirms it.
- **Context:**
  - docs/real-build-plan.md row 14, "Meetings, invites and .ics": spec meetings.md, depends on module 5 (the notifications core), week 18 in the schedule.
  - meetings.md describes the demo: a calendar in both products, guests from one search or by email, an Outbox row and `.ics` per guest (ADR 0021), answers and proposals, requests, reminders and Settings → Meetings.
  - Its "Edge cases and known limits" list what a real API must settle:
    - the edit actions check the permission only (line 53);
    - a hidden guest list shows to any edit holder;
    - a zone without a block gets New York's;
    - a monthly series after day 28 gets a BYDAY the app does not use;
    - reminders are never moved or cancelled;
    - answers and guest removal on a cancelled meeting are not refused.
  - The tables exist: `meetings`, `meeting_attendees` and `meeting_responses`, company migration 0000.
  - The notifications core (ADR 0032) sends Outbox rows through the EmailProvider on pg-boss.
  - The module is split into parts. This is part 1: the web does not change, the demo keeps working, and the screens move to the API in part 3.

## Decision

### Routes, keys, switches and scope
- **Module and switches:**
  - every route is in module `meetings`, in both products (403 `module_not_enabled` without it);
  - every route needs the switch `meetings.calendar` (404 when off);
  - guests, answers and the guest picker also need `meetings.invites`;
  - requests need `meetings.requests` and `meetings.invites`, so a request can always be answered;
  - My meetings needs `hr.portal`.
- **Routes** (docs/api-contract.md, "Meetings (real build, ADR 0051)"):
  - `GET /meetings`, `GET /meeting-guests`, `GET /me/meetings` and `GET /meetings/:id/calendar.ics`;
  - `POST /meetings`, `PATCH /meetings/:id`, `POST /meetings/:id/cancel` and `DELETE /meetings/:id/attendees/:attendeeId`;
  - `POST /meetings/:id/response` and `POST /meeting-requests`.
- **Not in part 1:**
  - `rescheduleMeeting`, `undoReschedule` and `decideProposal` come in part 2;
  - `simulateReply` stays a demo presenter tool, and there is no delete route (`meetings.meeting.delete` stays unused, as in the demo).
- **Every route:**
  - takes the company only from the verified session, through `TenantConnectionService`;
  - checks `:id` and `:attendeeId` as UUIDs.
- **Every write:**
  - on an existing meeting, locks its row first (`lockMeeting`, `select … for update`), so two changes at once apply one after the other;
  - applies the shared rules, works out what it will send from the state it commits (`MeetingSends.plan`: the guests, who is still an active member and the organiser the files name), checks the daily email limits and writes its audit entry, all in the same transaction. A failed lookup there undoes the whole change;
  - writes the invites and notices and re-syncs the reminder after the commit. Neither can fail the request, the re-sync runs whatever happened to the invites, and the reply is the meeting as the transaction committed it, so nothing read after the commit can turn a saved change into a 500 (review of PR #33);
  - never takes a second connection from the company's three-connection pool while its transaction holds one. `POST /meeting-requests` checks the asked colleague's access before its transaction opens, because that access is read through the pool (review of PR #33: a few requests at once could otherwise hold every connection and hang the company).
- **Bodies:** strict Zod schemas. They are wider than the shared limits, so a long title is refused in the rule's own words. A rule's refusal is 400 `invalid_request` with that rule's message.

### Who sees and who changes a meeting (`packages/shared/src/meetings/access.ts`)
- **`seesMeeting`** follows meetings.md "Who sees which meeting". It needs `meetings.meeting.view`. Then:
  - the organiser and the staff guests always see the meeting;
  - nobody else sees a private one, the Owner included (spec line 51);
  - own scope sees only meetings it is on, and branch or all scope sees every other one. Meetings have no branch, so branch scope does not narrow it (the spec's table).
  - The guest kind is checked, so a customer whose id equals a user id never counts as that user. A removed guest is no longer on the meeting.
- **`canChangeMeeting`** (edit details, cancel, remove a guest) needs `meetings.meeting.edit`, sight of the meeting and sight of every customer, supplier and contact on it (`seesEveryLinkedGuest`, the rules under "Reading a linked guest"). Then the person must be its organiser, or hold a scope wider than own on a meeting that is not private.
  - Someone who sees the meeting but may not change it gets 403: "Only someone who can see every guest on this meeting can change it." when guest sight is all that is missing, "Only the organiser can change this meeting." otherwise. Someone who can't see it gets 404.
  - This is stricter than meetings.md line 53, where anyone with edit who sees a meeting can change it. The rule stops an own-scope Sales guest from changing a colleague's meeting. A private meeting is changed only by the person who set it up.
  - **Guest sight binds the organiser too** (review of PR #33). A change emails every guest with the changer as the Outbox actor, and `GET /outbox` shows its actor each row whole: the guest's name, address and `.ics`. Without the rule an HR manager (all scope, `meetings.*`, no customers) or a Manager whose branch doesn't cover a customer could edit a meeting's notes and then read that customer in the Outbox. Several of Summit's seeded meetings have an organiser who can't read their customer (the fixtures ignore scope), so on the API they are changed by someone who reads every guest, such as the Owner.
- **`meetingForViewer`** shapes every `Meeting` the API returns:
  - The organiser, and anyone who may change the meeting, get every guest with their address.
  - Anyone else gets no address but their own. An email guest whose name is an address reads "Email guest". With a hidden guest list they get only their own row. The spec shows a hidden list to any edit holder.
  - Other guests' reply notes and proposals go to the organiser only, who decides proposals.
  - A guest linked to a customer, supplier or contact the reader can't read is shown to every reader, the organiser included, as "Customer", "Supplier", "Customer contact" or "Supplier contact", with no address.
- **Reading a linked guest** (`partySight`):
  - a customer, or a contact at one, needs the `core` module, `customers.customer.view`, the switch `sales.customers` and `seesCustomer` on that customer;
  - a supplier, or a contact at one, needs the `core` module, `purchasing.supplier.view` and the switch `purchasing.suppliers`;
  - a deleted record is never read.
- **Lists:** `GET /meetings` leaves cancelled meetings out, because they leave the calendar. It has no date window, as in the spec.

### Times and time zones (`packages/shared/src/calendar/zones.ts`)
- **The zone** comes from the company's `tenants.time_zone` in the control database (`companyClock`), never from a request. On the API this is the authoritative source; the demo reads `localization.region.timeZone`.
  - Meetings are booked only in the seven zones the calendar file has a VTIMEZONE block for: `America/New_York`, `America/Chicago`, `America/Denver`, `America/Phoenix`, `America/Los_Angeles`, `America/Anchorage` and `Pacific/Honolulu`.
  - The name is canonicalised through Intl first. A zone that only shares offsets with one of the seven, such as `America/Detroit` or `America/Puerto_Rico`, is refused rather than given another zone's rules.
  - Creating a meeting or a request in any other zone answers 409 `time_zone_unsupported`. There is no tz library.
- **Storage:**
  - `meetings.start`, `meeting_attendees.responded_at` and `meeting_responses.proposed_start` are stored as instants (timestamptz) and converted through `meetings.time_zone`;
  - the wire and the shared rules keep the spec's local `YYYY-MM-DDTHH:mm`;
  - `exceptions` and a proposal's `start` stay local, inside jsonb.
- **Conversions:**
  - **Strict, for what a person types:** a time in the spring-forward gap is refused, and a time the clock shows twice means the earlier instant (RFC 5545 section 3.3.5). Years outside 1900 to 2999 are malformed.
  - **Lenient, for occurrences a rule derives:** a time in the gap uses the offset from before the gap, as calendars do.
  - An edit that does not change the start keeps the stored instant.

### Owned by the server (critic B4)
- **The organiser** is the signed-in person. They are added first, as accepted, and an entry for them in `guests` is dropped.
- **Linked guests:** only `kind` and `id` are read. Names and addresses come from the company's own records. Every guest starts `required`, "No reply yet", with no reply time, note or proposal, whatever the client sent.
  - Staff must be active members of the company.
  - Customers, suppliers and their contacts must be ones the person may read (the rules under "Reading a linked guest"), and 404 otherwise.
  - In an HR Suite company, which has no `core` module, a customer guest is 404.
- **Email guests:** the address must pass `validGuestEmail` and each address counts once, compared trimmed and in lower case. An address that belongs to an active member becomes that colleague. Any other address is an email guest (`party_type` `external`, `party_id` null), named as typed or by the address, and is never saved as a contact or lead.
- **Flags:**
  - `hideGuestList` is on when asked, when the meeting is private, and when any guest is not staff;
  - `allowProposals` is the Settings → Meetings value AND whether the organiser holds `meetings.meeting.edit`, so nobody is offered a proposal that no one could decide. The client's value is ignored.
- **A request** lasts 30 minutes, at "To be agreed", with the reminder from Settings → Meetings, as tentative, of kind `request`. Its list is hidden when it is private, and it takes proposals only when the person asking holds edit (the spec says always).
  - `withUserId` must be an active member holding `meetings.meeting.view`, and never the person asking (400 "Choose who to meet with.").

### Settings → Meetings
- The server reads the stored `settings` group `meetings` and checks each value. When a value is missing it uses `DEFAULT_MEETING_SETTINGS`: a 15-minute reminder, guests not saved, proposals off and the guest list hidden.
- `newGuestHandling` is always `none` on the API.
- No route saves the group yet (deferred), and the screen still saves to DemoStore. Summit's seeded group (proposals on, list shown) is used as stored.

### Changes (`meetings/changes.ts`, `meetings/replies.ts`)
- **Edit** (`PATCH`):
  - the strict body holds `title`, `notes`, `location`, `start`, `durationMin` and `reminderMin`. Title and place are trimmed and compared as stored. A change of nothing writes nothing;
  - a change of start, length or place is significant (rule 6). It raises SEQUENCE, sets `rescheduleSequence` to it and resets every answer and proposal, the organiser's included, as the spec says. A title, notes or reminder change keeps them;
  - a cancelled meeting is refused;
  - a new start is checked against the zone, and against the monthly start limit (rule 3), only when it changes, so the seeded "Monthly safety talk" that starts on the 30th can still be retitled;
  - a repeating meeting with occurrences moved on their own refuses a new start or length (below, "Exceptions").
- **Cancel:** works only once (400 after that). SEQUENCE + 1 and `rescheduleSequence` set to it; answers are left as they were.
- **Remove a guest:** never the organiser and never on a cancelled meeting. A guest not on this meeting answers 404. The row is soft-deleted, SEQUENCE + 1, and `rescheduleSequence` and the other answers are kept.
- **Answer:**
  - only a live staff guest who is not the organiser, on a meeting they see that is not cancelled (400 "Only a guest on this meeting can answer it.");
  - the answer is `accepted`, `tentative` or `declined` ("No reply yet" is refused), with a note of up to 500 characters;
  - a proposal is stored as a pending Maybe. It needs `allowProposals`, a one-off meeting, a time the clock shows and 15 to 1440 minutes;
  - every answer is logged in `meeting_responses` (method `reply` or `counter`, with the SEQUENCE it was made against). A staff answer passes the current SEQUENCE, so it is never stale (rule 7);
  - on a tentative request, Accept confirms it and Decline cancels it, each with SEQUENCE + 1.
- **Exceptions:** an edit moves a series' start or length but not its exceptions. The exceptions would stay keyed to the old planned times, and guests' calendars would keep the overrides under their old RECURRENCE-IDs (ADR 0021; critic H). Until part 2 moves the exceptions with the series and sends them again, a series with exceptions refuses a start or length change; a title, place or notes edit still works.

### Invites and calendar files (`meetings/sends.ts`, `calendar/ics.ts`)
- **`sendPlan`** covers the part 1 rows of meetings.md "What each action sends": schedule, edit (significant or not), cancel and remove a guest.
  - The organiser never gets a row, and with `meetings.invites` off nothing is sent.
  - With a hidden list, or with any guest who is not staff whatever the stored flag (Summit's seeded meetings keep the demo's open lists), each file names only its recipient. A guest without a valid address gets no ATTENDEE line.
  - No REQUEST is sent for a meeting that is already cancelled, so a schedule or edit raced by a cancel or a declined request can't put it back in a calendar at the cancel's SEQUENCE (review of PR #33). The invites come from the state the action's own transaction committed, never from a read after it.
  - A REQUEST says STATUS:TENTATIVE while a request waits; the spec writes CONFIRMED.
- **One `notify` per guest**, after the commit, each in its own try/catch, so a failed send never undoes the change, stops the other guests' invites or fails the request.
  - The row carries `{ kind: "ics", fileName, text }`, stored inline in `outbox_messages.attachments`. ADR 0032 left attachments for the StorageProvider, but an `.ics` is a few kilobytes of text, and the row is restricted when the meeting is private.
  - `restricted` is the meeting's `private`. Staff also get an in-app note. `meeting.sequence` stays in the values, for rule 7.
  - A failure is logged without names or addresses.
- **Stamps and versions:**
  - every meeting write sets `updated_at` from the database clock (`databaseNow`, to the millisecond), and the invite's DTSTAMP is that committed value, so stamps follow commit order (RFC 5546 section 2.1.5);
  - the dedupe key's version for an invite is `${sequence}-${method}-${recurrenceId ?? ""}-${updatedAt in ms}`. Two sends of one SEQUENCE in one minute are two rows, and a retry of the same send is one. This replaces rule 17's minute precision;
  - `meeting.reply` and `meeting.proposed` use the `meeting_responses` row id, so every answer from every guest is its own message (critic B2);
  - `meeting.requested` uses `request`;
  - a reminder uses `${sequence}-reminder-${planned}-${uuidv7}` (below).
- **Colleagues who left:** a staff guest who is no longer an active member gets no invite, reminder or answer notice, because these carry the company's titles, places and notes.
- **File hardening** (the writer is shared, so the demo's files changed too):
  - every text value is escaped and stripped of control characters, a lone CR and the Unicode line separators included, so no typed text can start a property of its own;
  - a CN loses control characters, has `"` turned into `'` and is cut at 100 characters;
  - ATTENDEE and ORGANIZER lines are written only for a valid address;
  - DTEND is the start instant plus the length, not wall-clock arithmetic. In the rare case that its local time is one the clock shows twice and the end is the later one, DTEND is written in UTC (ADR 0021 rules out DURATION);
  - a monthly BYDAY caps the week at 4, as the app does (`monthlyWeekOf`). A monthly series that starts after day 28 starts its RRULE at its second occurrence and lists the first as an RDATE (RFC 5545 section 3.8.5.3). One that ends before its second occurrence is a single event;
  - a zone without a VTIMEZONE block throws instead of borrowing New York's;
  - PRODID is `-//Platform//Meetings//EN` on the API, because the HR Suite sends invites too. The demo keeps `-//Flooring Suite//Demo//EN`.
- **"Add to my calendar"** (`GET /meetings/:id/calendar.ics`) returns JSON `{ fileName, text }` at the contract's path: METHOD:PUBLISH, ORGANIZER and no ATTENDEE, no STATUS, the current UID and SEQUENCE. A cancelled meeting has no file (404).

### The calendar file in the email (notifications core)
- `emailAttachments` turns each `.ics` into UTF-8 bytes (`Uint8Array`), because the Resend adapter reads a string as base64 and would corrupt plain text.
  - The content type is `text/calendar; method=<METHOD>; charset=UTF-8` when the METHOD is one RFC 5546 defines, as RFC 6047 section 2.4 asks.
  - The file name is cleaned to one line of at most 120 characters, without quotes, slashes or control characters.
  - A PDF kept only as a link has no bytes and is left out; the email's text carries the link.
- `packages/providers` is unchanged. There is no iMIP alternative part or header (deferred), so whether Gmail and Outlook offer the email as an invite is unverified (owner gate below).

### Reminders (no reminders table)
- **A reminder is a `scheduled` Outbox row** held until its time and sent by a pg-boss job (ADR 0032, notifications.md rule 13). The blueprint's `reminders` table is not built.
- **`MeetingReminders.sync`** runs after every change that can move, add, drop or end a reminder: create, edit, cancel, remove a guest, and an answer that confirms or cancels a request (critic B6).
  - First it cancels the waiting reminder rows with their own statement. Then, in a transaction that holds the meeting's row lock, it cancels them again and raises the next reminder from the meeting as it now stands, so two re-syncs at once leave one set of rows.
  - Each set has a fresh version, so a re-sync is never swallowed by the dedupe key of a set it cancelled (critic B1).
  - If anything fails, the meeting has no reminder rather than a wrong one, and a warning is logged without names.
- **The next reminder** is `reminderMin` before the first occurrence whose reminder time is still ahead, counted in real minutes from that occurrence's instant. None is raised for a cancelled meeting, a request still waiting, or while `meetings.invites` is off.
- **Recipients** (rule 10): the staff guests who are still active members, by email only, never the organiser. No actor is passed, so a re-sync by someone else drops nobody.
- **Expiry:**
  - `NotifyInput.expiresAt` is the occurrence's start, kept in the row's values as `outbox.expiresAt`. Readers never get values (ADR 0032), so no column is added;
  - the send job's claim cancels a row past its expiry by the database clock, and an expiry that is not a time counts as past;
  - Retry goes through the same claim. So a reminder left waiting while no instance ran workers, or retried late, is never sent after the meeting began (critic F).
- **Only the next occurrence** gets a reminder. Later occurrences of a series get theirs when a change re-syncs it; a sweeper for them is part 4. The seeded meetings have no reminder until something changes them.
- **A worker is needed:** at least one instance with `JOBS_ENABLED=true` (docs/environment.md).

### Core changes (shared with other modules)
- **`NotificationService.notify(tenant, actor, input, within?)`:** an optional transaction of the same company. Reminder rows are written under the meeting's lock without taking a second connection from the three-connection company pool, which could hang. A job queued before that commit finds its row once it is visible, or retries.
- **`cancelScheduled(tenant, event, source, within?)`** cancels one source's scheduled rows of one event. A row already sending or sent is left alone.
- **`NotifyInput.expiresAt`** and the expiring claim (above). **`sendJob`** passes the attachments on.
- **`visibleOutboxRow`** redacts a restricted row whose source is a meeting (a private meeting's invite, reminder or notice) for every reader not involved, holders of `hr.employee.view` and the Owner included (critic A4). Recipient, status and dates stay visible, as on any redacted row. Other modules' restricted rows keep the ADR 0032 rule.

### Limits (shared `MEETING_LIMITS`; meetings.md sets none)
- **Text:**
  - title 1 to 200 characters and place up to 200, each on one line with no control characters, because they reach email subjects;
  - notes up to 4000, with line breaks and tabs as the only control characters;
  - a guest's name up to 100 characters on one line;
  - a reply or proposal note up to 500.
- **Times:**
  - a length of 15 to 1440 whole minutes on create, edit and proposals (the spec checks 15 only on a move, rule 5);
  - a reminder of 10, 15, 30 or 60 minutes.
- **Addresses:** the spec's `x@y.z` shape (rule 12), at most 254 characters, and no spaces, control characters or `"(),:;<>[\]`. An unusual but valid quoted address is refused rather than risk a broken invite.
- **Volume:**
  - at most 50 guests besides the organiser, and at most 20 email guests, per meeting;
  - at most 50 different outside addresses per person per company day, across all their meetings. The count comes from the email guests the person added since the start of the company's day, removed ones included, under the person's advisory transaction lock, so two meetings saved at once count each other. An address counts once a day;
  - **every send counts** (review of PR #33): at most 200 emails to people outside the company (customers, suppliers, their people and email guests) and 500 meeting emails in all, per person per company day, repeats included. So scheduling the same 20 guests over and over, or flipping a title back and forth, can't mail them at volume. Each action's audit entry holds `after.sends` `{ outside, total }`, the emails it sends, written in its own transaction under the person's lock; the next action of that person waits for the lock and sums the day's entries. The count is exact for actions sent at once, and the audit log refuses updates and deletes, so nobody can lower it. An action over a limit (schedule, edit, cancel, guest removal, answer or request) is refused with 400 and writes nothing; one that sends nothing is never refused. Reminders have no actor and don't count;
  - the company's day starts at midnight in `tenants.time_zone`; should that not be readable, the last 24 hours count.

### Audit
- The actions are:
  - `Scheduled meeting`: after holds the start and the guest count;
  - `Edited meeting`: before and after hold the start and the names of the changed fields;
  - `Cancelled meeting`: the status;
  - `Removed meeting guest`: before holds the guest, after only the sends;
  - `Answered meeting`: the old and new answer;
  - `Requested meeting`: after holds who was asked.
- Each entry's after also holds `sends`, `{ outside, total }`: the emails the action sends, as the daily limits count them.
- All are category `data` and target type `meeting`, written in the write's own transaction (CLAUDE.md rule 10).
- The target label is the title, or "Private meeting".
- Before and after hold no emails, notes or titles. An email guest is "Email guest". On a private meeting people are named only by kind ("Colleague", "Customer" and so on), so audit readers don't learn who is in a private HR meeting.

### My meetings and the guest picker
- **`GET /me/meetings`** returns `MyMeetings`: `{ viewerUserId, meetings: [{ meeting, next }], colleagues }`.
  - `meetings` holds the meetings the person organises or is a staff guest on, not cancelled. Each comes with its next occurrence on or after today in the meeting's zone, up to 366 days ahead, soonest first, shaped by `meetingForViewer`. A series shows its next date, not its first.
  - `colleagues` holds active members who hold `meetings.meeting.view`, never the person, as `{ id, name }`. It is filled only when the person holds `meetings.meeting.create` and `meetings.requests` and `meetings.invites` are on.
  - `viewerUserId` lets the screens compare the ids the server uses (part 3).
  - It needs `hr.portal.view` (meetings.md "Open My meetings"), not `meetings.meeting.view`, because it shows only meetings the person is on.
- **`GET /meeting-guests`** returns `GuestOption[]`:
  - active colleagues by name, with no address (the server fills it in) and without the person;
  - the customers in the person's data scope and their contacts, with addresses, when they may read customers;
  - suppliers and their contacts, with addresses, when they may read suppliers.

### Seed
- `seedMeetings` (`packages/db/src/seed/meetings.ts`) runs last in `seedCompany`. It writes Summit's twelve fixture meetings with their guests:
  - ids come from `seedId`;
  - owners, `created_by` and staff party ids use `userOf`, the control user ids every session carries (critic A3);
  - customers, suppliers and contacts use their own seed ids, and email guests have a null party id;
  - starts are stored with the strict conversion, and the seed stops on a time the zone can't show.
- No responses, Outbox rows or reminders are seeded. The monthly safety talk that starts on the 30th is kept as the fixture has it.

## Safest options taken (also in docs/blueprint-delta.md)
1. **Who may change a meeting:** the organiser, or someone with a scope wider than own on a meeting that is not private, and in both cases only someone who can read every customer, supplier and contact on it (`canChangeMeeting`). The spec lets any edit holder who sees it, and the organiser always.
2. **Private meetings** are hidden from everyone not on them, the Owner included, also in `GET /outbox`: subject, body and `.ics` are redacted whatever the reader holds.
3. **What a reader sees:** addresses, a hidden guest list, other guests' notes and proposals, and customers or suppliers the reader can't read are blanked, as under "Who sees and who changes a meeting".
4. **Hidden guest list** for any guest who is not staff. The spec forces it only for email guests.
5. **Volume limits:** 50 guests and 20 email guests per meeting, 50 outside addresses per person per company day, and 200 outside emails and 500 meeting emails per person per company day with every send counted.
6. **Input limits:** text lengths, one-line fields, 15 to 1440 minutes, the four reminder choices, the stricter address check, the year range, and "No reply yet" refused as an answer.
7. **Switch dependencies:** with `meetings.invites` off, guests are refused (400), the guest routes are 404 and nothing is sent, reminders included. Requests need `meetings.invites`.
8. **Owned by the server:** the organiser, the zone (409 outside the seven), `allowProposals` (the setting and the organiser's edit key, for requests too), a request's length and place, and every guest field.
9. **DST:** a start the clocks skip is refused on create, edit, request and proposal. A time shown twice means the earlier one.
10. **Exceptions:** a series with exceptions refuses a start or length edit until part 2.
11. **Cancelled meetings:** cancel works once. An answer, a guest removal or an edit on a cancelled meeting is refused. Its calendar file is 404.
12. **Reminder expiry:** a reminder is never sent after its occurrence starts, by the worker or by Retry.
13. **Correct files:**
    - TENTATIVE while a request waits;
    - DTEND from the instant, in UTC when its local time is ambiguous;
    - the fourth-week cap and RDATE for a monthly series after day 28;
    - control characters stripped, and CN cleaned and capped;
    - ATTENDEE and ORGANIZER only for valid addresses;
    - no borrowed time zone block;
    - a product-neutral PRODID;
    - one-line attachment names.
14. **Audit:** no emails, notes or titles. An email guest is "Email guest", and a private meeting is "Private meeting" with its people named by kind.
15. **Colleagues who left** get no invites, reminders or answer notices.
16. **Answers** come only from a staff guest who is not the organiser (400 otherwise). Every answer is its own notice.
17. **Guest picker:** colleagues have no address and the person is left out. Customers follow the person's data scope.
18. **Settings defaults** when none are stored: proposals off and the guest list hidden. New guests are never saved.
19. **Files list only their recipient** whenever any guest is not staff, even on a seeded meeting stored with an open list, and no REQUEST goes out for a cancelled meeting.

## Kept as meetings.md says (not safety)
- A move does not reset answers. Part 2 follows the sends table, which stands as written.
- Reminders go to staff guests only (rule 10).
- `meeting.when` has no zone, and RSVP stays TRUE.
- The organiser gets no notice when someone else changes or cancels their meeting.
- A cancelled request sends a CANCEL to its guest, who never had a file.
- A significant edit resets the organiser's answer too.
- `GET /meetings` has no date window, and branch scope sees every meeting that is not private.

## Deferred, not invented
- **Saving new guests as contacts or leads** (rule 11): guests stay guests, and `newGuestHandling` is ignored. A customer record would come into Sales without its own keys and audit, and rule 11's lead defaults would need the owner.
- **Settings → Meetings on the API.** The server reads the stored group, with the safe defaults above.
- **Replies from people outside the company:** there is no inbound mail and no signed reply link, so email guests stay "No reply yet".
- **An iMIP alternative part or headers:** they would change `packages/providers`.
- **Reminders for later occurrences** and for the seeded series: a sweeper comes in part 4.
- **Indexes** on the guest's party and a unique guest per meeting: a migration later.
- **Adding a guest to an existing meeting** (meetings.md known gap U-50): not in the spec's calls.

## Later parts
- **Part 2** (`feat/meetings-api-moves`):
  - `POST /meetings/:id/reschedule`, with conflicts that show meetings the person can't see as "Busy";
  - `POST /meetings/:id/reschedule/undo`, rebuilt on the server from the last "Moved meeting" audit entry rather than trusting the client's copy (critic B3);
  - `POST /meetings/:id/attendees/:attendeeId/proposal` (`decideProposal`, DECLINECOUNTER);
  - surviving exceptions sent again, which lifts the exceptions refusal.
- **Part 3** (`feat/meetings-web-api`):
  - the meetings methods join `API_METHODS`;
  - the screens take the viewer id from the server (`GET /auth/context`, `viewerUserId`);
  - the New meeting dialog stops sending the organiser as a guest;
  - drag, Reschedule, Edit, Cancel and Remove are gated on `canChangeMeeting` (critic B5);
  - Request is hidden when `colleagues` is empty;
  - Settings → Meetings and "Save under customer" are hidden in api mode;
  - DemoStore moves onto the shared rules;
  - an e2e-api spec is added.
- **Part 4** (later, with the owner):
  - Settings → Meetings on the API;
  - contacts and leads;
  - the reminder sweeper;
  - a signed-link reply page;
  - iMIP;
  - the index migration.

## For the owner
- **The go-ahead:** the queue is paused per STATUS, and this run's go-ahead came through the workflow. PR #33 stays a draft until the owner confirms.
- **Before real email** (ADR 0021): import one REQUEST and one PUBLISH file by hand into Google Calendar and Outlook on the web before `EMAIL_PROVIDER=resend` sends meeting invites.
- **Questions:**
  - Are 20 email guests per meeting, 50 outside addresses, 200 outside emails and 500 meeting emails per person a day right, and should inviting outside addresses need a key or a setting?
  - Should an organiser who can no longer read a customer on their meeting still be able to cancel it? Part 1 refuses, because the cancel would show them that customer in the Outbox.
  - Should the Owner, as an Outbox admin, still see the recipient and status of a private meeting's rows?
  - Should RSVP be FALSE for guests outside the company until replies can be read?
  - Should `meeting.when` name the zone?

## Residual risks
- **Who is on a private meeting shows in the Outbox:** a holder of `settings.outbox.view` (the Owner by default) still sees the recipient, status and dates of a private meeting's rows; only subject, body and `.ics` are hidden. The recipients say who was invited.
- **Sends after the commit:** SEQUENCE can rise while one guest's row was not written (a failure is caught and logged). A row that was written and failed can be sent again with Retry, but a row never written has to wait for the next change. A transaction that holds every invite for 50 guests was ruled out: a pg-boss outage would hold the meeting's lock and a company connection for up to ten seconds per guest.
- **Reminders:**
  - a re-sync that fails leaves the meeting with no reminder (logged);
  - later occurrences and the seeded meetings have none until part 4 or a change;
  - with no instance running workers nothing is sent, and late reminders are dropped.
- **Outside guests can't answer**, and with RSVP=TRUE their calendar's reply goes to the organiser's mailbox, where nothing reads it.
- **A proposal can be sent but not decided** on the API until part 2. The screens don't use the API until part 3.
- **A linked guest with no address** gets a failed row on every send, and the actor gets a notice, as in the demo.
- **Branch scope sees every meeting that is not private**, from any branch, as in the spec. Narrowing it needs a branch on meetings and the owner.
- **The calendar file sits inline** in the Outbox row, readable by anyone who may read that row unredacted.
- **`meeting.when` has no zone**, so a guest in another zone can misread it.
- **The daily caps are per person.** A company with many members can still send many outside emails in a day, up to 200 per member. The caps count planned sends, so a send that later failed, or a colleague who left in between, still counts.
- **The limits refuse cancels too:** a person over the outside cap can't cancel or edit a meeting with outside guests until the next company day; someone else who may change it can.
- **Seeded meetings whose organiser can't read the customer** are changed on the API only by someone who reads every guest.
- **A company outside the seven zones** can't book meetings on the API at all (409).
- **Api mode before part 3:** Settings → Meetings, the bell, the Outbox and Simulate reply run on DemoStore, so they don't show what the API wrote.

## Consequences
- **No schema or dependency change:** no table, column, index or migration changes, and no dependency is added. RFC 5545 is written by hand in `packages/shared/src/calendar/ics.ts`, with `Intl` for the zones.
- **The demo's calendar files changed** with the shared writer, in the ways listed under "File hardening". The seeded invite fixture is unchanged, and its regeneration test passes.
- **Tests:**
  - unit tests in packages/shared: `zones`, `ics`, `meeting-access`, `-input`, `-changes`, `-sends` and `-reminders`;
  - `apps/api/test/notification-rules.test.ts` covers the attachments and the private-meeting redaction;
  - `apps/api/test/meetings.int.test.ts` has 25 cases: access and switches, tenancy, data scope, private meetings in `/outbox`, create, edit, cancel, remove, answers, requests, versions, reminders, expiry, caps, the HR Suite and the 409, and from the review of PR #33: six requests at once all answered, nobody changing a meeting with a customer they can't read (the organiser included) and `/outbox` not showing it, the 200 outside emails cap on schedule, edit and cancel, and a committed change answered and re-synced when its invites fail while a failed plan writes nothing;
  - `packages/db/test/seed.int.test.ts` has a meetings case.
  - There are no Playwright tests, because no screen changed.
- **Unchanged `settings.meetings` module:** the feature sits in module `platform` while its key `settings.meetings.manage` is in module `meetings` (`features.ts`, `catalog.ts`). It is unchanged here.
