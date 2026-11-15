import {
  featureOn,
  meetingForViewer,
  newAttendee,
  readsCustomerGuests,
  readsSupplierGuests,
  seesMeeting,
  type Access,
  type Attendee,
  type Company,
  type GuestOption,
  type Meeting,
  type MeetingViewer,
  type ModuleKey,
  type User,
} from "@workspace/shared";
import { viewerAccess } from "../../access";
import type { CompanyDb } from "./company-db";
import { applyScope } from "./scope";

/**
 * Who is looking at meetings in the demo, and which linked guests they may read (ADR 0051 "Part
 * 3"): the same `MeetingViewer` and `seesParty` the API builds (`meetingViewer`, `partySight`), so
 * the demo shapes, gates and refuses meetings by the shared rules exactly as the API does.
 */
export interface MeetingSight {
  viewer: MeetingViewer;
  /** Whether the reader may read a customer, supplier or person at one on a meeting. */
  seesParty: (attendee: Attendee) => boolean;
  readsCustomers: boolean;
  readsSuppliers: boolean;
  access: Access;
  modules: readonly ModuleKey[];
}

/**
 * The reader's sight of meetings (ADR 0051 "Part 3"). Under View as it is one subject (S12): the
 * signed-in person's id with the viewed role's keys and scope, for the list, guest sight, the drawer
 * and every action, so a meeting the person is on stays theirs. Customers are read through that
 * same subject's data scope (sales.md "Who uses it"), a person at a customer through their customer,
 * and suppliers and their people through `readsSupplierGuests` and the record existing
 * (purchasing.md: the directory has no data scope), as `partySight` reads them on the API.
 */
export function meetingSightFor(
  db: CompanyDb,
  access: Access,
  modules: readonly ModuleKey[],
  actor: User,
): MeetingSight {
  const viewer: MeetingViewer = { userId: actor.id, permissions: access.permissions, dataScope: access.dataScope };
  const readers = { modules, permissions: access.permissions };
  const readsCustomers = readsCustomerGuests(readers);
  const readsSuppliers = readsSupplierGuests(readers);
  const customers = readsCustomers
    ? applyScope(db, "customers", db.list("customers"), { user: actor, scope: access.dataScope })
    : [];
  const seenCustomers = new Set(customers.map((customer) => customer.id));
  const customerOfContact = new Map(db.list("customerContacts").map((contact) => [contact.id, contact.customerId]));
  const liveSuppliers = new Set(readsSuppliers ? db.list("suppliers").map((supplier) => supplier.id) : []);
  const supplierContacts = new Set(
    readsSuppliers
      ? db
          .list("supplierContacts")
          .filter((contact) => liveSuppliers.has(contact.supplierId))
          .map((contact) => contact.id)
      : [],
  );
  const seesParty = (attendee: Attendee) => {
    if (attendee.kind === "customer") return seenCustomers.has(attendee.id);
    if (attendee.kind === "customer-contact") return seenCustomers.has(customerOfContact.get(attendee.id) ?? "");
    if (attendee.kind === "supplier") return liveSuppliers.has(attendee.id);
    if (attendee.kind === "supplier-contact") return supplierContacts.has(attendee.id);
    return true;
  };
  return { viewer, seesParty, readsCustomers, readsSuppliers, access, modules };
}

/** A meeting as this reader may read it (`meetingForViewer`). Call it only for a meeting `seesMeeting` allows. */
export function shapedFor(sight: MeetingSight, meeting: Meeting): Meeting {
  return meetingForViewer(meeting, sight.viewer, sight.seesParty);
}

/**
 * The meetings the reader may see, each as they may read it (GET /meetings; meetings.md "Who sees
 * which meeting"): cancelled ones leave the calendar.
 */
export function visibleMeetings(db: CompanyDb, sight: MeetingSight): Meeting[] {
  return db
    .list("meetings")
    .filter((meeting) => meeting.status !== "cancelled" && seesMeeting(sight.viewer, meeting))
    .map((meeting) => shapedFor(sight, meeting));
}

/** Active colleagues, by name as the API's `activeMembers` sorts them. */
function activeUsers(db: CompanyDb): User[] {
  return db
    .list("users")
    .filter((user) => user.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whom the guest picker offers (GET /meeting-guests, the API's `guestOptions`): active colleagues
 * but the reader, by name only, since a colleague's address is filled in from their record; the
 * customers in the reader's sight, by name, with their addresses, and the people at them; suppliers
 * and their people only for a reader who may read suppliers. The caller checks the create key and
 * the invites switch.
 */
export function guestOptionsFor(db: CompanyDb, sight: MeetingSight): GuestOption[] {
  const options: GuestOption[] = activeUsers(db)
    .filter((user) => user.id !== sight.viewer.userId)
    .map((user) => ({ kind: "staff", id: user.id, name: user.name, email: "" }));
  const byName = <T extends { name: string }>(rows: readonly T[]) =>
    [...rows].sort((a, b) => a.name.localeCompare(b.name));
  if (sight.readsCustomers) {
    const customers = byName(
      db.list("customers").filter((customer) => sight.seesParty(partyOf("customer", customer.id))),
    );
    const ids = new Set(customers.map((customer) => customer.id));
    const contacts = byName(db.list("customerContacts").filter((contact) => ids.has(contact.customerId)));
    options.push(
      ...customers.map((c) => ({ kind: "customer" as const, id: c.id, name: c.name, email: c.email })),
      ...contacts.map((c) => ({ kind: "customer-contact" as const, id: c.id, name: c.name, email: c.email })),
    );
  }
  if (sight.readsSuppliers) {
    const suppliers = byName(db.list("suppliers"));
    const ids = new Set(suppliers.map((supplier) => supplier.id));
    const contacts = byName(db.list("supplierContacts").filter((contact) => ids.has(contact.supplierId)));
    options.push(
      ...suppliers.map((s) => ({ kind: "supplier" as const, id: s.id, name: s.name, email: s.email })),
      ...contacts.map((c) => ({ kind: "supplier-contact" as const, id: c.id, name: c.name, email: c.email })),
    );
  }
  return options;
}

/**
 * The colleagues the reader may ask to meet (GET /me/meetings `colleagues`; ADR 0051): none unless
 * they may create a meeting and hold the portal key, with `meetings.requests`, `meetings.invites`
 * and `hr.portal` on, so the demo and the API deny alike (S5: on the API this list comes from the
 * portal's route). Otherwise the active colleagues but the reader whose own access reads meetings.
 */
export function colleaguesFor(db: CompanyDb, company: Company, sight: MeetingSight): { id: string; name: string }[] {
  const { permissions } = sight.access;
  if (
    !permissions.has("meetings.meeting.create") ||
    !permissions.has("hr.portal.view") ||
    !featureOn("meetings.requests") ||
    !featureOn("meetings.invites") ||
    !featureOn("hr.portal")
  )
    return [];
  const roles = db.list("roles");
  return activeUsers(db)
    .filter(
      (user) =>
        user.id !== sight.viewer.userId &&
        viewerAccess(company, roles, user, null).permissions.has("meetings.meeting.view"),
    )
    .map((user) => ({ id: user.id, name: user.name }));
}

/** A linked record as a guest row, to ask `seesParty` about it. */
export function partyOf(kind: Attendee["kind"], id: string): Attendee {
  return newAttendee({ kind, id, name: "", email: "" });
}
