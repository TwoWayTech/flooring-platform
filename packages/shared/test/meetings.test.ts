import { describe, expect, it } from "vitest";
import { meetingOccurrences, type Meeting } from "../src";

const base = {
  id: "m",
  title: "Huddle",
  durationMin: 30,
  location: "",
  attendees: [],
  reminderMin: 15,
  ownerUserId: "u",
  notes: "",
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
