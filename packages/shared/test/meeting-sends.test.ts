import { describe, expect, it } from "vitest";
import {
  OUTBOX_RECIPIENT_KIND,
  cancelledMeeting,
  editedMeeting,
  icsFileName,
  inviteValues,
  inviteVersion,
  meetingIcs,
  meetingWhenText,
  sendIcsInput,
  sendPlan,
  withoutGuest,
  type Attendee,
  type Meeting,
} from "../src";
import { GUEST, ORGANISER, guestRow, testMeeting } from "./meeting-fixtures";

const on = { invitesOn: true };
const ids = (sends: ReturnType<typeof sendPlan>) => sends.map((s) => s.recipient.id);
const guestOf = (meeting: Meeting, id: string) => meeting.attendees.find((a) => a.id === id) as Attendee;

describe("what each Part 1 action sends (meetings.md sends table)", () => {
  it("schedule: a REQUEST at SEQUENCE 0 to every guest but the organiser, in-app for staff", () => {
    const sends = sendPlan("schedule", testMeeting(), on);
    expect(ids(sends)).toEqual([GUEST, "c-1", "x-1"]);
    for (const send of sends) {
      expect(send).toMatchObject({ method: "REQUEST", status: "CONFIRMED", sequence: 0, action: "Invitation" });
      expect(send.inApp).toBe(send.recipient.kind === "staff");
    }
  });

  it("edit: an Updated REQUEST, keeping SEQUENCE for a title and raising it for a new start", () => {
    const title = sendPlan("edit", editedMeeting(testMeeting(), { title: "New" }).meeting, on);
    expect(title.map((s) => [s.method, s.action, s.sequence])).toEqual([
      ["REQUEST", "Updated", 0],
      ["REQUEST", "Updated", 0],
      ["REQUEST", "Updated", 0],
    ]);
    const moved = sendPlan("edit", editedMeeting(testMeeting(), { start: "2026-11-19T10:00" }).meeting, on);
    expect(moved.every((s) => s.sequence === 1 && s.status === "CONFIRMED")).toBe(true);
  });

  it("cancel: a CANCEL with STATUS:CANCELLED to every guest", () => {
    const sends = sendPlan("cancel", cancelledMeeting(testMeeting()), on);
    expect(ids(sends)).toEqual([GUEST, "c-1", "x-1"]);
    for (const send of sends)
      expect(send).toMatchObject({ method: "CANCEL", status: "CANCELLED", sequence: 1, action: "Cancelled" });
  });

  it("remove: a CANCEL with no STATUS to the removed guest only, listing only them", () => {
    const meeting = testMeeting();
    const removed = guestOf(meeting, "c-1");
    const sends = sendPlan("remove", withoutGuest(meeting, removed), { ...on, removed });
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ method: "CANCEL", status: undefined, sequence: 1, action: "Removed" });
    expect(sends[0]?.listed).toEqual([removed]);
  });

  it("sends nothing at all with meetings.invites off", () => {
    expect(sendPlan("schedule", testMeeting(), { invitesOn: false })).toEqual([]);
    expect(sendPlan("cancel", testMeeting(), { invitesOn: false })).toEqual([]);
  });

  it("says TENTATIVE in a REQUEST while a request waits for its answer", () => {
    const request = testMeeting({ kind: "request", status: "tentative" });
    expect(sendPlan("edit", request, on).every((s) => s.status === "TENTATIVE")).toBe(true);
    expect(sendPlan("cancel", cancelledMeeting(request), on).every((s) => s.status === "CANCELLED")).toBe(true);
  });

  it("lists only the recipient with a hidden list, and never a guest without a valid address", () => {
    const meeting = testMeeting({
      attendees: [...testMeeting().attendees, guestRow({ kind: "staff", id: "u-x", email: "" })],
    });
    const open = sendPlan("schedule", meeting, on);
    expect(open[0]?.listed.map((a) => a.id)).toEqual([ORGANISER, GUEST, "c-1", "x-1"]);
    const hidden = sendPlan("schedule", { ...meeting, hideGuestList: true }, on);
    expect(hidden.map((s) => s.listed.map((a) => a.id))).toEqual([[GUEST], ["c-1"], ["x-1"], []]);
  });
});

describe("what goes into each invite", () => {
  it("writes the real build's file: product-neutral PRODID and, with a hidden list, one ATTENDEE", () => {
    const meeting = testMeeting({ hideGuestList: true });
    const [send] = sendPlan("schedule", meeting, on);
    const text = meetingIcs(sendIcsInput(send!, meeting, { name: "Dana", email: "dana@summit.example" }, new Date()));
    expect(text).toContain("PRODID:-//Platform//Meetings//EN\r\n");
    expect(text).toContain("METHOD:REQUEST\r\n");
    expect(text).toContain("SEQUENCE:0\r\n");
    expect(text.replace(/\r\n /g, "").match(/^ATTENDEE/gm)).toHaveLength(1);
  });

  it("versions each send by SEQUENCE, method, occurrence and stamp in milliseconds", () => {
    const send = { sequence: 2, method: "REQUEST" as const };
    expect(inviteVersion(send, new Date("2026-11-15T10:00:00.123Z"))).toBe("2-REQUEST--1794736800123");
    expect(inviteVersion({ ...send, recurrenceId: "2026-11-20T14:00" }, new Date(0))).toBe(
      "2-REQUEST-2026-11-20T14:00-0",
    );
    expect(inviteVersion(send, new Date(1))).not.toBe(inviteVersion(send, new Date(2)));
  });

  it("names the file from the title, safely", () => {
    expect(icsFileName("Design consultation: Coby Harris")).toBe("Design consultation Coby Harris.ics");
    expect(icsFileName("../../etc/passwd\r\n")).toBe("etcpasswd.ics");
    expect(icsFileName("!!!")).toBe("meeting.ics");
    expect(icsFileName("x".repeat(300))).toBe(`${"x".repeat(100)}.ics`);
  });

  it("fills the template with the spec's values and the SEQUENCE it was sent with", () => {
    const meeting = testMeeting();
    const [send] = sendPlan("schedule", meeting, on);
    expect(inviteValues(send!, meeting, "Dana")).toEqual({
      "meeting.action": "Invitation",
      "meeting.title": "Design consultation",
      "meeting.when": "2026-11-19 at 08:30",
      "meeting.location": "Showroom",
      "meeting.organiser": "Dana",
      "meeting.sequence": "0",
    });
    expect(meetingWhenText("2026-11-19T08:30")).toBe("2026-11-19 at 08:30");
  });

  it("maps each guest kind to its Outbox recipient kind", () => {
    expect(OUTBOX_RECIPIENT_KIND).toEqual({
      staff: "user",
      customer: "customer",
      supplier: "supplier",
      "customer-contact": "customer_contact",
      "supplier-contact": "supplier_contact",
      external: "guest",
    });
  });
});
