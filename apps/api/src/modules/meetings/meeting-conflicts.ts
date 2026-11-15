import type { CompanyDb } from "@workspace/db";
import { meetingAttendees } from "@workspace/db/company";
import {
  conflictForViewer,
  meetingForViewer,
  occurrenceConflicts,
  type Attendee,
  type Conflict,
  type OccurrenceKey,
} from "@workspace/shared";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { loadMeetings, partySight, type LoadedMeeting } from "./meeting-records";
import type { PartySight } from "./meeting-writes";
import { meetingViewer } from "./meetings-common";

/** The ids of the live meetings any of these guests is on, matched by kind and record id; email guests never match. */
async function meetingsSharing(tx: CompanyDb, guests: readonly Attendee[]): Promise<string[]> {
  const byKind = new Map<Attendee["kind"], string[]>();
  for (const guest of guests) {
    if (guest.kind === "external") continue;
    byKind.set(guest.kind, [...(byKind.get(guest.kind) ?? []), guest.id]);
  }
  if (byKind.size === 0) return [];
  const rows = await tx
    .selectDistinct({ meetingId: meetingAttendees.meetingId })
    .from(meetingAttendees)
    .where(
      and(
        isNull(meetingAttendees.deletedAt),
        or(
          ...[...byKind].map(([kind, ids]) =>
            and(eq(meetingAttendees.partyType, kind), inArray(meetingAttendees.partyId, ids)),
          ),
        ),
      ),
    );
  return rows.map((row) => row.meetingId);
}

/**
 * The conflicts a move warns about (meetings.md rule 13; ADR 0051 "Part 2"), worked out in the
 * move's own transaction from the state it commits, so it needs no second connection. `moved` is the
 * meeting that now holds the moved occurrence (the new series after a split), and `sight` the
 * mover's sight of its linked guests. Only meetings that share a colleague, customer, supplier or
 * contact with it are read, cancelled ones left out. The guests are as the mover reads them on the
 * moved meeting; they may change it, so they read every one. Each conflict is then shaped for the
 * mover (`conflictForViewer`): a meeting they can't see, or whose guest list hides that guest from
 * them, reads "Busy" with its start and nothing else.
 */
export async function moveConflicts(
  tx: CompanyDb,
  access: RequestAccess,
  moved: LoadedMeeting,
  occurrence: OccurrenceKey & { start: string; durationMin: number },
  sight: PartySight,
): Promise<Conflict[]> {
  const viewer = meetingViewer(access);
  const guests = meetingForViewer(moved.meeting, viewer, sight).attendees;
  const ids = await meetingsSharing(tx, guests);
  const meetings = (await loadMeetings(tx, { ids })).map((loaded) => loaded.meeting);
  const found = occurrenceConflicts(meetings, occurrence, guests);
  if (found.length === 0) return [];
  const othersSight = await partySight(
    tx,
    access,
    found.map((conflict) => conflict.meeting),
  );
  return found.map((conflict) => conflictForViewer(conflict, viewer, othersSight));
}
