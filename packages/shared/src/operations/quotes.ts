import { addDays } from "../dates";
import { computeTotals, productTaxCategory, storedCost, type DocLine, type TaxContext } from "../documents";
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

/**
 * The saved line a sent quote line stands for (sales.md rule 8; STATUS B6): the one with the same
 * id and the same product, or none. A line sent under a saved line's id with another product, or
 * without the product it had, is a new line, so it keeps nothing that was checked for the saved
 * line: not its waste, nor a line without a product's category and cost. The API's `trustedLines`
 * and `assertWaste` and the demo's `wasteChanged` all use it, so they agree on which line is which.
 */
export function savedQuoteLine<T extends Pick<DocLine, "id" | "productId">>(
  saved: readonly T[] | undefined,
  line: Pick<DocLine, "id" | "productId">,
): T | undefined {
  return saved?.find((candidate) => candidate.id === line.id && (candidate.productId ?? "") === (line.productId ?? ""));
}

/** Whether a new line is measured from the rooms: anything sold per sq ft, goods and labor alike. */
function measuredFromRooms(product: Pick<Product, "unit">): boolean {
  return product.unit === "sq_ft";
}

/**
 * A new quote line for a product (spec "Quote builder"): tied to every room when it is sold per sq ft
 * and the quote has rooms, otherwise one unit. Its cost is the product's as the viewer received it:
 * absent for a viewer without product cost, because the API strips it (CLAUDE.md rule 5). It is never
 * filled in: the server costs the line from the catalog (`trustedLines`), and computeTotals leaves
 * margin unknown (sales.md rule 13; ADR 0037, 2026-11-16).
 */
export function quoteLineFor(
  product: Product,
  lineId: string,
  rooms: readonly Room[],
  waste: LocalizationSettings["documents"]["defaultWastePct"],
): DocLine {
  const linked = rooms.length > 0 && measuredFromRooms(product);
  return {
    id: lineId,
    productId: product.id,
    description: product.category === "service" ? product.name : `${product.brand} ${product.name}`,
    category: productTaxCategory(product),
    unit: product.unit,
    quantity: "1",
    unitPrice: product.price,
    // Absent when the API withheld it, and never a placeholder: a "0" would show a 100 % margin.
    unitCost: product.cost,
    ...(product.sqFtPerCarton ? { sqFtPerCarton: product.sqFtPerCarton } : {}),
    ...(product.category !== "service" ? { wastePct: defaultWastePct(product, waste) } : {}),
    ...(linked ? { roomIds: rooms.map((r) => r.id) } : {}),
  };
}

/** Total area of the given rooms in sq ft. */
export function roomsArea(rooms: readonly Room[], roomIds?: readonly string[]) {
  return rooms
    .filter((r) => !roomIds || roomIds.includes(r.id))
    .reduce((s, r) => s.plus(roomAreaSqFt(r.widthFt, r.lengthFt)), dec(0));
}

/**
 * Re-measures lines tied to rooms after a room changes (spec "Quote builder"): materials get
 * the rooms' area plus waste in sq ft, rounded up to whole cartons for boxed goods; installation
 * labor sold per sq ft gets the net area. Lines not tied to rooms keep their quantity.
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
    const quantity = quantityForArea(area, line.wastePct ?? "0", product?.sqFtPerCarton);
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
 * When an invoice from a quote falls due (plan K-3). Every invoice has a date under the customer's
 * terms, except that a deposit invoice's balance gets at least the company's balance days, or it
 * would be overdue the day it is issued on "due on receipt" terms. With the Installation module
 * on, the balance waits for the job instead (spec B6), which is the null date.
 */
function invoiceDueDate(
  quote: Pick<Quote, "depositPct">,
  terms: PaymentTerms,
  input: { issuedAt: string; holdUntilInstalled?: boolean; balanceDueDays?: number },
): string | null {
  const deposit = dec(quote.depositPct || "0").gt(0);
  if (input.holdUntilInstalled && deposit) return null;
  const byTerms = dueDate(input.issuedAt, terms);
  if (!deposit || !input.balanceDueDays) return byTerms;
  const byBalance = addDays(input.issuedAt, input.balanceDueDays);
  return byBalance > byTerms ? byBalance : byTerms;
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
  input: {
    id: string;
    number: string;
    issuedAt: string;
    createdBy: string;
    holdUntilInstalled?: boolean;
    /** Days until the balance of a deposit invoice is due (plan K-3). */
    balanceDueDays?: number;
  },
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
    ...(quote.soldAtLocationId ? { soldAtLocationId: quote.soldAtLocationId } : {}),
    issuedAt: input.issuedAt,
    dueAt: invoiceDueDate(quote, customer.terms, input),
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
    cost: storedCost(totals),
  };
}
