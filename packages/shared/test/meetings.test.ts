import { describe, expect, it } from "vitest";
import { attendeeConflicts, meetingOccurrences, moveOccurrence, type Meeting } from "../src";

const base = {
  id: "m",
  title: "Huddle",
  durationMin: 30,
  location: "",
  attendees: [],
  reminderMin: 15,
  ownerUserId: "u",
  notes: "",
  timeZone: "America/Denver",
  until: null,
  exceptions: [],
  uid: "uid",
  sequence: 0,
  rescheduleSequence: 0,
  status: "confirmed" as const,
  kind: "meeting" as const,
  private: false,
  hideGuestList: false,
  allowProposals: true,
};

describe("meeting occurrences", () => {
  it("repeats weekly, every two weeks and monthly from the first date", () => {
    const meetings: Meeting[] = [
      { ...base, id: "w", start: "2026-11-02T09:00", recurrence: "weekly" },
      { ...base, id: "b", start: "2026-11-03T09:00", recurrence: "biweekly" },
      { ...base, id: "m", start: "2026-10-15T09:00", recurrence: "monthly" },
      { ...base, id: "o", start: "2026-11-20T09:00", recurrence: "none" },
    ];
    const got = meetingOccurrences(meetings, "2026-11-01", "2026-11-30").map((o) => `${o.meeting.id} ${o.start}`);
    expect(got).toEqual([
      "w 2026-11-02T09:00",
      "b 2026-11-03T09:00",
      "w 2026-11-09T09:00",
      "w 2026-11-16T09:00",
      "b 2026-11-17T09:00",
      "m 2026-11-19T09:00",
      "o 2026-11-20T09:00",
      "w 2026-11-23T09:00",
      "w 2026-11-30T09:00",
    ]);
  });

  it("repeats monthly on the same weekday of the same week, never on a weekend", () => {
    const thirdThursday: Meeting = { ...base, start: "2026-10-15T09:00", recurrence: "monthly" };
    const fifthThursday: Meeting = { ...base, start: "2026-10-29T09:00", recurrence: "monthly" };
    const starts = (m: Meeting) => meetingOccurrences([m], "2026-11-01", "2027-01-31").map((o) => o.start);
    expect(starts(thirdThursday)).toEqual(["2026-11-19T09:00", "2026-12-17T09:00", "2027-01-21T09:00"]);
    expect(starts(fifthThursday)).toEqual(["2026-11-26T09:00", "2026-12-24T09:00", "2027-01-28T09:00"]);
  });
});

describe("moving meetings on the calendar (spec F)", () => {
  const weekly: Meeting = {
    ...base,
    id: "w",
    start: "2026-11-02T09:00",
    recurrence: "weekly",
    attendees: [
      {
        kind: "staff",
        id: "u1",
        name: "Dana",
        email: "dana@example.com",
        role: "required",
        partStat: "accepted",
        respondedAt: null,
        respondedSequence: null,
        note: "",
        proposal: null,
      },
    ],
  };
  const planned = "2026-11-09T09:00";
  const at = (ms: Meeting[], from: string, to: string) =>
    meetingOccurrences(ms, from, to).map((o) => `${o.start} ${o.durationMin}`);

  it("moves just this occurrence", () => {
    const [moved] = moveOccurrence(weekly, planned, { start: "2026-11-10T14:00", durationMin: 60 }, "this", "n");
    expect(at([moved!], "2026-11-02", "2026-11-17")).toEqual([
      "2026-11-02T09:00 30",
      "2026-11-10T14:00 60",
      "2026-11-16T09:00 30",
    ]);
  });

  it("moves this and the following ones by splitting the series", () => {
    const [old, next] = moveOccurrence(
      weekly,
      planned,
      { start: "2026-11-09T10:00", durationMin: 30 },
      "following",
      "n",
    );
    expect(old!.until).toBe("2026-11-08");
    expect(at([old!, next!], "2026-11-02", "2026-11-17")).toEqual([
      "2026-11-02T09:00 30",
      "2026-11-09T10:00 30",
      "2026-11-16T10:00 30",
    ]);
  });

  it("shifts every occurrence", () => {
    const [all] = moveOccurrence(weekly, planned, { start: "2026-11-09T08:30", durationMin: 45 }, "all", "n");
    expect(at([all!], "2026-11-02", "2026-11-09")).toEqual(["2026-11-02T08:30 45", "2026-11-09T08:30 45"]);
  });

  it("warns when an attendee is already booked at the new time", () => {
    const other: Meeting = {
      ...weekly,
      id: "o",
      title: "Supplier call",
      recurrence: "none",
      start: "2026-11-10T14:30",
    };
    const hits = attendeeConflicts([weekly, other], {
      meetingId: "w",
      planned,
      start: "2026-11-10T14:00",
      durationMin: 60,
      attendees: weekly.attendees,
    });
    expect(hits).toEqual([{ name: "Dana", title: "Supplier call", start: "2026-11-10T14:30" }]);
    expect(
      attendeeConflicts([weekly, other], {
        meetingId: "w",
        planned,
        start: "2026-11-10T16:00",
        durationMin: 30,
        attendees: weekly.attendees,
      }),
    ).toEqual([]);
  });
});
