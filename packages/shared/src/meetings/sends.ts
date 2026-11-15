import { MEETINGS_PRODID, type IcsInput } from "../calendar/ics";
import type { Attendee, Meeting, OutboxRecipient } from "../types";
import { isOrganiser } from "./access";
import { validGuestEmail } from "./email";

/** The Part 1 actions that send calendar files (meetings.md "What each action sends"). */
export type MeetingSendKind = "schedule" | "edit" | "cancel" | "remove";

/** The words `meeting.action` takes in an invite (meetings.md "Emails"). */
export type MeetingInviteAction = "Invitation" | "Updated" | "Cancelled" | "Removed" | "Proposal declined";

const ACTION: Record<MeetingSendKind, MeetingInviteAction> = {
  schedule: "Invitation",
  edit: "Updated",
  cancel: "Cancelled",
  remove: "Removed",
};

/** The Outbox recipient kind of each guest kind (meetings.md "Attendee", `RECIPIENT_KIND`). */
export const OUTBOX_RECIPIENT_KIND: Readonly<Record<Attendee["kind"], OutboxRecipient["kind"]>> = {
  staff: "user",
  customer: "customer",
  supplier: "supplier",
  "customer-contact": "customer_contact",
  "supplier-contact": "supplier_contact",
  external: "guest",
};

/** One invite to one guest: the calendar file it carries and the notice that goes with it. */
export interface MeetingSend {
  recipient: Attendee;
  method: "REQUEST" | "CANCEL";
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED" | undefined;
  /** The guests the file lists: only the recipient with a hidden list, and never one without a valid address. */
  listed: Attendee[];
  sequence: number;
  action: MeetingInviteAction;
  /** Staff guests also get an in-app note (meetings.md "Events and audit entries"). */
  inApp: boolean;
}

/** The STATUS a file carries for each action; a REQUEST is TENTATIVE while a request waits (ADR 0051 "Correct files"). */
function statusFor(kind: MeetingSendKind, meeting: Meeting): MeetingSend["status"] {
  if (kind === "remove") return undefined;
  if (kind === "cancel") return "CANCELLED";
  return meeting.status === "tentative" ? "TENTATIVE" : "CONFIRMED";
}

/**
 * The invites one action sends, one per guest (meetings.md "What each action sends", the Part 1
 * rows; ADR 0051). `meeting` is the meeting after the action.
 * - schedule: REQUEST at SEQUENCE 0 to every guest;
 * - edit: REQUEST "Updated" to every guest at the SEQUENCE after the edit (raised only when significant);
 * - cancel: CANCEL with STATUS:CANCELLED to every guest;
 * - remove: CANCEL with no STATUS to `removed` only, listing only them.
 * The organiser never gets one (rule 9's `sendToGuests`), and with `meetings.invites` off nothing
 * is sent at all. A REQUEST is never sent for a meeting that is already cancelled, so a schedule or
 * edit raced by a cancel can't put it back in anyone's calendar (review of PR #33).
 * Each file names only its recipient when the guest list is hidden, or when any guest is not staff,
 * whatever the stored flag says (ADR 0051 "Hidden guest list"; Summit's seeded meetings keep the
 * demo's open lists), so no file hands a colleague a customer's or a stranger's address.
 */
export function sendPlan(
  kind: MeetingSendKind,
  meeting: Meeting,
  opts: { invitesOn: boolean; removed?: Attendee },
): MeetingSend[] {
  if (!opts.invitesOn) return [];
  const method = kind === "cancel" || kind === "remove" ? "CANCEL" : "REQUEST";
  if (method === "REQUEST" && meeting.status === "cancelled") return [];
  const recipients = kind === "remove" ? (opts.removed ? [opts.removed] : []) : meeting.attendees;
  const onlyRecipient =
    meeting.hideGuestList || kind === "remove" || meeting.attendees.some((guest) => guest.kind !== "staff");
  return recipients
    .filter((guest) => !(guest.kind === "staff" && isOrganiser(meeting, guest.id)))
    .map((guest) => ({
      recipient: guest,
      method,
      status: statusFor(kind, meeting),
      listed: (onlyRecipient ? [guest] : meeting.attendees).filter((a) => validGuestEmail(a.email)),
      sequence: meeting.sequence,
      action: ACTION[kind],
      inApp: guest.kind === "staff",
    }));
}

/** How many emails an action sends, as the daily limits count them (ADR 0051 "Volume limits"). */
export interface MeetingEmailCount {
  /** To people outside the company: customers, suppliers, people at them and email guests. */
  outside: number;
  /** Every email, colleagues included. */
  total: number;
}

/** The emails that go to these recipients: one each, and every one that is not a colleague is outside. */
export function meetingEmailCount(recipients: readonly Pick<Attendee, "kind">[]): MeetingEmailCount {
  return { outside: recipients.filter((guest) => guest.kind !== "staff").length, total: recipients.length };
}

/** The calendar file of one send, as the real build writes it (product-neutral PRODID, ADR 0051). */
export function sendIcsInput(
  send: MeetingSend,
  meeting: Meeting,
  organizer: IcsInput["organizer"],
  stamp: Date,
): IcsInput {
  return {
    method: send.method,
    meeting,
    sequence: send.sequence,
    stamp,
    organizer,
    attendees: send.listed,
    status: send.status,
    prodId: MEETINGS_PRODID,
  };
}

/**
 * The Outbox version of one send (meetings.md rule 17, made exact in ADR 0051): SEQUENCE, method,
 * occurrence and the stamp in milliseconds, so two sends of the same SEQUENCE in one minute are two
 * rows, and a retry of the same send is one.
 */
export function inviteVersion(
  send: Pick<MeetingSend, "sequence" | "method"> & { recurrenceId?: string },
  stamp: Date,
): string {
  return `${send.sequence}-${send.method}-${send.recurrenceId ?? ""}-${stamp.getTime()}`;
}

/** "YYYY-MM-DD at HH:mm", the spec's `meeting.when` (meetings.md "Emails", `whenText`). */
export function meetingWhenText(start: string): string {
  return `${start.slice(0, 10)} at ${start.slice(11, 16)}`;
}

/** The longest attachment name before `.ics`. */
const FILE_NAME_MAX = 100;

/** The attachment's name (meetings.md "Emails"): the title with characters outside `[\w ]` removed, plus `.ics`. */
export function icsFileName(title: string): string {
  const base = title
    .replace(/[^\w ]+/g, "")
    .trim()
    .slice(0, FILE_NAME_MAX)
    .trim();
  return `${base || "meeting"}.ics`;
}

/** The template values of an invite (meetings.md "Emails" and rule 7: the SEQUENCE it was sent with). */
export function inviteValues(send: MeetingSend, meeting: Meeting, organizerName: string): Record<string, string> {
  return {
    "meeting.action": send.action,
    "meeting.title": meeting.title,
    "meeting.when": meetingWhenText(meeting.start),
    "meeting.location": meeting.location,
    "meeting.organiser": organizerName,
    "meeting.sequence": String(send.sequence),
  };
}
