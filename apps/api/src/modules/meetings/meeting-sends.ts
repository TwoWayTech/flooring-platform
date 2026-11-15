import { Inject, Injectable, Logger } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  exceptionResends,
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
  type MeetingSend,
  type MeetingSendKind,
  type OccurrenceTime,
  type ReplyOutcome,
} from "@workspace/shared";
import { CONTROL_DB } from "../../core/database/control-db";
import { NotificationService, type UnqueuedSend } from "../../core/notifications/notification.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { activeMembers, MEETING_SOURCE, organiserOf, type MeetingPerson } from "./meetings-common";

/** Where a meeting's in-app notes open. */
const MEETINGS_HREF = "/meetings";

/** What one action's invites are about, besides the meeting (shared `sendPlan` and `exceptionResends`). */
export interface InviteOptions {
  /** The one guest a removal or a declined proposal goes to. */
  only?: Attendee;
  /** The occurrence an "occurrence" send is about. */
  occurrence?: OccurrenceTime;
  /**
   * The series changed something its file carries (time, rule, title, place, notes or reminder), so
   * its surviving exceptions are sent again (ADR 0051 "Series exceptions sent again").
   */
  resendExceptions?: boolean;
}

/**
 * An action's invites as its own transaction worked them out (`MeetingSends.plan`): the meeting as
 * that transaction commits it, its committed `updated_at`, the organiser the files name, and one
 * send per guest who can still be written to.
 */
export interface PlannedInvites {
  meeting: Meeting;
  stamp: Date;
  organiser: { name: string; email: string };
  sends: MeetingSend[];
}

/**
 * The emails and in-app notes meetings raise through the notifications core (meetings.md "What
 * each action sends" and "Events and audit entries"; ADR 0051 "Invites"). What an action sends is
 * worked out inside its transaction, from the state it commits, so the daily limits count it and a
 * failed lookup undoes the change rather than leaving it half told. The rows are written after the
 * commit, one guest at a time with its own catch, so a failed send never undoes the change, never
 * stops the other guests' invites and never fails the request; a failure is logged without names
 * or addresses (CLAUDE.md rule 14).
 */
@Injectable()
export class MeetingSends {
  private readonly logger = new Logger("Meetings");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * One invite and one calendar file per guest for an action (shared `sendPlan`), worked out in the
   * action's transaction `tx` from the meeting as it commits it. The organiser never gets one, and
   * with `meetings.invites` off nothing goes. A colleague who left or was disabled is left out,
   * since the email would carry the company's titles, places and notes (ADR 0051 "Sends"). `stamp`
   * is the meeting's committed `updated_at`, so DTSTAMP follows commit order and the Outbox version
   * is exact to the millisecond (RFC 5546 section 2.1.5). With `resendExceptions`, every surviving
   * exception that has not ended by `stamp` gets its own copy of each series REQUEST.
   */
  async plan(
    tx: CompanyDb,
    kind: MeetingSendKind,
    meeting: Meeting,
    stamp: Date,
    options: InviteOptions = {},
  ): Promise<PlannedInvites> {
    const series = sendPlan(kind, meeting, {
      invitesOn: featureOn("meetings.invites"),
      only: options.only,
      occurrence: options.occurrence,
    });
    const sends = options.resendExceptions ? [...series, ...exceptionResends(meeting, series, stamp)] : series;
    if (sends.length === 0) return { meeting, stamp, organiser: { name: "", email: "" }, sends };
    // Each colleague is looked up once, however many exceptions are sent again to them.
    const staffIds = new Set(sends.filter((send) => send.recipient.kind === "staff").map((send) => send.recipient.id));
    const active = new Set((await activeMembers(tx, this.control.db, [...staffIds])).map((member) => member.id));
    return {
      meeting,
      stamp,
      organiser: await organiserOf(this.control.db, meeting.ownerUserId),
      sends: sends.filter((send) => send.recipient.kind !== "staff" || active.has(send.recipient.id)),
    };
  }

  /**
   * Writes the planned invites of one action to the Outbox, after the action committed: one plan
   * per meeting it changed (a split changes two). A private meeting's rows are restricted. Every
   * guest's row is written first, then the send jobs are queued once, stopping at the first failure
   * (`queueSends`), so a jobs outage costs the request one wait, not one per guest (final review of
   * PR #33); the rows left with no job wait for Retry. It never throws: each guest's row has its own
   * catch. Answers whether background jobs were found unavailable.
   */
  async invites(tenant: TenantContext, actorUserId: string, plans: readonly PlannedInvites[]): Promise<boolean> {
    const unqueued: UnqueuedSend[] = [];
    for (const planned of plans) unqueued.push(...(await this.written(tenant, actorUserId, planned)));
    return !(await this.notifications.queueSends(tenant, unqueued));
  }

  /** One plan's Outbox rows, each guest's with its own catch; answers the sends whose jobs still need queueing. */
  private async written(tenant: TenantContext, actorUserId: string, planned: PlannedInvites): Promise<UnqueuedSend[]> {
    const { meeting, stamp, organiser } = planned;
    const unqueued: UnqueuedSend[] = [];
    for (const send of planned.sends) {
      try {
        const text = meetingIcs(sendIcsInput(send, meeting, organiser, stamp));
        const guest = send.recipient;
        const written = await this.notifications.notify(
          tenant,
          actorUserId,
          {
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
          },
          { deferJobs: true },
        );
        unqueued.push(...written.unqueued);
      } catch {
        this.logger.warn("A meeting changed, but one guest's invite could not be written to the Outbox.");
      }
    }
    return unqueued;
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
      const [organiser] = await activeMembers(await this.tenancy.db(tenant), this.control.db, [meeting.ownerUserId]);
      if (!organiser) return;
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
