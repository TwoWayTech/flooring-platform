import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import {
  featureOn,
  icsFileName,
  inviteValues,
  inviteVersion,
  meetingIcs,
  meetingWhenText,
  OUTBOX_RECIPIENT_KIND,
  sendIcsInput,
  sendPlan,
  type Attendee,
  type Meeting,
  type MeetingSendKind,
  type ReplyOutcome,
} from "@workspace/shared";
import { CONTROL_DB } from "../../core/database/control-db";
import { NotificationService } from "../../core/notifications/notification.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { MEETING_SOURCE, organiserOf, type MeetingPerson } from "./meetings-common";

/** Where a meeting's in-app notes open. */
const MEETINGS_HREF = "/meetings";

/**
 * The emails and in-app notes meetings raise through the notifications core (meetings.md "What
 * each action sends" and "Events and audit entries"; ADR 0051 "Invites"). Every call runs after the
 * change committed, one guest at a time with its own catch, so a failed send never undoes the
 * change and never stops the other guests' invites; a failure is logged without names or
 * addresses (CLAUDE.md rule 14).
 */
@Injectable()
export class MeetingSends {
  private readonly logger = new Logger("Meetings");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * One invite and one calendar file per guest for an action (shared `sendPlan`): the organiser
   * never gets one, and with `meetings.invites` off nothing goes. `stamp` is the meeting's
   * committed `updated_at`, so DTSTAMP follows commit order and the Outbox version is exact to the
   * millisecond (ADR 0051; RFC 5546 section 2.1.5). A private meeting's rows are restricted.
   */
  async invites(
    tenant: TenantContext,
    actorUserId: string,
    kind: MeetingSendKind,
    meeting: Meeting,
    stamp: Date,
    removed?: Attendee,
  ): Promise<void> {
    const plan = sendPlan(kind, meeting, { invitesOn: featureOn("meetings.invites"), removed });
    if (plan.length === 0) return;
    const organiser = await organiserOf(this.control.db, meeting.ownerUserId);
    for (const send of plan) {
      try {
        const text = meetingIcs(sendIcsInput(send, meeting, organiser, stamp));
        const guest = send.recipient;
        await this.notifications.notify(tenant, actorUserId, {
          event: "meeting.invite",
          source: { type: MEETING_SOURCE, id: meeting.id },
          version: inviteVersion(send, stamp),
          to: [{ kind: OUTBOX_RECIPIENT_KIND[guest.kind], id: guest.id, name: guest.name, email: guest.email }],
          inApp: send.inApp
            ? [{ userId: guest.id, title: `${send.action}: ${meeting.title}`, href: MEETINGS_HREF }]
            : [],
          values: inviteValues(send, meeting, organiser.name),
          attachments: [{ kind: "ics", fileName: icsFileName(meeting.title), text }],
          restricted: meeting.private,
        });
      } catch {
        this.logger.warn("A meeting changed, but one guest's invite could not be written to the Outbox.");
      }
    }
  }

  /**
   * Tells the organiser a guest answered (meetings.md "Events": `meeting.reply` or
   * `meeting.proposed`, email and in-app). The version is the answer's own log row, so every answer
   * from every guest is its own message (critic B2).
   */
  async answered(
    tenant: TenantContext,
    actorUserId: string,
    meeting: Meeting,
    guest: Attendee,
    outcome: ReplyOutcome,
    responseId: string,
    proposedStart: string | null,
  ): Promise<void> {
    if (!outcome.event) return;
    try {
      const organiser = await organiserOf(this.control.db, meeting.ownerUserId);
      const word = outcome.event === "meeting.proposed" ? "proposed a new time" : outcome.partStat;
      await this.notifications.notify(tenant, actorUserId, {
        event: outcome.event,
        source: { type: MEETING_SOURCE, id: meeting.id },
        version: responseId,
        to: [{ kind: "user", id: meeting.ownerUserId, name: organiser.name, email: organiser.email }],
        inApp: [{ userId: meeting.ownerUserId, title: `${guest.name} ${word}: ${meeting.title}`, href: MEETINGS_HREF }],
        values: {
          "guest.name": guest.name,
          "guest.reply": outcome.partStat,
          "meeting.title": meeting.title,
          "meeting.when": meetingWhenText(proposedStart ?? meeting.start),
        },
        restricted: meeting.private,
      });
    } catch {
      this.logger.warn("A meeting was answered, but the organiser could not be told.");
    }
  }

  /** Tells a colleague they were asked to meet (meetings.md "Request a meeting": `meeting.requested`, email and in-app). */
  async requested(tenant: TenantContext, asker: MeetingPerson, meeting: Meeting, asked: MeetingPerson): Promise<void> {
    try {
      await this.notifications.notify(tenant, asker.id, {
        event: "meeting.requested",
        source: { type: MEETING_SOURCE, id: meeting.id },
        version: "request",
        to: [{ kind: "user", id: asked.id, name: asked.name, email: asked.email }],
        inApp: [{ userId: asked.id, title: `${asker.name} asked to meet: ${meeting.title}`, href: MEETINGS_HREF }],
        values: {
          "actor.name": asker.name,
          "meeting.title": meeting.title,
          "meeting.when": meetingWhenText(meeting.start),
        },
        restricted: meeting.private,
      });
    } catch {
      this.logger.warn("A meeting was requested, but the colleague could not be told.");
    }
  }
}
