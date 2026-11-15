import {
  changeableAsShown,
  decidableAsShown,
  featureOn,
  isOrganiser,
  staffGuestOf,
  type Meeting,
  type MeetingViewer,
  type OutboxMessage,
} from "@workspace/shared";

/** The meetings switches the screens read (docs/FEATURES.md), passed in so tests can turn them off. */
export interface MeetingSwitches {
  invites: boolean;
  requests: boolean;
}

/** The meetings switches as this build has them. */
export function meetingSwitches(): MeetingSwitches {
  return { invites: featureOn("meetings.invites"), requests: featureOn("meetings.requests") };
}

/** What the reader may do to one meeting on screen (ADR 0051 "Part 3"). The server decides every action again. */
export interface MeetingRights {
  /** Drag, resize, Reschedule, Edit details and Cancel meeting. */
  change: boolean;
  /** Remove a guest. */
  removeGuest: boolean;
  /** Accept time and Decline time on a guest's proposal. */
  decide: boolean;
  /** Accept, Maybe, Decline and Propose a new time, as a staff guest. */
  answer: boolean;
  /** The Attendees list. */
  seesGuests: boolean;
}

/**
 * What one meeting offers the reader, read from the meeting as the server shaped it for them
 * (ADR 0051 "Part 3", safest options 1 and 2):
 * - changes follow `changeableAsShown`, so a screen only ever hides a change the server would allow
 *   and never offers one it refuses; a cancelled meeting offers none;
 * - removals and decisions also need `meetings.invites` on (rule 13), and decisions are the
 *   organiser's only (`decidableAsShown`; meetings.md "Propose a new time");
 * - answers are for a staff guest who is not the organiser, while invites are on and the meeting
 *   is not cancelled (meetings.md "Permissions and answers");
 * - the guest list shows to the organiser, to anyone who may change the meeting, and otherwise only
 *   when the list is not hidden (meetings.md line 55).
 */
export function meetingRights(
  viewer: MeetingViewer,
  shown: Meeting,
  switches: MeetingSwitches = meetingSwitches(),
): MeetingRights {
  const live = shown.status !== "cancelled";
  const change = live && changeableAsShown(viewer, shown);
  const organiser = isOrganiser(shown, viewer.userId);
  return {
    change,
    removeGuest: change && switches.invites,
    decide: change && switches.invites && decidableAsShown(viewer, shown),
    answer: live && switches.invites && staffGuestOf(shown, viewer.userId) !== undefined && !organiser,
    seesGuests: organiser || !shown.hideGuestList || change,
  };
}

/** What the Meetings page header and New meeting offer. */
export interface MeetingOffers {
  /** New meeting, and clicking an empty slot. */
  create: boolean;
  /** The guest picker, "Hide the guest list from guests" and "You're the organiser." in New meeting. */
  invite: boolean;
  /** Request a meeting. */
  request: boolean;
}

/**
 * What the reader may start on the Meetings page (ADR 0051 "Part 3", safest options 3 and 9): New
 * meeting with the create key; guests in it only while `meetings.invites` is on (rule 13); Request
 * only while requests and invites are on and there is a colleague to ask, as the server's own
 * colleagues list says.
 */
export function meetingOffers(
  canCreate: boolean,
  colleagues: number,
  switches: MeetingSwitches = meetingSwitches(),
): MeetingOffers {
  return {
    create: canCreate,
    invite: canCreate && switches.invites,
    request: canCreate && switches.requests && switches.invites && colleagues > 0,
  };
}

/**
 * Whether the Outbox drawer offers Simulate reply on a message (meetings.md "Answer"; ADR 0051
 * "Part 3", safest option 2): only on a meeting invite, and only while `meetings.invites` is on,
 * since the store refuses every answer with it off (rule 13) and a screen never offers what the
 * store refuses. The screen also waits until the meeting is read, and hides it on a cancelled one.
 */
export function offersSimulateReply(
  message: Pick<OutboxMessage, "eventKey">,
  switches: MeetingSwitches = meetingSwitches(),
): boolean {
  return message.eventKey === "meeting.invite" && switches.invites;
}
