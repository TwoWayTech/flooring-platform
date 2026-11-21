import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { DOCUMENT_TOKENS, endSentence, formatNumber, type NumberSettings, type Report } from "@workspace/shared";
import { pdfSafe, pdfText } from "@/lib/pdf-text";

const { ink, muted, hairline } = DOCUMENT_TOKENS;
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: ink, fontFamily: "Helvetica" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  muted: { color: muted, marginTop: 2 },
  table: { marginTop: 18 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: hairline },
  head: { color: muted, fontSize: 8 },
  cell: { flex: 1, paddingVertical: 4, paddingRight: 6 },
  num: { textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
});

/** A report as a PDF, printed from the same report data as the screen and the CSV. */
export function ReportPdf({
  report: shown,
  company,
  filters,
  settings,
}: {
  report: Report;
  company: string;
  filters: string;
  settings: NumberSettings;
}) {
  const cell = (value: string | undefined, kind: Parameters<typeof formatNumber>[1] | undefined) =>
    value === undefined || value === "" ? "" : kind ? formatNumber(value, kind, settings) : value;
  // The PDF font lacks some signs (click-through #11); the screen keeps them.
  const report = pdfSafe(shown);
  return (
    <Document title={report.title} author={company}>
      <Page size="LETTER" orientation={report.columns.length > 5 ? "landscape" : "portrait"} style={styles.page}>
        <Text style={styles.title}>{report.title}</Text>
        <Text style={styles.muted}>{pdfText(`${endSentence(company)} ${filters}`)}</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            {report.columns.map((c) => (
              <Text key={c.id} style={[styles.cell, styles.head, c.kind ? styles.num : {}]}>
                {c.header}
              </Text>
            ))}
          </View>
          {report.rows.map((row, i) => (
            <View key={i} style={styles.row} wrap={false}>
              {report.columns.map((c) => (
                <Text key={c.id} style={[styles.cell, c.kind ? styles.num : {}]}>
                  {cell(row[c.id], c.kind)}
                </Text>
              ))}
            </View>
          ))}
          {report.totals ? (
            <View style={styles.row}>
              {report.columns.map((c) => (
                <Text key={c.id} style={[styles.cell, styles.bold, c.kind ? styles.num : {}]}>
                  {cell(report.totals![c.id], c.kind)}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}
