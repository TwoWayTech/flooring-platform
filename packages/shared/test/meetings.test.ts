import { describe, expect, it } from "vitest";
import {
  addDays,
  attendeeConflicts,
  meetingOccurrences,
  moveOccurrence,
  nextPlannedStart,
  onSeriesRule,
  type Meeting,
  type MeetingException,
  type MeetingOccurrence,
} from "../src";

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

/**
 * The walk `meetingOccurrences` made before review round 1 of PR #35: every planned date from the
 * series' first one. It is kept only as the reference the windowed rule must match exactly.
 */
function walkedOccurrences(meetings: readonly Meeting[], from: string, to: string): MeetingOccurrence[] {
  const out: MeetingOccurrence[] = [];
  for (const meeting of meetings) {
    if (meeting.status === "cancelled") continue;
    for (
      let planned: string | null = meeting.start;
      planned && planned.slice(0, 10) <= addDays(to, 31) && (!meeting.until || planned.slice(0, 10) <= meeting.until);
      planned = nextPlannedStart(planned, meeting.recurrence)
    ) {
      const moved = meeting.exceptions?.find((e) => e.planned === planned);
      if (moved?.cancelled) continue;
      const start = moved?.start ?? planned;
      const day = start.slice(0, 10);
      if (day >= from && day <= to)
        out.push({ meeting, start, durationMin: moved?.durationMin ?? meeting.durationMin, planned });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** A repeatable sequence of whole numbers (mulberry32), so the comparison below covers many shapes the same way each run. */
function numbers(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

describe("occurrences worked out from the window (ADR 0051 Part 2, review round 1 of PR #35)", () => {
  const recurrences: Meeting["recurrence"][] = ["none", "weekly", "biweekly", "monthly"];
  const shape = (o: MeetingOccurrence) => `${o.meeting.id} ${o.planned} ${o.start} ${o.durationMin}`;

  it("finds exactly what walking every series from its first date finds", () => {
    const next = numbers(51);
    const pick = <T>(list: readonly T[]) => list[next() % list.length]!;
    const seen = { occurrences: 0, moved: 0 };
    for (let round = 0; round < 400; round++) {
      const meetings: Meeting[] = Array.from({ length: 6 }, (_, i) => {
        const start = `${addDays("2026-01-01", next() % 400)}T${pick(["08:30", "13:00"])}`;
        const meeting: Meeting = {
          ...base,
          id: `m${i}`,
          start,
          recurrence: pick(recurrences),
          until: next() % 4 === 0 ? addDays(start, next() % 400) : null,
          exceptions: [],
        };
        const planned: string[] = [start];
        for (let p = nextPlannedStart(start, meeting.recurrence); p && planned.length < 40;) {
          planned.push(p);
          p = nextPlannedStart(p, meeting.recurrence);
        }
        const exceptions: MeetingException[] = Array.from({ length: next() % 6 }, () => {
          const key = next() % 5 === 0 ? `${addDays(start, next() % 90)}T09:15` : pick(planned);
          const kind = next() % 4;
          if (kind === 0) return { planned: key, cancelled: true };
          if (kind === 1) return { planned: key };
          return { planned: key, start: `${addDays(key, (next() % 90) - 45)}T11:00`, durationMin: 45 };
        });
        return { ...meeting, exceptions, status: next() % 9 === 0 ? "cancelled" : "confirmed" };
      });
      const from = addDays("2026-01-01", next() % 500);
      const to = addDays(from, pick([0, 6, 30, 120, 365]));
      const walked = walkedOccurrences(meetings, from, to);
      expect(meetingOccurrences(meetings, from, to).map(shape), `round ${round}`).toEqual(walked.map(shape));
      seen.occurrences += walked.length;
      seen.moved += walked.filter((o) => o.start !== o.planned).length;
    }
    // The comparison is not empty: many occurrences, moved ones among them.
    expect(seen.occurrences).toBeGreaterThan(1000);
    expect(seen.moved).toBeGreaterThan(50);
  });

  it("knows a monthly series' dates directly, the fifth week moved to the fourth", () => {
    const fifthThursday: Meeting = { ...base, start: "2026-10-29T09:00", recurrence: "monthly" };
    expect(onSeriesRule(fifthThursday, "2026-10-29T09:00")).toBe(true);
    expect(onSeriesRule(fifthThursday, "2031-07-24T09:00")).toBe(true);
    expect(onSeriesRule(fifthThursday, "2031-07-31T09:00")).toBe(false);
    expect(onSeriesRule(fifthThursday, "2026-10-22T09:00")).toBe(false);
    expect(onSeriesRule(fifthThursday, "2026-13-24T09:00")).toBe(false);
  });

  it("costs the same for a series that began centuries before the window", () => {
    const old = Array.from({ length: 200 }, (_, i): Meeting => ({
      ...base,
      id: `old-${i}`,
      start: "1900-01-01T07:00",
      recurrence: i % 2 ? "weekly" : "monthly",
    }));
    const began = performance.now();
    // 2 December 2999 is a Monday in the first week, so every one of them meets that day.
    const found = meetingOccurrences(old, "2999-12-02", "2999-12-02");
    // The walk from 1900 took about 16 seconds here (review round 1 of PR #35); the window takes milliseconds.
    expect(performance.now() - began).toBeLessThan(250);
    expect(found.map((o) => o.start)).toEqual(Array.from({ length: 200 }, () => "2999-12-02T07:00"));
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
