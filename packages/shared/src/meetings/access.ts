import type { PermissionKey } from "../permissions/catalog";
import type { DataScope } from "../permissions/roles";
import type { Attendee, Meeting } from "../types";

/** Who is looking at a meeting, as the meeting rules need it: an engine `Access` plus the user id. */
export interface MeetingViewer {
  userId: string;
  permissions: ReadonlySet<PermissionKey>;
  dataScope: DataScope;
}

/** Whether two guest rows are the same guest: same kind and same id. */
export function sameAttendee(a: Pick<Attendee, "kind" | "id">, b: Pick<Attendee, "kind" | "id">): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** The meeting's guest row for a staff member, or undefined when they are not a guest. The kind is checked, so a customer id that equals a user id never counts. */
export function staffGuestOf(meeting: Pick<Meeting, "attendees">, userId: string): Attendee | undefined {
  return meeting.attendees.find((a) => a.kind === "staff" && a.id === userId);
}

/** Whether this person organises the meeting. */
export function isOrganiser(meeting: Pick<Meeting, "ownerUserId">, userId: string): boolean {
  return meeting.ownerUserId === userId;
}

/** Whether this person is on the meeting: its organiser or a staff guest (`attendees` holds the live guests only). */
export function isOnMeeting(meeting: Pick<Meeting, "ownerUserId" | "attendees">, userId: string): boolean {
  return isOrganiser(meeting, userId) || staffGuestOf(meeting, userId) !== undefined;
}

/**
 * Whether a viewer may see a meeting (meetings.md "Who sees which meeting"). It needs
 * `meetings.meeting.view`. The organiser and staff guests always see it. Nobody else sees a private
 * meeting, the Owner included (spec line 51). Otherwise own scope sees only meetings it is on, and
 * branch or all scope sees the rest: meetings have no branch, so branch scope does not narrow it
 * (ADR 0051 "Access").
 */
export function seesMeeting(viewer: MeetingViewer, meeting: Meeting): boolean {
  if (!viewer.permissions.has("meetings.meeting.view")) return false;
  if (isOnMeeting(meeting, viewer.userId)) return true;
  if (meeting.private) return false;
  return viewer.dataScope !== "own";
}

/**
 * Whether the viewer may read every customer, supplier and person at one on the meeting
 * (`seesParty` is the API's check of each record's own permission and scope). Staff and email
 * guests always pass.
 */
export function seesEveryLinkedGuest(
  meeting: Pick<Meeting, "attendees">,
  seesParty: (attendee: Attendee) => boolean,
): boolean {
  return meeting.attendees.every((attendee) => !isLinkedParty(attendee) || seesParty(attendee));
}

/**
 * Whether a viewer may change a meeting: edit details, cancel it, remove a guest (ADR 0051 "Who may
 * change a meeting", safer than meetings.md line 53, which lets anyone with edit who sees it). It
 * needs `meetings.meeting.edit` and sight of the meeting, then:
 * - sight of every linked guest (`seesEveryLinkedGuest`), the organiser included. Every change
 *   emails the guests with the changer as the Outbox actor, and the Outbox shows its actor each row
 *   whole, with the guest's name, address and calendar file. So someone who reads a customer or
 *   supplier on the meeting only as "Customer" or "Supplier" can't change it (CLAUDE.md rule 3);
 * - and being its organiser, or holding a scope wider than own on a meeting that is not private. So
 *   an own-scope Sales guest can't change a colleague's meeting, and a private meeting is changed
 *   only by the person who set it up.
 */
export function canChangeMeeting(
  viewer: MeetingViewer,
  meeting: Meeting,
  seesParty: (attendee: Attendee) => boolean,
): boolean {
  if (!viewer.permissions.has("meetings.meeting.edit") || !seesMeeting(viewer, meeting)) return false;
  if (!seesEveryLinkedGuest(meeting, seesParty)) return false;
  if (isOrganiser(meeting, viewer.userId)) return true;
  return viewer.dataScope !== "own" && !meeting.private;
}

/**
 * Whether a viewer may accept or decline a guest's proposed time (meetings.md "Propose a new time";
 * ADR 0051 "Part 2"): the organiser, and only when they may change the meeting. The spec's action
 * checks `meetings.meeting.edit` only and leaves the organiser rule to the screen ("Permissions and
 * answers"); the server enforces both, so a colleague who may change the meeting can't decide a
 * proposal they were never shown (`meetingForViewer` gives proposals to the organiser only).
 */
export function canDecideProposal(
  viewer: MeetingViewer,
  meeting: Meeting,
  seesParty: (attendee: Attendee) => boolean,
): boolean {
  return isOrganiser(meeting, viewer.userId) && canChangeMeeting(viewer, meeting, seesParty);
}

/**
 * Whether a viewer reads other guests' addresses, the organiser's included, and a hidden guest list:
 * the organiser and anyone who may change the meeting (ADR 0051 "What a viewer sees", narrower than
 * meetings.md line 55). The calendar file's ORGANIZER address follows the same rule, so the file
 * never gives a reader an address the meeting itself hides from them.
 */
export function seesGuestAddresses(
  viewer: MeetingViewer,
  meeting: Meeting,
  seesParty: (attendee: Attendee) => boolean,
): boolean {
  return isOrganiser(meeting, viewer.userId) || canChangeMeeting(viewer, meeting, seesParty);
}

/** What a guest linked to a record the viewer can't see is shown as (ADR 0051 "What a viewer sees"). */
export const HIDDEN_PARTY_NAME: Readonly<Record<Exclude<Attendee["kind"], "staff" | "external">, string>> = {
  customer: "Customer",
  supplier: "Supplier",
  "customer-contact": "Customer contact",
  "supplier-contact": "Supplier contact",
};

/** What a guest added by email is called for a viewer who may not see addresses, when their name is one. */
export const EMAIL_GUEST_NAME = "Email guest";

/** Whether a guest is linked to a customer, a supplier or a person at one. */
export function isLinkedParty(attendee: Pick<Attendee, "kind">): attendee is Attendee & {
  kind: keyof typeof HIDDEN_PARTY_NAME;
} {
  return attendee.kind in HIDDEN_PARTY_NAME;
}

/**
 * A meeting as one viewer may read it (ADR 0051 "What a viewer sees", narrower than meetings.md line
 * 55). Call it only for a meeting `seesMeeting` allows.
 * - The organiser, and anyone who may change the meeting, get every guest with their address.
 * - Anyone else gets no addresses but their own; an email guest whose name is an address reads
 *   "Email guest". With a hidden guest list they get only their own row.
 * - Reply notes and proposals of other guests are left out for everyone but the organiser, who
 *   decides proposals.
 * - A guest linked to a customer, supplier or contact the viewer can't see (`seesParty` is the
 *   API's check of that record's own permission and scope) reads "Customer" and so on, with no
 *   address, for every viewer, the organiser included.
 */
export function meetingForViewer(
  meeting: Meeting,
  viewer: MeetingViewer,
  seesParty: (attendee: Attendee) => boolean,
): Meeting {
  const organiser = isOrganiser(meeting, viewer.userId);
  const manages = seesGuestAddresses(viewer, meeting, seesParty);
  const own = (a: Attendee) => a.kind === "staff" && a.id === viewer.userId;
  const listed = manages || !meeting.hideGuestList ? meeting.attendees : meeting.attendees.filter(own);
  const attendees = listed.map((a): Attendee => {
    const mine = own(a);
    const hiddenParty = isLinkedParty(a) && !seesParty(a);
    const showEmail = (manages || mine) && !hiddenParty;
    const name = hiddenParty
      ? HIDDEN_PARTY_NAME[a.kind]
      : !showEmail && a.kind === "external" && a.name.includes("@")
        ? EMAIL_GUEST_NAME
        : a.name;
    return {
      ...a,
      name,
      email: showEmail ? a.email : "",
      note: organiser || mine ? a.note : "",
      proposal: organiser || mine ? a.proposal : null,
    };
  });
  return { ...meeting, attendees };
}

/**
 * Whether a guest, as `meetingForViewer` shaped it, is one the reader can read. A linked guest the
 * reader can't read is always shown by kind (`HIDDEN_PARTY_NAME`) with no address. For screens,
 * which never get the server's `partySight`; it errs only towards "can't read" (a readable customer
 * literally named "Customer" with no address), so it never lets a screen offer a change the server
 * refuses (ADR 0051 "Part 3").
 */
export function shownParty(attendee: Attendee): boolean {
  return !isLinkedParty(attendee) || !(attendee.name === HIDDEN_PARTY_NAME[attendee.kind] && attendee.email === "");
}

/**
 * Whether the shaped meeting shows the organiser's address. For a reader who is not the organiser,
 * `meetingForViewer` shows it exactly when the server found they may change the meeting
 * (`seesGuestAddresses`); a hidden list without that leaves the organiser's row out entirely, and a
 * missing row or a stored organiser with no address reads as "not shown", so the rule fails closed.
 */
export function organiserAddressShown(shown: Meeting): boolean {
  return (staffGuestOf(shown, shown.ownerUserId)?.email ?? "") !== "";
}

/**
 * Whether a screen may offer a change of a meeting it holds only as `meetingForViewer` shaped it
 * (drag, resize, Reschedule, Edit details, Cancel meeting, Remove; ADR 0051 "Part 3"). It never
 * offers what `canChangeMeeting` on the stored meeting refuses:
 * - the organiser: `canChangeMeeting` with `shownParty`, since the organiser always gets every guest
 *   and a guest they can't read is shown by kind with no address;
 * - anyone else: their own keys and scope (`canChangeMeeting` with every guest readable), and the
 *   server's own answer, the organiser's address on the list (`organiserAddressShown`).
 * Why the second holds: for a non-organiser `meetingForViewer` sets `manages` to
 * `canChangeMeeting(viewer, stored, sight)`. With `manages` the list is whole and the organiser's
 * staff row, never a hidden party, keeps its address; without it that address is blanked, or the row
 * is filtered out under a hidden list. So the organiser's address is shown exactly when the server
 * would allow the change, given a stored organiser address, which every control user has.
 */
export function changeableAsShown(viewer: MeetingViewer, shown: Meeting): boolean {
  if (isOrganiser(shown, viewer.userId)) return canChangeMeeting(viewer, shown, shownParty);
  return canChangeMeeting(viewer, shown, () => true) && organiserAddressShown(shown);
}

/**
 * Whether a screen may offer Accept time and Decline time on a shaped meeting: the organiser, when
 * `changeableAsShown` allows it, as `canDecideProposal` does on the stored meeting (ADR 0051 "Part 3").
 */
export function decidableAsShown(viewer: MeetingViewer, shown: Meeting): boolean {
  return isOrganiser(shown, viewer.userId) && changeableAsShown(viewer, shown);
}

/** The words the API and the demo refuse meetings actions with, kept in one place (ADR 0051 "Part 3"). */
export const MEETING_REFUSALS = {
  notOrganiser: "Only the organiser can change this meeting.",
  cantSeeEveryGuest: "Only someone who can see every guest on this meeting can change it.",
  organiserDecides: "Only the organiser can decide a proposed time.",
  notAGuest: "Only a guest on this meeting can answer it.",
  chooseColleague: "Choose who to meet with.",
  invitesOff: "Guests can't be invited while meeting invites are switched off.",
  zoneUnsupported:
    "Meetings can be booked only in a US time zone, and this company's time zone is not one of them yet.",
} as const;

/**
 * Why a reader may not change a meeting, or null when `canChangeMeeting` allows it (ADR 0051 "Who
 * may change a meeting"): guest sight when that is all that is missing, since the change would email
 * a guest the reader can't read with them as its Outbox actor; the organiser rule otherwise.
 */
export function changeRefusal(
  viewer: MeetingViewer,
  meeting: Meeting,
  seesParty: (attendee: Attendee) => boolean,
): string | null {
  if (canChangeMeeting(viewer, meeting, seesParty)) return null;
  const onlySight = !seesEveryLinkedGuest(meeting, seesParty) && canChangeMeeting(viewer, meeting, () => true);
  return onlySight ? MEETING_REFUSALS.cantSeeEveryGuest : MEETING_REFUSALS.notOrganiser;
}
