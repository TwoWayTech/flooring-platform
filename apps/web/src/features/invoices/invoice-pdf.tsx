import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { brandTokens, DOCUMENT_TOKENS } from "@workspace/shared";
import type { InvoiceModel } from "./invoice-model";

/** PDF colors come from the document tokens: Slate text, muted text, Grout lines, the brand accent. */
const { ink: INK, muted: MUTED, hairline: LINE, onBrand: ON_BRAND } = DOCUMENT_TOKENS;

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: INK, fontFamily: "Helvetica" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  muted: { color: MUTED },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  bold: { fontFamily: "Helvetica-Bold" },
  section: { marginTop: 22 },
  label: { color: MUTED, fontSize: 8, marginBottom: 3 },
  th: { color: MUTED, fontSize: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: LINE },
  td: { paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: LINE },
  desc: { flex: 1, paddingRight: 8 },
  num: { width: 80, textAlign: "right" },
  totals: { width: 220, marginLeft: "auto", marginTop: 16 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  footer: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 30,
    color: MUTED,
    fontSize: 8,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 6,
  },
});

function Monogram({ model }: { model: InvoiceModel }) {
  const fill = brandTokens(model.company.brandColor).light.accent;
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 4,
        backgroundColor: fill,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 10,
      }}
    >
      <Text style={{ color: ON_BRAND, fontFamily: "Helvetica-Bold", fontSize: 11 }}>{model.company.monogram}</Text>
    </View>
  );
}

/** The invoice as a PDF, generated in the browser from the same model the screen shows. */
export function InvoicePdf({ model }: { model: InvoiceModel }) {
  return (
    <Document title={`Invoice ${model.number}`} author={model.company.name}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.row}>
          <View style={{ flexDirection: "row" }}>
            <Monogram model={model} />
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
              <Text style={[styles.td, styles.num]}>{line.quantity}</Text>
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
          <View style={[styles.totalRow, styles.bold]}>
            <Text>Balance due</Text>
            <Text>{model.balanceDue}</Text>
          </View>
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
