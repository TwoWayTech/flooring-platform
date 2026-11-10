import { describe, expect, it } from "vitest";
import {
  endOfDayUtc,
  foldLine,
  icsEscape,
  meetingIcs,
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
