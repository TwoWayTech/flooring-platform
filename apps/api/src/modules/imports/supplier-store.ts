import type { CompanyDb } from "@workspace/db";
import { supplierContacts, suppliers } from "@workspace/db/company";
import type { ImportChange, ImportCollection, Supplier, SupplierContact } from "@workspace/shared";
import { eq, sql } from "drizzle-orm";
import { auditedSupplier, loadContacts, loadSuppliers } from "../purchasing/purchasing-records";
import { byChangeKey, idsOf, type KindStore, type RecordKind } from "./kind-store";

/**
 * The supplier columns an import writes (ADR 0057 M2): a missing external ID is null. The status,
 * 1099 flag, tax form and notes are never written by an import.
 */
export function supplierRow(supplier: Supplier) {
  return {
    name: supplier.name,
    type: supplier.type,
    accountNumber: supplier.accountNumber,
    email: supplier.email,
    phone: supplier.phone,
    terms: supplier.terms,
    creditLimit: supplier.creditLimit,
    categories: supplier.categories,
    address: supplier.address,
    externalId: supplier.externalId || null,
  };
}

/** A new supplier's primary contact as stored (ADR 0057 R3; created only with a new supplier). */
export function contactRow(contact: SupplierContact) {
  return {
    id: contact.id,
    supplierId: contact.supplierId,
    name: contact.name,
    role: contact.role,
    mobile: contact.mobile,
    officePhone: contact.officePhone,
    email: contact.email,
    whatsapp: contact.whatsapp,
    preferredMethod: contact.preferredMethod,
    notes: contact.notes,
    isPrimary: contact.isPrimary,
    status: contact.status,
  };
}

const SUPPLIER: RecordKind = { noun: "supplier", targetType: "supplier", table: "suppliers" };
const CONTACT: RecordKind = { noun: "supplier contact", targetType: "supplier_contact", table: "supplier_contacts" };

const isContact = (collection: ImportCollection) => collection === "supplierContacts";

/** The suppliers kind adds a contact only with a new supplier; anything else is a fault, never a write. */
const ONLY_NEW_CONTACTS = "An import never changes an existing supplier contact.";

/** Soft-deletes one supplier or contact (table rules: never removed). */
async function softDelete(tx: CompanyDb, change: ImportChange) {
  if (isContact(change.collection)) {
    await tx
      .update(supplierContacts)
      .set({ deletedAt: sql`now()` })
      .where(eq(supplierContacts.id, change.id));
  } else {
    await tx
      .update(suppliers)
      .set({ deletedAt: sql`now()` })
      .where(eq(suppliers.id, change.id));
  }
}

/**
 * Suppliers and their new primary contacts (ADR 0057 api 4.7). A contact is only ever created with
 * its new supplier, after it in plan order, so an Undo in reverse order removes the contact first.
 */
export const SUPPLIER_STORE: KindStore = {
  async lock(tx) {
    await tx.execute(sql`lock table suppliers, supplier_contacts in share row exclusive mode`);
  },

  // Inactive suppliers are loaded too, so a file names them instead of adding them again.
  async world(tx) {
    return { suppliers: await loadSuppliers(tx) };
  },

  async write(tx, change, actorId) {
    if (isContact(change.collection)) {
      if (change.before !== null) throw new Error(ONLY_NEW_CONTACTS);
      await tx.insert(supplierContacts).values({ ...contactRow(change.after as SupplierContact), createdBy: actorId });
      return;
    }
    const after = change.after as Supplier;
    if (change.before === null) {
      await tx.insert(suppliers).values({
        ...supplierRow(after),
        id: after.id,
        status: "active",
        track1099: false,
        taxForm: null,
        notes: "",
        createdBy: actorId,
      });
      return;
    }
    await tx.update(suppliers).set(supplierRow(after)).where(eq(suppliers.id, after.id));
  },

  async current(tx, changes) {
    const [list, contacts] = await Promise.all([
      loadSuppliers(tx, idsOf(changes, "suppliers")),
      loadContacts(tx, idsOf(changes, "supplierContacts")),
    ]);
    return new Map([...byChangeKey("suppliers", list), ...byChangeKey("supplierContacts", contacts)]);
  },

  createdParts: () => [],

  async undoProblem() {
    return null;
  },

  async undo(tx, change) {
    if (change.before === null) {
      await softDelete(tx, change);
      return;
    }
    if (isContact(change.collection)) throw new Error(ONLY_NEW_CONTACTS);
    const before = change.before as Supplier;
    await tx.update(suppliers).set(supplierRow(before)).where(eq(suppliers.id, before.id));
  },

  record: (collection) => (isContact(collection) ? CONTACT : SUPPLIER),

  shape(collection, record) {
    if (isContact(collection)) {
      const contact = record as SupplierContact;
      return { name: contact.name, supplierId: contact.supplierId, isPrimary: contact.isPrimary };
    }
    const supplier = record as Supplier;
    return { ...auditedSupplier(supplier), externalId: supplier.externalId || null, categories: supplier.categories };
  },
};
