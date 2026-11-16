import type { CompanyDb } from "@workspace/db";
import {
  goodsReceipts,
  poLines,
  purchaseOrders,
  receiptLines,
  supplierContacts,
  suppliers,
} from "@workspace/db/company";
import type { GoodsReceipt, PurchaseOrder, Supplier, SupplierContact } from "@workspace/shared";
import { and, asc, desc, inArray, isNull } from "drizzle-orm";

/** A timestamp as the screens read it, `yyyy-MM-ddTHH:mm` like the demo's records. */
function stamp(value: Date): string {
  return value.toISOString().slice(0, 16);
}

/**
 * What a supplier's audit entry keeps: everything that changes who gets orders or money, so a
 * changed email or credit limit can be traced (PR #13 security review). No tax ID is ever stored.
 * The supplier module's save and the import write the same shape.
 */
export function auditedSupplier(supplier: Omit<Supplier, "id" | "status" | "categories" | "externalId">) {
  return {
    name: supplier.name,
    type: supplier.type,
    terms: supplier.terms,
    creditLimit: supplier.creditLimit,
    email: supplier.email,
    phone: supplier.phone,
    accountNumber: supplier.accountNumber,
    track1099: supplier.track1099,
    w9OnFile: supplier.taxForm?.w9OnFile ?? false,
  };
}

/** Live suppliers, by name. */
export async function loadSuppliers(db: CompanyDb, ids?: readonly string[]): Promise<Supplier[]> {
  const rows = await db
    .select()
    .from(suppliers)
    .where(and(isNull(suppliers.deletedAt), ids ? inArray(suppliers.id, [...ids]) : undefined))
    .orderBy(asc(suppliers.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    accountNumber: row.accountNumber,
    email: row.email,
    phone: row.phone,
    terms: row.terms,
    creditLimit: row.creditLimit,
    categories: row.categories as Supplier["categories"],
    address: row.address,
    track1099: row.track1099,
    taxForm: row.taxForm ?? null,
    notes: row.notes,
    ...(row.externalId ? { externalId: row.externalId } : {}),
  }));
}

/** Live supplier contacts, by name. */
export async function loadContacts(db: CompanyDb, ids?: readonly string[]): Promise<SupplierContact[]> {
  const rows = await db
    .select()
    .from(supplierContacts)
    .where(and(isNull(supplierContacts.deletedAt), ids ? inArray(supplierContacts.id, [...ids]) : undefined))
    .orderBy(asc(supplierContacts.name));
  return rows.map((row) => ({
    id: row.id,
    supplierId: row.supplierId,
    name: row.name,
    role: row.role,
    mobile: row.mobile,
    officePhone: row.officePhone,
    email: row.email,
    whatsapp: row.whatsapp,
    preferredMethod: row.preferredMethod,
    notes: row.notes,
    isPrimary: row.isPrimary,
    status: row.status,
  }));
}

/** Live purchase orders with their lines, newest first. */
export async function loadOrders(db: CompanyDb, ids?: readonly string[]): Promise<PurchaseOrder[]> {
  const rows = await db
    .select()
    .from(purchaseOrders)
    .where(and(isNull(purchaseOrders.deletedAt), ids ? inArray(purchaseOrders.id, [...ids]) : undefined))
    .orderBy(desc(purchaseOrders.createdAt));
  if (rows.length === 0) return [];
  const lines = await db
    .select()
    .from(poLines)
    .where(
      and(
        isNull(poLines.deletedAt),
        inArray(
          poLines.poId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(poLines.position));
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    supplierId: row.supplierId,
    status: row.status,
    createdAt: row.createdAt.toISOString().slice(0, 10),
    locationId: row.locationId,
    expectedAt: row.expectedAt,
    orderedAt: row.orderedAt ? row.orderedAt.toISOString().slice(0, 10) : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString().slice(0, 10) : null,
    lines: lines
      .filter((line) => line.poId === row.id)
      .map((line) => ({
        id: line.id,
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitCost: line.unitCost,
        ...(line.sqFtPerCarton === null ? {} : { sqFtPerCarton: line.sqFtPerCarton }),
        ...(line.locationId === null ? {} : { locationId: line.locationId }),
      })),
    total: row.total,
    contactId: row.contactId,
    contactSnapshot: row.contactSnapshot ?? null,
    supplierRef: row.supplierRef,
    buyerId: row.buyerId,
    placedVia: row.placedVia,
  }));
}

/** Live goods receipts with their lines, newest first; `receivedBy` is filled by the caller. */
export async function loadReceipts(db: CompanyDb, poIds?: readonly string[]): Promise<GoodsReceipt[]> {
  const rows = await db
    .select()
    .from(goodsReceipts)
    .where(and(isNull(goodsReceipts.deletedAt), poIds ? inArray(goodsReceipts.poId, [...poIds]) : undefined))
    .orderBy(desc(goodsReceipts.receivedAt));
  if (rows.length === 0) return [];
  const lines = await db
    .select()
    .from(receiptLines)
    .where(
      and(
        isNull(receiptLines.deletedAt),
        inArray(
          receiptLines.receiptId,
          rows.map((row) => row.id),
        ),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    poId: row.poId,
    supplierId: row.supplierId,
    locationId: row.locationId,
    receivedAt: stamp(row.receivedAt),
    receivedById: row.receivedById,
    receivedBy: "",
    note: row.note,
    lines: lines
      .filter((line) => line.receiptId === row.id)
      .map((line) => ({
        poLineId: line.poLineId,
        productId: line.productId,
        received: line.received,
        damaged: line.damaged,
        rolls: line.rolls,
        ...(line.locationId === null ? {} : { locationId: line.locationId }),
      })),
  }));
}
