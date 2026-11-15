import { format } from "date-fns";
import {
  DEMO_PRODID,
  exceptionResends,
  featureOn,
  icsFileName,
  inviteValues,
  inviteVersion,
  meetingIcs,
  meetingWhenText,
  nextReminder,
  OUTBOX_RECIPIENT_KIND,
  reminderRecipients,
  sendIcsInput,
  sendPlan,
  type Meeting,
  type MeetingSend,
} from "@workspace/shared";
import type { CompanyDb } from "./company-db";
import { notify } from "./notification-actions";
import type { ActionContext } from "./payment-actions";

/** Where a meeting's Outbox rows and in-app notes point. */
const MEETING_SOURCE = (meeting: Pick<Meeting, "id">) => ({ type: "meeting", id: meeting.id, href: "/meetings" });

/** The organiser as a calendar file names them, from their user record; a missing user gets no ORGANIZER line. */
export function organizerOf(db: CompanyDb, meeting: Pick<Meeting, "ownerUserId">): { name: string; email: string } {
  const owner = db.get("users", meeting.ownerUserId);
  return { name: owner?.name ?? "Organiser", email: owner?.email ?? "" };
}

/** Whether a colleague is still an active user, the only ones meetings write to (ADR 0051 "Colleagues who left"). */
export function activeColleague(db: CompanyDb, userId: string): boolean {
  return db.get("users", userId)?.status === "active";
}

/**
 * Writes one action's invites to the demo Outbox (meetings.md "What each action sends"; ADR 0051),
 * as the API's `MeetingSends` does from the shared `sendPlan`: one row and one calendar file per
 * send, with the shared template values, file name and Outbox version, and an in-app note for a
 * colleague. A colleague who left or was disabled is left out, since the email would carry the
 * company's titles, places and notes. The files carry the demo's PRODID (ADR 0021; ADR 0051 "File
 * hardening"), and a private meeting's rows are restricted.
 */
export function deliver(ctx: ActionContext, meeting: Meeting, sends: readonly MeetingSend[]): void {
  if (sends.length === 0) return;
  const organizer = organizerOf(ctx.db, meeting);
  const stamp = new Date();
  for (const send of sends) {
    const guest = send.recipient;
    if (guest.kind === "staff" && !activeColleague(ctx.db, guest.id)) continue;
    const text = meetingIcs({ ...sendIcsInput(send, meeting, organizer, stamp), prodId: DEMO_PRODID });
    notify(ctx, {
      key: "meeting.invite",
      source: MEETING_SOURCE(meeting),
      values: inviteValues(send, meeting, organizer.name),
      to: [{ kind: OUTBOX_RECIPIENT_KIND[guest.kind], id: guest.id, name: guest.name, email: guest.email }],
      attachments: [{ kind: "ics", fileName: icsFileName(meeting.title), text }],
      inApp: send.inApp ? [{ userId: guest.id, title: `${send.action}: ${meeting.title}` }] : undefined,
      version: inviteVersion(send, stamp),
      restricted: meeting.private,
    });
  }
}

/**
 * Re-syncs a meeting's reminder after a change (meetings.md rule 10; ADR 0051 "Reminders"), as the
 * API's `MeetingReminders.sync` does: every waiting reminder row of the meeting is cancelled, then,
 * while `meetings.invites` is on, the next one is raised from the meeting as it now stands
 * (`nextReminder`) for its staff guests but the organiser who are still active. A cancelled meeting
 * or a request still waiting gets none. The demo has no worker: `releaseScheduled` sends a row when
 * the company opens after its time, so `scheduledFor` is the browser-local stamp it compares with
 * the store's `now` (ADR 0051 "Part 3", B.6 item 5). Each set has its own version, so a re-sync is
 * never swallowed by a row it cancelled.
 */
export function syncReminder(ctx: ActionContext, meeting: Meeting): void {
  for (const row of ctx.db.list("outboxMessages")) {
    if (row.eventKey === "meeting.reminder" && row.sourceId === meeting.id && row.status === "scheduled")
      ctx.db.put("outboxMessages", { ...row, status: "cancelled" });
  }
  if (!featureOn("meetings.invites")) return;
  const reminder = nextReminder(meeting, new Date());
  const to = reminderRecipients(meeting).filter((guest) => activeColleague(ctx.db, guest.id));
  if (!reminder || to.length === 0) return;
  notify(ctx, {
    key: "meeting.reminder",
    source: MEETING_SOURCE(meeting),
    values: {
      "meeting.title": meeting.title,
      "meeting.when": meetingWhenText(reminder.occurrence.start),
      "meeting.location": meeting.location,
    },
    to: to.map((guest) => ({ kind: "user" as const, id: guest.id, name: guest.name, email: guest.email })),
    scheduledFor: format(reminder.scheduledFor, "yyyy-MM-dd'T'HH:mm"),
    version: `${meeting.sequence}-reminder-${reminder.occurrence.planned}-${Date.now()}`,
    restricted: meeting.private,
  });
}

/** The invites switch, which every send reads (CLAUDE.md rule 13). */
export function invitesOn(): boolean {
  return featureOn("meetings.invites");
}

/**
 * What a change of a whole series sends (meetings.md sends table: an edit, a series move, an undo):
 * an "Updated" REQUEST to every guest, and each surviving occurrence moved on its own again
 * (`exceptionResends`, ADR 0051 "Series exceptions sent again"), as the API's `resendExceptions`.
 */
export function seriesSends(meeting: Meeting, now: Date): MeetingSend[] {
  const series = sendPlan("edit", meeting, { invitesOn: invitesOn() });
  return [...series, ...exceptionResends(meeting, series, now)];
}
