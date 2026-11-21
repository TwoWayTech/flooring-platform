import { formatWhen } from "@/lib/moments";
import {
  acceptedTotalIfDifferent,
  cartonEquivalent,
  dec,
  formatDocumentNumber,
  invoiceTermsText,
  PAYMENT_METHOD_LABELS,
  lineAmount,
  quantityKind,
  stateName,
  UNIT_LABELS,
  type Address,
  type CompanySettings,
  type DocLine,
  type Customer,
  type DecimalInput,
  type DocumentNumberKind,
  type Invoice,
  type InvoiceLedger,
  type Payment,
  type Quote,
  defaultAddress,
  plainAddress,
} from "@workspace/shared";

/** Formats one number for the document (`formatDocumentNumber`). */
type DocFormat = (value: DecimalInput, kind: DocumentNumberKind) => string;

/** "≈ 22 cartons", or null for a line not sold in cartons (spec A1). The PDF prints "about" (`pdfText`). */
function cartonNote(line: DocLine, fmt: DocFormat): string | null {
  if (!line.sqFtPerCarton) return null;
  const { cartons } = cartonEquivalent(line.quantity, line.sqFtPerCarton);
  return `≈ ${fmt(cartons, "count")} ${cartons === 1 ? "carton" : "cartons"}`;
}

/** What a balance held until installation reads as its due date (spec B6). */
export const HELD_LABEL = "After installation";

/** One printed invoice line, every value already formatted. */
export interface ModelLine {
  id: string;
  description: string;
  quantity: string;
  /** The carton equivalent, for boxed goods (spec A1). */
  cartons: string | null;
  price: string;
  amount: string;
}

/**
 * An invoice exactly as it is shown and printed. The screen and the PDF both render this, so
 * the PDF matches the screen (spec "Quote builder → invoice"). Numbers print at full precision
 * whatever the display setting (`formatDocumentNumber`, click-through #55), so the lines and totals
 * add up; totals were fixed by the decimal calculator when the invoice was made.
 */
export interface InvoiceModel {
  number: string;
  quoteNumber: string | null;
  issued: string;
  due: string;
  terms: string;
  company: { name: string; lines: string[]; brandColor: string; monogram: string };
  billTo: { name: string; lines: string[] };
  jobSite: string[];
  lines: ModelLine[];
  subtotal: string;
  taxLabel: string;
  /** Where the rate came from (spec A5); shown on screen, not printed for the customer. */
  taxSource: string;
  /**
   * Printed when the tax differs from the quote the customer accepted (`acceptedTotalIfDifferent`;
   * owner's answer of 2026-11-20): the invoice follows the rule in force on its own date.
   */
  taxNote: string | null;
  tax: string;
  total: string;
  paid: string;
  /** Credit applied and amounts written off, shown only when there are some. */
  credited: string | null;
  writtenOff: string | null;
  balanceDue: string;
  /** The day the invoice was settled, for the PAID mark (spec Appendix A); null while a balance is due. */
  paidOn: string | null;
  /** A void invoice prints VOID instead. */
  voided: boolean;
  payments: { id: string; date: string; method: string; amount: string }[];
  footer: string;
}

function addressLines(a: Address): string[] {
  return [a.street, `${a.city}, ${a.state} ${a.zip}`.trim()].filter((l) => l.replace(/[ ,]/g, ""));
}

/**
 * How tax was charged, as the invoice states it. A contract billing that charged no tax, though a
 * rule applies, says so: the contractor pays the tax, or a release was taxed when billed
 * (contracts.md rule 13). Wording only; the tax rules themselves are unchanged (ADR 0061, 10).
 */
function taxLabel(invoice: Invoice, fmt: DocFormat): string {
  if (invoice.taxExempt) return "Sales tax, exempt (resale certificate on file)";
  if (!invoice.taxRule) return `Sales tax, not collected in ${stateName(invoice.jobSite.state)}`;
  if (invoice.contractId && dec(invoice.tax).isZero()) return "Sales tax, not charged (contract billing)";
  return `Sales tax, ${invoice.taxRule.jurisdiction} ${fmt(invoice.taxRule.ratePct, "taxRate")}`;
}

/** The note an invoice prints when its total differs from the accepted quote's (sales.md rule 18). */
function taxNote(
  invoice: Invoice,
  quote: Quote | undefined,
  fmt: DocFormat,
  date: (iso: string) => string,
): string | null {
  const accepted = acceptedTotalIfDifferent(invoice, quote);
  if (accepted === null || !quote) return null;
  return `Sales tax follows the rate in force on ${date(invoice.issuedAt)}, so this total differs from the ${fmt(accepted, "money")} accepted on quote ${quote.number}.`;
}

/**
 * Builds the invoice model from the invoice, its ledger, customer, quote, payments and company
 * settings. Only confirmed payments are printed; paid and balance due come from the ledger
 * (spec Appendix A "Payments on the invoice"). `zone` is the company's zone, the one the screens
 * show moments in (`useTimeZone`, from GET /company), never the settings copy.
 */
export function buildInvoiceModel(
  invoice: Invoice,
  ledger: InvoiceLedger,
  customer: Customer,
  quote: Quote | undefined,
  payments: readonly Payment[],
  settings: CompanySettings,
  zone: string,
): InvoiceModel {
  const fmt: DocFormat = (v, kind) => formatDocumentNumber(v, kind, settings.numbers);
  const pattern = settings.localization.region.dateFormat;
  // A moment is printed as the company's day; a calendar date as it is (ADR 0064).
  const date = (iso: string) => formatWhen(iso, { pattern, zone });
  const { profile, branding } = settings;
  return {
    number: invoice.number,
    quoteNumber: quote?.number ?? null,
    issued: date(invoice.issuedAt),
    due: invoice.dueAt ? date(invoice.dueAt) : HELD_LABEL,
    terms: invoiceTermsText(invoice, customer.terms),
    company: {
      name: branding.displayName,
      lines: [profile.legalName, ...addressLines(profile.address), profile.phone, profile.email],
      brandColor: branding.brandColor,
      monogram: branding.monogram,
    },
    billTo: {
      name: customer.name,
      lines: [
        customer.contactName !== customer.name ? customer.contactName : "",
        ...addressLines(plainAddress(defaultAddress(customer, "billing"))),
      ].filter(Boolean),
    },
    jobSite: addressLines(invoice.jobSite),
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: `${fmt(line.quantity, quantityKind(line.unit))} ${UNIT_LABELS[line.unit]}`,
      cartons: cartonNote(line, fmt),
      price: fmt(line.unitPrice, "unitPrice"),
      amount: fmt(lineAmount(line), "money"),
    })),
    subtotal: fmt(invoice.subtotal, "money"),
    taxLabel: taxLabel(invoice, fmt),
    taxSource: invoice.taxExempt ? "" : invoice.taxSource.label,
    taxNote: taxNote(invoice, quote, fmt, date),
    tax: fmt(invoice.tax, "money"),
    total: fmt(invoice.total, "money"),
    paid: fmt(ledger.paid, "money"),
    credited: dec(ledger.credited).isZero() ? null : fmt(ledger.credited, "money"),
    writtenOff: dec(ledger.writtenOff).isZero() ? null : fmt(ledger.writtenOff, "money"),
    balanceDue: fmt(ledger.balance, "money"),
    paidOn: (ledger.state === "paid" || ledger.state === "overpaid") && ledger.paidAt ? date(ledger.paidAt) : null,
    voided: ledger.state === "void",
    payments: payments
      .filter((p) => p.invoiceId === invoice.id && p.status === "confirmed")
      .map((p) => ({
        id: p.id,
        date: date(p.date),
        method: PAYMENT_METHOD_LABELS[p.method],
        amount: fmt(p.amount, "money"),
      })),
    footer: settings.localization.documents.legalFooter,
  };
}
