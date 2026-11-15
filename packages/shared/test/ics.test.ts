import { describe, expect, it } from "vitest";
import {
  MEETINGS_PRODID,
  endOfDayUtc,
  foldLine,
  icsEscape,
  meetingIcs,
  meetingOccurrences,
  recurrenceProblem,
  type Attendee,
  type IcsInput,
  type Meeting,
} from "../src";

const guest = (patch: Partial<Attendee> = {}): Attendee => ({
  kind: "external",
  id: "g1",
  name: "Luis Moreno",
  email: "luis@builder.example",
  role: "required",
  partStat: "needs-action",
  respondedAt: null,
  respondedSequence: null,
  note: "",
  proposal: null,
  ...patch,
});
const meeting = (patch: Partial<Meeting> = {}): Meeting =>
  ({
    id: "m1",
    uid: "0b6f1d0e-7c3f-4a52-9a54-2f0e1a7d9c11",
    title: "Showroom walkthrough",
    start: "2026-11-12T10:00",
    durationMin: 30,
    location: "Showroom, floor 1",
    notes: "",
    recurrence: "none",
    until: null,
    reminderMin: 15,
    timeZone: "America/Denver",
    ...patch,
  }) as Meeting;
const input = (patch: Partial<IcsInput> = {}): IcsInput => ({
  method: "REQUEST",
  meeting: meeting(),
  sequence: 1,
  stamp: new Date("2026-11-10T15:30:00Z"),
  organizer: { name: "Dana Reyes", email: "dana@summit.example" },
  attendees: [guest()],
  status: "CONFIRMED",
  ...patch,
});

describe("calendar files (spec E, ADR 0021)", () => {
  it("writes a REQUEST with a stable UID, SEQUENCE, local times and a UTC stamp", () => {
    const text = meetingIcs(input());
    expect(text).toContain("METHOD:REQUEST\r\n");
    expect(text).toContain("UID:0b6f1d0e-7c3f-4a52-9a54-2f0e1a7d9c11\r\n");
    expect(text).toContain("SEQUENCE:1\r\n");
    expect(text).toContain("DTSTAMP:20261110T153000Z\r\n");
    expect(text).toContain("DTSTART;TZID=America/Denver:20261112T100000\r\n");
    expect(text).toContain("DTEND;TZID=America/Denver:20261112T103000\r\n");
    expect(text).toContain("TZID:America/Denver\r\n");
    expect(text).toContain("STATUS:CONFIRMED\r\n");
    expect(text).toContain("TRIGGER:-PT15M");
    expect(text).not.toContain("DURATION");
  });

  it("keeps the UID on an update and raises the SEQUENCE given", () => {
    const first = meetingIcs(input({ sequence: 0 }));
    const second = meetingIcs(input({ sequence: 3, meeting: meeting({ start: "2026-11-13T09:00" }) }));
    expect(second).toContain("SEQUENCE:3\r\n");
    expect(first.match(/UID:.*\r\n/)?.[0]).toBe(second.match(/UID:.*\r\n/)?.[0]);
  });

  it("a CANCEL has the method and status, and no reminder", () => {
    const text = meetingIcs(input({ method: "CANCEL", status: "CANCELLED", sequence: 4 }));
    expect(text).toContain("METHOD:CANCEL\r\n");
    expect(text).toContain("STATUS:CANCELLED\r\n");
    expect(text).not.toContain("VALARM");
  });

  it("a PUBLISH copy for your own calendar lists no attendees", () => {
    const text = meetingIcs(input({ method: "PUBLISH", attendees: [], status: undefined }));
    expect(text).toContain("METHOD:PUBLISH\r\n");
    expect(text).not.toContain("ATTENDEE");
    expect(text).toContain("ORGANIZER;");
  });

  it("marks one occurrence with RECURRENCE-ID and leaves the rule off it", () => {
    const text = meetingIcs(
      input({
        meeting: meeting({ recurrence: "weekly" }),
        recurrenceId: "2026-11-19T10:00",
        start: "2026-11-19T11:00",
      }),
    );
    expect(text).toContain("RECURRENCE-ID;TZID=America/Denver:20261119T100000\r\n");
    expect(text).toContain("DTSTART;TZID=America/Denver:20261119T110000\r\n");
    expect(text).not.toContain("RRULE:FREQ=WEEKLY");
  });

  it("writes the repeating rules, with UNTIL in UTC", () => {
    expect(meetingIcs(input({ meeting: meeting({ recurrence: "weekly" }) }))).toContain("RRULE:FREQ=WEEKLY\r\n");
    expect(meetingIcs(input({ meeting: meeting({ recurrence: "biweekly" }) }))).toContain(
      "RRULE:FREQ=WEEKLY;INTERVAL=2\r\n",
    );
    expect(meetingIcs(input({ meeting: meeting({ recurrence: "monthly" }) }))).toContain(
      "RRULE:FREQ=MONTHLY;BYDAY=2TH\r\n",
    );
    expect(endOfDayUtc("2026-11-30", "America/Denver")).toBe("20261201T065959Z");
    expect(meetingIcs(input({ meeting: meeting({ recurrence: "weekly", until: "2026-11-30" }) }))).toContain(
      "UNTIL=20261201T065959Z",
    );
  });

  it("refuses a monthly series that starts in a fifth week", () => {
    expect(recurrenceProblem("2026-10-29T10:00", "monthly")).toMatch(/fifth week/);
    expect(recurrenceProblem("2026-10-22T10:00", "monthly")).toBeNull();
    expect(recurrenceProblem("2026-10-29T10:00", "weekly")).toBeNull();
  });

  it("escapes text and folds long lines at 75 octets without splitting a character", () => {
    expect(icsEscape("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    const folded = foldLine(`SUMMARY:${"é".repeat(60)}`);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"é".repeat(60)}`);
    expect(folded).not.toContain("�");
  });

  it("lists the guest with their response", () => {
    const text = meetingIcs(input({ attendees: [guest({ partStat: "accepted", role: "optional" })] })).replace(
      /\r\n /g,
      "",
    );
    expect(text).toContain(
      'ATTENDEE;CN="Luis Moreno";ROLE=OPT-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:luis@builder.example',
    );
  });

  it("uses a daylight block in a zone with daylight time and none without", () => {
    expect(meetingIcs(input())).toContain("BEGIN:DAYLIGHT");
    expect(meetingIcs(input({ meeting: meeting({ timeZone: "America/Phoenix" }) }))).not.toContain("BEGIN:DAYLIGHT");
  });
});

/** The file's lines with folding undone. */
const unfolded = (text: string) => text.replace(/\r\n /g, "").split("\r\n");

describe("calendar files written safely (ADR 0051)", () => {
  it("never lets a name add a line: control characters go and quotes become apostrophes", () => {
    const text = meetingIcs(
      input({
        attendees: [guest({ name: 'A\r\nATTENDEE:mailto:x@y.z "boss"' })],
        organizer: { name: "Dana\nX-EVIL:1", email: "dana@summit.example" },
      }),
    );
    const lines = unfolded(text);
    expect(lines.filter((l) => l.startsWith("ATTENDEE"))).toEqual([
      "ATTENDEE;CN=\"AATTENDEE:mailto:x@y.z 'boss'\";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:luis@builder.example",
    ]);
    expect(lines).toContain('ORGANIZER;CN="DanaX-EVIL:1":mailto:dana@summit.example');
    expect(lines.some((l) => l.startsWith("X-EVIL"))).toBe(false);
  });

  it("drops a lone CR and other control characters from every text value", () => {
    const text = meetingIcs(
      input({
        meeting: meeting({
          title: "Huddle\rX-INJECT:1\u0007",
          location: "Room\u0000 2",
          notes: "Line one\r\nLine two\u2028",
        }),
      }),
    );
    const lines = unfolded(text);
    expect(lines).toContain("SUMMARY:HuddleX-INJECT:1");
    expect(lines).toContain("LOCATION:Room 2");
    expect(lines).toContain("DESCRIPTION:Line one\\nLine two");
    expect(lines.some((l) => l.startsWith("X-INJECT"))).toBe(false);
    for (const line of text.split("\r\n")) expect(line).not.toMatch(/[\r\n]/);
    expect(icsEscape("a\rb\u0001c\td")).toBe("abc\td");
  });

  it("writes no ATTENDEE or ORGANIZER line for an address that is not a valid one", () => {
    const text = meetingIcs(
      input({
        attendees: [
          guest(),
          guest({ id: "g2", email: "not-an-email" }),
          guest({ id: "g3", email: "x@y.z\r\nATTENDEE:mailto:evil@y.z" }),
          guest({ id: "g4", email: "" }),
        ],
        organizer: { name: "Dana", email: "dana@summit" },
      }),
    );
    expect(unfolded(text).filter((l) => l.startsWith("ATTENDEE"))).toHaveLength(1);
    expect(text).not.toContain("ORGANIZER");
    expect(text).not.toContain("evil@y.z");
  });

  it("keeps the demo's PRODID unless the caller passes the product-neutral one", () => {
    expect(meetingIcs(input())).toContain("PRODID:-//Flooring Suite//Demo//EN\r\n");
    expect(meetingIcs(input({ prodId: MEETINGS_PRODID }))).toContain("PRODID:-//Platform//Meetings//EN\r\n");
  });

  it("ends a meeting by real minutes across the autumn change, in UTC when local time would be read as the earlier hour", () => {
    const chicago = (start: string, durationMin: number) =>
      unfolded(meetingIcs(input({ meeting: meeting({ timeZone: "America/Chicago", start, durationMin }) }))).find((l) =>
        l.startsWith("DTEND"),
      );
    expect(chicago("2026-11-01T01:00", 90)).toBe("DTEND:20261101T073000Z");
    expect(chicago("2026-11-01T00:30", 60)).toBe("DTEND;TZID=America/Chicago:20261101T013000");
    expect(chicago("2027-03-14T01:30", 60)).toBe("DTEND;TZID=America/Chicago:20270314T033000");
    expect(chicago("2026-11-12T10:00", 30)).toBe("DTEND;TZID=America/Chicago:20261112T103000");
  });

  it("starts a day-30 monthly series at its second date, with the first as an RDATE, matching the app", () => {
    const safetyTalk = meeting({ start: "2026-09-30T13:00", durationMin: 60, recurrence: "monthly" });
    const lines = unfolded(meetingIcs(input({ meeting: safetyTalk })));
    expect(lines).toContain("DTSTART;TZID=America/Denver:20261028T130000");
    expect(lines).toContain("DTEND;TZID=America/Denver:20261028T140000");
    expect(lines).toContain("RRULE:FREQ=MONTHLY;BYDAY=4WE");
    expect(lines).toContain("RDATE;TZID=America/Denver:20260930T130000");
    const dates = meetingOccurrences(
      [{ ...safetyTalk, exceptions: [], status: "confirmed" }],
      "2026-09-01",
      "2027-03-31",
    );
    expect(dates.map((o) => o.start.slice(0, 10))).toEqual([
      "2026-09-30",
      "2026-10-28",
      "2026-11-25",
      "2026-12-23",
      "2027-01-27",
      "2027-02-24",
      "2027-03-24",
    ]);
    for (const o of dates.slice(1)) {
      const day = new Date(`${o.start.slice(0, 10)}T00:00:00Z`);
      expect([Math.ceil(day.getUTCDate() / 7), day.getUTCDay()], o.start).toEqual([4, 3]);
    }
  });

  it("writes a day-30 monthly series that ends before its second date as one event", () => {
    const lines = unfolded(
      meetingIcs(
        input({ meeting: meeting({ start: "2026-09-30T13:00", recurrence: "monthly", until: "2026-10-15" }) }),
      ),
    );
    expect(lines).toContain("DTSTART;TZID=America/Denver:20260930T130000");
    expect(lines.some((l) => l.startsWith("RRULE:FREQ=MONTHLY") || l.startsWith("RDATE"))).toBe(false);
  });

  it("keeps a fourth-week monthly series on its own date with no RDATE", () => {
    const lines = unfolded(
      meetingIcs(input({ meeting: meeting({ start: "2026-10-28T13:00", recurrence: "monthly" }) })),
    );
    expect(lines).toContain("DTSTART;TZID=America/Denver:20261028T130000");
    expect(lines).toContain("RRULE:FREQ=MONTHLY;BYDAY=4WE");
    expect(lines.some((l) => l.startsWith("RDATE"))).toBe(false);
  });

  it("writes STATUS:TENTATIVE when asked, for a request still waiting", () => {
    expect(meetingIcs(input({ status: "TENTATIVE" }))).toContain("STATUS:TENTATIVE\r\n");
  });

  it("refuses a zone it has no VTIMEZONE for instead of borrowing New York's", () => {
    expect(() => meetingIcs(input({ meeting: meeting({ timeZone: "Europe/London" }) }))).toThrow(/time zone/);
    expect(() => meetingIcs(input({ meeting: meeting({ timeZone: "America/Detroit" }) }))).toThrow(/time zone/);
  });

  it("folds every line of a long title within 75 octets", () => {
    const text = meetingIcs(input({ meeting: meeting({ title: "Grand opening 🎉 ".repeat(20) }) }));
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfolded(text).find((l) => l.startsWith("SUMMARY"))).toBe(`SUMMARY:${"Grand opening 🎉 ".repeat(20)}`);
  });

  it("caps a long name at 100 characters", () => {
    const text = meetingIcs(input({ attendees: [guest({ name: "N".repeat(300) })] }));
    expect(unfolded(text).find((l) => l.startsWith("ATTENDEE"))).toContain(`CN="${"N".repeat(100)}";`);
  });
});
