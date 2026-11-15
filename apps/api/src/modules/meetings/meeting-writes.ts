import { Injectable } from "@nestjs/common";
import type { CompanyDb } from "@workspace/db";
import { meetingAttendees } from "@workspace/db/company";
import {
  ASKED_AGAIN,
  canChangeMeeting,
  meetingEmailCount,
  meetingForViewer,
  seesEveryLinkedGuest,
  seesMeeting,
  type Attendee,
  type Meeting,
  type MeetingEmailCount,
} from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { notFound } from "../sales/sales-common";
import { dailyEmailsProblem } from "./meeting-limits";
import { attendeesOf, loadMeetings, meetingOf, partySight, type LoadedMeeting } from "./meeting-records";
import { MeetingReminders } from "./meeting-reminders";
import { MeetingSends, type PlannedInvites } from "./meeting-sends";
import { cantSeeEveryGuest, lockMeeting, meetingViewer, notTheOrganiser, refuseIf } from "./meetings-common";

/** Whether the person reading a meeting may read a guest linked to a record (`partySight`). */
export type PartySight = (attendee: Attendee) => boolean;

/** A meeting as a write's transaction commits it, with the reader's sight of its linked guests. */
export interface Committed {
  saved: LoadedMeeting;
  sight: PartySight;
}

/** Locks a meeting the person may see, or answers 404 (CLAUDE.md rule 3). */
export async function lockVisible(tx: CompanyDb, access: RequestAccess, id: string): Promise<LoadedMeeting> {
  const row = await lockMeeting(tx, id);
  const loaded = meetingOf(row, await attendeesOf(tx, [id]));
  if (!seesMeeting(meetingViewer(access), loaded.meeting)) throw notFound("meeting");
  return loaded;
}

/**
 * Locks a meeting the person may change (`canChangeMeeting`): 404 when they can't see it, 403
 * when they see it but may not change it, including when they can't read a customer, supplier
 * or contact on it. Returns it with their sight of its linked guests.
 */
export async function lockChangeable(
  tx: CompanyDb,
  access: RequestAccess,
  id: string,
): Promise<{ loaded: LoadedMeeting; sight: PartySight }> {
  const loaded = await lockVisible(tx, access, id);
  const sight = await partySight(tx, access, [loaded.meeting]);
  const viewer = meetingViewer(access);
  if (!canChangeMeeting(viewer, loaded.meeting, sight)) {
    const onlySightMissing =
      !seesEveryLinkedGuest(loaded.meeting, sight) && canChangeMeeting(viewer, loaded.meeting, () => true);
    throw onlySightMissing ? cantSeeEveryGuest() : notTheOrganiser();
  }
  return { loaded, sight };
}

/** A meeting as the caller's transaction sees it: as it will commit, cancelled or not. */
export async function loadedIn(tx: CompanyDb, id: string): Promise<LoadedMeeting> {
  const [loaded] = await loadMeetings(tx, { ids: [id], withCancelled: true });
  if (!loaded) throw notFound("meeting");
  return loaded;
}

/**
 * The emails an action will send, once the daily limits allow them (ADR 0051 "Volume limits"):
 * refused with 400 before anything commits when they don't. The count goes into the action's
 * audit entry, which is what later actions count.
 */
export async function checkSends(
  tx: CompanyDb,
  userId: string,
  dayStart: Date,
  emails: readonly { recipient: Pick<Attendee, "kind"> }[],
): Promise<MeetingEmailCount> {
  const sends = meetingEmailCount(emails.map((email) => email.recipient));
  refuseIf(await dailyEmailsProblem(tx, userId, dayStart, sends));
  return sends;
}

/**
 * Asks every live guest of a meeting again (meetings.md rule 6 and "Accept a proposal" in the sends
 * table): each row takes `ASKED_AGAIN`, the reset the shared `askedAgain` gives a guest, so an edit
 * and an accepted proposal write it one way. The caller holds the meeting's lock.
 */
export async function resetAnswers(tx: CompanyDb, meetingId: string, now: Date): Promise<void> {
  await tx
    .update(meetingAttendees)
    .set({ ...ASKED_AGAIN, updatedAt: now })
    .where(and(eq(meetingAttendees.meetingId, meetingId), isNull(meetingAttendees.deletedAt)));
}

/** The committed meeting as this person may read it (`meetingForViewer`), with no read after the commit. */
export function shaped(access: RequestAccess, committed: Committed): Meeting {
  return meetingForViewer(committed.saved.meeting, meetingViewer(access), committed.sight);
}

/**
 * What every meetings write does once its transaction committed (meetings.md; ADR 0051), shared by
 * the part 1 and part 2 services so neither copies it.
 */
@Injectable()
export class MeetingWrites {
  constructor(
    private readonly sends: MeetingSends,
    private readonly reminders: MeetingReminders,
  ) {}

  /**
   * After a change committed: its invites, then the reminder re-sync of every meeting it changed
   * (by default the ones it sends for). Neither throws (each catches and logs its own failure), and
   * the re-sync runs whatever happened to the invites, so a committed change never answers 500 and
   * never keeps a reminder of the meeting as it was. When the invites found background jobs down,
   * the reminders are written without queueing their jobs, so the request waits on the outage once
   * (final review of PR #33).
   */
  async afterCommit(
    tenant: TenantContext,
    actorUserId: string,
    plans: readonly PlannedInvites[],
    meetingIds: readonly string[] = plans.map((planned) => planned.meeting.id),
  ): Promise<void> {
    let jobsDown = false;
    try {
      jobsDown = await this.sends.invites(tenant, actorUserId, plans);
    } finally {
      for (const id of new Set(meetingIds)) await this.reminders.sync(tenant, id, jobsDown);
    }
  }
}
