import type { CompanyDb } from "@workspace/db";
import { meetingAttendees, meetings } from "@workspace/db/company";
import {
  addDays,
  conflictForViewer,
  meetingForViewer,
  MOVED_EARLIER_REACH_DAYS,
  occurrenceConflicts,
  type Attendee,
  type Conflict,
  type OccurrenceKey,
} from "@workspace/shared";
import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { loadMeetings, partySight, type LoadedMeeting } from "./meeting-records";
import type { PartySight } from "./meeting-writes";
import { meetingViewer } from "./meetings-common";

/**
 * The stored start instants a meeting must have to hold an occurrence on a day as
 * `meetingOccurrences` finds one (ADR 0051 "Part 2", review round 1 of PR #35): every meeting must
 * start before the end of the day plus the days an occurrence moved earlier is still found from
 * (`MOVED_EARLIER_REACH_DAYS`), and a one-off with no occurrence moved on its own must start on the
 * day. Each bound is a day wider than the day in UTC, so it holds in any zone; the shared rule then
 * decides exactly.
 */
function storedStartBounds(day: string): { from: Date; before: Date } {
  return {
    from: new Date(`${addDays(day, -1)}T00:00:00Z`),
    before: new Date(`${addDays(day, MOVED_EARLIER_REACH_DAYS + 2)}T00:00:00Z`),
  };
}

/**
 * The ids of the live meetings any of these guests is on, matched by kind and record id (email guests
 * never match), that are not cancelled and can hold an occurrence on the day: within the start
 * bounds (`storedStartBounds`), and a series only while its end date is not before the day, unless it
 * has occurrences moved on their own, since one can be moved past that date (final review of PR
 * #35). `until` and the day are local dates, compared as the shared rule compares them. So a conflict
 * check reads the meetings near the day, not every meeting the guests were ever on.
 */
export async function meetingsSharing(tx: CompanyDb, guests: readonly Attendee[], day: string): Promise<string[]> {
  const byKind = new Map<Attendee["kind"], string[]>();
  for (const guest of guests) {
    if (guest.kind === "external") continue;
    byKind.set(guest.kind, [...(byKind.get(guest.kind) ?? []), guest.id]);
  }
  if (byKind.size === 0) return [];
  const bounds = storedStartBounds(day);
  const rows = await tx
    .selectDistinct({ meetingId: meetingAttendees.meetingId })
    .from(meetingAttendees)
    .innerJoin(meetings, eq(meetings.id, meetingAttendees.meetingId))
    .where(
      and(
        isNull(meetingAttendees.deletedAt),
        isNull(meetings.deletedAt),
        ne(meetings.status, "cancelled"),
        lt(meetings.start, bounds.before),
        or(
          and(ne(meetings.recurrence, "none"), or(isNull(meetings.until), gte(meetings.until, day))),
          gte(meetings.start, bounds.from),
          sql`${meetings.exceptions} <> '[]'::jsonb`,
        ),
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
 * contact with it and can hold an occurrence on the moved day are read, cancelled ones left out.
 * Each series' occurrences are worked out from that day, not walked from its first date, so the
 * check costs the same however old or far away the series are (review round 1 of PR #35). The
 * guests are as the mover reads them on the moved meeting; they may change it, so they read every
 * one. Each conflict is then shaped for the mover (`conflictForViewer`): a meeting they can't see,
 * or whose guest list hides that guest from them, reads "Busy" with its start and nothing else.
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
  const ids = await meetingsSharing(tx, guests, occurrence.start.slice(0, 10));
  const nearby = (await loadMeetings(tx, { ids })).map((loaded) => loaded.meeting);
  const found = occurrenceConflicts(nearby, occurrence, guests);
  if (found.length === 0) return [];
  const othersSight = await partySight(
    tx,
    access,
    found.map((conflict) => conflict.meeting),
  );
  return found.map((conflict) => conflictForViewer(conflict, viewer, othersSight));
}
