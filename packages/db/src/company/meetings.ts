import type { Attendee, Meeting, MeetingException, MeetingProposal } from "@workspace/shared";
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appendOnly, at, business, day, userRef } from "../columns";

/**
 * A meeting, possibly recurring (ADR 0018, 0021). The uid is set once and the sequence rises on
 * every change, so calendars recognise updates. Moved or cancelled occurrences are exceptions.
 */
export const meetings = pgTable(
  "meetings",
  {
    ...business(),
    title: text().notNull(),
    start: at().notNull(),
    durationMin: integer().notNull(),
    location: text().notNull().default(""),
    recurrence: text().$type<Meeting["recurrence"]>().notNull().default("none"),
    reminderMin: integer().notNull(),
    ownerUserId: userRef().notNull(),
    notes: text().notNull().default(""),
    timeZone: text().notNull(),
    until: day(),
    exceptions: jsonb().$type<MeetingException[]>().notNull().default([]),
    uid: text().notNull(),
    sequence: integer().notNull().default(0),
    rescheduleSequence: integer().notNull().default(0),
    status: text().$type<Meeting["status"]>().notNull(),
    kind: text().$type<Meeting["kind"]>().notNull().default("meeting"),
    private: boolean().notNull().default(false),
    hideGuestList: boolean().notNull().default(false),
    allowProposals: boolean().notNull().default(true),
  },
  (table) => [uniqueIndex("meetings_uid_uidx").on(table.uid)],
);

/**
 * A guest: staff, a customer or supplier, one of their contacts, or someone added by email. The
 * guest is a polymorphic link (party_type and party_id); an external guest has no party id.
 */
export const meetingAttendees = pgTable(
  "meeting_attendees",
  {
    ...business(),
    meetingId: uuid()
      .notNull()
      .references(() => meetings.id),
    partyType: text().$type<Attendee["kind"]>().notNull(),
    partyId: uuid(),
    name: text().notNull(),
    email: text().notNull().default(""),
    role: text().$type<Attendee["role"]>().notNull(),
    partStat: text().$type<Attendee["partStat"]>().notNull().default("needs-action"),
    respondedAt: at(),
    respondedSequence: integer(),
    note: text().notNull().default(""),
    proposal: jsonb().$type<MeetingProposal>(),
  },
  (table) => [index("meeting_attendees_meeting_idx").on(table.meetingId)],
);

/** Every reply and proposal, kept even when stale (ADR 0021). Append-only. */
export const meetingResponses = pgTable("meeting_responses", {
  ...appendOnly(),
  meetingId: uuid()
    .notNull()
    .references(() => meetings.id),
  attendeeId: uuid()
    .notNull()
    .references(() => meetingAttendees.id),
  method: text().$type<"reply" | "counter">().notNull(),
  partStat: text().$type<Attendee["partStat"]>().notNull(),
  proposedStart: at(),
  note: text().notNull().default(""),
  sequence: integer().notNull(),
  at: at().notNull(),
  stale: boolean().notNull().default(false),
});
