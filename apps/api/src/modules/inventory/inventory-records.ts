import type { CompanyDb } from "@workspace/db";
import { locations, products, rollCuts, rolls, stockMovements, transferLines, transfers } from "@workspace/db/company";
import type { Location, Product, Roll, StockMovement, Transfer } from "@workspace/shared";
import { and, asc, inArray, isNull } from "drizzle-orm";
import { instantOf } from "../sales/invoice-records";

/** Live products as the shared `Product`, by SKU. */
export async function loadProducts(db: CompanyDb): Promise<Product[]> {
  const rows = await db.select().from(products).where(isNull(products.deletedAt)).orderBy(asc(products.sku));
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    collection: row.collection,
    colorName: row.colorName,
    swatch: row.swatch,
    category: row.category,
    unit: row.unit,
    price: row.price,
    cost: row.cost,
    ...(row.sqFtPerCarton === null ? {} : { sqFtPerCarton: row.sqFtPerCarton }),
    // Quantities are decimal strings at their column's scale (CLAUDE.md rule 6; whole-product check F-k).
    ...(row.reorderPoint === null ? {} : { reorderPoint: row.reorderPoint }),
    ...(row.widthFt === null ? {} : { widthFt: row.widthFt }),
    attributes: row.attributes,
    supplierId: row.supplierId ?? "",
    createdAt: instantOf(row.createdAt),
  }));
}

/** Live rolls with their cuts as the shared `Roll`, by roll number. */
export async function loadRolls(db: CompanyDb, ids?: readonly string[]): Promise<Roll[]> {
  const rows = await db
    .select()
    .from(rolls)
    .where(and(isNull(rolls.deletedAt), ids ? inArray(rolls.id, [...ids]) : undefined))
    .orderBy(asc(rolls.rollNumber));
  if (rows.length === 0) return [];
  const cuts = await db
    .select()
    .from(rollCuts)
    .where(
      inArray(
        rollCuts.rollId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(rollCuts.at));
  return rows.map((row) => ({
    id: row.id,
    rollNumber: row.rollNumber,
    productId: row.productId,
    dyeLot: row.dyeLot,
    widthFt: row.widthFt,
    originalLengthFt: row.originalLengthFt,
    remainingLengthFt: row.remainingLengthFt,
    costPerSqFt: row.costPerSqFt,
    locationId: row.locationId,
    bin: row.bin,
    transferId: row.transferId,
    isRemnant: row.isRemnant,
    parentRollId: row.parentRollId,
    receivedAt: instantOf(row.receivedAt),
    cuts: cuts
      .filter((cut) => cut.rollId === row.id)
      .map((cut) => ({
        id: cut.id,
        at: instantOf(cut.at),
        lengthFt: cut.lengthFt,
        reference: cut.reference,
        byUserId: cut.byUserId ?? "",
        ...(cut.sourceType && cut.sourceId
          ? { source: { kind: cut.sourceType, id: cut.sourceId, number: cut.sourceNumber ?? "" } }
          : {}),
      })),
  }));
}

/** The boxed-stock ledger, oldest first. */
export async function loadMovements(db: CompanyDb): Promise<StockMovement[]> {
  const rows = await db.select().from(stockMovements).orderBy(asc(stockMovements.at));
  return rows.map((row) => ({
    id: row.id,
    at: instantOf(row.at),
    productId: row.productId,
    locationId: row.locationId,
    quantity: row.quantity,
    kind: row.kind,
    source: { kind: row.sourceType, id: row.sourceId, number: row.sourceNumber },
    byUserId: row.byUserId,
  }));
}

/** Live warehouses and showrooms. */
export async function loadLocations(db: CompanyDb): Promise<Location[]> {
  const rows = await db.select().from(locations).where(isNull(locations.deletedAt)).orderBy(asc(locations.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    branchId: row.branchId,
    address: row.address,
    isDefault: row.isDefault,
    displaySamples: row.displaySamples,
    ...(row.floorAreaSqFt === null ? {} : { floorAreaSqFt: row.floorAreaSqFt }),
  }));
}

/** Live transfers with their lines, newest first. */
export async function loadTransfers(db: CompanyDb, ids?: readonly string[]): Promise<Transfer[]> {
  const rows = await db
    .select()
    .from(transfers)
    .where(and(isNull(transfers.deletedAt), ids ? inArray(transfers.id, [...ids]) : undefined))
    .orderBy(asc(transfers.createdAt));
  if (rows.length === 0) return [];
  const lines = await db
    .select()
    .from(transferLines)
    .where(
      inArray(
        transferLines.transferId,
        rows.map((row) => row.id),
      ),
    );
  return rows.reverse().map((row) => ({
    id: row.id,
    number: row.number,
    fromId: row.fromId,
    toId: row.toId,
    status: row.status,
    lines: lines
      .filter((line) => line.transferId === row.id && line.deletedAt === null)
      .map((line) => ({ id: line.id, productId: line.productId, rollId: line.rollId, quantity: line.quantity })),
    createdAt: instantOf(row.createdAt),
    createdBy: row.createdBy ?? "",
    receivedAt: row.receivedAt ? instantOf(row.receivedAt) : null,
    receivedBy: row.receivedBy,
    note: row.note,
  }));
}
