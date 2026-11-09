import { addDays } from "../dates";
import { computeTotals, type DocLine, type TaxContext } from "../documents";
import { dec } from "../money";
import type { Address, Customer, Invoice, PaymentTerms, Product, Quote, Room } from "../types";
import type { LocalizationSettings } from "../types/settings";
import { quantityForArea, roomAreaSqFt } from "../units";
import { resolveTaxRule, withOverride, type TaxOverride, type TaxSource } from "../us-pack/tax-defaults";

/** Days until payment is due, per payment term. */
export const PAYMENT_TERM_DAYS: Record<PaymentTerms, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
};

/** Labels for payment terms on documents. */
export const PAYMENT_TERM_LABELS: Record<PaymentTerms, string> = {
  due_on_receipt: "Due on receipt",
  net_15: "Net 15",
  net_30: "Net 30",
  net_45: "Net 45",
};

/** Due date of a document issued on `issuedAt` under the given terms. */
export function dueDate(issuedAt: string, terms: PaymentTerms): string {
  return addDays(issuedAt, PAYMENT_TERM_DAYS[terms]);
}

/**
 * Tax context for a document (blueprint "Sales tax engine", spec A5): the job site picks the rule
 * through jurisdiction, state default and company default, and a rate changed on the document
 * wins over all three. A customer is exempt only while their certificate is valid on the date.
 */
export function taxContextFor(
  localization: Pick<LocalizationSettings, "tax" | "region">,
  site: Pick<Address, "state" | "county">,
  customer: Pick<Customer, "taxExempt" | "certificate">,
  on: string,
  lumpSum: boolean,
  override: TaxOverride | null = null,
): TaxContext & { source: TaxSource } {
  const { tax, region } = localization;
  const resolved = resolveTaxRule(tax, region.statesOfOperation, site, on);
  const { rule, source } = withOverride(resolved, site.state, override);
  const exempt = customer.taxExempt && !!customer.certificate && customer.certificate.expiresAt >= on;
  return { rule, exempt, rounding: tax.rounding, lumpSum, source };
}

/**
 * The waste % a new line for a product starts with (spec B3): the company's default for its
 * category; services carry none. People without sales.waste.view never change it.
 */
export function defaultWastePct(
  product: Pick<Product, "category">,
  defaults: LocalizationSettings["documents"]["defaultWastePct"],
): string | undefined {
  return product.category === "service" ? undefined : defaults[product.category];
}

/** Total area of the given rooms in sq ft. */
export function roomsArea(rooms: readonly Room[], roomIds?: readonly string[]) {
  return rooms
    .filter((r) => !roomIds || roomIds.includes(r.id))
    .reduce((s, r) => s.plus(roomAreaSqFt(r.widthFt, r.lengthFt)), dec(0));
}

/**
 * Re-measures lines tied to rooms after a room changes (spec "Quote builder"): materials get
 * the rooms' area plus waste in their selling unit (sq yd or whole cartons); installation labor
 * sold per sq ft gets the net area. Lines not tied to rooms keep their quantity.
 */
export function remeasureLines(
  lines: readonly DocLine[],
  rooms: readonly Room[],
  products: readonly Product[],
): DocLine[] {
  return lines.map((line) => {
    if (!line.roomIds?.length) return line;
    const area = roomsArea(rooms, line.roomIds);
    if (line.category !== "material") {
      return line.unit === "sq_ft" ? { ...line, quantity: area.toDecimalPlaces(2).toString() } : line;
    }
    const product = products.find((p) => p.id === line.productId);
    const quantity = quantityForArea(area, line.wastePct ?? "0", line.unit, product?.sqFtPerCarton);
    return { ...line, quantity: quantity.toString() };
  });
}

/** The next document number after the highest one already used with this prefix, e.g. INV-1228. */
export function nextNumber(prefix: string, existing: readonly string[], start: number): string {
  const used = existing.filter((n) => n.startsWith(prefix)).map((n) => Number(n.slice(prefix.length)));
  const highest = used.filter((n) => Number.isFinite(n)).reduce((max, n) => Math.max(max, n), start - 1);
  return `${prefix}${highest + 1}`;
}

/**
 * Converts a quote into an invoice (spec "Quote builder → invoice"). Totals are recomputed with
 * decimal math under today's tax rule for the job site; the invoice stores the rule version it
 * used, so later rule changes never alter it.
 */
export function invoiceFromQuote(
  quote: Quote,
  customer: Customer,
  localization: Pick<LocalizationSettings, "tax" | "region">,
  input: { id: string; number: string; issuedAt: string; createdBy: string },
): Invoice {
  const ctx = taxContextFor(localization, quote.jobSite, customer, input.issuedAt, quote.lumpSum, quote.taxOverride);
  const totals = computeTotals(quote.lines, ctx);
  return {
    id: input.id,
    number: input.number,
    quoteId: quote.id,
    customerId: customer.id,
    salesRepId: quote.salesRepId,
    branchId: quote.branchId,
    locationId: quote.locationId,
    issuedAt: input.issuedAt,
    dueAt: dueDate(input.issuedAt, customer.terms),
    createdBy: input.createdBy,
    sentAt: null,
    sentBy: null,
    voidedAt: null,
    voidReason: null,
    depositPct: quote.depositPct,
    isReturn: false,
    creditForInvoiceId: null,
    refundedAt: null,
    jobSite: quote.jobSite,
    lines: quote.lines,
    taxRule: ctx.rule
      ? {
          state: ctx.rule.state,
          jurisdiction: ctx.rule.jurisdiction,
          ratePct: ctx.rule.ratePct,
          version: ctx.rule.version,
        }
      : null,
    taxSource: ctx.source,
    taxOverride: quote.taxOverride,
    taxExempt: ctx.exempt,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    cost: totals.cost,
  };
}
