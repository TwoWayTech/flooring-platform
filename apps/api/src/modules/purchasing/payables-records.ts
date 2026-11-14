import type { CompanyDb, ControlDb } from "@workspace/db";
import { billReceipts, paymentAllocations, paymentsMade, supplierBills } from "@workspace/db/company";
import type { Bill, SupplierPayment } from "@workspace/shared";
import { and, asc, desc, inArray, isNull } from "drizzle-orm";
import { fileRows, filesByOwner, loadNames, minuteOf } from "../sales/invoice-records";

/**
 * Supplier bills with their receipts and the supplier's invoice files (purchasing.md "Bill").
 * What is paid is never stored on a bill: it comes from the allocations of supplier payments.
 */
export async function loadBills(db: CompanyDb, control: ControlDb, ids?: readonly string[]): Promise<Bill[]> {
  const rows = await db
    .select()
    .from(supplierBills)
    .where(and(isNull(supplierBills.deletedAt), ids ? inArray(supplierBills.id, [...ids]) : undefined))
    .orderBy(desc(supplierBills.issuedAt), desc(supplierBills.number));
  if (rows.length === 0) return [];
  const billIds = rows.map((row) => row.id);
  const [links, fileList] = await Promise.all([
    db
      .select({ billId: billReceipts.billId, receiptId: billReceipts.receiptId })
      .from(billReceipts)
      .where(and(isNull(billReceipts.deletedAt), inArray(billReceipts.billId, billIds))),
    fileRows(db, "bill", billIds),
  ]);
  const files = filesByOwner(
    fileList,
    await loadNames(
      control,
      fileList.map((row) => row.createdBy),
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    supplierId: row.supplierId,
    poId: row.poId,
    receiptIds: links.filter((link) => link.billId === row.id).map((link) => link.receiptId),
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    total: row.total,
    matchIssues: row.matchIssues,
    files: files.get(row.id) ?? [],
    ...(row.contractId ? { contractId: row.contractId } : {}),
    ...(row.billingId ? { billingId: row.billingId } : {}),
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.gross ? { gross: row.gross } : {}),
    ...(row.retainageWithheld ? { retainageWithheld: row.retainageWithheld } : {}),
    ...(row.retainageReleased ? { retainageReleased: row.retainageReleased } : {}),
  }));
}

/** Supplier payments with their allocations, proof files and who recorded, reviewed and voided them. */
export async function loadSupplierPayments(
  db: CompanyDb,
  control: ControlDb,
  ids?: readonly string[],
): Promise<SupplierPayment[]> {
  const rows = await db
    .select()
    .from(paymentsMade)
    .where(and(isNull(paymentsMade.deletedAt), ids ? inArray(paymentsMade.id, [...ids]) : undefined))
    .orderBy(desc(paymentsMade.recordedAt), desc(paymentsMade.number));
  if (rows.length === 0) return [];
  const paymentIds = rows.map((row) => row.id);
  const [allocations, fileList] = await Promise.all([
    db
      .select()
      .from(paymentAllocations)
      .where(and(isNull(paymentAllocations.deletedAt), inArray(paymentAllocations.paymentId, paymentIds)))
      .orderBy(asc(paymentAllocations.createdAt), asc(paymentAllocations.id)),
    fileRows(db, "supplier_payment", paymentIds),
  ]);
  const names = await loadNames(control, [
    ...rows.flatMap((row) => [row.recordedById, row.reviewedById, row.voidedById]),
    ...fileList.map((row) => row.createdBy),
  ]);
  const files = filesByOwner(fileList, names);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "") : null);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    supplierId: row.supplierId,
    date: row.date,
    method: row.method,
    reference: row.reference,
    note: row.note,
    files: files.get(row.id) ?? [],
    allocations: allocations
      .filter((entry) => entry.paymentId === row.id)
      .map((entry) => ({ billId: entry.billId, amount: entry.amount })),
    amount: row.amount,
    status: row.status,
    recordedById: row.recordedById,
    recordedBy: names.get(row.recordedById) ?? "",
    recordedAt: minuteOf(row.recordedAt),
    reviewedBy: nameOf(row.reviewedById),
    reviewedAt: row.reviewedAt ? minuteOf(row.reviewedAt) : null,
    rejectReason: row.rejectReason,
    voidedBy: nameOf(row.voidedById),
    voidedAt: row.voidedAt ? minuteOf(row.voidedAt) : null,
    voidReason: row.voidReason,
  }));
}
