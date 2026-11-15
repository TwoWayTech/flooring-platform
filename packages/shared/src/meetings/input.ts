import { recurrenceProblem } from "../calendar/ics";
import { zonedToInstant, type LocalTimeProblem } from "../calendar/zones";
import type { Attendee, Meeting, MeetingProposal, MeetingSettings } from "../types";
import { GUEST_EMAIL_MAX, validGuestEmail } from "./email";

/**
 * Input and volume limits for meetings (ADR 0051 "Input limits" and "Volume limits"; meetings.md
 * sets none of these, so each is a blueprint-delta row). They bound what one person can put into a
 * calendar file or send to addresses outside the company.
 */
export const MEETING_LIMITS = {
  titleMax: 200,
  locationMax: 200,
  notesMax: 4000,
  guestNameMax: 100,
  replyNoteMax: 500,
  emailMax: GUEST_EMAIL_MAX,
  /** Length in minutes, on create, edit and proposals (the spec checks 15 only on a move, rule 5). */
  durationMin: 15,
  durationMax: 1440,
  /** Guests other than the organiser. */
  guestsMax: 50,
  /** Guests added by an address that belongs to nobody in the company. */
  emailGuestsMax: 20,
  /** New outside addresses one person may invite in one company day, across all meetings. */
  emailGuestsPerDay: 50,
} as const;

/** The reminder choices the New meeting form offers (meetings.md "Schedule a meeting", step 4). */
export const REMINDER_MINUTES: readonly number[] = [10, 15, 30, 60];

/** The repeat choices (meetings.md "Meeting"). */
export const MEETING_RECURRENCES: readonly Meeting["recurrence"][] = ["none", "weekly", "biweekly", "monthly"];

/**
 * Settings → Meetings when a company has none stored (ADR 0051 "Deferred"): the safest choices,
 * because the API does not offer the settings screen yet. Proposals are off and guest lists hidden;
 * new guests are never saved as contacts or leads.
 */
export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  defaultReminderMin: 15,
  newGuestHandling: "none",
  allowProposals: false,
  hideGuestList: true,
};

/** Line breaks and tabs are allowed in notes; every other control character is refused. */
const CONTROL_IN_NOTES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
/** One-line fields (title, place, a name) take no control character at all: they reach email subjects. */
const CONTROL_IN_LINE = /[\u0000-\u001f\u007f-\u009f]/;

/** What a person is told when a time can't be used. */
function timeProblemText(problem: LocalTimeProblem): string {
  if (problem === "nonexistent")
    return "That time doesn't exist on the clock: the clocks go forward then. Choose another time.";
  if (problem === "unknown_zone") return "This company's time zone can't be used for meetings.";
  return "Enter a date and a start time.";
}

/**
 * Why a start can't be used in the meeting's zone, or null (ADR 0051 "Time zones"): it must be a
 * real local date-time, and one the clock shows; a time skipped by the spring change is refused.
 */
export function startProblem(start: string, zone: string): string | null {
  const placed = zonedToInstant(start, zone);
  return placed.problem ? timeProblemText(placed.problem) : null;
}

/** Why a length in minutes can't be used, or null. */
export function durationProblem(durationMin: number): string | null {
  return Number.isInteger(durationMin) &&
    durationMin >= MEETING_LIMITS.durationMin &&
    durationMin <= MEETING_LIMITS.durationMax
    ? null
    : "A meeting lasts from 15 minutes to 24 hours, in whole minutes.";
}

/** Why a one-line text can't be saved, or null: within its length and free of control characters. */
function lineProblem(label: string, value: string, max: number): string | null {
  if (CONTROL_IN_LINE.test(value)) return `${label} can't contain line breaks or control characters.`;
  if (Array.from(value).length > max) return `${label} is at most ${max} characters.`;
  return null;
}

/** Why a note can't be saved, or null: within its length, with no control characters but line breaks and tabs. */
function noteProblem(label: string, value: string, max: number): string | null {
  if (CONTROL_IN_NOTES.test(value)) return `${label} can't contain control characters.`;
  if (Array.from(value).length > max) return `${label} is at most ${max} characters.`;
  return null;
}

/** The fields of a meeting a person types, as create and edit receive them. */
export type MeetingFields = Pick<
  Meeting,
  "title" | "start" | "durationMin" | "location" | "notes" | "reminderMin" | "recurrence"
>;

/**
 * Why these meeting fields can't be saved, or null (meetings.md "Schedule a meeting" step 5 and
 * rule 3; ADR 0051 "Input limits" and "Time zones"). Only the fields given are checked, so an edit
 * passes the ones it changes; `recurrence` is the meeting's own on an edit. The monthly start
 * limit is checked only with a start, so a title edit on the seeded day-30 safety talk still works.
 */
export function meetingFieldsProblem(
  fields: Partial<MeetingFields>,
  context: { zone: string; recurrence: Meeting["recurrence"] },
): string | null {
  if (fields.title !== undefined) {
    if (!fields.title.trim()) return "Give the meeting a title.";
    const problem = lineProblem("A title", fields.title, MEETING_LIMITS.titleMax);
    if (problem) return problem;
  }
  if (fields.recurrence !== undefined && !MEETING_RECURRENCES.includes(fields.recurrence))
    return "Choose how the meeting repeats.";
  if (fields.start !== undefined) {
    const problem =
      startProblem(fields.start, context.zone) ??
      recurrenceProblem(fields.start, fields.recurrence ?? context.recurrence);
    if (problem) return problem;
  }
  if (fields.durationMin !== undefined) {
    const problem = durationProblem(fields.durationMin);
    if (problem) return problem;
  }
  if (fields.reminderMin !== undefined && !REMINDER_MINUTES.includes(fields.reminderMin))
    return "Choose a reminder of 10, 15, 30 or 60 minutes.";
  if (fields.location !== undefined) {
    const problem = lineProblem("A place", fields.location, MEETING_LIMITS.locationMax);
    if (problem) return problem;
  }
  if (fields.notes !== undefined) return noteProblem("Notes", fields.notes, MEETING_LIMITS.notesMax);
  return null;
}

/** Someone added to a meeting by address, as typed. */
export interface NewGuestInput {
  email: string;
  name: string;
}

/** Why a guest added by address can't be invited, or null (meetings.md rule 12, made stricter in ADR 0051). */
export function newGuestProblem(guest: NewGuestInput): string | null {
  if (!validGuestEmail(guest.email.trim())) return `"${guest.email.slice(0, 60)}" is not a valid email address.`;
  return lineProblem("A guest's name", guest.name, MEETING_LIMITS.guestNameMax);
}

/**
 * Why a meeting has too many guests, or null (ADR 0051 "Volume limits"): at most 50 guests besides
 * the organiser, and at most 20 of them added by an address that belongs to nobody in the company.
 */
export function guestLimitProblem(counts: { guests: number; emailGuests: number }): string | null {
  if (counts.guests > MEETING_LIMITS.guestsMax) return `A meeting can have at most ${MEETING_LIMITS.guestsMax} guests.`;
  if (counts.emailGuests > MEETING_LIMITS.emailGuestsMax)
    return `A meeting can have at most ${MEETING_LIMITS.emailGuestsMax} guests from outside the company.`;
  return null;
}

/**
 * Why one person can't invite these outside addresses today, or null (ADR 0051 "Volume limits"): at
 * most 50 new outside addresses a company day across all their meetings, so the invite system can't
 * be used to mail strangers at volume. `alreadyToday` counts the addresses they invited earlier today.
 */
export function dailyInviteProblem(alreadyToday: number, adding: number): string | null {
  return adding > 0 && alreadyToday + adding > MEETING_LIMITS.emailGuestsPerDay
    ? `You can invite at most ${MEETING_LIMITS.emailGuestsPerDay} people from outside the company a day. Try again tomorrow.`
    : null;
}

/** The answers a guest may give; "No reply yet" is a state, not an answer (ADR 0051). */
export const REPLY_ANSWERS: readonly Attendee["partStat"][] = ["accepted", "tentative", "declined"];

/** A guest's answer as it arrives, with a proposed time when there is one. */
export interface MeetingReplyInput {
  partStat: string;
  note: string;
  proposal: Omit<MeetingProposal, "status"> | null;
}

/**
 * Why a proposed time can't be sent, or null (meetings.md rule 8; ADR 0051): the meeting must take
 * proposals and be a one-off, and the time must exist in its zone, last 15 minutes to 24 hours and
 * carry a short note.
 */
export function proposalProblem(
  meeting: Pick<Meeting, "allowProposals" | "recurrence" | "timeZone">,
  proposal: Omit<MeetingProposal, "status">,
): string | null {
  if (!meeting.allowProposals || meeting.recurrence !== "none") return "This meeting does not take proposed times.";
  return (
    startProblem(proposal.start, meeting.timeZone) ??
    durationProblem(proposal.durationMin) ??
    noteProblem("A note", proposal.note, MEETING_LIMITS.replyNoteMax)
  );
}

/**
 * Why a guest's answer can't be recorded, or null (meetings.md "Answer" and rule 8; ADR 0051). The
 * meeting must not be cancelled, the answer is Accept, Maybe or Decline, the note is short, and a
 * proposal follows `proposalProblem`. The caller has already found the guest's own row.
 */
export function replyProblem(meeting: Meeting, reply: MeetingReplyInput): string | null {
  if (meeting.status === "cancelled") return "This meeting was cancelled.";
  if (!(REPLY_ANSWERS as readonly string[]).includes(reply.partStat)) return "Answer Accept, Maybe or Decline.";
  return (
    noteProblem("A note", reply.note, MEETING_LIMITS.replyNoteMax) ??
    (reply.proposal ? proposalProblem(meeting, reply.proposal) : null)
  );
}

/** A request's fixed length and place (meetings.md "Request a meeting"): the server sets them, whatever is sent. */
export const MEETING_REQUEST_DEFAULTS = { durationMin: 30, location: "To be agreed" } as const;

/** What a person types to ask a colleague to meet. */
export interface MeetingRequestFields {
  title: string;
  start: string;
  note: string;
}

/** Why a request can't be sent, or null (meetings.md "Request a meeting"; ADR 0051 "Input limits"). */
export function meetingRequestProblem(input: MeetingRequestFields, zone: string): string | null {
  if (!input.title.trim()) return "Say what the meeting is about.";
  return (
    lineProblem("A title", input.title, MEETING_LIMITS.titleMax) ??
    startProblem(input.start, zone) ??
    noteProblem("A note", input.note, MEETING_LIMITS.notesMax)
  );
}
