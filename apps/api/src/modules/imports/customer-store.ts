import type { CompanyDb } from "@workspace/db";
import { addresses, customers } from "@workspace/db/company";
import { sameRecord, type Customer, type CustomerAddress, type ImportChange } from "@workspace/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { customerAudit, loadCustomers } from "../sales/sales-records";
import { loadMembers } from "./import-records";
import { byChangeKey, idsOf, type KindStore, type RecordKind, type ReferenceTarget } from "./kind-store";

/**
 * The customer columns an import writes (ADR 0057 M2): the loader reads a missing rep as "", so it
 * goes back as null, and a missing external ID is null too. Tax exemption, the lifecycle, the
 * certificate and contacts are never written by an import.
 */
export function customerRow(customer: Customer) {
  return {
    type: customer.type,
    name: customer.name,
    contactName: customer.contactName,
    email: customer.email,
    phone: customer.phone,
    terms: customer.terms,
    creditLimit: customer.creditLimit,
    salesRepId: customer.salesRepId || null,
    externalId: customer.externalId || null,
    defaultBillingId: customer.defaultBillingId,
    defaultJobSiteId: customer.defaultJobSiteId,
  };
}

/** The address columns an import writes; the county and coordinates are never touched (ADR 0057 M2). */
export function addressRow(address: CustomerAddress) {
  return {
    label: address.label,
    street: address.street,
    city: address.city,
    state: address.state,
    zip: address.zip,
  };
}

const CUSTOMER: RecordKind = { noun: "customer", targetType: "customer", table: "customers" };

/** The addresses of `after` that `before` didn't have: the ones the import created. */
function addedAddresses(change: ImportChange): CustomerAddress[] {
  const had = new Set(((change.before as Customer | null)?.addresses ?? []).map((address) => address.id));
  return (change.after as Customer).addresses.filter((address) => !had.has(address.id));
}

/** Inserts addresses of a customer with the plan's ids. */
async function insertAddresses(tx: CompanyDb, customerId: string, list: readonly CustomerAddress[], actorId: string) {
  if (list.length === 0) return;
  await tx
    .insert(addresses)
    .values(list.map((address) => ({ ...addressRow(address), id: address.id, customerId, createdBy: actorId })));
}

/** Writes each address whose columns differ between two versions of a customer. */
async function rewriteAddresses(tx: CompanyDb, from: Customer, to: Customer) {
  const old = new Map(from.addresses.map((address) => [address.id, address]));
  for (const address of to.addresses) {
    const was = old.get(address.id);
    if (was && !sameRecord(addressRow(was), addressRow(address))) {
      await tx.update(addresses).set(addressRow(address)).where(eq(addresses.id, address.id));
    }
  }
}

/** Soft-deletes rows of a table by id (table rules: business records are marked deleted, never removed). */
async function softDelete(tx: CompanyDb, table: typeof customers | typeof addresses, ids: readonly string[]) {
  if (ids.length === 0) return;
  await tx
    .update(table)
    .set({ deletedAt: sql`now()` })
    .where(inArray(table.id, [...ids]));
}

/**
 * Customers and customer addresses (ADR 0057 api 4.7). The tables are locked in the order the
 * customer edit writes them (addresses, then the customer), so module edits wait for the import
 * and a quote or invoice naming a customer does not. An import adds and changes addresses but
 * never deletes one.
 */
export const CUSTOMER_STORE: KindStore = {
  async lock(tx) {
    await tx.execute(sql`lock table addresses, customers in share row exclusive mode`);
  },

  async world(tx, control) {
    return { customers: await loadCustomers(tx), users: await loadMembers(tx, control) };
  },

  async write(tx, change, actorId) {
    const after = change.after as Customer;
    if (change.before === null) {
      // The defaults point at addresses, so they are set once the addresses exist.
      await tx.insert(customers).values({
        ...customerRow(after),
        defaultBillingId: null,
        defaultJobSiteId: null,
        id: after.id,
        taxExempt: false,
        lifecycle: "customer",
        createdBy: actorId,
      });
      await insertAddresses(tx, after.id, after.addresses, actorId);
      if (after.defaultBillingId || after.defaultJobSiteId) {
        await tx
          .update(customers)
          .set({ defaultBillingId: after.defaultBillingId, defaultJobSiteId: after.defaultJobSiteId })
          .where(eq(customers.id, after.id));
      }
      return;
    }
    await insertAddresses(tx, after.id, addedAddresses(change), actorId);
    await rewriteAddresses(tx, change.before as Customer, after);
    await tx.update(customers).set(customerRow(after)).where(eq(customers.id, after.id));
  },

  async current(tx, changes) {
    return byChangeKey("customers", await loadCustomers(tx, idsOf(changes, "customers")));
  },

  createdParts(change) {
    return addedAddresses(change).map((address): ReferenceTarget => ({ table: "addresses", id: address.id }));
  },

  // The rep is the only other record a customer names, a control user; Undo restores it exactly as it was.
  async undoProblem() {
    return null;
  },

  async undo(tx, change) {
    const after = change.after as Customer;
    const created = addedAddresses(change).map((address) => address.id);
    if (change.before === null) {
      await softDelete(tx, addresses, created);
      await softDelete(tx, customers, [after.id]);
      return;
    }
    const before = change.before as Customer;
    await tx.update(customers).set(customerRow(before)).where(eq(customers.id, before.id));
    await rewriteAddresses(tx, after, before);
    await softDelete(tx, addresses, created);
  },

  record: () => CUSTOMER,

  shape(_collection, record) {
    const customer = record as Customer;
    return {
      ...customerAudit(customer),
      creditLimit: customer.creditLimit,
      salesRepId: customer.salesRepId || null,
      externalId: customer.externalId || null,
    };
  },
};
