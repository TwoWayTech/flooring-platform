import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { DOCUMENT_TOKENS, formatNumber, type BusinessReport, type NumberSettings } from "@workspace/shared";

const { ink, muted, hairline } = DOCUMENT_TOKENS;
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: ink, fontFamily: "Helvetica" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  section: { marginTop: 16 },
  heading: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  muted: { color: muted, marginTop: 2 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: hairline },
  head: { color: muted, fontSize: 8 },
  label: { flex: 2, paddingVertical: 3, paddingRight: 6 },
  cell: { flex: 1, paddingVertical: 3, textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
});

/** The business report as a PDF, printed from the same sections as the screen and the CSV (spec F2). */
export function BusinessReportPdf({
  report,
  company,
  filters,
  settings,
}: {
  report: BusinessReport;
  company: string;
  filters: string;
  settings: NumberSettings;
}) {
  const value = (raw: string | undefined, kind: "money" | "percent" | undefined) =>
    raw === undefined || raw === "" ? "" : kind ? formatNumber(raw, kind, settings) : raw;
  return (
    <Document title="Business report" author={company}>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Business report</Text>
        <Text style={styles.muted}>
          {company}. {filters}
        </Text>
        {report.sections.map((section) => (
          <View key={section.key} style={styles.section} wrap={false}>
            <Text style={styles.heading}>{section.title}</Text>
            {section.note ? <Text style={styles.muted}>{section.note}</Text> : null}
            <View style={[styles.row, { marginTop: 4 }]}>
              <Text style={[styles.label, styles.head]} />
              {section.columns.map((c) => (
                <Text key={c.id} style={[styles.cell, styles.head]}>
                  {c.header}
                </Text>
              ))}
            </View>
            {[...section.rows, ...(section.total ? [section.total] : [])].map((row) => (
              <View key={row.id} style={styles.row}>
                <Text style={[styles.label, row.id === "total" ? styles.bold : {}]}>{row.label}</Text>
                {section.columns.map((c) => (
                  <Text key={c.id} style={[styles.cell, row.id === "total" ? styles.bold : {}]}>
                    {value(row.values[c.id], row.kind ?? c.kind)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
