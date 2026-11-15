import { moveAuditEntry, movedMeetings, type Meeting, type MeetingMoveInput } from "@workspace/shared";
import { describe, expect, it } from "vitest";
import { parseMoveRecord } from "../src/modules/meetings/meeting-undo";

const series = {
  id: "0193a0a0-0000-7000-8000-000000000001",
  title: "Crew huddle",
  start: "2027-11-10T09:00",
  durationMin: 60,
  location: "Yard",
  attendees: [],
  recurrence: "weekly",
  reminderMin: 15,
  ownerUserId: "0193a0a0-0000-7000-8000-000000000002",
  notes: "",
  timeZone: "America/Chicago",
  until: null,
  exceptions: [{ planned: "2027-11-17T09:00", start: "2027-11-18T10:00", durationMin: 30 }],
  uid: "9b0c6c44-3c1b-4a8e-9f3e-2d5f8a7b6c10",
  sequence: 2,
  rescheduleSequence: 1,
  status: "confirmed",
  kind: "meeting",
  private: false,
  hideGuestList: false,
  allowProposals: false,
} satisfies Meeting;
const move: MeetingMoveInput = {
  planned: "2027-11-24T09:00",
  start: "2027-11-24T10:00",
  durationMin: 45,
  scope: "following",
};
const record = moveAuditEntry(
  series,
  new Date("2027-11-10T15:00:00.000Z"),
  move,
  movedMeetings(series, move, { newId: "0193a0a0-0000-7000-8000-000000000003", newUid: "uid" }),
);
const stored = { ...record.after, sends: { outside: 0, total: 2 } };

/** Undo reads its own "Moved meeting" entry back through a strict schema (ADR 0051 "Part 2", critic B3). */
describe("reading a move's audit entry back for undo", () => {
  it("gives back the record the move wrote", () => {
    expect(parseMoveRecord(record.before, stored)).toEqual(record);
  });

  it("refuses anything that is not exactly a move record", () => {
    const bad: [unknown, unknown][] = [
      [null, stored],
      [record.before, record.after],
      [{ ...record.before, title: "Crew huddle" }, stored],
      [{ ...record.before, planned: "2027-11-24 09:00" }, stored],
      [{ ...record.before, series: { ...record.before.series, startsAt: "yesterday" } }, stored],
      [{ ...record.before, series: { ...record.before.series, exceptions: [{ date: "2027-11-17" }] } }, stored],
      [record.before, { ...stored, scope: "every" }],
      [record.before, { ...stored, createdIds: [series.id, series.ownerUserId] }],
      [record.before, { ...stored, createdIds: ["not-a-uuid"] }],
      [record.before, { ...stored, sequence: -1 }],
    ];
    for (const [before, after] of bad)
      expect(parseMoveRecord(before, after), JSON.stringify([before, after])).toBeNull();
  });
});
