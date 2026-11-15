import type { Attendee, Meeting } from "../types";
import { sameAttendee } from "./access";
import { askedAgain } from "./changes";
import { durationProblem, typedStartProblem } from "./input";

/**
 * Why a guest's proposed time can't be decided, or null (meetings.md "Propose a new time" and
 * `decideProposal`; ADR 0051 "Part 2"). The meeting must not be cancelled (the spec has no such
 * check, "Permissions and answers"), the guest must have a proposal waiting, and the meeting must be
 * a one-off, the only kind that takes one (rule 8). To accept it, the proposed start must still
 * pass `typedStartProblem` against the company's `today` and last 15 minutes to 24 hours. The
 * caller has already found the guest on this meeting (404 otherwise).
 */
export function proposalDecisionProblem(
  meeting: Meeting,
  guest: Attendee,
  accept: boolean,
  today: string,
): string | null {
  if (meeting.status === "cancelled") return "This meeting was cancelled.";
  const proposal = guest.proposal;
  if (!proposal || proposal.status !== "pending") return "There is no proposal waiting from this guest.";
  if (meeting.recurrence !== "none") return "Only a one-off meeting can take a proposed time.";
  if (!accept) return null;
  return typedStartProblem(proposal.start, { zone: meeting.timeZone, today }) ?? durationProblem(proposal.durationMin);
}

/**
 * A meeting after its organiser accepts a proposed time (meetings.md sends table, "Accept a
 * proposal", and `decideProposal`): it takes the proposed start and length, SEQUENCE + 1 with
 * `rescheduleSequence` set to it, and every guest is asked again (`askedAgain`, rule 6), the
 * organiser included. The proposal becomes `accepted` and every other guest's proposal is cleared.
 * Check `proposalDecisionProblem` first.
 */
export function acceptedProposal(meeting: Meeting, guest: Attendee): Meeting {
  const proposal = guest.proposal;
  if (!proposal) return meeting;
  const sequence = meeting.sequence + 1;
  return {
    ...meeting,
    start: proposal.start,
    durationMin: proposal.durationMin,
    sequence,
    rescheduleSequence: sequence,
    attendees: meeting.attendees.map((a) =>
      sameAttendee(a, guest) ? { ...askedAgain(a), proposal: { ...proposal, status: "accepted" } } : askedAgain(a),
    ),
  };
}

/**
 * A meeting after its organiser declines a proposed time (meetings.md sends table, "Decline a
 * proposal"): that proposal becomes `declined`, and nothing else changes, SEQUENCE and answers
 * included.
 */
export function declinedProposal(meeting: Meeting, guest: Attendee): Meeting {
  return {
    ...meeting,
    attendees: meeting.attendees.map((a) =>
      sameAttendee(a, guest) && a.proposal ? { ...a, proposal: { ...a.proposal, status: "declined" } } : a,
    ),
  };
}
