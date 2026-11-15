import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEETING_SETTINGS,
  MEETING_LIMITS,
  dailyInviteProblem,
  guestLimitProblem,
  meetingFieldsProblem,
  meetingRequestProblem,
  newGuestProblem,
  normalizeGuestEmail,
  proposalProblem,
  replyProblem,
  validGuestEmail,
  type Meeting,
  type MeetingFields,
} from "../src";
import { testMeeting } from "./meeting-fixtures";

const DENVER = { zone: "America/Denver", recurrence: "none" as const };
const fields: MeetingFields = {
  title: "Huddle",
  start: "2026-11-19T08:30",
  durationMin: 30,
  location: "Room 2",
  notes: "",
  reminderMin: 15,
  recurrence: "none",
};
const problem = (patch: Partial<MeetingFields>) => meetingFieldsProblem({ ...fields, ...patch }, DENVER);

describe("meeting fields (meetings.md, ADR 0051 Input limits)", () => {
  it("accepts a normal meeting", () => {
    expect(problem({})).toBeNull();
    expect(problem({ notes: "Line one\nLine two\r\n\tIndented" })).toBeNull();
    expect(problem({ title: "T".repeat(200), durationMin: 1440, reminderMin: 60 })).toBeNull();
  });

  it("needs a title of at most 200 characters on one line", () => {
    expect(problem({ title: "  " })).toMatch(/title/);
    expect(problem({ title: "T".repeat(201) })).toMatch(/200/);
    expect(problem({ title: "Huddle\r\nBcc: x@y.z" })).toMatch(/line breaks/);
  });

  it("needs a start that exists in the zone, and a monthly start in the first four weeks", () => {
    expect(problem({ start: "2026-11-19 08:30" })).toMatch(/date and a start time/);
    expect(problem({ start: "2026-02-30T08:30" })).toMatch(/date and a start time/);
    expect(problem({ start: "2027-03-14T02:30" })).toMatch(/doesn't exist/);
    expect(problem({ start: "2026-10-29T10:00", recurrence: "monthly" })).toMatch(/fifth week/);
    expect(meetingFieldsProblem({ start: "2026-10-29T10:00" }, { ...DENVER, recurrence: "monthly" })).toMatch(
      /fifth week/,
    );
  });

  it("bounds the length, the reminder, the place and the notes", () => {
    expect(problem({ durationMin: 14 })).toMatch(/15 minutes/);
    expect(problem({ durationMin: 1441 })).toMatch(/24 hours/);
    expect(problem({ durationMin: 30.5 })).toMatch(/whole minutes/);
    expect(problem({ reminderMin: 20 })).toMatch(/10, 15, 30 or 60/);
    expect(problem({ location: "L".repeat(201) })).toMatch(/200/);
    expect(problem({ notes: "N".repeat(4001) })).toMatch(/4000/);
    expect(problem({ notes: "Bell\u0007" })).toMatch(/control/);
    expect(problem({ recurrence: "daily" as unknown as Meeting["recurrence"] })).toMatch(/repeats/);
  });

  it("checks only the fields given, so a title edit on a day-30 monthly series passes", () => {
    expect(meetingFieldsProblem({ title: "Safety talk" }, { ...DENVER, recurrence: "monthly" })).toBeNull();
    expect(meetingFieldsProblem({}, DENVER)).toBeNull();
  });

  it("counts characters, not UTF-16 units, against the limits", () => {
    expect(problem({ title: "🎉".repeat(200) })).toBeNull();
  });
});

describe("guests added by address", () => {
  it("accepts only plain, short addresses that can't break a line or a header", () => {
    for (const ok of ["luis@builder.example", "a.b+tag@sub.example.co", "ünï@example.com"])
      expect(validGuestEmail(ok), ok).toBe(true);
    for (const bad of [
      "",
      "a@b",
      "a b@c.de",
      "a@b.c\r\nBcc:x@y.z",
      '"quoted"@example.com',
      "a;b@example.com",
      "<a@example.com>",
      "a@b@example.com",
      `${"a".repeat(250)}@b.cd`,
    ])
      expect(validGuestEmail(bad), bad).toBe(false);
    expect(normalizeGuestEmail("  Luis@Builder.Example ")).toBe("luis@builder.example");
  });

  it("needs a valid address and a short one-line name", () => {
    expect(newGuestProblem({ email: " riley@builder.example ", name: "Riley Chen" })).toBeNull();
    expect(newGuestProblem({ email: "riley", name: "" })).toMatch(/not a valid email/);
    expect(newGuestProblem({ email: "riley@builder.example", name: "R".repeat(101) })).toMatch(/100/);
    expect(newGuestProblem({ email: "riley@builder.example", name: "Riley\nChen" })).toMatch(/line breaks/);
  });

  it("caps a meeting at 50 guests and 20 from outside the company", () => {
    expect(guestLimitProblem({ guests: 50, emailGuests: 20 })).toBeNull();
    expect(guestLimitProblem({ guests: 51, emailGuests: 0 })).toMatch(/50 guests/);
    expect(guestLimitProblem({ guests: 21, emailGuests: 21 })).toMatch(/20 guests from outside/);
  });

  it("caps one person at 50 outside addresses a day", () => {
    expect(MEETING_LIMITS.emailGuestsPerDay).toBe(50);
    expect(dailyInviteProblem(45, 5)).toBeNull();
    expect(dailyInviteProblem(45, 6)).toMatch(/50 people/);
    expect(dailyInviteProblem(60, 0)).toBeNull();
  });
});

describe("answers and proposals (meetings.md rule 8, ADR 0051)", () => {
  const reply = (patch: Partial<Parameters<typeof replyProblem>[1]> = {}) => ({
    partStat: "accepted",
    note: "",
    proposal: null,
    ...patch,
  });

  it("takes Accept, Maybe or Decline with a short note", () => {
    for (const partStat of ["accepted", "tentative", "declined"])
      expect(replyProblem(testMeeting(), reply({ partStat }))).toBeNull();
    expect(replyProblem(testMeeting(), reply({ partStat: "needs-action" }))).toMatch(/Accept, Maybe or Decline/);
    expect(replyProblem(testMeeting(), reply({ partStat: "maybe" }))).toMatch(/Accept, Maybe or Decline/);
    expect(replyProblem(testMeeting(), reply({ note: "N".repeat(501) }))).toMatch(/500/);
    expect(replyProblem(testMeeting({ status: "cancelled" }), reply())).toMatch(/cancelled/);
  });

  it("takes a proposal only on a one-off meeting that allows them, at a time that exists", () => {
    const proposal = { start: "2026-11-20T09:00", durationMin: 60, note: "" };
    expect(replyProblem(testMeeting(), reply({ partStat: "tentative", proposal }))).toBeNull();
    expect(proposalProblem(testMeeting({ allowProposals: false }), proposal)).toMatch(/does not take/);
    expect(proposalProblem(testMeeting({ recurrence: "weekly" }), proposal)).toMatch(/does not take/);
    expect(proposalProblem(testMeeting(), { ...proposal, start: "2027-03-14T02:15" })).toMatch(/doesn't exist/);
    expect(proposalProblem(testMeeting(), { ...proposal, durationMin: 10 })).toMatch(/15 minutes/);
    expect(proposalProblem(testMeeting(), { ...proposal, note: "N".repeat(501) })).toMatch(/500/);
  });
});

describe("requests and defaults", () => {
  it("needs a subject, a start that exists and a short note", () => {
    expect(
      meetingRequestProblem({ title: "Review my goals", start: "2026-11-20T14:00", note: "" }, "America/Denver"),
    ).toBeNull();
    expect(meetingRequestProblem({ title: " ", start: "2026-11-20T14:00", note: "" }, "America/Denver")).toMatch(
      /about/,
    );
    expect(meetingRequestProblem({ title: "Goals", start: "2027-03-14T02:30", note: "" }, "America/Denver")).toMatch(
      /doesn't exist/,
    );
  });

  it("falls back to the safest meeting settings", () => {
    expect(DEFAULT_MEETING_SETTINGS).toEqual({
      defaultReminderMin: 15,
      newGuestHandling: "none",
      allowProposals: false,
      hideGuestList: true,
    });
  });
});
