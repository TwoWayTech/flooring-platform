import type { CompanyDb, ControlDb } from "@workspace/db";
import { customerContacts, customers, supplierContacts, suppliers } from "@workspace/db/company";
import { user } from "@workspace/db/control";
import {
  newAttendee,
  normalizeGuestEmail,
  type Attendee,
  type GuestOption,
  type NewGuestInput,
} from "@workspace/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { notFound, seesCustomer } from "../sales/sales-common";
import { loadBranches } from "../sales/sales-records";
import { readsCustomers, readsSuppliers } from "./meeting-records";
import { activeMembers } from "./meetings-common";

/** A guest picked from the company's records, as a request names it: only who they are (critic B4). */
export interface PickedGuest {
  kind: Exclude<Attendee["kind"], "external">;
  id: string;
}

/** The guests of a new meeting as the server resolved them, besides the organiser. */
export interface ResolvedGuests {
  guests: Attendee[];
  /** The addresses of the guests added by email who belong to nobody in the company, normalised. */
  outside: string[];
}

/** The records a kind of linked guest is read from, with its name and address. */
type PartyRow = { id: string; name: string; email: string };

/**
 * Who a new meeting's guests are, resolved on the server (ADR 0051 "Guests"; critic B4). Only the
 * kind and id of a picked guest are read: names and addresses come from the company's own records,
 * and anything else a client sent is ignored. The organiser is left out (the server adds them), and
 * each guest counts once.
 * - staff: an active member of this company;
 * - customers and their people: only with `customers.customer.view` and a data scope that covers
 *   the customer; suppliers and their people only with `purchasing.supplier.view`;
 * - anyone else is 404, as a record outside the person's reach always is (CLAUDE.md rule 3).
 * A guest added by email whose address is an active member's becomes that colleague; any other
 * address is a guest from outside, never saved as a contact or lead (ADR 0051 "Deferred"). An
 * address already on the meeting is not added twice.
 */
export async function resolveGuests(
  tx: CompanyDb,
  control: ControlDb,
  access: RequestAccess,
  picked: readonly PickedGuest[],
  byEmail: readonly NewGuestInput[],
): Promise<ResolvedGuests> {
  const wanted = (kind: PickedGuest["kind"]) => [
    ...new Set(picked.filter((g) => g.kind === kind && !(kind === "staff" && g.id === access.userId)).map((g) => g.id)),
  ];
  const guests: Attendee[] = [];
  const add = (kind: PickedGuest["kind"], ids: readonly string[], rows: readonly PartyRow[]) => {
    for (const id of ids) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw notFound("guest");
      guests.push(newAttendee({ kind, id, name: row.name, email: row.email }));
    }
  };
  add("staff", wanted("staff"), await activeMembers(tx, control, wanted("staff")));
  for (const kind of ["customer", "customer-contact"] as const) {
    if (wanted(kind).length > 0 && !readsCustomers(access)) throw notFound("guest");
    add(kind, wanted(kind), await seenCustomerParties(tx, access, kind, wanted(kind)));
  }
  for (const kind of ["supplier", "supplier-contact"] as const) {
    if (wanted(kind).length > 0 && !readsSuppliers(access)) throw notFound("guest");
    add(kind, wanted(kind), await supplierParties(tx, kind, wanted(kind)));
  }
  const outside = await addEmailGuests(tx, control, access, guests, byEmail);
  return { guests, outside };
}

/** Adds the guests typed by address; returns the normalised addresses that belong to nobody in the company. */
async function addEmailGuests(
  tx: CompanyDb,
  control: ControlDb,
  access: RequestAccess,
  guests: Attendee[],
  byEmail: readonly NewGuestInput[],
): Promise<string[]> {
  const typed = new Map<string, NewGuestInput>();
  for (const guest of byEmail) {
    const key = normalizeGuestEmail(guest.email);
    if (!typed.has(key)) typed.set(key, guest);
  }
  if (typed.size === 0) return [];
  const accounts = await control
    .select({ id: user.id })
    .from(user)
    .where(inArray(sql`lower(${user.email})`, [...typed.keys()]));
  const members = await activeMembers(
    tx,
    control,
    accounts.map((account) => account.id),
  );
  const taken = () => new Set(guests.map((g) => normalizeGuestEmail(g.email)).filter(Boolean));
  const outside: string[] = [];
  for (const [key, guest] of typed) {
    const member = members.find((m) => normalizeGuestEmail(m.email) === key);
    if (member?.id === access.userId) continue;
    if (member) {
      if (!guests.some((g) => g.kind === "staff" && g.id === member.id)) {
        guests.push(newAttendee({ kind: "staff", id: member.id, name: member.name, email: member.email }));
      }
      continue;
    }
    if (taken().has(key)) continue;
    const name = guest.name.trim() || guest.email.trim();
    guests.push(newAttendee({ kind: "external", id: "", name, email: guest.email.trim() }));
    outside.push(key);
  }
  return outside;
}

/** Customers, or people at customers, the person may see, among `ids`. */
async function seenCustomerParties(
  tx: CompanyDb,
  access: RequestAccess,
  kind: "customer" | "customer-contact",
  ids: readonly string[],
): Promise<PartyRow[]> {
  if (ids.length === 0) return [];
  const branches = await loadBranches(tx);
  const seen = (salesRepId: string | null) => seesCustomer(access, { salesRepId: salesRepId ?? "" }, branches);
  if (kind === "customer") {
    const rows = await tx
      .select({ id: customers.id, name: customers.name, email: customers.email, salesRepId: customers.salesRepId })
      .from(customers)
      .where(and(inArray(customers.id, [...ids]), isNull(customers.deletedAt)));
    return rows.filter((row) => seen(row.salesRepId));
  }
  const rows = await tx
    .select({
      id: customerContacts.id,
      name: customerContacts.name,
      email: customerContacts.email,
      salesRepId: customers.salesRepId,
    })
    .from(customerContacts)
    .innerJoin(customers, eq(customers.id, customerContacts.customerId))
    .where(
      and(inArray(customerContacts.id, [...ids]), isNull(customerContacts.deletedAt), isNull(customers.deletedAt)),
    );
  return rows.filter((row) => seen(row.salesRepId));
}

/** Suppliers, or people at suppliers, among `ids`; the supplier directory has no data scope. */
async function supplierParties(
  tx: CompanyDb,
  kind: "supplier" | "supplier-contact",
  ids: readonly string[],
): Promise<PartyRow[]> {
  if (ids.length === 0) return [];
  if (kind === "supplier") {
    return tx
      .select({ id: suppliers.id, name: suppliers.name, email: suppliers.email })
      .from(suppliers)
      .where(and(inArray(suppliers.id, [...ids]), isNull(suppliers.deletedAt)));
  }
  return tx
    .select({ id: supplierContacts.id, name: supplierContacts.name, email: supplierContacts.email })
    .from(supplierContacts)
    .innerJoin(suppliers, eq(suppliers.id, supplierContacts.supplierId))
    .where(
      and(inArray(supplierContacts.id, [...ids]), isNull(supplierContacts.deletedAt), isNull(suppliers.deletedAt)),
    );
}

/**
 * Whom the guest picker offers (GET /meeting-guests; meetings.md "Schedule a meeting" step 2; ADR
 * 0051): active colleagues by name only, since the server fills in a colleague's address, and the
 * customers, suppliers and people at them the person may read, with their address. The person
 * themself is left out: the server adds the organiser.
 */
export async function guestOptions(db: CompanyDb, control: ControlDb, access: RequestAccess): Promise<GuestOption[]> {
  const options: GuestOption[] = (await activeMembers(db, control))
    .filter((member) => member.id !== access.userId)
    .map((member) => ({ kind: "staff", id: member.id, name: member.name, email: "" }));
  if (readsCustomers(access)) {
    const branches = await loadBranches(db);
    const seen = (salesRepId: string | null) => seesCustomer(access, { salesRepId: salesRepId ?? "" }, branches);
    const customerRows = await db
      .select({ id: customers.id, name: customers.name, email: customers.email, salesRepId: customers.salesRepId })
      .from(customers)
      .where(isNull(customers.deletedAt))
      .orderBy(asc(customers.name));
    const visible = customerRows.filter((row) => seen(row.salesRepId));
    const ids = new Set(visible.map((row) => row.id));
    const contactRows = await db
      .select({
        id: customerContacts.id,
        customerId: customerContacts.customerId,
        name: customerContacts.name,
        email: customerContacts.email,
      })
      .from(customerContacts)
      .where(isNull(customerContacts.deletedAt))
      .orderBy(asc(customerContacts.name));
    options.push(
      ...visible.map((row) => ({ kind: "customer" as const, id: row.id, name: row.name, email: row.email })),
      ...contactRows
        .filter((row) => ids.has(row.customerId))
        .map((row) => ({ kind: "customer-contact" as const, id: row.id, name: row.name, email: row.email })),
    );
  }
  if (readsSuppliers(access)) {
    const supplierRows = await db
      .select({ id: suppliers.id, name: suppliers.name, email: suppliers.email })
      .from(suppliers)
      .where(isNull(suppliers.deletedAt))
      .orderBy(asc(suppliers.name));
    const contactRows = await db
      .select({ id: supplierContacts.id, name: supplierContacts.name, email: supplierContacts.email })
      .from(supplierContacts)
      .innerJoin(suppliers, eq(suppliers.id, supplierContacts.supplierId))
      .where(and(isNull(supplierContacts.deletedAt), isNull(suppliers.deletedAt)))
      .orderBy(asc(supplierContacts.name));
    options.push(
      ...supplierRows.map((row) => ({ kind: "supplier" as const, ...row })),
      ...contactRows.map((row) => ({ kind: "supplier-contact" as const, ...row })),
    );
  }
  return options;
}
