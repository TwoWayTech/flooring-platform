# ADR 0051: Meetings on the API, parts 1 and 2 (calendar, guests, invites, answers, requests, calendar files and reminders; moves, undo, proposal decisions and conflicts)

- **Status:** accepted, 2026-11-15. The owner restarted the queue on 2026-11-15, putting meetings first, and was asleep during the build. The rule for that run: follow meetings.md as the approved behaviour, deviate only in the safer direction and record each deviation in docs/blueprint-delta.md, and defer what can't be done safely. The safer deviations and the questions under "For the owner" are open for the owner's review.
- **Part 2** (moves, undo, proposal decisions and conflicts) was added on 2026-11-15 under the same rule, on branch `feat/meetings-api-moves` (PR #35). It is the section "Part 2 (2026-11-15)" below. Where it changes a part 1 decision, the part 1 text says so.
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
  - `rescheduleMeeting`, `undoReschedule` and `decideProposal` come in part 2 (now on the API: "Part 2" below);
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
  - Anyone else gets no address but their own, in the calendar file's ORGANIZER line too. An email guest whose name is an address reads "Email guest". With a hidden guest list they get only their own row. The spec shows a hidden list to any edit holder.
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
  - **Strict, for what a person types:** a time in the spring-forward gap is refused, and a time the clock shows twice means the earlier instant (RFC 5545 section 3.3.5). Years outside 1900 to 2999 are malformed. Since review round 1 of PR #35 a start a person types must also lie from a year before the company's today to three years after it (Part 2, "Start bound").
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
- **A request** lasts 30 minutes, at "To be agreed", with the reminder from Settings → Meetings, as tentative, of kind `request`. Its list is hidden when it is private. It takes proposals as any meeting does: only when Settings → Meetings allows them and the person asking holds edit (the spec says always).
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
  - **Lifted in part 2:** the exceptions now shift with a new start and are sent again, and a new start that would take one off the series is refused ("Part 2", "Series exceptions sent again").

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
- **"Add to my calendar"** (`GET /meetings/:id/calendar.ics`) returns JSON `{ fileName, text }` at the contract's path: METHOD:PUBLISH, no ATTENDEE, no STATUS, the current UID and SEQUENCE. A cancelled meeting has no file (404).
  - ORGANIZER, with the organiser's address, is written only for a reader who may read guests' addresses (`seesGuestAddresses`: the organiser and anyone who may change the meeting). Anyone else's file has no ORGANIZER line, as for an organiser with no valid address, so the file never gives a reader an address the meeting hides from them (review round 3). RFC 5546 lists ORGANIZER for a PUBLISH, so the owner gate tries a file without one too.

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
  - The rows' send jobs are queued only after that transaction commits (final review of PR #33). JobsService waits up to 10 seconds for pg-boss to start, so queueing under the lock would hold the meeting's lock and a company connection through a jobs outage, and three such writes would stall the company's three-connection pool.
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
- **`NotificationService.notify(tenant, actor, input, options?)`:**
  - `options.within` is a transaction of the same company. Reminder rows are written under the meeting's lock without taking a second connection from the three-connection company pool, which could hang. No job is queued inside it: the rows come back in `NotifyResult.unqueued` (final review of PR #33).
  - `options.deferJobs` leaves the jobs to the caller in the same way without a transaction. The invite loop uses it.
  - With no options, `notify` queues each row at once and throws when queueing fails, as before. Every other caller is unchanged.
- **`queueSends(tenant, unqueued)`** queues those jobs after the commit, in order. It stops at the first failure, so a jobs outage costs one wait (up to 10 seconds), not one per row. It never throws, and returns whether every job was queued. A row it did not queue stays `queued` or `scheduled` with no job, as a failed queueing always left it (Retry, or the sweeper in STATUS).
- **`cancelScheduled(tenant, event, source, within?)`** cancels one source's scheduled rows of one event. A row already sending or sent is left alone.
- **`NotifyInput.expiresAt`** and the expiring claim (above). **`sendJob`** passes the attachments on.
- **`AccessService.membersAccess`** reads everyone's roles in three company queries, whatever the number of people, instead of three per person. `resolve` uses the same reader for one person. The engine (`resolveAccess`) and the result are unchanged (final review of PR #33).
- **`roleHolders(db, key)`** (`hr/hr-common.ts`, moved out of `holdersOf`) gives the active members whose roles tick a key. They are candidates only: whether the key is effective is still for `membersAccess` to say.
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
    - Every Employee holds `meetings.meeting.create`, so this runs on most loads of My meetings (final review of PR #33). The members whose roles tick `meetings.meeting.view` are chosen in SQL first (`roleHolders`). The shared engine then decides for those only, reading all their roles at once (`membersAccess`).
    - So one load costs a fixed number of company queries, not about three per member queued on the three-connection pool. Who is listed is unchanged: a member none of whose roles ticks the key can never hold it.
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

## Safest options taken in part 1 (also in docs/blueprint-delta.md)
1. **Who may change a meeting:** the organiser, or someone with a scope wider than own on a meeting that is not private, and in both cases only someone who can read every customer, supplier and contact on it (`canChangeMeeting`). The spec lets any edit holder who sees it, and the organiser always.
2. **Private meetings** are hidden from everyone not on them, the Owner included, also in `GET /outbox`: subject, body and `.ics` are redacted whatever the reader holds.
3. **What a reader sees:** addresses, a hidden guest list, other guests' notes and proposals, and customers or suppliers the reader can't read are blanked, as under "Who sees and who changes a meeting". The calendar file names the organiser's address only to those who may read guests' addresses.
4. **Hidden guest list** for any guest who is not staff. The spec forces it only for email guests.
5. **Volume limits:** 50 guests and 20 email guests per meeting, 50 outside addresses per person per company day, and 200 outside emails and 500 meeting emails per person per company day with every send counted.
6. **Input limits:** text lengths, one-line fields, 15 to 1440 minutes, the four reminder choices, the stricter address check, the year range, and "No reply yet" refused as an answer.
7. **Switch dependencies:** with `meetings.invites` off, guests are refused (400), the guest routes are 404 and nothing is sent, reminders included. Requests need `meetings.invites`.
8. **Owned by the server:** the organiser, the zone (409 outside the seven), `allowProposals` (the setting and the organiser's edit key, for requests too), a request's length and place, and every guest field.
9. **DST:** a start the clocks skip is refused on create, edit, request and proposal. A time shown twice means the earlier one.
10. **Exceptions:** a series with exceptions refuses a start or length edit until part 2. Part 2 lifts this (its safest option 5).
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

## Kept as meetings.md says (not safety), part 1
- A move does not reset answers. Part 2 follows the sends table, which stands as written.
- Reminders go to staff guests only (rule 10).
- `meeting.when` has no zone, and RSVP stays TRUE.
- The organiser gets no notice when someone else changes or cancels their meeting.
- A cancelled request sends a CANCEL to its guest, who never had a file.
- A significant edit resets the organiser's answer too.
- `GET /meetings` has no date window, and branch scope sees every meeting that is not private.

## Deferred, not invented (part 1)
- **Saving new guests as contacts or leads** (rule 11): guests stay guests, and `newGuestHandling` is ignored. A customer record would come into Sales without its own keys and audit, and rule 11's lead defaults would need the owner.
- **Settings → Meetings on the API.** The server reads the stored group, with the safe defaults above.
- **Replies from people outside the company:** there is no inbound mail and no signed reply link, so email guests stay "No reply yet".
- **An iMIP alternative part or headers:** they would change `packages/providers`.
- **Reminders for later occurrences** and for the seeded series: a sweeper comes in part 4.
- **Indexes** on the guest's party and a unique guest per meeting: a migration later.
- **Adding a guest to an existing meeting** (meetings.md known gap U-50): not in the spec's calls.

## Part 2 (2026-11-15): moves, undo, proposal decisions and conflicts

- **Context:**
  - meetings.md "Move or resize", "Propose a new time", rules 4, 5 and 13, the sends table and "Differences from ADR 0021";
  - the critic of the earlier plan: B3 (undo rebuilt from the server's own record), D (the undo's removal audited), H (what a split copies) and M (the body's meeting id);
  - the plan and log: docs/sessions/2026-11-15-0600-b-meetings-api-moves.md.
- The web does not change (part 3). Part 2 reuses part 1's rules (`canChangeMeeting`, `meetingForViewer`, `sendPlan`, the reminder re-sync with deferred queueing, the daily caps and `partySight`) and does not copy them.

### Routes and checks
- **Routes** (docs/api-contract.md, "Meetings (real build, ADR 0051)"):
  - `POST /meetings/:id/reschedule` (`rescheduleMeeting`);
  - `POST /meetings/:id/reschedule/undo` (`undoReschedule`);
  - `POST /meetings/:id/attendees/:attendeeId/proposal` (`decideProposal`);
  - and a changed `PATCH /meetings/:id`.
- **Keys and switches:**
  - each route needs `meetings.meeting.edit` and the switch `meetings.calendar` (404 when off), in module `meetings` (403 `module_not_enabled` without it);
  - deciding a proposal also needs `meetings.invites` (404 when off);
  - a move and an undo work with `meetings.invites` off and send nothing.
- **Scope:** every route takes the meeting through `lockChangeable`: 404 when the caller can't see it, 403 when they see it but may not change it (`canChangeMeeting`, part 1). The company comes only from the session, and `:id` and `:attendeeId` are UUIDs.
- **Bodies** are strict:
  - a move takes `{ meetingId?, planned, start, durationMin, scope }`. A `meetingId` that is not `:id` is 400 (critic M);
  - an undo takes only `{ sequence }`: the SEQUENCE the screen saw before its move (`undo.previous.sequence`). A copy of the meeting in the body is 400;
  - a decision takes `{ accept }`.
- **Every write is part 1's:**
  - it locks the meeting, applies the shared rule, plans its sends from the state it commits, checks the daily caps under the person's lock and writes its audit entries, all in one transaction on one connection;
  - the invites and the reminder re-syncs come after the commit (`MeetingWrites.afterCommit`), and neither can fail the request;
  - part 1's write helpers (`lockVisible`, `lockChangeable`, `loadedIn`, `checkSends`, `shaped` and `afterCommit`) moved out of `MeetingsService` into `meeting-writes.ts` unchanged, so both services use them.
- **Lock order:** an undo of a split locks the original, then the split, then the person's sends lock. Nothing locks a split before its original (`meeting-limits.ts`), so actions never wait in a circle.

### Moves (`packages/shared/src/meetings/moves.ts`)
- **Which occurrence:** `planned` must be one of the meeting's occurrences as the series plans them (`isPlannedOccurrence`). That is a one-off's own start, or a date-time the rule reaches from `start` up to `until` that is not a cancelled exception. A one-off moves as `all` whatever the scope (rule 4).
- **Refused with 400, writing nothing** (`moveProblem`):
  - a cancelled meeting;
  - a new start the clocks skip, or a length outside 15 to 1440 whole minutes (the spec checks only the 15, rule 5);
  - a `planned` that is not an occurrence;
  - "this and following" from the first occurrence. The old series would keep a DTSTART that RFC 5545 counts as an occurrence, so guests would see the meeting twice. The message points to All events;
  - a shifted series start the clocks skip, or one that breaks rule 3, and a split's new start that breaks rule 3;
  - a move whose moved occurrence would no longer be on the series (past `until`, or a monthly shift that changes the week of the month), or that takes an exception off its series;
  - "this and following" that starts at or before the end of the last occurrence the old series keeps (`lastKeptEnd`: the nearest planned date before `planned` that was not moved on its own, and every occurrence moved on its own before it, at its own time). Otherwise both series hold the same weeks and every guest gets both (review round 3 of PR #35). The message points to a later time, This event or All events;
  - a move that puts an occurrence moved on its own more than 31 days before its date in the series (`MOVED_EARLIER_REACH_DAYS`), by "this event" or by a shift, since the calendar, the reminders and a conflict check would no longer find it (review round 3 of PR #35);
  - an "all" move or a split that would leave an occurrence moved on its own behind (`leftBehindProblem`, review round 3 of PR #35): one whose own time has ended while its date in the series, as the move leaves it, has not. It is not sent again, so guests' calendars would show that date as a plain occurrence the app does not have. Both series of a split are checked, and the check runs on the database clock of the move;
  - a "this event" move that would give the series more than 100 exceptions (`MEETING_LIMITS.exceptionsMax`);
  - a new start outside the start bound (below, "Start bound").
- **What is saved** (`movedMeetings`, the sends table):
  - the original takes SEQUENCE + 1. `rescheduleSequence` is kept for "this event" and set to the new SEQUENCE for "all" and "this and following";
  - the original's stored instant is kept unless its start changed;
  - a split inserts the new series: a new id and UID, SEQUENCE 0, `rescheduleSequence` 0, the same organiser and the mover as `created_by`;
  - the split copies the live guest rows with their answers, an email guest under a new row id and each answer's SEQUENCE as 0. `meeting_responses` rows are not copied;
  - the copied email guests count against the mover's 50 outside addresses a day;
  - answers and proposals are never reset (kept as the spec says).
- **What is sent:**
  - "this event": an `occurrence` REQUEST "Updated", with the RECURRENCE-ID and the occurrence's own time, at the new SEQUENCE;
  - "all", or a one-off: an `edit` REQUEST "Updated";
  - a split: one `edit` REQUEST per series, the old one with its trimmed UNTIL and the new one under its new UID;
  - after "all" and a split, each series' surviving exceptions again (below);
  - reminders are re-synced for the original and the new series.
- **The answer** is `{ meetings, conflicts, undo: { previous, createdIds } }`. Each meeting, and `previous`, is shaped for the mover by `meetingForViewer`.

### Conflicts and "Busy" (`occurrenceConflicts`, `conflictForViewer`, `meeting-conflicts.ts`)
- **When:** on a move only, as a warning (rule 13), worked out in the move's transaction from the state it commits. Never at creation, on PATCH or on an accepted proposal.
- **Which meetings:** only those that share a colleague, customer, supplier or contact with the moved one, found by kind and id in one query on `meeting_attendees` joined to `meetings`. Email guests never match. Cancelled meetings and occurrences are left out. Since review round 1 of PR #35 the query also reads only meetings that can hold an occurrence on the moved day (`storedStartBounds`): a series that starts before the day's end plus the 31 days an occurrence moved earlier is still found from, and a one-off that starts on the day, each bound a day wider in UTC. That changes no result; it stops a check reading every meeting a guest was ever on.
- **How occurrences are found:** `meetingOccurrences` works each series out from the window: its planned dates there are counted from the start (`plannedBetween`), and its exceptions are checked on their own against the rule (`onSeriesRule`), never walked from the first date. It finds exactly what the walk found, an occurrence moved earlier by up to 31 days included (`MOVED_EARLIER_REACH_DAYS`). The cost grows with the window, not with the age of the series, so My meetings and the reminders gain too.
- **Which occurrences:** those on the new start's day that overlap the moved occurrence. Only the occurrence the move produced is skipped, so another occurrence of the same series counts. The meeting never warns about itself after an "all" or split move; the demo compares the key from before the move and does.
- **What a row shows** (`{ name, title, start }`):
  - the guest's name as the mover reads it on the moved meeting, and the other occurrence's start;
  - the other meeting's title only when the mover sees that meeting (`seesMeeting`) and sees that guest on it (`meetingForViewer`, so a hidden list hides them);
  - otherwise the title is "Busy" (`BUSY_TITLE`), and nothing else of that meeting is given: no id, guests, place, notes or private flag.

### Undo, rebuilt from the server's own entry (critic B3; `undoProblem`, `undoneMeeting`, `meeting-undo.ts`)
- **The record:** the "Moved meeting" entry keeps what undo needs, in times only:
  - before: `{ planned, sequence, series: { start, startsAt, durationMin, until, exceptions } }`, where `startsAt` is the stored instant;
  - after: `{ start, durationMin, scope, sequence, createdIds, sends }`.
- **The checks,** in one transaction after `lockChangeable`:
  1. The meeting's newest audit entry, by time and then id, must be "Moved meeting" and read back through a strict Zod schema, and the meeting must not be cancelled. Otherwise 409 `meeting_changed`. Every change to a meeting writes an entry under its lock, so this means nothing changed since the move, and the guests' answers are those the move left.
  2. The entry's actor must be the caller: 403 "Only the person who moved this meeting can undo the move."
  3. The entry must be at most 5 minutes old by the database clock (`UNDO_WINDOW_MINUTES`; entries are stamped with `clock_timestamp()`): 409 `undo_expired`.
  4. The current SEQUENCE must be the one the move saved, and the body's `sequence` the one before it: 409 `meeting_changed`. So a toast for an older move can't undo a newer one.
  5. Undoing "all" or a split must not leave an occurrence moved on its own behind (`undoneSeriesProblem`, the same `leftBehindProblem` as a move, on the database clock): otherwise 400 `invalid_request`, and nothing is written (review round 3 of PR #35). Undoing "this event" leaves the series' time and rule alone and is not checked.
  6. A series the move split off is locked after the original. It must be live, not cancelled, at SEQUENCE 0 and changeable by the caller, with this move's "Split meeting series" by the caller as its newest entry. Otherwise 409 `meeting_changed`, also when the caller can no longer change it.
- **The restored state** comes only from the record: the stored instant, the length, `until` and the exceptions, with SEQUENCE + 1 and `rescheduleSequence` set to it (sends table). The guests are untouched.
- **A split-off series** is soft-deleted with its guest rows and cancelled at SEQUENCE 1. Its waiting reminders are cancelled: `MeetingReminders.sync` on a deleted meeting only cancels its rows.
- **What is sent:**
  - an `edit` REQUEST to every guest at the new SEQUENCE (sends table);
  - after undoing "all" or a split, the restored series' surviving exceptions again;
  - after undoing "this event", that occurrence again at its restored time (the earlier exception's, or the series'), so the override the move sent is taken back;
  - a CANCEL with STATUS:CANCELLED to every guest of a removed split (RFC 5546 section 3.2.5);
  - the original's reminder is re-synced.
- **A second undo** finds "Undid meeting move" as the newest entry and gets 409 `meeting_changed`.

### Proposal decisions (`packages/shared/src/meetings/proposals.ts`, `canDecideProposal`)
- **Who:** only the organiser, and only when they may change the meeting (`canDecideProposal`). Anyone else gets 403 "Only the organiser can decide a proposed time." The spec's action checks the key only and leaves the organiser rule to the screen. Other readers never see other guests' proposals (`meetingForViewer`).
- **Refused:** a guest not on this meeting is 404. With no pending proposal from that guest, on a series, or on a cancelled meeting, the answer is 400. Accepting also needs the proposed start to exist on the clock, lie inside the start bound and last 15 to 1440 minutes.
- **Accept** (sends table):
  - the meeting takes the proposed start and length, with SEQUENCE + 1 and `rescheduleSequence` set to it;
  - every answer is reset, the organiser's included; the proposal becomes `accepted`, and every other proposal is cleared;
  - an `edit` REQUEST goes to every guest, and the reminder is re-synced.
- **Decline:**
  - the proposal becomes `declined`, and nothing else changes;
  - a DECLINECOUNTER with no STATUS and no VALARM, listing only the proposer, goes to the proposer only, at the unchanged SEQUENCE, unless they are no longer an active member;
  - the meeting's `updated_at` moves, so each decline is its own Outbox row and DTSTAMP follows commit order.
- **A pending proposal survives a move** (kept as the spec says) and can still be accepted afterwards.

### Series exceptions sent again (ADR 0021), lifting part 1's refusal
- **When:** after a series changes anything the file of an exception carries: DTSTART, DTEND, RRULE or UNTIL, and also SUMMARY, LOCATION, DESCRIPTION or the VALARM. That is an "all" move, both series of a split, any PATCH of a series (start, length, place, title, notes or reminder), and an undo of "all" or of a split.
  - A calendar drops or strands a series' overrides when its time or rule changes. An override also replaces its occurrence whole (RFC 5545 RECURRENCE-ID), so after a title, place or notes edit it would keep the old ones (review round 2 of PR #35).
- **What** (`exceptionResends`): each surviving exception that has not ended gets one copy of every series REQUEST, with:
  - the series' new SEQUENCE;
  - its own RECURRENCE-ID, the planned time as the series now has it;
  - its own time and length.
  - Each RECURRENCE-ID is its own Outbox row, because the invite's version holds it. A colleague's in-app note comes once, with the series' own invite.
- **Not sent:** an exception that has ended (`hasEnded`, the one bound both this and the refusals below use), which bounds what guests receive, and one marked cancelled (nothing writes one).
- **Refused instead of sent wrong** (review round 3 of PR #35): a change of a series' time or rule (an "all" move, either series of a split, a start or length edit, an undo of "all" or a split) that would leave an exception that has ended at a date in the series still ahead. A guest's calendar drops the override with the old time or rule and gets no new one, so it would show that date as a plain occurrence. The change is taken once that date's slot has ended.
- **PATCH:** a series' exceptions now shift with a new start (`shiftedSeries`, the same `moveOccurrence` rule as an "all" move). A new start that would take one off the series is refused (`shiftedSeriesProblem`), and so, since review round 3 of PR #35, is a new start or length that would put one more than 31 days before its date or leave one behind.

### Audit (part 2)
- `Moved meeting` on the original: the move record above, plus `after.sends`.
- `Split meeting series` on the new series (new): null → `{ from, start }`.
- `Undid meeting move`: `{ start }` → `{ start, sends }`.
- `Removed split meeting series` on the removed series (new): `{ start }` → `{ sends }`.
- `Accepted proposed time`: `{ start }` → `{ start, sends }`.
- `Declined proposed time` (new; meetings.md leaves declining unaudited): `{ guest }` → `{ sends }`. The guest is named as in `Removed meeting guest` (`guestAuditName`): "Email guest" for an email guest, and only by kind on a private meeting.
- The action strings are `MEETING_AUDIT_ACTIONS`, named once because undo matches on them. No entry holds titles, emails or notes. The target label is the title, or "Private meeting", as in part 1.

### Limits (part 2)
- **The daily caps** (part 1) count every email of a move, an undo, a decision and an edit: the re-sent exceptions and the CANCELs to a removed split's guests included. An action over a cap is 400 `invalid_request` and writes nothing.
- **At most 100 exceptions per series.** It bounds the jsonb column, the move record and the re-sends.
- **Start bound** (review round 1 of PR #35; `typedStartProblem`, `MEETING_LIMITS.startDaysBack` and `startDaysAhead`): a start a person types must lie from 366 days before the company's today (`tenants.time_zone`) to 1096 days after it, by local date. Otherwise 400 "Choose a start from one year ago up to three years ahead.", and nothing is written.
  - It applies on create, on an edit that changes the start, on a request, on a proposal in an answer, on accepting a proposal (checked again at that moment) and to a move's new start.
  - It does not apply to a start a rule derives: a series shifted by an "all" move keeps its old first date, an undo restores the server's record, and a series that began long ago keeps running, takes edits that leave its start alone, and moves through any occurrence inside the bound.
  - A year back lets a past occurrence be put right; three years ahead covers any booking the screens offer.

### Review round 1 of PR #35 (2026-11-15)
- **Blocking, availability:** a move's conflict check walked every series that shared a guest, week by week from its first date, inside the move's transaction. Nothing bounded the dates (any year from 1900 to 2999 was taken), so a person with create and edit could make series dated 1900 and move a one-off to 2999 again and again: about 16 seconds of the shared Node process per request, measured, holding a pooled connection and the meeting's lock. Part 1's My meetings and reminders walked the same way. Fixed three ways, none of which changes a result: occurrences are worked out from the window ("How occurrences are found" above); the conflict query reads only meetings near the day; and typed starts are bounded ("Start bound", a safer-direction change in the blueprint delta). Tests: an oracle in `packages/shared/test/meetings.test.ts` that compares the window rule with the old walk on generated series, timing tests for 200 series from 1900 against a day in 2999 (shared) and 600 against a move three years out (integration), and the bound on every route.
- **Undo of a split:** `lockSplit` refusing had no test. Now one integration case answers on, edits (a title, so SEQUENCE stays 0 and only the last entry shows it) and cancels the split-off series, and each undo answers 409 `meeting_changed` with both series as they were, nothing sent and no undo entry.
- **No duplicated reset:** the "ask again" reset (rule 6) is `ASKED_AGAIN` in `changes.ts`. The shared `askedAgain` spreads it on a guest for an edit and for `acceptedProposal`, and `resetAnswers` in `meeting-writes.ts` writes it to every live guest row for both services.

### Review round 2 of PR #35 (2026-11-15)
- **Should fix, correctness:** a title, place, notes or reminder PATCH of a series re-sent only the series REQUEST, because exceptions went again only after a timing change. Each occurrence moved on its own sits in a guest's calendar as its own RECURRENCE-ID override, carrying the SUMMARY, LOCATION, DESCRIPTION and VALARM it was sent with, and RFC 5545 has an override replace its occurrence whole. So after moving one occurrence with "this event" and then changing the place, the guest's calendar probably kept the old place for that week. A calendar that replaces the whole set on a series-only REQUEST would instead drop the override, and the occurrence would show at its planned time.
- **Fixed:** every PATCH of a series sends its surviving exceptions again (`resendExceptions: true` in `MeetingsService.update`), since every field an edit can change is in the file. The re-sends go to the same guests with the same content as the series invite, so nothing new is exposed. They count against the daily caps, so an edit of a series with many exceptions and guests may be refused rather than half sent.
- **Test:** `meetings-moves.int.test.ts` moves one occurrence with "this event", then edits the place, title, notes and reminder in turn. Each edit adds exactly one RECURRENCE-ID file per guest, carrying the new value, the occurrence's own time and SEQUENCE 2, and the exception stays stored.

### Review round 3 of PR #35 (2026-11-15)
- **Blocking, correctness:** rule 4's shift moves each exception's planned time but keeps its own time, and the check only asked whether the shifted planned time was still on the rule. So an "all" move or a start edit could tie an occurrence already held to a date still ahead: a Friday series whose last Friday was held an hour late, moved to Mondays, made that held occurrence the one for tomorrow's Monday. The app showed no meeting tomorrow, no reminder went, and `exceptionResends` sent nothing for the held occurrence, so every guest's calendar got a plain Monday instance from the new series file. The same held when a shift put an exception's own time more than 31 days before its planned date: the calendar, the reminders and the conflict check no longer found it.
- **Fixed by refusing** (the safer direction; re-sending a past-dated override instead would change the sends):
  - `strandedException` (an "all" move, the shifted exceptions of a split, and PATCH through `shiftedSeriesProblem`) also refuses an exception beyond the 31-day reach and one left behind (`leftBehindProblem`: own time ended by the database clock, its planned slot not);
  - the same left-behind check runs on the old series of a split (its UNTIL changes), on a length-only edit of a series (its DTEND changes; part 1 refused it, part 2 had lifted that) and on an undo of "all" or a split (`undoneSeriesProblem`, 400). These are the other changes of a series' time or rule after which exceptions are sent again, so the same occurrence would be lost the same way;
  - "this event" may not move an occurrence more than 31 days earlier, which the reach limit already hid before.
- **Should fix, correctness:** a "this and following" move could start the new series before the old one's last kept occurrence, so both series held the same weeks and every guest got both, for years with a far `planned`. meetings.md rule 4 only says the new series starts at the new time. Now refused when the new start is at or before the end of the last occurrence the old series keeps (`lastKeptEnd`, walking back over planned dates moved on their own with `previousPlannedStart`, so it costs at most one step more than the exceptions).
- **Should fix, tests:** no route test split or undid a series with occurrences moved on their own. Now one integration case moves an earlier and a later occurrence on their own, splits between them and undoes the split: each exception stays on its series (the later one shifted), each is re-sent under its own UID, and the undo restores the start, `until` and both exceptions from the audit entry and sends both again at the new SEQUENCE.
- **Tests:** packages/shared `meeting-moves` and `meeting-changes` (the walk back, the overlapping split, the reach, left behind on each route and its undo, all with a fixed database clock `NOW`); `meetings-moves.int.test.ts`, now 27 cases (the split with exceptions and its undo, and a PATCH start, a PATCH length, an "all" move and an undo refused with nothing written), and two refusals of an overlapping split in the refusals case.

### Safest options taken in part 2 (also in docs/blueprint-delta.md)
1. **Who may move, undo or decide:** someone who may change the meeting (`canChangeMeeting`), as for edits in part 1. The spec's actions check `meetings.meeting.edit` only. Deciding a proposal also needs the organiser: the spec's own screen rule, now enforced on the server.
2. **Undo is rebuilt on the server from its own "Moved meeting" entry**, never from the client's copy (critic B3). It is allowed only when:
   - the move is the last change to the meeting, and to its split;
   - the caller is the person who moved it and may still change it;
   - the move is at most 5 minutes old by the database clock. The spec has no window, and its toast lasts seconds, so 5 minutes is the tightest bound that survives a slow network and a paused toast;
   - the SEQUENCE the screen saw matches.
   - The body is strictly `{ sequence }`.
3. **Conflicts show a meeting the mover can't see, or can't see that guest on, as "Busy":** the guest's name and the start only, with no title, guests, place, notes or id. The spec's warning names any meeting's title, private ones included.
4. **Moves that can't be done correctly are refused:** a `planned` that is not an occurrence; "this and following" from the first occurrence; a shifted series start the clocks skip, or one that breaks rule 3, and a split's new start that breaks rule 3; a move that takes the moved occurrence or an exception off its series; a cancelled meeting; a length outside 15 to 1440 minutes. The demo moves whatever it is given. Since review round 3 of PR #35 also: "this and following" that starts at or before the end of the old series' last kept occurrence (rule 4 lets the two series overlap); a move or edit that puts an exception more than 31 days before its date in the series; and a change of a series' time or rule (an "all" move, either series of a split, a start or length edit, an undo of "all" or a split) that would leave an exception already held at a date still ahead.
5. **Surviving exceptions are sent again** after a series' time or rule changes, which lifts part 1's refusal of a series time edit, and after any other edit of a series (place, title, notes or reminder), since each override carries those too (review round 2 of PR #35). meetings.md "Differences from ADR 0021" lists them as not sent. Only exceptions that have not ended are sent, and a shift that would take one off its series is refused, as is a change that would leave an ended one at a date still ahead (review round 3 of PR #35).
6. **An undo also sends:**
   - a CANCEL to the guests of the split-off series it removes, which closes the spec's "Undo removes a split-off series without sending its guests a cancellation";
   - after undoing "this event", that occurrence at its restored time.
   - Otherwise guests' calendars keep a meeting or an override that no longer exists. The sends-table rows themselves are unchanged.
7. **New audit entries** (CLAUDE.md rule 10): "Split meeting series", "Removed split meeting series" and "Declined proposed time". meetings.md leaves declining unaudited. The entries hold times only.
8. **The daily caps count every send** of a move, an undo and a decision. The copied email guests of a split count against the mover's daily outside addresses.
9. **At most 100 exceptions per series.**
10. **Strict bodies:** a move's `meetingId`, if sent, must equal `:id`; an undo reads nothing but `sequence`.
11. **Decisions are refused on a cancelled meeting** (closing the spec's "`decideProposal` does not check for a cancelled meeting"), on a series, and when the proposed start no longer exists on the clock.
12. **An undo of a split answers 409** whenever the split-off series changed since the move or the caller may no longer change it, so it never removes a series someone else has since changed.
13. **A start a person types is bounded** (review round 1 of PR #35): from a year before the company's today to three years after it, on create, edit, request, proposal, accepting one and a move. meetings.md sets no bound. Without it, series dated 1900 and a move to 2999 made the conflict check walk centuries of dates while holding the meeting's lock.

### Kept as meetings.md says in part 2 (not safety)
- **A move does not reset answers or clear a pending proposal.** "This event" keeps `rescheduleSequence`; "all", "this and following" and undo set it to the new SEQUENCE; a split copies its guests' answers.
- **The sends-table rows** for moves, undo, accept and decline stand as written.
- **Accepting a proposal** resets every answer, the organiser's included.
- **The shift is measured from `planned`** (rule 4), also for an occurrence moved on its own before. A one-off moves as `all` whatever the scope.
- **Conflicts** only warn, only on a move, and only for the moved occurrence on its own day.
- **A moved request** gets a file, TENTATIVE while it waits (part 1).

### Deferred in part 2, not invented
- **Cancelling one occurrence:** the spec does not offer it.
- **Conflicts at creation or on PATCH:** not in the spec.
- **The web** (part 3, under "Later parts").

### For the owner (part 2)
- Is 5 minutes the right undo window, and should someone else who may change the meeting be able to undo a colleague's move? Part 2 allows only the mover.
- Should an undone split's guests get a CANCEL? Part 2 sends one.
- Should past exceptions be sent again after a series move? Part 2 sends only those that have not ended.
- Should a place, title, notes or reminder edit of a series send its surviving exceptions again? Part 2 does, so a moved occurrence does not keep the old place or title. It costs one email per guest per surviving exception.
- Should a "Busy" conflict show its start? Part 2 shows it, as free/busy time.
- Should "this and following" from the first occurrence be read as All events rather than refused? Part 2 refuses it.
- Should a series change that would leave an occurrence already held at a date still ahead send that occurrence again (a past-dated override) instead of being refused until the date passes? Part 2 refuses it (review round 3 of PR #35), which can hold back moving a series for up to the length of the shift.
- Should "this and following" be allowed to start before the old series' last kept occurrence ends, as rule 4 reads? Part 2 refuses it, so the two series never hold the same weeks.
- Is 100 exceptions per series right?
- Should declining a proposal stay audited? Part 2 audits it; the spec does not.
- An undo or decision over a daily cap is 400 `invalid_request`, as part 1's actions are. The spec names no status.
- Is a start bound of one year back and three years ahead right? A series that began more than a year ago can no longer have its first date edited; it moves through an occurrence instead.
- ADR 0021 notes that Outlook discards answers when SEQUENCE rises, while the spec keeps answers on a move. The spec stands. Revisit it?

### Residual risks (part 2)
- **Calendars may keep stray overrides:** after an "all" move or an undo, a guest's calendar may keep an override under a RECURRENCE-ID that is no longer an instance (Google). No valid message can cancel it.
- **Ended exceptions are not sent again,** so a calendar that drops a series' overrides on an update may show a past moved occurrence at its series time. Since review round 3 of PR #35 that series time is always past too: a change that would leave it ahead is refused.
- **A held occurrence can hold a series back:** while an occurrence moved on its own has taken place and its date in the series is still ahead, the series' time, length and rule can't change and an "all" or split undo is refused, until that date's slot ends (at most the length of the shift for a held-late occurrence, and up to 31 days for one held early). "This event" moves still work.
- **The daily caps can block a move or an edit:** a series with many exceptions and guests sends one REQUEST per guest per surviving exception, after a move and after any edit (review round 2 of PR #35). At 50 guests, the 500 meeting emails a day allow about nine, so moving or editing such a series is refused on a busy day rather than half sent.
- **An undo of "this event"** sends the series REQUEST and that occurrence, not the series' other exceptions. Their content has not changed, so a calendar that keeps overrides shows them right; one that replaces the whole set on a series-only REQUEST would drop them, as before the move.
- **Undo is short:** it is offered for 5 minutes, to the mover only, and only for the meeting's last change. Anything later is a new move.
- **Undo relies on every change being audited under the meeting's lock.** A future write path that changes a meeting without an entry would not be seen by check 1. The SEQUENCE check still catches any change that raises it.
- **"Busy" still says something:** the mover already reads the guest on the moved meeting, and learns that the guest is booked at that start, and how many of their meetings overlap it.
- **The demo keeps its own copies** of conflicts and moves (`attendeeConflicts`, `rescheduleMeeting`), with self-warnings and private titles, until part 3 moves DemoStore onto the shared rules (the same overlap part 1 accepted, critic K).
- **A proposal decided on the API** is not seen by the screens until part 3.
- **The start bound is on the API only:** the demo's screens take any start until part 3 moves DemoStore onto the shared rules.
- **An occurrence moved earlier by more than 31 days** is not found on its new day, by the calendar or by a conflict check, as before: the window rule keeps the walk's reach (`MOVED_EARLIER_REACH_DAYS`). Since review round 3 of PR #35 no move or edit can make one; only a row written by hand could hold one.

### Consequences (part 2)
- **No schema or dependency change:** no table, column, index or migration changes, and no dependency. A split inserts a `meetings` row and copies `meeting_attendees` rows; an undo soft-deletes them.
- **The move record's strict reader** (`parseMoveRecord`) is in `apps/api/src/modules/meetings/meeting-undo.ts`, not in packages/shared as the plan had it, because packages/shared has no Zod dependency and none may be added.
- **Occurrence checks** are worked out from the rule, never walked: `onSeriesRule` decides whether a date is a series' occurrence directly, weekly or monthly, and `meetingOccurrences` counts a series' dates in the window from its start (review round 1 of PR #35). The first build held the meeting's lock for about two seconds on a worst-case move check; after `dd91811` the conflict walk still could for many seconds.
- **`MeetingSends`:** `plan` takes an options object (`only`, `occurrence`, `resendExceptions`; part 1's `removed` is now `only`), and `invites` takes a list of plans and queues their jobs once.
- **Tests:**
  - packages/shared: new `meeting-moves` and `meeting-proposals`; `meeting-changes`, `meeting-sends` and `ics` extended (a DECLINECOUNTER file, and a RECURRENCE-ID file for the first occurrence of a series that starts after day 28);
  - `apps/api/test/meeting-undo.test.ts`: the move record read back, and anything else refused;
  - packages/shared `meetings`: the window rule against the old walk (an oracle on generated series), a monthly series' far dates, and 200 series from 1900 against a day in 2999; `meeting-input`, `meeting-changes`, `meeting-moves` and `meeting-proposals`: the start bound (review round 1 of PR #35);
  - `apps/api/test/meetings-moves.int.test.ts`, 27 cases (three added in review round 1 of PR #35: the start bound on every route, conflicts three years out with 600 series from 1900 sharing a guest, and undo refused after the split-off series was answered, edited or cancelled; one in round 2: an occurrence moved on its own sent again after a place, title, notes and reminder edit; two in round 3: a split and its undo with occurrences moved on their own, and changes that would leave a held occurrence behind refused): access, switches and bodies; tenancy and scope; each scope's sends, sequences and reminders; the split and its audit; exceptions sent again, ended ones not; the refusals; the daily caps on a move, an undo and a decision; invites off; conflicts and "Busy"; undo by the mover within five minutes by the database clock, only the last move, and refused after an edit, an answer or a cancel; decisions only by the organiser who may change the meeting, DECLINECOUNTER each time, none to a proposer who left; the 100-exception cap; several moves and an undo at once;
  - `apps/api/test/meetings.int.test.ts`: part 1's exceptions refusal became "shifts and re-sends the exceptions; refuses a monthly week shift";
  - the `isolation` and `permissions` route inventories pick the new routes up.
  - There are no Playwright tests, because no screen changed.

## Later parts
- **Part 2** (`feat/meetings-api-moves`, PR #35): done, under "Part 2 (2026-11-15)" above.
- **Part 3** (`feat/meetings-web-api`):
  - the meetings methods join `API_METHODS`;
  - the screens take the viewer id from the server (`GET /auth/context`, `viewerUserId`);
  - the New meeting dialog stops sending the organiser as a guest;
  - drag, Reschedule, Edit, Cancel and Remove are gated on `canChangeMeeting` (critic B5);
  - Undo sends `{ sequence: undo.previous.sequence }` to `/meetings/:id/reschedule/undo`, and the toast handles 403 and 409;
  - the conflict warning renders "Busy" rows;
  - "This and following events" is hidden on a series' first occurrence;
  - Accept time and Decline time show only to an organiser who may change the meeting;
  - Request is hidden when `colleagues` is empty;
  - Settings → Meetings and "Save under customer" are hidden in api mode;
  - DemoStore moves onto the shared rules, its own conflicts and moves included;
  - an e2e-api spec is added.
- **Part 4** (later, with the owner):
  - Settings → Meetings on the API;
  - contacts and leads;
  - the reminder sweeper;
  - a signed-link reply page;
  - iMIP;
  - the index migration.

## For the owner (part 1)
- **The go-ahead:** the owner restarted the queue on 2026-11-15 with meetings first (STATUS, "Owner answers (2026-11-15)"). PR #33 self-merges under the CLAUDE.md rule once its reviews are clean.
- **Before real email** (ADR 0021): import one REQUEST and one PUBLISH file by hand into Google Calendar and Outlook on the web before `EMAIL_PROVIDER=resend` sends meeting invites. Also import a PUBLISH without ORGANIZER, the file a reader who may not read guests' addresses gets, on its own and over the REQUEST of the same meeting.
- **Questions:**
  - Should a staff guest's own "Add to my calendar" file name the organiser's address? Part 1 leaves it out unless they may change the meeting, as the meeting's guest list does, although their emailed invite carries it.
  - Are 20 email guests per meeting, 50 outside addresses, 200 outside emails and 500 meeting emails per person a day right, and should inviting outside addresses need a key or a setting?
  - Should an organiser who can no longer read a customer on their meeting still be able to cancel it? Part 1 refuses, because the cancel would show them that customer in the Outbox.
  - Should the Owner, as an Outbox admin, still see the recipient and status of a private meeting's rows?
  - Should RSVP be FALSE for guests outside the company until replies can be read?
  - Should `meeting.when` name the zone?

## Residual risks (part 1)
- **Who is on a private meeting shows in the Outbox:** a holder of `settings.outbox.view` (the Owner by default) still sees the recipient, status and dates of a private meeting's rows; only subject, body and `.ics` are hidden. The recipients say who was invited.
- **Sends after the commit:** SEQUENCE can rise while one guest's row was not written (a failure is caught and logged). A row that was written and failed can be sent again with Retry, but a row never written has to wait for the next change. A transaction that holds every invite for 50 guests was ruled out: a pg-boss outage would hold the meeting's lock and a company connection for up to ten seconds per guest.
- **A jobs outage** (final review of PR #33):
  - Every guest's invite row is written first, then the jobs are queued, stopping at the first failure. If the invites found jobs down, the reminder rows are written and none of their jobs is queued. So a change waits on the outage once, about ten seconds, and holds no lock or company connection while it waits.
  - The rows left with no job are sent only by Retry or the planned sweeper. A `queued` invite can be retried at once.
  - A `scheduled` reminder can be retried only once its time has come, and it expires when the occurrence starts. Until the sweeper exists, a reminder whose job was never queued is lost unless someone retries it in that window, or a later change re-syncs the meeting.
- **Reminders:**
  - a re-sync that fails leaves the meeting with no reminder (logged);
  - later occurrences and the seeded meetings have none until part 4 or a change;
  - with no instance running workers nothing is sent, and late reminders are dropped.
- **Outside guests can't answer**, and with RSVP=TRUE their calendar's reply goes to the organiser's mailbox, where nothing reads it.
- **A proposal can be sent but not decided** on the API until part 2, which adds the decision. The screens don't use the API until part 3.
- **A linked guest with no address** gets a failed row on every send, and the actor gets a notice, as in the demo.
- **Branch scope sees every meeting that is not private**, from any branch, as in the spec. Narrowing it needs a branch on meetings and the owner.
- **The calendar file sits inline** in the Outbox row, readable by anyone who may read that row unredacted.
- **`meeting.when` has no zone**, so a guest in another zone can misread it.
- **The daily caps are per person.** A company with many members can still send many outside emails in a day, up to 200 per member. The caps count planned sends, so a send that later failed, or a colleague who left in between, still counts.
- **The limits refuse cancels too:** a person over the outside cap can't cancel or edit a meeting with outside guests until the next company day; someone else who may change it can.
- **Seeded meetings whose organiser can't read the customer** are changed on the API only by someone who reads every guest.
- **A company outside the seven zones** can't book meetings on the API at all (409).
- **Api mode before part 3:** Settings → Meetings, the bell, the Outbox and Simulate reply run on DemoStore, so they don't show what the API wrote.

## Consequences (part 1)
- **No schema or dependency change:** no table, column, index or migration changes, and no dependency is added. RFC 5545 is written by hand in `packages/shared/src/calendar/ics.ts`, with `Intl` for the zones.
- **The demo's calendar files changed** with the shared writer, in the ways listed under "File hardening". The seeded invite fixture is unchanged, and its regeneration test passes.
- **Tests:**
  - unit tests in packages/shared: `zones`, `ics`, `meeting-access`, `-input`, `-changes`, `-sends` and `-reminders`;
  - `apps/api/test/notification-rules.test.ts` covers the attachments and the private-meeting redaction;
  - `apps/api/test/meetings.int.test.ts` has 32 cases: access and switches, tenancy, data scope, private meetings in `/outbox`, create, edit, cancel, remove, answers, requests, versions, reminders, expiry, caps, the HR Suite and the 409. The reviews of PR #33 added:
    - six requests at once, all answered;
    - nobody changing a meeting with a customer they can't read (the organiser included), and `/outbox` not showing it;
    - the 200 outside emails cap on schedule, edit and cancel;
    - a committed change answered and re-synced when its invites fail, while a failed plan writes nothing;
    - the refusal paths, the colleagues list, supplier guests and the calendar file's ORGANIZER line;
    - from the final review: a jobs outage, where one queueing is tried per change, no meeting lock is held while it is tried, every row is written, and Retry queues a row left with no job; and colleagues that match weighing every member one by one, with a member who only creates meetings and one whose view tick was removed left out, and `membersAccess` for many people giving each person's answer alone;
  - `apps/api/test/notifications.int.test.ts` covers `within` and `deferJobs` (no job until `queueSends`, after the commit) and `queueSends` stopping at the first failure, with the rows left for Retry;
  - `packages/db/test/seed.int.test.ts` has a meetings case.
  - There are no Playwright tests, because no screen changed.
- **Unchanged `settings.meetings` module:** the feature sits in module `platform` while its key `settings.meetings.manage` is in module `meetings` (`features.ts`, `catalog.ts`). It is unchanged here.
