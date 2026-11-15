import { zonedToInstant, type Attendee, type Meeting } from "@workspace/shared";
import type { CompanyDb } from "../client";
import { meetingAttendees, meetings } from "../company";
import { seedId, type DemoCompany } from "./fixtures";
import { userOf } from "./values";

/**
 * A fixture's local date-time as the instant it names in the meeting's zone (ADR 0051 "Times"). The
 * fixtures keep the spec's local "YYYY-MM-DDTHH:mm"; the table keeps instants. A time the zone's
 * clock can't show stops the seed rather than storing a guess.
 */
function instantIn(local: string, zone: string): Date {
  const placed = zonedToInstant(local, zone);
  if (!placed.instant) throw new Error(`Seed meeting time ${local} can't be placed in ${zone}: ${placed.problem}.`);
  return placed.instant;
}

/**
 * The stored party id of a fixture guest (ADR 0051 "Ids"): a colleague by their control-database
 * user id, the id every session carries (critic A3); a customer, supplier or person at one by the
 * id their own seed gave them; and nobody for a guest added by email.
 */
function partyIdOf(guest: Attendee): string | null {
  if (guest.kind === "external") return null;
  return guest.kind === "staff" ? userOf(guest.id) : seedId(guest.id);
}

/** A fixture meeting's guest rows, in the fixture's order, with stable ids. */
function guestRows(meeting: Meeting) {
  const owner = userOf(meeting.ownerUserId);
  return meeting.attendees.map((guest, index) => ({
    id: seedId(`${meeting.id}:guest:${index}`),
    meetingId: seedId(meeting.id),
    partyType: guest.kind,
    partyId: partyIdOf(guest),
    name: guest.name,
    email: guest.email,
    role: guest.role,
    partStat: guest.partStat,
    respondedAt: guest.respondedAt ? instantIn(guest.respondedAt, meeting.timeZone) : null,
    respondedSequence: guest.respondedSequence,
    note: guest.note,
    proposal: guest.proposal,
    createdBy: owner,
  }));
}

/**
 * Meetings (meetings.md; ADR 0051): every fixture meeting with its guests, the uid, SEQUENCE and
 * flags as the fixture has them, and the start stored as the instant its local time names in the
 * meeting's zone. The demo's guest-reply log is empty and no Outbox rows are seeded, so nothing is
 * sent and no reminder waits: a seeded meeting gets its reminder when a change re-syncs it.
 */
export async function seedMeetings(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  if (fixtures.meetings.length === 0) return;
  await tx
    .insert(meetings)
    .values(
      fixtures.meetings.map((meeting) => ({
        id: seedId(meeting.id),
        title: meeting.title,
        start: instantIn(meeting.start, meeting.timeZone),
        durationMin: meeting.durationMin,
        location: meeting.location,
        recurrence: meeting.recurrence,
        reminderMin: meeting.reminderMin,
        ownerUserId: userOf(meeting.ownerUserId)!,
        notes: meeting.notes,
        timeZone: meeting.timeZone,
        until: meeting.until,
        exceptions: meeting.exceptions,
        uid: meeting.uid,
        sequence: meeting.sequence,
        rescheduleSequence: meeting.rescheduleSequence,
        status: meeting.status,
        kind: meeting.kind,
        private: meeting.private,
        hideGuestList: meeting.hideGuestList,
        allowProposals: meeting.allowProposals,
        createdBy: userOf(meeting.ownerUserId),
      })),
    )
    .onConflictDoNothing();
  await tx.insert(meetingAttendees).values(fixtures.meetings.flatMap(guestRows)).onConflictDoNothing();
}
