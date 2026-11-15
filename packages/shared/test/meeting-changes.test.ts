import { describe, expect, it } from "vitest";
import {
  cancelProblem,
  cancelledMeeting,
  changedFields,
  editProblem,
  editedMeeting,
  newAttendee,
  removeGuestProblem,
  replyOutcome,
  requestFlags,
  scheduleFlags,
  statusMoveAllowed,
  withoutGuest,
  type Attendee,
  type Meeting,
} from "../src";
import { GUEST, NOW, ORGANISER, TODAY, guestRow, testMeeting } from "./meeting-fixtures";

const answered = (patch: Partial<Meeting> = {}) =>
  testMeeting({
    sequence: 2,
    rescheduleSequence: 1,
    attendees: testMeeting().attendees.map((a) =>
      a.id === GUEST
        ? {
            ...a,
            partStat: "tentative",
            respondedAt: "2026-11-10T09:00",
            respondedSequence: 2,
            proposal: { start: "2026-11-20T09:00", durationMin: 60, note: "", status: "pending" },
          }
        : a,
    ),
    ...patch,
  });
const guestOf = (meeting: Meeting, id: string) => meeting.attendees.find((a) => a.id === id) as Attendee;

describe("meeting status (meetings.md Meeting.status)", () => {
  it("moves a request to confirmed or cancelled, a meeting only to cancelled, and never back", () => {
    expect(statusMoveAllowed("tentative", "confirmed")).toBe(true);
    expect(statusMoveAllowed("tentative", "cancelled")).toBe(true);
    expect(statusMoveAllowed("confirmed", "cancelled")).toBe(true);
    expect(statusMoveAllowed("confirmed", "tentative")).toBe(false);
    expect(statusMoveAllowed("cancelled", "confirmed")).toBe(false);
    expect(statusMoveAllowed("cancelled", "cancelled")).toBe(false);
  });
});

describe("editing a meeting (meetings.md rule 6, ADR 0051)", () => {
  it("counts only the fields that really change", () => {
    expect(changedFields(testMeeting(), { title: "Design consultation", start: "2026-11-19T08:30" })).toEqual([]);
    expect(changedFields(testMeeting(), { title: "New", durationMin: 60, location: "Studio" })).toEqual([
      "title",
      "location",
    ]);
  });

  it("keeps SEQUENCE and every answer on a title, notes or reminder edit", () => {
    const edit = editedMeeting(answered(), { title: "New title", notes: "Bring samples", reminderMin: 60 });
    expect(edit.significant).toBe(false);
    expect(edit.meeting).toMatchObject({ title: "New title", notes: "Bring samples", reminderMin: 60, sequence: 2 });
    expect(edit.meeting.rescheduleSequence).toBe(1);
    expect(edit.meeting.attendees).toEqual(answered().attendees);
  });

  it("raises SEQUENCE and asks everyone again, the organiser included, on a start, length or place edit", () => {
    for (const patch of [{ start: "2026-11-19T10:00" }, { durationMin: 90 }, { location: "Studio" }]) {
      const edit = editedMeeting(answered(), patch);
      expect(edit.significant).toBe(true);
      expect(edit.meeting.sequence).toBe(3);
      expect(edit.meeting.rescheduleSequence).toBe(3);
      for (const a of edit.meeting.attendees)
        expect(a).toMatchObject({ partStat: "needs-action", respondedAt: null, proposal: null });
    }
  });

  it("changes nothing when nothing changes", () => {
    const edit = editedMeeting(answered(), { title: "Design consultation" });
    expect(edit.changed).toEqual([]);
    expect(edit.meeting).toEqual(answered());
  });

  it("refuses an edit to a cancelled meeting, and a start that doesn't exist", () => {
    expect(editProblem(testMeeting({ status: "cancelled" }), { title: "x" }, TODAY, NOW)).toMatch(/cancelled/);
    expect(editProblem(testMeeting(), { start: "2027-03-14T02:30" }, TODAY, NOW)).toMatch(/doesn't exist/);
    expect(editProblem(testMeeting(), { durationMin: 5 }, TODAY, NOW)).toMatch(/15 minutes/);
    expect(editProblem(testMeeting(), { title: "Fine" }, TODAY, NOW)).toBeNull();
  });

  it("refuses a new start too far from the company's today, but edits a meeting that began long ago", () => {
    expect(editProblem(testMeeting(), { start: "2999-12-01T08:30" }, TODAY, NOW)).toMatch(/three years ahead/);
    expect(editProblem(testMeeting(), { start: "1900-01-01T08:30" }, TODAY, NOW)).toMatch(/one year ago/);
    const longAgo = testMeeting({ start: "2019-11-21T08:30", recurrence: "weekly" });
    expect(editProblem(longAgo, { title: "Still running", durationMin: 45 }, TODAY, NOW)).toBeNull();
  });

  it("lets the seeded day-30 monthly series take a title edit, but not a move to day 29", () => {
    const safetyTalk = testMeeting({ start: "2026-09-30T13:00", recurrence: "monthly" });
    expect(editProblem(safetyTalk, { title: "Safety talk", start: "2026-09-30T13:00" }, TODAY, NOW)).toBeNull();
    expect(editProblem(safetyTalk, { start: "2026-10-29T13:00" }, TODAY, NOW)).toMatch(/fifth week/);
  });

  it("shifts a series' occurrences changed on their own with its new start, keeping their own times (part 2)", () => {
    const series = testMeeting({
      recurrence: "weekly",
      exceptions: [{ planned: "2026-11-26T08:30", start: "2026-11-27T08:30" }],
    });
    expect(editProblem(series, { start: "2026-11-19T09:00" }, TODAY, NOW)).toBeNull();
    expect(editProblem(series, { durationMin: 45 }, TODAY, NOW)).toBeNull();
    const edit = editedMeeting(series, { start: "2026-11-20T09:00", durationMin: 45 });
    expect(edit.meeting).toMatchObject({ start: "2026-11-20T09:00", durationMin: 45, sequence: 1 });
    expect(edit.meeting.exceptions).toEqual([{ planned: "2026-11-27T09:00", start: "2026-11-27T08:30" }]);
    expect(editedMeeting(series, { durationMin: 45 }).meeting.exceptions).toEqual(series.exceptions);
  });

  it("refuses a new start that would take an occurrence changed on its own off the series", () => {
    // The fourth Thursday moved on its own; a week's shift puts the series in the first week, where it is not.
    const monthly = testMeeting({
      start: "2026-11-26T08:30",
      recurrence: "monthly",
      exceptions: [{ planned: "2026-12-24T08:30", start: "2026-12-23T08:30" }],
    });
    expect(editProblem(monthly, { start: "2026-12-03T08:30" }, TODAY, NOW)).toMatch(/no longer be part of the series/);
    const ending = testMeeting({
      recurrence: "weekly",
      until: "2026-12-03",
      exceptions: [{ planned: "2026-12-03T08:30", start: "2026-12-02T08:30" }],
    });
    expect(editProblem(ending, { start: "2026-11-20T08:30" }, TODAY, NOW)).toMatch(/no longer be part of the series/);
    expect(editProblem(ending, { start: "2026-11-19T07:30" }, TODAY, NOW)).toBeNull();
  });

  it("refuses a start or length edit that would leave an occurrence that has taken place behind, or out of reach (review round 3 of PR #35)", () => {
    const behind = /has already taken place, but its date in the series is still ahead/;
    // Fridays from 30 October in Denver; NOW is the Sunday after 13 November, at noon. That Friday's was held an hour late.
    const fridays = (exceptions: Meeting["exceptions"]) =>
      testMeeting({ start: "2026-10-30T09:00", recurrence: "weekly", exceptions });
    const heldLate = fridays([{ planned: "2026-11-13T09:00", start: "2026-11-13T10:00" }]);
    // Two weeks later, the held occurrence would name Friday the 27th.
    expect(editProblem(heldLate, { start: "2026-11-13T09:00" }, TODAY, NOW)).toMatch(behind);
    expect(editProblem(heldLate, { start: "2026-10-29T09:00" }, TODAY, NOW)).toBeNull();
    expect(editProblem(heldLate, { durationMin: 45 }, TODAY, NOW)).toBeNull();
    // The 20 November occurrence held early on the 14th: a length edit changes the series' DTEND, so it waits too.
    const heldEarly = fridays([{ planned: "2026-11-20T09:00", start: "2026-11-14T09:00" }]);
    expect(editProblem(heldEarly, { durationMin: 45 }, TODAY, NOW)).toMatch(behind);
    expect(editProblem(heldEarly, { title: "Renamed", location: "Bay 2" }, TODAY, NOW)).toBeNull();
    // Moved 28 days earlier on its own, a week's shift would put it 35 days before its date, out of the calendar's reach.
    const early = testMeeting({
      recurrence: "weekly",
      exceptions: [{ planned: "2026-12-31T08:30", start: "2026-12-03T10:00" }],
    });
    expect(editProblem(early, { start: "2026-11-26T08:30" }, TODAY, NOW)).toMatch(/more than 31 days/);
  });
});

describe("cancelling and removing guests (meetings.md sends table)", () => {
  it("cancels once: SEQUENCE + 1, rescheduleSequence with it, answers left", () => {
    expect(cancelProblem(answered())).toBeNull();
    const cancelled = cancelledMeeting(answered());
    expect(cancelled).toMatchObject({ status: "cancelled", sequence: 3, rescheduleSequence: 3 });
    expect(cancelled.attendees).toEqual(answered().attendees);
    expect(cancelProblem(cancelled)).toMatch(/already cancelled/);
  });

  it("never removes the organiser, nor anyone from a cancelled meeting", () => {
    const meeting = testMeeting();
    expect(removeGuestProblem(meeting, guestOf(meeting, ORGANISER))).toMatch(/organiser/);
    expect(removeGuestProblem(meeting, guestOf(meeting, GUEST))).toBeNull();
    expect(removeGuestProblem(testMeeting({ status: "cancelled" }), guestOf(meeting, GUEST))).toMatch(/cancelled/);
  });

  it("removes only that guest, matched by kind and id, and raises SEQUENCE only", () => {
    const twin = guestRow({ kind: "customer", id: GUEST });
    const meeting = answered({ attendees: [...answered().attendees, twin] });
    const after = withoutGuest(meeting, guestOf(meeting, GUEST));
    expect(after.attendees.map((a) => `${a.kind}:${a.id}`)).toEqual([
      `staff:${ORGANISER}`,
      "customer:c-1",
      "external:x-1",
      `customer:${GUEST}`,
    ]);
    expect(after).toMatchObject({ sequence: 3, rescheduleSequence: 1 });
  });
});

describe("guest-list and proposal flags (meetings.md rule 9, ADR 0051)", () => {
  it("hides the list when asked, when private, and when any guest is not staff", () => {
    const staff = [{ kind: "staff" as const }];
    const settings = { allowProposals: true };
    expect(scheduleFlags({ private: false, hideGuestList: false }, staff, settings, true).hideGuestList).toBe(false);
    expect(scheduleFlags({ private: false, hideGuestList: true }, staff, settings, true).hideGuestList).toBe(true);
    expect(scheduleFlags({ private: true, hideGuestList: false }, staff, settings, true).hideGuestList).toBe(true);
    for (const kind of ["customer", "supplier", "customer-contact", "supplier-contact", "external"] as const) {
      expect(
        scheduleFlags({ private: false, hideGuestList: false }, [...staff, { kind }], settings, true).hideGuestList,
        kind,
      ).toBe(true);
    }
  });

  it("offers proposals only when the setting is on and the organiser can decide them", () => {
    expect(
      scheduleFlags({ private: false, hideGuestList: false }, [], { allowProposals: true }, true).allowProposals,
    ).toBe(true);
    expect(
      scheduleFlags({ private: false, hideGuestList: false }, [], { allowProposals: true }, false).allowProposals,
    ).toBe(false);
    expect(
      scheduleFlags({ private: false, hideGuestList: false }, [], { allowProposals: false }, true).allowProposals,
    ).toBe(false);
  });

  it("treats a request like any meeting: proposals need the setting and the asker's edit key (delta item 8)", () => {
    const on = { allowProposals: true };
    const off = { allowProposals: false };
    expect(requestFlags(true, on, false)).toEqual({ hideGuestList: true, allowProposals: false });
    expect(requestFlags(false, on, true)).toEqual({ hideGuestList: false, allowProposals: true });
    // With proposals off in Settings → Meetings (the default when none are stored), not even an editor's request takes one.
    expect(requestFlags(false, off, true)).toEqual({ hideGuestList: false, allowProposals: false });
  });
});

describe("answering (meetings.md rules 7 and 8)", () => {
  const at = { sequence: 2, respondedAt: "2026-11-15T10:00" };

  it("records a guest's answer and tells the organiser", () => {
    const meeting = testMeeting({ sequence: 2, rescheduleSequence: 2 });
    const out = replyOutcome(
      meeting,
      guestOf(meeting, GUEST),
      { partStat: "accepted", note: "See you", proposal: null },
      at,
    );
    expect(out).toMatchObject({
      stale: false,
      partStat: "accepted",
      method: "reply",
      statusChange: null,
      event: "meeting.reply",
    });
    expect(guestOf(out.meeting, GUEST)).toMatchObject({
      partStat: "accepted",
      respondedAt: "2026-11-15T10:00",
      respondedSequence: 2,
      note: "See you",
    });
    expect(out.meeting.attendees.filter((a) => a.id !== GUEST)).toEqual(
      meeting.attendees.filter((a) => a.id !== GUEST),
    );
    expect(out.meeting.sequence).toBe(2);
  });

  it("keeps a stale reply out of the meeting", () => {
    const meeting = testMeeting({ sequence: 3, rescheduleSequence: 3 });
    const out = replyOutcome(meeting, guestOf(meeting, GUEST), { partStat: "declined", note: "", proposal: null }, at);
    expect(out).toMatchObject({ stale: true, event: null, statusChange: null });
    expect(out.meeting).toBe(meeting);
  });

  it("stores a proposal as a pending Maybe, and a later plain answer keeps it", () => {
    const meeting = testMeeting({ sequence: 2, rescheduleSequence: 2 });
    const proposal = { start: "2026-11-20T09:00", durationMin: 60, note: "Friday works" };
    const out = replyOutcome(meeting, guestOf(meeting, GUEST), { partStat: "accepted", note: "", proposal }, at);
    expect(out).toMatchObject({ partStat: "tentative", method: "counter", event: "meeting.proposed" });
    expect(guestOf(out.meeting, GUEST).proposal).toEqual({ ...proposal, status: "pending" });
    const later = replyOutcome(
      out.meeting,
      guestOf(out.meeting, GUEST),
      { partStat: "accepted", note: "", proposal: null },
      at,
    );
    expect(guestOf(later.meeting, GUEST).proposal?.status).toBe("pending");
  });

  it("confirms a request on Accept and cancels it on Decline, each with SEQUENCE + 1; a Maybe leaves it waiting", () => {
    const request = testMeeting({ kind: "request", status: "tentative", sequence: 0, rescheduleSequence: 0 });
    const guest = guestOf(request, GUEST);
    const zero = { ...at, sequence: 0 };
    expect(replyOutcome(request, guest, { partStat: "accepted", note: "", proposal: null }, zero)).toMatchObject({
      statusChange: "confirmed",
      meeting: { status: "confirmed", sequence: 1 },
    });
    expect(replyOutcome(request, guest, { partStat: "declined", note: "", proposal: null }, zero)).toMatchObject({
      statusChange: "cancelled",
      meeting: { status: "cancelled", sequence: 1 },
    });
    expect(replyOutcome(request, guest, { partStat: "tentative", note: "", proposal: null }, zero)).toMatchObject({
      statusChange: null,
      meeting: { status: "tentative", sequence: 0 },
    });
    const confirmed = testMeeting({ kind: "request", status: "confirmed", sequence: 1, rescheduleSequence: 0 });
    expect(
      replyOutcome(confirmed, guest, { partStat: "declined", note: "", proposal: null }, at).statusChange,
    ).toBeNull();
  });
});

describe("guests the server adds (ADR 0051, critic B4)", () => {
  it("keeps only who the guest is, whatever else a client sent", () => {
    const sent = {
      ...guestRow({ kind: "staff", id: GUEST }),
      role: "optional" as const,
      partStat: "accepted" as const,
      respondedAt: "2026-11-01T09:00",
      respondedSequence: 7,
      note: "forged",
      proposal: { start: "2026-11-20T09:00", durationMin: 30, note: "", status: "accepted" as const },
    };
    expect(newAttendee(sent)).toEqual(guestRow({ kind: "staff", id: GUEST, name: sent.name, email: sent.email }));
    expect(newAttendee(guestRow({ kind: "staff", id: ORGANISER }), true).partStat).toBe("accepted");
  });
});
