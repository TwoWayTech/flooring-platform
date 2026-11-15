import { MEETINGS_PRODID, type IcsInput } from "../calendar/ics";
import { zonedToInstantLenient } from "../calendar/zones";
import type { Attendee, Meeting, OutboxRecipient } from "../types";
import { isOrganiser } from "./access";
import { validGuestEmail } from "./email";

/**
 * The actions that send calendar files (meetings.md "What each action sends"): part 1's, plus an
 * occurrence moved on its own and a declined proposal (part 2). Moving a series, undoing a move and
 * accepting a proposal send as `edit`; the series an undo removes is told as `cancel`.
 */
export type MeetingSendKind = "schedule" | "edit" | "cancel" | "remove" | "occurrence" | "declineCounter";

/** The words `meeting.action` takes in an invite (meetings.md "Emails"). */
export type MeetingInviteAction = "Invitation" | "Updated" | "Cancelled" | "Removed" | "Proposal declined";

const ACTION: Record<MeetingSendKind, MeetingInviteAction> = {
  schedule: "Invitation",
  edit: "Updated",
  cancel: "Cancelled",
  remove: "Removed",
  occurrence: "Updated",
  declineCounter: "Proposal declined",
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

/** One occurrence of a series as its own invite names it: RECURRENCE-ID and the occurrence's own time and length. */
export interface OccurrenceTime {
  /** The date-time the series planned the occurrence for (RECURRENCE-ID). */
  recurrenceId: string;
  start: string;
  durationMin: number;
}

/** One invite to one guest: the calendar file it carries and the notice that goes with it. */
export interface MeetingSend {
  recipient: Attendee;
  method: "REQUEST" | "CANCEL" | "DECLINECOUNTER";
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED" | undefined;
  /** The guests the file lists: only the recipient with a hidden list, and never one without a valid address. */
  listed: Attendee[];
  sequence: number;
  action: MeetingInviteAction;
  /** Staff guests also get an in-app note (meetings.md "Events and audit entries"). */
  inApp: boolean;
  /** Set when the file is about one occurrence of a series (RFC 5545 RECURRENCE-ID). */
  recurrenceId?: string;
  /** The occurrence's own start and length, with `recurrenceId`. */
  start?: string;
  durationMin?: number;
}

/** The iTIP method of each action (RFC 5546 section 1.4). */
function methodFor(kind: MeetingSendKind): MeetingSend["method"] {
  if (kind === "cancel" || kind === "remove") return "CANCEL";
  return kind === "declineCounter" ? "DECLINECOUNTER" : "REQUEST";
}

/**
 * The STATUS a file carries for each action; a REQUEST is TENTATIVE while a request waits (ADR 0051
 * "Correct files"). A removal and a declined proposal carry none (meetings.md sends table).
 */
function statusFor(kind: MeetingSendKind, meeting: Meeting): MeetingSend["status"] {
  if (kind === "remove" || kind === "declineCounter") return undefined;
  if (kind === "cancel") return "CANCELLED";
  return meeting.status === "tentative" ? "TENTATIVE" : "CONFIRMED";
}

/**
 * The invites one action sends, one per guest (meetings.md "What each action sends"; ADR 0051).
 * `meeting` is the meeting after the action.
 * - schedule: REQUEST at SEQUENCE 0 to every guest;
 * - edit: REQUEST "Updated" to every guest at the SEQUENCE after the edit (raised only when
 *   significant); also a series move, an undo and an accepted proposal;
 * - occurrence: REQUEST "Updated" to every guest for one occurrence (`occurrence`), with its
 *   RECURRENCE-ID and its own time ("Move this event");
 * - cancel: CANCEL with STATUS:CANCELLED to every guest;
 * - remove: CANCEL with no STATUS to `only` (the removed guest), listing only them;
 * - declineCounter: DECLINECOUNTER with no STATUS to `only` (the proposer), listing only them.
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
  opts: { invitesOn: boolean; only?: Attendee; occurrence?: OccurrenceTime },
): MeetingSend[] {
  if (!opts.invitesOn) return [];
  const method = methodFor(kind);
  if (method !== "CANCEL" && meeting.status === "cancelled") return [];
  if (kind === "occurrence" && !opts.occurrence) return [];
  const toOne = kind === "remove" || kind === "declineCounter";
  const recipients = toOne ? (opts.only ? [opts.only] : []) : meeting.attendees;
  const onlyRecipient = meeting.hideGuestList || toOne || meeting.attendees.some((guest) => guest.kind !== "staff");
  const occurrence = kind === "occurrence" ? opts.occurrence : undefined;
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
      ...(occurrence ?? {}),
    }));
}

const MINUTE_MS = 60_000;

/**
 * The series' occurrences moved on their own, sent again after the series' time or rule changed
 * (ADR 0021 and 0051 "Part 2"; meetings.md "Differences from ADR 0021" lists them as not sent, and
 * this closes it). A calendar drops a series' overrides when its DTSTART, DTEND or RRULE changes, or
 * keeps them under RECURRENCE-IDs that no longer match, so each surviving exception gets one copy of
 * every series REQUEST, at the series' SEQUENCE, with its own RECURRENCE-ID (the planned time as
 * the series now has it) and its own time and length. Only exceptions whose occurrence has not ended
 * by `now` are sent, which bounds what guests receive; one marked cancelled is skipped (nothing
 * writes one yet). A CANCEL has no copies.
 */
export function exceptionResends(meeting: Meeting, seriesSends: readonly MeetingSend[], now: Date): MeetingSend[] {
  if (meeting.recurrence === "none") return [];
  const requests = seriesSends.filter((send) => send.method === "REQUEST" && send.recurrenceId === undefined);
  return meeting.exceptions.flatMap((exception) => {
    if (exception.cancelled) return [];
    const start = exception.start ?? exception.planned;
    const durationMin = exception.durationMin ?? meeting.durationMin;
    const startsAt = zonedToInstantLenient(start, meeting.timeZone);
    if (!startsAt || startsAt.getTime() + durationMin * MINUTE_MS <= now.getTime()) return [];
    return requests.map((send) => ({ ...send, recurrenceId: exception.planned, start, durationMin }));
  });
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
    recurrenceId: send.recurrenceId,
    start: send.start,
    durationMin: send.durationMin,
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

/**
 * The template values of an invite (meetings.md "Emails" and rule 7: the SEQUENCE it was sent with).
 * An invite about one occurrence gives that occurrence's own time.
 */
export function inviteValues(send: MeetingSend, meeting: Meeting, organizerName: string): Record<string, string> {
  return {
    "meeting.action": send.action,
    "meeting.title": meeting.title,
    "meeting.when": meetingWhenText(send.start ?? meeting.start),
    "meeting.location": meeting.location,
    "meeting.organiser": organizerName,
    "meeting.sequence": String(send.sequence),
  };
}
