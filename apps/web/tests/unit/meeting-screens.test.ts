import { describe, expect, it } from "vitest";
import {
  meetingForViewer,
  newAttendee,
  roleTemplate,
  type Attendee,
  type DefaultRoleKey,
  type Meeting,
  type MeetingViewer,
} from "@workspace/shared";
import { conflictWarning } from "@/features/meetings/conflict-warning";
import { keyOf, movedKey, occurrenceAt } from "@/features/meetings/current-occurrence";
import { meetingOffers, meetingRights, type MeetingSwitches } from "@/features/meetings/meeting-rights";
import { scopeChoices } from "@/features/meetings/scope-choices";
import type { MeetingMove, MeetingUndo } from "@/lib/api/contract";

const ORGANISER = "u-org";
const GUEST = "u-guest";
const OUTSIDER = "u-out";
/** The browser's day and clock in these tests: noon in Denver, the day before the series starts. */
const TODAY = "2026-11-15";
const NOW = new Date("2026-11-15T19:00:00.000Z");

const ON: MeetingSwitches = { invites: true, requests: true };
const INVITES_OFF: MeetingSwitches = { invites: false, requests: true };
const REQUESTS_OFF: MeetingSwitches = { invites: true, requests: false };

const row = (kind: Attendee["kind"], id: string, name: string, email: string): Attendee =>
  newAttendee({ kind, id, name, email });

/** A confirmed one-off in Denver by ORGANISER, with GUEST and a customer. */
function meeting(patch: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1",
    title: "Design consultation",
    start: "2026-11-19T08:30",
    durationMin: 60,
    location: "Showroom",
    attendees: [
      newAttendee({ kind: "staff", id: ORGANISER, name: "Olive Organiser", email: "olive@example.com" }, true),
      row("staff", GUEST, "Gus Guest", "gus@example.com"),
      row("customer", "c-1", "Coby Harris", "coby@example.com"),
    ],
    recurrence: "none",
    reminderMin: 15,
    ownerUserId: ORGANISER,
    notes: "",
    timeZone: "America/Denver",
    until: null,
    exceptions: [],
    uid: "0b6f1d0e-7c3f-4a52-9a54-2f0e1a7d9c11",
    sequence: 0,
    rescheduleSequence: 0,
    status: "confirmed",
    kind: "meeting",
    private: false,
    hideGuestList: false,
    allowProposals: true,
    ...patch,
  };
}

/** A weekly series from Monday 2026-11-16 at 09:00. */
const series = (patch: Partial<Meeting> = {}) =>
  meeting({ id: "s1", title: "Weekly huddle", start: "2026-11-16T09:00", recurrence: "weekly", ...patch });

const viewerAs = (role: DefaultRoleKey, userId: string): MeetingViewer => {
  const template = roleTemplate(role);
  return { userId, permissions: new Set(template.permissions), dataScope: template.dataScope };
};

const seesAll = () => true;
const seesNoCustomer = (a: Attendee) => a.kind !== "customer";

/** The meeting as the server would send it to this reader. */
const shown = (m: Meeting, viewer: MeetingViewer, sight: (a: Attendee) => boolean = seesAll) =>
  meetingForViewer(m, viewer, sight);

const undo = (createdIds: string[] = []): { undo: MeetingUndo } => ({ undo: { previous: meeting(), createdIds } });

describe("meetings screens (ADR 0051 part 3)", () => {
  it("names each conflict with the other meeting's title or Busy, and its time", () => {
    expect(
      conflictWarning([
        { name: "Priya Natarajan", title: "Busy", start: "2026-11-17T15:00" },
        { name: "Cole Brennan", title: "Crew scheduling", start: "2026-11-17T15:15" },
      ]),
    ).toBe("Also booked then: Priya Natarajan (Busy, 3:00 PM), Cole Brennan (Crew scheduling, 3:15 PM)");
    expect(conflictWarning([])).toBeNull();
  });

  it("rebuilds a one-off's occurrence from the fresh meeting after it moved, keeps a series occurrence by its planned time, and gives null once it is gone", () => {
    const before = meeting();
    const key = keyOf({ meeting: before, planned: before.start, start: before.start, durationMin: 60 });
    expect(key).toEqual({ meetingId: "m1", planned: "2026-11-19T08:30" });

    const moved = meeting({ start: "2026-11-19T11:00", durationMin: 45, sequence: 1 });
    expect(occurrenceAt([moved], key)).toEqual({
      meeting: moved,
      planned: "2026-11-19T11:00",
      start: "2026-11-19T11:00",
      durationMin: 45,
    });

    const week2 = { meetingId: "s1", planned: "2026-11-23T09:00" };
    const plain = series();
    expect(occurrenceAt([plain], week2)).toEqual({
      meeting: plain,
      planned: week2.planned,
      start: week2.planned,
      durationMin: 60,
    });
    const changed = series({ exceptions: [{ planned: week2.planned, start: "2026-11-23T16:00", durationMin: 30 }] });
    expect(occurrenceAt([changed], week2)).toMatchObject({
      planned: week2.planned,
      start: "2026-11-23T16:00",
      durationMin: 30,
    });

    expect(occurrenceAt([], key)).toBeNull();
    expect(occurrenceAt([meeting({ status: "cancelled" })], key)).toBeNull();
    expect(occurrenceAt([series({ status: "cancelled" })], week2)).toBeNull();
    expect(occurrenceAt([plain], { meetingId: "s1", planned: "2026-11-24T09:00" })).toBeNull();
    expect(occurrenceAt([series({ exceptions: [{ planned: week2.planned, cancelled: true }] })], week2)).toBeNull();
    expect(occurrenceAt([series({ until: "2026-11-20" })], week2)).toBeNull();
  });

  it("follows a move to the occurrence it produced", () => {
    const move = (scope: MeetingMove["scope"], meetingId = "s1"): MeetingMove => ({
      meetingId,
      planned: "2026-11-23T09:00",
      start: "2026-11-23T11:00",
      durationMin: 60,
      scope,
    });
    expect(movedKey(move("this"), undo(), series())).toEqual({ meetingId: "s1", planned: "2026-11-23T09:00" });
    expect(movedKey(move("all"), undo(), series())).toEqual({ meetingId: "s1", planned: "2026-11-23T11:00" });
    expect(movedKey(move("following"), undo(["s2"]), series())).toEqual({
      meetingId: "s2",
      planned: "2026-11-23T11:00",
    });
    // A one-off always moves as all events, whatever the screen asked.
    expect(movedKey(move("this", "m1"), undo(), meeting())).toEqual({ meetingId: "m1", planned: "2026-11-23T11:00" });
  });

  it("offers change, removal and decisions only as the shared rules allow on the shaped meeting, and nothing of guests with invites off", () => {
    const organiser = viewerAs("manager", ORGANISER);
    const own = shown(meeting(), organiser);
    expect(meetingRights(organiser, own, ON)).toEqual({
      change: true,
      removeGuest: true,
      decide: true,
      answer: false,
      seesGuests: true,
    });
    expect(meetingRights(organiser, own, INVITES_OFF)).toEqual({
      change: true,
      removeGuest: false,
      decide: false,
      answer: false,
      seesGuests: true,
    });
    // The organiser who can't read a guest gets that guest by kind with no address, and no change.
    expect(meetingRights(organiser, shown(meeting(), organiser, seesNoCustomer), ON)).toMatchObject({
      change: false,
      removeGuest: false,
      decide: false,
    });

    // An own-scope Sales guest answers but may not change a colleague's meeting.
    const guest = viewerAs("sales", GUEST);
    expect(meetingRights(guest, shown(meeting(), guest), ON)).toEqual({
      change: false,
      removeGuest: false,
      decide: false,
      answer: true,
      seesGuests: true,
    });
    expect(meetingRights(guest, shown(meeting(), guest), INVITES_OFF).answer).toBe(false);
    expect(meetingRights(guest, shown(meeting({ hideGuestList: true }), guest), ON).seesGuests).toBe(false);

    // A branch Manager not on it may change it only when the server showed the organiser's address.
    const manager = viewerAs("manager", OUTSIDER);
    expect(meetingRights(manager, shown(meeting(), manager), ON)).toMatchObject({ change: true, decide: false });
    expect(meetingRights(manager, shown(meeting({ hideGuestList: true }), manager, seesNoCustomer), ON)).toEqual({
      change: false,
      removeGuest: false,
      decide: false,
      answer: false,
      seesGuests: false,
    });
    expect(meetingRights(manager, shown(meeting({ hideGuestList: true }), manager), ON).change).toBe(true);

    // A cancelled meeting offers nothing to change or answer.
    expect(meetingRights(organiser, shown(meeting({ status: "cancelled" }), organiser), ON)).toMatchObject({
      change: false,
      decide: false,
    });
    expect(meetingRights(guest, shown(meeting({ status: "cancelled" }), guest), ON).answer).toBe(false);
  });

  it("offers guests in New meeting only while invites are on, and Request only with someone to ask", () => {
    expect(meetingOffers(true, 2, ON)).toEqual({ create: true, invite: true, request: true });
    expect(meetingOffers(true, 0, ON)).toEqual({ create: true, invite: true, request: false });
    expect(meetingOffers(true, 2, INVITES_OFF)).toEqual({ create: true, invite: false, request: false });
    expect(meetingOffers(true, 2, REQUESTS_OFF)).toEqual({ create: true, invite: true, request: false });
    expect(meetingOffers(false, 2, ON)).toEqual({ create: false, invite: false, request: false });
  });

  it("leaves out This and following on a series' first occurrence and All events on an occurrence changed on its own, with the rule's reason", () => {
    const first = series();
    const atFirst = scopeChoices(
      { meeting: first, planned: first.start, start: first.start, durationMin: 60 },
      "2026-11-16T11:00",
      60,
      TODAY,
      NOW,
    );
    expect(atFirst.map((c) => c.label)).toEqual(["This event", "This and following events", "All events"]);
    expect(atFirst.find((c) => c.scope === "this")?.problem).toBeNull();
    expect(atFirst.find((c) => c.scope === "all")?.problem).toBeNull();
    expect(atFirst.find((c) => c.scope === "following")?.problem).toMatch(
      /^This is the first occurrence of the series\./,
    );

    const planned = "2026-11-23T09:00";
    const changed = series({ exceptions: [{ planned, start: "2026-11-23T16:00" }] });
    const atChanged = scopeChoices(
      { meeting: changed, planned, start: "2026-11-23T16:00", durationMin: 60 },
      "2026-11-23T17:00",
      60,
      TODAY,
      NOW,
    );
    expect(atChanged.find((c) => c.scope === "this")?.problem).toBeNull();
    expect(atChanged.find((c) => c.scope === "all")?.problem).toMatch(/^This occurrence was changed on its own\./);
  });
});
