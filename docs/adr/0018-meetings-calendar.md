# ADR 0018: A meetings calendar with drag, resize and per-occurrence changes

Date: 2026-11-09. Status: accepted.

## Context
Feature batch 2, Batch F: day, week, month and agenda views; drag to move and drag the edge to resize; click an empty slot to create; recurring meetings ask this event, this and following, or all; attendee conflicts; Undo after every move; a keyboard and form alternative; reminders and time zones follow the move. Meetings had a start, a length and a recurrence, shown on a week list.

## Decision
- `Meeting` gains `timeZone` (the company's), `until` (the last day of a series, set when it is split) and `exceptions` (occurrences moved, resized or cancelled on their own, keyed by the date-time the series planned them). `meetingOccurrences` applies them and returns each occurrence's start, length and planned time.
- `moveOccurrence` (shared) implements the three scopes: this event adds an exception; this and following ends the series the day before and starts a new one at the new time (later exceptions move with it); all shifts the series by the same amount. `attendeeConflicts` names attendees booked in an overlapping meeting.
- `ApiClient.rescheduleMeeting` saves the change, returns the conflicts and an Undo record (the meeting before, and a series the split created); `undoReschedule` puts it back. Both need `meetings.meeting.edit` and are audited. Reminders are minutes before the start, so they follow the move.
- The week and day views are a time grid built on pointer events (plan K-15, no calendar library): moves snap to 15 minutes and can cross days in the week; the bottom edge resizes; overlapping meetings sit side by side in lanes. A press without movement opens the meeting, so each one is a plain button for keyboard and screen readers, and the drawer's Reschedule form (date, start, minutes) is the non-drag alternative. Month and agenda views list occurrences.
- Saved data (schema version 3): meetings get the company's time zone, no end and no exceptions.

## Consequences
- Time zones are shown and kept per meeting; the demo does not convert between zones.
