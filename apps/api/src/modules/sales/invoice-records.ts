import { ConflictException } from "@nestjs/common";
import type { CompanyDb, ControlDb } from "@workspace/db";
import {
  attachments,
  invoiceAdjustments,
  invoiceCommissionSplits,
  invoiceLines,
  invoices,
  paymentsReceived,
  refunds,
  reservations,
  settings,
} from "@workspace/db/company";
import { user } from "@workspace/db/control";
import {
  messageMoney,
  type FileMeta,
  type Invoice,
  type InvoiceAdjustment,
  type NumberSettings,
  type Payment,
  type PaymentSettings,
  type Refund,
  type Reservation,
} from "@workspace/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { ProofOwner } from "./proof-files";
import { dayIn } from "./sales-common";

/** Who did something, by user id, as the screens show it. Users live in the control database (rule 8). */
export type Names = ReadonlyMap<string, string>;

/**
 * A moment as the screens read it: ISO 8601 with its `Z` mark, so the web shows it on the company's
 * clock with the zone named (ADR 0064). Before, it was UTC minutes with no mark, which the screens
 * read as the browser's local time (click-through #57).
 */
export function instantOf(value: Date): string {
  return value.toISOString();
}

/** The names of the given people, from the control database; an unknown id reads as empty. */
export async function loadNames(control: ControlDb, ids: Iterable<string | null | undefined>): Promise<Names> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const rows = await control.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, wanted));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** The company's payment settings (spec "Settings > Payments"); a company without them may not take money. */
export async function loadPaymentSettings(db: CompanyDb): Promise<PaymentSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "payments"));
  if (!row) {
    throw new ConflictException({
      code: "settings_missing",
      message: "Finish Settings → Payments before recording payments.",
    });
  }
  return row.value as PaymentSettings;
}

/** Which records a loader reads: by their own ids, their invoices or their customer; none means all. */
export interface RecordFilter {
  ids?: readonly string[];
  invoiceIds?: readonly string[];
  customerId?: string;
}

/**
 * Live invoices and credit notes with their lines and commission split, newest first. Their dates
 * are the company's days, in its time zone `zone` (`companyClock`).
 */
export async function loadInvoices(db: CompanyDb, zone: string, filter: RecordFilter = {}): Promise<Invoice[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(
      and(
        isNull(invoices.deletedAt),
        filter.ids ? inArray(invoices.id, [...filter.ids]) : undefined,
        filter.customerId ? eq(invoices.customerId, filter.customerId) : undefined,
      ),
    )
    .orderBy(desc(invoices.issuedAt), desc(invoices.number));
  if (rows.length === 0) return [];
  const invoiceIds = rows.map((row) => row.id);
  const [lines, splits] = await Promise.all([
    db
      .select()
      .from(invoiceLines)
      .where(and(isNull(invoiceLines.deletedAt), inArray(invoiceLines.invoiceId, invoiceIds)))
      .orderBy(asc(invoiceLines.position)),
    db
      .select()
      .from(invoiceCommissionSplits)
      .where(and(isNull(invoiceCommissionSplits.deletedAt), inArray(invoiceCommissionSplits.invoiceId, invoiceIds)))
      .orderBy(desc(invoiceCommissionSplits.pct), asc(invoiceCommissionSplits.id)),
  ]);
  return rows.map((row) => {
    const split = splits.filter((share) => share.invoiceId === row.id);
    return {
      id: row.id,
      number: row.number,
      quoteId: row.quoteId,
      customerId: row.customerId,
      salesRepId: row.salesRepId,
      branchId: row.branchId,
      locationId: row.locationId,
      ...(row.soldAtLocationId ? { soldAtLocationId: row.soldAtLocationId } : {}),
      issuedAt: dayIn(row.issuedAt, zone),
      dueAt: row.dueAt,
      createdBy: row.createdBy ?? "",
      createdAt: instantOf(row.createdAt),
      sentAt: row.sentAt ? dayIn(row.sentAt, zone) : null,
      sentBy: row.sentBy,
      voidedAt: row.voidedAt ? dayIn(row.voidedAt, zone) : null,
      voidReason: row.voidReason,
      depositPct: row.depositPct,
      isReturn: row.isReturn,
      creditForInvoiceId: row.creditForInvoiceId,
      refundedAt: row.refundedAt ? dayIn(row.refundedAt, zone) : null,
      jobSite: row.jobSite,
      lines: lines
        .filter((line) => line.invoiceId === row.id)
        .map((line) => ({
          id: line.id,
          ...(line.productId ? { productId: line.productId } : {}),
          description: line.description,
          category: line.category,
          unit: line.unit,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitCost: line.unitCost,
          ...(line.wastePct === null ? {} : { wastePct: line.wastePct }),
          ...(line.rollId ? { rollId: line.rollId } : {}),
          ...(line.sqFtPerCarton === null ? {} : { sqFtPerCarton: line.sqFtPerCarton }),
          ...(line.locationId ? { locationId: line.locationId } : {}),
        })),
      taxRule: row.taxRule ?? null,
      taxSource: row.taxSource,
      taxOverride: row.taxOverride ?? null,
      taxExempt: row.taxExempt,
      subtotal: row.subtotal,
      tax: row.tax,
      total: row.total,
      cost: row.cost,
      ...(split.length > 0 ? { commissionSplit: split.map(({ userId, pct }) => ({ userId, pct })) } : {}),
      ...(row.contractId ? { contractId: row.contractId } : {}),
      ...(row.billingId ? { billingId: row.billingId } : {}),
      ...(row.retainageWithheld === null ? {} : { retainageWithheld: row.retainageWithheld }),
      ...(row.retainageReleased === null ? {} : { retainageReleased: row.retainageReleased }),
    };
  });
}

/** Proof file rows of payments, refunds or expenses, oldest first. */
export function fileRows(db: CompanyDb, ownerType: ProofOwner, ownerIds?: readonly string[]) {
  return db
    .select()
    .from(attachments)
    .where(
      and(
        isNull(attachments.deletedAt),
        eq(attachments.ownerType, ownerType),
        ownerIds ? inArray(attachments.ownerId, [...ownerIds]) : undefined,
      ),
    )
    .orderBy(asc(attachments.uploadedAt), asc(attachments.id));
}

/** Proof files by owner id, as the screens show them. */
export function filesByOwner(rows: Awaited<ReturnType<typeof fileRows>>, names: Names): Map<string, FileMeta[]> {
  const byOwner = new Map<string, FileMeta[]>();
  for (const row of rows) {
    const list = byOwner.get(row.ownerId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      type: row.contentType,
      size: row.size,
      uploadedBy: names.get(row.createdBy ?? "") ?? "",
      uploadedAt: instantOf(row.uploadedAt),
    });
    byOwner.set(row.ownerId, list);
  }
  return byOwner;
}

/** Customer payments with their proof files, newest first; names come from the control database. */
export async function loadPayments(db: CompanyDb, control: ControlDb, filter: RecordFilter = {}): Promise<Payment[]> {
  const rows = await db
    .select()
    .from(paymentsReceived)
    .where(
      and(
        isNull(paymentsReceived.deletedAt),
        filter.ids ? inArray(paymentsReceived.id, [...filter.ids]) : undefined,
        filter.invoiceIds ? inArray(paymentsReceived.invoiceId, [...filter.invoiceIds]) : undefined,
        filter.customerId ? eq(paymentsReceived.customerId, filter.customerId) : undefined,
      ),
    )
    .orderBy(desc(paymentsReceived.recordedAt), desc(paymentsReceived.number));
  const fileList = rows.length === 0 ? [] : await fileRows(db, "payment", filter.ids ?? rows.map((row) => row.id));
  const names = await loadNames(control, [
    ...rows.flatMap((row) => [row.recordedById, row.reviewedById, row.voidedById]),
    ...fileList.map((row) => row.createdBy),
  ]);
  const files = filesByOwner(fileList, names);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "") : null);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    invoiceId: row.invoiceId,
    customerId: row.customerId,
    kind: row.kind,
    amount: row.amount,
    date: row.date,
    method: row.method,
    checkNumber: row.checkNumber,
    cardLast4: row.cardLast4,
    reference: row.reference,
    note: row.note,
    files: files.get(row.id) ?? [],
    status: row.status,
    recordedById: row.recordedById,
    recordedBy: names.get(row.recordedById) ?? "",
    recordedAt: instantOf(row.recordedAt),
    reviewedBy: nameOf(row.reviewedById),
    reviewedAt: row.reviewedAt ? instantOf(row.reviewedAt) : null,
    rejectReason: row.rejectReason,
    voidedBy: nameOf(row.voidedById),
    voidedAt: row.voidedAt ? instantOf(row.voidedAt) : null,
    voidReason: row.voidReason,
  }));
}

/** Write-offs and credit applied to invoices, oldest first. */
export async function loadAdjustments(
  db: CompanyDb,
  control: ControlDb,
  filter: RecordFilter = {},
): Promise<InvoiceAdjustment[]> {
  const rows = await db
    .select()
    .from(invoiceAdjustments)
    .where(
      and(
        isNull(invoiceAdjustments.deletedAt),
        filter.ids ? inArray(invoiceAdjustments.id, [...filter.ids]) : undefined,
        filter.invoiceIds ? inArray(invoiceAdjustments.invoiceId, [...filter.invoiceIds]) : undefined,
        filter.customerId ? eq(invoiceAdjustments.customerId, filter.customerId) : undefined,
      ),
    )
    .orderBy(asc(invoiceAdjustments.at), asc(invoiceAdjustments.id));
  const names = await loadNames(
    control,
    rows.map((row) => row.byUserId),
  );
  return rows.map((row) => ({
    id: row.id,
    invoiceId: row.invoiceId,
    customerId: row.customerId,
    kind: row.kind,
    amount: row.amount,
    reason: row.reason,
    byName: names.get(row.byUserId) ?? "",
    at: instantOf(row.at),
  }));
}

/** Customer credit paid back, with proof, newest first. */
export async function loadRefunds(db: CompanyDb, control: ControlDb, filter: RecordFilter = {}): Promise<Refund[]> {
  const rows = await db
    .select()
    .from(refunds)
    .where(
      and(
        isNull(refunds.deletedAt),
        filter.ids ? inArray(refunds.id, [...filter.ids]) : undefined,
        filter.customerId ? eq(refunds.customerId, filter.customerId) : undefined,
      ),
    )
    .orderBy(desc(refunds.at), desc(refunds.number));
  const fileList = rows.length === 0 ? [] : await fileRows(db, "refund", filter.ids ?? rows.map((row) => row.id));
  const names = await loadNames(control, [...rows.map((row) => row.byUserId), ...fileList.map((row) => row.createdBy)]);
  const files = filesByOwner(fileList, names);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    amount: row.amount,
    date: row.date,
    method: row.method,
    reference: row.reference,
    note: row.note,
    files: files.get(row.id) ?? [],
    status: row.status,
    byName: names.get(row.byUserId) ?? "",
    at: instantOf(row.at),
  }));
}

/** Stock held for invoice lines, oldest first. */
export async function loadReservations(db: CompanyDb, invoiceIds?: readonly string[]): Promise<Reservation[]> {
  const rows = await db
    .select()
    .from(reservations)
    .where(
      and(isNull(reservations.deletedAt), invoiceIds ? inArray(reservations.invoiceId, [...invoiceIds]) : undefined),
    )
    .orderBy(asc(reservations.createdAt), asc(reservations.id));
  return rows.map((row) => ({
    id: row.id,
    invoiceId: row.invoiceId,
    lineId: row.invoiceLineId,
    productId: row.productId,
    rollId: row.rollId,
    locationId: row.locationId,
    quantity: row.quantity,
    shortBy: row.shortBy,
    status: row.status,
    createdAt: instantOf(row.createdAt),
    closedAt: row.closedAt ? instantOf(row.closedAt) : null,
    overrideReason: row.overrideReason,
  }));
}

/**
 * How the company writes money in emails, in-app titles and refusals (Settings → Numbers), e.g.
 * "$1,250.00": the shared `messageMoney`, with the US pack's format when none is saved (spec rule
 * 11; ADR 0059, bell and Outbox part, D6).
 */
export async function loadMoneyFormat(db: CompanyDb): Promise<(value: string) => string> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "numbers"));
  const numbers = row?.value as NumberSettings | undefined;
  return (value) => messageMoney(value, numbers);
}
