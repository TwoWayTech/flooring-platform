import { roleTemplate, type Attendee, type DefaultRoleKey, type Meeting, type MeetingViewer } from "../src";

/** A guest row with no answer yet; tests override what they need. */
export function guestRow(patch: Partial<Attendee> & Pick<Attendee, "kind" | "id">): Attendee {
  return {
    name: `${patch.kind} ${patch.id}`,
    email: `${patch.id}@example.com`,
    role: "required",
    partStat: "needs-action",
    respondedAt: null,
    respondedSequence: null,
    note: "",
    proposal: null,
    ...patch,
  };
}

/** The organiser of the test meetings. */
export const ORGANISER = "u-org";
/** A staff guest on the test meetings. */
export const GUEST = "u-guest";
/** The company's today in these tests, a few days before the test meetings (the start bound, ADR 0051 "Part 2"). */
export const TODAY = "2026-11-15";
/** The database clock in these tests: noon in Denver on TODAY, which a series change is checked against. */
export const NOW = new Date("2026-11-15T19:00:00.000Z");

/** A confirmed one-off meeting in Denver, organised by ORGANISER with GUEST, a customer and an email guest. */
export function testMeeting(patch: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1",
    title: "Design consultation",
    start: "2026-11-19T08:30",
    durationMin: 60,
    location: "Showroom",
    attendees: [
      guestRow({ kind: "staff", id: ORGANISER, partStat: "accepted", note: "Organiser note" }),
      guestRow({ kind: "staff", id: GUEST, note: "Guest note" }),
      guestRow({ kind: "customer", id: "c-1", name: "Coby Harris", email: "coby@example.com" }),
      guestRow({ kind: "external", id: "x-1", name: "riley@builder.example", email: "riley@builder.example" }),
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

/** A viewer holding a default role's permissions and data scope. */
export function viewerAs(role: DefaultRoleKey, userId: string): MeetingViewer {
  const template = roleTemplate(role);
  return { userId, permissions: new Set(template.permissions), dataScope: template.dataScope };
}
