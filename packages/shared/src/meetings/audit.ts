import type { Attendee, Meeting } from "../types";
import { EMAIL_GUEST_NAME, HIDDEN_PARTY_NAME } from "./access";

/** What the audit log calls a private meeting, so its subject never reaches readers of the log (ADR 0051 "Audit"). */
export const PRIVATE_MEETING_LABEL = "Private meeting";

/** The audit target of a meeting (meetings.md "Events and audit entries"): its title, or "Private meeting". */
export function meetingAuditTarget(meeting: Pick<Meeting, "title" | "private">): string {
  return meeting.private ? PRIVATE_MEETING_LABEL : meeting.title;
}

/**
 * How an audit entry's before or after names a guest (ADR 0051 "Audit"; safer than meetings.md,
 * which writes the name, and an email guest's name defaults to their address). It is never an
 * address: an email guest is "Email guest", and on a private meeting every person is named only by
 * kind, so holders of `settings.audit.view` don't learn who is in a private HR meeting.
 */
export function guestAuditName(guest: Pick<Attendee, "kind" | "name">, meeting: Pick<Meeting, "private">): string {
  if (guest.kind === "external") return EMAIL_GUEST_NAME;
  if (!meeting.private) return guest.name;
  return guest.kind === "staff" ? "Colleague" : HIDDEN_PARTY_NAME[guest.kind];
}
