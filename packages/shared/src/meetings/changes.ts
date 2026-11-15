import type { Attendee, Meeting, MeetingSettings } from "../types";
import { isOrganiser, sameAttendee } from "./access";
import { meetingFieldsProblem } from "./input";

/**
 * The status moves a meeting may make (meetings.md "Meeting.status"): a request is tentative until
 * its guest answers or it is cancelled, a meeting is confirmed until cancelled, and a cancelled
 * meeting stays cancelled.
 */
export const MEETING_STATUS_NEXT: Readonly<Record<Meeting["status"], readonly Meeting["status"][]>> = {
  tentative: ["confirmed", "cancelled"],
  confirmed: ["cancelled"],
  cancelled: [],
};

/** Whether a meeting may move from one status to another (meetings.md "Meeting.status"). */
export function statusMoveAllowed(from: Meeting["status"], to: Meeting["status"]): boolean {
  return MEETING_STATUS_NEXT[from].includes(to);
}

/** The fields an edit may change (meetings.md rule 6, the patch type). */
export type MeetingPatch = Partial<
  Pick<Meeting, "title" | "notes" | "location" | "start" | "durationMin" | "reminderMin">
>;

const PATCH_KEYS = ["title", "notes", "location", "start", "durationMin", "reminderMin"] as const;

/**
 * The patchable fields whose change is significant (meetings.md rule 6): start, length and place.
 * The rest of the spec's list (recurrence, until, status) can't be patched.
 */
const SIGNIFICANT_KEYS: ReadonlySet<keyof MeetingPatch> = new Set(["start", "durationMin", "location"]);

/** The fields a patch really changes; a field sent with its current value is no change. */
export function changedFields(before: Meeting, patch: MeetingPatch): (keyof MeetingPatch)[] {
  return PATCH_KEYS.filter((key) => patch[key] !== undefined && patch[key] !== before[key]);
}

/**
 * Why an edit can't be saved, or null (meetings.md `updateMeeting`; ADR 0051). A cancelled meeting is
 * refused. Only the changed fields are checked, so a new start must exist in the meeting's zone and
 * pass the monthly limit, while a title edit on a day-30 monthly series still works. A series with
 * occurrences moved on their own refuses a new start or length until those can be sent again with
 * it (ADR 0051 "Exceptions", ADR 0021: guests' calendars would keep them under old ids).
 */
export function editProblem(before: Meeting, patch: MeetingPatch): string | null {
  if (before.status === "cancelled") return "This meeting was cancelled.";
  const changed = changedFields(before, patch);
  const pick = <K extends keyof MeetingPatch>(key: K) => (changed.includes(key) ? patch[key] : undefined);
  const timing = changed.includes("start") || changed.includes("durationMin");
  if (timing && before.recurrence !== "none" && before.exceptions.length > 0)
    return "Some occurrences of this series were changed on their own, so its time can't be edited yet.";
  return meetingFieldsProblem(
    {
      title: pick("title"),
      notes: pick("notes"),
      location: pick("location"),
      start: pick("start"),
      durationMin: pick("durationMin"),
      reminderMin: pick("reminderMin"),
    },
    { zone: before.timeZone, recurrence: before.recurrence },
  );
}

/** A guest asked again after a significant change: no answer, no reply time, no proposal (meetings.md rule 6). */
function askedAgain(attendee: Attendee): Attendee {
  return { ...attendee, partStat: "needs-action", respondedAt: null, proposal: null };
}

/** An edit as it is saved: the meeting after it, the fields it changed and whether it was significant. */
export interface MeetingEdit {
  meeting: Meeting;
  changed: (keyof MeetingPatch)[];
  significant: boolean;
}

/**
 * Applies an edit (meetings.md rule 6 and the sends table): a change of start, length or place
 * raises SEQUENCE, sets rescheduleSequence to it and asks every guest again, the organiser
 * included; a title, notes or reminder change keeps both and every answer. Check `editProblem`
 * first; with no changed field the meeting comes back as it was.
 */
export function editedMeeting(before: Meeting, patch: MeetingPatch): MeetingEdit {
  const changed = changedFields(before, patch);
  const significant = changed.some((key) => SIGNIFICANT_KEYS.has(key));
  const sequence = before.sequence + (significant ? 1 : 0);
  return {
    changed,
    significant,
    meeting: {
      ...before,
      title: patch.title ?? before.title,
      notes: patch.notes ?? before.notes,
      location: patch.location ?? before.location,
      start: patch.start ?? before.start,
      durationMin: patch.durationMin ?? before.durationMin,
      reminderMin: patch.reminderMin ?? before.reminderMin,
      sequence,
      rescheduleSequence: significant ? sequence : before.rescheduleSequence,
      attendees: significant ? before.attendees.map(askedAgain) : before.attendees,
    },
  };
}

/** Why a meeting can't be cancelled, or null: only once (ADR 0051; the demo had no guard). */
export function cancelProblem(meeting: Pick<Meeting, "status">): string | null {
  return statusMoveAllowed(meeting.status, "cancelled") ? null : "This meeting was already cancelled.";
}

/** A meeting cancelled (meetings.md sends table): SEQUENCE + 1, rescheduleSequence set to it, answers left. */
export function cancelledMeeting(meeting: Meeting): Meeting {
  const sequence = meeting.sequence + 1;
  return { ...meeting, status: "cancelled", sequence, rescheduleSequence: sequence };
}

/**
 * Why a guest can't be removed, or null (ADR 0051): not from a cancelled meeting, and never the
 * organiser. The caller has already found the guest on this meeting (404 otherwise).
 */
export function removeGuestProblem(meeting: Meeting, guest: Attendee): string | null {
  if (meeting.status === "cancelled") return "This meeting was cancelled.";
  if (guest.kind === "staff" && isOrganiser(meeting, guest.id))
    return "The organiser can't be removed from the meeting.";
  return null;
}

/** A meeting without one guest (meetings.md sends table): SEQUENCE + 1, rescheduleSequence and other answers kept. */
export function withoutGuest(meeting: Meeting, guest: Attendee): Meeting {
  return {
    ...meeting,
    sequence: meeting.sequence + 1,
    attendees: meeting.attendees.filter((a) => !sameAttendee(a, guest)),
  };
}

/**
 * A guest as the server adds them (ADR 0051 "Owned by the server", critic B4): only who they are
 * comes in, resolved by the caller from its own records; the role, answer, reply time, note and
 * proposal start blank whatever a client sent. The organiser joins as accepted (meetings.md
 * "Attendee.partStat").
 */
export function newAttendee(party: Pick<Attendee, "kind" | "id" | "name" | "email">, organiser = false): Attendee {
  return {
    kind: party.kind,
    id: party.id,
    name: party.name,
    email: party.email,
    role: "required",
    partStat: organiser ? "accepted" : "needs-action",
    respondedAt: null,
    respondedSequence: null,
    note: "",
    proposal: null,
  };
}

/** How a new meeting shows its guests and whether it takes proposed times. */
export interface ScheduleFlags {
  hideGuestList: boolean;
  allowProposals: boolean;
}

/**
 * The guest-list and proposal flags of a new meeting (meetings.md rule 9; ADR 0051). The list is
 * hidden when asked, when the meeting is private, and when any guest is not staff: customers,
 * suppliers and their people are outside the company too, so they don't get each other's
 * addresses (the spec hides it only for email guests). Proposals follow Settings → Meetings, and
 * only when the organiser holds `meetings.meeting.edit`, because only they can decide one.
 */
export function scheduleFlags(
  input: { private: boolean; hideGuestList: boolean },
  guests: readonly Pick<Attendee, "kind">[],
  settings: Pick<MeetingSettings, "allowProposals">,
  organiserCanEdit: boolean,
): ScheduleFlags {
  return {
    hideGuestList: input.hideGuestList || input.private || guests.some((g) => g.kind !== "staff"),
    allowProposals: settings.allowProposals && organiserCanEdit,
  };
}

/**
 * The flags of a request (meetings.md "Request a meeting"): the list is hidden when it is private,
 * and it takes proposals, as the spec says, only when the person asking can decide them (ADR 0051).
 */
export function requestFlags(isPrivate: boolean, organiserCanEdit: boolean): ScheduleFlags {
  return { hideGuestList: isPrivate, allowProposals: organiserCanEdit };
}
