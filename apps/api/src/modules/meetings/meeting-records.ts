import type { CompanyDb } from "@workspace/db";
import {
  customerContacts,
  customers,
  meetingAttendees,
  meetings,
  supplierContacts,
  suppliers,
} from "@workspace/db/company";
import { featureOn, instantToZoned, isOrganiser, type Attendee, type Meeting } from "@workspace/shared";
import { and, asc, inArray, isNull, ne } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { seesCustomer } from "../sales/sales-common";
import { loadBranches } from "../sales/sales-records";
import type { MeetingRow } from "./meetings-common";

/** A stored guest row. */
export type AttendeeRow = typeof meetingAttendees.$inferSelect;

/** A meeting as the rules and the wire see it, with the rows it was read from. */
export interface LoadedMeeting {
  meeting: Meeting;
  row: MeetingRow;
  /** The live guest rows, by the guest's id on the wire (`wireAttendeeId`). */
  rows: ReadonlyMap<string, AttendeeRow>;
}

/**
 * A guest's id on the wire (ADR 0051 "Ids"): the linked record's id for staff, customers, suppliers
 * and their people, and the guest row's own id for someone added by email. Both are UUIDs, and the
 * routes look one up only inside its own meeting.
 */
export function wireAttendeeId(row: Pick<AttendeeRow, "id" | "partyId">): string {
  return row.partyId ?? row.id;
}

/** A guest row as the shared `Attendee`; times are local in the meeting's zone (meetings.md "Attendee"). */
function attendeeOf(row: AttendeeRow, zone: string): Attendee {
  return {
    kind: row.partyType,
    id: wireAttendeeId(row),
    name: row.name,
    email: row.email,
    role: row.role,
    partStat: row.partStat,
    respondedAt: row.respondedAt ? instantToZoned(row.respondedAt, zone) : null,
    respondedSequence: row.respondedSequence,
    note: row.note,
    proposal: row.proposal,
  };
}

/**
 * A stored meeting as the shared `Meeting` (meetings.md "Meeting"; ADR 0051 "Times"): the stored
 * instant read back as the local "YYYY-MM-DDTHH:mm" of the meeting's own zone, the organiser's row
 * first and the other guests in the order they were added.
 */
export function meetingOf(row: MeetingRow, guests: readonly AttendeeRow[]): LoadedMeeting {
  const ordered = [...guests].sort((a, b) => {
    const first = Number(isOrganiserRow(row, b)) - Number(isOrganiserRow(row, a));
    return first || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  });
  const meeting: Meeting = {
    id: row.id,
    title: row.title,
    start: instantToZoned(row.start, row.timeZone),
    durationMin: row.durationMin,
    location: row.location,
    attendees: ordered.map((guest) => attendeeOf(guest, row.timeZone)),
    recurrence: row.recurrence,
    reminderMin: row.reminderMin,
    ownerUserId: row.ownerUserId,
    notes: row.notes,
    timeZone: row.timeZone,
    until: row.until,
    exceptions: row.exceptions,
    uid: row.uid,
    sequence: row.sequence,
    rescheduleSequence: row.rescheduleSequence,
    status: row.status,
    kind: row.kind,
    private: row.private,
    hideGuestList: row.hideGuestList,
    allowProposals: row.allowProposals,
  };
  return { meeting, row, rows: new Map(ordered.map((guest) => [wireAttendeeId(guest), guest])) };
}

function isOrganiserRow(meeting: MeetingRow, guest: AttendeeRow): boolean {
  return guest.partyType === "staff" && guest.partyId !== null && isOrganiser(meeting, guest.partyId);
}

/** The live guest rows of some meetings, oldest first. */
export async function attendeesOf(db: CompanyDb, meetingIds: readonly string[]): Promise<AttendeeRow[]> {
  if (meetingIds.length === 0) return [];
  return db
    .select()
    .from(meetingAttendees)
    .where(and(inArray(meetingAttendees.meetingId, [...meetingIds]), isNull(meetingAttendees.deletedAt)))
    .orderBy(asc(meetingAttendees.createdAt), asc(meetingAttendees.id));
}

/**
 * The company's live meetings, or the ones with these ids, as the rules see them. Cancelled
 * meetings are left out unless asked for: they leave the calendar (meetings.md "Meeting.status").
 */
export async function loadMeetings(
  db: CompanyDb,
  filter: { ids?: readonly string[]; withCancelled?: boolean } = {},
): Promise<LoadedMeeting[]> {
  if (filter.ids && filter.ids.length === 0) return [];
  const rows = await db
    .select()
    .from(meetings)
    .where(
      and(
        isNull(meetings.deletedAt),
        filter.ids ? inArray(meetings.id, [...filter.ids]) : undefined,
        filter.withCancelled ? undefined : ne(meetings.status, "cancelled"),
      ),
    )
    .orderBy(asc(meetings.start), asc(meetings.id));
  const guests = await attendeesOf(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    meetingOf(
      row,
      guests.filter((guest) => guest.meetingId === row.id),
    ),
  );
}

/** Whether the person may read customers here: the core module, the key and the switch (sales.md "Who uses it"). */
export function readsCustomers(access: RequestAccess): boolean {
  return (
    access.modules.includes("core") && access.permissions.has("customers.customer.view") && featureOn("sales.customers")
  );
}

/** Whether the person may read suppliers here: the core module, the key and the switch (purchasing.md). */
export function readsSuppliers(access: RequestAccess): boolean {
  return (
    access.modules.includes("core") &&
    access.permissions.has("purchasing.supplier.view") &&
    featureOn("purchasing.suppliers")
  );
}

/**
 * Which linked guests of these meetings the person may see by name and address (ADR 0051 "What a
 * viewer sees", critic section C): a customer or a person at one only with `customers.customer.view`
 * and a data scope that covers the customer (`seesCustomer`), a supplier or a person at one only with
 * `purchasing.supplier.view`, and never a record that was deleted. Everyone else reads "Customer"
 * and so on (`meetingForViewer`).
 */
export async function partySight(
  db: CompanyDb,
  access: RequestAccess,
  list: readonly Meeting[],
): Promise<(attendee: Attendee) => boolean> {
  const ids = (kind: Attendee["kind"]) => [
    ...new Set(list.flatMap((m) => m.attendees.filter((a) => a.kind === kind).map((a) => a.id))),
  ];
  const seenCustomers = new Set<string>();
  const customerOfContact = new Map<string, string>();
  const liveSuppliers = new Set<string>();
  if (readsCustomers(access)) {
    const contactRows = await rowsWhere(ids("customer-contact"), (wanted) =>
      db
        .select({ id: customerContacts.id, customerId: customerContacts.customerId })
        .from(customerContacts)
        .where(and(inArray(customerContacts.id, wanted), isNull(customerContacts.deletedAt))),
    );
    for (const contact of contactRows) customerOfContact.set(contact.id, contact.customerId);
    const customerIds = [...new Set([...ids("customer"), ...customerOfContact.values()])];
    const [customerRows, branches] = await Promise.all([
      rowsWhere(customerIds, (wanted) =>
        db
          .select({ id: customers.id, salesRepId: customers.salesRepId })
          .from(customers)
          .where(and(inArray(customers.id, wanted), isNull(customers.deletedAt))),
      ),
      loadBranches(db),
    ]);
    for (const customer of customerRows) {
      if (seesCustomer(access, { salesRepId: customer.salesRepId ?? "" }, branches)) seenCustomers.add(customer.id);
    }
  }
  if (readsSuppliers(access)) {
    const contactRows = await rowsWhere(ids("supplier-contact"), (wanted) =>
      db
        .select({ id: supplierContacts.id, supplierId: supplierContacts.supplierId })
        .from(supplierContacts)
        .where(and(inArray(supplierContacts.id, wanted), isNull(supplierContacts.deletedAt))),
    );
    const supplierRows = await rowsWhere(
      [...new Set([...ids("supplier"), ...contactRows.map((c) => c.supplierId)])],
      (wanted) =>
        db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(and(inArray(suppliers.id, wanted), isNull(suppliers.deletedAt))),
    );
    for (const supplier of supplierRows) liveSuppliers.add(supplier.id);
    for (const contact of contactRows) if (liveSuppliers.has(contact.supplierId)) liveSuppliers.add(contact.id);
  }
  return (attendee) => {
    if (attendee.kind === "customer") return seenCustomers.has(attendee.id);
    if (attendee.kind === "customer-contact") return seenCustomers.has(customerOfContact.get(attendee.id) ?? "");
    if (attendee.kind === "supplier" || attendee.kind === "supplier-contact") return liveSuppliers.has(attendee.id);
    return true;
  };
}

/** Runs a lookup only when there is something to look up. */
async function rowsWhere<T>(ids: string[], read: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  return ids.length === 0 ? [] : read(ids);
}
