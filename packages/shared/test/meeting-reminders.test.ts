import { describe, expect, it } from "vitest";
import { nextOccurrence, nextReminder, reminderRecipients, type Meeting } from "../src";
import { GUEST, testMeeting } from "./meeting-fixtures";

const iso = (d: Date | undefined) => d?.toISOString() ?? null;
const reminderAt = (meeting: Meeting, now: string) => iso(nextReminder(meeting, new Date(now))?.scheduledFor);
const huddle = (patch: Partial<Meeting> = {}) =>
  testMeeting({ title: "Weekly sales huddle", start: "2026-10-02T14:00", recurrence: "weekly", ...patch });

describe("the next reminder (meetings.md rule 10, ADR 0051 Reminders)", () => {
  it("goes out reminderMin before a one-off meeting and expires when it starts", () => {
    const reminder = nextReminder(testMeeting(), new Date("2026-11-15T12:00:00Z"));
    expect(reminder?.occurrence.start).toBe("2026-11-19T08:30");
    expect(iso(reminder?.scheduledFor)).toBe("2026-11-19T15:15:00.000Z");
    expect(iso(reminder?.expiresAt)).toBe("2026-11-19T15:30:00.000Z");
  });

  it("is skipped once its time has come, as the spec says", () => {
    expect(reminderAt(testMeeting(), "2026-11-19T15:15:00Z")).toBeNull();
    expect(reminderAt(testMeeting(), "2026-11-19T15:20:00Z")).toBeNull();
    expect(reminderAt(testMeeting(), "2026-11-19T15:14:59Z")).toBe("2026-11-19T15:15:00.000Z");
  });

  it("follows each occurrence's own local time across the autumn change", () => {
    expect(reminderAt(huddle(), "2026-10-30T00:00:00Z")).toBe("2026-10-30T19:45:00.000Z");
    expect(reminderAt(huddle(), "2026-11-01T00:00:00Z")).toBe("2026-11-06T20:45:00.000Z");
    expect(reminderAt(huddle(), "2026-11-15T12:00:00Z")).toBe("2026-11-20T20:45:00.000Z");
  });

  it("moves to the following occurrence when this one's reminder time has passed", () => {
    const reminder = nextReminder(huddle(), new Date("2026-11-20T20:50:00Z"));
    expect(reminder?.occurrence.start).toBe("2026-11-27T14:00");
    expect(iso(reminder?.scheduledFor)).toBe("2026-11-27T20:45:00.000Z");
  });

  it("places an occurrence in the spring gap where calendars put it", () => {
    const sunday = testMeeting({ start: "2027-03-07T02:30", recurrence: "weekly", timeZone: "America/Chicago" });
    const reminder = nextReminder(sunday, new Date("2027-03-10T00:00:00Z"));
    expect(reminder?.occurrence.start).toBe("2027-03-14T02:30");
    expect(iso(reminder?.expiresAt)).toBe("2027-03-14T08:30:00.000Z");
    expect(iso(reminder?.scheduledFor)).toBe("2027-03-14T08:15:00.000Z");
  });

  it("has none for a cancelled meeting, a request still waiting, or a series that has ended", () => {
    const now = "2026-11-15T12:00:00Z";
    expect(reminderAt(testMeeting({ status: "cancelled" }), now)).toBeNull();
    expect(reminderAt(testMeeting({ kind: "request", status: "tentative" }), now)).toBeNull();
    expect(reminderAt(testMeeting({ kind: "request", status: "confirmed" }), now)).toBe("2026-11-19T15:15:00.000Z");
    expect(reminderAt(huddle({ until: "2026-11-10" }), now)).toBeNull();
  });

  it("skips a cancelled occurrence and follows a moved one", () => {
    const now = "2026-11-15T12:00:00Z";
    expect(reminderAt(huddle({ exceptions: [{ planned: "2026-11-20T14:00", cancelled: true }] }), now)).toBe(
      "2026-11-27T20:45:00.000Z",
    );
    expect(reminderAt(huddle({ exceptions: [{ planned: "2026-11-20T14:00", start: "2026-11-20T16:00" }] }), now)).toBe(
      "2026-11-20T22:45:00.000Z",
    );
  });

  it("still finds a one-off meeting more than a year away", () => {
    expect(reminderAt(testMeeting({ start: "2028-06-01T09:00" }), "2026-11-15T12:00:00Z")).toBe(
      "2028-06-01T14:45:00.000Z",
    );
  });

  it("goes to staff guests only, never the organiser", () => {
    expect(reminderRecipients(testMeeting()).map((a) => a.id)).toEqual([GUEST]);
  });
});

describe("the next occurrence on My meetings (ADR 0051)", () => {
  it("shows a series' next date, not its first", () => {
    expect(nextOccurrence(huddle(), "2026-11-15")).toMatchObject({
      start: "2026-11-20T14:00",
      planned: "2026-11-20T14:00",
    });
    expect(iso(nextOccurrence(huddle(), "2026-11-15")?.startsAt)).toBe("2026-11-20T21:00:00.000Z");
  });

  it("keeps today's meeting all day, and has none for a past, cancelled or far meeting", () => {
    expect(nextOccurrence(testMeeting(), "2026-11-19")?.start).toBe("2026-11-19T08:30");
    expect(nextOccurrence(testMeeting(), "2026-11-20")).toBeNull();
    expect(nextOccurrence(testMeeting({ status: "cancelled" }), "2026-11-15")).toBeNull();
    expect(nextOccurrence(testMeeting({ start: "2028-06-01T09:00" }), "2026-11-15")).toBeNull();
  });
});
