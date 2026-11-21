import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { featureOn, meetingWhenText, nextReminder, reminderRecipients } from "@workspace/shared";
import { v7 as uuidv7 } from "uuid";
import { CONTROL_DB } from "../../core/database/control-db";
import { NotificationService, type UnqueuedSend } from "../../core/notifications/notification.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { databaseNow } from "../hr/hr-common";
import { attendeesOf, meetingOf } from "./meeting-records";
import { activeMembers, lockMeetingRow, MEETING_SOURCE } from "./meetings-common";

/**
 * A meeting's reminder as Outbox rows (meetings.md rule 10; ADR 0051 "Reminders"; ADR 0032: a
 * scheduled row and a delayed job, no reminders table). After every change that can move, add,
 * drop or end a reminder — schedule, edit, cancel, remove a guest, an answer that confirms or
 * cancels a request (critic B6), a move, an undo and an accepted proposal — the waiting rows are
 * cancelled and the next one is raised again.
 */
@Injectable()
export class MeetingReminders {
  private readonly logger = new Logger("Meetings");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Re-syncs one meeting's reminder, after its change committed. First every waiting reminder row
   * is cancelled on its own, so if anything after fails the meeting has no reminder rather than a
   * wrong one. Then, under the meeting's row lock, the rows are cancelled again and the next
   * reminder is raised from the meeting as it now stands, in the same transaction, so two re-syncs
   * at once leave exactly one set of rows. Each set has a version of its own, so a re-sync is never
   * swallowed by the row of a set it cancelled (critic B1).
   *
   * The reminder goes to the staff guests but the organiser who are still active members, by email
   * only (spec rule 10), held until `reminderMin` before the next occurrence and dropped if not sent
   * by its start. None is raised for a cancelled meeting, a request still waiting, or while
   * `meetings.invites` is off, and a deleted meeting (the series an undo removed) only has its rows
   * cancelled.
   * There is no actor, so a re-sync by someone else drops nobody. Later occurrences of a series get
   * theirs when a change re-syncs it; a sweeper for them is Part 4 (ADR 0051 "Deferred").
   *
   * The rows' send jobs are queued only after the transaction commits, so a jobs outage never holds
   * the company connection or the meeting's lock while JobsService waits (final review of PR #33).
   * `jobsDown` says this request already found background jobs unavailable (its invites did): the
   * rows are then written with no job at all, for Retry or the sweeper, rather than wait again.
   */
  async sync(tenant: TenantContext, meetingId: string, jobsDown = false): Promise<void> {
    const source = { type: MEETING_SOURCE, id: meetingId };
    try {
      await this.notifications.cancelScheduled(tenant, "meeting.reminder", source);
      const db = await this.tenancy.db(tenant);
      const unqueued = await db.transaction(async (tx): Promise<UnqueuedSend[]> => {
        const row = await lockMeetingRow(tx, meetingId);
        await this.notifications.cancelScheduled(tenant, "meeting.reminder", source, tx);
        if (!row || row.deletedAt || !featureOn("meetings.invites")) return [];
        const { meeting } = meetingOf(row, await attendeesOf(tx, [row.id]));
        const reminder = nextReminder(meeting, await databaseNow(tx));
        const guests = reminderRecipients(meeting);
        const active = await activeMembers(
          tx,
          this.control.db,
          guests.map((guest) => guest.id),
        );
        const to = guests.filter((guest) => active.some((member) => member.id === guest.id));
        if (!reminder || to.length === 0) return [];
        const written = await this.notifications.notify(
          tenant,
          null,
          {
            event: "meeting.reminder",
            source,
            version: `${meeting.sequence}-reminder-${reminder.occurrence.planned}-${uuidv7()}`,
            to: to.map((guest) => ({ kind: "user" as const, id: guest.id, name: guest.name, email: guest.email })),
            values: {
              "meeting.title": meeting.title,
              "meeting.when": meetingWhenText(reminder.occurrence.start, meeting.timeZone),
              "meeting.location": meeting.location,
            },
            restricted: meeting.private,
            scheduledFor: reminder.scheduledFor,
            expiresAt: reminder.expiresAt,
          },
          { within: tx },
        );
        return written.unqueued;
      });
      if (!jobsDown) await this.notifications.queueSends(tenant, unqueued);
    } catch {
      this.logger.warn("A meeting changed, but its reminder could not be updated.");
    }
  }
}
