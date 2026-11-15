import { describe, expect, it } from "vitest";
import {
  acceptedProposal,
  canChangeMeeting,
  canDecideProposal,
  declinedProposal,
  proposalDecisionProblem,
  type Attendee,
  type Meeting,
  type MeetingProposal,
} from "../src";
import { GUEST, ORGANISER, guestRow, testMeeting, viewerAs } from "./meeting-fixtures";

const OTHER = "u-other";
const proposal = (patch: Partial<MeetingProposal> = {}): MeetingProposal => ({
  start: "2026-11-20T10:00",
  durationMin: 45,
  note: "Afternoon is better",
  status: "pending",
  ...patch,
});
/** A one-off where GUEST proposed a time and OTHER proposed another, both answered. */
const proposed = (patch: Partial<Meeting> = {}, mine: Partial<MeetingProposal> = {}) =>
  testMeeting({
    sequence: 2,
    rescheduleSequence: 1,
    attendees: [
      ...testMeeting().attendees.map((a) =>
        a.id === GUEST
          ? {
              ...a,
              partStat: "tentative" as const,
              respondedAt: "2026-11-10T09:00",
              respondedSequence: 2,
              proposal: proposal(mine),
            }
          : a,
      ),
      guestRow({
        kind: "staff",
        id: OTHER,
        partStat: "tentative",
        respondedAt: "2026-11-10T10:00",
        respondedSequence: 2,
        proposal: proposal({ start: "2026-11-21T08:00" }),
      }),
    ],
    ...patch,
  });
const guestOf = (meeting: Meeting, id: string) => meeting.attendees.find((a) => a.id === id) as Attendee;
const seesAll = () => true;

describe("deciding a proposed time (meetings.md Propose a new time, ADR 0051 Part 2)", () => {
  it("decides only a pending proposal on a one-off that is not cancelled", () => {
    const meeting = proposed();
    expect(proposalDecisionProblem(meeting, guestOf(meeting, GUEST), true)).toBeNull();
    expect(proposalDecisionProblem(meeting, guestOf(meeting, GUEST), false)).toBeNull();
    expect(proposalDecisionProblem(proposed({ status: "cancelled" }), guestOf(meeting, GUEST), true)).toMatch(
      /cancelled/,
    );
    expect(proposalDecisionProblem(meeting, guestOf(meeting, "c-1"), true)).toMatch(/no proposal waiting/);
    const declined = proposed({}, { status: "declined" });
    expect(proposalDecisionProblem(declined, guestOf(declined, GUEST), false)).toMatch(/no proposal waiting/);
    const series = proposed({ recurrence: "weekly" });
    expect(proposalDecisionProblem(series, guestOf(series, GUEST), true)).toMatch(/one-off/);
  });

  it("accepts only a time the clock shows, but declines one whatever its time", () => {
    const gap = proposed({}, { start: "2027-03-14T02:30" });
    expect(proposalDecisionProblem(gap, guestOf(gap, GUEST), true)).toMatch(/doesn't exist/);
    expect(proposalDecisionProblem(gap, guestOf(gap, GUEST), false)).toBeNull();
  });

  it("accept: moves the meeting, SEQUENCE + 1 with rescheduleSequence, asks everyone again and clears the other proposals", () => {
    const meeting = proposed();
    const after = acceptedProposal(meeting, guestOf(meeting, GUEST));
    expect(after).toMatchObject({ start: "2026-11-20T10:00", durationMin: 45, sequence: 3, rescheduleSequence: 3 });
    for (const a of after.attendees) expect(a).toMatchObject({ partStat: "needs-action", respondedAt: null });
    expect(guestOf(after, ORGANISER).partStat).toBe("needs-action");
    expect(guestOf(after, GUEST).proposal).toEqual(proposal({ status: "accepted" }));
    expect(guestOf(after, OTHER).proposal).toBeNull();
  });

  it("decline: only that proposal changes, to declined; SEQUENCE and every answer stay", () => {
    const meeting = proposed();
    const after = declinedProposal(meeting, guestOf(meeting, GUEST));
    expect(guestOf(after, GUEST).proposal).toEqual(proposal({ status: "declined" }));
    expect({ ...after, attendees: [] }).toEqual({ ...meeting, attendees: [] });
    expect(after.attendees.filter((a) => a.id !== GUEST)).toEqual(meeting.attendees.filter((a) => a.id !== GUEST));
    expect(guestOf(after, GUEST).partStat).toBe("tentative");
  });

  it("lets only the organiser who may change the meeting decide", () => {
    const meeting = proposed({ ownerUserId: ORGANISER });
    expect(canDecideProposal(viewerAs("manager", ORGANISER), meeting, seesAll)).toBe(true);
    // A Manager who may change it but is not the organiser can't: proposals are shown to the organiser only.
    expect(canChangeMeeting(viewerAs("manager", OTHER), meeting, seesAll)).toBe(true);
    expect(canDecideProposal(viewerAs("manager", OTHER), meeting, seesAll)).toBe(false);
    // An organiser without meetings.meeting.edit, or one who can't read the customer on it, can't either.
    expect(canDecideProposal(viewerAs("employee", ORGANISER), meeting, seesAll)).toBe(false);
    expect(canDecideProposal(viewerAs("manager", ORGANISER), meeting, (a) => a.kind !== "customer")).toBe(false);
  });
});
