# ADR 0021: Meeting invites as iCalendar scheduling messages

Date: 2026-11-10. Status: accepted (the owner approved the Phase 0 plan on 2026-11-10) and built in feature batch 3.

## Context
Feature batch 3, Batch E adds guests by email, an invite in the Outbox for each guest with an `.ics` attachment, updates with the same UID and a higher SEQUENCE, cancellations, replies (accept, decline, propose a new time), meeting requests, reminders and private HR meetings. ADR 0020 supplies the Outbox.

Today `Meeting` (`packages/shared/src/types/meetings.ts`) has an owner, a time zone, a recurrence, an end date and exceptions per occurrence, but no UID, SEQUENCE or status. `Attendee` has only `kind`, `id` and `name`, with no email and no response. `moveOccurrence` (`packages/shared/src/operations/meetings.ts`) already splits "this and following" into a new series. ADR 0018 says the demo does not convert between zones.

## What we learned

### RFC 5545 (iCalendar)
- Lines end in CRLF and should not exceed 75 octets. Long lines fold with CRLF plus one space or tab, and a fold can fall inside a multi-byte character. ([section 3.1](https://www.rfc-editor.org/rfc/rfc5545#section-3.1)) Files must be generated in UTF-8. ([section 6](https://www.rfc-editor.org/rfc/rfc5545#section-6))
- In text values, backslash, semicolon and comma are escaped with a backslash, a line break is written `\n`, and a colon is not escaped. ([section 3.3.11](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.11))
- PRODID and VERSION are required. METHOD is optional, and without it no scheduling can be assumed. ([sections 3.7.2 to 3.7.4](https://www.rfc-editor.org/rfc/rfc5545#section-3.7.2))
- A VEVENT needs DTSTAMP and UID, DTSTART when METHOD is absent, and may not have both DTEND and DURATION. ([section 3.6.1](https://www.rfc-editor.org/rfc/rfc5545#section-3.6.1))
- With METHOD present, DTSTAMP is when this object was created, and it must be UTC. ([section 3.8.7.2](https://www.rfc-editor.org/rfc/rfc5545#section-3.8.7.2)) SEQUENCE starts at 0 and rises with each significant revision. ([section 3.8.7.4](https://www.rfc-editor.org/rfc/rfc5545#section-3.8.7.4))
- A time is floating, UTC with Z, or local with TZID, and the numeric offset form is forbidden. ([section 3.3.5](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.5)) Each TZID must have a matching VTIMEZONE. ([section 3.2.19](https://www.rfc-editor.org/rfc/rfc5545#section-3.2.19))
- A recurring event should use local time with a TZID, so that instances keep their local time across clock changes. A DTSTART that is not in its own RRULE gives an undefined result. ([section 3.8.5.3](https://www.rfc-editor.org/rfc/rfc5545#section-3.8.5.3))
- When DTSTART is local with a TZID, UNTIL must be UTC. ([section 3.3.10](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10))
- ATTENDEE must appear in group-scheduled objects and must not appear when publishing. ([section 3.8.4.1](https://www.rfc-editor.org/rfc/rfc5545#section-3.8.4.1)) PARTSTAT defaults to NEEDS-ACTION, RSVP to FALSE and ROLE to REQ-PARTICIPANT. ([sections 3.2.12](https://www.rfc-editor.org/rfc/rfc5545#section-3.2.12), [3.2.17](https://www.rfc-editor.org/rfc/rfc5545#section-3.2.17), [3.2.16](https://www.rfc-editor.org/rfc/rfc5545#section-3.2.16))
- A UID must be globally unique. ([section 3.8.4.7](https://www.rfc-editor.org/rfc/rfc5545#section-3.8.4.7)) RFC 7986 updates this: a UID must not contain a host name or domain, and a random UUID is recommended. ([RFC 7986 section 5.3](https://www.rfc-editor.org/rfc/rfc7986#section-5.3))
- A display alarm needs ACTION, TRIGGER and DESCRIPTION. ([section 3.6.6](https://www.rfc-editor.org/rfc/rfc5545#section-3.6.6))

### RFC 5546 (iTIP) and RFC 6047 (iMIP)
- The Organizer sends PUBLISH, REQUEST, ADD, CANCEL and DECLINECOUNTER. An Attendee sends REPLY, REFRESH and COUNTER. ([section 1.4](https://www.rfc-editor.org/rfc/rfc5546#section-1.4))
- UID plus RECURRENCE-ID is the key, the highest SEQUENCE wins, and DTSTAMP breaks ties. The Organizer keeps each attendee's last response SEQUENCE and DTSTAMP to discard late replies. ([section 2.1.5](https://www.rfc-editor.org/rfc/rfc5546#section-2.1.5))
- SEQUENCE must rise when DTSTART, DTEND, DURATION, RRULE, RDATE, EXDATE or STATUS changes, and for changes that could affect attendance, such as a move to a distant location. It must rise for CANCEL and must not rise for REPLY, COUNTER or DECLINECOUNTER. ([section 2.1.4](https://www.rfc-editor.org/rfc/rfc5546#section-2.1.4))
- A REQUEST with a higher SEQUENCE is a reschedule; an equal SEQUENCE is an update or reconfirmation. ([sections 3.2.2.1](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.2.1) and [3.2.2.2](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.2.2))
- A REQUEST needs at least one ATTENDEE, and SEQUENCE must be present when above 0. ([section 3.2.2](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.2)) RSVP=TRUE asks the attendee to reply. ([section 3.2.2.7](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.2.7))
- A REPLY carries exactly one ATTENDEE, the same UID and the original SEQUENCE, and no VALARM. ([section 3.2.3](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.3))
- To cancel a whole event, send CANCEL with STATUS:CANCELLED and no RECURRENCE-ID. To cancel one occurrence, add RECURRENCE-ID. To remove a guest, list that guest as ATTENDEE and leave STATUS out. A cancellation must reach every affected attendee. ([section 3.2.5](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.5))
- COUNTER is a full event with the proposed time, sent to the Organizer, and it does not raise SEQUENCE. The Organizer accepts by sending a REQUEST with a higher SEQUENCE, or rejects with DECLINECOUNTER. ([sections 3.2.7](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.7), [3.2.8](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.8) and [4.2.4](https://www.rfc-editor.org/rfc/rfc5546#section-4.2.4))
- PUBLISH needs ORGANIZER and allows no ATTENDEE. ([section 3.2.1](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.1))
- RFC 5546 does not say whether responses reset when an event moves; we read sections 2.1.1, 2.1.4, 3.2.2.1 and 3.2.2.2 and found no rule.
- Email carries these as a `text/calendar` part whose `method` parameter matches METHOD, with UTF-8 when not plain ASCII. A readable alternative part should be included. ([RFC 6047 section 2.4](https://www.rfc-editor.org/rfc/rfc6047#section-2.4)) The Organizer cannot be inferred from the Sender or Reply-To, only from the iCalendar properties. ([RFC 6047 section 2.3](https://www.rfc-editor.org/rfc/rfc6047#section-2.3))

### Outlook and Exchange
- METHOD decides the item type: none or PUBLISH makes an appointment, and REQUEST, REPLY and CANCEL must describe exactly one appointment. ([MS-OXCICAL METHOD](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/7befe35d-0652-447f-a780-d5fd5b879d38))
- **Outlook invalidates all responses when SEQUENCE rises.** It also ignores responses whose SEQUENCE does not match the meeting. ([MS-STANOICAL 2.1.5](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/3bd7ca8e-293c-42be-9a86-fbc46193a44d)) Microsoft's worked example shows the attendee back at `notResponded` after the organizer accepts a new time. ([Graph proposals](https://learn.microsoft.com/en-us/graph/outlook-calendar-meeting-proposals)) Outlook correlates by UID and RECURRENCE-ID and breaks SEQUENCE ties with DTSTAMP. ([MS-STANOICAL 2.1.5](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/3bd7ca8e-293c-42be-9a86-fbc46193a44d))
- Outlook takes a REQUEST with several VEVENTs only if they share a UID, X-MS-OLK-FORCEINSPECTOROPEN is TRUE, exactly one has an RRULE and the rest have RECURRENCE-ID. ([MS-STANOICAL REQUEST](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/cdac35a9-a5f5-4d12-b3ee-6f30b7cbc6c7)) Exchange does not support several VEVENTs for one appointment. ([MS-OXCICAL Appendix A, note 3](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/afb90409-bcd2-4a44-9f1e-ca9340ec0508))
- Outlook ignores the RANGE parameter on import. ([MS-STANOICAL 3.8.4.4](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/1c70d4c6-ba39-4965-8090-3020358bae34)) Exchange fails to import a file that has it. ([MS-STANXICAL CANCEL](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanxical/5dce2054-2b92-45eb-9cea-1a520c64d7cb))
- A CANCEL imports only its first VEVENT, and STATUS only affects the display. ([MS-STANOICAL CANCEL](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/8aa13c0b-ba42-4241-a102-372ce9287983)) Changing an RRULE invalidates the series' exceptions. ([MS-STANOICAL 3.8.4.4](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/1c70d4c6-ba39-4965-8090-3020358bae34))
- A TZID with no VTIMEZONE is matched against a list of known zones, then falls back to the viewer's local zone. ([MS-STANOICAL 3.2.19](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/28f49941-8e91-4618-a95d-e0b8b46cb871)) TZID matching in Outlook is case sensitive, and Exchange accepts one VTIMEZONE per file. ([Appendix A, notes 43 and 46](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/afb90409-bcd2-4a44-9f1e-ca9340ec0508))
- Outlook always exports DTEND and, given both, imports DTEND over DURATION. ([MS-STANOICAL REQUEST](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/cdac35a9-a5f5-4d12-b3ee-6f30b7cbc6c7))
- Proposing a new time is limited to work or school accounts and is not offered for recurring meetings. The organizer can switch it off and accepts with Accept Proposal then Send Update, which sends an updated request. ([Outlook support](https://support.microsoft.com/en-us/outlook/calendar/propose-a-new-meeting-time-in-outlook), [MS-OXOCAL](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxocal/477cd9e8-0255-4342-bcb6-e29e6cd69698)) Protocol-wise it is a COUNTER with one ATTENDEE and PARTSTAT TENTATIVE. ([MS-OXCICAL METHOD](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/7befe35d-0652-447f-a780-d5fd5b879d38))
- Graph defaults `allowNewTimeProposals` to true and offers `hideAttendees`, where each attendee sees only themselves. ([Graph event](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0))
- Uploading an `.ics` in Outlook on the web gives a snapshot that does not update later. ([Outlook support](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web))

### Google Calendar
- Guests answer Yes, No or Maybe, and Propose a new time sits under Maybe. It is unavailable for events over 200 guests and all-day events. ([Respond to invitations](https://support.google.com/calendar/answer/37135?hl=en&co=GENIE.Platform%3DDesktop))
- The organizer reviews the proposal under Guests and moves the event by saving it; nothing changes automatically. Organizers cannot propose. ([Workspace Learning Center](https://support.google.com/a/users/answer/9283119)) When announced for Gmail in 2019, the option was web only and opened Calendar to finish. ([Workspace Updates](https://workspaceupdates.googleblog.com/2019/12/more-options-calendar-invites.html))
- Importing an `.ics` drops guests and conference data. ([Import events](https://support.google.com/calendar/answer/37118?hl=en)) The API describes import as adding a private copy and requires an `iCalUID`. ([events.import](https://developers.google.com/workspace/calendar/api/v3/reference/events/import))
- Reminders are held per user, and `guestsCanSeeOtherGuests` defaults to true. ([Events reference](https://developers.google.com/workspace/calendar/api/v3/reference/events))
- A person can set Calendar to add invitations from everyone, only from known senders, or only after replying to the email. An invitation that is not added still arrives as an email. ([Manage invitations](https://support.google.com/calendar/answer/13159188?hl=en&co=GENIE.Platform%3DDesktop))
- A per-event setting, on by default, emails organizers when guests respond, including guests using other tools. ([Workspace Updates, August 2026](https://workspaceupdates.googleblog.com/2026/08/suppress-email-responses-to-calendar-invitations-and-updates.html))
- In one case, the 2026 Canadian clock correction, Google says guests must RSVP again after events move back. ([Daylight saving help](https://support.google.com/calendar/answer/18712272?hl=en))

### Odoo, for comparison
Odoo keeps the same four states, sends one mail per attendee with `invitation.ics`, and uses a separate template for a changed date. ([calendar_attendee.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/calendar/models/calendar_attendee.py)) A time change in `write()` does not reset every attendee, although its recurrence path does. ([calendar_event.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/calendar/models/calendar_event.py)) So resetting responses is a product choice, and Outlook's rule is the one that matters here.

### Not verified
- We found no Google document on how Gmail treats an invite sent by another system, whether it answers with METHOD:REPLY, or whether Propose a new time works for such an invite. Third-party guides say it is Google-to-Google only ([Zeeg](https://zeeg.me/en/blog/post/how-to-propose-a-new-time-in-google-calendar), search snippet only). A [ServiceNow developer thread](https://www.servicenow.com/community/developer-forum/meeting-invite-ics-with-rsvp-to-google-gmail-calendar/m-p/1380327) reports Gmail showing only Add to Calendar, with no confirmed fix.
- We could not confirm how Google treats an update at an equal SEQUENCE, a VALARM in an invite, or a second import of the same UID, or whether a normal reschedule clears responses.
- We could not test any file against a live Gmail or Outlook mailbox, because this step does not send email.

## Decision
- **Meeting gains** `uid` (a random UUID set at creation and never changed), `sequence` (starts at 0), `rescheduleSequence` (the value at the last significant change), `status` (`tentative`, `confirmed`, `cancelled`), `kind` (`meeting`, `request`), `private`, `hideGuestList` and `allowProposals`. `MeetingException` gains `sequence` and `location`.
- **Attendee gains** `email`, `role` (`required`, `optional`), `partStat` (`needs-action`, `accepted`, `tentative`, `declined`), `respondedAt`, `respondedSequence`, `note` and `proposal` (start, length, note, status). Its `kind` adds `customer-contact`, `supplier-contact` and `external`. A migration fills emails from linked records; a guest with no address gets a `failed` Outbox row (ADR 0020).
- **New collection** `meetingResponses` logs every reply and proposal (meeting, RECURRENCE-ID, guest, method, PARTSTAT, proposed time, note, sequence, DTSTAMP, `stale`).
- **Significant change** means start, length, recurrence, end date, status or location. It raises `sequence` and `rescheduleSequence` and sets every guest back to `needs-action`, because Outlook discards responses at that point and the demo should show what organisers will really see.
- **Messages** follow the table below, one Outbox row and one `.ics` per guest, with one VEVENT per file. Only the organiser's system issues updates; other editors are audited, and the ORGANIZER stays the meeting owner.
- **File rules.** CRLF; fold at 75 bytes without splitting a UTF-8 character; escape text; `VERSION:2.0`; `PRODID:-//Flooring Suite//Demo//EN`; METHOD directly after those; DTSTART and DTEND local with TZID, never DURATION or floating; DTSTAMP in UTC; one VTIMEZONE with STANDARD and DAYLIGHT parts whose TZID text matches exactly, from a table of the US zones the demo offers.
- **Recurrence.** Weekly is `FREQ=WEEKLY`, biweekly adds `INTERVAL=2`, and monthly is `FREQ=MONTHLY;BYDAY=2TH` style, from the same week rule as `nextMonthSameWeekday`. UNTIL is the end of the `until` day in the meeting's zone, written in UTC. A monthly series may not start in a fifth week, because the rule moves those to the fourth week and the first date would fall outside its own RRULE.
- **Attendees in the file.** `ATTENDEE;CN="…";ROLE=…;PARTSTAT=…;RSVP=TRUE:mailto:…`. With `hideGuestList`, each file lists only that recipient. Private HR meetings default to it, and so do meetings with external guests.
- **Two kinds of file.** The Outbox attachment is the scheduling message (REQUEST or CANCEL). "Add to my calendar" in the meeting drawer downloads METHOD:PUBLISH with ORGANIZER and no ATTENDEE, the same UID and SEQUENCE. REQUEST files carry one VALARM from `reminderMin`; CANCEL files carry none.
- **Replies.** Staff answer in the meeting drawer. External guests are represented by Simulate reply on the Outbox row: Accept, Maybe, Decline or Propose a new time. A reply whose SEQUENCE is below `rescheduleSequence` is logged as `stale` and changes nothing, and each reply notifies the organiser (ADR 0020).
- **Proposals** apply to one-off meetings where `allowProposals` is true. The meeting does not move until the organiser accepts. Accept sends a REQUEST with a higher SEQUENCE; Decline leaves the time unchanged and notifies the proposer.
- **Requests.** Request a meeting creates a `kind: request` meeting with `status: tentative`, the requester as organiser and the other person as a required guest. Accepting sets `confirmed` and raises SEQUENCE, because STATUS changed. Declining sets `cancelled`. Requests between staff carry no `.ics`.
- **Settings → Meetings** holds the default reminder, new-guest handling (E-1), and defaults for `allowProposals` and `hideGuestList`.
- **Code and tests.** `packages/shared/src/calendar/ics.ts` is pure and has unit tests for folding at byte boundaries, escaping, UID stability, SEQUENCE per action, CANCEL shapes, UTC UNTIL and TZID with VTIMEZONE. Before sign-off, one REQUEST and one PUBLISH file are imported by hand into Google Calendar and Outlook on the web.

| Action | Method and SEQUENCE | Sent to | Responses |
| --- | --- | --- | --- |
| Create | REQUEST, 0 | All guests | All `needs-action` |
| Significant change | REQUEST, +1 | All guests | Reset |
| Title, notes or reminder edit | REQUEST, same, new DTSTAMP | All guests | Kept |
| Add a guest | REQUEST, current value | New guest only | New guest `needs-action` |
| Remove a guest | CANCEL, +1, no STATUS, that guest as ATTENDEE | Removed guest only | Others kept |
| Cancel the meeting | CANCEL, +1, STATUS:CANCELLED, all as ATTENDEE | All guests | Closed |
| Move "this occurrence" | REQUEST with RECURRENCE-ID, +1 on the exception | All guests | That occurrence reset |
| Cancel "this occurrence" | CANCEL with RECURRENCE-ID, +1 | All guests | That occurrence closed |
| Move "this and following" | REQUEST on the old UID with trimmed UNTIL, +1; REQUEST on a new UID, 0; then each surviving exception again | All guests | Reset |
| Move "all occurrences" | REQUEST on the series, +1; then each surviving exception again | All guests | Reset |
| Guest proposes a time | COUNTER, unchanged | Organiser | Proposal stored |
| Organiser accepts proposal | REQUEST, +1 | All guests | Reset |
| Organiser declines proposal | DECLINECOUNTER, unchanged | Proposer | Unchanged |

Shape of a REQUEST (invented names):
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Flooring Suite//Demo//EN
METHOD:REQUEST
(one VTIMEZONE for America/Denver)
BEGIN:VEVENT
UID:0b6f1d0e-7c3f-4a52-9a54-2f0e1a7d9c11
DTSTAMP:20261110T153000Z
SEQUENCE:1
DTSTART;TZID=America/Denver:20261112T100000
DTEND;TZID=America/Denver:20261112T103000
SUMMARY:Showroom walkthrough
ORGANIZER;CN="Dana Reyes":mailto:dana@summit.example
ATTENDEE;CN="Luis Moreno";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:luis@builder.example
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR
```

## Where the research changes the spec
1. **"Moving or editing sends a higher SEQUENCE" is too broad.** RFC 5546 ties it to time, recurrence and status changes, and Outlook discards all answers when it rises. Recommendation: raise it only for significant changes, and send title or notes edits at the same SEQUENCE.
2. **Responses after a move are not mentioned.** Recommendation: reset them on a significant change, as above.
3. **Maybe is missing.** RFC 5546, Google, Outlook and Odoo all have it. Recommendation: Accept, Maybe, Decline, plus Propose a new time.
4. **Proposals need an organiser step and limits.** Recommendation: accept or decline as above, one-off meetings only, with a per-meeting switch.
5. **"Adds it to any calendar" overstates a file import.** Google drops guests and Outlook takes a snapshot, so only an emailed invite can update. Recommendation: reword the spec and ship the two file kinds above.
6. **Removing a guest is not covered.** Recommendation: send that guest a CANCEL with STATUS left out.
7. **Recurring meetings are not covered.** Recommendation: the table above, with one VEVENT per file, no RANGE, and exceptions re-sent after any RRULE change.
8. **ADR 0018's "no conversion between zones" is not enough.** Recommendation: keep local times but emit TZID, VTIMEZONE and a UTC UNTIL.
9. **Guest-list privacy is missing.** Recommendation: `hideGuestList`, on by default for meetings with external guests and for private HR meetings, so one customer does not see another or the internal list.

## Consequences
- REPLY and COUNTER go to the ORGANIZER address, per RFC 6047 and RFC 5546, so the system sees them only if it can read that address. The real build needs a monitored reply address for each meeting and must test it against Gmail and Outlook.
- External guests need a hosted answer page with a signed per-guest link (Accept, Maybe, Decline, Propose). Calendar apps cannot be relied on for proposals, given Outlook's account limits and Google's undocumented behaviour. Inbound METHOD:REPLY is an extra path, not the only one.
- Real email carries a `text/calendar; method=…; charset=UTF-8` part with a readable alternative, per RFC 6047, and needs the domain setup from ADR 0020.
- The email body must stand on its own with date, time, place and links, because Google may not add invitations from unknown senders.
- Replies should be accepted only when the sender matches the ATTENDEE or the link token is valid, in line with RFC 6047's warning that identity cannot be taken from the Sender.
- VTIMEZONE should come from a time zone database rather than a fixed table, and the UID stays a UUID with no tenant data.
- `meetingResponses` becomes a table keyed by UID, RECURRENCE-ID and attendee.

## Sources
- [RFC 5545: iCalendar](https://www.rfc-editor.org/rfc/rfc5545), [RFC 5546: iTIP](https://www.rfc-editor.org/rfc/rfc5546), [RFC 6047: iMIP](https://www.rfc-editor.org/rfc/rfc6047), [RFC 7986: New Properties for iCalendar](https://www.rfc-editor.org/rfc/rfc7986)
- [MS-OXCICAL: METHOD](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/7befe35d-0652-447f-a780-d5fd5b879d38), [DTSTART](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/43d2f45b-0311-4005-9a9d-519bdcc747fc), [RECURRENCE-ID](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/6911f0f9-a26b-44bd-be7e-0fe38059fae0), [Processing Rules](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/74d3bf60-f30d-4fca-84d3-cfd04da8e627), [Organizer's Cancellation](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/58adbf7c-d2ef-43ec-8471-d9f17691c69e), [Appendix A](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/afb90409-bcd2-4a44-9f1e-ca9340ec0508); [MS-OXOCAL: New date and time proposals](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxocal/477cd9e8-0255-4342-bcb6-e29e6cd69698)
- [MS-STANOICAL: Message Sequencing](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/3bd7ca8e-293c-42be-9a86-fbc46193a44d), [REQUEST](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/cdac35a9-a5f5-4d12-b3ee-6f30b7cbc6c7), [CANCEL](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/8aa13c0b-ba42-4241-a102-372ce9287983), [Recurrence ID](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/1c70d4c6-ba39-4965-8090-3020358bae34), [TZID](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanoical/28f49941-8e91-4618-a95d-e0b8b46cb871); [MS-STANXICAL: CANCEL](https://learn.microsoft.com/en-us/openspecs/exchange_standards/ms-stanxical/5dce2054-2b92-45eb-9cea-1a520c64d7cb)
- [Microsoft Graph: Propose new meeting times](https://learn.microsoft.com/en-us/graph/outlook-calendar-meeting-proposals), [event resource](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)
- [Outlook: Propose a new meeting time](https://support.microsoft.com/en-us/outlook/calendar/propose-a-new-meeting-time-in-outlook), [Import or subscribe to a calendar](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web)
- [Google Calendar: Respond to invitations](https://support.google.com/calendar/answer/37135?hl=en&co=GENIE.Platform%3DDesktop), [Import events](https://support.google.com/calendar/answer/37118?hl=en), [Manage invitations](https://support.google.com/calendar/answer/13159188?hl=en&co=GENIE.Platform%3DDesktop), [Canadian daylight saving](https://support.google.com/calendar/answer/18712272?hl=en), [Workspace Learning Center](https://support.google.com/a/users/answer/9283119), [Workspace Updates 2019](https://workspaceupdates.googleblog.com/2019/12/more-options-calendar-invites.html), [Workspace Updates 2026](https://workspaceupdates.googleblog.com/2026/08/suppress-email-responses-to-calendar-invitations-and-updates.html)
- [Google Calendar API: events](https://developers.google.com/workspace/calendar/api/v3/reference/events), [events.import](https://developers.google.com/workspace/calendar/api/v3/reference/events/import)
- [Odoo source: calendar_attendee.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/calendar/models/calendar_attendee.py), [calendar_event.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/calendar/models/calendar_event.py)
- [ServiceNow developer thread on Gmail RSVP](https://www.servicenow.com/community/developer-forum/meeting-invite-ics-with-rsvp-to-google-gmail-calendar/m-p/1380327) (community report, opened); [Zeeg: Propose a new time](https://zeeg.me/en/blog/post/how-to-propose-a-new-time-in-google-calendar) (third-party, search snippet only, not opened)
