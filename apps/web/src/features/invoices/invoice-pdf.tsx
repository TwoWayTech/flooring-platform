import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { InvoiceModel } from "./invoice-model";
import { LINE, MUTED, Monogram, PAID, styles } from "./pdf-parts";

/** The invoice as a PDF, generated in the browser from the same model the screen shows. */
export function InvoicePdf({ model }: { model: InvoiceModel }) {
  return (
    <Document title={`Invoice ${model.number}`} author={model.company.name}>
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
            <Text style={styles.title}>Invoice {model.number}</Text>
            <Text style={styles.muted}>Issued {model.issued}</Text>
            <Text style={styles.muted}>Due {model.due}</Text>
            <Text style={styles.muted}>Terms {model.terms}</Text>
            {model.quoteNumber ? <Text style={styles.muted}>Quote {model.quoteNumber}</Text> : null}
            {model.paidOn ? (
              <Text style={[styles.stamp, { color: PAID, borderColor: PAID }]}>PAID {model.paidOn}</Text>
            ) : model.voided ? (
              <Text style={[styles.stamp, { color: MUTED, borderColor: MUTED }]}>VOID</Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.row, styles.section]}>
          <View style={{ width: "48%" }}>
            <Text style={styles.label}>Bill to</Text>
            <Text style={styles.bold}>{model.billTo.name}</Text>
            {model.billTo.lines.map((l) => (
              <Text key={l}>{l}</Text>
            ))}
          </View>
          <View style={{ width: "48%" }}>
            <Text style={styles.label}>Job site</Text>
            {model.jobSite.map((l) => (
              <Text key={l}>{l}</Text>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={{ flexDirection: "row" }}>
            <Text style={[styles.th, styles.desc]}>Description</Text>
            <Text style={[styles.th, styles.num]}>Quantity</Text>
            <Text style={[styles.th, styles.num]}>Price</Text>
            <Text style={[styles.th, styles.num]}>Amount</Text>
          </View>
          {model.lines.map((line) => (
            <View key={line.id} style={{ flexDirection: "row" }} wrap={false}>
              <Text style={[styles.td, styles.desc]}>{line.description}</Text>
              <Text style={[styles.td, styles.num]}>
                {line.quantity}
                {line.cartons ? `\n${line.cartons}` : ""}
              </Text>
              <Text style={[styles.td, styles.num]}>{line.price}</Text>
              <Text style={[styles.td, styles.num]}>{line.amount}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{model.subtotal}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={{ maxWidth: 150 }}>{model.taxLabel}</Text>
            <Text>{model.tax}</Text>
          </View>
          <View style={[styles.totalRow, styles.bold, { borderTopWidth: 0.5, borderTopColor: LINE }]}>
            <Text>Total</Text>
            <Text>{model.total}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>Paid</Text>
            <Text>{model.paid}</Text>
          </View>
          {model.credited ? (
            <View style={styles.totalRow}>
              <Text>Credit applied</Text>
              <Text>{model.credited}</Text>
            </View>
          ) : null}
          {model.writtenOff ? (
            <View style={styles.totalRow}>
              <Text>Written off</Text>
              <Text>{model.writtenOff}</Text>
            </View>
          ) : null}
          <View style={[styles.totalRow, styles.bold]}>
            <Text>Balance due</Text>
            <Text>{model.balanceDue}</Text>
          </View>
          {model.taxNote ? <Text style={styles.note}>{model.taxNote}</Text> : null}
        </View>

        {model.payments.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.label}>Payments received</Text>
            {model.payments.map((p) => (
              <Text key={p.id}>
                {p.date}, {p.method}, {p.amount}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {model.footer}
        </Text>
      </Page>
    </Document>
  );
}
