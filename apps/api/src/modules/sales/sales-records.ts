import type { CompanyDb } from "@workspace/db";
import {
  addresses,
  customers,
  exemptionCertificates,
  invoices,
  measurementRooms,
  quoteLines,
  quotes,
  settings,
  taxJurisdictions,
  taxRules,
  userProfiles,
} from "@workspace/db/company";
import type { Customer, LocalizationSettings, Quote } from "@workspace/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

/** A day as the screens read it, `yyyy-MM-dd`. */
function dayOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The company's localization settings with its tax rules and county rates, which live in their own
 * tables because they carry effective dates (data-model "Settings groups"). The tax engine reads it.
 */
export async function loadLocalization(db: CompanyDb): Promise<LocalizationSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "localization"));
  if (!row) throw new Error("The company has no localization settings.");
  const stored = row.value as LocalizationSettings;
  const [rules, jurisdictions] = await Promise.all([
    db.select().from(taxRules).where(isNull(taxRules.deletedAt)),
    db.select().from(taxJurisdictions).where(isNull(taxJurisdictions.deletedAt)),
  ]);
  return {
    ...stored,
    tax: {
      ...stored.tax,
      rules: rules.map((rule) => ({
        state: rule.state,
        jurisdiction: rule.jurisdiction,
        ratePct: rule.ratePct,
        taxable: rule.taxable,
        lumpSumLaborTaxable: rule.lumpSumLaborTaxable,
        validFrom: rule.validFrom,
        validTo: rule.validTo,
        version: rule.version,
        rationale: rule.rationale,
      })),
      jurisdictions: jurisdictions.map((rate) => ({
        id: rate.id,
        state: rate.state,
        county: rate.county,
        name: rate.name,
        ratePct: rate.ratePct,
        validFrom: rate.validFrom,
        validTo: rate.validTo,
      })),
    },
  };
}

/** Each person's branch in this company, by user id, for branch data scope. */
export async function loadBranches(db: CompanyDb): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ userId: userProfiles.userId, branchId: userProfiles.branchId })
    .from(userProfiles)
    .where(isNull(userProfiles.deletedAt));
  return new Map(rows.map((row) => [row.userId, row.branchId]));
}

/** Live customers with their addresses and certificate, by name. */
export async function loadCustomers(db: CompanyDb, ids?: readonly string[]): Promise<Customer[]> {
  const rows = await db
    .select()
    .from(customers)
    .where(and(isNull(customers.deletedAt), ids ? inArray(customers.id, [...ids]) : undefined))
    .orderBy(asc(customers.name));
  if (rows.length === 0) return [];
  const customerIds = rows.map((row) => row.id);
  const [places, certificates] = await Promise.all([
    db
      .select()
      .from(addresses)
      .where(and(isNull(addresses.deletedAt), inArray(addresses.customerId, customerIds)))
      .orderBy(asc(addresses.createdAt)),
    db
      .select()
      .from(exemptionCertificates)
      .where(and(isNull(exemptionCertificates.deletedAt), inArray(exemptionCertificates.customerId, customerIds))),
  ]);
  return rows.map((row) => {
    const certificate = certificates.find((candidate) => candidate.customerId === row.id);
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      addresses: places
        .filter((place) => place.customerId === row.id)
        .map((place) => ({
          id: place.id,
          label: place.label,
          street: place.street,
          city: place.city,
          state: place.state,
          zip: place.zip,
          ...(place.county ? { county: place.county } : {}),
          ...(place.lat === null ? {} : { lat: place.lat }),
          ...(place.lng === null ? {} : { lng: place.lng }),
        })),
      defaultBillingId: row.defaultBillingId,
      defaultJobSiteId: row.defaultJobSiteId,
      terms: row.terms,
      creditLimit: row.creditLimit,
      taxExempt: row.taxExempt,
      certificate: certificate
        ? { number: certificate.number, state: certificate.state, expiresAt: certificate.expiresAt }
        : null,
      salesRepId: row.salesRepId ?? "",
      createdAt: dayOf(row.createdAt),
      lifecycle: row.lifecycle,
      ...(row.externalId ? { externalId: row.externalId } : {}),
    };
  });
}

/** Live quotes with their rooms and lines, newest first; `invoiceId` comes from the invoice that converted it. */
export async function loadQuotes(db: CompanyDb, ids?: readonly string[]): Promise<Quote[]> {
  const rows = await db
    .select()
    .from(quotes)
    .where(and(isNull(quotes.deletedAt), ids ? inArray(quotes.id, [...ids]) : undefined))
    .orderBy(desc(quotes.createdAt));
  if (rows.length === 0) return [];
  const quoteIds = rows.map((row) => row.id);
  const [rooms, lines, converted] = await Promise.all([
    db
      .select()
      .from(measurementRooms)
      .where(and(isNull(measurementRooms.deletedAt), inArray(measurementRooms.quoteId, quoteIds))),
    db
      .select()
      .from(quoteLines)
      .where(and(isNull(quoteLines.deletedAt), inArray(quoteLines.quoteId, quoteIds)))
      .orderBy(asc(quoteLines.position)),
    db
      .select({ id: invoices.id, quoteId: invoices.quoteId })
      .from(invoices)
      .where(and(isNull(invoices.deletedAt), inArray(invoices.quoteId, quoteIds))),
  ]);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    salesRepId: row.salesRepId,
    branchId: row.branchId,
    status: row.status,
    createdAt: dayOf(row.createdAt),
    sentAt: row.sentAt ? dayOf(row.sentAt) : null,
    expiresAt: row.expiresAt,
    locationId: row.locationId,
    ...(row.soldAtLocationId ? { soldAtLocationId: row.soldAtLocationId } : {}),
    jobSite: row.jobSite,
    rooms: rooms
      .filter((room) => room.quoteId === row.id)
      .map((room) => ({
        id: room.id,
        name: room.name,
        x: room.x,
        y: room.y,
        widthFt: Number(room.widthFt),
        lengthFt: Number(room.lengthFt),
      })),
    lines: lines
      .filter((line) => line.quoteId === row.id)
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
        ...(line.roomIds.length > 0 ? { roomIds: line.roomIds } : {}),
        ...(line.rollId ? { rollId: line.rollId } : {}),
        ...(line.sqFtPerCarton === null ? {} : { sqFtPerCarton: line.sqFtPerCarton }),
        ...(line.locationId ? { locationId: line.locationId } : {}),
      })),
    depositPct: row.depositPct,
    lumpSum: row.lumpSum,
    taxOverride: row.taxOverride ?? null,
    invoiceId: converted.find((invoice) => invoice.quoteId === row.id)?.id ?? null,
    total: row.total,
    notes: row.notes,
  }));
}
