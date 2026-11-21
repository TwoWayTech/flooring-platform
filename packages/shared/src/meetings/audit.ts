import type { Attendee, Meeting } from "../types";
import { EMAIL_GUEST_NAME, HIDDEN_PARTY_NAME } from "./access";

/**
 * The audit actions of part 2 (meetings.md "Events and audit entries"; ADR 0051 "Part 2"). Undo reads
 * a meeting's last entry and matches on these words, so they are named once here. "Split meeting
 * series", "Removed split meeting series" and "Declined proposed time" are new: a split inserts a
 * business record and an undo deletes one (CLAUDE.md rule 10), and a decline sends an email.
 * "Changed meeting length" is a move that keeps the occurrence's start and changes only its length
 * (a resize; click-through #44), so the log says what happened. It holds the same move record.
 */
export const MEETING_AUDIT_ACTIONS = {
  moved: "Moved meeting",
  resized: "Changed meeting length",
  split: "Split meeting series",
  undone: "Undid meeting move",
  splitRemoved: "Removed split meeting series",
  proposalAccepted: "Accepted proposed time",
  proposalDeclined: "Declined proposed time",
} as const;

/** Whether an audit action is a move's own entry ("Moved meeting" or "Changed meeting length"), the entries undo reads back. */
export function isMoveAuditAction(action: string): boolean {
  return action === MEETING_AUDIT_ACTIONS.moved || action === MEETING_AUDIT_ACTIONS.resized;
}

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
