import { format, parseISO } from "date-fns";
import {
  balance,
  formatNumber,
  lineAmount,
  PAYMENT_TERM_LABELS,
  quantityKind,
  stateName,
  UNIT_LABELS,
  type Address,
  type CompanySettings,
  type Customer,
  type DecimalInput,
  type Invoice,
  type NumberKind,
  type Payment,
  type Quote,
} from "@workspace/shared";

/** One printed invoice line, every value already formatted. */
export interface ModelLine {
  id: string;
  description: string;
  quantity: string;
  price: string;
  amount: string;
}

/**
 * An invoice exactly as it is shown and printed. The screen and the PDF both render this, so
 * the PDF matches the screen (spec "Quote builder → invoice"). Numbers use the company's
 * display settings; totals were fixed by the decimal calculator when the invoice was made.
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
  tax: string;
  total: string;
  paid: string;
  balanceDue: string;
  payments: { id: string; date: string; method: string; amount: string }[];
  footer: string;
}

const METHOD_LABELS: Record<Payment["method"], string> = {
  card: "Card",
  check: "Check",
  ach: "Bank transfer",
  cash: "Cash",
};

function addressLines(a: Address): string[] {
  return [a.street, `${a.city}, ${a.state} ${a.zip}`.trim()].filter((l) => l.replace(/[ ,]/g, ""));
}

/** How tax was charged, as the invoice states it. */
function taxLabel(invoice: Invoice, fmt: (v: DecimalInput, k: NumberKind) => string): string {
  if (invoice.taxExempt) return "Sales tax, exempt (resale certificate on file)";
  if (!invoice.taxRule) return `Sales tax, not collected in ${stateName(invoice.jobSite.state)}`;
  return `Sales tax, ${invoice.taxRule.jurisdiction} ${fmt(invoice.taxRule.ratePct, "taxRate")}`;
}

/** Builds the invoice model from the invoice, its customer, quote, payments and company settings. */
export function buildInvoiceModel(
  invoice: Invoice,
  customer: Customer,
  quote: Quote | undefined,
  payments: readonly Payment[],
  settings: CompanySettings,
): InvoiceModel {
  const fmt = (v: DecimalInput, kind: NumberKind) => formatNumber(v, kind, settings.numbers);
  const date = (iso: string) => format(parseISO(iso), settings.localization.region.dateFormat);
  const { profile, branding } = settings;
  return {
    number: invoice.number,
    quoteNumber: quote?.number ?? null,
    issued: date(invoice.issuedAt),
    due: date(invoice.dueAt),
    terms: PAYMENT_TERM_LABELS[customer.terms],
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
        ...addressLines(customer.address),
      ].filter(Boolean),
    },
    jobSite: addressLines(invoice.jobSite),
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: `${fmt(line.quantity, quantityKind(line.unit))} ${UNIT_LABELS[line.unit]}`,
      price: fmt(line.unitPrice, "money"),
      amount: fmt(lineAmount(line), "money"),
    })),
    subtotal: fmt(invoice.subtotal, "money"),
    taxLabel: taxLabel(invoice, fmt),
    tax: fmt(invoice.tax, "money"),
    total: fmt(invoice.total, "money"),
    paid: fmt(invoice.paid, "money"),
    balanceDue: fmt(invoice.isReturn ? "0" : balance(invoice), "money"),
    payments: payments.map((p) => ({
      id: p.id,
      date: date(p.at),
      method: METHOD_LABELS[p.method],
      amount: fmt(p.amount, "money"),
    })),
    footer: settings.localization.documents.legalFooter,
  };
}
