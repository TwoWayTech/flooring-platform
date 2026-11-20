import { describe, expect, it } from "vitest";
import {
  MEETING_TIME_ZONES,
  dayInZone,
  isKnownTimeZone,
  instantToZoned,
  isLocalDateTime,
  meetingIcs,
  supportedMeetingZone,
  zonedToInstant,
  zonedToInstantLenient,
  type Meeting,
  type MeetingTimeZone,
} from "../src";

const at = (local: string, zone: string) => zonedToInstant(local, zone).instant?.toISOString() ?? null;

/** The UTC offset a zone's clock shows at an instant, as "-0700". */
function offsetText(instant: Date, zone: string): string {
  const minutes = (Date.parse(`${instantToZoned(instant, zone)}:00Z`) - instant.getTime()) / 60000;
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
}

/** The STANDARD and DAYLIGHT offsets the calendar file writes for a zone. */
function fileOffsets(zone: MeetingTimeZone): { std: string; dst: string | null } {
  const text = meetingIcs({
    method: "PUBLISH",
    meeting: {
      uid: "u",
      title: "t",
      start: "2026-11-12T10:00",
      durationMin: 30,
      location: "",
      notes: "",
      recurrence: "none",
      until: null,
      reminderMin: 15,
      timeZone: zone,
    } as Meeting,
    sequence: 0,
    stamp: new Date("2026-11-10T00:00:00Z"),
    organizer: { name: "O", email: "o@example.com" },
    attendees: [],
  });
  const block = (name: string) =>
    new RegExp(`BEGIN:${name}\\r\\n(?:.*\\r\\n)*?TZOFFSETTO:([-+]\\d{4})`).exec(text)?.[1];
  return { std: block("STANDARD") ?? "", dst: block("DAYLIGHT") ?? null };
}

/** The n-th Sunday of a month, as YYYY-MM-DD. */
function nthSunday(year: number, month: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((7 - first) % 7) + (n - 1) * 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("local times in a zone (ADR 0051 Time zones)", () => {
  it("converts both ways in all seven zones, summer and winter", () => {
    for (const zone of MEETING_TIME_ZONES) {
      for (const local of ["2026-07-15T09:00", "2026-12-15T17:45", "2027-01-01T00:00", "2026-11-02T23:59"]) {
        const placed = zonedToInstant(local, zone);
        expect(placed.problem, `${zone} ${local}`).toBeNull();
        expect(instantToZoned(placed.instant!, zone), `${zone} ${local}`).toBe(local);
      }
    }
  });

  it("places known times on the right instant", () => {
    expect(at("2026-11-02T09:00", "America/Chicago")).toBe("2026-11-02T15:00:00.000Z");
    expect(at("2026-10-02T14:00", "America/Denver")).toBe("2026-10-02T20:00:00.000Z");
    expect(at("2026-11-19T08:30", "America/Denver")).toBe("2026-11-19T15:30:00.000Z");
    expect(at("2026-07-01T09:00", "America/Phoenix")).toBe("2026-07-01T16:00:00.000Z");
    expect(at("2026-07-01T09:00", "Pacific/Honolulu")).toBe("2026-07-01T19:00:00.000Z");
  });

  it("refuses a time the clocks skip in spring, and the lenient reading uses the offset before the gap", () => {
    expect(zonedToInstant("2027-03-14T02:30", "America/Chicago")).toEqual({ instant: null, problem: "nonexistent" });
    expect(zonedToInstant("2027-03-14T02:00", "America/Chicago").problem).toBe("nonexistent");
    expect(at("2027-03-14T03:00", "America/Chicago")).toBe("2027-03-14T08:00:00.000Z");
    const lenient = zonedToInstantLenient("2027-03-14T02:30", "America/Chicago");
    expect(lenient?.toISOString()).toBe("2027-03-14T08:30:00.000Z");
    expect(instantToZoned(lenient!, "America/Chicago")).toBe("2027-03-14T03:30");
    expect(at("2027-03-14T02:30", "America/Phoenix")).toBe("2027-03-14T09:30:00.000Z");
  });

  it("reads a time the clocks show twice in autumn as the earlier one (RFC 5545 3.3.5)", () => {
    const first = zonedToInstant("2026-11-01T01:30", "America/Chicago").instant!;
    expect(first.toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(instantToZoned(new Date(first.getTime() + 3_600_000), "America/Chicago")).toBe("2026-11-01T01:30");
    expect(zonedToInstantLenient("2026-11-01T01:30", "America/Chicago")).toEqual(first);
  });

  it("refuses text that is not a real local date-time", () => {
    for (const text of [
      "2026-02-30T10:00",
      "2026-11-01T24:00",
      "2026-11-01T10:60",
      "2026-11-01 10:00",
      "2026-11-01T10:00:00",
      "2026-11-01T10:00Z",
      "",
      "0099-01-01T00:00",
      "3000-01-01T00:00",
    ]) {
      expect(zonedToInstant(text, "America/Denver").problem, text).toBe("malformed");
      expect(zonedToInstantLenient(text, "America/Denver"), text).toBeNull();
      expect(isLocalDateTime(text), text).toBe(false);
    }
    expect(isLocalDateTime("2028-02-29T10:00")).toBe(true);
  });

  it("says when Intl doesn't know the zone", () => {
    expect(zonedToInstant("2026-11-01T10:00", "Mars/Olympus").problem).toBe("unknown_zone");
    expect(zonedToInstantLenient("2026-11-01T10:00", "Mars/Olympus")).toBeNull();
  });
});

describe("zones a meeting can be booked in", () => {
  it("accepts the seven zones under their own names, in any letter case", () => {
    for (const zone of MEETING_TIME_ZONES) expect(supportedMeetingZone(zone)).toBe(zone);
    expect(supportedMeetingZone("america/denver")).toBe("America/Denver");
  });

  it("refuses a zone that only shares offsets with one, and anything else", () => {
    for (const zone of [
      "America/Detroit",
      "America/Boise",
      "America/Puerto_Rico",
      "Europe/London",
      "UTC",
      "EST5EDT",
      "",
      "Not/AZone",
    ]) {
      expect(supportedMeetingZone(zone), zone).toBeNull();
    }
  });

  it("maps an alias only to its own zone, never to another one", () => {
    const aliases: Record<string, MeetingTimeZone> = {
      "US/Eastern": "America/New_York",
      "US/Mountain": "America/Denver",
      "US/Arizona": "America/Phoenix",
      "US/Hawaii": "Pacific/Honolulu",
    };
    for (const [alias, zone] of Object.entries(aliases)) expect([zone, null]).toContain(supportedMeetingZone(alias));
  });

  it("writes the offsets Intl uses, and the US switch days, for 2026 to 2030", () => {
    for (const zone of MEETING_TIME_ZONES) {
      const file = fileOffsets(zone);
      for (let year = 2026; year <= 2030; year++) {
        expect(offsetText(new Date(Date.UTC(year, 0, 15, 12)), zone), `${zone} ${year} winter`).toBe(file.std);
        expect(offsetText(new Date(Date.UTC(year, 6, 15, 12)), zone), `${zone} ${year} summer`).toBe(
          file.dst ?? file.std,
        );
        const spring = `${nthSunday(year, 3, 2)}T02:30`;
        const autumn = zonedToInstant(`${nthSunday(year, 11, 1)}T01:30`, zone).instant!;
        const twice =
          instantToZoned(new Date(autumn.getTime() + 3_600_000), zone) === `${nthSunday(year, 11, 1)}T01:30`;
        expect(zonedToInstant(spring, zone).problem, `${zone} ${spring}`).toBe(file.dst ? "nonexistent" : null);
        expect(twice, `${zone} ${year} autumn`).toBe(file.dst !== null);
      }
    }
  });
});

describe("dayInZone: the company's day (ADR 0051, the company's day on the web)", () => {
  it("reads Denver's evening as Denver's day while Tokyo and UTC are already on the next", () => {
    // 23:59 in Denver on November 20th (MST, UTC-7) is 06:59 UTC and 15:59 in Tokyo on the 21st.
    const evening = new Date("2026-11-21T06:59:00Z");
    expect(dayInZone(evening, "America/Denver")).toBe("2026-11-20");
    expect(dayInZone(evening, "UTC")).toBe("2026-11-21");
    expect(dayInZone(evening, "Asia/Tokyo")).toBe("2026-11-21");
  });

  it("rolls over exactly at the zone's midnight", () => {
    expect(dayInZone(new Date("2026-11-21T06:59:59.999Z"), "America/Denver")).toBe("2026-11-20");
    expect(dayInZone(new Date("2026-11-21T07:00:00Z"), "America/Denver")).toBe("2026-11-21");
  });

  it("follows daylight saving time: midnight in Denver is 06:00 UTC in summer", () => {
    expect(dayInZone(new Date("2026-07-15T05:59:00Z"), "America/Denver")).toBe("2026-07-14");
    expect(dayInZone(new Date("2026-07-15T06:00:00Z"), "America/Denver")).toBe("2026-07-15");
  });

  it("agrees with Intl's own day for every meeting zone across a year", () => {
    for (const zone of MEETING_TIME_ZONES) {
      for (let hour = 0; hour < 365 * 24; hour += 7) {
        const moment = new Date(Date.UTC(2026, 0, 1) + hour * 3_600_000);
        const intl = new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        expect(dayInZone(moment, zone), `${zone} ${moment.toISOString()}`).toBe(intl.format(moment));
      }
    }
  });

  it("agrees with Intl for UTC and zones with half-hour, 45-minute and southern summer time offsets, at their switches", () => {
    const zones = [
      "UTC",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Australia/Lord_Howe",
      "America/St_Johns",
      "Pacific/Chatham",
    ];
    // Every 13 minutes across a year, so each zone's summer time switches are crossed close up.
    for (const zone of zones) {
      const intl = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      for (let minute = 0; minute < 365 * 24 * 60; minute += 13) {
        const moment = new Date(Date.UTC(2026, 0, 1) + minute * 60_000);
        expect(dayInZone(moment, zone), `${zone} ${moment.toISOString()}`).toBe(intl.format(moment));
      }
    }
  });

  it("keeps the day until the last millisecond before the zone's midnight", () => {
    expect(dayInZone(new Date("2026-11-21T06:59:59.999Z"), "America/Denver")).toBe("2026-11-20");
    expect(dayInZone(new Date("2026-11-20T23:59:59.999Z"), "UTC")).toBe("2026-11-20");
  });

  it("reads a year below 100 as that year, not as 19xx", () => {
    expect(dayInZone(new Date("0050-06-01T12:00:00Z"), "UTC")).toBe("0050-06-01");
  });

  it("throws a RangeError for an invalid date, as Intl does", () => {
    expect(() => dayInZone(new Date(Number.NaN), "America/Denver")).toThrow(RangeError);
  });

  it("throws for a zone Intl doesn't know, which isKnownTimeZone reports", () => {
    expect(() => dayInZone(new Date(), "Mars/Olympus_Mons")).toThrow(RangeError);
    expect(isKnownTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isKnownTimeZone("")).toBe(false);
    expect(isKnownTimeZone("America/Denver")).toBe(true);
    expect(isKnownTimeZone("UTC")).toBe(true);
  });
});
