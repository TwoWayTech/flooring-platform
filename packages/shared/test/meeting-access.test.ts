import { describe, expect, it } from "vitest";
import {
  FEATURES,
  MEETING_REFUSALS,
  PRODUCT_ROLES,
  canChangeMeeting,
  canDecideProposal,
  changeRefusal,
  changeableAsShown,
  decidableAsShown,
  guestAuditName,
  isOnMeeting,
  meetingAuditTarget,
  meetingForViewer,
  organiserAddressShown,
  readsCustomerGuests,
  readsSupplierGuests,
  seesEveryLinkedGuest,
  seesGuestAddresses,
  seesMeeting,
  shownParty,
  staffGuestOf,
  type Attendee,
  type DefaultRoleKey,
  type FeatureKey,
  type FeatureRegister,
  type Meeting,
  type MeetingViewer,
  type ModuleKey,
  type PermissionKey,
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

describe("what a screen can tell from a shaped meeting (ADR 0051 part 3)", () => {
  type Sight = (attendee: Attendee) => boolean;
  const staffOnly = testMeeting().attendees.filter((a) => a.kind === "staff");
  const withSupplier = [...testMeeting().attendees, guestRow({ kind: "supplier", id: "s-1", name: "Oakhaven Timber" })];
  /** The meetings the property runs over: open and hidden lists, private, staff only, a series. */
  const MEETINGS: readonly [string, Meeting][] = [
    ["one-off", testMeeting()],
    ["hidden list", testMeeting({ hideGuestList: true })],
    ["private", testMeeting({ private: true })],
    ["private, hidden list", testMeeting({ private: true, hideGuestList: true })],
    ["staff only", testMeeting({ attendees: staffOnly })],
    ["staff only, hidden list", testMeeting({ attendees: staffOnly, hideGuestList: true })],
    ["weekly series", testMeeting({ recurrence: "weekly", until: "2027-06-30" })],
    ["with a supplier, hidden list", testMeeting({ attendees: withSupplier, hideGuestList: true })],
  ];
  /** The readers: the organiser, a staff guest and three people not on it, in every role. */
  const VIEWERS: readonly [string, MeetingViewer][] = [ORGANISER, GUEST, "u-mgr", "u-own", "u-wh"].flatMap((id) =>
    ROLES.map((role): [string, MeetingViewer] => [`${id} as ${role}`, viewerAs(role, id)]),
  );
  const SIGHTS: readonly [string, Sight][] = [
    ["all", seesAll],
    ["none", () => false],
    ["customers only", (a) => a.kind === "customer" || a.kind === "customer-contact"],
  ];

  /** Every reader, sight and meeting the server would shape for that reader, with the shaped copy. */
  function* shapedCases(meetings: readonly [string, Meeting][] = MEETINGS) {
    for (const [label, stored] of meetings)
      for (const [sightLabel, sight] of SIGHTS)
        for (const [viewerLabel, viewer] of VIEWERS) {
          if (!seesMeeting(viewer, stored)) continue;
          const name = `${label}, ${viewerLabel}, sight ${sightLabel}`;
          yield { name, stored, sight, viewer, shown: meetingForViewer(stored, viewer, sight) };
        }
  }

  it("reads a customer, supplier or contact shown by kind with no address as one the reader can't read", () => {
    for (const kind of ["customer", "supplier", "customer-contact", "supplier-contact"] as const) {
      const linked = testMeeting({ attendees: [...testMeeting().attendees, guestRow({ kind, id: "p-1" })] });
      const shown = meetingForViewer(linked, viewerAs("owner", ORGANISER), () => false);
      const row = shown.attendees.find((a) => a.id === "p-1");
      expect(row && shownParty(row), kind).toBe(false);
    }
  });

  it("reads staff, email guests and a named linked guest as readable", () => {
    const shown = meetingForViewer(testMeeting(), viewerAs("warehouse", "u-wh"), seesAll);
    // The warehouse reader gets no addresses, yet every guest here is one they can read.
    expect(shown.attendees.map((a) => a.email)).toEqual(["", "", "", ""]);
    expect(shown.attendees.every(shownParty)).toBe(true);
    expect(shownParty(guestRow({ kind: "customer", id: "c-2", name: "Coby Harris", email: "" }))).toBe(true);
    expect(shownParty(guestRow({ kind: "staff", id: "u-2", name: "Customer", email: "" }))).toBe(true);
    expect(shownParty(guestRow({ kind: "external", id: "x-2", name: "Supplier", email: "" }))).toBe(true);
  });

  it("never offers a change the server refuses: changeableAsShown on the shaped meeting implies canChangeMeeting on the stored one", () => {
    const failClosed: [string, Meeting][] = [
      [
        "an organiser row with no stored address",
        testMeeting({
          attendees: testMeeting().attendees.map((a) => (a.id === ORGANISER ? { ...a, email: "" } : a)),
        }),
      ],
      ["no organiser row", testMeeting({ attendees: testMeeting().attendees.filter((a) => a.id !== ORGANISER) })],
      [
        "a readable customer named like its kind with no address",
        testMeeting({
          attendees: [...staffOnly, guestRow({ kind: "customer", id: "c-9", name: "Customer", email: "" })],
        }),
      ],
    ];
    let offered = 0;
    for (const { name, stored, sight, viewer, shown } of shapedCases([...MEETINGS, ...failClosed])) {
      if (!changeableAsShown(viewer, shown)) continue;
      offered += 1;
      expect(canChangeMeeting(viewer, stored, sight), name).toBe(true);
    }
    // The property is not vacuous: the screen offers changes in many of these cases.
    expect(offered).toBeGreaterThan(50);
  });

  it("agrees exactly with the server for everyone but the organiser, and for the organiser unless a readable linked guest is named like its kind with no address", () => {
    for (const { name, stored, sight, viewer, shown } of shapedCases()) {
      expect(changeableAsShown(viewer, shown), name).toBe(canChangeMeeting(viewer, stored, sight));
    }
    // The one place they differ, for the organiser: the screen hides a change the server would take.
    const named = testMeeting({
      attendees: [...staffOnly, guestRow({ kind: "customer", id: "c-9", name: "Customer", email: "" })],
    });
    const organiser = viewerAs("manager", ORGANISER);
    expect(canChangeMeeting(organiser, named, seesAll)).toBe(true);
    expect(changeableAsShown(organiser, meetingForViewer(named, organiser, seesAll))).toBe(false);
  });

  it("offers no change to a branch Manager not on a hidden-list meeting with a customer they can't read, and offers it once they can read that customer", () => {
    const hidden = testMeeting({ hideGuestList: true });
    const manager = viewerAs("manager", "u-mgr");
    const unseen = meetingForViewer(hidden, manager, () => false);
    expect(unseen.attendees).toEqual([]);
    expect(organiserAddressShown(unseen)).toBe(false);
    expect(changeableAsShown(manager, unseen)).toBe(false);
    expect(canChangeMeeting(manager, hidden, () => false)).toBe(false);
    const seen = meetingForViewer(hidden, manager, seesAll);
    expect(organiserAddressShown(seen)).toBe(true);
    expect(changeableAsShown(manager, seen)).toBe(true);
    expect(canChangeMeeting(manager, hidden, seesAll)).toBe(true);
  });

  it("offers decisions only to the organiser who may change the meeting", () => {
    for (const { name, stored, sight, viewer, shown } of shapedCases()) {
      const offered = decidableAsShown(viewer, shown);
      if (offered) expect(canDecideProposal(viewer, stored, sight), name).toBe(true);
      expect(offered, name).toBe(canDecideProposal(viewer, stored, sight));
      if (viewer.userId !== ORGANISER) expect(offered, name).toBe(false);
    }
    // A manager who may change it is offered the change, but not the decision.
    const manager = viewerAs("manager", "u-mgr");
    const shown = meetingForViewer(testMeeting(), manager, seesAll);
    expect(changeableAsShown(manager, shown)).toBe(true);
    expect(decidableAsShown(manager, shown)).toBe(false);
  });
});

describe("why a change is refused (changeRefusal)", () => {
  it("names guest sight when it is all that is missing, the organiser otherwise, and nothing when allowed", () => {
    const seesNoCustomer = (a: Attendee) => a.kind !== "customer";
    expect(changeRefusal(viewerAs("manager", ORGANISER), testMeeting(), seesAll)).toBeNull();
    expect(changeRefusal(viewerAs("manager", OUTSIDER), testMeeting(), seesAll)).toBeNull();
    expect(changeRefusal(viewerAs("manager", ORGANISER), testMeeting(), seesNoCustomer)).toBe(
      MEETING_REFUSALS.cantSeeEveryGuest,
    );
    expect(changeRefusal(viewerAs("hr", OUTSIDER), testMeeting(), seesNoCustomer)).toBe(
      MEETING_REFUSALS.cantSeeEveryGuest,
    );
    // An own-scope guest, a private meeting and a reader without edit are refused by the organiser rule.
    expect(changeRefusal(viewerAs("sales", GUEST), testMeeting(), seesAll)).toBe(MEETING_REFUSALS.notOrganiser);
    expect(changeRefusal(viewerAs("manager", GUEST), testMeeting({ private: true }), seesAll)).toBe(
      MEETING_REFUSALS.notOrganiser,
    );
    expect(changeRefusal(viewerAs("warehouse", OUTSIDER), testMeeting(), seesNoCustomer)).toBe(
      MEETING_REFUSALS.notOrganiser,
    );
    // The API's words, unchanged (docs/api-contract.md).
    expect(MEETING_REFUSALS.notOrganiser).toBe("Only the organiser can change this meeting.");
    expect(MEETING_REFUSALS.cantSeeEveryGuest).toBe(
      "Only someone who can see every guest on this meeting can change it.",
    );
  });
});

describe("guest readers", () => {
  const access = (modules: readonly ModuleKey[], keys: readonly PermissionKey[]) => ({
    modules,
    permissions: new Set(keys),
  });
  const withOff = (key: FeatureKey): FeatureRegister => ({ ...FEATURES, [key]: { ...FEATURES[key], enabled: false } });

  it("reads customers only with the core module, the key and the switch, and suppliers likewise", () => {
    const both: PermissionKey[] = ["customers.customer.view", "purchasing.supplier.view"];
    expect(readsCustomerGuests(access(["core", "meetings"], both))).toBe(true);
    expect(readsSupplierGuests(access(["core", "meetings"], both))).toBe(true);
    expect(readsCustomerGuests(access(["meetings"], both))).toBe(false);
    expect(readsSupplierGuests(access(["meetings"], both))).toBe(false);
    expect(readsCustomerGuests(access(["core"], ["purchasing.supplier.view"]))).toBe(false);
    expect(readsSupplierGuests(access(["core"], ["customers.customer.view"]))).toBe(false);
    expect(readsCustomerGuests(access(["core"], both), withOff("sales.customers"))).toBe(false);
    expect(readsSupplierGuests(access(["core"], both), withOff("sales.customers"))).toBe(true);
    expect(readsSupplierGuests(access(["core"], both), withOff("purchasing.suppliers"))).toBe(false);
    expect(readsCustomerGuests(access(["core"], both), withOff("purchasing.suppliers"))).toBe(true);
  });
});
