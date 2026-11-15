import { describe, expect, it } from "vitest";
import {
  BUSY_TITLE,
  addDays,
  MEETING_CHANGED,
  UNDO_WINDOW_MINUTES,
  conflictForViewer,
  effectiveScope,
  isPlannedOccurrence,
  moveAuditEntry,
  moveProblem,
  movedMeetings,
  movedOccurrenceKey,
  occurrenceConflicts,
  restoredOccurrence,
  undoProblem,
  undoneMeeting,
  type Attendee,
  type Meeting,
  type MeetingMoveInput,
  type UndoContext,
} from "../src";
import { GUEST, ORGANISER, guestRow, testMeeting, viewerAs } from "./meeting-fixtures";

/** A weekly huddle on Thursdays at 08:30 in Denver, from 19 November 2026. */
const huddle = (patch: Partial<Meeting> = {}) => testMeeting({ recurrence: "weekly", ...patch });
const move = (patch: Partial<MeetingMoveInput> = {}): MeetingMoveInput => ({
  planned: "2026-11-26T08:30",
  start: "2026-11-26T10:00",
  durationMin: 45,
  scope: "this",
  ...patch,
});
const ids = { newId: "m2", newUid: "8d1f3c52-1a8e-4c3b-9f0e-5b2d7c4a6e10" };
const seesAll = () => true;
const LOST = "The moved occurrence would no longer be part of the series. Choose another time.";
const STRANDED =
  "An occurrence changed on its own would no longer be part of the series after this move. Move it on its own first, or choose another time.";

describe("which occurrence a move names (meetings.md rules 1 and 2)", () => {
  it("knows a one-off by its start and a series by the dates its rule plans", () => {
    expect(isPlannedOccurrence(testMeeting(), "2026-11-19T08:30")).toBe(true);
    expect(isPlannedOccurrence(testMeeting(), "2026-11-26T08:30")).toBe(false);
    expect(isPlannedOccurrence(huddle(), "2026-11-19T08:30")).toBe(true);
    expect(isPlannedOccurrence(huddle(), "2026-12-31T08:30")).toBe(true);
    for (const fake of ["2026-11-26T09:00", "2026-11-25T08:30", "2026-11-12T08:30", "2026-11-26", "2026-02-30T08:30"])
      expect(isPlannedOccurrence(huddle(), fake), fake).toBe(false);
  });

  it("counts a weekly or biweekly step rather than walking it, however far ahead", () => {
    const far = addDays("2026-11-19T08:30", 7 * 40_000);
    expect(isPlannedOccurrence(huddle(), far)).toBe(true);
    expect(isPlannedOccurrence(huddle(), addDays(far, 1))).toBe(false);
    expect(isPlannedOccurrence(huddle({ recurrence: "biweekly" }), "2026-12-03T08:30")).toBe(true);
    expect(isPlannedOccurrence(huddle({ recurrence: "biweekly" }), "2026-11-26T08:30")).toBe(false);
  });

  it("stops at until, skips a cancelled occurrence and keeps the monthly week cap", () => {
    expect(isPlannedOccurrence(huddle({ until: "2026-12-03" }), "2026-12-03T08:30")).toBe(true);
    expect(isPlannedOccurrence(huddle({ until: "2026-12-03" }), "2026-12-10T08:30")).toBe(false);
    const skipped = huddle({ exceptions: [{ planned: "2026-11-26T08:30", cancelled: true }] });
    expect(isPlannedOccurrence(skipped, "2026-11-26T08:30")).toBe(false);
    const fourthThursday = testMeeting({ start: "2026-11-26T08:30", recurrence: "monthly" });
    expect(isPlannedOccurrence(fourthThursday, "2026-12-24T08:30")).toBe(true);
    expect(isPlannedOccurrence(fourthThursday, "2026-12-31T08:30")).toBe(false);
  });

  it("moves a one-off as all events, whatever scope is sent (rule 4)", () => {
    expect(effectiveScope(testMeeting(), "this")).toBe("all");
    expect(effectiveScope(huddle(), "this")).toBe("this");
  });
});

describe("what a move refuses (ADR 0051 Part 2)", () => {
  it("takes this, this and following, and all on a weekly series", () => {
    expect(moveProblem(huddle(), move())).toBeNull();
    expect(moveProblem(huddle(), move({ scope: "following" }))).toBeNull();
    expect(moveProblem(huddle(), move({ scope: "all" }))).toBeNull();
    expect(moveProblem(testMeeting(), move({ planned: "2026-11-19T08:30", start: "2026-11-20T09:00" }))).toBeNull();
  });

  it("refuses a cancelled meeting, a time the clocks skip, a bad length and an occurrence the meeting never had", () => {
    expect(moveProblem(huddle({ status: "cancelled" }), move())).toBe("This meeting was cancelled.");
    expect(moveProblem(huddle(), move({ start: "2027-03-14T02:30" }))).toMatch(/doesn't exist/);
    expect(moveProblem(huddle(), move({ durationMin: 10 }))).toMatch(/15 minutes/);
    expect(moveProblem(huddle(), move({ durationMin: 1441 }))).toMatch(/15 minutes/);
    expect(moveProblem(huddle(), move({ planned: "2026-11-26T09:00" }))).toMatch(/not part of this meeting/);
    expect(moveProblem(huddle({ until: "2026-11-20" }), move())).toMatch(/not part of this meeting/);
  });

  it("refuses this and following from the first occurrence, pointing to All events", () => {
    expect(moveProblem(huddle(), move({ planned: "2026-11-19T08:30", scope: "following" }))).toMatch(
      /first occurrence of the series/,
    );
    // A one-off moves as all, so its scope never matters.
    expect(moveProblem(testMeeting(), move({ planned: "2026-11-19T08:30", scope: "following" }))).toBeNull();
  });

  it("refuses a series start shifted into the spring gap, though the new time itself exists", () => {
    const sundays = testMeeting({ start: "2027-03-07T02:30", recurrence: "weekly" });
    expect(
      moveProblem(sundays, move({ planned: "2027-03-21T02:30", start: "2027-03-28T02:30", scope: "all" })),
    ).toMatch(/doesn't exist/);
    expect(moveProblem(sundays, move({ planned: "2027-03-21T02:30", start: "2027-03-28T02:30" }))).toBeNull();
  });

  it("refuses the seeded day-30 safety talk moved as all events, but moves it this event or resizes it", () => {
    const safetyTalk = testMeeting({ start: "2026-09-30T13:00", recurrence: "monthly" });
    const occurrence = { planned: "2026-11-25T13:00", start: "2026-11-25T14:00" };
    expect(moveProblem(safetyTalk, move({ ...occurrence, scope: "all" }))).toMatch(/fifth week/);
    expect(moveProblem(safetyTalk, move({ ...occurrence, scope: "this" }))).toBeNull();
    expect(
      moveProblem(safetyTalk, move({ planned: occurrence.planned, start: occurrence.planned, scope: "all" })),
    ).toBeNull();
  });

  it("refuses a move that would take the moved occurrence off its series", () => {
    // The fourth Tuesday moved a week later: the series would start in the first week, where 29 December is not.
    const fourthTuesday = testMeeting({ start: "2026-11-24T10:00", recurrence: "monthly" });
    expect(
      moveProblem(fourthTuesday, move({ planned: "2026-12-22T10:00", start: "2026-12-29T10:00", scope: "all" })),
    ).toBe(LOST);
    expect(
      moveProblem(fourthTuesday, move({ planned: "2026-12-22T10:00", start: "2026-12-29T10:00", scope: "following" })),
    ).toMatch(/fifth week/);
    const ending = huddle({ until: "2026-12-03" });
    expect(moveProblem(ending, move({ planned: "2026-12-03T08:30", start: "2026-12-04T08:30", scope: "all" }))).toBe(
      LOST,
    );
    expect(moveProblem(ending, move({ start: "2026-12-10T08:30", scope: "following" }))).toBe(LOST);
  });

  it("refuses a move that would take an occurrence changed on its own off its series", () => {
    const series = huddle({
      until: "2027-01-14",
      exceptions: [{ planned: "2027-01-14T08:30", start: "2027-01-13T08:30" }],
    });
    expect(
      moveProblem(series, move({ planned: "2026-12-03T08:30", start: "2026-12-04T08:30", scope: "following" })),
    ).toBe(STRANDED);
    expect(moveProblem(series, move({ planned: "2026-12-03T08:30", start: "2026-12-04T08:30", scope: "all" }))).toBe(
      STRANDED,
    );
    expect(
      moveProblem(series, move({ planned: "2026-12-03T08:30", start: "2026-12-03T08:00", scope: "all" })),
    ).toBeNull();
  });

  it("takes at most 100 occurrences changed on their own", () => {
    const planned = Array.from({ length: 100 }, (_, week) => {
      const day = new Date(Date.UTC(2026, 10, 19 + 7 * (week + 2)));
      return `${day.toISOString().slice(0, 10)}T08:30`;
    });
    const full = huddle({ exceptions: planned.map((p) => ({ planned: p, start: p.replace("08:30", "09:00") })) });
    expect(moveProblem(full, move())).toMatch(/at most 100 occurrences/);
    expect(moveProblem(full, move({ planned: planned[0]!, start: planned[0]!.replace("08:30", "10:00") }))).toBeNull();
  });
});

describe("what a move saves (meetings.md rule 4 and the sends table)", () => {
  const answered = (patch: Partial<Meeting> = {}) =>
    huddle({
      sequence: 2,
      rescheduleSequence: 1,
      attendees: huddle().attendees.map((a) =>
        a.id === GUEST ? { ...a, partStat: "accepted", respondedAt: "2026-11-10T09:00", respondedSequence: 2 } : a,
      ),
      ...patch,
    });

  it("this event: an exception, SEQUENCE + 1, rescheduleSequence and answers kept", () => {
    const moved = movedMeetings(answered(), move(), ids);
    expect(moved.split).toBeNull();
    expect(moved.original).toMatchObject({ start: "2026-11-19T08:30", sequence: 3, rescheduleSequence: 1 });
    expect(moved.original.exceptions).toEqual([
      { planned: "2026-11-26T08:30", start: "2026-11-26T10:00", durationMin: 45 },
    ]);
    expect(moved.original.attendees).toEqual(answered().attendees);
  });

  it("all events: the series shifts with its exceptions, rescheduleSequence set to the new SEQUENCE, answers kept", () => {
    const meeting = answered({ exceptions: [{ planned: "2026-12-03T08:30", start: "2026-12-04T08:30" }] });
    const moved = movedMeetings(meeting, move({ scope: "all" }), ids);
    expect(moved.original).toMatchObject({
      start: "2026-11-19T10:00",
      durationMin: 45,
      sequence: 3,
      rescheduleSequence: 3,
    });
    expect(moved.original.exceptions).toEqual([{ planned: "2026-12-03T10:00", start: "2026-12-04T08:30" }]);
    expect(moved.original.attendees).toEqual(meeting.attendees);
    expect(movedMeetings(testMeeting(), move({ planned: "2026-11-19T08:30", scope: "this" }), ids).scope).toBe("all");
  });

  it("this and following: the old series ends the day before; the new one has its own UID, SEQUENCE 0 and the answers", () => {
    const meeting = answered({
      exceptions: [
        { planned: "2026-11-19T08:30", start: "2026-11-19T07:30" },
        { planned: "2026-12-10T08:30", start: "2026-12-11T08:30" },
      ],
    });
    const moved = movedMeetings(meeting, move({ scope: "following" }), ids);
    expect(moved.original).toMatchObject({ until: "2026-11-25", sequence: 3, rescheduleSequence: 3, uid: meeting.uid });
    expect(moved.original.exceptions).toEqual([{ planned: "2026-11-19T08:30", start: "2026-11-19T07:30" }]);
    expect(moved.split).toMatchObject({
      id: "m2",
      uid: ids.newUid,
      start: "2026-11-26T10:00",
      durationMin: 45,
      until: null,
      sequence: 0,
      rescheduleSequence: 0,
      ownerUserId: ORGANISER,
    });
    expect(moved.split?.exceptions).toEqual([{ planned: "2026-12-10T10:00", start: "2026-12-11T08:30" }]);
    const copied = moved.split?.attendees.find((a) => a.id === GUEST);
    expect(copied).toMatchObject({ partStat: "accepted", respondedAt: "2026-11-10T09:00", respondedSequence: 0 });
    expect(moved.split?.attendees.find((a) => a.id === "c-1")?.respondedSequence).toBeNull();
  });

  it("names the occurrence the move produced, on the meeting that now holds it", () => {
    const meeting = huddle();
    const key = (m: MeetingMoveInput) => movedOccurrenceKey(m, movedMeetings(meeting, m, ids));
    expect(key(move())).toEqual({ meetingId: "m1", planned: "2026-11-26T08:30" });
    expect(key(move({ scope: "all" }))).toEqual({ meetingId: "m1", planned: "2026-11-26T10:00" });
    expect(key(move({ scope: "following" }))).toEqual({ meetingId: "m2", planned: "2026-11-26T10:00" });
  });
});

describe("conflicts on a move (meetings.md rule 13, ADR 0051 Part 2)", () => {
  const MANAGER = "u-mgr";
  const other = (patch: Partial<Meeting>) =>
    testMeeting({
      id: "m9",
      title: "Supplier call",
      start: "2026-11-26T10:30",
      durationMin: 30,
      attendees: [
        guestRow({ kind: "staff", id: MANAGER, partStat: "accepted" }),
        guestRow({ kind: "staff", id: GUEST }),
      ],
      ownerUserId: MANAGER,
      ...patch,
    });
  const conflictsAfter = (meeting: Meeting, m: MeetingMoveInput, others: Meeting[]) => {
    const moved = movedMeetings(meeting, m, ids);
    const saved = [moved.original, ...(moved.split ? [moved.split] : []), ...others];
    return occurrenceConflicts(
      saved,
      { ...movedOccurrenceKey(m, moved), start: m.start, durationMin: m.durationMin },
      meeting.attendees,
    );
  };

  it("finds a guest booked in an overlapping occurrence on the new day, matched by kind and id", () => {
    const found = conflictsAfter(huddle(), move(), [other({})]);
    expect(found.map((c) => [c.guest.id, c.meeting.id, c.start])).toEqual([[GUEST, "m9", "2026-11-26T10:30"]]);
    // A customer whose id is the staff guest's, an email guest and a meeting that starts as this one ends don't count.
    const twin = other({
      attendees: [guestRow({ kind: "customer", id: GUEST }), guestRow({ kind: "external", id: "x-9" })],
    });
    expect(conflictsAfter(huddle(), move(), [twin, other({ id: "m8", start: "2026-11-26T10:45" })])).toEqual([]);
  });

  it("never warns about the moved occurrence itself after an all or a split move", () => {
    expect(conflictsAfter(huddle(), move({ scope: "all" }), [])).toEqual([]);
    expect(conflictsAfter(huddle(), move({ scope: "following" }), [])).toEqual([]);
    expect(conflictsAfter(testMeeting(), move({ planned: "2026-11-19T08:30", start: "2026-11-19T09:00" }), [])).toEqual(
      [],
    );
  });

  it("counts another occurrence of the same series", () => {
    const found = conflictsAfter(huddle(), move({ start: "2026-12-03T08:00" }), []);
    expect(new Set(found.map((c) => `${c.meeting.id} ${c.start}`))).toEqual(new Set(["m1 2026-12-03T08:30"]));
  });

  it("names the other meeting only to a mover who sees it and sees the guest on it; otherwise Busy", () => {
    const [raw] = conflictsAfter(huddle(), move(), [other({})]);
    const manager = viewerAs("manager", ORGANISER);
    expect(conflictForViewer(raw!, manager, seesAll)).toEqual({
      name: raw!.guest.name,
      title: "Supplier call",
      start: "2026-11-26T10:30",
    });
    const busy = (meeting: Meeting, viewer = manager, sight: (a: Attendee) => boolean = seesAll) => {
      const [found] = conflictsAfter(huddle(), move(), [meeting]);
      return conflictForViewer(found!, viewer, sight);
    };
    expect(busy(other({ private: true }))).toEqual({
      name: raw!.guest.name,
      title: BUSY_TITLE,
      start: "2026-11-26T10:30",
    });
    // A hidden list the mover may not open: they can't read the customer, so they can't change it.
    const hidden = other({
      hideGuestList: true,
      attendees: [...other({}).attendees, guestRow({ kind: "customer", id: "c-9" })],
    });
    expect(busy(hidden, manager, (a) => a.kind !== "customer").title).toBe(BUSY_TITLE);
    // An own-scope mover doesn't see a colleague's meeting they are not on.
    expect(busy(other({}), viewerAs("sales", ORGANISER)).title).toBe(BUSY_TITLE);
    expect(Object.keys(busy(other({ private: true }))).sort()).toEqual(["name", "start", "title"]);
  });
});

describe("undo, rebuilt from the move's own audit entry (critic B3)", () => {
  const before = huddle({
    sequence: 2,
    until: "2027-06-30",
    exceptions: [{ planned: "2026-11-26T08:30", start: "2026-11-26T07:30" }],
  });
  const m = move({ scope: "following", planned: "2026-12-03T08:30", start: "2026-12-03T09:00" });
  const moved = movedMeetings(before, m, ids);
  const record = moveAuditEntry(before, new Date("2026-11-19T15:30:00.000Z"), m, moved);
  const ctx = (patch: Partial<UndoContext> = {}): UndoContext => ({
    record,
    moverUserId: ORGANISER,
    callerUserId: ORGANISER,
    ageMs: 60_000,
    clientSequence: 2,
    ...patch,
  });

  it("keeps times only: the series as it was, and what the move saved", () => {
    expect(record).toEqual({
      before: {
        planned: "2026-12-03T08:30",
        sequence: 2,
        series: {
          start: "2026-11-19T08:30",
          startsAt: "2026-11-19T15:30:00.000Z",
          durationMin: 60,
          until: "2027-06-30",
          exceptions: [{ planned: "2026-11-26T08:30", start: "2026-11-26T07:30" }],
        },
      },
      after: { start: "2026-12-03T09:00", durationMin: 45, scope: "following", sequence: 3, createdIds: ["m2"] },
    });
    expect(JSON.stringify(record)).not.toMatch(/Design consultation|example\.com|note/i);
  });

  it("lets the mover undo the last move within the window, at the SEQUENCE they saw", () => {
    expect(undoProblem(moved.original, ctx())).toBeNull();
    expect(undoProblem(moved.original, ctx({ ageMs: UNDO_WINDOW_MINUTES * 60_000 }))).toBeNull();
  });

  it("refuses when the last entry is not this move, someone else asks, it is too old, or a SEQUENCE differs", () => {
    expect(undoProblem(moved.original, ctx({ record: null }))).toBe(MEETING_CHANGED);
    expect(undoProblem(moved.original, ctx({ callerUserId: GUEST }))).toMatchObject({ status: 403, code: "forbidden" });
    expect(undoProblem(moved.original, ctx({ ageMs: UNDO_WINDOW_MINUTES * 60_000 + 1 }))).toMatchObject({
      status: 409,
      code: "undo_expired",
    });
    expect(undoProblem({ ...moved.original, sequence: 4 }, ctx())).toBe(MEETING_CHANGED);
    expect(undoProblem(moved.original, ctx({ clientSequence: 1 }))).toBe(MEETING_CHANGED);
    expect(undoProblem({ ...moved.original, status: "cancelled" }, ctx())).toBe(MEETING_CHANGED);
  });

  it("restores start, length, end and exceptions from the record, SEQUENCE + 1, guests untouched", () => {
    const restored = undoneMeeting(moved.original, record);
    expect(restored).toMatchObject({
      start: "2026-11-19T08:30",
      durationMin: 60,
      until: "2027-06-30",
      sequence: 4,
      rescheduleSequence: 4,
      uid: before.uid,
    });
    expect(restored.exceptions).toEqual(before.exceptions);
    expect(restored.attendees).toEqual(moved.original.attendees);
  });

  it("puts an undone occurrence back at its earlier exception's time, or the series' own", () => {
    const earlier = moveAuditEntry(
      before,
      new Date(0),
      move({ planned: "2026-11-26T08:30" }),
      movedMeetings(before, move({ planned: "2026-11-26T08:30" }), ids),
    );
    expect(restoredOccurrence(earlier)).toEqual({
      recurrenceId: "2026-11-26T08:30",
      start: "2026-11-26T07:30",
      durationMin: 60,
    });
    const plain = moveAuditEntry(
      before,
      new Date(0),
      move({ planned: "2026-12-10T08:30" }),
      movedMeetings(before, move({ planned: "2026-12-10T08:30" }), ids),
    );
    expect(restoredOccurrence(plain)).toEqual({
      recurrenceId: "2026-12-10T08:30",
      start: "2026-12-10T08:30",
      durationMin: 60,
    });
  });
});
