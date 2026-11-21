import { Document, Page, Text, View } from "@react-pdf/renderer";
import { formatWhen } from "@/lib/moments";
import {
  formatDocumentNumber,
  PAYMENT_METHOD_LABELS,
  type CompanySettings,
  type Customer,
  type Invoice,
  type InvoiceLedger,
  type Payment,
} from "@workspace/shared";
import { pdfSafe } from "@/lib/pdf-text";
import { LINE, Monogram, styles } from "../pdf-parts";

/** A payment receipt with every value formatted, as the PDF prints it (spec Appendix A "Download receipt"). */
export interface ReceiptModel {
  number: string;
  company: { name: string; lines: string[]; brandColor: string; monogram: string };
  customer: string;
  invoiceNumber: string;
  date: string;
  amount: string;
  method: string;
  reference: string;
  remaining: string;
  footer: string;
}

/**
 * Builds the receipt for one payment from the invoice's ledger and the company settings. `zone` is the
 * company's zone, the one the screens show moments in (`useTimeZone`, from GET /company; ADR 0064).
 */
export function buildReceiptModel(
  payment: Payment,
  invoice: Invoice,
  ledger: InvoiceLedger,
  customer: Customer,
  settings: CompanySettings,
  zone: string,
): ReceiptModel {
  // A receipt is a customer document: full cents whatever the display setting (click-through #55).
  const money = (v: string) => formatDocumentNumber(v, "money", settings.numbers);
  const { profile, branding } = settings;
  const method =
    PAYMENT_METHOD_LABELS[payment.method] +
    (payment.method === "card" && payment.cardLast4 ? ` ending ${payment.cardLast4}` : "") +
    (payment.method === "check" && payment.checkNumber ? ` number ${payment.checkNumber}` : "");
  return {
    number: payment.number,
    company: {
      name: branding.displayName,
      lines: [
        profile.legalName,
        profile.address.street,
        `${profile.address.city}, ${profile.address.state} ${profile.address.zip}`,
        profile.phone,
        profile.email,
      ],
      brandColor: branding.brandColor,
      monogram: branding.monogram,
    },
    customer: customer.name,
    invoiceNumber: invoice.number,
    date: formatWhen(payment.date, { pattern: settings.localization.region.dateFormat, zone }),
    amount: money(payment.amount),
    method,
    reference: payment.reference || "None",
    remaining: money(ledger.balance),
    footer: settings.localization.documents.legalFooter,
  };
}

/** One labelled value on the receipt. */
function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[styles.totalRow, { borderBottomWidth: 0.5, borderBottomColor: LINE }]}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={strong ? styles.bold : undefined}>{value}</Text>
    </View>
  );
}

/** A payment receipt PDF, styled like the invoice PDF (same header, type and colors). */
export function ReceiptPdf({ model: shown }: { model: ReceiptModel }) {
  const model = pdfSafe(shown);
  return (
    <Document title={`Receipt ${model.number}`} author={model.company.name}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.row}>
          <View style={{ flexDirection: "row" }}>
            <Monogram company={model.company} />
            <View>
              <Text style={styles.bold}>{model.company.name}</Text>
              {model.company.lines.map((l) => (
                <Text key={l} style={styles.muted}>
                  {l}
                </Text>
              ))}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>Receipt {model.number}</Text>
            <Text style={styles.muted}>{model.date}</Text>
          </View>
        </View>
        <View style={[styles.section, { width: 320 }]}>
          <Line label="Received from" value={model.customer} />
          <Line label="For invoice" value={model.invoiceNumber} />
          <Line label="Amount" value={model.amount} strong />
          <Line label="Method" value={model.method} />
          <Line label="Reference" value={model.reference} />
          <Line label="Remaining balance" value={model.remaining} strong />
        </View>
        <Text style={styles.footer}>{model.footer}</Text>
      </Page>
    </Document>
  );
}
