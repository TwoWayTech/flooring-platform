import { describe, expect, it } from "vitest";
import {
  PRODUCT_ROLES,
  canChangeMeeting,
  guestAuditName,
  isOnMeeting,
  meetingAuditTarget,
  meetingForViewer,
  seesEveryLinkedGuest,
  seesGuestAddresses,
  seesMeeting,
  staffGuestOf,
  type Attendee,
  type DefaultRoleKey,
  type MeetingViewer,
} from "../src";
import { GUEST, ORGANISER, guestRow, testMeeting, viewerAs } from "./meeting-fixtures";

const ROLES = PRODUCT_ROLES.flooring;
const WIDE: readonly DefaultRoleKey[] = ["owner", "manager", "accountant", "purchasing", "warehouse", "hr"];
const EDITORS: readonly DefaultRoleKey[] = ["owner", "manager", "sales", "hr"];
const OUTSIDER = "u-outsider";
const seesAll = () => true;

describe("who sees which meeting (meetings.md, ADR 0051 Access)", () => {
  it("shows a meeting to its organiser and staff guests in every role", () => {
    for (const role of ROLES) {
      expect(seesMeeting(viewerAs(role, ORGANISER), testMeeting()), role).toBe(true);
      expect(seesMeeting(viewerAs(role, GUEST), testMeeting()), role).toBe(true);
      expect(seesMeeting(viewerAs(role, GUEST), testMeeting({ private: true })), role).toBe(true);
    }
  });

  it("shows a non-private meeting to anyone else only at branch or all scope", () => {
    for (const role of ROLES) {
      expect(seesMeeting(viewerAs(role, OUTSIDER), testMeeting()), role).toBe(WIDE.includes(role));
    }
  });

  it("hides a private meeting from everyone not on it, the Owner included", () => {
    for (const role of ROLES)
      expect(seesMeeting(viewerAs(role, OUTSIDER), testMeeting({ private: true })), role).toBe(false);
  });

  it("counts only a staff guest: a customer whose id equals the viewer's user id doesn't", () => {
    const meeting = testMeeting({ private: true, attendees: [guestRow({ kind: "customer", id: OUTSIDER })] });
    expect(staffGuestOf(meeting, OUTSIDER)).toBeUndefined();
    expect(isOnMeeting(meeting, OUTSIDER)).toBe(false);
    expect(seesMeeting(viewerAs("owner", OUTSIDER), meeting)).toBe(false);
    expect(seesMeeting(viewerAs("employee", OUTSIDER), testMeeting({ attendees: meeting.attendees }))).toBe(false);
  });

  it("denies without meetings.meeting.view, even to the organiser", () => {
    const viewer: MeetingViewer = { userId: ORGANISER, permissions: new Set(), dataScope: "all" };
    expect(seesMeeting(viewer, testMeeting())).toBe(false);
    expect(canChangeMeeting(viewer, testMeeting(), seesAll)).toBe(false);
  });

  it("loses sight of a private meeting once removed from it", () => {
    const removed = testMeeting({ private: true, attendees: testMeeting().attendees.filter((a) => a.id !== GUEST) });
    expect(seesMeeting(viewerAs("manager", GUEST), removed)).toBe(false);
  });
});

describe("who may change a meeting (ADR 0051, safer than meetings.md line 53)", () => {
  it("lets an organiser with edit change their own meeting, private or not", () => {
    for (const role of ROLES) {
      expect(canChangeMeeting(viewerAs(role, ORGANISER), testMeeting(), seesAll), role).toBe(EDITORS.includes(role));
      expect(canChangeMeeting(viewerAs(role, ORGANISER), testMeeting({ private: true }), seesAll), role).toBe(
        EDITORS.includes(role),
      );
    }
  });

  it("lets a wider-than-own editor change someone else's meeting, but not an own-scope Sales guest", () => {
    for (const role of ROLES) {
      const expected = EDITORS.includes(role) && role !== "sales";
      expect(canChangeMeeting(viewerAs(role, GUEST), testMeeting(), seesAll), role).toBe(expected);
      expect(canChangeMeeting(viewerAs(role, OUTSIDER), testMeeting(), seesAll), role).toBe(expected);
    }
  });

  it("lets only the organiser change a private meeting", () => {
    for (const role of ROLES) {
      expect(canChangeMeeting(viewerAs(role, GUEST), testMeeting({ private: true }), seesAll), role).toBe(false);
      expect(canChangeMeeting(viewerAs(role, OUTSIDER), testMeeting({ private: true }), seesAll), role).toBe(false);
    }
  });

  it("lets nobody change a meeting with a customer or supplier they can't read, the organiser included", () => {
    const seesNoCustomer = (a: Attendee) => a.kind !== "customer";
    const meeting = testMeeting();
    expect(seesEveryLinkedGuest(meeting, seesNoCustomer)).toBe(false);
    expect(
      seesEveryLinkedGuest(testMeeting({ attendees: meeting.attendees.filter((a) => a.id !== "c-1") }), () => false),
    ).toBe(true);
    for (const role of EDITORS) {
      expect(canChangeMeeting(viewerAs(role, ORGANISER), meeting, seesNoCustomer), role).toBe(false);
      expect(canChangeMeeting(viewerAs(role, OUTSIDER), meeting, seesNoCustomer), role).toBe(false);
    }
    // Staff and email guests need no record of their own.
    expect(canChangeMeeting(viewerAs("hr", OUTSIDER), meeting, (a) => a.kind === "customer")).toBe(true);
  });
});

describe("a meeting as one viewer reads it (ADR 0051 What a viewer sees)", () => {
  const byId = (attendees: readonly Attendee[], id: string) => attendees.find((a) => a.id === id);
  const withProposal = () =>
    testMeeting({
      attendees: testMeeting().attendees.map((a) =>
        a.id === GUEST
          ? {
              ...a,
              partStat: "tentative",
              proposal: { start: "2026-11-20T09:00", durationMin: 60, note: "Later?", status: "pending" },
            }
          : a,
      ),
    });

  it("gives the organiser every guest with addresses, notes and proposals", () => {
    const seen = meetingForViewer(withProposal(), viewerAs("sales", ORGANISER), seesAll);
    expect(seen.attendees).toEqual(withProposal().attendees);
  });

  it("gives a guest who can't change it no other address, note or proposal, but keeps their own", () => {
    const seen = meetingForViewer(withProposal(), viewerAs("warehouse", "u-third"), seesAll).attendees;
    expect(seen.map((a) => a.email)).toEqual(["", "", "", ""]);
    const asGuest = meetingForViewer(withProposal(), viewerAs("sales", GUEST), seesAll).attendees;
    expect(byId(asGuest, GUEST)).toMatchObject({ email: `${GUEST}@example.com`, note: "Guest note" });
    expect(byId(asGuest, GUEST)?.proposal?.status).toBe("pending");
    expect(byId(asGuest, ORGANISER)).toMatchObject({ email: "", note: "", proposal: null });
    expect(byId(asGuest, "x-1")?.name).toBe("Email guest");
  });

  it("lets a manager who may change it see addresses, but only the organiser sees others' notes", () => {
    const seen = meetingForViewer(withProposal(), viewerAs("manager", OUTSIDER), seesAll).attendees;
    expect(byId(seen, "c-1")?.email).toBe("coby@example.com");
    expect(byId(seen, "x-1")).toMatchObject({ name: "riley@builder.example", email: "riley@builder.example" });
    expect(byId(seen, GUEST)).toMatchObject({ note: "", proposal: null });
  });

  it("gives addresses to a wider-scope editor only when they can read every linked guest", () => {
    const seesNoCustomer = (a: Attendee) => a.kind !== "customer";
    const seen = meetingForViewer(testMeeting(), viewerAs("hr", OUTSIDER), seesNoCustomer).attendees;
    expect(byId(seen, "c-1")).toMatchObject({ name: "Customer", email: "" });
    expect(seen.map((a) => a.email)).toEqual(["", "", "", ""]);
    expect(
      meetingForViewer(testMeeting({ hideGuestList: true }), viewerAs("hr", OUTSIDER), seesNoCustomer).attendees,
    ).toEqual([]);
  });

  it("lets only the organiser and those who may change the meeting read guests' addresses", () => {
    expect(seesGuestAddresses(viewerAs("employee", ORGANISER), testMeeting(), seesAll)).toBe(true);
    expect(seesGuestAddresses(viewerAs("manager", OUTSIDER), testMeeting(), seesAll)).toBe(true);
    // A staff guest who may not change it, and a wide-scope reader without edit, do not.
    expect(seesGuestAddresses(viewerAs("sales", GUEST), testMeeting(), seesAll)).toBe(false);
    expect(seesGuestAddresses(viewerAs("warehouse", OUTSIDER), testMeeting(), seesAll)).toBe(false);
    expect(seesGuestAddresses(viewerAs("hr", OUTSIDER), testMeeting(), (a) => a.kind !== "customer")).toBe(false);
  });

  it("shows a hidden guest list only to those who may change the meeting", () => {
    const hidden = testMeeting({ hideGuestList: true });
    expect(meetingForViewer(hidden, viewerAs("sales", GUEST), seesAll).attendees.map((a) => a.id)).toEqual([GUEST]);
    expect(meetingForViewer(hidden, viewerAs("warehouse", OUTSIDER), seesAll).attendees).toEqual([]);
    expect(meetingForViewer(hidden, viewerAs("manager", OUTSIDER), seesAll).attendees).toHaveLength(4);
    expect(meetingForViewer(hidden, viewerAs("employee", ORGANISER), seesAll).attendees).toHaveLength(4);
  });

  it("blanks a linked customer, supplier or contact the viewer can't see, for the organiser too", () => {
    const meeting = testMeeting({
      attendees: [
        ...testMeeting().attendees,
        guestRow({ kind: "supplier", id: "s-1", name: "Oakhaven Timber" }),
        guestRow({ kind: "customer-contact", id: "cc-1", name: "Pat at Coby's" }),
        guestRow({ kind: "supplier-contact", id: "sc-1", name: "Lee at Oakhaven" }),
      ],
    });
    const seesNoParty = (a: Attendee) => a.kind === "staff" || a.kind === "external";
    const seen = meetingForViewer(meeting, viewerAs("owner", ORGANISER), seesNoParty).attendees;
    expect(seen.filter((a) => a.kind !== "staff" && a.kind !== "external").map((a) => [a.id, a.name, a.email])).toEqual(
      [
        ["c-1", "Customer", ""],
        ["s-1", "Supplier", ""],
        ["cc-1", "Customer contact", ""],
        ["sc-1", "Supplier contact", ""],
      ],
    );
    expect(byId(seen, "x-1")?.email).toBe("riley@builder.example");
  });
});

describe("what the audit log says about meetings (ADR 0051 Audit)", () => {
  it("names a private meeting and its people only by kind, and never an address", () => {
    const privateMeeting = testMeeting({ private: true });
    expect(meetingAuditTarget(testMeeting())).toBe("Design consultation");
    expect(meetingAuditTarget(privateMeeting)).toBe("Private meeting");
    const [, staff, customer, external] = testMeeting().attendees as [Attendee, Attendee, Attendee, Attendee];
    expect(guestAuditName(staff, testMeeting())).toBe(staff.name);
    expect(guestAuditName(customer, testMeeting())).toBe("Coby Harris");
    expect(guestAuditName(external, testMeeting())).toBe("Email guest");
    expect(guestAuditName(staff, privateMeeting)).toBe("Colleague");
    expect(guestAuditName(customer, privateMeeting)).toBe("Customer");
  });
});
