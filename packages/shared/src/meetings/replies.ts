import type { Attendee, Meeting, MeetingProposal } from "../types";
import { sameAttendee } from "./access";
import { statusMoveAllowed } from "./changes";

/** A checked answer (see `replyProblem`): Accept, Maybe or Decline, a note, and maybe a proposed time. */
export interface ReplyAnswer {
  partStat: Exclude<Attendee["partStat"], "needs-action">;
  note: string;
  proposal: Omit<MeetingProposal, "status"> | null;
}

/** What one answer does to a meeting. */
export interface ReplyOutcome {
  /** Made against an older version of the meeting; kept in the log, changes nothing (meetings.md rule 7). */
  stale: boolean;
  /** The answer as stored: an answer with a proposal is a Maybe until the organiser decides (ADR 0051). */
  partStat: Attendee["partStat"];
  /** How the answer is logged in meeting_responses. */
  method: "reply" | "counter";
  /** The meeting after the answer; the same meeting when stale. */
  meeting: Meeting;
  /** The status a request moved to because of this answer, or null. */
  statusChange: "confirmed" | "cancelled" | null;
  /** The notice the organiser gets, or null when the answer is stale. */
  event: "meeting.reply" | "meeting.proposed" | null;
}

/** The status a tentative request takes from its guest's answer (meetings.md "Meeting.status"): Accept confirms, Decline cancels. */
function requestDecision(meeting: Meeting, partStat: Attendee["partStat"]): "confirmed" | "cancelled" | null {
  if (meeting.kind !== "request" || meeting.status !== "tentative") return null;
  const to = partStat === "accepted" ? "confirmed" : partStat === "declined" ? "cancelled" : null;
  return to && statusMoveAllowed(meeting.status, to) ? to : null;
}

/**
 * Records one guest's answer (meetings.md rules 7 and 8, `applyReply`). A reply made against a
 * SEQUENCE below rescheduleSequence is stale and changes nothing. Otherwise the guest's answer,
 * reply time, SEQUENCE and note are set, and a proposal is stored as pending (a later plain answer
 * keeps an earlier proposal, as the spec has it). On a tentative request, Accept confirms it and
 * Decline cancels it, each raising SEQUENCE by one; a Maybe leaves it tentative.
 * `respondedAt` is the local time of the answer in the meeting's zone.
 */
export function replyOutcome(
  meeting: Meeting,
  guest: Attendee,
  reply: ReplyAnswer,
  at: { sequence: number; respondedAt: string },
): ReplyOutcome {
  const partStat = reply.proposal ? "tentative" : reply.partStat;
  const method = reply.proposal ? "counter" : "reply";
  const stale = at.sequence < meeting.rescheduleSequence;
  if (stale) return { stale, partStat, method, meeting, statusChange: null, event: null };
  const answered: Attendee = {
    ...guest,
    partStat,
    respondedAt: at.respondedAt,
    respondedSequence: at.sequence,
    note: reply.note,
    proposal: reply.proposal ? { ...reply.proposal, status: "pending" } : guest.proposal,
  };
  const withAnswer: Meeting = {
    ...meeting,
    attendees: meeting.attendees.map((a) => (sameAttendee(a, guest) ? answered : a)),
  };
  const statusChange = requestDecision(meeting, partStat);
  return {
    stale,
    partStat,
    method,
    meeting: statusChange ? { ...withAnswer, status: statusChange, sequence: meeting.sequence + 1 } : withAnswer,
    statusChange,
    event: reply.proposal ? "meeting.proposed" : "meeting.reply",
  };
}
